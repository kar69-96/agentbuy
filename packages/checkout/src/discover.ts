import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import {
  BloonError,
  ErrorCodes,
  type ShippingInfo,
  type ProductOption,
} from "@bloon/core";
import {
  createSession,
  destroySession,
  getModelApiKey,
  getBrowserbaseConfig,
} from "./session.js";
import { sanitizeShipping } from "./credentials.js";
import { concurrencyPool } from "./concurrency-pool.js";
import { CostTracker } from "./cost-tracker.js";


// ---- Discovery result ----

export interface DiscoveryResult {
  name: string;
  price: string;
  tax?: string;
  shipping?: string;
  total?: string;
  method: "scrape" | "browserbase_cart";
  image_url?: string;
}

export interface DiscoveryResultWithOptions extends DiscoveryResult {
  options: ProductOption[];
}

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
}

// ---- Firecrawl constants ----

const FIRECRAWL_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Product name or title" },
    price: { type: "string", description: "Current selling price" },
    original_price: {
      type: "string",
      description: "Original price before discount",
    },
    currency: { type: "string", description: "Currency code, e.g. USD, EUR" },
    brand: { type: "string", description: "Brand or manufacturer" },
    image_url: { type: "string", description: "Main product image URL" },
    description: { type: "string", description: "Short product description" },
    options: {
      type: "array",
      description:
        "ALL product variant option groups (Color, Size, Style, Material, etc.)",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          values: { type: "array", items: { type: "string" } },
          prices: { type: "object", additionalProperties: { type: "string" } },
        },
      },
    },
    variant_urls: {
      type: "array",
      description:
        "URLs for other variants of this same product (color swatches, style links, etc.)",
      items: { type: "string" },
    },
  },
} as const;

const FIRECRAWL_EXTRACT_PROMPT =
  "Extract all product details exhaustively. Include EVERY variant group visible " +
  "on the page (Color swatches, Size buttons, Style selectors, etc.). For variant_urls, " +
  "include the href of every color swatch or variant link that loads a different variant.";

const MAX_VARIANT_EXTRACT = 20;
const CRAWL_PAGE_LIMIT = 25;
const VARIANT_EXTRACT_CONCURRENCY = 5;
const FIRECRAWL_POLL_INTERVAL_MS = 2000;

// ---- Firecrawl extract type ----

interface FirecrawlExtract {
  name?: string;
  price?: string;
  original_price?: string;
  currency?: string;
  description?: string;
  brand?: string;
  image_url?: string;
  options?: Array<{
    name: string;
    values: string[];
    prices?: Record<string, string>;
  }>;
  variant_urls?: string[];
}

// ---- Tier 1: Server-side scrape (JSON-LD + meta tags) ----

export function extractJsonLd(html: string): Record<string, unknown> | null {
  const regex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]!) as Record<string, unknown>;

      // Direct Product type
      if (data["@type"] === "Product") return data;

      // @graph array
      if (Array.isArray(data["@graph"])) {
        const product = (data["@graph"] as Record<string, unknown>[]).find(
          (item) => item["@type"] === "Product",
        );
        if (product) return product;
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return null;
}

