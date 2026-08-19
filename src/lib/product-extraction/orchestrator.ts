import "server-only";

import {
  CloudflareBrowserRenderer,
  type BrowserRenderer,
} from "./browser-renderer";
import { OpenAiProfiler, type AiProfiler } from "./ai-profiler";
import { extractProductWithStrategy } from "./extract-product";
import { fetchProductHtml, type FetchedHtml } from "./fetch-html";
import {
  accessDenialSignals,
  hasUsableProfilingContent,
  looksLikeApplicationShell,
} from "./page-analysis";
import { executeProfile } from "./profile-execute";
import { createTemplateKey, findMatchingProfile } from "./profile-match";
import type { StoredProfile } from "./profile-schema";
import {
  createProfileRepository,
  type ProfileRepository,
} from "./profile-repository";
import { reducePageForProfiling } from "./reduce-page";
import { validateProfileAgainstPage } from "./profile-validate";
import {
  ProductExtractionError,
  type AcquisitionMethod,
  type ExtractionMethod,
  type NormalizedProduct,
  type ProductExtractionPipelineDiagnostics,
  type ProductResolution,
} from "./types";
import { validateProductUrl } from "./url-safety";

const MAX_AI_ATTEMPTS = 2;

export type ProductResolutionOptions = {
  requestedBy: string | null;
};

export type ProductExtractionRuntime = {
  fetchHtml: (value: string) => Promise<FetchedHtml>;
  repository: ProfileRepository;
  browserRenderer: BrowserRenderer;
  aiProfiler: AiProfiler;
};

function createRuntime(): ProductExtractionRuntime {
  return {
    fetchHtml: fetchProductHtml,
    repository: createProfileRepository(),
    browserRenderer: new CloudflareBrowserRenderer(),
    aiProfiler: new OpenAiProfiler(),
  };
}

function isActiveBlock(retryAfter: string | null) {
  if (!retryAfter) {
    return false;
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt) && retryAt > Date.now();
}

function contentFailure(error: unknown) {
  return (
    error instanceof ProductExtractionError &&
    error.code === "unsupported_product"
  );
}

function failureSummary(error: unknown) {
  return error instanceof ProductExtractionError
    ? `${error.code}: ${error.message}`.slice(0, 500)
    : "The candidate profile could not be validated.";
}

function addTokenUsage(current: number | null, next: number | null) {
  return next === null ? current : (current ?? 0) + next;
}

function createPipelineDiagnostics(
  runtime: ProductExtractionRuntime,
): ProductExtractionPipelineDiagnostics {
  return {
    normalizedUrl: null,
    hostname: null,
    matchingSiteProfileFound: null,
    profileStatus: null,
    profileVersion: null,
    profileExecutionAttempted: false,
    profileExecutionResult: null,
    staticFetchAttempted: false,
    staticFetchHttpStatus: null,
    staticFetchResult: null,
    staticHtmlLength: null,
    staticApplicationShell: null,
    staticAccessDenialSignals: [],
    genericStaticExtractionAttempted: false,
    genericStaticExtractionResult: null,
    browserFallbackEligible: null,
    browserRenderingEnabled: runtime.browserRenderer.configured,
    browserRenderAttempted: false,
    browserRenderHttpStatus: null,
    browserRenderResult: null,
    renderedHtmlLength: null,
    renderedAccessDenialSignals: [],
    genericRenderedExtractionAttempted: false,
    genericRenderedExtractionResult: null,
    aiProfilerEligible: null,
    aiProfilingEnabled: runtime.aiProfiler.configured,
    aiProfilerCalled: false,
    aiProfilerNotCalledReason: null,
    aiModel: runtime.aiProfiler.model,
    aiResultSchemaValidationResult: null,
    candidateProfileExecutionResult: null,
    candidateProfileValidationResult: null,
    profileSaved: false,
    savedProfileId: null,
    aiInputTokens: null,
    aiOutputTokens: null,
    finalFailureReason: null,
  };
}

