import * as cheerio from "cheerio";
import { embeddedProductCandidates } from "./embedded-json";
import {
  defaultSourceName,
  normalizeCurrency,
  normalizeName,
  normalizePrice,
  normalizeSourceName,
  sourceDomain,
} from "./normalization";
import { ProductExtractionError, type NormalizedProduct } from "./types";
import {
  normalizeEmbeddedHttpsUrl,
  validateProductUrl,
} from "./url-safety";

type JsonRecord = Record<string, unknown>;
type Selection = ReturnType<cheerio.CheerioAPI>;

export type GenericExtractionStrategy =
  | "jsonld"
  | "microdata"
  | "semantic_metadata"
  | "embedded_json"
  | "visible_product_region";

export type GenericExtraction = {
  product: NormalizedProduct;
  strategy: GenericExtractionStrategy;
};

type PriceEvidence = {
  amount: string;
  currency: string;
  priceKind: "exact" | "starting_at";
  productType: "single_product" | "product_family";
};

type ProductCandidate = {
  name: unknown;
  price: PriceEvidence | null;
  imageValues: string[];
  urlValue?: string;
  confidence: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function schemaTypeName(value: string) {
  const parts = value.split(/[\/#]/);
  return parts[parts.length - 1]?.toLowerCase();
}

function hasSchemaType(value: JsonRecord, expectedType: string) {
  const expected = expectedType.toLowerCase();

  return asArray(value["@type"]).some(
    (type) => typeof type === "string" && schemaTypeName(type) === expected,
  );
}

function imageCandidates(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(imageCandidates);
  }

  if (!isRecord(value)) {
    return [];
  }

  return [value.url, value.contentUrl].flatMap(imageCandidates);
}

function flattenJsonLdNodes(value: unknown, nodes: JsonRecord[]) {
  if (Array.isArray(value)) {
    value.forEach((entry) => flattenJsonLdNodes(entry, nodes));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  nodes.push(value);
  flattenJsonLdNodes(value["@graph"], nodes);
}

function jsonLdNodes($: cheerio.CheerioAPI) {
  const nodes: JsonRecord[] = [];

  for (const element of $("script").toArray()) {
    if (
      $(element).attr("type")?.trim().toLowerCase() !== "application/ld+json"
    ) {
      continue;
    }

    const contents = $(element).text().trim();

    if (!contents) {
      continue;
    }

    try {
      flattenJsonLdNodes(JSON.parse(contents), nodes);
    } catch {
      // A malformed JSON-LD block does not invalidate other structured data.
    }
  }

  return nodes;
}

function recordId(value: JsonRecord) {
  return typeof value["@id"] === "string" ? value["@id"] : null;
}

function referenceId(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return isRecord(value) ? recordId(value) : null;
}

function expandOffers(
  value: unknown,
  nodesById: Map<string, JsonRecord>,
  seen = new Set<JsonRecord>(),
): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => expandOffers(entry, nodesById, seen));
  }

  if (typeof value === "string") {
    const referenced = nodesById.get(value);
    return referenced ? expandOffers(referenced, nodesById, seen) : [];
  }

  if (!isRecord(value) || seen.has(value)) {
    return [];
  }

  seen.add(value);
  const id = recordId(value);
  const referenced = id ? nodesById.get(id) : null;

  if (
    referenced &&
    referenced !== value &&
    value.price === undefined &&
    value.lowPrice === undefined &&
    value.priceSpecification === undefined &&
    value.offers === undefined
  ) {
    return expandOffers(referenced, nodesById, seen);
  }

  const nested = expandOffers(value.offers, nodesById, seen);
  const hasDirectPrice =
    value.price !== undefined ||
    value.lowPrice !== undefined ||
    value.priceSpecification !== undefined;

  return hasDirectPrice ? [value, ...nested] : nested;
}

