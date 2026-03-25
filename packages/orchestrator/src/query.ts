import {
  type QueryResponse,
  type RichProductInfo,
  type RequiredField,
  type ProductOption,
  BloonError,
  ErrorCodes,
  generateId,
  createQueryResult,
} from "@bloon/core";
import { classifyUrl, discoverWithStrategy } from "@bloon/crawling";

export interface QueryInput {
  url: string;
}

// ---- Standard shipping fields ----

export const STANDARD_SHIPPING_FIELDS: readonly RequiredField[] = [
  { field: "shipping.name", label: "Full name" },
  { field: "shipping.email", label: "Email address" },
  { field: "shipping.phone", label: "Phone number" },
  { field: "shipping.street", label: "Street address" },
  { field: "shipping.apartment", label: "Apartment / Floor / Suite" },
  { field: "shipping.city", label: "City" },
  { field: "shipping.state", label: "State / Province" },
  { field: "shipping.zip", label: "ZIP / Postal code" },
  { field: "shipping.country", label: "Country" },
];

// ---- Required fields builder (shared with search-query) ----

export function buildRequiredFields(options: readonly ProductOption[]): RequiredField[] {
  const fields = [...STANDARD_SHIPPING_FIELDS];
  if (options.length > 0) {
    const optionNames = options.map((o) => o.name).join(", ");
    fields.push({ field: "selections", label: `Product options (${optionNames})` });
  }
  return fields;
}

export async function query(input: QueryInput): Promise<QueryResponse> {
  const { url } = input;

  // 1. Validate URL
  try {
    new URL(url);
  } catch {
    throw new BloonError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`);
  }

  // 2. Discover product info (strategy-aware routing)
  const strategy = classifyUrl(url);
  let discovery;
  try {
    discovery = await discoverWithStrategy(url, strategy);
  } catch (e) {
    if (e instanceof BloonError) throw e;
    throw new BloonError(
      ErrorCodes.QUERY_FAILED,
      `Product discovery failed for ${url}: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  if (!discovery) {
    throw new BloonError(
      ErrorCodes.QUERY_FAILED,
      `Product discovery failed for ${url}: no structured data found`,
    );
  }

  // 3. Build required fields
  const requiredFields = buildRequiredFields(discovery.options);

  const product: RichProductInfo = {
    name: discovery.name,
    url,
    price: discovery.price,
    image_url: discovery.image_url,
    original_price: discovery.original_price,
    currency: discovery.currency,
    brand: discovery.brand,
  };

  const queryId = generateId("qry");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 min

  await createQueryResult({
    query_id: queryId,
    product,
    options: discovery.options,
    discovery_method: discovery.method,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  return {
    query_id: queryId,
    product,
    options: discovery.options,
    required_fields: requiredFields,
    discovery_method: discovery.method,
  };
}
