/**
 * Search orchestrator for natural language product queries.
 * Parses NL input → calls Exa search → filters/scores → returns top 5.
 */

import {
  type SearchQueryResponse,
  type SearchProductResult,
  BloonError,
  ErrorCodes,
} from "@bloon/core";
import {
  parseSearchQuery,
  searchProducts,
  type ExaSearchResult,
} from "@bloon/crawling";
import { buildRequiredFields } from "./query.js";

export interface SearchQueryInput {
  readonly query: string;
}

const MAX_RESULTS = 5;

// ---- Scoring ----

function computeCompletenessBonus(result: ExaSearchResult): number {
  let bonus = 0;
  if (result.image_url) bonus += 0.03;
  if (result.options.length > 0) bonus += 0.02;
  if (result.brand) bonus += 0.02;
  if (result.original_price) bonus += 0.01;
  return bonus;
}

function scoreResult(result: ExaSearchResult): number {
  return result.relevance_score + computeCompletenessBonus(result);
}

// ---- Price filtering ----

function passesFilter(
  price: string,
  minPrice?: number,
  maxPrice?: number,
): boolean {
  const num = parseFloat(price);
  if (!Number.isFinite(num)) return false;
  if (minPrice !== undefined && num < minPrice) return false;
  if (maxPrice !== undefined && num > maxPrice) return false;
  return true;
}

// ---- Main entry point ----

export async function searchQuery(
  input: SearchQueryInput,
): Promise<SearchQueryResponse> {
  const rawQuery = input.query.trim();

  if (rawQuery.length < 2) {
    throw new BloonError(
      ErrorCodes.MISSING_FIELD,
      "Search query must be at least 2 characters",
    );
  }

  // 1. Parse NL query
  const parsed = parseSearchQuery(rawQuery);

  if (parsed.cleanedTerms.length < 2) {
    throw new BloonError(
      ErrorCodes.MISSING_FIELD,
      "Search query must contain meaningful search terms",
    );
  }

  // 2. Search via Exa
  let results: readonly ExaSearchResult[];
  try {
    results = await searchProducts(parsed.cleanedTerms, {
      includeDomains: parsed.domains.length > 0 ? parsed.domains : undefined,
      numResults: 15,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("EXA_API_KEY not set")) {
      throw new BloonError(
        ErrorCodes.SEARCH_UNAVAILABLE,
        "Search service is not configured (EXA_API_KEY missing)",
      );
    }
    if (message.includes("429") || message.includes("rate limit")) {
      throw new BloonError(
        ErrorCodes.SEARCH_RATE_LIMITED,
        "Search rate limit exceeded, try again later",
      );
    }

    throw new BloonError(
      ErrorCodes.SEARCH_UNAVAILABLE,
      `Search failed: ${message}`,
    );
  }

  // 3. Filter by price constraints
  const filtered = results.filter((r) =>
    passesFilter(r.price, parsed.minPrice, parsed.maxPrice),
  );

  if (filtered.length === 0) {
    throw new BloonError(
      ErrorCodes.SEARCH_NO_RESULTS,
      `No products found for "${rawQuery}"`,
    );
  }

  // 4. Score and rank
  const scored = filtered
    .map((r) => ({ result: r, score: scoreResult(r) }))
    .sort((a, b) => b.score - a.score);

  // 5. Take top N
  const top = scored.slice(0, MAX_RESULTS);

  // 6. Build response
  const products: SearchProductResult[] = top.map(({ result, score }) => ({
    product: {
      name: result.name,
      url: result.url,
      price: result.price,
      original_price: result.original_price,
      currency: result.currency,
      brand: result.brand,
      image_url: result.image_url,
    },
    options: [...result.options],
    required_fields: buildRequiredFields(result.options),
    route: "browserbase" as const,
    discovery_method: "exa_search",
    relevance_score: Math.round(score * 100) / 100,
  }));

  const priceFilter =
    parsed.minPrice !== undefined || parsed.maxPrice !== undefined
      ? { min: parsed.minPrice, max: parsed.maxPrice }
      : undefined;

  return {
    type: "search",
    query: rawQuery,
    products,
    search_metadata: {
      total_found: products.length,
      domain_filter:
        parsed.domains.length > 0 ? [...parsed.domains] : undefined,
      price_filter: priceFilter,
    },
  };
}
