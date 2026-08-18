import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10">
      <nav className="flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Deal Saver
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/auth/sign-in"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Create account
          </Link>
        </div>
      </nav>

      <section className="flex flex-1 items-center py-20">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
            Price tracking without the busywork
          </p>
          <h1 className="text-5xl font-semibold tracking-tight text-slate-950 sm:text-7xl">
            Bookmark what you want. We&apos;ll watch the price.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Deal Saver helps you keep track of products you care about and know
            when the price reaches your target.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white hover:bg-emerald-700"
            >
              Get started
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-slate-300 px-5 py-3 font-medium text-slate-800 hover:bg-slate-100"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
