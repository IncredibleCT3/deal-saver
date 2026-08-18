"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRICE_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

function watchlistRedirect(
  kind: "error" | "message",
  message: string,
): never {
  const params = new URLSearchParams({ [kind]: message });
  redirect(`/watchlist?${params.toString()}`);
}

function readRequiredText(
  formData: FormData,
  name: string,
  label: string,
  maxLength: number,
) {
  const rawValue = formData.get(name);
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!value) {
    watchlistRedirect("error", `${label} is required.`);
  }

  if (value.length > maxLength) {
    watchlistRedirect(
      "error",
      `${label} must be ${maxLength} characters or fewer.`,
    );
  }

  return value;
}

function readUrl(
  formData: FormData,
  name: string,
  label: string,
  required: true,
): string;
function readUrl(
  formData: FormData,
  name: string,
  label: string,
  required: false,
): string | null;
function readUrl(
  formData: FormData,
  name: string,
  label: string,
  required: boolean,
) {
  const rawValue = formData.get(name);
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!value && !required) {
    return null;
  }

  if (!value) {
    watchlistRedirect("error", `${label} is required.`);
  }

  if (value.length > 2048) {
    watchlistRedirect("error", `${label} is too long.`);
  }

  try {
    const url = new URL(value);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      throw new Error("Invalid URL");
    }

    return url.href;
  } catch {
    watchlistRedirect(
      "error",
      `${label} must be a valid HTTP or HTTPS URL.`,
    );
  }
}

function readPrice(
  formData: FormData,
  name: string,
  label: string,
  required: true,
): string;
function readPrice(
  formData: FormData,
  name: string,
  label: string,
  required: false,
): string | null;
function readPrice(
  formData: FormData,
  name: string,
  label: string,
  required: boolean,
) {
  const rawValue = formData.get(name);
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  if (!value && !required) {
    return null;
  }

  if (!PRICE_PATTERN.test(value)) {
    watchlistRedirect(
      "error",
      `${label} must be between 0 and 9,999,999,999.99 with at most two decimal places.`,
    );
  }

  return value;
}

function readId(formData: FormData) {
  const rawValue = formData.get("id");
  const id = typeof rawValue === "string" ? rawValue : "";

  if (!UUID_PATTERN.test(id)) {
    watchlistRedirect("error", "The tracked product is invalid.");
  }

  return id;
}

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (typeof userId !== "string") {
    redirect("/auth/sign-in");
  }

  return { supabase, userId };
}

export async function addTrackedProduct(formData: FormData) {
  const productName = readRequiredText(
    formData,
    "product_name",
    "Product name",
    200,
  );
  const retailer = readRequiredText(formData, "retailer", "Retailer", 100);
  const productUrl = readUrl(
    formData,
    "product_url",
    "Product URL",
    true,
  );
  const imageUrl = readUrl(formData, "image_url", "Image URL", false);
  const currentPrice = readPrice(
    formData,
    "current_price",
    "Current price",
    true,
  );
  const targetPrice = readPrice(
    formData,
    "target_price",
    "Target price",
    false,
  );
  const { supabase, userId } = await requireUser();

  const { error } = await supabase.from("tracked_products").insert({
    user_id: userId,
    retailer,
    product_url: productUrl,
    product_name: productName,
    image_url: imageUrl,
    current_price: currentPrice,
    target_price: targetPrice,
  });

  if (error?.code === "23505") {
    watchlistRedirect("error", "That product URL is already in your watchlist.");
  }

  if (error) {
    watchlistRedirect("error", "The product could not be added. Please try again.");
  }

  revalidatePath("/watchlist");
  watchlistRedirect("message", "Product added to your watchlist.");
}

export async function updateTargetPrice(formData: FormData) {
  const id = readId(formData);
  const targetPrice = readPrice(
    formData,
    "target_price",
    "Target price",
    false,
  );
  const { supabase, userId } = await requireUser();

  const { data, error } = await supabase
    .from("tracked_products")
    .update({ target_price: targetPrice })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    watchlistRedirect(
      "error",
      "The target price could not be updated. Please try again.",
    );
  }

  revalidatePath("/watchlist");
  watchlistRedirect("message", "Target price updated.");
}

export async function removeTrackedProduct(formData: FormData) {
  const id = readId(formData);
  const { supabase, userId } = await requireUser();

  const { data, error } = await supabase
    .from("tracked_products")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    watchlistRedirect(
      "error",
      "The product could not be removed. Please try again.",
    );
  }

  revalidatePath("/watchlist");
  watchlistRedirect("message", "Product removed from your watchlist.");
}