export function extractMetaTag(html: string, property: string): string | null {
  // Match both property= and name= attributes
  const regex = new RegExp(
    `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const match = regex.exec(html);
  if (match) return match[1] || null;

  // Also check reversed attribute order (content before property)
  const regexReversed = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const matchReversed = regexReversed.exec(html);
  return matchReversed ? matchReversed[1] || null : null;
}

function extractPriceFromString(text: string): string | null {
  const cleaned = text.trim();
  // Try European decimal format first: "47,49", "47,49 €"
  const euroMatch = /(\d+),(\d{1,2})(?!\d)/.exec(cleaned);
  if (euroMatch) return `${euroMatch[1]}.${euroMatch[2]}`;
  // US/standard format: "98.00", "$98.00", "1,234.56"
  const stdCleaned = cleaned.replace(/,/g, "");
  const stdMatch = /\d+\.?\d*/.exec(stdCleaned);
  return stdMatch ? stdMatch[0] : null;
}

export async function scrapePrice(
  url: string,
): Promise<DiscoveryResult | null> {
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    html = await response.text();
  } catch {
    return null;
  }

  // Try JSON-LD first
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    const name = (jsonLd["name"] as string) || "";
    let price: string | null = null;
    const image = (jsonLd["image"] as string) || undefined;

    // Extract price from offers (may be object or array)
    let offersObj = jsonLd["offers"] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined;
    if (Array.isArray(offersObj)) {
      offersObj = offersObj[0];
    }
    if (offersObj) {
      if (
        typeof offersObj["price"] === "string" ||
        typeof offersObj["price"] === "number"
      ) {
        price = String(offersObj["price"]);
      } else if (
        typeof offersObj["lowPrice"] === "string" ||
        typeof offersObj["lowPrice"] === "number"
      ) {
        price = String(offersObj["lowPrice"]);
      }
    }

    if (name && price) {
      return { name, price, method: "scrape", image_url: image };
    }
  }

  // Try OG / product meta tags
  const ogTitle = extractMetaTag(html, "og:title");
  const ogPrice =
    extractMetaTag(html, "product:price:amount") ||
    extractMetaTag(html, "og:price:amount");
  const ogImage = extractMetaTag(html, "og:image") || undefined;

  if (ogTitle && ogPrice) {
    const price = extractPriceFromString(ogPrice);
    if (price) {
      return { name: ogTitle, price, method: "scrape", image_url: ogImage };
    }
  }

  return null;
}

// ---- Variant price helpers ----

const VariantPriceSchema = z.object({
  price: z
    .string()
    .describe("Currently displayed product price including currency symbol"),
});

/** Strip characters that could be used for prompt injection in option values. */
export function sanitizeVariantValue(value: string): string {
  return value.replace(/[<>"'&;]/g, "").slice(0, 100);
}

/** Dismiss common popups/modals via DOM manipulation (no LLM cost). */
export async function dismissPopupsOnPage(
  page: NonNullable<
    Awaited<ReturnType<InstanceType<typeof Stagehand>["context"]["activePage"]>>
  >,
): Promise<void> {
  await page.evaluate(() => {
    const closeSelectors = [
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '[data-testid="close-button"]',
      ".modal-close",
      ".popup-close",
      'button[class*="close"]',
      '[data-dismiss="modal"]',
    ];
    for (const sel of closeSelectors) {
      const el = document.querySelector(sel);
      if (el) (el as HTMLElement).click();
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

// ---- Tier 3: Browserbase product discovery via Stagehand extract ----

const BrowserProductSchema = z.object({
  name: z.string().describe("Product name or title"),
  price: z.string().describe("Current selling price including currency symbol"),
  original_price: z
    .string()
    .optional()
    .describe("Original price before discount"),
  currency: z.string().optional().describe("Currency code, e.g. USD, EUR"),
  brand: z.string().optional().describe("Brand or manufacturer"),
  image_url: z.string().optional().describe("Main product image URL"),
  options: z
    .array(
      z.object({
        name: z.string().describe("Option group name, e.g. Color, Size"),
        values: z.array(z.string()).describe("Available values"),
        prices: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Map value→price if different values have different prices",
          ),
      }),
    )
    .optional()
    .describe("ALL product variant options"),
});

export async function discoverViaBrowser(
  url: string,
): Promise<FullDiscoveryResult | null> {
  // Guard: need Browserbase + model API keys
  try {
    getBrowserbaseConfig();
    getModelApiKey();
  } catch {
    return null;
  }

  let session: Awaited<ReturnType<typeof createSession>>;
  try {
    session = await createSession();
  } catch {
    return null;
  }

  const discoverTracker = new CostTracker();
  const sessionStartMs = Date.now();
  let stagehand: InstanceType<typeof Stagehand> | undefined;
  let sessionDestroyed = false;

  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: getModelApiKey(),
      },
      browserbaseSessionID: session.id,
    });

    await stagehand.init();
    const page = stagehand.context.activePage()!;

    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(3000);
    await dismissPopupsOnPage(page);
    await page.waitForTimeout(500);

    const extractStart = Date.now();
    const extracted = await stagehand.extract(
      "Extract the product name, current price, original price (if on sale), currency, brand, main image URL, and all variant options (like Color, Size) with their available values and per-value prices if different",
      BrowserProductSchema,
    );
    discoverTracker.addLLMCall(
      "discover/extract",
      0,
      0,
      "google/gemini-2.5-flash",
      Date.now() - extractStart,
    );

    // Validate minimum required fields (LLM may return literal "null" string)
    if (
      !extracted.name ||
      !extracted.price ||
      extracted.name === "null" ||
      extracted.price === "null"
    ) {
      return null;
    }

    // Map options with currency-stripped prices
    let options: ProductOption[] = (extracted.options ?? []).map((opt) => ({
      name: opt.name,
      values: opt.values,
      prices: opt.prices
        ? Object.fromEntries(
            Object.entries(opt.prices).map(([k, v]) => [
              k,
              stripCurrencySymbol(v),
            ]),
          )
        : undefined,
    }));

    // Close initial session early before spawning concurrent variant fetches
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    stagehand = undefined;
    await destroySession(session.id);
    sessionDestroyed = true;

    // Resolve per-variant prices via concurrent Browserbase sessions (best-effort)
    if (options.length > 0) {
      try {
        options = await resolveVariantPricesViaBrowser(url, options);
      } catch {
        // Variant resolution is best-effort — keep original options
      }
    }

    return {
      name: extracted.name,
      price: stripCurrencySymbol(extracted.price),
      image_url:
        extracted.image_url && extracted.image_url !== "null"
          ? extracted.image_url
          : undefined,
      method: "browserbase",
      options,
      original_price: extracted.original_price
        ? stripCurrencySymbol(extracted.original_price)
        : undefined,
      currency: extracted.currency,
      brand: extracted.brand,
    };
  } catch {
    return null;
  } finally {
    discoverTracker.addSession(session.id, Date.now() - sessionStartMs);
    discoverTracker.printSummary();
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        /* ignore */
      }
    }
    if (!sessionDestroyed) {
      await destroySession(session.id);
    }
  }
}

// ---- Per-variant price fetch via Browserbase ----

const VARIANT_AGENT_SYSTEM_PROMPT = `You are selecting a product variant on an e-commerce website.

Your task:
1. Find the correct variant selector for the requested option (e.g. Color, Size, Style)
2. Select the requested value
3. Report the updated product price

CRITICAL RULES:
- NEVER interact with the quantity selector or "Qty" dropdown — that is NOT a variant
- Look for variant selectors: color swatches, size buttons, labeled dropdowns
  in the product details/options area
- Variant selectors are usually near the product title and price, labeled with
  their option name (e.g. "Color:", "Size:", "Style:")
- After selecting, wait for the price to update, then report it`;

/** Fetch a single variant's price in a fresh Browserbase session. */
export async function fetchVariantPriceBrowser(
  url: string,
  optionName: string,
  value: string,
): Promise<string | null> {
  let session: Awaited<ReturnType<typeof createSession>>;
  try {
    session = await createSession();
  } catch {
    return null;
  }

  const variantTracker = new CostTracker();
  const sessionStartMs = Date.now();
  let stagehand: InstanceType<typeof Stagehand> | undefined;

  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: getModelApiKey(),
      },
      browserbaseSessionID: session.id,
      experimental: true,
    });

    await stagehand.init();
    const page = stagehand.context.activePage()!;

    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(3000);
    await dismissPopupsOnPage(page);

    const agent = stagehand.agent({
      mode: "dom",
      systemPrompt: VARIANT_AGENT_SYSTEM_PROMPT,
    });

    const safeName = sanitizeVariantValue(optionName);
    const safeValue = sanitizeVariantValue(value);
    const agentStart = Date.now();

    const result = await agent.execute({
      instruction: `Select the "${safeName}" variant with value "${safeValue}". Then report the currently displayed product price.`,
      maxSteps: 8,
      output: VariantPriceSchema,
    });

    const resultUsage = result.usage;
    if (resultUsage?.input_tokens || resultUsage?.output_tokens) {
      variantTracker.addLLMCall(
        `variant/${safeValue.slice(0, 20)}`,
        resultUsage.input_tokens ?? 0,
        resultUsage.output_tokens ?? 0,
        "google/gemini-2.0-flash",
        Date.now() - agentStart,
      );
    }

    const output = result.output;
    if (!output?.price || output.price === "null") return null;
    return stripCurrencySymbol(String(output.price));
  } catch {
    return null;
  } finally {
    variantTracker.addSession(session.id, Date.now() - sessionStartMs);
    variantTracker.printSummary();
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        /* ignore */
      }
    }
    await destroySession(session.id);
  }
}

/** Max variants to resolve per option group (e.g. 5 out of 30 colors). */
const MAX_VARIANTS_PER_GROUP = 5;

/** Resolve per-variant prices via concurrent Browserbase sessions. */
export async function resolveVariantPricesViaBrowser(
  url: string,
  options: ProductOption[],
  concurrency = 5,
): Promise<ProductOption[]> {
  // Build task list: flatten option groups into { optionName, value } pairs
  // Cap per group to avoid spawning dozens of sessions for products with many variants
  const tasks: Array<{ optionName: string; value: string }> = [];
  for (const opt of options) {
    // Skip groups where all values already have prices
    if (opt.prices && opt.values.every((v) => opt.prices![v] != null)) continue;
    let count = 0;
    for (const value of opt.values) {
      // Skip individual values that already have a price
      if (opt.prices?.[value] != null) continue;
      if (count >= MAX_VARIANTS_PER_GROUP) break;
      tasks.push({ optionName: opt.name, value });
      count++;
    }
  }

  if (tasks.length === 0) return options;

  const results = await concurrencyPool(
    tasks,
    (task) => fetchVariantPriceBrowser(url, task.optionName, task.value),
    concurrency,
  );

  // Build price maps from fulfilled results
  const priceMaps = new Map<string, Map<string, string>>();
  for (let i = 0; i < tasks.length; i++) {
    const result = results[i]!;
    if (result.status === "fulfilled" && result.value != null) {
      const task = tasks[i]!;
      if (!priceMaps.has(task.optionName))
        priceMaps.set(task.optionName, new Map());
      priceMaps.get(task.optionName)!.set(task.value, result.value);
    }
  }

  // Merge into options
  return options.map((opt) => {
    const resolved = priceMaps.get(opt.name);
    if (!resolved || resolved.size === 0) return opt;
    // Combine existing prices with resolved ones
    const merged: Record<string, string> = { ...(opt.prices ?? {}) };
    for (const [value, price] of resolved) {
      merged[value] = price;
    }
    // Same-price filter: if all prices are identical, omit the map
    const uniquePrices = new Set(Object.values(merged));
    if (uniquePrices.size <= 1) return { ...opt, prices: undefined };
    return { ...opt, prices: merged };
  });
}

// ---- Browserbase cart discovery via Stagehand ----

const CartPricingSchema = z.object({
  name: z.string().describe("Product name"),
  price: z.string().describe("Product price without currency symbol"),
  tax: z.string().optional().describe("Tax amount"),
  shipping: z.string().optional().describe("Shipping cost"),
  total: z.string().optional().describe("Order total"),
});

export async function discoverViaCart(
  url: string,
  shipping: ShippingInfo,
): Promise<DiscoveryResult> {
  const modelApiKey = getModelApiKey();
  const session = await createSession();
  const cartTracker = new CostTracker();
  const sessionStartMs = Date.now();
  let stagehand: InstanceType<typeof Stagehand> | undefined;

  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "google/gemini-2.5-flash",
        apiKey: modelApiKey,
      },
      browserbaseSessionID: session.id,
    });

    await stagehand.init();
    const page = stagehand.context.activePage()!;

    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(3000);

    let actStart = Date.now();
    await stagehand.act("Add this product to cart");
    cartTracker.addLLMCall(
      "cart/add-to-cart",
      0,
      0,
      "google/gemini-2.5-flash",
      Date.now() - actStart,
    );
    await page.waitForTimeout(1000);

    actStart = Date.now();
    await stagehand.act("Go to cart or proceed to checkout");
    cartTracker.addLLMCall(
      "cart/go-to-checkout",
      0,
      0,
      "google/gemini-2.5-flash",
      Date.now() - actStart,
    );
    await page.waitForTimeout(2000);

    // Fill shipping if applicable (sanitize to prevent prompt injection)
    const safe = sanitizeShipping(shipping);
    try {
      actStart = Date.now();
      await stagehand.act(
        "Fill shipping information: name=%x_shipping_name%, street=%x_shipping_street%, city=%x_shipping_city%, state=%x_shipping_state%, zip=%x_shipping_zip%, country=%x_shipping_country%, email=%x_shipping_email%, phone=%x_shipping_phone%",
        {
          variables: {
            x_shipping_name: safe.name,
            x_shipping_street: safe.street,
            x_shipping_city: safe.city,
            x_shipping_state: safe.state,
            x_shipping_zip: safe.zip,
            x_shipping_country: safe.country,
            x_shipping_email: safe.email,
            x_shipping_phone: safe.phone,
          },
        },
      );
      cartTracker.addLLMCall(
        "cart/fill-shipping",
        0,
        0,
        "google/gemini-2.5-flash",
        Date.now() - actStart,
      );
      await page.waitForTimeout(1000);
    } catch {
      // Shipping form may not be visible yet
    }

    const extractStart = Date.now();
    const pricing = await stagehand.extract(
      "Extract the product name, price, tax, shipping cost, and order total from this cart/checkout page",
      CartPricingSchema,
    );
    cartTracker.addLLMCall(
      "cart/extract-pricing",
      0,
      0,
      "google/gemini-2.5-flash",
      Date.now() - extractStart,
    );

    // Strip currency symbols from extracted values
    const stripCurrency = (v: string | undefined): string | undefined =>
      v ? v.replace(/^[^\d]*/, "").replace(/[^\d.]/g, "") || v : v;

    return {
      name: pricing.name,
      price: stripCurrency(pricing.price) || pricing.price,
      tax: stripCurrency(pricing.tax),
      shipping: stripCurrency(pricing.shipping),
      total: stripCurrency(pricing.total),
      method: "browserbase_cart",
    };
  } finally {
    cartTracker.addSession(session.id, Date.now() - sessionStartMs);
    cartTracker.printSummary();
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        /* ignore */
      }
    }
    await destroySession(session.id);
  }
}

// ---- Main entry: Tier 1 → Tier 2 fallback ----

export async function discoverPrice(
  url: string,
  shipping?: ShippingInfo,
): Promise<DiscoveryResult> {
  // Tier 1: Fast server-side scrape
  const scraped = await scrapePrice(url);
  if (scraped) return scraped;

  // Tier 2: Browserbase cart (requires shipping)
  if (!shipping) {
    throw new Error(
      "Price extraction failed: no structured data found and no shipping info provided for cart discovery",
    );
  }

  return discoverViaCart(url, shipping);
}

// ---- Variant extraction from JSON-LD ----

export function extractVariantsFromJsonLd(
  jsonLd: Record<string, unknown>,
): ProductOption[] {
  const optionMap = new Map<string, Set<string>>();
  const priceMap = new Map<string, Map<string, string>>(); // optionName → (value → price)

  function processVariant(
    props: Record<string, unknown>[],
    price?: string,
  ): void {
    for (const prop of props) {
      const name = prop["name"] as string | undefined;
      const value = prop["value"] as string | undefined;
      if (name && value) {
        if (!optionMap.has(name)) optionMap.set(name, new Set());
        optionMap.get(name)!.add(value);

        // Track per-variant price (first-wins if same value at different prices)
        if (price) {
          if (!priceMap.has(name)) priceMap.set(name, new Map());
          const prices = priceMap.get(name)!;
          if (!prices.has(value)) {
            prices.set(value, price);
          }
        }
      }
    }
  }

  // Handle hasVariant array (Schema.org ProductModel)
  const variants = jsonLd["hasVariant"] as
    | Record<string, unknown>[]
    | undefined;
  if (Array.isArray(variants)) {
    for (const variant of variants) {
      const props = variant["additionalProperty"] as
        | Record<string, unknown>[]
        | undefined;
      const price =
        variant["price"] != null ? String(variant["price"]) : undefined;
      if (Array.isArray(props)) {
        processVariant(props, price);
      }
    }
  }

  // Handle offers array with additionalProperty (Shopify-style)
  let offers = jsonLd["offers"] as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | undefined;
  if (offers && !Array.isArray(offers)) offers = [offers];
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const props = offer["additionalProperty"] as
        | Record<string, unknown>[]
        | undefined;
      const price = offer["price"] != null ? String(offer["price"]) : undefined;
      if (Array.isArray(props)) {
        processVariant(props, price);
      }
    }
  }

  const result: ProductOption[] = [];
  for (const [name, values] of optionMap) {
    const prices = priceMap.get(name);
    // Only include prices if different values have different prices
    const priceValues = prices ? new Set(prices.values()) : new Set();
    const includePrices = prices && prices.size > 0 && priceValues.size > 1;
    result.push({
      name,
      values: [...values],
      prices: includePrices ? Object.fromEntries(prices) : undefined,
    });
  }
  return result;
}

// ---- Tier 1 with options: Server-side scrape + variant extraction ----

export async function scrapePriceWithOptions(
  url: string,
): Promise<DiscoveryResultWithOptions | null> {
  let html: string;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    html = await response.text();
  } catch {
    return null;
  }

  let options: ProductOption[] = [];

  // Try JSON-LD first
  const jsonLd = extractJsonLd(html);
  if (jsonLd) {
    options = extractVariantsFromJsonLd(jsonLd);

    const name = (jsonLd["name"] as string) || "";
    let price: string | null = null;
    const image = (jsonLd["image"] as string) || undefined;

    let offersObj = jsonLd["offers"] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined;
    if (Array.isArray(offersObj)) {
      offersObj = offersObj[0];
    }
    if (offersObj) {
      if (
        typeof offersObj["price"] === "string" ||
        typeof offersObj["price"] === "number"
      ) {
        price = String(offersObj["price"]);
      } else if (
        typeof offersObj["lowPrice"] === "string" ||
        typeof offersObj["lowPrice"] === "number"
      ) {
        price = String(offersObj["lowPrice"]);
      }
    }

    if (name && price) {
      return { name, price, method: "scrape", image_url: image, options };
    }
  }

  // Try OG / product meta tags
  const ogTitle = extractMetaTag(html, "og:title");
  const ogPrice =
    extractMetaTag(html, "product:price:amount") ||
    extractMetaTag(html, "og:price:amount");
  const ogImage = extractMetaTag(html, "og:image") || undefined;

  if (ogTitle && ogPrice) {
    const cleaned = ogPrice.trim().replace(/,/g, "");
    const match = /[\d]+\.?\d*/.exec(cleaned);
    if (match) {
      return {
        name: ogTitle,
        price: match[0],
        method: "scrape",
        image_url: ogImage,
        options,
      };
    }
  }

  return null;
}

// ---- Price utilities ----

function stripCurrencySymbol(price: string): string {
  // Extract the first price-like value, handling European comma decimals
  const extracted = extractPriceFromString(price);
  if (extracted) return extracted;
  // Fallback: strip non-numeric except dots
  return price.replace(/^[^\d]*/, "").replace(/[^\d.]/g, "") || price;
}

function mapOptions(
  rawOptions?: Array<{
    name: string;
    values: string[];
    prices?: Record<string, string>;
  }>,
): ProductOption[] {
  return (rawOptions ?? []).map((opt) => {
    if (!opt.prices || Object.keys(opt.prices).length === 0) {
      return { name: opt.name, values: opt.values };
    }
    const mapped = Object.fromEntries(
      Object.entries(opt.prices).map(([k, v]) => [k, stripCurrencySymbol(v)]),
    );
    return { name: opt.name, values: opt.values, prices: mapped };
  });
}

// ---- Firecrawl async helpers ----

async function pollFirecrawlJob(
  jobUrl: string,
  apiKey: string,
  timeoutMs: number,
  intervalMs: number = FIRECRAWL_POLL_INTERVAL_MS,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(jobUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;

      const body = (await res.json()) as Record<string, unknown>;
      const status = body["status"] as string | undefined;

      if (status === "completed") return body;
      if (status === "failed") return null;

      // Still processing — wait before next poll
      await new Promise((r) => setTimeout(r, intervalMs));
    } catch {
      return null;
    }
  }

  return null; // Timeout
}

async function firecrawlExtractAsync(
  urls: string[],
  apiKey: string,
  timeoutMs: number,
): Promise<FirecrawlExtract[] | null> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        urls,
        schema: FIRECRAWL_EXTRACT_SCHEMA,
        prompt: FIRECRAWL_EXTRACT_PROMPT,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as Record<string, unknown>;

    // Sync response — data may be array or single object
    const syncData = body["data"];
    if (syncData && typeof syncData === "object") {
      if (Array.isArray(syncData)) return syncData as FirecrawlExtract[];
      return [syncData as FirecrawlExtract];
    }

    // Async response — poll for completion
    const jobId = body["id"] as string | undefined;
    if (!jobId) return null;

    const result = await pollFirecrawlJob(
      `https://api.firecrawl.dev/v1/extract/${jobId}`,
      apiKey,
      timeoutMs,
    );
    if (!result) return null;

    const pollData = result["data"];
    if (!pollData || typeof pollData !== "object") return null;
    if (Array.isArray(pollData)) return pollData as FirecrawlExtract[];
    return [pollData as FirecrawlExtract];
  } catch {
    return null;
  }
}

