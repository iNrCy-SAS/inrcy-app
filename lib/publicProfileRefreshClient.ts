"use client";

export const PUBLIC_PROFILE_DATA_SAVED_EVENT = "inrcy:public-profile-data-saved";

export type PublicProfileDataSource = "profile" | "activity";

/**
 * Synchronise les surfaces publiques qui dépendent du profil unifié.
 * - événement local : recharge immédiate des données du dashboard / iNrBadge ;
 * - appel serveur : invalidation immédiate des pages publiques iNrSearch.
 */
export async function refreshPublicProfileDependents(
  source: PublicProfileDataSource,
): Promise<boolean> {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(PUBLIC_PROFILE_DATA_SAVED_EVENT, { detail: { source } }),
    );
  }

  const response = await fetch("/api/public-profile/refresh", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
  }).catch(() => null);

  return Boolean(response?.ok);
}
