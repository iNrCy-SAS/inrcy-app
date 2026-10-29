export type InrSearchMinimalStatusReason =
  | "published"
  | "slug_missing"
  | "config_missing"
  | "page_disabled"
  | "bubble_disabled"
  | "subscription_inactive"
  | "profile_missing"
  | "data_unavailable";

export type InrSearchMinimalStatus = {
  published: boolean;
  reason: InrSearchMinimalStatusReason;
  slug: string;
  accountId: string | null;
  publicUrl: string;
  subscriptionStatus?: string;
};

export type InrSearchMinimalEligibility = {
  allowed: boolean;
  reason: "published" | "bubble_disabled" | "subscription_inactive";
  subscriptionStatus?: string;
};

const PUBLIC_ORIGIN = (
  (process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com")
    .replace(/\/$/, "") === "https://inrcy.com"
    ? "https://app.inrcy.com"
    : (process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN ||
        "https://app.inrcy.com")
        .replace(/\/$/, "")
);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clean(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeInrSearchMinimalSlug(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function buildInrSearchMinimalPublicUrl(slug: string) {
  return `${PUBLIC_ORIGIN}/entreprises/${encodeURIComponent(slug)}`;
}

/**
 * Décide si une page peut être annoncée comme publiée à partir des seules
 * données de configuration et d'éligibilité. Aucun contenu de page, événement
 * Booster ni objet Storage n'est nécessaire pour ce statut de contrôle.
 */
export function resolveInrSearchMinimalStatus(params: {
  accountId: unknown;
  inrSearch: unknown;
  eligibility?: InrSearchMinimalEligibility | null;
}): InrSearchMinimalStatus {
  const accountId = clean(params.accountId, 120);
  const config = asRecord(params.inrSearch);
  const slug = normalizeInrSearchMinimalSlug(config.slug);
  const base = {
    slug,
    accountId: accountId || null,
    publicUrl: slug ? buildInrSearchMinimalPublicUrl(slug) : "",
  };

  if (!slug) return { ...base, published: false, reason: "slug_missing" };
  if (!accountId) {
    return { ...base, published: false, reason: "config_missing" };
  }
  if (config.activationVersion === 1 && config.activationRequested !== true) return { ...base, published: false, reason: "page_disabled" };
  if (config.activationVersion === 1 && config.activationRequested === true && config.publicationReady === false) {
    return { ...base, published: false, reason: "profile_missing" };
  }
  if (config.enabled !== true) {
    return { ...base, published: false, reason: "page_disabled" };
  }
  if (!params.eligibility) {
    return { ...base, published: false, reason: "data_unavailable" };
  }
  if (!params.eligibility.allowed) {
    return {
      ...base,
      published: false,
      reason:
        params.eligibility.reason === "subscription_inactive"
          ? "subscription_inactive"
          : "bubble_disabled",
      subscriptionStatus: clean(
        params.eligibility.subscriptionStatus,
        60,
      ),
    };
  }
  return {
    ...base,
    published: true,
    reason: "published",
    subscriptionStatus: clean(params.eligibility.subscriptionStatus, 60),
  };
}
