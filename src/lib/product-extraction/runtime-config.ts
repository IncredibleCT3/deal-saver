import "server-only";

export type RuntimeVariableStatus = "configured" | "missing" | "invalid";

export function parseBooleanFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function booleanStatus(value: string | undefined): RuntimeVariableStatus {
  if (!value?.trim()) {
    return "missing";
  }

  return ["true", "false"].includes(value.trim().toLowerCase())
    ? "configured"
    : "invalid";
}

function stringStatus(
  value: string | undefined,
  maxLength = Number.POSITIVE_INFINITY,
): RuntimeVariableStatus {
  const normalized = value?.trim();
  if (!normalized) {
    return "missing";
  }

  return normalized.length <= maxLength ? "configured" : "invalid";
}

function inputLimitStatus(value: string | undefined): RuntimeVariableStatus {
  if (!value?.trim()) {
    return "missing";
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 5_000 && parsed <= 50_000
    ? "configured"
    : "invalid";
}

export function getRuntimeConfigurationStatus() {
  return {
    AI_PROFILING_ENABLED: booleanStatus(process.env.AI_PROFILING_ENABLED),
    AI_PROFILE_MODEL: stringStatus(process.env.AI_PROFILE_MODEL, 100),
    AI_PROFILE_MAX_INPUT: inputLimitStatus(process.env.AI_PROFILE_MAX_INPUT),
    OPENAI_API_KEY: stringStatus(process.env.OPENAI_API_KEY),
    BROWSER_RENDERING_ENABLED: booleanStatus(
      process.env.BROWSER_RENDERING_ENABLED,
    ),
    CLOUDFLARE_ACCOUNT_ID: stringStatus(process.env.CLOUDFLARE_ACCOUNT_ID),
    CLOUDFLARE_BROWSER_API_TOKEN: stringStatus(
      process.env.CLOUDFLARE_BROWSER_API_TOKEN,
    ),
  } satisfies Record<string, RuntimeVariableStatus>;
}
