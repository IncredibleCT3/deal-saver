import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import type { LookupFunction } from "node:net";
import {
  ProductExtractionError,
  type HostResolver,
  type ResolvedPublicUrl,
} from "./types";
import {
  resolveHostname,
  resolvePublicUrl,
  validateProductUrl,
} from "./url-safety";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;
const DEFAULT_MAX_REDIRECTS = 3;
const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type TransportResponse = {
  statusCode?: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array> & {
    destroy(error?: Error): void;
  };
};

export type RequestExecutor = (
  target: ResolvedPublicUrl,
  signal: AbortSignal,
) => Promise<TransportResponse>;

export type FetchHtmlOptions = {
  resolver?: HostResolver;
  requester?: RequestExecutor;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
};

export type FetchedHtml = {
  html: string;
  finalUrl: URL;
  httpStatus?: number;
};

function pinnedLookup(target: ResolvedPublicUrl): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [target.address]);
      return;
    }

    callback(null, target.address.address, target.address.family);
  };
}

export const requestResolvedUrl: RequestExecutor = (target, signal) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      target.url,
      {
        agent: false,
        family: target.address.family,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "identity",
          "accept-language": "en-US,en;q=0.9",
        },
        lookup: pinnedLookup(target),
        method: "GET",
        signal,
      },
      (response) => {
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: response,
        });
      },
    );

    request.once("error", reject);
    request.end();
  });

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("The request was aborted.");
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", handleAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

async function readHtmlBody(
  response: TransportResponse,
  maxResponseBytes: number,
  signal: AbortSignal,
) {
  const declaredLength = Number(
    firstHeaderValue(response.headers["content-length"]),
  );

  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    response.body.destroy();
    throw new ProductExtractionError(
      "unsupported_product",
      "The HTML response was larger than the configured limit.",
    );
  }

  const decoder = new TextDecoder();
  let html = "";
  let totalBytes = 0;
  const handleAbort = () => response.body.destroy(abortError(signal));

  if (signal.aborted) {
    handleAbort();
    throw abortError(signal);
  }

  signal.addEventListener("abort", handleAbort, { once: true });

  try {
    for await (const chunk of response.body) {
      totalBytes += chunk.byteLength;

      if (totalBytes > maxResponseBytes) {
        response.body.destroy();
        throw new ProductExtractionError(
          "unsupported_product",
          "The HTML response exceeded the configured limit.",
        );
      }

      html += decoder.decode(chunk, { stream: true });
    }

    return html + decoder.decode();
  } finally {
    signal.removeEventListener("abort", handleAbort);
  }
}

function destroyResponse(response: TransportResponse) {
  response.body.destroy();
}

async function fetchWithSignal(
  initialUrl: URL,
  signal: AbortSignal,
  options: Required<
    Pick<FetchHtmlOptions, "maxRedirects" | "maxResponseBytes">
  > & {
    resolver: HostResolver;
    requester: RequestExecutor;
  },
): Promise<FetchedHtml> {
  let currentUrl = initialUrl;

  for (
    let redirectCount = 0;
    redirectCount <= options.maxRedirects;
    redirectCount += 1
  ) {
    const target = await waitWithSignal(
      resolvePublicUrl(currentUrl, options.resolver),
      signal,
    );
    const response = await waitWithSignal(
      options.requester(target, signal),
      signal,
    );
    const status = response.statusCode;

    if (!status) {
      destroyResponse(response);
      throw new ProductExtractionError(
        "source_unavailable",
        "The source website did not return an HTTP status.",
      );
    }

    if (REDIRECT_STATUSES.has(status)) {
      const location = firstHeaderValue(response.headers.location);
      destroyResponse(response);

      if (!location || redirectCount === options.maxRedirects) {
        throw new ProductExtractionError(
          "source_unavailable",
          "The source website returned too many or an invalid redirect.",
        );
      }

      currentUrl = validateProductUrl(location, currentUrl);
      continue;
    }

    if (status === 404 || status === 410) {
      destroyResponse(response);
      throw new ProductExtractionError(
        "product_not_found",
        `The source website returned status ${status}.`,
        status,
      );
    }

    if (status === 403 || status === 429 || status >= 500) {
      destroyResponse(response);
      throw new ProductExtractionError(
        "source_unavailable",
        `The source website returned status ${status}.`,
        status,
      );
    }

    if (status < 200 || status >= 300) {
      destroyResponse(response);
      throw new ProductExtractionError(
        "unsupported_product",
        `The source website returned unsupported status ${status}.`,
        status,
      );
    }

    const contentType = firstHeaderValue(response.headers["content-type"])
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const contentEncoding = firstHeaderValue(
      response.headers["content-encoding"],
    )
      ?.trim()
      .toLowerCase();

    if (
      !contentType ||
      !HTML_CONTENT_TYPES.includes(contentType) ||
      (contentEncoding && contentEncoding !== "identity")
    ) {
      destroyResponse(response);
      throw new ProductExtractionError(
        "unsupported_product",
        "The source website did not return directly readable HTML.",
      );
    }

    return {
      html: await readHtmlBody(response, options.maxResponseBytes, signal),
      finalUrl: currentUrl,
      httpStatus: status,
    };
  }

  throw new ProductExtractionError(
    "source_unavailable",
    "The source website did not return a product page.",
  );
}

export async function fetchProductHtml(
  value: string,
  options: FetchHtmlOptions = {},
) {
  const initialUrl = validateProductUrl(value);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`The request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  try {
    return await fetchWithSignal(initialUrl, controller.signal, {
      resolver: options.resolver ?? resolveHostname,
      requester: options.requester ?? requestResolvedUrl,
      maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
      maxResponseBytes:
        options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ProductExtractionError(
        "source_unavailable",
        `The source website request timed out after ${timeoutMs}ms.`,
      );
    }

    if (error instanceof ProductExtractionError) {
      throw error;
    }

    throw new ProductExtractionError(
      "source_unavailable",
      error instanceof Error
        ? `The source website request failed: ${error.message}`
        : "The source website request failed.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
