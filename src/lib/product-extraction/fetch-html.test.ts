import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import {
  fetchProductHtml,
  type RequestExecutor,
  type TransportResponse,
} from "./fetch-html";
import {
  ProductExtractionError,
  type HostResolver,
  type ResolvedPublicUrl,
} from "./types";

const publicResolver: HostResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

function response(
  statusCode: number,
  headers: TransportResponse["headers"] = {},
  body = "",
): TransportResponse {
  return {
    statusCode,
    headers,
    body: Readable.from([Buffer.from(body)]),
  };
}

describe("safe HTML fetching", () => {
  it("passes a prevalidated, pinned address to the request transport", async () => {
    const requestedTargets: ResolvedPublicUrl[] = [];
    const requester: RequestExecutor = async (target) => {
      requestedTargets.push(target);
      return response(
        200,
        { "content-type": "text/html; charset=utf-8" },
        "<html><body>Product</body></html>",
      );
    };

    const page = await fetchProductHtml(
      "https://shop.example/product/1#details",
      { resolver: publicResolver, requester },
    );

    assert.equal(requestedTargets[0]?.address.address, "93.184.216.34");
    assert.equal(page.finalUrl.href, "https://shop.example/product/1");
    assert.match(page.html, /Product/);
  });

  it("validates and resolves every redirect destination", async () => {
    const requestedHosts: string[] = [];
    const resolvedHosts: string[] = [];
    const resolver: HostResolver = async (hostname) => {
      resolvedHosts.push(hostname);
      return [{ address: "93.184.216.34", family: 4 }];
    };
    const requester: RequestExecutor = async (target) => {
      requestedHosts.push(target.url.hostname);

      return requestedHosts.length === 1
        ? response(302, {
            location: "https://store.example/products/1",
          })
        : response(
            200,
            { "content-type": "application/xhtml+xml" },
            "<html></html>",
          );
    };

    const page = await fetchProductHtml("https://shop.example/product/1", {
      resolver,
      requester,
    });

    assert.deepEqual(requestedHosts, ["shop.example", "store.example"]);
    assert.deepEqual(resolvedHosts, ["shop.example", "store.example"]);
    assert.equal(page.finalUrl.hostname, "store.example");
  });

  it("rejects a redirect to a private address before making it", async () => {
    let requestCount = 0;
    const requester: RequestExecutor = async () => {
      requestCount += 1;
      return response(302, { location: "https://127.0.0.1/admin" });
    };

    await assert.rejects(
      () =>
        fetchProductHtml("https://shop.example/product/1", {
          resolver: publicResolver,
          requester,
        }),
      (error) =>
        error instanceof ProductExtractionError && error.code === "unsafe_url",
    );
    assert.equal(requestCount, 1);
  });

  it("reports blocked and rate-limited responses as unavailable", async () => {
    for (const status of [403, 429, 503]) {
      await assert.rejects(
        () =>
          fetchProductHtml("https://shop.example/product/1", {
            resolver: publicResolver,
            requester: async () => response(status),
          }),
        (error) =>
          error instanceof ProductExtractionError &&
          error.code === "source_unavailable",
      );
    }
  });

  it("rejects non-HTML and oversized responses", async () => {
    await assert.rejects(
      () =>
        fetchProductHtml("https://shop.example/product/1", {
          resolver: publicResolver,
          requester: async () =>
            response(200, { "content-type": "application/json" }, "{}"),
        }),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );

    await assert.rejects(
      () =>
        fetchProductHtml("https://shop.example/product/1", {
          resolver: publicResolver,
          requester: async () =>
            response(200, {
              "content-type": "text/html",
              "content-encoding": "gzip",
            }),
        }),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );

    await assert.rejects(
      () =>
        fetchProductHtml("https://shop.example/product/1", {
          resolver: publicResolver,
          requester: async () =>
            response(200, { "content-type": "text/html" }, "too large"),
          maxResponseBytes: 4,
        }),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "unsupported_product",
    );
  });

  it("enforces a timeout across resolution and retrieval", async () => {
    const neverResolves: HostResolver = () => new Promise(() => undefined);

    await assert.rejects(
      () =>
        fetchProductHtml("https://shop.example/product/1", {
          resolver: neverResolves,
          requester: async () => response(200),
          timeoutMs: 10,
        }),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "source_unavailable" &&
        /timed out/i.test(error.message),
    );
  });

  it("enforces the timeout while reading a stalled response body", async () => {
    const stalledBody = new Readable({ read() {} });
    stalledBody.push(Buffer.from("<html>"));

    await assert.rejects(
      () =>
        fetchProductHtml("https://shop.example/product/1", {
          resolver: publicResolver,
          requester: async () => ({
            statusCode: 200,
            headers: { "content-type": "text/html" },
            body: stalledBody,
          }),
          timeoutMs: 10,
        }),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "source_unavailable" &&
        /timed out/i.test(error.message),
    );
    assert.equal(stalledBody.destroyed, true);
  });
});
