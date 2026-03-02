import { type PaymentRoute, BloonError, ErrorCodes } from "./types.js";

const MAX_PRICE = 25;

interface Decimal {
  value: bigint;
  scale: number;
}

/** Fee rate numerators (denominator is 1000) */
const FEE_RATES: Record<PaymentRoute, bigint> = {
  x402: 20n,         // 2%
  browserbase: 20n,  // 2%
};

function parseDecimal(s: string): Decimal {
  const parts = s.split(".");
  const intPart = parts[0]!;
  const fracPart = parts[1] ?? "";
  const scale = fracPart.length;
  const value = BigInt(intPart + fracPart);
  return { value, scale };
}

function formatDecimal(d: Decimal, minScale = 0): string {
  if (d.scale === 0 && minScale === 0) {
    return d.value.toString();
  }
  const scale = Math.max(d.scale, minScale);
  const padded = scale - d.scale;
  const scaledValue = padded > 0 ? d.value * 10n ** BigInt(padded) : d.value;
  const raw = scaledValue.toString().padStart(scale + 1, "0");
  const intPart = raw.slice(0, raw.length - scale);
  let fracPart = raw.slice(raw.length - scale);
  // Strip trailing zeros, but keep at least minScale digits
  if (minScale > 0) {
    const keep = fracPart.slice(0, minScale);
    const rest = fracPart.slice(minScale).replace(/0+$/, "");
    fracPart = keep + rest;
  } else {
    fracPart = fracPart.replace(/0+$/, "");
  }
  if (fracPart.length === 0) {
    return intPart;
  }
  return `${intPart}.${fracPart}`;
}

/** Align two decimals to the same scale (the larger one) */
function align(a: Decimal, b: Decimal): [Decimal, Decimal] {
  if (a.scale === b.scale) return [a, b];
  if (a.scale > b.scale) {
    const diff = a.scale - b.scale;
    return [a, { value: b.value * 10n ** BigInt(diff), scale: a.scale }];
  }
  const diff = b.scale - a.scale;
  return [{ value: a.value * 10n ** BigInt(diff), scale: b.scale }, b];
}

function addDecimals(a: Decimal, b: Decimal): Decimal {
  const [aa, bb] = align(a, b);
  return { value: aa.value + bb.value, scale: aa.scale };
}

/**
 * Calculate fee for a given price and route.
 * Uses BigInt arithmetic to avoid floating point.
 *
 * Rounding rule: if fee >= 0.01, round UP (ceiling) to 2 decimal places.
 * Otherwise output exact.
 */
export function calculateFee(price: string, route: PaymentRoute): string {
  const priceNum = Number(price);
  if (priceNum > MAX_PRICE) {
    throw new BloonError(
      ErrorCodes.PRICE_EXCEEDS_LIMIT,
      `Price $${price} exceeds maximum of $${MAX_PRICE}`
    );
  }

  const p = parseDecimal(price);
  const rate = FEE_RATES[route];

  // fee = price * rate / 1000
  // We compute feeExact = p.value * rate at scale = p.scale + 3
  const feeValue = p.value * rate;
  const feeScale = p.scale + 3;

  const fee: Decimal = { value: feeValue, scale: feeScale };

  // Check if fee >= 0.01 (i.e., value >= 10^(scale-2))
  const threshold = 10n ** BigInt(feeScale - 2);

  if (fee.value >= threshold) {
    // Round UP to 2 decimal places
    // To round to 2dp: we need to divide by 10^(scale-2), ceiling, then scale=2
    const divisor = 10n ** BigInt(feeScale - 2);
    const quotient = fee.value / divisor;
    const remainder = fee.value % divisor;
    const rounded = remainder > 0n ? quotient + 1n : quotient;
    return formatDecimal({ value: rounded, scale: 2 }, 2);
  }

  return formatDecimal(fee);
}

/**
 * Calculate total = price + fee
 */
export function calculateTotal(price: string, route: PaymentRoute): string {
  const fee = calculateFee(price, route);
  const p = parseDecimal(price);
  const f = parseDecimal(fee);
  const total = addDecimals(p, f);
  return formatDecimal(total);
}
