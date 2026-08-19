import "server-only";

import { ProductExtractionError, type HostResolver } from "./types";
import {
  resolveHostname,
  resolvePublicUrl,
  validateProductUrl,
} from "./url-safety";
import { parseBooleanFlag } from "./runtime-config";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5_000_000;

export type RenderedPage = {
  html: string;
  browserMilliseconds: number | null;
  httpStatus?: number;
};

export interface BrowserRenderer {
  readonly configured: boolean;
  render(url: URL): Promise<RenderedPage>;
}

type FetchImplementation = typeof fetch;

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(signal.reason);
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

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The rendered HTML was larger than the configured limit.",
    );
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ProductExtractionError(
          "unsupported_product",
          "The rendered HTML exceeded the configured limit.",
        );
      }

      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export class CloudflareBrowserRenderer implements BrowserRenderer {
  readonly configured: boolean;

  constructor(
    private readonly accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
    private readonly apiToken = process.env.CLOUDFLARE_BROWSER_API_TOKEN,
    private readonly fetchImplementation: FetchImplementation = fetch,
    enabled = parseBooleanFlag(process.env.BROWSER_RENDERING_ENABLED),
    private readonly resolver: HostResolver = resolveHostname,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.configured = enabled && Boolean(accountId && apiToken);
  }

  async render(urlValue: URL) {
    if (!this.configured || !this.accountId || !this.apiToken) {
      throw new ProductExtractionError(
        "unsupported_product",
        "Browser rendering is not configured.",
      );
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error("Browser rendering timed out."));
    }, this.timeoutMs);

    try {
      const url = validateProductUrl(urlValue);
      const publicTarget = await waitWithSignal(
        resolvePublicUrl(url, this.resolver),
        controller.signal,
      );
      const response = await this.fetchImplementation(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/browser-rendering/content`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            url: publicTarget.url.href,
            gotoOptions: {
              waitUntil: "networkidle2",
              timeout: 12_000,
            },
            actionTimeout: 5_000,
            rejectResourceTypes: ["image", "media", "font"],
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new ProductExtractionError(
          "source_unavailable",
          `Browser rendering returned status ${response.status}.`,
          response.status,
        );
      }

      const responseText = await readBoundedResponse(
        response,
        MAX_RESPONSE_BYTES,
      );
      let html = responseText;

      if (response.headers.get("content-type")?.includes("application/json")) {
        try {
          const body = JSON.parse(responseText) as unknown;
          html =
            typeof body === "string"
              ? body
              : body &&
                  typeof body === "object" &&
                  "result" in body &&
                  typeof body.result === "string"
                ? body.result
                : "";
        } catch {
          html = "";
        }
      }

      if (!/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(html)) {
        throw new ProductExtractionError(
          "unsupported_product",
          "Browser rendering did not return usable HTML.",
        );
      }

      const measuredHeader = response.headers.get("x-browser-ms-used");
      const measured = measuredHeader === null ? Number.NaN : Number(measuredHeader);
      return {
        html,
        browserMilliseconds: Number.isFinite(measured)
          ? measured
          : Date.now() - startedAt,
        httpStatus: response.status,
      };
    } catch (error) {
      if (error instanceof ProductExtractionError) {
        throw error;
      }

      throw new ProductExtractionError(
        "source_unavailable",
        controller.signal.aborted
          ? "Browser rendering timed out."
          : "Browser rendering failed.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
