import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    redirect("/auth/sign-in");
  }

  const email = typeof claims.email === "string" ? claims.email : "your account";

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-8 sm:px-10">
      <nav className="flex items-center justify-between border-b border-slate-200 pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Deal Saver
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Sign out
          </button>
        </form>
      </nav>

      <section className="py-16">
        <p className="text-sm font-medium text-emerald-700">Signed in as {email}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
          Your dashboard
        </h1>
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10">
          <h2 className="text-xl font-semibold text-slate-900">Your watchlist</h2>
          <p className="mt-2 max-w-xl leading-7 text-slate-600">
            Add products by URL, keep their current prices in one place, and
            set optional target prices.
          </p>
          <Link
            href="/watchlist"
            className="mt-6 inline-block rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white hover:bg-emerald-700"
          >
            Open watchlist
          </Link>
        </div>
      </section>
    </main>
  );
}
