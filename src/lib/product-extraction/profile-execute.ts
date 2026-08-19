import * as cheerio from "cheerio";
import {
  defaultSourceName,
  isStartingPriceText,
  normalizeCurrency,
  normalizeName,
  normalizeSourceName,
  parsePriceText,
  sourceDomain,
  uniqueValue,
} from "./normalization";
import type {
  ProfileFieldRule,
  ProfileRecipeV1,
} from "./profile-schema";
import { ProductExtractionError, type NormalizedProduct } from "./types";
import {
  normalizeEmbeddedHttpsUrl,
  validateProductUrl,
} from "./url-safety";

function readSelector(
  $: cheerio.CheerioAPI,
  rule: ProfileFieldRule,
) {
  if (!rule.selector) {
    return null;
  }

  let selection: ReturnType<cheerio.CheerioAPI>;

  try {
    selection = $(rule.selector);
  } catch {
    throw new ProductExtractionError(
      "unsupported_product",
      "The extraction profile contained an invalid selector.",
    );
  }

  const values = selection
    .toArray()
    .flatMap((element) => {
      const elementSelection = $(element);
      const value =
        !rule.attribute || rule.attribute === "textContent"
          ? elementSelection.text()
          : elementSelection.attr(rule.attribute);
      const normalized = value?.trim().replace(/\s+/g, " ");
      return normalized ? [normalized] : [];
    });

  return uniqueValue(
    values,
    "The extraction profile matched multiple conflicting values.",
  );
}

function readMeta($: cheerio.CheerioAPI, key: string | null) {
  if (!key) {
    return null;
  }

  const values = $("meta")
    .toArray()
    .flatMap((element) => {
      const selection = $(element);
      const candidateKey = (
        selection.attr("property") ?? selection.attr("name")
      )
        ?.trim()
        .toLowerCase();
      const value = selection.attr("content")?.trim();
      return candidateKey === key.toLowerCase() && value ? [value] : [];
    });

  return uniqueValue(
    values,
    "The extraction profile matched conflicting metadata values.",
  );
}

function readCanonical($: cheerio.CheerioAPI) {
  const values = $("link[rel]")
    .toArray()
    .flatMap((element) => {
      const selection = $(element);
      const rel = selection.attr("rel")?.toLowerCase().split(/\s+/) ?? [];
      const href = selection.attr("href")?.trim();
      return rel.includes("canonical") && href ? [href] : [];
    });

  return uniqueValue(
    values,
    "The page exposed multiple conflicting canonical URLs.",
  );
}

function readRule($: cheerio.CheerioAPI, rule: ProfileFieldRule) {
  switch (rule.strategy) {
    case "selector":
      return readSelector($, rule);
    case "meta":
      return readMeta($, rule.key);
    case "canonical":
      return readCanonical($);
  }
}

function hasProductEvidence(
  $: cheerio.CheerioAPI,
  selectors: string[],
) {
  return selectors.some((selector) => {
    try {
      return $(selector).length > 0;
    } catch {
      return false;
    }
  });
}

function hasIndependentStartingPriceEvidence(
  $: cheerio.CheerioAPI,
  priceText: string,
  priceRule: ProfileFieldRule,
) {
  if (isStartingPriceText(priceText)) {
    return true;
  }

  if (priceRule.strategy !== "selector" || !priceRule.selector) {
    return false;
  }

  try {
    return $(priceRule.selector)
      .toArray()
      .some((element) =>
        ($(element).attr("itemprop")?.split(/\s+/) ?? []).includes("lowPrice"),
      );
  } catch {
    return false;
  }
}

export function executeProfile(
  recipe: ProfileRecipeV1,
  html: string,
  finalUrlValue: string | URL,
): NormalizedProduct {
  const finalUrl = validateProductUrl(finalUrlValue);
  const $ = cheerio.load(html);

  if (!hasProductEvidence($, recipe.evidenceSelectors)) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The page no longer contains the profile's product evidence.",
    );
  }

  const rawName = readRule($, recipe.fields.name);
  const rawPrice = readRule($, recipe.fields.price);
  const rawCurrency = readRule($, recipe.fields.currency);
  const rawImage = recipe.fields.image
    ? readRule($, recipe.fields.image)
    : null;
  const rawCanonical = readRule($, recipe.fields.canonicalUrl);
  const name = normalizeName(rawName);
  const currentPrice = parsePriceText(rawPrice);
  const currency = normalizeCurrency(rawCurrency);

  if (!name || !currentPrice || !currency) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The extraction profile did not produce a complete product.",
    );
  }

  if (
    recipe.priceKind === "starting_at" &&
    !hasIndependentStartingPriceEvidence(
      $,
      rawPrice ?? "",
      recipe.fields.price,
    )
  ) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The profile's starting price was not supported by page evidence.",
    );
  }

  if (recipe.priceKind === "exact" && isStartingPriceText(rawPrice ?? "")) {
    throw new ProductExtractionError(
      "unsupported_product",
      "A starting price cannot be saved as an exact price.",
    );
  }

  const imageUrl = rawImage
    ? normalizeEmbeddedHttpsUrl(rawImage, finalUrl)
    : null;
  const canonicalUrl = rawCanonical
    ? normalizeEmbeddedHttpsUrl(rawCanonical, finalUrl, {
        sameHostname: true,
      })
    : null;
  const siteName = readMeta($, "og:site_name");

  return {
    name,
    currentPrice,
    currency,
    imageUrl,
    sourceName:
      normalizeSourceName(siteName) ?? defaultSourceName(finalUrl),
    sourceDomain: sourceDomain(finalUrl),
    canonicalUrl: canonicalUrl ?? finalUrl.href,
    productType: recipe.pageType,
    priceKind: recipe.priceKind,
    confidence: recipe.confidence,
  };
}
