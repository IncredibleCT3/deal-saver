import { executeProfile } from "./profile-execute";
import { matchesUrlPattern } from "./profile-match";
import type { ProfileRecipeV1 } from "./profile-schema";
import { ProductExtractionError } from "./types";
import { validateProductUrl } from "./url-safety";

const MIN_PROFILE_CONFIDENCE = 0.7;

export function validateProfileAgainstPage(
  recipe: ProfileRecipeV1,
  html: string,
  finalUrlValue: string | URL,
) {
  const finalUrl = validateProductUrl(finalUrlValue);

  if (!matchesUrlPattern(finalUrl.pathname, recipe.urlPattern)) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The candidate profile pattern does not match the submitted page.",
    );
  }

  if (recipe.confidence < MIN_PROFILE_CONFIDENCE) {
    throw new ProductExtractionError(
      "unsupported_product",
      "The candidate profile confidence was too low.",
    );
  }

  return executeProfile(recipe, html, finalUrl);
}