async function firecrawlCrawlAsync(
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<FirecrawlExtract[] | null> {
  try {
    const response = await fetch("https://api.firecrawl.dev/v1/crawl", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        maxDepth: 1,
        limit: CRAWL_PAGE_LIMIT,
        scrapeOptions: {
          formats: ["extract"],
          extract: {
            schema: FIRECRAWL_EXTRACT_SCHEMA,
            prompt: FIRECRAWL_EXTRACT_PROMPT,
          },
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as Record<string, unknown>;
    const jobId = (body["id"] ?? body["jobId"]) as string | undefined;
    if (!jobId) return null;

    const result = await pollFirecrawlJob(
      `https://api.firecrawl.dev/v1/crawl/${jobId}`,
      apiKey,
      timeoutMs,
    );
    if (!result) return null;

    // Crawl results: array of { data: { extract: {...} } } or flat array
    const data = result["data"] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(data)) return null;

    return data.map((page) => {
      const extract =
        (page["extract"] as FirecrawlExtract | undefined) ??
        (page as unknown as FirecrawlExtract);
      return extract;
    });
  } catch {
    return null;
  }
}

// ---- Step 2: Variant URL resolution via /extract ----

async function resolveVariantPricesViaFirecrawl(
  variantUrls: string[],
  currentUrl: string,
  apiKey: string,
  baseOptions: ProductOption[],
): Promise<ProductOption[]> {
  // Dedupe URLs, exclude current, cap at MAX_VARIANT_EXTRACT
  const urls = [...new Set(variantUrls)]
    .filter((u) => u !== currentUrl && u.startsWith("http"))
    .slice(0, MAX_VARIANT_EXTRACT);

  if (urls.length === 0) return baseOptions;

  // Run /extract on each variant URL via concurrency pool
  const results = await concurrencyPool(
    urls,
    async (variantUrl) => {
      const extracts = await firecrawlExtractAsync(
        [variantUrl],
        apiKey,
        60_000,
      );
      return extracts?.[0] ?? null;
    },
    VARIANT_EXTRACT_CONCURRENCY,
  );

  // Build per-option price maps from results
  const optionPriceMaps = new Map<string, Map<string, string>>();

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const extract = result.value;
    if (!extract.price) continue;

    const extractPrice = stripCurrencySymbol(extract.price);
    const extractOptions = extract.options ?? [];

    // For each option group in the variant extract, identify which value is selected
    for (const baseOpt of baseOptions) {
      const matchingExtractOpt = extractOptions.find(
        (eo) => eo.name.toLowerCase() === baseOpt.name.toLowerCase(),
      );
      if (!matchingExtractOpt) continue;

      // Find a value in this variant's option group that differs from others
      // or is present as the "selected" value (typically 1 value or first value)
      for (const val of matchingExtractOpt.values) {
        if (baseOpt.values.includes(val)) {
          if (!optionPriceMaps.has(baseOpt.name)) {
            optionPriceMaps.set(baseOpt.name, new Map());
          }
          const priceMap = optionPriceMaps.get(baseOpt.name)!;
          if (!priceMap.has(val)) {
            priceMap.set(val, extractPrice);
          }
        }
      }
    }
  }

  // Merge into baseOptions, applying same-price filter
  return baseOptions.map((opt) => {
    const resolved = optionPriceMaps.get(opt.name);
    if (!resolved || resolved.size === 0) return opt;

    const merged: Record<string, string> = { ...(opt.prices ?? {}) };
    for (const [value, price] of resolved) {
      merged[value] = price;
    }

    // Same-price filter: if all prices are identical, omit
    const uniquePrices = new Set(Object.values(merged));
    if (uniquePrices.size <= 1) return { ...opt, prices: undefined };

    return { ...opt, prices: merged };
  });
}

// ---- Step 3: Crawl fallback for variant pricing ----

function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

async function resolveVariantPricesViaCrawl(
  url: string,
  apiKey: string,
  baseOptions: ProductOption[],
  baseName: string,
): Promise<ProductOption[]> {
  const crawled = await firecrawlCrawlAsync(url, apiKey, 120_000);
  if (!crawled || crawled.length === 0) return baseOptions;

  // Filter crawled pages: keep only those with similar product name, non-empty price, different URL
  const relevant = crawled.filter((page) => {
    if (!page.name || !page.price) return false;
    // Similar product name (word overlap heuristic)
    return computeWordOverlap(page.name, baseName) >= 0.3;
  });

  if (relevant.length === 0) return baseOptions;

  // Build per-option price maps from relevant pages
  const optionPriceMaps = new Map<string, Map<string, string>>();

  for (const page of relevant) {
    if (!page.price) continue;
    const pagePrice = stripCurrencySymbol(page.price);
    const pageOptions = page.options ?? [];

    for (const baseOpt of baseOptions) {
      const matchOpt = pageOptions.find(
        (po) => po.name.toLowerCase() === baseOpt.name.toLowerCase(),
      );
      if (!matchOpt) continue;

      for (const val of matchOpt.values) {
        if (baseOpt.values.includes(val)) {
          if (!optionPriceMaps.has(baseOpt.name)) {
            optionPriceMaps.set(baseOpt.name, new Map());
          }
          const priceMap = optionPriceMaps.get(baseOpt.name)!;
          if (!priceMap.has(val)) {
            priceMap.set(val, pagePrice);
          }
        }
      }
    }
  }

  // Merge with same-price filter
  return baseOptions.map((opt) => {
    const resolved = optionPriceMaps.get(opt.name);
    if (!resolved || resolved.size === 0) return opt;

    const merged: Record<string, string> = { ...(opt.prices ?? {}) };
    for (const [value, price] of resolved) {
      merged[value] = price;
    }

    const uniquePrices = new Set(Object.values(merged));
    if (uniquePrices.size <= 1) return { ...opt, prices: undefined };

    return { ...opt, prices: merged };
  });
}

// ---- Tier 2: Firecrawl 3-step discovery pipeline ----

export async function discoverViaFirecrawl(
  url: string,
): Promise<FullDiscoveryResult | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;

  try {
    // Step 1: /extract on product URL
    const results = await firecrawlExtractAsync([url], apiKey, 60_000);
    if (!results?.[0]?.name || !results[0]?.price) return null;
    const extract = results[0];

    let options = mapOptions(extract.options);

    // Step 2 or 3 — only if options exist
    if (options.length > 0) {
      const hasVariantUrls =
        extract.variant_urls && extract.variant_urls.length > 0;
      if (hasVariantUrls) {
        // Step 2: /extract on each variant URL
        options = await resolveVariantPricesViaFirecrawl(
          extract.variant_urls!,
          url,
          apiKey,
          options,
        );
      } else {
        // Step 3: /crawl from product URL
        options = await resolveVariantPricesViaCrawl(
          url,
          apiKey,
          options,
          extract.name!,
        );
      }
    }

    return {
      name: extract.name!,
      price: stripCurrencySymbol(extract.price!),
      image_url: extract.image_url,
      method: "firecrawl",
      options,
      original_price: extract.original_price
        ? stripCurrencySymbol(extract.original_price)
        : undefined,
      currency: extract.currency,
      description: extract.description,
      brand: extract.brand,
    };
  } catch {
    return null;
  }
}

// ---- Main discovery entry point: Firecrawl → Scrape → Browserbase ----

export async function discoverProduct(
  url: string,
): Promise<FullDiscoveryResult> {
  // Tier 1: Firecrawl (rich data + per-variant pricing)
  const firecrawled = await discoverViaFirecrawl(url);
  if (firecrawled) return firecrawled;

  // Tier 2: Server-side scrape (free, fast)
  const scraped = await scrapePriceWithOptions(url);
  if (scraped) {
    return {
      name: scraped.name,
      price: scraped.price,
      image_url: scraped.image_url,
      method: scraped.method,
      options: scraped.options,
    };
  }

  // Tier 3: Browserbase headless Chrome + LLM extract
  const browsered = await discoverViaBrowser(url);
  if (browsered) return browsered;

  throw new BloonError(
    ErrorCodes.QUERY_FAILED,
    `Product discovery failed for ${url}: no structured data found`,
  );
}
