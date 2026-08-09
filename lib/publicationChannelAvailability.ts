export type PublicationChannelAvailabilityState = {
  connected?: boolean;
  expired?: boolean;
  requiresUpdate?: boolean;
  connection_status?: string | null;
};

/**
 * Single source of truth shared by the Booster UI and the publication worker.
 * A channel is publishable only when both the persisted connection and its
 * display status explicitly say that it is connected.
 */
export function isOfficialPublicationChannelConnected(
  state: PublicationChannelAvailabilityState | null | undefined,
) {
  return state?.connected === true && state.connection_status === "connected";
}

/**
 * Expired credentials and connections explicitly marked for an OAuth update
 * must be displayed in orange and must never be selectable in Booster.
 */
export function publicationChannelRequiresReconnect(
  state: PublicationChannelAvailabilityState | null | undefined,
) {
  return Boolean(
    state?.expired === true ||
      state?.requiresUpdate === true ||
      state?.connection_status === "needs_update",
  );
}

export function hasUsableRefreshCredential(
  refreshTokenPresent: boolean,
  refreshExpiresAt: unknown,
  options: { nowMs?: number; skewSeconds?: number } = {},
) {
  if (!refreshTokenPresent) return false;
  if (typeof refreshExpiresAt !== "string" || !refreshExpiresAt.trim()) {
    // Most Google refresh tokens, and some legacy provider records, do not
    // expose a deterministic expiry. They remain reusable until rejected by
    // the provider, at which point the runtime reconnect marker takes over.
    return true;
  }

  const expiresAtMs = Date.parse(refreshExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;
  const nowMs = options.nowMs ?? Date.now();
  const skewMs = (options.skewSeconds ?? 60) * 1000;
  return expiresAtMs > nowMs + skewMs;
}
