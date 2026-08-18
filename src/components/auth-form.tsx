import Link from "next/link";

type AuthFormProps = {
  action: (formData: FormData) => Promise<void>;
  alternateHref: string;
  alternateLabel: string;
  error?: string;
  message?: string;
  mode: "sign-in" | "sign-up";
};

export function AuthForm({
  action,
  alternateHref,
  alternateLabel,
  error,
  message,
  mode,
}: AuthFormProps) {
  const isSignUp = mode === "sign-up";

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Link href="/" className="text-sm font-semibold text-emerald-700">
          Deal Saver
        </Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {isSignUp
            ? "Start with a free Deal Saver account."
            : "Sign in to access your dashboard."}
        </p>

        {error ? (
          <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}

        <form action={action} className="mt-6 space-y-5">
          <label className="block text-sm font-medium text-slate-800">
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Password
            <input
              name="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={isSignUp ? 8 : undefined}
              required
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-950 px-4 py-3 font-medium text-white hover:bg-slate-800"
          >
            {isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          <Link href={alternateHref} className="font-medium text-emerald-700">
            {alternateLabel}
          </Link>
        </p>
      </section>
    </main>
  );
}
