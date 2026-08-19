import { ProductExtractionError } from "./types";

export const MAX_NAME_LENGTH = 200;
export const MAX_SOURCE_NAME_LENGTH = 100;
export const MAX_DOMAIN_LENGTH = 253;
const PRICE_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const PRICE_IN_TEXT_PATTERN =
  /(?<![\d.])(?:\d{1,3}(?:,\d{3})+|\d{1,10})(?:\.\d{1,2})?(?![\d.])/g;
const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

export function normalizeName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
}

export function normalizeSourceName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim().replace(/\s+/g, " ");
  return name.length > 0 && name.length <= MAX_SOURCE_NAME_LENGTH
    ? name
    : null;
}

export function normalizePrice(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const price = String(value).trim().replaceAll(",", "");

  if (!PRICE_PATTERN.test(price)) {
    return null;
  }

  return Number(price).toFixed(2);
}

export function parsePriceText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  if (typeof value === "number") {
    return normalizePrice(value);
  }

  const matches = value.match(PRICE_IN_TEXT_PATTERN) ?? [];
  const prices = [
    ...new Set(
      matches.flatMap((match) => {
        const price = normalizePrice(match);
        return price ? [price] : [];
      }),
    ),
  ];

  return prices.length === 1 ? prices[0] : null;
}

export function normalizeCurrency(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const direct = value.trim().toUpperCase();

  if (SUPPORTED_CURRENCIES.has(direct)) {
    return direct;
  }

  const codes = [
    ...new Set(
      (direct.match(/\b[A-Z]{3}\b/g) ?? []).filter((code) =>
        SUPPORTED_CURRENCIES.has(code),
      ),
    ),
  ];

  return codes.length === 1 ? codes[0] : null;
}

export function uniqueValue<T>(values: T[], message: string): T | null {
  const unique = [...new Set(values)];

  if (unique.length > 1) {
    throw new ProductExtractionError("unsupported_product", message);
  }

  return unique[0] ?? null;
}

export function sourceDomain(url: URL) {
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

export function defaultSourceName(url: URL) {
  return sourceDomain(url).replace(/^www\./, "");
}

export function isStartingPriceText(value: string) {
  return /\b(?:starting\s+(?:at|from)|starts\s+at|from|as\s+low\s+as)\b/i.test(
    value,
  );
}