function productOffers(
  product: JsonRecord,
  products: JsonRecord[],
  nodes: JsonRecord[],
  nodesById: Map<string, JsonRecord>,
) {
  const direct = expandOffers(product.offers, nodesById);

  if (direct.length > 0) {
    return direct;
  }

  const productId = recordId(product);
  const productSku =
    typeof product.sku === "string" || typeof product.sku === "number"
      ? String(product.sku)
      : null;
  const standaloneOffers = nodes.filter(
    (node) =>
      hasSchemaType(node, "Offer") || hasSchemaType(node, "AggregateOffer"),
  );
  const linkedOffers = standaloneOffers.filter((offer) => {
    const itemOfferedId = referenceId(offer.itemOffered);
    const offerSku =
      typeof offer.sku === "string" || typeof offer.sku === "number"
        ? String(offer.sku)
        : null;

    return (
      (productId && itemOfferedId === productId) ||
      (productSku && offerSku === productSku)
    );
  });

  if (linkedOffers.length > 0) {
    return linkedOffers.flatMap((offer) => expandOffers(offer, nodesById));
  }

  if (products.length === 1 && standaloneOffers.length === 1) {
    return expandOffers(standaloneOffers[0], nodesById);
  }

  return [];
}

function exactOfferPrices(offer: JsonRecord) {
  const condition =
    typeof offer.itemCondition === "string" ? offer.itemCondition : null;

  if (condition && schemaTypeName(condition) !== "newcondition") {
    return [];
  }

  const values: Array<{ price: unknown; currency: unknown }> = [
    { price: offer.price, currency: offer.priceCurrency },
  ];

  for (const specification of asArray(offer.priceSpecification)) {
    if (isRecord(specification)) {
      values.push({
        price: specification.price,
        currency: specification.priceCurrency ?? offer.priceCurrency,
      });
    }
  }

  return values.flatMap(({ price, currency }) => {
    const amount = normalizePrice(price);
    const currencyCode = normalizeCurrency(currency);

    return amount && currencyCode
      ? [
          {
            amount,
            currency: currencyCode,
            priceKind: "exact" as const,
            productType: "single_product" as const,
          },
        ]
      : [];
  });
}

function aggregateOfferPrices(offer: JsonRecord) {
  if (!hasSchemaType(offer, "AggregateOffer") && offer.lowPrice === undefined) {
    return [];
  }

  const amount = normalizePrice(offer.lowPrice);
  const currency = normalizeCurrency(offer.priceCurrency);

  return amount && currency
    ? [
        {
          amount,
          currency,
          priceKind: "starting_at" as const,
          productType: "product_family" as const,
        },
      ]
    : [];
}

function uniquePriceEvidence(values: PriceEvidence[]) {
  const unique = [
    ...new Map(
      values.map((value) => [
        `${value.amount}|${value.currency}|${value.priceKind}|${value.productType}`,
        value,
      ]),
    ).values(),
  ];

  if (unique.length > 1) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The product page exposed multiple conflicting prices.",
    );
  }

  return unique[0] ?? null;
}

function jsonLdPrice(
  product: JsonRecord,
  products: JsonRecord[],
  nodes: JsonRecord[],
  nodesById: Map<string, JsonRecord>,
) {
  const offers = productOffers(product, products, nodes, nodesById);
  const productSku =
    typeof product.sku === "string" || typeof product.sku === "number"
      ? String(product.sku)
      : null;
  const matchingOffers = productSku
    ? offers.filter((offer) => {
        const offerSku =
          typeof offer.sku === "string" || typeof offer.sku === "number"
            ? String(offer.sku)
            : null;
        return offerSku === productSku;
      })
    : [];
  const offersHaveSkus = offers.some(
    (offer) =>
      typeof offer.sku === "string" || typeof offer.sku === "number",
  );
  const consideredOffers =
    productSku && offersHaveSkus ? matchingOffers : offers;
  const aggregatePrices = consideredOffers.flatMap(aggregateOfferPrices);

  return uniquePriceEvidence(
    aggregatePrices.length > 0
      ? aggregatePrices
      : consideredOffers.flatMap(exactOfferPrices),
  );
}

function selectionValue(selection: Selection) {
  if (selection.length === 0) {
    return null;
  }

  for (const attribute of ["content", "value", "href", "src"]) {
    const value = selection.attr(attribute)?.trim();

    if (value) {
      return value;
    }
  }

  const text = selection.text().trim();
  return text || null;
}

