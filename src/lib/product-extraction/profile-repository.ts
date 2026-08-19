import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { createTemplateKey } from "./profile-match";
import {
  parseProfileRecipe,
  type ProfileRecipeV1,
  type StoredProfile,
} from "./profile-schema";
import type { AcquisitionMethod } from "./types";

export type SiteAcquisitionState = {
  domain: string;
  preferredMethod:
    | "static_fetch"
    | "browser_required"
    | "server_fetch_blocked";
  consecutiveFailureCount: number;
  retryAfter: string | null;
};

export type AiRunRecord = {
  siteProfileId: string | null;
  requestedBy: string | null;
  domain: string;
  templateKey: string;
  runType: "generation" | "repair";
  model: string;
  attempt: number;
  inputChars: number;
  inputTokens: number | null;
  outputChars: number;
  outputTokens: number | null;
  outcome: "validated" | "rejected" | "provider_error";
  errorCode: string | null;
};

export type SaveProfileInput = {
  domain: string;
  recipe: ProfileRecipeV1;
  acquisitionMethod: AcquisitionMethod;
};

export interface ProfileRepository {
  readonly persistent: boolean;
  listProfiles(domain: string): Promise<StoredProfile[]>;
  saveCandidate(input: SaveProfileInput): Promise<StoredProfile>;
  recordProfileSuccess(profile: StoredProfile): Promise<void>;
  recordProfileFailure(profile: StoredProfile): Promise<void>;
  getAcquisitionState(domain: string): Promise<SiteAcquisitionState | null>;
  recordAcquisitionSuccess(
    domain: string,
    method: AcquisitionMethod,
  ): Promise<void>;
  recordAcquisitionFailure(
    domain: string,
    code: string,
    httpStatus?: number,
  ): Promise<void>;
  recordAiRun(record: AiRunRecord): Promise<void>;
}

function mapProfile(row: Record<string, unknown>): StoredProfile | null {
  const recipe = parseProfileRecipe(row.profile_json);
  const acquisitionMethod = row.acquisition_method;
  const requiresBrowser = row.requires_browser;
  const confidence = Number(row.confidence);

  if (
    !recipe ||
    typeof row.id !== "string" ||
    typeof row.domain !== "string" ||
    typeof row.template_key !== "string" ||
    row.url_pattern !== recipe.urlPattern ||
    row.page_type !== recipe.pageType ||
    requiresBrowser !== recipe.requiresBrowser ||
    acquisitionMethod !==
      (recipe.requiresBrowser ? "browser_required" : "static_fetch") ||
    !Number.isFinite(confidence) ||
    Math.abs(confidence - recipe.confidence) > 0.001 ||
    !["candidate", "verified", "degraded", "disabled"].includes(
      String(row.status),
    )
  ) {
    return null;
  }

  return {
    id: row.id,
    domain: row.domain,
    templateKey: row.template_key,
    urlPattern: recipe.urlPattern,
    pageType: row.page_type as StoredProfile["pageType"],
    acquisitionMethod: acquisitionMethod as AcquisitionMethod,
    requiresBrowser,
    recipe,
    confidence,
    status: row.status as StoredProfile["status"],
    successCount: Number(row.success_count),
    failureCount: Number(row.failure_count),
    consecutiveFailureCount: Number(row.consecutive_failure_count),
    version: Number(row.version),
  };
}

function throwDatabaseError(operation: string, error: unknown): never {
  const details =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "Unknown database error";
  throw new Error(`${operation}: ${details}`);
}

class SupabaseProfileRepository implements ProfileRepository {
  readonly persistent = true;

  constructor(private readonly client: SupabaseClient) {}

  async listProfiles(domain: string) {
    const { data, error } = await this.client
      .from("site_profiles")
      .select("*")
      .eq("domain", domain)
      .neq("status", "disabled")
      .order("version", { ascending: false });

    if (error) {
      throwDatabaseError("Unable to read extraction profiles", error);
    }

    return (data ?? []).flatMap((row) => {
      const profile = mapProfile(row);
      return profile ? [profile] : [];
    });
  }

