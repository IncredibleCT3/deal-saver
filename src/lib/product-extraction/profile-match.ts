import { createHash } from "node:crypto";
import type { StoredProfile } from "./profile-schema";
import { isSafeUrlPattern } from "./profile-schema";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesUrlPattern(pathname: string, pattern: string) {
  if (!isSafeUrlPattern(pattern)) {
    return false;
  }

  const expression = pattern
    .split("*")
    .map(escapeRegex)
    .join("[^/]+");

  return new RegExp(`^${expression}/?$`, "i").test(pathname);
}

function patternSpecificity(pattern: string) {
  return pattern.replaceAll("*", "").length;
}

function statusRank(status: StoredProfile["status"]) {
  switch (status) {
    case "verified":
      return 3;
    case "candidate":
      return 2;
    case "degraded":
      return 1;
    default:
      return 0;
  }
}

export function findMatchingProfile(url: URL, profiles: StoredProfile[]) {
  return profiles
    .filter(
      (profile) =>
        profile.status !== "disabled" &&
        profile.domain === url.hostname.toLowerCase() &&
        matchesUrlPattern(url.pathname, profile.urlPattern),
    )
    .sort((left, right) => {
      return (
        statusRank(right.status) - statusRank(left.status) ||
        patternSpecificity(right.urlPattern) -
          patternSpecificity(left.urlPattern) ||
        right.confidence - left.confidence ||
        right.version - left.version
      );
    })[0] ?? null;
}

export function createTemplateKey(domain: string, pattern: string) {
  return createHash("sha256")
    .update(`${domain.toLowerCase()}\n${pattern}`)
    .digest("hex")
    .slice(0, 32);
}
