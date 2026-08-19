import type * as cheerio from "cheerio";

const MAX_SCRIPT_BYTES = 250_000;
const MAX_TOTAL_BYTES = 750_000;
const MAX_DEPTH = 12;
const MAX_NODES = 10_000;

type JsonRecord = Record<string, unknown>;

export type EmbeddedProductCandidate = {
  name: unknown;
  price: unknown;
  currency: unknown;
  image: unknown;
  url: unknown;
  startingPrice: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstDefined(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }

  return undefined;
}

function priceAndCurrency(record: JsonRecord) {
  const startingPrice = firstDefined(record, [
    "lowPrice",
    "minPrice",
    "startingPrice",
  ]);
  const exactPrice = firstDefined(record, [
    "currentPrice",
    "salePrice",
    "price",
  ]);
  const priceValue = startingPrice ?? exactPrice;

  if (isRecord(priceValue)) {
    return {
      price: firstDefined(priceValue, ["amount", "value", "price"]),
      currency:
        firstDefined(priceValue, ["currency", "currencyCode", "priceCurrency"]) ??
        firstDefined(record, ["currency", "currencyCode", "priceCurrency"]),
      startingPrice: startingPrice !== undefined,
    };
  }

  return {
    price: priceValue,
    currency: firstDefined(record, [
      "currency",
      "currencyCode",
      "priceCurrency",
    ]),
    startingPrice: startingPrice !== undefined,
  };
}

function candidateFromRecord(
  record: JsonRecord,
  path: string,
): EmbeddedProductCandidate | null {
  const name = firstDefined(record, ["productName", "name", "title"]);
  const { price, currency, startingPrice } = priceAndCurrency(record);
  const image = firstDefined(record, [
    "image",
    "imageUrl",
    "primaryImage",
    "thumbnailUrl",
  ]);
  const url = firstDefined(record, ["productUrl", "canonicalUrl", "url"]);
  const hasProductSignal =
    /product|offer|variant|item/i.test(path) ||
    ["sku", "productId", "offers", "variants", "image", "productUrl"].some(
      (key) => record[key] !== undefined,
    );

  return name !== undefined &&
    price !== undefined &&
    currency !== undefined &&
    hasProductSignal
    ? { name, price, currency, image, url, startingPrice }
    : null;
}

function walkJson(
  root: unknown,
  candidates: EmbeddedProductCandidate[],
) {
  const stack: Array<{ value: unknown; depth: number; path: string }> = [
    { value: root, depth: 0, path: "$" },
  ];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_NODES) {
    const current = stack.pop();

    if (!current || current.depth > MAX_DEPTH) {
      continue;
    }

    visited += 1;

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current.value[index],
          depth: current.depth + 1,
          path: `${current.path}[${index}]`,
        });
      }
      continue;
    }

    if (!isRecord(current.value)) {
      continue;
    }

    const candidate = candidateFromRecord(current.value, current.path);

    if (candidate) {
      candidates.push(candidate);
    }

    for (const [key, value] of Object.entries(current.value)) {
      if (typeof value === "object" && value !== null) {
        stack.push({
          value,
          depth: current.depth + 1,
          path: `${current.path}.${key}`,
        });
      }
    }
  }
}

export function embeddedProductCandidates($: cheerio.CheerioAPI) {
  const candidates: EmbeddedProductCandidate[] = [];
  let totalBytes = 0;

  for (const element of $(
    "script[type='application/json'], script#__NEXT_DATA__, script#__APOLLO_STATE__",
  ).toArray()) {
    const contents = $(element).text().trim();
    const size = Buffer.byteLength(contents);

    if (
      !contents ||
      size > MAX_SCRIPT_BYTES ||
      totalBytes + size > MAX_TOTAL_BYTES
    ) {
      continue;
    }

    totalBytes += size;

    try {
      walkJson(JSON.parse(contents), candidates);
    } catch {
      // Ignore malformed or non-JSON application-state blocks.
    }
  }

  return candidates;
}
