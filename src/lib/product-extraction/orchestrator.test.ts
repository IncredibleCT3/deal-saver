import assert from "node:assert/strict";
import test from "node:test";
import type { AiProfiler } from "./ai-profiler";
import type { BrowserRenderer } from "./browser-renderer";
import { resolveProduct, type ProductExtractionRuntime } from "./orchestrator";
import { createTemplateKey } from "./profile-match";
import type { ProfileRecipeV1 } from "./profile-schema";
import { MemoryProfileRepository } from "./profile-repository";
import { ProductExtractionError } from "./types";

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
    image: null,
    canonicalUrl: {
      strategy: "canonical",
      selector: null,
      key: null,
      attribute: "href",
    },
  },
  evidenceSelectors: ["main.product-detail"],
  confidence: 0.9,
};

function productPage(url: string, name: string, price: string) {
  return `<!doctype html><html><head>
    <link rel="canonical" href="${url}">
    <meta property="product:price:currency" content="USD">
    </head><body><main class="product-detail">
      <h1 class="product-title">${name}</h1>
      <p class="current-price">$${price}</p>
    </main></body></html>`;
}

test("a learned candidate is reused without a second AI call", async () => {
  const repository = new MemoryProfileRepository(true);
  let aiCalls = 0;
  const aiProfiler: AiProfiler = {
    configured: true,
    model: "gpt-5.6-luna",
    async generateProfile(request) {
      aiCalls += 1;
      return {
        recipe,
        model: this.model,
        inputChars: request.reducedPage.length,
        inputTokens: 500,
        outputChars: 500,
        outputTokens: 150,
      };
    },
  };
  const browserRenderer: BrowserRenderer = {
    configured: false,
    async render() {
      throw new Error("Browser rendering should not run in this test.");
    },
  };
  const runtime: ProductExtractionRuntime = {
    repository,
    aiProfiler,
    browserRenderer,
    async fetchHtml(value) {
      const url = new URL(value);
      const second = url.pathname.endsWith("second");
      return {
        finalUrl: url,
        html: productPage(
          url.href,
          second ? "Second Widget" : "First Widget",
          second ? "29.99" : "19.99",
        ),
      };
    },
  };

  const first = await resolveProduct(
    "https://shop.example/products/first",
    { requestedBy: null },
    runtime,
  );
  const second = await resolveProduct(
    "https://shop.example/products/second",
    { requestedBy: null },
    runtime,
  );

  assert.equal(first.diagnostics.extractionMethod, "ai_profile");
  assert.equal(first.diagnostics.aiProfilerCalled, true);
  assert.equal(first.diagnostics.profileStatus, "candidate");
  assert.equal(second.product.name, "Second Widget");
  assert.equal(second.diagnostics.extractionMethod, "saved_profile");
  assert.equal(second.diagnostics.aiProfilerCalled, false);
  assert.equal(aiCalls, 1);
  assert.equal(repository.profiles[0]?.status, "verified");
  assert.equal(repository.aiRuns.length, 1);
});

test("browser generic extraction runs only after static extraction fails", async () => {
  const repository = new MemoryProfileRepository(true);
  let browserCalls = 0;
  let aiCalls = 0;
  const runtime: ProductExtractionRuntime = {
    repository,
    async fetchHtml(value) {
      return {
        finalUrl: new URL(value),
        html: "<!doctype html><html><body><div id=\"app\"></div><script type=\"module\" src=\"/app.js\"></script></body></html>",
      };
    },
    browserRenderer: {
      configured: true,
      async render() {
        browserCalls += 1;
        return {
          browserMilliseconds: 300,
          html: `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(
            {
              "@type": "Product",
              name: "Rendered Widget",
              offers: { price: "39.99", priceCurrency: "USD" },
            },
          )}</script></head><body></body></html>`,
        };
      },
    },
    aiProfiler: {
      configured: true,
      model: "gpt-5.6-luna",
      async generateProfile() {
        aiCalls += 1;
        throw new Error("AI should not run after rendered generic extraction.");
      },
    },
  };

  const result = await resolveProduct(
    "https://shop.example/products/rendered",
    { requestedBy: null },
    runtime,
  );

  assert.equal(result.product.name, "Rendered Widget");
  assert.equal(result.diagnostics.extractionMethod, "browser_generic");
  assert.equal(result.diagnostics.browserMilliseconds, 300);
  assert.equal(browserCalls, 1);
  assert.equal(aiCalls, 0);
});

