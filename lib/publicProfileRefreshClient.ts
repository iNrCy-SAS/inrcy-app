"use client";
import { getActiveBrowserUserId } from "./browserAccountCache";

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
  const accountId = getActiveBrowserUserId();

  const response = await fetch("/api/public-profile/refresh", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
  }).catch(() => null);

  if (typeof window !== "undefined" && getActiveBrowserUserId() === accountId) {
    window.dispatchEvent(new CustomEvent(PUBLIC_PROFILE_DATA_SAVED_EVENT, { detail: { source } }));
  }

  return Boolean(response?.ok);
}
