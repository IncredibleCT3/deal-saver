import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeProfile } from "./profile-execute";
import { findMatchingProfile, matchesUrlPattern } from "./profile-match";
import {
  parseProfileRecipe,
  type ProfileRecipeV1,
  type StoredProfile,
} from "./profile-schema";
import { reducePageForProfiling } from "./reduce-page";
import {
  hasExplicitAccessDenial,
  hasUsableProfilingContent,
} from "./page-analysis";

const recipe: ProfileRecipeV1 = {
  schemaVersion: 1,
  pageType: "single_product",
  priceKind: "exact",
  urlPattern: "/products/*",
  requiresBrowser: false,
  fields: {
    name: {
      strategy: "selector",
      selector: "h1.product-title",
      key: null,
      attribute: "textContent",
    },
    price: {
      strategy: "selector",
      selector: ".current-price",
      key: null,
      attribute: "textContent",
    },
    currency: {
      strategy: "meta",
      selector: null,
      key: "product:price:currency",
      attribute: "content",
    },
    image: {
      strategy: "selector",
      selector: ".product-image",
      key: null,
      attribute: "src",
    },
    canonicalUrl: {
      strategy: "canonical",
      selector: null,
      key: null,
      attribute: "href",
    },
  },
  evidenceSelectors: ["main.product-detail"],
  confidence: 0.88,
};

const html = `<!doctype html><html><head>
  <link rel="canonical" href="https://shop.example/products/widget">
  <meta property="og:site_name" content="Example Shop">
  <meta property="product:price:currency" content="CAD">
  </head><body>
  <main class="product-detail">
    <h1 class="product-title">Example Widget</h1>
    <p class="current-price">CAD $24.99</p>
    <img class="product-image" src="https://cdn.example/widget.jpg">
  </main></body></html>`;

describe("declarative extraction profiles", () => {
  it("validates and executes an allowlisted profile", () => {
    assert.deepEqual(parseProfileRecipe(recipe), recipe);
    assert.deepEqual(
      executeProfile(recipe, html, "https://shop.example/products/widget"),
      {
        name: "Example Widget",
        currentPrice: "24.99",
        currency: "CAD",
        imageUrl: "https://cdn.example/widget.jpg",
        sourceName: "Example Shop",
        sourceDomain: "shop.example",
        canonicalUrl: "https://shop.example/products/widget",
        productType: "single_product",
        priceKind: "exact",
        confidence: 0.88,
      },
    );
  });

  it("rejects unsafe, executable, broad, or field-inappropriate recipes", () => {
    const examples = [
      {
        ...recipe,
        fields: {
          ...recipe.fields,
          name: { ...recipe.fields.name, selector: "script" },
        },
      },
      { ...recipe, urlPattern: "/*" },
      {
        ...recipe,
        fields: {
          ...recipe.fields,
          canonicalUrl: {
            strategy: "selector",
            selector: "a",
            key: null,
            attribute: "href",
          },
        },
      },
      { ...recipe, executableCode: "return document.body" },
    ];

    for (const example of examples) {
      assert.equal(parseProfileRecipe(example), null);
    }
  });

  it("requires independently visible evidence for starting prices", () => {
    const familyRecipe: ProfileRecipeV1 = {
      ...recipe,
      pageType: "product_family",
      priceKind: "starting_at",
    };

    assert.throws(() =>
      executeProfile(
        familyRecipe,
        html.replace(
          "</head>",
          '<script type="application/ld+json">{"@type":"Product","name":"Unrelated","offers":{"@type":"AggregateOffer","lowPrice":"5","priceCurrency":"CAD"}}</script></head>',
        ),
        "https://shop.example/products/widget",
      ),
    );
  });
});

describe("profile matching", () => {
  const baseProfile: StoredProfile = {
    id: "profile-1",
    domain: "shop.example",
    templateKey: "template",
    urlPattern: "/products/*",
    pageType: "single_product",
    acquisitionMethod: "static_fetch",
    requiresBrowser: false,
    recipe,
    confidence: 0.88,
    status: "candidate",
    successCount: 1,
    failureCount: 0,
    consecutiveFailureCount: 0,
    version: 1,
  };

  it("matches one path segment and never crosses domains", () => {
    assert.equal(matchesUrlPattern("/products/widget", "/products/*"), true);
    assert.equal(
      matchesUrlPattern("/products/widgets/blue", "/products/*"),
      false,
    );
    assert.equal(
      findMatchingProfile(
        new URL("https://other.example/products/widget"),
        [baseProfile],
      ),
      null,
    );
  });

  it("prefers a verified profile over a candidate", () => {
    const verified = {
      ...baseProfile,
      id: "verified",
      status: "verified" as const,
    };
    assert.equal(
      findMatchingProfile(
        new URL("https://shop.example/products/widget"),
        [baseProfile, verified],
      )?.id,
      "verified",
    );
  });
});

describe("AI page reduction", () => {
  it("removes active/unrelated content and enforces the hard input bound", () => {
    const reduced = reducePageForProfiling(
      `<html><body><nav>${"menu ".repeat(2_000)}</nav><main class="product"><h1>Widget</h1><p>$19.99</p></main><script>alert(1)</script>${"x".repeat(10_000)}</body></html>`,
      new URL("https://shop.example/products/widget"),
      5_000,
    );

    assert.ok(reduced.content.length <= 5_000);
    assert.doesNotMatch(reduced.content, /alert\(1\)|menu menu/);
    assert.match(reduced.content, /Widget/);
  });
});

describe("access-denial detection", () => {
  it("detects short denial pages without treating a long incidental mention as denial", () => {
    assert.equal(
      hasExplicitAccessDenial(
        "<html><title>Access denied</title><body>Verify that you are human. CAPTCHA</body></html>",
      ),
      true,
    );
    assert.equal(
      hasExplicitAccessDenial(
        "<html><title>Let us know you're not a robot</title><body></body></html>",
      ),
      true,
    );
    assert.equal(
      hasExplicitAccessDenial(
        `<html><title>Widget</title><body><h1>Widget</h1>${"product details ".repeat(500)}Supports CAPTCHA-compatible sign-in tools.</body></html>`,
      ),
      false,
    );
  });

  it("profiles short product content but not empty shells or denial pages", () => {
    assert.equal(
      hasUsableProfilingContent(
        "<html><body><main><h1>Widget</h1><p class='price'>$19.99</p></main></body></html>",
      ),
      true,
    );
    assert.equal(
      hasUsableProfilingContent(
        "<html><body><div id='app'></div><script src='/app.js'></script></body></html>",
      ),
      false,
    );
    assert.equal(
      hasUsableProfilingContent(
        "<html><title>Let us know you're not a robot</title><body></body></html>",
      ),
      false,
    );
  });
});
