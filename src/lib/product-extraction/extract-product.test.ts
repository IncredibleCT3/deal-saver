import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractProductFromHtml,
  extractProductWithStrategy,
} from "./extract-product";
import { ProductExtractionError } from "./types";

const finalUrl = "https://shop.example/products/widget";
const imageUrl = "https://cdn.example/images/widget.jpg";

function page(markup: string) {
  return `<!doctype html><html><head>${markup}</head><body></body></html>`;
}

describe("generic JSON-LD extraction", () => {
  it("extracts and normalizes a Schema.org Product root", () => {
    const product = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "  Example   Widget  ",
      image: [imageUrl],
      url: `${finalUrl}?campaign=test#details`,
      offers: {
        "@type": "Offer",
        price: "49.9",
        priceCurrency: "USD",
        itemCondition: "https://schema.org/NewCondition",
      },
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    );

    assert.deepEqual(extractProductFromHtml(html, finalUrl), {
      name: "Example Widget",
      currentPrice: "49.90",
      currency: "USD",
      imageUrl,
      sourceName: "shop.example",
      sourceDomain: "shop.example",
      canonicalUrl: `${finalUrl}?campaign=test`,
      productType: "single_product",
      priceKind: "exact",
      confidence: 0.96,
    });
  });

  it("resolves Product and Offer references inside an @graph", () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@id": "#widget",
          "@type": "Product",
          name: "Graph Widget",
          image: { contentUrl: imageUrl },
          sku: "SKU-1",
          offers: { "@id": "#offer" },
        },
        {
          "@id": "#offer",
          "@type": "Offer",
          sku: "SKU-1",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: 75,
            priceCurrency: "USD",
          },
        },
      ],
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(graph)}</script>`,
    );

    assert.equal(extractProductFromHtml(html, finalUrl).currentPrice, "75.00");
  });

  it("pairs one Product and one Offer from a root array", () => {
    const html = page(`<script type="application/ld+json">${JSON.stringify([
      {
        "@type": "Product",
        name: "Array Widget",
        image: imageUrl,
      },
      {
        "@type": "Offer",
        price: "80.00",
        priceCurrency: "USD",
      },
    ])}</script>`);

    assert.equal(extractProductFromHtml(html, finalUrl).currentPrice, "80.00");
  });

  it("normalizes AggregateOffer lowPrice as a product-family starting price", () => {
    const product = {
      "@type": "ProductGroup",
      name: "Configurable Widget",
      offers: {
        "@type": "AggregateOffer",
        lowPrice: "99",
        highPrice: "249",
        priceCurrency: "EUR",
      },
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    );
    const result = extractProductFromHtml(html, finalUrl);

    assert.equal(result.currentPrice, "99.00");
    assert.equal(result.currency, "EUR");
    assert.equal(result.productType, "product_family");
    assert.equal(result.priceKind, "starting_at");
  });

  it("fills missing JSON-LD fields from product-specific metadata", () => {
    const product = {
      "@type": "Product",
      name: "Fallback Widget",
    };
    const html = page(`
      <script type="application/ld+json">${JSON.stringify(product)}</script>
      <meta property="og:type" content="product">
      <meta property="og:image" content="${imageUrl}">
      <meta property="product:price:amount" content="31.25">
      <meta property="product:price:currency" content="USD">
    `);

    assert.deepEqual(extractProductFromHtml(html, finalUrl), {
      name: "Fallback Widget",
      currentPrice: "31.25",
      currency: "USD",
      imageUrl,
      sourceName: "shop.example",
      sourceDomain: "shop.example",
      canonicalUrl: finalUrl,
      productType: "single_product",
      priceKind: "exact",
      confidence: 0.86,
    });
  });

  it("rejects conflicting prices instead of guessing", () => {
    const product = {
      "@type": "Product",
      name: "Ambiguous Widget",
      image: imageUrl,
      offers: [
        { price: "10.00", priceCurrency: "USD" },
        { price: "12.00", priceCurrency: "USD" },
      ],
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    );

    assert.throws(
      () => extractProductFromHtml(html, finalUrl),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });

  it("rejects an offer whose explicit SKU contradicts the product SKU", () => {
    const product = {
      "@type": "Product",
      name: "Variant Widget",
      image: imageUrl,
      sku: "SKU-BLUE",
      offers: {
        "@type": "Offer",
        sku: "SKU-RED",
        price: "10.00",
        priceCurrency: "USD",
      },
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    );

    assert.throws(
      () => extractProductFromHtml(html, finalUrl),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });
});

describe("generic semantic extraction", () => {
  it("extracts Schema.org Product microdata", () => {
    const html = `<!doctype html><html><head>
      <link rel="canonical" href="${finalUrl}?variant=blue">
      </head><body>
      <article itemscope itemtype="https://schema.org/Product">
        <meta itemprop="name" content="Microdata Widget">
        <img itemprop="image" src="${imageUrl}">
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="price" content="24.50">
          <meta itemprop="priceCurrency" content="USD">
        </div>
      </article>
      </body></html>`;

    assert.deepEqual(extractProductFromHtml(html, finalUrl), {
      name: "Microdata Widget",
      currentPrice: "24.50",
      currency: "USD",
      imageUrl,
      sourceName: "shop.example",
      sourceDomain: "shop.example",
      canonicalUrl: `${finalUrl}?variant=blue`,
      productType: "single_product",
      priceKind: "exact",
      confidence: 0.9,
    });
  });

  it("uses conservative product-specific meta fallbacks", () => {
    const html = page(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Metadata Widget">
      <meta property="og:image" content="${imageUrl}">
      <meta property="product:price:amount" content="19.99">
      <meta property="product:price:currency" content="USD">
    `);

    assert.equal(extractProductFromHtml(html, finalUrl).name, "Metadata Widget");
  });

  it("falls back to the fetched URL when canonical metadata changes hosts", () => {
    const product = {
      "@type": "Product",
      name: "Safe Canonical Widget",
      image: imageUrl,
      url: "https://unrelated.example/phishing",
      offers: { price: "15.00", priceCurrency: "USD" },
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    );

    assert.equal(
      extractProductFromHtml(html, finalUrl).canonicalUrl,
      finalUrl,
    );
  });

  it("does not infer a price from arbitrary visible text", () => {
    const html = `<!doctype html><html><head><title>Widget</title></head>
      <body><h1>Widget</h1><img src="${imageUrl}"><p>Only $9.99</p></body></html>`;

    assert.throws(
      () => extractProductFromHtml(html, finalUrl),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });

  it("requires explicit currency metadata", () => {
    const product = {
      "@type": "Product",
      name: "Currencyless Widget",
      image: imageUrl,
      offers: { price: "15.00" },
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    );

    assert.throws(
      () => extractProductFromHtml(html, finalUrl),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });

  it("preserves an explicit non-USD currency", () => {
    const product = {
      "@type": "Product",
      name: "Canadian Widget",
      offers: { price: "15.00", priceCurrency: "CAD" },
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    );

    assert.equal(extractProductFromHtml(html, finalUrl).currency, "CAD");
  });

  it("rejects a syntactically shaped but unsupported currency code", () => {
    const product = {
      "@type": "Product",
      name: "Invalid Currency Widget",
      offers: { price: "15.00", priceCurrency: "ZZZ" },
    };
    const html = page(
      `<script type="application/ld+json">${JSON.stringify(product)}</script>`,
    );

    assert.throws(
      () => extractProductFromHtml(html, finalUrl),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });

  it("does not pair prices and currencies from different meta namespaces", () => {
    const html = page(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Mixed Currency Widget">
      <meta property="og:image" content="${imageUrl}">
      <meta property="product:price:amount" content="19.99">
      <meta property="og:price:currency" content="USD">
    `);

    assert.throws(
      () => extractProductFromHtml(html, finalUrl),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });

  it("rejects ambiguous currencies within one meta namespace", () => {
    const html = page(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Ambiguous Currency Widget">
      <meta property="og:image" content="${imageUrl}">
      <meta property="product:price:amount" content="19.99">
      <meta property="product:price:currency" content="USD">
      <meta property="product:price:currency" content="CAD">
    `);

    assert.throws(
      () => extractProductFromHtml(html, finalUrl),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });

  it("uses bounded embedded application JSON as the last deterministic strategy", () => {
    const state = {
      page: {
        product: {
          productId: "widget-1",
          productName: "Application State Widget",
          currentPrice: { amount: "44.5", currencyCode: "GBP" },
          primaryImage: imageUrl,
          canonicalUrl: finalUrl,
        },
      },
    };
    const html = page(
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`,
    );
    const result = extractProductFromHtml(html, finalUrl);

    assert.equal(result.name, "Application State Widget");
    assert.equal(result.currentPrice, "44.50");
    assert.equal(result.currency, "GBP");
  });

  it("recognizes conservative visible prices inside the primary product region", () => {
    const priceTexts = [
      "Current price is USD$20.93",
      "Current price $20.93",
      "Price: $20.93",
      "Now $20.93",
      "$20.93",
    ];

    for (const priceText of priceTexts) {
      const html = `<!doctype html><html lang="en-US"><head>
        <link rel="canonical" href="${finalUrl}">
        <meta property="og:image" content="${imageUrl}">
        </head><body><main><article class="product-detail">
          <h1>Visible Price Widget</h1>
          <p class="current-price">${priceText}</p>
        </article></main></body></html>`;
      const result = extractProductWithStrategy(html, finalUrl);

      assert.equal(result.strategy, "visible_product_region");
      assert.equal(result.product.name, "Visible Price Widget");
      assert.equal(result.product.currentPrice, "20.93");
      assert.equal(result.product.currency, "USD");
      assert.equal(result.product.imageUrl, imageUrl);
    }
  });

  it("rejects unit, financing, savings, shipping, and unrelated visible prices", () => {
    const rejectedTexts = [
      "Unit price $0.20 per item",
      "Financing $5.00/month",
      "Save $4.00",
      "Shipping $7.99",
      "Was $30.00",
      "Only $9.99",
    ];

    for (const priceText of rejectedTexts) {
      const html = `<!doctype html><html lang="en-US"><body>
        <main><article class="product-detail">
          <h1>Protected Widget</h1><p>${priceText}</p>
        </article></main></body></html>`;

      assert.throws(
        () => extractProductFromHtml(html, finalUrl),
        (error) =>
          error instanceof ProductExtractionError &&
          error.code === "unsupported_product",
      );
    }
  });

  it("rejects conflicting equally strong visible current prices", () => {
    const html = `<!doctype html><html lang="en-US"><body>
      <main><article class="product-detail">
        <h1>Ambiguous Visible Widget</h1>
        <p>Current price $20.93</p>
        <p>Current price $22.93</p>
      </article></main></body></html>`;

    assert.throws(
      () => extractProductFromHtml(html, finalUrl),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });
});