test("AI does not profile an application shell after browser rendering fails", async () => {
  let aiCalls = 0;
  const runtime: ProductExtractionRuntime = {
    repository: new MemoryProfileRepository(true),
    async fetchHtml(value) {
      return {
        finalUrl: new URL(value),
        httpStatus: 200,
        html: "<!doctype html><html><body><div id=\"app\"></div><script type=\"module\" src=\"/app.js\"></script></body></html>",
      };
    },
    browserRenderer: {
      configured: true,
      async render() {
        throw new Error("The browser provider failed.");
      },
    },
    aiProfiler: {
      configured: true,
      model: "gpt-5.6-luna",
      async generateProfile() {
        aiCalls += 1;
        throw new Error("AI must not receive an application shell.");
      },
    },
  };

  await assert.rejects(
    resolveProduct(
      "https://shop.example/products/shell",
      { requestedBy: null },
      runtime,
    ),
    /deterministic extraction method/i,
  );
  assert.equal(aiCalls, 0);
});

test("an explicit denial page never invokes browser rendering or AI", async () => {
  let browserCalls = 0;
  let aiCalls = 0;
  const runtime: ProductExtractionRuntime = {
    repository: new MemoryProfileRepository(true),
    async fetchHtml(value) {
      return {
        finalUrl: new URL(value),
        html: "<!doctype html><html><title>Access denied</title><body>Verify that you are human. CAPTCHA</body></html>",
      };
    },
    browserRenderer: {
      configured: true,
      async render() {
        browserCalls += 1;
        throw new Error("Browser must not run for denial pages.");
      },
    },
    aiProfiler: {
      configured: true,
      model: "gpt-5.6-luna",
      async generateProfile() {
        aiCalls += 1;
        throw new Error("AI must not run for denial pages.");
      },
    },
  };

  await assert.rejects(
    resolveProduct(
      "https://shop.example/products/blocked",
      { requestedBy: null },
      runtime,
    ),
    /access-denial page/i,
  );
  assert.equal(browserCalls, 0);
  assert.equal(aiCalls, 0);
});

test("profile and acquisition failure counters use bounded thresholds", async () => {
  const repository = new MemoryProfileRepository(true);
  const profile = await repository.saveCandidate({
    domain: "shop.example",
    recipe,
    acquisitionMethod: "static_fetch",
  });

  await repository.recordProfileFailure(profile);
  assert.equal(profile.status, "candidate");
  await repository.recordProfileFailure(profile);
  assert.equal(profile.status, "degraded");

  await repository.recordAcquisitionFailure("shop.example", "source_unavailable");
  await repository.recordAcquisitionFailure("shop.example", "source_unavailable");
  assert.equal(
    (await repository.getAcquisitionState("shop.example"))?.preferredMethod,
    "static_fetch",
  );
  await repository.recordAcquisitionFailure("shop.example", "source_unavailable");
  assert.equal(
    (await repository.getAcquisitionState("shop.example"))?.preferredMethod,
    "server_fetch_blocked",
  );
});

