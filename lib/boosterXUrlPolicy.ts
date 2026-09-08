import { findForbiddenXUrl } from "@/lib/xChannel";

export type BoosterXUrlPolicyPost = {
  title?: unknown;
  content?: unknown;
  hashtags?: unknown;
  cta?: unknown;
  ctaUrl?: unknown;
  ctaPhone?: unknown;
};

export type BoosterXForbiddenUrlField = {
  field: "title" | "content" | "hashtags" | "cta" | "ctaUrl" | "ctaPhone";
  label: string;
  match: string;
};

function normalizeFieldValue(value: unknown) {
  return Array.isArray(value) ? value.join(" ") : String(value ?? "");
}

/**
 * Localise précisément une URL interdite dans les champs éditables de X.
 * La valeur n'est jamais modifiée : le pro garde la main pour la corriger.
 */
export function getBoosterXForbiddenUrlFields(
  post: BoosterXUrlPolicyPost | null | undefined,
  options?: { hashtagsInput?: unknown },
): BoosterXForbiddenUrlField[] {
  const hashtagValue =
    options && Object.prototype.hasOwnProperty.call(options, "hashtagsInput")
      ? [post?.hashtags, options.hashtagsInput]
      : post?.hashtags;
  const fields = [
    ["title", "titre", post?.title],
    ["content", "contenu", post?.content],
    ["hashtags", "hashtags", hashtagValue],
    ["cta", "texte du CTA", post?.cta],
    ["ctaUrl", "URL du CTA", post?.ctaUrl],
    ["ctaPhone", "champ téléphone du CTA", post?.ctaPhone],
  ] as const;

  return fields.flatMap(([field, label, value]) => {
    const match = findForbiddenXUrl(normalizeFieldValue(value));
    return match ? [{ field, label, match }] : [];
  });
}

export function getBoosterXUrlBlockerMessage(
  fields: readonly BoosterXForbiddenUrlField[],
) {
  const labels = Array.from(new Set(fields.map((field) => field.label)));
  const location = labels.length ? ` dans : ${labels.join(", ")}` : "";
  return `Les liens et URL ne sont pas autorisés sur X. Supprimez le lien${location} pour publier.`;
}