function metaValues($: cheerio.CheerioAPI, keys: string[]) {
  const expected = new Set(keys.map((key) => key.toLowerCase()));

  return $("meta")
    .toArray()
    .flatMap((element) => {
      const selection = $(element);
      const key = (selection.attr("property") ?? selection.attr("name"))
        ?.trim()
        .toLowerCase();
      const value = selection.attr("content")?.trim();

      return key && value && expected.has(key) ? [value] : [];
    });
}

function firstMetaValue($: cheerio.CheerioAPI, keys: string[]) {
  return metaValues($, keys)[0] ?? null;
}

function canonicalLink($: cheerio.CheerioAPI) {
  for (const element of $("link[rel]").toArray()) {
    const selection = $(element);
    const relationships = selection.attr("rel")?.toLowerCase().split(/\s+/);

    if (relationships?.includes("canonical")) {
      return selection.attr("href");
    }
  }

  return undefined;
}

function semanticMetadata($: cheerio.CheerioAPI) {
  const productType = firstMetaValue($, ["og:type"])?.toLowerCase();
  const pricePairs = [
    ["product:price:amount", "product:price:currency"],
    ["og:price:amount", "og:price:currency"],
  ] as const;
  const prices = pricePairs.flatMap(([priceKey, currencyKey]) => {
    const currencies = [
      ...new Set(metaValues($, [currencyKey]).map(normalizeCurrency)),
    ].filter((value): value is string => Boolean(value));

    if (currencies.length !== 1) {
      return [];
    }

    return metaValues($, [priceKey]).flatMap((price) => {
      const amount = normalizePrice(price);
      return amount
        ? [
            {
              amount,
              currency: currencies[0],
              priceKind: "exact" as const,
              productType: "single_product" as const,
            },
          ]
        : [];
    });
  });
  const hasProductSignal =
    productType === "product" ||
    productType?.startsWith("product.") ||
    prices.length > 0;
  const name =
    firstMetaValue($, ["og:title", "twitter:title"]) ??
    $("title").first().text();
  const imageValues = metaValues($, [
    "og:image:secure_url",
    "og:image",
    "twitter:image",
  ]);
  const sourceName = firstMetaValue($, ["og:site_name"]);

  return { hasProductSignal, name, prices, imageValues, sourceName };
}

function normalizeCandidate(
  candidate: ProductCandidate,
  $: cheerio.CheerioAPI,
  finalUrl: URL,
): NormalizedProduct | null {
  const name = normalizeName(candidate.name);

  if (!name || !candidate.price) {
    return null;
  }

  const imageUrl =
    candidate.imageValues
      .map((value) => normalizeEmbeddedHttpsUrl(value, finalUrl))
      .find((value): value is string => Boolean(value)) ?? null;
  const domain = sourceDomain(finalUrl);

  if (!domain) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The product source hostname could not be normalized.",
    );
  }

  const semantic = semanticMetadata($);
  const sourceName =
    normalizeSourceName(semantic.sourceName) ?? defaultSourceName(finalUrl);
  const candidateCanonical = candidate.urlValue
    ? normalizeEmbeddedHttpsUrl(candidate.urlValue, finalUrl, {
        sameHostname: true,
      })
    : null;
  const documentCanonical = canonicalLink($);
  const linkedCanonical = documentCanonical
    ? normalizeEmbeddedHttpsUrl(documentCanonical, finalUrl, {
        sameHostname: true,
      })
    : null;

  return {
    name,
    currentPrice: candidate.price.amount,
    currency: candidate.price.currency,
    imageUrl,
    sourceName,
    sourceDomain: domain,
    canonicalUrl: candidateCanonical ?? linkedCanonical ?? finalUrl.href,
    productType: candidate.price.productType,
    priceKind: candidate.price.priceKind,
    confidence: candidate.confidence,
  };
}

function singleCandidate(candidates: NormalizedProduct[]) {
  const unique = new Map<string, NormalizedProduct>();

  for (const candidate of candidates) {
    const signature = JSON.stringify({ ...candidate, confidence: undefined });
    const existing = unique.get(signature);

    if (!existing || candidate.confidence > existing.confidence) {
      unique.set(signature, candidate);
    }
  }

  if (unique.size > 1) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The page exposed multiple conflicting products.",
    );
  }

  return [...unique.values()][0] ?? null;
}

