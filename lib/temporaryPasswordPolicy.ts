export const TEMPORARY_PASSWORD_METADATA_KEY = "inrcy_temporary_password";
export const TEMPORARY_PASSWORD_VALIDITY_DAYS = 30;
export const TEMPORARY_PASSWORD_EXPIRED_MARKER = "temporary_password_expired";

export type TemporaryPasswordMetadata = {
  version: 1;
  welcome_id: string;
  issued_at: string;
  expires_at: string;
};

/** Read-only presentation state; enforcement belongs to the Supabase token hook. */
export function getTemporaryPasswordMetadata(appMetadata: unknown): TemporaryPasswordMetadata | null {
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const value = (appMetadata as Record<string, unknown>)[TEMPORARY_PASSWORD_METADATA_KEY];
  if (!value || typeof value !== "object") return null;
  const metadata = value as Partial<TemporaryPasswordMetadata>;
  if (metadata.version !== 1 || typeof metadata.welcome_id !== "string"
    || typeof metadata.issued_at !== "string" || typeof metadata.expires_at !== "string"
    || !Number.isFinite(Date.parse(metadata.issued_at)) || !Number.isFinite(Date.parse(metadata.expires_at))) return null;
  return metadata as TemporaryPasswordMetadata;
}

export function isTemporaryPasswordExpiredError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message || "") : "";
  return message.includes(TEMPORARY_PASSWORD_EXPIRED_MARKER);
}