function completeSuccessfulPipeline(
  pipeline: ProductExtractionPipelineDiagnostics,
  extractionMethod: ExtractionMethod,
) {
  pipeline.browserFallbackEligible ??= false;
  pipeline.browserRenderResult ??=
    "not attempted: an earlier deterministic stage succeeded";
  pipeline.aiProfilerEligible ??= false;
  pipeline.aiProfilerNotCalledReason ??=
    `not needed: ${extractionMethod} extraction succeeded`;
}

function completeFailedPipeline(
  pipeline: ProductExtractionPipelineDiagnostics,
) {
  pipeline.matchingSiteProfileFound ??= false;
  pipeline.profileExecutionResult ??=
    pipeline.matchingSiteProfileFound
      ? "not attempted: the pipeline stopped before profile execution"
      : "not attempted: no matching profile";
  pipeline.genericStaticExtractionResult ??=
    "not attempted: the pipeline stopped before generic static extraction";
  pipeline.browserFallbackEligible ??= false;
  pipeline.browserRenderResult ??=
    "not attempted: the pipeline stopped before browser fallback";
  pipeline.genericRenderedExtractionResult ??=
    "not attempted: rendered product HTML was not available";
  pipeline.aiProfilerEligible ??= false;
  pipeline.aiResultSchemaValidationResult ??= "not attempted";
  pipeline.candidateProfileExecutionResult ??= "not attempted";
  pipeline.candidateProfileValidationResult ??= "not attempted";

  if (!pipeline.aiProfilerCalled && !pipeline.aiProfilerNotCalledReason) {
    pipeline.aiProfilerNotCalledReason =
      pipeline.staticAccessDenialSignals.length > 0 ||
      pipeline.renderedAccessDenialSignals.length > 0
        ? "explicit access-denial content is not usable profiling input"
        : "the pipeline failed before AI profiling became eligible";
  }
}

