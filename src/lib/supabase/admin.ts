import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null | undefined;

export function getAdminClient() {
  if (adminClient !== undefined) {
    return adminClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !secretKey) {
    adminClient = null;
    return adminClient;
  }

  adminClient = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return adminClient;
}
