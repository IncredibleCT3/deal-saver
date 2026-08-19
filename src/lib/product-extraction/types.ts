export type ProductType = "single_product" | "product_family";
export type PriceKind = "exact" | "starting_at";
export type AcquisitionMethod = "static_fetch" | "browser_required";
export type ExtractionMethod =
  | "saved_profile"
  | "static_generic"
  | "browser_generic"
  | "ai_profile";

export type NormalizedProduct = {
  name: string;
  currentPrice: string;
  currency: string;
  imageUrl: string | null;
  sourceName: string;
  sourceDomain: string;
  canonicalUrl: string;
  productType: ProductType;
  priceKind: PriceKind;
  confidence: number;
};

export type ExtractionDiagnostics = {
  requestedUrl: string;
  finalUrl: string;
  domain: string;
  templateProfileMatched: boolean;
  profileStatus: string | null;
  acquisitionMethod: AcquisitionMethod;
  extractionMethod: ExtractionMethod;
  aiProfilerCalled: boolean;
  browserMilliseconds: number | null;
  elapsedMilliseconds: number;
  warnings: string[];
  pipeline: ProductExtractionPipelineDiagnostics;
};

export type ProductExtractionPipelineDiagnostics = {
  normalizedUrl: string | null;
  hostname: string | null;
  matchingSiteProfileFound: boolean | null;
  profileStatus: string | null;
  profileVersion: number | null;
  profileExecutionAttempted: boolean;
  profileExecutionResult: string | null;
  staticFetchAttempted: boolean;
  staticFetchHttpStatus: number | null;
  staticFetchResult: string | null;
  staticHtmlLength: number | null;
  staticApplicationShell: boolean | null;
  staticAccessDenialSignals: string[];
  genericStaticExtractionAttempted: boolean;
  genericStaticExtractionResult: string | null;
  browserFallbackEligible: boolean | null;
  browserRenderingEnabled: boolean;
  browserRenderAttempted: boolean;
  browserRenderHttpStatus: number | null;
  browserRenderResult: string | null;
  renderedHtmlLength: number | null;
  renderedAccessDenialSignals: string[];
  genericRenderedExtractionAttempted: boolean;
  genericRenderedExtractionResult: string | null;
  aiProfilerEligible: boolean | null;
  aiProfilingEnabled: boolean;
  aiProfilerCalled: boolean;
  aiProfilerNotCalledReason: string | null;
  aiModel: string;
  aiResultSchemaValidationResult: string | null;
  candidateProfileExecutionResult: string | null;
  candidateProfileValidationResult: string | null;
  profileSaved: boolean;
  savedProfileId: string | null;
  aiInputTokens: number | null;
  aiOutputTokens: number | null;
  finalFailureReason: string | null;
};

export type ProductResolution = {
  product: NormalizedProduct;
  siteProfileId: string | null;
  diagnostics: ExtractionDiagnostics;
};

export type ProductExtractionErrorCode =
  | "invalid_url"
  | "unsafe_url"
  | "unsupported_product"
  | "product_not_found"
  | "source_unavailable";

export class ProductExtractionError extends Error {
  diagnostics?: ProductExtractionPipelineDiagnostics;

  constructor(
    public readonly code: ProductExtractionErrorCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly diagnosticDetails?: {
      aiOutcome?: "rejected" | "provider_error";
      providerStatus?: string | null;
      inputChars?: number;
      inputTokens?: number | null;
      outputTokens?: number | null;
      outputChars?: number;
    },
  ) {
    super(message);
    this.name = "ProductExtractionError";
  }
}

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type HostResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export type ResolvedPublicUrl = {
  url: URL;
  address: ResolvedAddress;
};
