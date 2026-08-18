import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  const signInUrl = new URL("/auth/sign-in", request.url);
  signInUrl.searchParams.set(
    "error",
    "The confirmation link is invalid or has expired.",
  );
  return NextResponse.redirect(signInUrl);
}
