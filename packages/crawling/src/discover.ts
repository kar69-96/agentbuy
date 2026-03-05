import type { ProductOption } from "@bloon/core";
import { getFirecrawlConfig } from "./client.js";
import { stripCurrencySymbol, mapOptions, isValidPrice } from "./helpers.js";
import { chooseBestCandidate, type CandidateInput } from "./parser-ensemble.js";
import { defaultQueryDiscoveryProviders } from "./providers.js";
import { getLastFirecrawlFailure } from "./extract.js";
import { getLastBrowserbaseFailure } from "./browserbase-extract.js";
import {
  resolveVariantPricesViaFirecrawl,
  resolveVariantPricesViaCrawl,
} from "./variant.js";
import { fetchShopifyOptions } from "./shopify.js";
import { ProductBlockedError, ProductNotFoundError } from "./constants.js";

export interface FullDiscoveryResult {
  name: string;
  price: string;
  image_url?: string;
  method: string;
  options: ProductOption[];
  original_price?: string;
  currency?: string;
  description?: string;
  brand?: string;
  error?: string;
  // Optional diagnostics fields for internal test/benchmark harnesses.
  failure_code?: DiscoveryFailureCode;
  failure_stage?: string;
  failure_detail?: string;
}

export type DiscoveryFailureCode =
  | "llm_config"
  | "blocked"
  | "render_timeout"
  | "adapter_502"
  | "extract_empty"
  | "not_found"
  | "http_error"
  | "transport_error";

export interface DiscoveryDiagnostics {
  failureCode?: DiscoveryFailureCode;
  failureStage?: string;
  failureDetail?: string;
  method?: "firecrawl" | "browserbase";
  timings?: {
    totalMs: number;
    firecrawlMs: number;
    firecrawlAttempts: number;
    browserbaseMs: number;
    variantMs: number;
  };
}

// ---- Tier 2: Firecrawl 3-step discovery pipeline ----

export async function discoverViaFirecrawl(
  url: string,
): Promise<FullDiscoveryResult | null> {
  const { result } = await discoverViaFirecrawlWithDiagnostics(url);
  return result;
}

