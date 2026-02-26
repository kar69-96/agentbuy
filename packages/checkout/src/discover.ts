//Stagehand uses a 1288x711 viewport by default

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import type { ShippingInfo } from "@proxo/core";
import { createSession, destroySession, getAnthropicApiKey } from "./session.js";
import { sanitizeShipping } from "./credentials.js";

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

// ---- Tier 1: Server-side scrape (JSON-LD + meta tags) ----

export function extractJsonLd(
  html: string,
): Record<string, unknown> | null {
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

export function extractMetaTag(
  html: string,
  property: string,
): string | null {
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
  let cleaned = text.trim();
  // European decimal format: "4,95" → "4.95" (comma + 1-2 digits at end, no other commas)
  if (/^\d+,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const match = /[\d]+\.?\d*/.exec(cleaned);
  return match ? match[0] : null;
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

// ---- Tier 2: Browserbase cart discovery via Stagehand ----

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
  const anthropicApiKey = getAnthropicApiKey();
  const session = await createSession();
  let stagehand: InstanceType<typeof Stagehand> | undefined;

  try {
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY!,
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      model: {
        modelName: "anthropic/claude-haiku-4-5-20251001",
        apiKey: anthropicApiKey,
      },
      browserbaseSessionID: session.id,
    });

    await stagehand.init();
    const page = stagehand.context.activePage()!;

    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await page.waitForTimeout(2000);

    await stagehand.act("Add this product to cart");
    await page.waitForTimeout(1000);
    await stagehand.act("Go to cart or proceed to checkout");
    await page.waitForTimeout(2000);

    // Fill shipping if applicable (sanitize to prevent prompt injection)
    const safe = sanitizeShipping(shipping);
    try {
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
      await page.waitForTimeout(1000);
    } catch {
      // Shipping form may not be visible yet
    }

    const pricing = await stagehand.extract(
      "Extract the product name, price, tax, shipping cost, and order total from this cart/checkout page",
      CartPricingSchema,
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
    if (stagehand) {
      try {
        await stagehand.close();
      } catch {
        // Ignore close errors
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
