import { asRecord, asString } from "@/lib/tsSafe";

export type ConnectionDisplayStatus = "connected" | "needs_update" | "disconnected";

const RECONNECT_MARKER_KEYS = [
  "needs_reconnect",
  "reconnect_required",
  "token_invalid",
  "token_revoked",
  "auth_invalid",
  "oauth_reconnect_required",
  "tiktok_needs_reconnect",
  "tiktok_stats_needs_reconnect_at",
  "tiktok_token_invalid_at",
] as const;

export function hasConnectionReconnectMarker(node: unknown): boolean {
  const rec = asRecord(node);
  return RECONNECT_MARKER_KEYS.some((key) => {
    const value = rec[key];
    if (value === true) return true;
    return typeof value === "string" && value.trim().length > 0;
  });
}

function clearConnectionReconnectMarkers<T extends Record<string, unknown>>(node: T): T {
  const next = { ...node };
  for (const key of RECONNECT_MARKER_KEYS) delete next[key];
  delete next["needs_reconnect_at"];
  delete next["needs_reconnect_reason"];
  delete next["needs_reconnect_channel"];
  delete next["needs_reconnect_stage"];
  return next;
}

export type ConnectionKind =
  | "mail:gmail"
  | "mail:microsoft"
  | "mail:imap"
  | "channel:gmb"
  | "channel:facebook"
  | "channel:instagram"
  | "channel:linkedin"
  | "channel:tiktok"
  | "channel:youtube_shorts"
  | "channel:pinterest";

/**
 * Version centrale des autorisations/contrats par connexion.
 *
 * Important :
 * - Ne pas modifier ces valeurs pour une simple mise à jour UI/build.
 * - À augmenter uniquement quand une ancienne autorisation devient insuffisante
 *   (nouveau scope OAuth, nouvelle donnée obligatoire, gros changement d’API provider).
 * - Les anciennes connexions sans version sont considérées comme version 1.
 */
export const CONNECTION_REQUIRED_VERSIONS: Record<ConnectionKind, number> = {
  "mail:gmail": 1,
  "mail:microsoft": 1,
  "mail:imap": 1,
  "channel:gmb": 1,
  "channel:facebook": 1,
  "channel:instagram": 1,
  "channel:linkedin": 2,
  "channel:tiktok": 2,
  "channel:youtube_shorts": 1,
  "channel:pinterest": 1,
};

export function getRequiredConnectionVersion(kind: ConnectionKind): number {
  return CONNECTION_REQUIRED_VERSIONS[kind] ?? 1;
}

export function readConnectionVersion(node: unknown): number {
  const rec = asRecord(node);
  const raw = rec["connection_version"] ?? rec["connectionVersion"] ?? rec["auth_version"] ?? rec["authVersion"] ?? 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
}

export function isConnectionUpdateRequired(kind: ConnectionKind, versionNode: unknown): boolean {
  return readConnectionVersion(versionNode) < getRequiredConnectionVersion(kind);
}

export function getConnectionDisplayStatus(
  isConnected: boolean,
  kind: ConnectionKind,
  versionNode: unknown,
): ConnectionDisplayStatus {
  if (hasConnectionReconnectMarker(versionNode)) return "needs_update";
  if (!isConnected) return "disconnected";
  return isConnectionUpdateRequired(kind, versionNode) ? "needs_update" : "connected";
}

export function getConnectionDisplayLabel(status: ConnectionDisplayStatus): string {
  if (status === "needs_update") return "À actualiser";
  if (status === "connected") return "Connecté";
  return "Déconnecté";
}

export function withCurrentConnectionVersion<T extends Record<string, unknown>>(
  kind: ConnectionKind,
  node: T | null | undefined,
): T & { connection_version: number; connection_version_updated_at: string } {
  const cleanNode = clearConnectionReconnectMarkers(((node ?? {}) as T));
  return {
    ...cleanNode,
    connection_version: getRequiredConnectionVersion(kind),
    connection_version_updated_at: new Date().toISOString(),
  };
}

export function mailConnectionKind(provider: unknown): ConnectionKind | null {
  const p = (asString(provider) || "").toLowerCase();
  if (p === "gmail") return "mail:gmail";
  if (p === "microsoft") return "mail:microsoft";
  if (p === "imap") return "mail:imap";
  return null;
}