export async function discoverViaFirecrawlWithDiagnostics(
  url: string,
): Promise<{ result: FullDiscoveryResult | null; diagnostics: DiscoveryDiagnostics }> {
  const totalStart = Date.now();
  const config = getFirecrawlConfig();
  if (!config) {
    return {
      result: null,
      diagnostics: {
        failureCode: "llm_config",
        failureStage: "config",
        failureDetail: "missing FIRECRAWL_API_KEY configuration",
        timings: {
          totalMs: Date.now() - totalStart,
          firecrawlMs: 0,
          firecrawlAttempts: 0,
          browserbaseMs: 0,
          variantMs: 0,
        },
      },
    };
  }
  const minConfidence = Number.parseFloat(
    process.env.QUERY_MIN_CONFIDENCE ?? "0.75",
  );
  const perAttemptTimeoutMs = Number.parseInt(
    process.env.QUERY_FIRECRAWL_TIMEOUT_MS ?? "90000",
    10,
  );
  const diagnostics: DiscoveryDiagnostics = {};
  let firecrawlMs = 0;
  let firecrawlAttempts = 0;
  let browserbaseMs = 0;
  let variantMs = 0;
  const failurePriority: Record<DiscoveryFailureCode, number> = {
    llm_config: 100,
    blocked: 90,
    not_found: 85,
    adapter_502: 70,
    render_timeout: 65,
    http_error: 60,
    extract_empty: 40,
    transport_error: 30,
  };
  const setFailure = (
    code: DiscoveryFailureCode,
    stage: string,
    detail?: string,
  ): void => {
    const current = diagnostics.failureCode;
    if (!current || failurePriority[code] >= failurePriority[current]) {
      diagnostics.failureCode = code;
      diagnostics.failureStage = stage;
      diagnostics.failureDetail = detail;
    }
  };

  try {
    // Step 1: collect candidates from Firecrawl attempts
    const candidates: CandidateInput[] = [];
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      }
      const attemptStart = Date.now();
      const extract = await defaultQueryDiscoveryProviders.firecrawlExtract(
        url,
        config,
        perAttemptTimeoutMs,
      );
      firecrawlMs += Date.now() - attemptStart;
      firecrawlAttempts += 1;
      if (!extract) {
        const firecrawlFailure = getLastFirecrawlFailure();
        if (firecrawlFailure) {
          setFailure(
            firecrawlFailure.code as DiscoveryFailureCode,
            "firecrawl_extract",
            firecrawlFailure.detail,
          );
        }
      }
      if (extract) {
        candidates.push({ source: "firecrawl", extract });
        const bestSoFar = chooseBestCandidate(candidates);
        if (
          bestSoFar
          && bestSoFar.confidence >= minConfidence
          && isValidPrice(bestSoFar.extract.price ?? "")
        ) {
          break;
        }
        if (
          bestSoFar?.extract.price
          && !isValidPrice(bestSoFar.extract.price)
        ) {
          // Price is explicitly invalid; additional retries rarely improve signal.
          break;
        }
      }
    }

    let best = chooseBestCandidate(candidates);
    const hasRequiredFields = Boolean(best?.extract.name && best?.extract.price);
    const hasValidPrice = Boolean(best?.extract.price && isValidPrice(best.extract.price));

    // If we don't have required fields, or confidence is too low on a valid candidate,
    // try Browserbase + Gemini as a repair path.
    if (!hasRequiredFields || (best && best.confidence < minConfidence && hasValidPrice)) {
      const browserbaseStart = Date.now();
      const bbExtract = await defaultQueryDiscoveryProviders.browserbaseExtract(
        url,
        perAttemptTimeoutMs,
      );
      browserbaseMs += Date.now() - browserbaseStart;
      if (!bbExtract) {
        const bbFailure = getLastBrowserbaseFailure();
        if (bbFailure) {
          setFailure(
            bbFailure.code as DiscoveryFailureCode,
            "browserbase_extract",
            bbFailure.detail,
          );
        }
      }
      if (bbExtract) {
        candidates.push({ source: "browserbase", extract: bbExtract });
        best = chooseBestCandidate(candidates);
      }
    }

    if (!best || !best.extract.price || !isValidPrice(best.extract.price)) {
      return {
        result: null,
        diagnostics: {
          failureCode: diagnostics.failureCode ?? "extract_empty",
          failureStage: diagnostics.failureStage ?? "ranking",
          failureDetail: diagnostics.failureDetail ?? "no valid price-bearing candidate",
          timings: {
            totalMs: Date.now() - totalStart,
            firecrawlMs,
            firecrawlAttempts,
            browserbaseMs,
            variantMs,
          },
        },
      };
    }
    const extract = best.extract;

    let options = mapOptions(extract.options);

    // Shopify fallback: if no options from LLM, try the Shopify .json endpoint
    if (options.length === 0) {
      const shopifyOpts = await fetchShopifyOptions(url);
      if (shopifyOpts) options = shopifyOpts;
    }

    // Step 2 or 3 — only if options exist
    if (options.length > 0) {
      const variantStart = Date.now();
      const hasVariantUrls =
        extract.variant_urls && extract.variant_urls.length > 0;
      if (hasVariantUrls) {
        // Step 2: /extract on variant URLs with bounded adaptive budget
        options = await resolveVariantPricesViaFirecrawl(
          extract.variant_urls!,
          url,
          config,
          options,
          {
            maxVariantUrls: Number.parseInt(
              process.env.QUERY_MAX_VARIANT_URLS ?? "12",
              10,
            ),
          },
        );
      } else {
        // Step 3: /crawl from product URL
        options = await resolveVariantPricesViaCrawl(
          url,
          config,
          options,
          extract.name!,
        );
      }
      variantMs += Date.now() - variantStart;
    }

    const clean = (v: string | undefined): string | undefined =>
      v && v !== "null" && v !== "undefined" ? v : undefined;

    return {
      result: {
      name: extract.name!,
      price: stripCurrencySymbol(extract.price!),
      image_url: clean(extract.image_url),
      method: best.source === "browserbase" ? "browserbase" : "firecrawl",
      options,
      original_price: clean(extract.original_price)
        ? stripCurrencySymbol(extract.original_price!)
        : undefined,
      currency: clean(extract.currency),
      description: clean(extract.description),
      brand: clean(extract.brand),
      },
      diagnostics: {
        method: best.source === "browserbase" ? "browserbase" : "firecrawl",
        timings: {
          totalMs: Date.now() - totalStart,
          firecrawlMs,
          firecrawlAttempts,
          browserbaseMs,
          variantMs,
        },
      },
    };
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return {
        result: {
          name: "",
          price: "",
          method: "firecrawl",
          options: [],
          error: "product_not_found",
          failure_code: "not_found",
          failure_stage: diagnostics.failureStage ?? "classification",
          failure_detail: err.message,
        },
        diagnostics: {
          failureCode: "not_found",
          failureStage: diagnostics.failureStage ?? "classification",
          failureDetail: err.message,
          timings: {
            totalMs: Date.now() - totalStart,
            firecrawlMs,
            firecrawlAttempts,
            browserbaseMs,
            variantMs,
          },
        },
      };
    }
    if (err instanceof ProductBlockedError) {
      return {
        result: null,
        diagnostics: {
          failureCode: "blocked",
          failureStage: diagnostics.failureStage ?? "classification",
          failureDetail: err.message,
          timings: {
            totalMs: Date.now() - totalStart,
            firecrawlMs,
            firecrawlAttempts,
            browserbaseMs,
            variantMs,
          },
        },
      };
    }
    return {
      result: null,
      diagnostics: {
        failureCode: diagnostics.failureCode ?? "transport_error",
        failureStage: diagnostics.failureStage ?? "unknown",
        failureDetail:
          diagnostics.failureDetail
          ?? (err instanceof Error ? err.message : String(err)),
        timings: {
          totalMs: Date.now() - totalStart,
          firecrawlMs,
          firecrawlAttempts,
          browserbaseMs,
          variantMs,
        },
      },
    };
  }
}
