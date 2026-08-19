import type {
  AcquisitionMethod,
  PriceKind,
  ProductType,
} from "./types";

const MAX_SELECTOR_LENGTH = 200;
const MAX_PATTERN_LENGTH = 300;
const ALLOWED_RULE_KEYS = ["strategy", "selector", "key", "attribute"];

export type ProfileStatus =
  | "candidate"
  | "verified"
  | "degraded"
  | "disabled";

export type ProfileFieldRule = {
  strategy: "selector" | "meta" | "canonical";
  selector: string | null;
  key: string | null;
  attribute: string | null;
};

export type ProfileRecipeV1 = {
  schemaVersion: 1;
  pageType: ProductType;
  priceKind: PriceKind;
  urlPattern: string;
  requiresBrowser: boolean;
  fields: {
    name: ProfileFieldRule;
    price: ProfileFieldRule;
    currency: ProfileFieldRule;
    image: ProfileFieldRule | null;
    canonicalUrl: ProfileFieldRule;
  };
  evidenceSelectors: string[];
  confidence: number;
};

export type StoredProfile = {
  id: string;
  domain: string;
  templateKey: string;
  urlPattern: string;
  pageType: ProductType;
  acquisitionMethod: AcquisitionMethod;
  requiresBrowser: boolean;
  recipe: ProfileRecipeV1;
  confidence: number;
  status: ProfileStatus;
  successCount: number;
  failureCount: number;
  consecutiveFailureCount: number;
  version: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isSafeSelector(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SELECTOR_LENGTH ||
    /[,{};]/.test(value) ||
    /:(?:has|contains|matches|not)\s*\(/i.test(value) ||
    /(^|[\s>+~])(script|style|iframe|object|embed)(?=$|[\s>+~.#[:])/i.test(
      value,
    ) ||
    /(^|[\s>+~])\*(?=$|[\s>+~.#[:])/i.test(value)
  ) {
    return false;
  }

  const combinators = value.match(/[>+~]|\s+/g)?.length ?? 0;
  return combinators <= 12;
}

function isSafeAttribute(value: unknown) {
  return (
    value === null ||
    value === "textContent" ||
    value === "content" ||
    value === "href" ||
    value === "src" ||
    value === "value" ||
    value === "aria-label" ||
    (typeof value === "string" && /^data-[a-z0-9_-]{1,50}$/i.test(value))
  );
}

export function isSafeUrlPattern(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    value !== "/*" &&
    value.length <= MAX_PATTERN_LENGTH &&
    !/[?#\\]/.test(value) &&
    /^[a-zA-Z0-9/_.*~%+@:-]+$/.test(value) &&
    (value.match(/\*/g)?.length ?? 0) <= 5
  );
}

function isSafeEvidenceSelector(value: unknown): value is string {
  return (
    isSafeSelector(value) &&
    !/^(?:html|body|main|article|section|div)$/i.test(value) &&
    /[.#\[]|itemprop|itemtype|data-/i.test(value)
  );
}

function parseFieldRule(value: unknown): ProfileFieldRule | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ALLOWED_RULE_KEYS) ||
    !["selector", "meta", "canonical"].includes(String(value.strategy)) ||
    !isSafeAttribute(value.attribute)
  ) {
    return null;
  }

  if (value.strategy === "selector") {
    return isSafeSelector(value.selector) && value.key === null
      ? {
          strategy: "selector",
          selector: value.selector,
          key: null,
          attribute: value.attribute as string | null,
        }
      : null;
  }

  if (value.strategy === "meta") {
    return value.selector === null &&
      typeof value.key === "string" &&
      /^[a-z0-9:_-]{1,100}$/i.test(value.key) &&
      (value.attribute === null || value.attribute === "content")
      ? {
          strategy: "meta",
          selector: null,
          key: value.key,
          attribute: "content",
        }
      : null;
  }

  return value.selector === null &&
    value.key === null &&
    (value.attribute === null || value.attribute === "href")
    ? {
        strategy: "canonical",
        selector: null,
        key: null,
        attribute: "href",
      }
    : null;
}

function ruleAllowedForField(
  field: "name" | "price" | "currency" | "image" | "canonicalUrl",
  rule: ProfileFieldRule,
) {
  if (field === "canonicalUrl") {
    return rule.strategy === "canonical";
  }

  if (rule.strategy === "canonical") {
    return false;
  }

  if (rule.strategy === "meta") {
    const key = rule.key?.toLowerCase();
    const allowedMetaKeys = {
      name: new Set(["og:title", "twitter:title"]),
      price: new Set(["product:price:amount", "og:price:amount"]),
      currency: new Set([
        "product:price:currency",
        "og:price:currency",
      ]),
      image: new Set([
        "og:image",
        "og:image:secure_url",
        "twitter:image",
      ]),
    } as const;

    return Boolean(key && allowedMetaKeys[field].has(key as never));
  }

  const attribute = rule.attribute ?? "textContent";
  const allowedSelectorAttributes = {
    name: new Set(["textContent", "aria-label"]),
    price: new Set([
      "textContent",
      "content",
      "value",
      "aria-label",
    ]),
    currency: new Set([
      "textContent",
      "content",
      "value",
      "aria-label",
    ]),
    image: new Set(["src", "content"]),
  } as const;

  return allowedSelectorAttributes[field].has(attribute as never);
}

export function parseProfileRecipe(value: unknown): ProfileRecipeV1 | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "pageType",
      "priceKind",
      "urlPattern",
      "requiresBrowser",
      "fields",
      "evidenceSelectors",
      "confidence",
    ]) ||
    value.schemaVersion !== 1 ||
    !["single_product", "product_family"].includes(String(value.pageType)) ||
    !["exact", "starting_at"].includes(String(value.priceKind)) ||
    !isSafeUrlPattern(value.urlPattern) ||
    typeof value.requiresBrowser !== "boolean" ||
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !isRecord(value.fields) ||
    !hasOnlyKeys(value.fields, [
      "name",
      "price",
      "currency",
      "image",
      "canonicalUrl",
    ]) ||
    !Array.isArray(value.evidenceSelectors) ||
    value.evidenceSelectors.length === 0 ||
    value.evidenceSelectors.length > 4 ||
    !value.evidenceSelectors.every(isSafeEvidenceSelector)
  ) {
    return null;
  }

  const name = parseFieldRule(value.fields.name);
  const price = parseFieldRule(value.fields.price);
  const currency = parseFieldRule(value.fields.currency);
  const image =
    value.fields.image === null ? null : parseFieldRule(value.fields.image);
  const canonicalUrl = parseFieldRule(value.fields.canonicalUrl);

  if (!name || !price || !currency || !canonicalUrl) {
    return null;
  }

  if (
    !ruleAllowedForField("name", name) ||
    !ruleAllowedForField("price", price) ||
    !ruleAllowedForField("currency", currency) ||
    (image && !ruleAllowedForField("image", image)) ||
    !ruleAllowedForField("canonicalUrl", canonicalUrl)
  ) {
    return null;
  }

  if (
    (value.pageType === "single_product" && value.priceKind !== "exact") ||
    (value.pageType === "product_family" && value.priceKind !== "starting_at")
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    pageType: value.pageType as ProductType,
    priceKind: value.priceKind as PriceKind,
    urlPattern: value.urlPattern,
    requiresBrowser: value.requiresBrowser,
    fields: { name, price, currency, image, canonicalUrl },
    evidenceSelectors: [...value.evidenceSelectors] as string[],
    confidence: value.confidence,
  };
}

const fieldRuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["strategy", "selector", "key", "attribute"],
  properties: {
    strategy: { type: "string", enum: ["selector", "meta", "canonical"] },
    selector: { type: ["string", "null"] },
    key: { type: ["string", "null"] },
    attribute: { type: ["string", "null"] },
  },
} as const;

export const PROFILE_RECIPE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "pageType",
    "priceKind",
    "urlPattern",
    "requiresBrowser",
    "fields",
    "evidenceSelectors",
    "confidence",
  ],
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    pageType: {
      type: "string",
      enum: ["single_product", "product_family"],
    },
    priceKind: { type: "string", enum: ["exact", "starting_at"] },
    urlPattern: { type: "string" },
    requiresBrowser: { type: "boolean" },
    fields: {
      type: "object",
      additionalProperties: false,
      required: ["name", "price", "currency", "image", "canonicalUrl"],
      properties: {
        name: fieldRuleSchema,
        price: fieldRuleSchema,
        currency: fieldRuleSchema,
        image: { anyOf: [fieldRuleSchema, { type: "null" }] },
        canonicalUrl: fieldRuleSchema,
      },
    },
    evidenceSelectors: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string" },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;
