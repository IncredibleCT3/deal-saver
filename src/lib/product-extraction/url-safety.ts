import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import {
  ProductExtractionError,
  type HostResolver,
  type ResolvedAddress,
  type ResolvedPublicUrl,
} from "./types";

export const MAX_URL_LENGTH = 2048;

const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

function normalizedHostname(hostname: string) {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function addressLiteral(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicIpAddress(value: string) {
  if (!ipaddr.isValid(value)) {
    return false;
  }

  let address = ipaddr.parse(value);

  if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
    address = address.toIPv4Address();
  }

  return address.range() === "unicast";
}

export function validateProductUrl(value: string | URL, baseUrl?: URL) {
  let url: URL;

  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value, baseUrl);
  } catch {
    throw new ProductExtractionError(
      "invalid_url",
      "The submitted product URL could not be parsed.",
    );
  }

  const hostname = normalizedHostname(url.hostname);

  if (
    url.href.length > MAX_URL_LENGTH ||
    url.protocol !== "https:" ||
    !hostname ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new ProductExtractionError(
      "invalid_url",
      "Product URLs must use HTTPS without credentials or a custom port.",
    );
  }

  if (
    LOCAL_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new ProductExtractionError(
      "unsafe_url",
      "The product URL points to a local hostname.",
    );
  }

  const literal = addressLiteral(hostname);

  if (ipaddr.isValid(literal) && !isPublicIpAddress(literal)) {
    throw new ProductExtractionError(
      "unsafe_url",
      "The product URL points to a non-public IP address.",
    );
  }

  url.hostname = hostname;
  url.hash = "";
  return url;
}

export const resolveHostname: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true,
  });

  return addresses.flatMap((address): ResolvedAddress[] =>
    address.family === 4 || address.family === 6
      ? [{ address: address.address, family: address.family }]
      : [],
  );
};

export async function resolvePublicUrl(
  url: URL,
  resolver: HostResolver = resolveHostname,
): Promise<ResolvedPublicUrl> {
  const validatedUrl = validateProductUrl(url);
  const hostname = addressLiteral(validatedUrl.hostname);
  const literalFamily = ipaddr.isValid(hostname)
    ? ipaddr.parse(hostname).kind() === "ipv4"
      ? 4
      : 6
    : null;

  let addresses: readonly ResolvedAddress[];

  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await resolver(hostname);
  } catch (error) {
    throw new ProductExtractionError(
      "source_unavailable",
      error instanceof Error
        ? `DNS resolution failed: ${error.message}`
        : "DNS resolution failed.",
    );
  }

  if (addresses.length === 0) {
    throw new ProductExtractionError(
      "source_unavailable",
      "DNS resolution returned no usable addresses.",
    );
  }

  if (
    addresses.some(
      ({ address, family }) =>
        (family !== 4 && family !== 6) || !isPublicIpAddress(address),
    )
  ) {
    throw new ProductExtractionError(
      "unsafe_url",
      "The product hostname resolves to a non-public IP address.",
    );
  }

  return {
    url: validatedUrl,
    address: addresses[0],
  };
}

export function normalizeEmbeddedHttpsUrl(
  value: string,
  baseUrl: URL,
  options: { sameHostname?: boolean } = {},
) {
  let url: URL;

  try {
    url = validateProductUrl(value, baseUrl);
  } catch {
    return null;
  }

  if (
    options.sameHostname &&
    normalizedHostname(url.hostname) !== normalizedHostname(baseUrl.hostname)
  ) {
    return null;
  }

  return url.href;
}
