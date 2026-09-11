export type LoginErrorKind =
  | "invalidCredentials"
  | "emailUnconfirmed"
  | "linkUnavailable"
  | "network"
  | "storage"
  | "service"
  | "technical";

function normalizedErrorCode(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = String((input as { code?: unknown }).code || "")
    .trim()
    .toLowerCase();
  if (!value || !/^[a-z0-9._-]{1,100}$/.test(value)) return null;
  return value;
}

export function getLoginAuthErrorCode(input: unknown) {
  return normalizedErrorCode(input);
}

export function getLoginAuthErrorStatus(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const raw = (input as { status?: unknown }).status;
  const normalized = typeof raw === "string" ? raw.trim() : "";
  const value =
    typeof raw === "number"
      ? raw
      : /^\d{3}$/.test(normalized)
        ? Number(normalized)
        : Number.NaN;
  if (!Number.isInteger(value) || value < 100 || value > 599) return null;
  return value;
}

function rawErrorMessage(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (input instanceof Error) return String(input.message || "").trim();
  if (input && typeof input === "object") {
    const maybe = input as {
      message?: unknown;
      error?: unknown;
      statusText?: unknown;
      name?: unknown;
    };
    if (typeof maybe.message === "string") return maybe.message.trim();
    if (typeof maybe.error === "string") return maybe.error.trim();
    if (typeof maybe.statusText === "string") return maybe.statusText.trim();
    if (typeof maybe.name === "string") return maybe.name.trim();
  }
  return "";
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

/**
 * Prefer Supabase's stable Auth error codes. Message matching is retained as a
 * compatibility fallback for older SDK responses and browser/network errors.
 */
export function classifyLoginError(input: unknown): LoginErrorKind {
  const code = normalizedErrorCode(input);

  if (
    code === "invalid_credentials" ||
    code === "email_not_found" ||
    code === "user_not_found"
  ) {
    return "invalidCredentials";
  }

  if (code === "email_not_confirmed") return "emailUnconfirmed";

  if (
    code === "otp_expired" ||
    code === "otp_disabled" ||
    code === "flow_state_expired" ||
    code === "flow_state_not_found" ||
    code === "over_email_send_rate_limit"
  ) {
    return "linkUnavailable";
  }

  if (
    code === "session_not_found" ||
    code === "refresh_token_not_found" ||
    code === "refresh_token_already_used" ||
    code === "bad_jwt"
  ) {
    return "storage";
  }

  const message = rawErrorMessage(input).toLowerCase();

  if (
    hasAny(message, [
      "invalid login credentials",
      "invalid credentials",
      "email not found",
      "wrong password",
    ])
  ) {
    return "invalidCredentials";
  }

  if (hasAny(message, ["email not confirmed", "email_not_confirmed"])) {
    return "emailUnconfirmed";
  }

  if (
    hasAny(message, [
      "otp_expired",
      "expired",
      "invalid token",
      "email link is invalid",
      "email rate limit",
      "over_email_send_rate_limit",
    ])
  ) {
    return "linkUnavailable";
  }

  if (
    hasAny(message, [
      "failed to fetch",
      "networkerror",
      "network request failed",
      "load failed",
      "fetch failed",
      "econnreset",
      "econnrefused",
      "enotfound",
      "socket hang up",
      "aborterror",
      "timeout",
      "timed out",
    ])
  ) {
    return "network";
  }

  if (
    hasAny(message, [
      "auth session missing",
      "session",
      "storage",
      "localstorage",
      "cookie",
      "cookies",
    ])
  ) {
    return "storage";
  }

  if (
    hasAny(message, [
      "500",
      "502",
      "503",
      "504",
      "server error",
      "internal server error",
      "service unavailable",
    ])
  ) {
    return "service";
  }

  const status = getLoginAuthErrorStatus(input);
  if (status !== null && status >= 500) return "service";

  return "technical";
}