function extractJsonLd(
  $: cheerio.CheerioAPI,
  finalUrl: URL,
): NormalizedProduct | null {
  const nodes = jsonLdNodes($);
  const products = nodes.filter(
    (node) =>
      hasSchemaType(node, "Product") || hasSchemaType(node, "ProductGroup"),
  );
  const nodesById = new Map<string, JsonRecord>();
  const semantic = semanticMetadata($);

  for (const node of nodes) {
    const id = recordId(node);

    if (id) {
      nodesById.set(id, node);
    }
  }

  const candidates = products.flatMap((product) => {
    const structuredPrice = jsonLdPrice(
      product,
      products,
      nodes,
      nodesById,
    );
    if (
      hasSchemaType(product, "ProductGroup") &&
      structuredPrice?.priceKind !== "starting_at"
    ) {
      return [];
    }
    const candidate = normalizeCandidate(
      {
        name: product.name ?? semantic.name,
        price: structuredPrice ?? uniquePriceEvidence(semantic.prices),
        imageValues: [
          ...imageCandidates(product.image),
          ...semantic.imageValues,
        ],
        urlValue: typeof product.url === "string" ? product.url : undefined,
        confidence: structuredPrice ? 0.96 : 0.86,
      },
      $,
      finalUrl,
    );

    return candidate ? [candidate] : [];
  });

  return singleCandidate(candidates);
}

function microdataPrices($: cheerio.CheerioAPI, scope: Selection) {
  const startingValues: PriceEvidence[] = [];

  for (const element of scope.find("[itemprop~='lowPrice']").toArray()) {
    const selection = $(element);
    const owner = selection.closest("[itemscope]");
    const currencyValue = selectionValue(
      owner.find("[itemprop~='priceCurrency']").first(),
    );
    const amount = normalizePrice(selectionValue(selection));
    const currency = normalizeCurrency(currencyValue);

    if (amount && currency) {
      startingValues.push({
        amount,
        currency,
        priceKind: "starting_at",
        productType: "product_family",
      });
    }
  }

  if (startingValues.length > 0) {
    return uniquePriceEvidence(startingValues);
  }

  const exactValues: PriceEvidence[] = [];

  for (const element of scope.find("[itemprop~='price']").toArray()) {
    const selection = $(element);
    const owner = selection.closest("[itemscope]");
    const currencyValue = selectionValue(
      owner.find("[itemprop~='priceCurrency']").first(),
    );
    const amount = normalizePrice(selectionValue(selection));
    const currency = normalizeCurrency(currencyValue);

    if (amount && currency) {
      exactValues.push({
        amount,
        currency,
        priceKind: "exact",
        productType: "single_product",
      });
    }
  }

  return uniquePriceEvidence(exactValues);
}

function extractMicrodata(
  $: cheerio.CheerioAPI,
  finalUrl: URL,
): NormalizedProduct | null {
  const semantic = semanticMetadata($);
  const scopes = $("[itemscope][itemtype]")
    .toArray()
    .filter((element) => {
      const itemTypes = $(element).attr("itemtype")?.split(/\s+/) ?? [];
      return itemTypes.some((itemType) => {
        const name = schemaTypeName(itemType);
        return name === "product" || name === "productgroup";
      });
    });
  const candidates = scopes.flatMap((element) => {
    const scope = $(element);
    const name = selectionValue(scope.find("[itemprop~='name']").first());
    const image = selectionValue(scope.find("[itemprop~='image']").first());
    const url = selectionValue(scope.find("[itemprop~='url']").first());
    const structuredPrice = microdataPrices($, scope);
    const isProductGroup = (scope.attr("itemtype")?.split(/\s+/) ?? []).some(
      (itemType) => schemaTypeName(itemType) === "productgroup",
    );

    if (isProductGroup && structuredPrice?.priceKind !== "starting_at") {
      return [];
    }
    const candidate = normalizeCandidate(
      {
        name: name ?? semantic.name,
        price: structuredPrice ?? uniquePriceEvidence(semantic.prices),
        imageValues: [
          ...(image ? [image] : []),
          ...semantic.imageValues,
        ],
        urlValue: url ?? undefined,
        confidence: structuredPrice ? 0.9 : 0.82,
      },
      $,
      finalUrl,
    );

    return candidate ? [candidate] : [];
  });

  return singleCandidate(candidates);
}

