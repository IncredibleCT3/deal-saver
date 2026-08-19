import * as cheerio from "cheerio";

const DENIAL_PATTERNS = [
  { name: "access-denied", pattern: /access denied/i },
  { name: "request-blocked", pattern: /request (?:has been )?blocked/i },
  {
    name: "human-verification",
    pattern: /verify (?:that )?you are (?:a )?human/i,
  },
  { name: "not-a-robot", pattern: /(?:you(?:'re| are)|i(?:'m| am)) not a robot/i },
  { name: "captcha", pattern: /captcha/i },
  { name: "unusual-traffic", pattern: /unusual traffic/i },
  { name: "automated-access", pattern: /automated (?:access|requests)/i },
];

export function accessDenialSignals(html: string) {
  const $ = cheerio.load(html);
  $("script, style, svg, noscript").remove();
  const title = $("title").text().replace(/\s+/g, " ").trim();
  const visibleText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
  const titleMatches = DENIAL_PATTERNS.filter(({ pattern }) =>
    pattern.test(title),
  ).map(({ name }) => `title:${name}`);
  const bodyMatches = DENIAL_PATTERNS.filter(({ pattern }) =>
    pattern.test(visibleText),
  ).map(({ name }) => `body:${name}`);
  const denied =
    titleMatches.length > 0 ||
    bodyMatches.length >= 2 ||
    (visibleText.length < 5_000 && bodyMatches.length === 1);

  return denied ? [...new Set([...titleMatches, ...bodyMatches])] : [];
}

export function hasExplicitAccessDenial(html: string) {
  return accessDenialSignals(html).length > 0;
}

export function looksLikeApplicationShell(html: string) {
  const $ = cheerio.load(html);
  const scriptCount = $("script[src], script[type='module']").length;
  $("script, style, svg, noscript").remove();
  const visibleText = $("body").text().replace(/\s+/g, " ").trim();
  const hasMeaningfulHeading = $("h1, [itemprop~='name']").length > 0;

  return (
    visibleText.length < 400 ||
    (!hasMeaningfulHeading && visibleText.length < 1_500 && scriptCount >= 3)
  );
}

export function hasUsableProfilingContent(html: string) {
  if (hasExplicitAccessDenial(html)) {
    return false;
  }

  const $ = cheerio.load(html);
  const heading = $("h1").first().text().replace(/\s+/g, " ").trim();
  const hasProductMetadata =
    $("[itemtype*='schema.org/Product'], [itemtype*='schema.org/product']")
      .length > 0 ||
    $("meta[property='og:type'][content^='product' i]").length > 0;
  const hasPriceMetadata =
    $(
      "[itemprop~='price'], [itemprop~='lowPrice'], meta[property='product:price:amount'], meta[property='og:price:amount']",
    ).length > 0;
  $("script, style, svg, noscript").remove();
  const visibleText = $("body").text().replace(/\s+/g, " ").trim();
  const hasVisiblePrice =
    /(?:\b(?:current\s+price|price\s*:|now)\s*(?:is\s*)?)?(?:[A-Z]{3}\s*)?\$\s*\d{1,6}(?:[,.]\d{2})?/i.test(
      visibleText,
    );

  return (
    heading.length > 0 &&
    heading.length <= 200 &&
    (hasProductMetadata || hasPriceMetadata || hasVisiblePrice)
  );
}
