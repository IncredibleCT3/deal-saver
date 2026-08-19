import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OpenAiProfiler } from "./ai-profiler";
import { CloudflareBrowserRenderer } from "./browser-renderer";
import { parseBooleanFlag } from "./runtime-config";
import { ProductExtractionError } from "./types";

describe("runtime configuration", () => {
  it("accepts true case-insensitively with surrounding whitespace", () => {
    assert.equal(parseBooleanFlag("true"), true);
    assert.equal(parseBooleanFlag(" TRUE "), true);
    assert.equal(parseBooleanFlag("false"), false);
    assert.equal(parseBooleanFlag(undefined), false);
  });
});

describe("Cloudflare browser rendering adapter", () => {
  it("uses bounded content rendering without adding anti-bot behavior", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ result: "<!doctype html><html><body>ok</body></html>" }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-browser-ms-used": "250",
          },
        },
      );
    };
    const renderer = new CloudflareBrowserRenderer(
      "account",
      "token",
      fetchMock,
      true,
      async () => [{ address: "93.184.216.34", family: 4 }],
    );
    const result = await renderer.render(
      new URL("https://shop.example/products/widget"),
    );
    const requestBody = requests[0];

    assert.match(result.html, /<html>/);
    assert.equal(result.browserMilliseconds, 250);
    assert.equal(
      requestBody?.url,
      "https://shop.example/products/widget",
    );
    assert.deepEqual(
      requestBody?.rejectResourceTypes,
      ["image", "media", "font"],
    );
  });

  it("accepts a JSON-string response and falls back to measured wall time", async () => {
    const fetchMock: typeof fetch = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(
        JSON.stringify("<!doctype html><html><body>ok</body></html>"),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const renderer = new CloudflareBrowserRenderer(
      "account",
      "token",
      fetchMock,
      true,
      async () => [{ address: "93.184.216.34", family: 4 }],
    );
    const result = await renderer.render(
      new URL("https://shop.example/products/widget"),
    );

    assert.match(result.html, /<html>/);
    assert.ok((result.browserMilliseconds ?? 0) > 0);
  });

  it("includes DNS resolution in the browser timeout", async () => {
    let fetchCalled = false;
    const renderer = new CloudflareBrowserRenderer(
      "account",
      "token",
      async () => {
        fetchCalled = true;
        return new Response();
      },
      true,
      () => new Promise(() => undefined),
      10,
    );

    await assert.rejects(
      renderer.render(new URL("https://shop.example/products/widget")),
      /timed out/i,
    );
    assert.equal(fetchCalled, false);
  });
});

describe("OpenAI profile adapter", () => {
  it("requests strict structured output with no reasoning escalation", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const recipe = {
      schemaVersion: 1,
      pageType: "single_product",
      priceKind: "exact",
      urlPattern: "/products/*",
      requiresBrowser: false,
      fields: {
        name: {
          strategy: "selector",
          selector: "h1",
          key: null,
          attribute: "textContent",
        },
        price: {
          strategy: "selector",
          selector: ".price",
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
      evidenceSelectors: ["main.product"],
      confidence: 0.9,
    };
    const fetchMock: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              content: [
                { type: "output_text", text: JSON.stringify(recipe) },
              ],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const profiler = new OpenAiProfiler(
      "test-key",
      fetchMock,
      true,
      "gpt-5.6-luna",
    );
    const result = await profiler.generateProfile({
      reducedPage: "<main class=\"product\"><h1>Widget</h1></main>",
      finalUrl: new URL("https://shop.example/products/widget"),
      attempt: 1,
      feedback: null,
    });
    const requestBody = requests[0];

    assert.equal(result.recipe.urlPattern, "/products/*");
    assert.deepEqual(
      requestBody?.reasoning,
      { effort: "none" },
    );
    const text =
      requestBody?.text
        ? (requestBody.text as { format?: { strict?: boolean } })
        : null;
    assert.equal(text?.format?.strict, true);
    assert.equal(requestBody?.model, "gpt-5.6-luna");
  });

  it("rejects malformed structured output", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ executableCode: "return 1" }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    const profiler = new OpenAiProfiler(
      "test-key",
      fetchMock,
      true,
      "gpt-5.6-luna",
    );

    await assert.rejects(
      profiler.generateProfile({
        reducedPage: "<main>Widget</main>",
        finalUrl: new URL("https://shop.example/products/widget"),
        attempt: 1,
        feedback: null,
      }),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product" &&
        error.diagnosticDetails?.aiOutcome === "rejected",
    );
  });

  it("classifies invalid JSON output as unsupported structured output", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            { content: [{ type: "output_text", text: "{not-json" }] },
          ],
        }),
        { status: 200 },
      );
    const profiler = new OpenAiProfiler(
      "test-key",
      fetchMock,
      true,
      "gpt-5.6-luna",
    );

    await assert.rejects(
      profiler.generateProfile({
        reducedPage: "<main>Widget</main>",
        finalUrl: new URL("https://shop.example/products/widget"),
        attempt: 1,
        feedback: null,
      }),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product" &&
        /malformed/i.test(error.message),
    );
  });

  it("preserves provider status and usage when structured output is incomplete", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: "incomplete",
          output: [],
          usage: { input_tokens: 321, output_tokens: 45 },
        }),
        { status: 200 },
      );
    const profiler = new OpenAiProfiler(
      "test-key",
      fetchMock,
      true,
      "gpt-5.6-luna",
    );

    await assert.rejects(
      profiler.generateProfile({
        reducedPage: "<main>Widget</main>",
        finalUrl: new URL("https://shop.example/products/widget"),
        attempt: 1,
        feedback: null,
      }),
      (error) =>
        error instanceof ProductExtractionError &&
        error.diagnosticDetails?.providerStatus === "incomplete" &&
        error.diagnosticDetails.inputTokens === 321 &&
        error.diagnosticDetails.outputTokens === 45,
    );
  });
});