function extractSemanticMetadata(
  $: cheerio.CheerioAPI,
  finalUrl: URL,
) {
  const semantic = semanticMetadata($);

  if (!semantic.hasProductSignal || semantic.prices.length === 0) {
    return null;
  }

  return normalizeCandidate(
    {
      name: semantic.name,
      price: uniquePriceEvidence(semantic.prices),
      imageValues: semantic.imageValues,
      confidence: 0.82,
    },
    $,
    finalUrl,
  );
}

function extractEmbeddedJson(
  $: cheerio.CheerioAPI,
  finalUrl: URL,
) {
  const candidates = embeddedProductCandidates($).flatMap((embedded) => {
    const amount = normalizePrice(embedded.price);
    const currency = normalizeCurrency(embedded.currency);

    if (!amount || !currency) {
      return [];
    }

    const candidate = normalizeCandidate(
      {
        name: embedded.name,
        price: {
          amount,
          currency,
          priceKind: embedded.startingPrice ? "starting_at" : "exact",
          productType: embedded.startingPrice
            ? "product_family"
            : "single_product",
        },
        imageValues: imageCandidates(embedded.image),
        urlValue: typeof embedded.url === "string" ? embedded.url : undefined,
        confidence: 0.78,
      },
      $,
      finalUrl,
    );

    return candidate ? [candidate] : [];
  });

  return singleCandidate(candidates);
}

type VisiblePriceCandidate = {
  amount: string;
  currency: string;
  score: number;
};

const VISIBLE_PRICE_PATTERN =
  /(?:(current\s+price(?:\s+is)?|price\s*:|now)\s*)?(?:([A-Z]{3})\s*)?\$\s*((?:0|[1-9]\d{0,5})(?:,\d{3})*(?:\.\d{2})?)/gi;
const EXCLUDED_PRICE_CONTEXT =
  /\b(?:unit price|per (?:item|unit|oz|ounce|lb|pound|count)|save|savings|shipping|delivery|was|original price|list price|regular price|compare at|monthly|financ(?:e|ing)|payment|installment|coupon)\b|\/(?:mo|month|oz|lb)\b/i;

function dollarCurrency($: cheerio.CheerioAPI, explicit: string | undefined) {
  if (explicit) {
    return normalizeCurrency(explicit);
  }

  const language = $("html").attr("lang")?.trim().toLowerCase();
  const locale = firstMetaValue($, ["og:locale"])?.replace("_", "-").toLowerCase();
  return language === "en-us" || locale === "en-us" ? "USD" : null;
}

function priceSemanticDescriptor(selection: Selection) {
  const parent = selection.parent();
  return [
    selection.attr("id"),
    selection.attr("class"),
    selection.attr("data-testid"),
    selection.attr("data-automation-id"),
    selection.attr("aria-label"),
    parent.attr("id"),
    parent.attr("class"),
    parent.attr("data-testid"),
  ]
    .filter(Boolean)
    .join(" ");
}

