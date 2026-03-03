import type { ProductOption } from "@bloon/core";

export function extractPriceFromString(text: string): string | null {
  const cleaned = text.trim();
  // Try European decimal format first: "47,49", "47,49 €"
  const euroMatch = /(\d+),(\d{1,2})(?!\d)/.exec(cleaned);
  if (euroMatch) return `${euroMatch[1]}.${euroMatch[2]}`;
  // US/standard format: "98.00", "$98.00", "1,234.56"
  const stdCleaned = cleaned.replace(/,/g, "");
  const stdMatch = /\d+\.?\d*/.exec(stdCleaned);
  return stdMatch ? stdMatch[0] : null;
}

export function stripCurrencySymbol(price: string): string {
  // Extract the first price-like value, handling European comma decimals
  const extracted = extractPriceFromString(price);
  if (extracted) return extracted;
  // Fallback: strip non-numeric except dots
  return price.replace(/^[^\d]*/, "").replace(/[^\d.]/g, "") || price;
}

export function mapOptions(
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

export function computeWordOverlap(a: string, b: string): number {
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
