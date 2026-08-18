"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function authRedirect(
  pathname: string,
  kind: "error" | "message",
  message: string,
): never {
  const params = new URLSearchParams({ [kind]: message });
  redirect(`${pathname}?${params.toString()}`);
}

function readCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

export async function signIn(formData: FormData) {
  const credentials = readCredentials(formData);

  if (!credentials) {
    authRedirect("/auth/sign-in", "error", "Email and password are required.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    authRedirect("/auth/sign-in", "error", error.message);
  }

  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  const credentials = readCredentials(formData);

  if (!credentials) {
    authRedirect("/auth/sign-up", "error", "Email and password are required.");
  }

  if (credentials.password.length < 8) {
    authRedirect(
      "/auth/sign-up",
      "error",
      "Password must be at least 8 characters.",
    );
  }

  const siteUrl = (process.env.SITE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...credentials,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    authRedirect("/auth/sign-up", "error", error.message);
  }

  if (data.session) {
    redirect("/dashboard");
  }

  authRedirect(
    "/auth/sign-in",
    "message",
    "Check your email to confirm your account, then sign in.",
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