function visiblePriceCandidates(
  $: cheerio.CheerioAPI,
  region: Selection,
  heading: Selection,
) {
  const elements = region.find("*").addBack().toArray();
  const headingElement = heading.get(0);
  const headingIndex = headingElement ? elements.indexOf(headingElement) : -1;
  const candidates: VisiblePriceCandidate[] = [];

  for (const element of elements) {
    const selection = $(element);
    const ariaLabel = selection.attr("aria-label")?.trim();
    const hasElementChildren = selection.children().length > 0;
    const values = [
      ...(ariaLabel ? [ariaLabel] : []),
      ...(!hasElementChildren ? [selection.text()] : []),
    ]
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter((value) => value.length > 0 && value.length <= 160);

    for (const text of values) {
      if (EXCLUDED_PRICE_CONTEXT.test(text)) {
        continue;
      }

      const matches = [...text.matchAll(VISIBLE_PRICE_PATTERN)];
      if (matches.length !== 1) {
        continue;
      }

      const match = matches[0];
      const label = match[1]?.toLowerCase() ?? "";
      const currency = dollarCurrency($, match[2]);
      const amount = normalizePrice(match[3]);
      const descriptor = priceSemanticDescriptor(selection);
      const hasPriceSemantic = /\b(?:current-?)?price\b|offer|cost/i.test(
        descriptor,
      );

      if (!currency || !amount || (!label && !hasPriceSemantic)) {
        continue;
      }

      let score = label.startsWith("current price")
        ? 100
        : label.startsWith("price")
          ? 95
          : label === "now"
            ? 90
            : match[2]
              ? 82
              : 72;
      const elementIndex = elements.indexOf(element);
      if (headingIndex >= 0 && elementIndex >= 0) {
        score -= Math.min(15, Math.floor(Math.abs(elementIndex - headingIndex) / 20));
      }

      candidates.push({ amount, currency, score });
    }
  }

  const uniqueByPrice = new Map<string, VisiblePriceCandidate>();
  for (const candidate of candidates.sort(
    (left, right) => right.score - left.score,
  )) {
    const key = `${candidate.amount}|${candidate.currency}`;
    if (!uniqueByPrice.has(key)) {
      uniqueByPrice.set(key, candidate);
    }
  }
  const unique = [...uniqueByPrice.values()];
  const best = unique[0];

  if (
    !best ||
    unique.some(
      (candidate) =>
        candidate !== best &&
        candidate.score >= best.score - 5 &&
        candidate.amount !== best.amount,
    )
  ) {
    return null;
  }

  return best;
}

function closestProductRegionWithPrice(
  $: cheerio.CheerioAPI,
  heading: Selection,
) {
  let region = heading.parent();

  for (let depth = 0; depth < 8 && region.length > 0; depth += 1) {
    const element = region.get(0);
    const tagName = element && "tagName" in element ? element.tagName : null;
    if (!element || tagName === "html" || tagName === "body") {
      break;
    }

    const price = visiblePriceCandidates($, region, heading);
    if (price) {
      return { region, price };
    }

    region = region.parent();
  }

  return null;
}

function extractVisibleProductRegion(
  $: cheerio.CheerioAPI,
  finalUrl: URL,
) {
  const headings = [
    ...new Map(
      $("h1")
        .toArray()
        .flatMap((element) => {
          const selection = $(element);
          const name = normalizeName(selection.text());
          return name ? [[name, { selection, name }] as const] : [];
        }),
    ).values(),
  ];

  if (headings.length !== 1) {
    return null;
  }

  const heading = headings[0];
  const match = closestProductRegionWithPrice($, heading.selection);
  if (!match) {
    return null;
  }

  const semantic = semanticMetadata($);
  const localImages = match.region
    .find("img")
    .toArray()
    .flatMap((element) => {
      const selection = $(element);
      return [selection.attr("src"), selection.attr("data-src")].filter(
        (value): value is string => Boolean(value),
      );
    });

  return normalizeCandidate(
    {
      name: heading.name,
      price: {
        amount: match.price.amount,
        currency: match.price.currency,
        priceKind: "exact",
        productType: "single_product",
      },
      imageValues: [...semantic.imageValues, ...localImages],
      confidence: match.price.score >= 90 ? 0.84 : 0.78,
    },
    $,
    finalUrl,
  );
}

export function extractProductWithStrategy(
  html: string,
  finalUrlValue: string | URL,
): GenericExtraction {
  const finalUrl = validateProductUrl(finalUrlValue);
  const $ = cheerio.load(html);
  const strategies: Array<
    [
      GenericExtractionStrategy,
      () => NormalizedProduct | null,
    ]
  > = [
    ["jsonld", () => extractJsonLd($, finalUrl)],
    ["microdata", () => extractMicrodata($, finalUrl)],
    ["semantic_metadata", () => extractSemanticMetadata($, finalUrl)],
    ["embedded_json", () => extractEmbeddedJson($, finalUrl)],
    ["visible_product_region", () => extractVisibleProductRegion($, finalUrl)],
  ];

  for (const [strategy, extract] of strategies) {
    const product = extract();

    if (product) {
      return { product, strategy };
    }
  }

  throw new ProductExtractionError(
    "unsupported_product",
    "The page did not expose one complete product with an explicit currency and reliable price.",
  );
}

export function extractProductFromHtml(
  html: string,
  finalUrlValue: string | URL,
) {
  return extractProductWithStrategy(html, finalUrlValue).product;
}
