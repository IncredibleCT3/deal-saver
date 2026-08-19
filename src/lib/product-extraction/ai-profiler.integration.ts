import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiProfiler } from "./ai-profiler";
import { reducePageForProfiling } from "./reduce-page";
import { validateProfileAgainstPage } from "./profile-validate";

const enabled =
  process.env.RUN_AI_PROFILE_INTEGRATION === "true" &&
  process.env.AI_PROFILING_ENABLED === "true" &&
  Boolean(process.env.OPENAI_API_KEY);

test(
  "the configured AI model can produce a validated structured profile",
  { skip: !enabled },
  async () => {
    const finalUrl = new URL("https://shop.example/products/sample-widget");
    const html = `
      <html><head>
        <link rel="canonical" href="https://shop.example/products/sample-widget">
      </head><body>
        <main class="product-detail" itemscope itemtype="https://schema.org/Product">
          <h1 class="product-title">Sample Widget</h1>
          <p class="current-price">$24.99</p>
          <meta property="product:price:currency" content="USD">
          <img class="product-image" src="https://shop.example/widget.jpg">
        </main>
      </body></html>`;
    const reduced = reducePageForProfiling(html, finalUrl);
    const profiler = new OpenAiProfiler();
    const result = await profiler.generateProfile({
      reducedPage: reduced.content,
      finalUrl,
      attempt: 1,
      feedback: null,
    });
    const product = validateProfileAgainstPage(
      result.recipe,
      html,
      finalUrl,
    );

    assert.equal(product.name, "Sample Widget");
    assert.equal(product.currentPrice, "24.99");
    assert.equal(product.currency, "USD");
  },
);
