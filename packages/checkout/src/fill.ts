import type { Page } from "@browserbasehq/stagehand";

// ---- Field observed by Stagehand ----

export interface ObservedField {
  selector: string;
  description: string;
  fieldName?: string;
}

// ---- Map Stagehand field descriptions to credential keys ----

const FIELD_PATTERNS: Array<{ pattern: RegExp; credentialKey: string }> = [
  { pattern: /card\s*number/i, credentialKey: "x_card_number" },
  { pattern: /expir/i, credentialKey: "x_card_expiry" },
  { pattern: /cvv|cvc|security\s*code/i, credentialKey: "x_card_cvv" },
  {
    pattern: /cardholder|name\s*on\s*card/i,
    credentialKey: "x_cardholder_name",
  },
];

export function mapFieldToCredential(description: string): string | null {
  for (const { pattern, credentialKey } of FIELD_PATTERNS) {
    if (pattern.test(description)) {
      return credentialKey;
    }
  }
  return null;
}

// ---- Fill a single card field via Stagehand Page CDP ----

/**
 * Fills a single card field. Handles iframe-based selectors (e.g. Shopify's
 * PCI-compliant card inputs) by splitting the xpath at the iframe boundary
 * and navigating into the iframe's contentFrame.
 */
export async function fillCardField(
  page: Page,
  field: ObservedField,
  value: string,
): Promise<void> {
  const sel = field.selector;

  // Check if selector crosses an iframe boundary
  const iframeMatch = sel.match(/^(xpath=.+?\/iframe\[\d+\])\/(html.+)$/i);
  if (iframeMatch) {
    const iframeSel = iframeMatch[1]!;
    const innerPath = `xpath=/${iframeMatch[2]}`;

    // Locate the iframe element and get its content frame
    const iframeHandle = page.locator(iframeSel);
    const frame = await (iframeHandle as unknown as { contentFrame(): Promise<typeof page> }).contentFrame();
    if (frame) {
      await frame.locator(innerPath).fill(value);
      return;
    }
  }

  // Non-iframe selector — fill directly
  await page.locator(sel).fill(value);
}

// ---- Fill all card fields from observed fields ----

export async function fillAllCardFields(
  page: Page,
  observedFields: ObservedField[],
  cdpCredentials: Record<string, string>,
): Promise<void> {
  for (const field of observedFields) {
    const desc = field.fieldName || field.description;
    const credKey = mapFieldToCredential(desc);
    if (credKey && credKey in cdpCredentials) {
      await fillCardField(page, field, cdpCredentials[credKey]!);
    }
  }
}
