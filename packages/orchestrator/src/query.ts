import {
  type QueryResponse,
  type RichProductInfo,
  type RequiredField,
  type ProductOption,
  BloonError,
  ErrorCodes,
} from "@bloon/core";
import { discoverProduct } from "@bloon/checkout";
import { routeOrder } from "./router.js";

export interface QueryInput {
  url: string;
}

// ---- Standard shipping fields ----

const STANDARD_SHIPPING_FIELDS: RequiredField[] = [
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

export async function query(input: QueryInput): Promise<QueryResponse> {
  const { url } = input;

  // 1. Validate URL
  try {
    new URL(url);
  } catch {
    throw new BloonError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`);
  }

  // 2. Route detection
  const decision = await routeOrder(url);

  // 3. x402: immediate return
  if (decision.route === "x402") {
    const price = decision.requirements?.maxAmountRequired ?? "0";
    const name = decision.requirements?.description ?? new URL(url).hostname;
    return {
      product: { name, url, price },
      options: [],
      required_fields: [],
      route: "x402",
      discovery_method: "x402",
    };
  }

  // 4. Discover product info
  let discovery;
  try {
    discovery = await discoverProduct(url);
  } catch (e) {
    if (e instanceof BloonError) throw e;
    throw new BloonError(
      ErrorCodes.QUERY_FAILED,
      `Product discovery failed for ${url}: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  // 5. Build required fields — always use standard shipping fields
  const requiredFields: RequiredField[] = [...STANDARD_SHIPPING_FIELDS];

  if (discovery.options.length > 0) {
    const optionNames = discovery.options.map((o: ProductOption) => o.name).join(", ");
    requiredFields.push({
      field: "selections",
      label: `Product options (${optionNames})`,
    });
  }

  const product: RichProductInfo = {
    name: discovery.name,
    url,
    price: discovery.price,
    image_url: discovery.image_url,
    original_price: discovery.original_price,
    currency: discovery.currency,
    brand: discovery.brand,
  };

  return {
    product,
    options: discovery.options,
    required_fields: requiredFields,
    route: "browserbase",
    discovery_method: discovery.method,
  };
}
