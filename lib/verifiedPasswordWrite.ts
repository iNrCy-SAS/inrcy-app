export type PasswordWriteFailureKind =
  | "account_unavailable"
  | "password_rejected"
  | "same_password"
  | "temporary";

type PasswordWriteAttempt = () => Promise<{ error: unknown | null }>;

type PasswordWriteResult = {
  ok: boolean;
  source: "session" | "admin" | null;
  failureKind: PasswordWriteFailureKind | null;
  sessionError: unknown | null;
  adminError: unknown | null;
};

function errorText(error: unknown) {
  if (!error) return "";
  if (typeof error === "string") return error.toLowerCase();
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; status?: unknown };
    return `${String(candidate.code || "")} ${String(candidate.message || "")} ${String(candidate.status || "")}`.toLowerCase();
  }
  return String(error).toLowerCase();
}

export function passwordWriteErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = String((error as { code?: unknown }).code || "").trim();
  return code || undefined;
}

export function classifyPasswordWriteError(error: unknown): PasswordWriteFailureKind {
  const value = errorText(error);

  if (
    value.includes("user not found") ||
    value.includes("user_not_found") ||
    value.includes("no user") ||
    value.includes("does not exist") ||
    value.includes("404")
  ) {
    return "account_unavailable";
  }

  if (value.includes("same_password") || value.includes("same password")) {
    return "same_password";
  }

  if (
    value.includes("weak_password") ||
    value.includes("password is too weak") ||
    value.includes("password should") ||
    value.includes("password must") ||
    value.includes("password has been pwned") ||
    value.includes("password is known to be weak")
  ) {
    return "password_rejected";
  }

  return "temporary";
}

function mergeFailureKinds(
  sessionKind: PasswordWriteFailureKind,
  adminKind: PasswordWriteFailureKind,
): PasswordWriteFailureKind {
  const kinds = new Set([sessionKind, adminKind]);
  if (kinds.has("account_unavailable")) return "account_unavailable";
  if (kinds.has("same_password")) return "same_password";
  if (kinds.has("password_rejected")) return "password_rejected";
  return "temporary";
}

export function getPasswordWriteDiagnostic(error: unknown) {
  if (!error || typeof error !== "object") {
    return { code: passwordWriteErrorCode(error) };
  }

  const candidate = error as { reasons?: unknown; message?: unknown };
  const reasons = Array.isArray(candidate.reasons)
    ? [...new Set(
        candidate.reasons
          .filter((reason): reason is string => typeof reason === "string")
          .map((reason) => reason.trim().toLowerCase())
          .filter((reason) => /^[a-z0-9_-]{1,64}$/.test(reason)),
      )].slice(0, 10)
    : [];
  const minimumMatch = errorText(error).match(/at least\s+(\d{1,4})\s+characters?/i);
  const minimumLength = minimumMatch ? Number.parseInt(minimumMatch[1], 10) : undefined;

  return {
    code: passwordWriteErrorCode(error),
    reasons: reasons.length > 0 ? reasons : undefined,
    minimumLength: Number.isFinite(minimumLength) ? minimumLength : undefined,
  };
}

/**
 * Writes a password with the freshly verified OTP/recovery session first.
 * That is Supabase's native invite/reset path and is isolated from browser tabs.
 * The service-role write is only a recovery path for transient session failures.
 */
export async function writeVerifiedPassword(input: {
  writeWithVerifiedSession: PasswordWriteAttempt;
  writeWithAdminFallback: PasswordWriteAttempt;
}): Promise<PasswordWriteResult> {
  const sessionAttempt = await input.writeWithVerifiedSession();
  const sessionError = sessionAttempt.error || null;

  if (!sessionError) {
    return {
      ok: true,
      source: "session",
      failureKind: null,
      sessionError: null,
      adminError: null,
    };
  }

  const sessionFailureKind = classifyPasswordWriteError(sessionError);
  if (sessionFailureKind !== "temporary") {
    return {
      ok: false,
      source: null,
      failureKind: sessionFailureKind,
      sessionError,
      adminError: null,
    };
  }

  const adminAttempt = await input.writeWithAdminFallback();
  const adminError = adminAttempt.error || null;
  if (!adminError) {
    return {
      ok: true,
      source: "admin",
      failureKind: null,
      sessionError,
      adminError: null,
    };
  }

  return {
    ok: false,
    source: null,
    failureKind: mergeFailureKinds(
      sessionFailureKind,
      classifyPasswordWriteError(adminError),
    ),
    sessionError,
    adminError,
  };
}
