import {
  getRuntimeConfigurationStatus,
  getProductResolution,
  ProductExtractionError,
} from "../src/lib/product-extraction";

const productUrl = process.argv[2];

async function main() {
  if (!productUrl) {
    console.error(
      'Usage: npm run probe-product -- "https://example.com/product"',
    );
    process.exitCode = 1;
    return;
  }

  const configuration = getRuntimeConfigurationStatus();

  try {
    const { product, diagnostics } = await getProductResolution(productUrl, {
      requestedBy: null,
    });
    const report = {
      url: diagnostics.finalUrl,
      domain: diagnostics.domain,
      templateProfileMatched: diagnostics.templateProfileMatched,
      profileStatus: diagnostics.profileStatus,
      acquisitionMethod: diagnostics.acquisitionMethod,
      extractionMethod: diagnostics.extractionMethod,
      aiProfilerCalled: diagnostics.aiProfilerCalled,
      productType: product.productType,
      name: product.name,
      price: product.currentPrice,
      priceKind: product.priceKind,
      currency: product.currency,
      image: product.imageUrl,
      canonicalUrl: product.canonicalUrl,
      confidence: product.confidence,
      browserMilliseconds: diagnostics.browserMilliseconds,
      elapsedMilliseconds: diagnostics.elapsedMilliseconds,
      warnings: diagnostics.warnings,
      configuration,
      pipeline: diagnostics.pipeline,
    };

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (error instanceof ProductExtractionError) {
      console.error(
        JSON.stringify(
          {
            code: error.code,
            httpStatus: error.httpStatus ?? null,
            message: error.message,
            configuration,
            pipeline: error.diagnostics ?? null,
          },
          null,
          2,
        ),
      );
    } else {
      console.error("Unexpected probe failure.");
    }
    process.exitCode = 1;
  }
}

void main();