  async saveCandidate(input: SaveProfileInput) {
    const templateKey = createTemplateKey(
      input.domain,
      input.recipe.urlPattern,
    );
    const { data: latest, error: versionError } = await this.client
      .from("site_profiles")
      .select("version")
      .eq("domain", input.domain)
      .eq("template_key", templateKey)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (versionError) {
      throwDatabaseError("Unable to version an extraction profile", versionError);
    }

    const version = Number(latest?.version ?? 0) + 1;
    const { data, error } = await this.client
      .from("site_profiles")
      .insert({
        domain: input.domain,
        template_key: templateKey,
        url_pattern: input.recipe.urlPattern,
        page_type: input.recipe.pageType,
        acquisition_method: input.acquisitionMethod,
        requires_browser: input.recipe.requiresBrowser,
        profile_json: input.recipe,
        confidence: input.recipe.confidence,
        status: "candidate",
        success_count: 1,
        last_verified_at: new Date().toISOString(),
        version,
      })
      .select("*")
      .single();

    if (error) {
      throwDatabaseError("Unable to save an extraction profile", error);
    }

    const profile = mapProfile(data);
    if (!profile) {
      throw new Error("The saved extraction profile could not be validated.");
    }

    return profile;
  }

  async recordProfileSuccess(profile: StoredProfile) {
    const successCount = profile.successCount + 1;
    const { error } = await this.client
      .from("site_profiles")
      .update({
        success_count: successCount,
        consecutive_failure_count: 0,
        status:
          profile.status === "candidate" && successCount >= 2
            ? "verified"
            : profile.status,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (error) {
      throwDatabaseError("Unable to record extraction success", error);
    }
  }

  async recordProfileFailure(profile: StoredProfile) {
    const consecutiveFailureCount = profile.consecutiveFailureCount + 1;
    const { error } = await this.client
      .from("site_profiles")
      .update({
        failure_count: profile.failureCount + 1,
        consecutive_failure_count: consecutiveFailureCount,
        status:
          consecutiveFailureCount >= 2 ? "degraded" : profile.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile.id);

    if (error) {
      throwDatabaseError("Unable to record extraction failure", error);
    }
  }

  async getAcquisitionState(domain: string) {
    const { data, error } = await this.client
      .from("site_acquisition_state")
      .select("*")
      .eq("domain", domain)
      .maybeSingle();

    if (error) {
      throwDatabaseError("Unable to read site acquisition state", error);
    }

    return data
      ? {
          domain: String(data.domain),
          preferredMethod:
            data.preferred_method as SiteAcquisitionState["preferredMethod"],
          consecutiveFailureCount: Number(data.consecutive_failure_count),
          retryAfter:
            typeof data.retry_after === "string" ? data.retry_after : null,
        }
      : null;
  }

  async recordAcquisitionSuccess(domain: string, method: AcquisitionMethod) {
    const { error } = await this.client.from("site_acquisition_state").upsert({
      domain,
      preferred_method: method,
      consecutive_failure_count: 0,
      last_failure_code: null,
      last_http_status: null,
      retry_after: null,
      last_attempted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throwDatabaseError("Unable to record site acquisition success", error);
    }
  }

  async recordAcquisitionFailure(
    domain: string,
    code: string,
    httpStatus?: number,
  ) {
    const existing = await this.getAcquisitionState(domain);
    const failureCount = (existing?.consecutiveFailureCount ?? 0) + 1;
    const blocked = failureCount >= 3;
    const retryAfter = blocked
      ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
      : null;
    const { error } = await this.client.from("site_acquisition_state").upsert({
      domain,
      preferred_method: blocked
        ? "server_fetch_blocked"
        : (existing?.preferredMethod ?? "static_fetch"),
      consecutive_failure_count: failureCount,
      last_failure_code: code,
      last_http_status: httpStatus ?? null,
      retry_after: retryAfter,
      last_attempted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throwDatabaseError("Unable to record site acquisition failure", error);
    }
  }

  async recordAiRun(record: AiRunRecord) {
    const { error } = await this.client.from("profile_ai_runs").insert({
      site_profile_id: record.siteProfileId,
      requested_by: record.requestedBy,
      domain: record.domain,
      template_key: record.templateKey,
      run_type: record.runType,
      model: record.model,
      attempt: record.attempt,
      input_chars: record.inputChars,
      input_tokens: record.inputTokens,
      output_chars: record.outputChars,
      output_tokens: record.outputTokens,
      outcome: record.outcome,
      error_code: record.errorCode,
    });

    if (error) {
      throwDatabaseError("Unable to record AI profile usage", error);
    }
  }
}

export class MemoryProfileRepository implements ProfileRepository {
  readonly persistent: boolean;
  readonly profiles: StoredProfile[] = [];
  readonly aiRuns: AiRunRecord[] = [];
  readonly acquisitions = new Map<string, SiteAcquisitionState>();

  constructor(persistent = false) {
    this.persistent = persistent;
  }

  async listProfiles(domain: string) {
    return this.profiles.filter((profile) => profile.domain === domain);
  }

  async saveCandidate(input: SaveProfileInput) {
    const templateKey = createTemplateKey(
      input.domain,
      input.recipe.urlPattern,
    );
    const version =
      Math.max(
        0,
        ...this.profiles
          .filter((profile) => profile.templateKey === templateKey)
          .map((profile) => profile.version),
      ) + 1;
    const profile: StoredProfile = {
      id: `profile-${this.profiles.length + 1}`,
      domain: input.domain,
      templateKey,
      urlPattern: input.recipe.urlPattern,
      pageType: input.recipe.pageType,
      acquisitionMethod: input.acquisitionMethod,
      requiresBrowser: input.recipe.requiresBrowser,
      recipe: input.recipe,
      confidence: input.recipe.confidence,
      status: "candidate",
      successCount: 1,
      failureCount: 0,
      consecutiveFailureCount: 0,
      version,
    };
    this.profiles.push(profile);
    return profile;
  }

  async recordProfileSuccess(profile: StoredProfile) {
    profile.successCount += 1;
    profile.consecutiveFailureCount = 0;
    if (profile.status === "candidate" && profile.successCount >= 2) {
      profile.status = "verified";
    }
  }

  async recordProfileFailure(profile: StoredProfile) {
    profile.failureCount += 1;
    profile.consecutiveFailureCount += 1;
    if (profile.consecutiveFailureCount >= 2) {
      profile.status = "degraded";
    }
  }

  async getAcquisitionState(domain: string) {
    return this.acquisitions.get(domain) ?? null;
  }

  async recordAcquisitionSuccess(domain: string, method: AcquisitionMethod) {
    this.acquisitions.set(domain, {
      domain,
      preferredMethod: method,
      consecutiveFailureCount: 0,
      retryAfter: null,
    });
  }

  async recordAcquisitionFailure(domain: string, code: string) {
    void code;
    const current = this.acquisitions.get(domain);
    const failureCount = (current?.consecutiveFailureCount ?? 0) + 1;
    this.acquisitions.set(domain, {
      domain,
      preferredMethod:
        failureCount >= 3
          ? "server_fetch_blocked"
          : (current?.preferredMethod ?? "static_fetch"),
      consecutiveFailureCount: failureCount,
      retryAfter:
        failureCount >= 3
          ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
          : null,
    });
  }

  async recordAiRun(record: AiRunRecord) {
    this.aiRuns.push(record);
  }
}

export function createProfileRepository(): ProfileRepository {
  const client = getAdminClient();
  return client
    ? new SupabaseProfileRepository(client)
    : new MemoryProfileRepository(false);
}
