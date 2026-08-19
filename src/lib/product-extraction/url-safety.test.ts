import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProductExtractionError, type HostResolver } from "./types";
import {
  isPublicIpAddress,
  resolvePublicUrl,
  validateProductUrl,
} from "./url-safety";

const publicResolver: HostResolver = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("product URL validation", () => {
  it("accepts normalized public HTTPS URLs", () => {
    const url = validateProductUrl(
      "https://Shop.Example/products/widget?variant=1#details",
    );

    assert.equal(
      url.href,
      "https://shop.example/products/widget?variant=1",
    );
  });

  it("rejects HTTP, credentials, custom ports, and local hostnames", () => {
    for (const value of [
      "http://shop.example/product/1",
      "https://user:password@shop.example/product/1",
      "https://shop.example:8443/product/1",
      "https://localhost/product/1",
      "https://service.local/product/1",
    ]) {
      assert.throws(
        () => validateProductUrl(value),
        (error) => error instanceof ProductExtractionError,
      );
    }
  });

  it("rejects private, reserved, link-local, and loopback IP literals", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "100.64.0.1",
      "169.254.169.254",
      "192.0.2.1",
      "2130706433",
      "0x7f000001",
      "[::1]",
      "[fe80::1]",
      "[fc00::1]",
    ]) {
      assert.throws(
        () => validateProductUrl(`https://${address}/product/1`),
        (error) =>
          error instanceof ProductExtractionError &&
          error.code === "unsafe_url",
      );
    }
  });
});

describe("public address resolution", () => {
  it("classifies only globally routable unicast addresses as public", () => {
    assert.equal(isPublicIpAddress("8.8.8.8"), true);
    assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
    assert.equal(isPublicIpAddress("192.168.1.1"), false);
    assert.equal(isPublicIpAddress("::ffff:127.0.0.1"), false);
    assert.equal(isPublicIpAddress("ff02::1"), false);
  });

  it("returns a validated address for a public hostname", async () => {
    const resolved = await resolvePublicUrl(
      new URL("https://shop.example/product/1"),
      publicResolver,
    );

    assert.deepEqual(resolved.address, {
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("fails closed when any resolved address is non-public", async () => {
    const mixedResolver: HostResolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];

    await assert.rejects(
      () =>
        resolvePublicUrl(
          new URL("https://shop.example/product/1"),
          mixedResolver,
        ),
      (error) =>
        error instanceof ProductExtractionError && error.code === "unsafe_url",
    );
  });

  it("reports DNS failures as source unavailable", async () => {
    const failingResolver: HostResolver = async () => {
      throw new Error("lookup failed");
    };

    await assert.rejects(
      () =>
        resolvePublicUrl(
          new URL("https://shop.example/product/1"),
          failingResolver,
        ),
      (error) =>
        error instanceof ProductExtractionError &&
        error.code === "source_unavailable",
    );
  });
});