async function resolveProductWithDiagnostics(
  value: string,
  options: ProductResolutionOptions,
  runtime: ProductExtractionRuntime,
  pipeline: ProductExtractionPipelineDiagnostics,
): Promise<ProductResolution> {
  const startedAt = Date.now();
  const initialUrl = validateProductUrl(value);
  const initialDomain = initialUrl.hostname.toLowerCase();
  pipeline.normalizedUrl = initialUrl.href;
  pipeline.hostname = initialDomain;
  const warnings: string[] = [];
  let repositoryAvailable = runtime.repository.persistent;
  let aiProfilerCalled = false;
  let browserMilliseconds: number | null = null;

  const bestEffort = async (operation: () => Promise<void>, warning: string) => {
    try {
      await operation();
    } catch {
      warnings.push(warning);
    }
  };

  let acquisitionState = null;
  if (repositoryAvailable) {
    try {
      acquisitionState =
        await runtime.repository.getAcquisitionState(initialDomain);
    } catch {
      repositoryAvailable = false;
      warnings.push("Shared extraction infrastructure was unavailable.");
    }
  }

  if (
    acquisitionState?.preferredMethod === "server_fetch_blocked" &&
    isActiveBlock(acquisitionState.retryAfter)
  ) {
    throw new ProductExtractionError(
      "source_unavailable",
      "Server acquisition for this source is temporarily paused after repeated failures.",
    );
  }

  let page: FetchedHtml;
  pipeline.staticFetchAttempted = true;
  try {
    page = await runtime.fetchHtml(initialUrl.href);
  } catch (error) {
    pipeline.staticFetchHttpStatus =
      error instanceof ProductExtractionError ? error.httpStatus ?? null : null;
    pipeline.staticFetchResult = failureSummary(error);
    if (
      repositoryAvailable &&
      error instanceof ProductExtractionError &&
      error.code === "source_unavailable"
    ) {
      await bestEffort(
        () =>
          runtime.repository.recordAcquisitionFailure(
            initialDomain,
            error.code,
            error.httpStatus,
          ),
        "The acquisition failure could not be recorded.",
      );
    }
    throw error;
  }

  pipeline.staticFetchHttpStatus = page.httpStatus ?? 200;
  pipeline.staticFetchResult = "succeeded";
  pipeline.staticHtmlLength = page.html.length;
  const applicationShell = looksLikeApplicationShell(page.html);
  pipeline.staticApplicationShell = applicationShell;
  pipeline.staticAccessDenialSignals = accessDenialSignals(page.html);

  const domain = page.finalUrl.hostname.toLowerCase();
  let profiles: StoredProfile[] = [];
  if (repositoryAvailable) {
    try {
      profiles = await runtime.repository.listProfiles(domain);
    } catch {
      repositoryAvailable = false;
      warnings.push("Saved extraction profiles could not be loaded.");
    }
  }

  const matchingProfile = findMatchingProfile(page.finalUrl, profiles);
  pipeline.matchingSiteProfileFound = Boolean(matchingProfile);
  pipeline.profileStatus = matchingProfile?.status ?? null;
  pipeline.profileVersion = matchingProfile?.version ?? null;
  let repeatedProfileFailure = false;

  if (pipeline.staticAccessDenialSignals.length > 0) {
    if (repositoryAvailable) {
      await bestEffort(
        () =>
          runtime.repository.recordAcquisitionFailure(
            domain,
            "explicit_access_denial",
            page.httpStatus ?? 200,
          ),
        "The access denial could not be recorded.",
      );
    }
    throw new ProductExtractionError(
      "source_unavailable",
      "The source website returned an explicit access-denial page.",
      page.httpStatus,
    );
  }

  const finish = (
    product: NormalizedProduct,
    extractionMethod: ExtractionMethod,
    acquisitionMethod: AcquisitionMethod,
    siteProfileId: string | null,
    profileStatus = matchingProfile?.status ?? null,
  ): ProductResolution => {
    completeSuccessfulPipeline(pipeline, extractionMethod);
    return {
      product,
      siteProfileId,
      diagnostics: {
        requestedUrl: initialUrl.href,
        finalUrl: page.finalUrl.href,
        domain,
        templateProfileMatched: Boolean(matchingProfile),
        profileStatus,
        acquisitionMethod,
        extractionMethod,
        aiProfilerCalled,
        browserMilliseconds,
        elapsedMilliseconds: Date.now() - startedAt,
        warnings,
        pipeline,
      },
    };
  };

  if (
    matchingProfile &&
    matchingProfile.status !== "degraded" &&
    !matchingProfile.requiresBrowser
  ) {
    pipeline.profileExecutionAttempted = true;
    try {
      const product = executeProfile(
        matchingProfile.recipe,
        page.html,
        page.finalUrl,
      );
      await bestEffort(
        () => runtime.repository.recordProfileSuccess(matchingProfile),
        "The extraction-profile success could not be recorded.",
      );
      if (repositoryAvailable) {
        await bestEffort(
          () =>
            runtime.repository.recordAcquisitionSuccess(
              domain,
              "static_fetch",
            ),
          "The successful static acquisition could not be recorded.",
        );
      }
      pipeline.profileExecutionResult = "succeeded on static HTML";
      return finish(
        product,
        "saved_profile",
        "static_fetch",
        matchingProfile.id,
      );
    } catch (error) {
      pipeline.profileExecutionResult = failureSummary(error);
      if (!contentFailure(error)) {
        throw error;
      }
      repeatedProfileFailure =
        matchingProfile.consecutiveFailureCount + 1 >= 2;
      await bestEffort(
        () => runtime.repository.recordProfileFailure(matchingProfile),
        "The extraction-profile failure could not be recorded.",
      );
      warnings.push("The matching static profile did not validate this page.");
    }
  }

  pipeline.genericStaticExtractionAttempted = true;
  try {
    const extracted = extractProductWithStrategy(page.html, page.finalUrl);
    pipeline.genericStaticExtractionResult =
      `succeeded with ${extracted.strategy}`;
    if (repositoryAvailable) {
      await bestEffort(
        () =>
          runtime.repository.recordAcquisitionSuccess(domain, "static_fetch"),
        "The successful static acquisition could not be recorded.",
      );
    }
    return finish(
      extracted.product,
      "static_generic",
      "static_fetch",
      null,
    );
  } catch (error) {
    pipeline.genericStaticExtractionResult = failureSummary(error);
    if (!contentFailure(error)) {
      throw error;
    }
  }

  if (repositoryAvailable) {
    await bestEffort(
      () => runtime.repository.recordAcquisitionSuccess(domain, "static_fetch"),
      "The successful static acquisition could not be recorded.",
    );
  }

  const browserAppropriate =
    matchingProfile?.requiresBrowser === true ||
    acquisitionState?.preferredMethod === "browser_required" ||
    applicationShell;
  pipeline.browserFallbackEligible = browserAppropriate;
  let profilingHtml = page.html;
  let usedBrowser = false;

  if (browserAppropriate && runtime.browserRenderer.configured) {
    pipeline.browserRenderAttempted = true;
    try {
      const rendered = await runtime.browserRenderer.render(page.finalUrl);
      browserMilliseconds = rendered.browserMilliseconds;
      pipeline.browserRenderHttpStatus = rendered.httpStatus ?? 200;
      pipeline.browserRenderResult = "succeeded";
      pipeline.renderedHtmlLength = rendered.html.length;
      usedBrowser = true;
      profilingHtml = rendered.html;

      pipeline.renderedAccessDenialSignals = accessDenialSignals(rendered.html);
      if (pipeline.renderedAccessDenialSignals.length > 0) {
        throw new ProductExtractionError(
          "source_unavailable",
          "The rendered page contained an explicit access denial.",
          rendered.httpStatus,
        );
      }

      if (
        matchingProfile &&
        matchingProfile.status !== "degraded" &&
        matchingProfile.requiresBrowser
      ) {
        pipeline.profileExecutionAttempted = true;
        try {
          const product = executeProfile(
            matchingProfile.recipe,
            rendered.html,
            page.finalUrl,
          );
          await bestEffort(
            () => runtime.repository.recordProfileSuccess(matchingProfile),
            "The extraction-profile success could not be recorded.",
          );
          await bestEffort(
            () =>
              runtime.repository.recordAcquisitionSuccess(
                domain,
                "browser_required",
              ),
            "The browser acquisition preference could not be recorded.",
          );
          pipeline.profileExecutionResult = "succeeded on rendered HTML";
          return finish(
            product,
            "saved_profile",
            "browser_required",
            matchingProfile.id,
          );
        } catch (error) {
          pipeline.profileExecutionResult = failureSummary(error);
          if (!contentFailure(error)) {
            throw error;
          }
          repeatedProfileFailure =
            matchingProfile.consecutiveFailureCount + 1 >= 2;
          await bestEffort(
            () => runtime.repository.recordProfileFailure(matchingProfile),
            "The extraction-profile failure could not be recorded.",
          );
          warnings.push(
            "The matching browser profile did not validate this page.",
          );
        }
      }

      pipeline.genericRenderedExtractionAttempted = true;
      try {
        const extracted = extractProductWithStrategy(
          rendered.html,
          page.finalUrl,
        );
        pipeline.genericRenderedExtractionResult =
          `succeeded with ${extracted.strategy}`;
        await bestEffort(
          () =>
            runtime.repository.recordAcquisitionSuccess(
              domain,
              "browser_required",
            ),
          "The browser acquisition preference could not be recorded.",
        );
        return finish(
          extracted.product,
          "browser_generic",
          "browser_required",
          null,
        );
      } catch (error) {
        pipeline.genericRenderedExtractionResult = failureSummary(error);
        if (!contentFailure(error)) {
          throw error;
        }
      }
    } catch (error) {
      pipeline.browserRenderHttpStatus ??=
        error instanceof ProductExtractionError ? error.httpStatus ?? null : null;
      pipeline.browserRenderResult = failureSummary(error);
      if (
        error instanceof ProductExtractionError &&
        error.message.toLowerCase().includes("access denial")
      ) {
        throw error;
      }
      warnings.push("The bounded browser-rendering attempt did not succeed.");
    }
  } else if (browserAppropriate) {
    pipeline.browserRenderResult =
      "not attempted: browser rendering is disabled or configuration is incomplete";
  } else {
    pipeline.browserRenderResult =
      "not attempted: the fetched page was not classified as an application shell";
  }

  const profilingContentUsable = hasUsableProfilingContent(profilingHtml);
  const profileEligible =
    repositoryAvailable &&
    profilingContentUsable &&
    (!matchingProfile ||
      matchingProfile.status === "degraded" ||
      repeatedProfileFailure);
  const mayProfile = profileEligible && runtime.aiProfiler.configured;
  pipeline.aiProfilerEligible = profileEligible;

  if (!repositoryAvailable) {
    pipeline.aiProfilerNotCalledReason =
      "shared profile persistence is unavailable";
  } else if (!profilingContentUsable) {
    pipeline.aiProfilerNotCalledReason =
      "no usable non-shell page content was obtained for profiling";
  } else if (!runtime.aiProfiler.configured) {
    pipeline.aiProfilerNotCalledReason =
      "AI profiling is disabled or its server configuration is incomplete";
  } else if (!profileEligible) {
    pipeline.aiProfilerNotCalledReason =
      "the matching profile has not reached the bounded repair threshold";
  }

  if (mayProfile) {
    const reduced = reducePageForProfiling(profilingHtml, page.finalUrl);
    const fallbackTemplateKey = createTemplateKey(domain, page.finalUrl.pathname);
    let feedback: string | null = null;
    let terminalError: ProductExtractionError | null = null;

    for (let attempt = 1; attempt <= MAX_AI_ATTEMPTS; attempt += 1) {
      aiProfilerCalled = true;
      pipeline.aiProfilerCalled = true;
      pipeline.aiProfilerNotCalledReason = null;
      const attemptNumber = attempt as 1 | 2;
      let result;

      try {
        result = await runtime.aiProfiler.generateProfile({
          reducedPage: reduced.content,
          finalUrl: page.finalUrl,
          attempt: attemptNumber,
          feedback,
        });
        pipeline.aiResultSchemaValidationResult =
          `attempt ${attempt}: passed`;
        pipeline.aiInputTokens = addTokenUsage(
          pipeline.aiInputTokens,
          result.inputTokens,
        );
        pipeline.aiOutputTokens = addTokenUsage(
          pipeline.aiOutputTokens,
          result.outputTokens,
        );
      } catch (error) {
        pipeline.aiResultSchemaValidationResult =
          `attempt ${attempt}: ${failureSummary(error)}`;
        const diagnosticDetails =
          error instanceof ProductExtractionError
            ? error.diagnosticDetails
            : undefined;
        const outcome =
          diagnosticDetails?.aiOutcome === "rejected"
            ? "rejected"
            : "provider_error";
        if (error instanceof ProductExtractionError) {
          pipeline.aiInputTokens = addTokenUsage(
            pipeline.aiInputTokens,
            diagnosticDetails?.inputTokens ?? null,
          );
          pipeline.aiOutputTokens = addTokenUsage(
            pipeline.aiOutputTokens,
            diagnosticDetails?.outputTokens ?? null,
          );
        }
        await bestEffort(
          () =>
            runtime.repository.recordAiRun({
              siteProfileId: matchingProfile?.id ?? null,
              requestedBy: options.requestedBy,
              domain,
              templateKey: matchingProfile?.templateKey ?? fallbackTemplateKey,
              runType: matchingProfile ? "repair" : "generation",
              model: runtime.aiProfiler.model,
              attempt,
              inputChars:
                diagnosticDetails?.inputChars ?? reduced.reducedChars,
              inputTokens: diagnosticDetails?.inputTokens ?? null,
              outputChars: diagnosticDetails?.outputChars ?? 0,
              outputTokens: diagnosticDetails?.outputTokens ?? null,
              outcome,
              errorCode:
                error instanceof ProductExtractionError ? error.code : "unknown",
            }),
          "The AI profiling attempt could not be recorded.",
        );
        feedback = failureSummary(error);
        if (outcome === "provider_error") {
          break;
        }
        continue;
      }

      try {
        if (result.recipe.requiresBrowser !== usedBrowser) {
          throw new ProductExtractionError(
            "unsupported_product",
            "The candidate acquisition method did not match the validated page content.",
          );
        }

        const product = validateProfileAgainstPage(
          result.recipe,
          profilingHtml,
          page.finalUrl,
        );
        pipeline.candidateProfileExecutionResult =
          `attempt ${attempt}: succeeded`;
        pipeline.candidateProfileValidationResult =
          `attempt ${attempt}: passed`;
        let savedProfile;
        try {
          savedProfile = await runtime.repository.saveCandidate({
            domain,
            recipe: result.recipe,
            acquisitionMethod: usedBrowser
              ? "browser_required"
              : "static_fetch",
          });
        } catch {
          throw new ProductExtractionError(
            "source_unavailable",
            "The validated extraction profile could not be stored.",
          );
        }
        pipeline.profileSaved = true;
        pipeline.savedProfileId = savedProfile.id;
        await bestEffort(
          () =>
            runtime.repository.recordAiRun({
              siteProfileId: savedProfile.id,
              requestedBy: options.requestedBy,
              domain,
              templateKey: savedProfile.templateKey,
              runType: matchingProfile ? "repair" : "generation",
              model: result.model,
              attempt,
              inputChars: result.inputChars,
              inputTokens: result.inputTokens,
              outputChars: result.outputChars,
              outputTokens: result.outputTokens,
              outcome: "validated",
              errorCode: null,
            }),
          "The validated AI profiling attempt could not be recorded.",
        );
        return finish(
          product,
          "ai_profile",
          usedBrowser ? "browser_required" : "static_fetch",
          savedProfile.id,
          savedProfile.status,
        );
      } catch (error) {
        pipeline.candidateProfileExecutionResult =
          `attempt ${attempt}: ${failureSummary(error)}`;
        pipeline.candidateProfileValidationResult =
          `attempt ${attempt}: ${failureSummary(error)}`;
        feedback = failureSummary(error);
        if (
          error instanceof ProductExtractionError &&
          error.code === "source_unavailable"
        ) {
          terminalError = error;
        }
        await bestEffort(
          () =>
            runtime.repository.recordAiRun({
              siteProfileId: matchingProfile?.id ?? null,
              requestedBy: options.requestedBy,
              domain,
              templateKey: matchingProfile?.templateKey ?? fallbackTemplateKey,
              runType: matchingProfile ? "repair" : "generation",
              model: result.model,
              attempt,
              inputChars: result.inputChars,
              inputTokens: result.inputTokens,
              outputChars: result.outputChars,
              outputTokens: result.outputTokens,
              outcome: "rejected",
              errorCode:
                error instanceof ProductExtractionError ? error.code : "invalid",
            }),
          "The rejected AI profiling attempt could not be recorded.",
        );
        if (terminalError) {
          break;
        }
      }
    }

    if (terminalError) {
      throw terminalError;
    }
  }

  throw new ProductExtractionError(
    "unsupported_product",
    "No deterministic extraction method produced a reliable product result.",
  );
}

export async function resolveProduct(
  value: string,
  options: ProductResolutionOptions,
  runtime: ProductExtractionRuntime = createRuntime(),
): Promise<ProductResolution> {
  const pipeline = createPipelineDiagnostics(runtime);

  try {
    const result = await resolveProductWithDiagnostics(
      value,
      options,
      runtime,
      pipeline,
    );

    if (process.env.NODE_ENV === "development") {
      console.info("Product extraction pipeline succeeded.", pipeline);
    }

    return result;
  } catch (error) {
    pipeline.finalFailureReason = failureSummary(error);
    completeFailedPipeline(pipeline);

    if (error instanceof ProductExtractionError) {
      error.diagnostics = pipeline;
    }

    if (process.env.NODE_ENV === "development") {
      console.error("Product extraction pipeline failed.", pipeline);
    }

    throw error;
  }
}
