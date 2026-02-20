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

export async function fillCardField(
  page: Page,
  field: ObservedField,
  value: string,
): Promise<void> {
  await page.locator(field.selector).fill(value);
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
