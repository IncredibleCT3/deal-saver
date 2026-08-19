import { resolveProduct } from "./orchestrator";
import {
  ProductExtractionError,
  type NormalizedProduct,
  type ProductResolution,
} from "./types";

const publicMessages: Record<ProductExtractionError["code"], string> = {
  invalid_url: "Enter a valid HTTPS product URL.",
  unsafe_url: "That product URL cannot be fetched safely.",
  unsupported_product:
    "Deal Saver could not reliably extract product details from that page.",
  product_not_found: "The source website could not find that product.",
  source_unavailable:
    "The source website is temporarily unavailable. Please try again later.",
};

export async function getProductForUrl(
  value: string,
  options: { requestedBy: string | null },
): Promise<NormalizedProduct> {
  const resolution = await resolveProduct(value, options);
  return resolution.product;
}

export async function getProductResolution(
  value: string,
  options: { requestedBy: string | null },
): Promise<ProductResolution> {
  return resolveProduct(value, options);
}

export function getProductExtractionErrorMessage(
  error: ProductExtractionError,
) {
  return publicMessages[error.code];
}

export { ProductExtractionError } from "./types";
export { getRuntimeConfigurationStatus } from "./runtime-config";