test("one profile failure does not call AI, but a repeated failure can repair it", async () => {
  const repository = new MemoryProfileRepository(true);
  const brokenRecipe: ProfileRecipeV1 = {
    ...recipe,
    fields: {
      ...recipe.fields,
      name: { ...recipe.fields.name, selector: ".old-product-title" },
    },
  };
  repository.profiles.push({
    id: "profile-v1",
    domain: "shop.example",
    templateKey: createTemplateKey("shop.example", "/products/*"),
    urlPattern: "/products/*",
    pageType: "single_product",
    acquisitionMethod: "static_fetch",
    requiresBrowser: false,
    recipe: brokenRecipe,
    confidence: 0.9,
    status: "verified",
    successCount: 4,
    failureCount: 0,
    consecutiveFailureCount: 0,
    version: 1,
  });
  let aiCalls = 0;
  const runtime: ProductExtractionRuntime = {
    repository,
    browserRenderer: {
      configured: false,
      async render() {
        throw new Error("Browser is not configured.");
      },
    },
    aiProfiler: {
      configured: true,
      model: "gpt-5.6-luna",
      async generateProfile(request) {
        aiCalls += 1;
        return {
          recipe,
          model: this.model,
          inputChars: request.reducedPage.length,
          inputTokens: 400,
          outputChars: 450,
          outputTokens: 130,
        };
      },
    },
    async fetchHtml(value) {
      return {
        finalUrl: new URL(value),
        html: productPage(value, "Redesigned Widget", "54.99"),
      };
    },
  };

  await assert.rejects(
    resolveProduct(
      "https://shop.example/products/redesigned",
      { requestedBy: null },
      runtime,
    ),
  );
  assert.equal(aiCalls, 0);

  const repaired = await resolveProduct(
    "https://shop.example/products/redesigned",
    { requestedBy: null },
    runtime,
  );
  assert.equal(repaired.diagnostics.extractionMethod, "ai_profile");
  assert.equal(repaired.product.name, "Redesigned Widget");
  assert.equal(aiCalls, 1);
  assert.equal(repository.profiles[0]?.status, "degraded");
  assert.equal(repository.profiles[1]?.version, 2);
});

test("a locally rejected AI profile is recorded and retried once", async () => {
  const repository = new MemoryProfileRepository(true);
  let aiCalls = 0;
  const runtime: ProductExtractionRuntime = {
    repository,
    browserRenderer: {
      configured: false,
      async render() {
        throw new Error("Browser rendering should not run in this test.");
      },
    },
    aiProfiler: {
      configured: true,
      model: "gpt-5.6-luna",
      async generateProfile(request) {
        aiCalls += 1;
        if (aiCalls === 1) {
          throw new ProductExtractionError(
            "unsupported_product",
            "The structured AI output did not pass the allowlisted profile schema.",
            undefined,
            {
              aiOutcome: "rejected",
              inputChars: request.reducedPage.length,
              inputTokens: 300,
              outputChars: 200,
              outputTokens: 80,
            },
          );
        }

        return {
          recipe,
          model: this.model,
          inputChars: request.reducedPage.length,
          inputTokens: 320,
          outputChars: 220,
          outputTokens: 90,
        };
      },
    },
    async fetchHtml(value) {
      return {
        finalUrl: new URL(value),
        html: productPage(value, "Retry Widget", "64.99"),
      };
    },
  };

  const result = await resolveProduct(
    "https://shop.example/products/retry",
    { requestedBy: null },
    runtime,
  );

  assert.equal(result.product.name, "Retry Widget");
  assert.equal(aiCalls, 2);
  assert.equal(repository.aiRuns.length, 2);
  assert.equal(repository.aiRuns[0]?.outcome, "rejected");
  assert.equal(repository.aiRuns[0]?.inputTokens, 300);
  assert.equal(repository.aiRuns[0]?.outputTokens, 80);
  assert.equal(repository.aiRuns[0]?.outputChars, 200);
  assert.equal(repository.aiRuns[1]?.outcome, "validated");
  assert.equal(result.diagnostics.pipeline.aiInputTokens, 620);
  assert.equal(result.diagnostics.pipeline.aiOutputTokens, 170);
});
