// This preflight is read-only: only finish-password may exchange the OTP.
export const AUTH_LINK_CHECK_TIMEOUT_MS = 12_000;

export type PasswordLinkCheck =
  | { state: "valid"; expiresAt: number }
  | { state: "invalid" }
  | { state: "unavailable" };

export function withAuthLinkDeadline<T>(pending: PromiseLike<T>, timeoutMs = AUTH_LINK_CHECK_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("auth_link_check_timeout")), timeoutMs);
    Promise.resolve(pending).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function isUnavailableAuthSessionCheck(error: unknown) {
  if (!error) return false;
  const candidate = error as { status?: number; name?: string };
  return candidate.name !== "AuthSessionMissingError" && ![400, 401, 403].includes(Number(candidate.status));
}

export async function checkPasswordEmailLink(
  input: { mode: "invite" | "reset"; tokenHash: string; email: string | null },
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<PasswordLinkCheck> {
  const fetcher = options.fetcher || fetch;
  try {
    const response = await fetcher("/api/auth/password-link-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
      body: JSON.stringify({ mode: input.mode, token_hash: input.tokenHash, email: input.email }),
    });
    if (!response.ok) return { state: "unavailable" };
    const body = await response.json() as { valid?: boolean; expires_at?: string };
    if (body.valid === false) return { state: "invalid" };
    const expiresAt = Date.parse(body.expires_at || "");
    if (body.valid !== true || !Number.isFinite(expiresAt)) return { state: "unavailable" };
    return expiresAt > Date.now() ? { state: "valid", expiresAt } : { state: "invalid" };
  } catch {
    return { state: "unavailable" };
  }
}
