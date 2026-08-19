import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";
import {
  addTrackedProduct,
  removeTrackedProduct,
  updateTargetPrice,
} from "./actions";

type WatchlistPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
  }>;
};

type TrackedProduct = {
  id: string;
  retailer: string;
  product_url: string;
  product_name: string;
  image_url: string | null;
  current_price: string | number;
  currency: string;
  price_kind: "exact" | "starting_at";
  target_price: string | number | null;
  last_checked_at: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatPrice(value: string | number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
}

export default async function WatchlistPage({
  searchParams,
}: WatchlistPageProps) {
  const { error: actionError, message } = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;

  if (typeof userId !== "string") {
    redirect("/auth/sign-in");
  }

  const { data, error } = await supabase
    .from("tracked_products")
    .select(
      "id, retailer, product_url, product_name, image_url, current_price, currency, price_kind, target_price, last_checked_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("Watchlist query failed.", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
    }

    throw new Error("Unable to load the watchlist.");
  }

  const products = (data ?? []) as TrackedProduct[];

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 sm:px-10">
      <nav className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Deal Saver
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Dashboard
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </nav>

      <header className="py-12">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
          Watchlist
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
          Products you&apos;re watching
        </h1>
        <p className="mt-3 max-w-2xl leading-7 text-slate-600">
          Paste a product URL and Deal Saver will retrieve reliable product
          details exposed by the source website before saving it.
        </p>
      </header>

      {actionError ? (
        <p className="mb-8 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}
      {message ? (
        <p className="mb-8 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-semibold text-slate-950">Add a product</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Public HTTPS product pages with structured product data work best.
        </p>
        <form action={addTrackedProduct} className="mt-6 grid gap-5 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800 md:col-span-2">
            Product URL
            <input
              name="product_url"
              type="url"
              inputMode="url"
              maxLength={2048}
              placeholder="https://shop.example/product/..."
              required
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="block text-sm font-medium text-slate-800">
            Target price <span className="font-normal text-slate-500">(optional)</span>
            <input
              name="target_price"
              type="number"
              inputMode="decimal"
              min="0"
              max="9999999999.99"
              step="0.01"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white hover:bg-emerald-700"
            >
              Check and add to watchlist
            </button>
          </div>
        </form>
      </section>

      <section className="py-12">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold text-slate-950">
            Saved products
          </h2>
          <p className="text-sm text-slate-500">
            {products.length} {products.length === 1 ? "product" : "products"}
          </p>
        </div>

        {products.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h3 className="text-lg font-semibold text-slate-900">
              Your watchlist is empty
            </h3>
            <p className="mt-2 text-slate-600">
              Add your first product using the form above.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-5">
            {products.map((product) => (
              <article
                key={product.id}
                className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-[8rem_1fr]"
              >
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                  {product.image_url ? (
                    // Product images come from source websites at runtime.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.image_url}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <span className="px-3 text-center text-sm text-slate-500">
                      No image
                    </span>
                  )}
                </div>

                <div>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-emerald-700">
                        {product.retailer}
                      </p>
                      <h3 className="mt-1 text-xl font-semibold text-slate-950">
                        {product.product_name}
                      </h3>
                      <a
                        href={product.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-sm font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-950"
                      >
                        Open retailer page
                      </a>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-500">
                        {product.price_kind === "starting_at"
                          ? "Starting at"
                          : "Current price"}
                      </p>
                      <p className="text-2xl font-semibold text-slate-950">
                        {formatPrice(product.current_price, product.currency)}
                      </p>
                    </div>
                  </div>

                  <p className="mt-5 text-xs text-slate-500">
                    Last checked {dateFormatter.format(new Date(product.last_checked_at))}
                  </p>

                  <div className="mt-6 flex flex-wrap items-end justify-between gap-5 border-t border-slate-100 pt-5">
                    <form action={updateTargetPrice} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="id" value={product.id} />
                      <label className="block text-sm font-medium text-slate-800">
                        Target price
                        <input
                          name="target_price"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="9999999999.99"
                          step="0.01"
                          defaultValue={product.target_price ?? ""}
                          placeholder="No target"
                          className="mt-2 w-40 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Update target
                      </button>
                    </form>

                    <form action={removeTrackedProduct}>
                      <input type="hidden" name="id" value={product.id} />
                      <button
                        type="submit"
                        className="rounded-lg px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
