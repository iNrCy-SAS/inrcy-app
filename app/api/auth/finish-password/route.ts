import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  type EmailOtpType,
  type Session,
  type User,
} from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureNotificationPreferences } from "@/lib/notifications";
import { ensureProfileRow } from "@/lib/ensureProfileRow";
import { getClientIp, enforceRateLimit } from "@/lib/rateLimit";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { log } from "@/lib/observability/logger";
import { evaluatePassword } from "@/lib/passwordPolicy";
import {
  PASSWORD_FINISH_CONTINUATION_TTL_SECONDS,
  PASSWORD_FINISH_COOKIE,
  openPasswordFinishContinuation,
  sealPasswordFinishContinuation,
  type PasswordFinishSession,
} from "@/lib/authPasswordContinuation";
import {
  DEFAULT_APP_LOCALE,
  appLanguageFromLocale,
  tryNormalizeAppLocale,
} from "@/i18n/config";

export const runtime = "nodejs";

type FinishMode = "invite" | "reset";

type Body = {
  mode?: FinishMode;
  token_hash?: string;
  type?: string;
  email?: string | null;
  password?: string;
  language?: string;
  continuation?: Partial<PasswordFinishSession> | null;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeEmail(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function isPlausibleTokenHash(value: string) {
  return /^[a-zA-Z0-9_-]{32,256}$/.test(value);
}

function isPlausibleSessionToken(value: string, minLength: number) {
  return value.length >= minLength && value.length <= 16_384 && !/\s/.test(value);
}

function readContinuation(value: Partial<PasswordFinishSession> | null | undefined) {
  const accessToken = normalizeText(value?.access_token);
  const refreshToken = normalizeText(value?.refresh_token);
  if (
    !isPlausibleSessionToken(accessToken, 20) ||
    !isPlausibleSessionToken(refreshToken, 6)
  ) {
    return null;
  }
  return { access_token: accessToken, refresh_token: refreshToken };
}

function sessionPayload(session: Session | null | undefined) {
  if (!session?.access_token || !session.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  };
}

function getExpectedType(mode: FinishMode): EmailOtpType {
  return mode === "invite" ? "invite" : "recovery";
}

function isAllowedType(value: string | null, expected: EmailOtpType): value is EmailOtpType {
  return value === expected;
}

function buildAuthClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}

function readMode(value: unknown): FinishMode | null {
  return value === "invite" ? "invite" : value === "reset" ? "reset" : null;
}

function clearContinuationCookie(response: NextResponse) {
  response.cookies.set({
    name: PASSWORD_FINISH_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/finish-password",
    maxAge: 0,
  });
  return response;
}

function attachContinuationCookie(
  response: NextResponse,
  input: {
    mode: FinishMode;
    userId: string;
    email: string | null;
    session: PasswordFinishSession;
  },
) {
  response.cookies.set({
    name: PASSWORD_FINISH_COOKIE,
    value: sealPasswordFinishContinuation(input),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/finish-password",
    maxAge: PASSWORD_FINISH_CONTINUATION_TTL_SECONDS,
  });
  return response;
}

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

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = String((error as { code?: unknown }).code || "").trim();
  return code || undefined;
}

function isUserUnavailableError(error: unknown) {
  const value = errorText(error);
  return (
    value.includes("user not found") ||
    value.includes("user_not_found") ||
    value.includes("no user") ||
    value.includes("does not exist") ||
    value.includes("404")
  );
}

function isPasswordRejectedError(error: unknown) {
  const value = errorText(error);
  return (
    value.includes("weak_password") ||
    value.includes("password is too weak") ||
    value.includes("password should") ||
    value.includes("password must") ||
    value.includes("password has been pwned") ||
    value.includes("password is known to be weak") ||
    value.includes("same password")
  );
}

function getFriendlyOtpError(error: unknown, mode: FinishMode) {
  const raw = getSimpleFrenchErrorMessage(
    error,
    mode === "invite"
      ? "Ce lien d’activation n’est plus valide. Merci de demander un nouveau lien."
      : "Ce lien de réinitialisation n’est plus valide. Merci de refaire une demande.",
  );

  const value = raw.toLowerCase();
  if (value.includes("session") || value.includes("reconnecter")) {
    return mode === "invite"
      ? "Ce lien d’activation n’est plus valide ou a déjà été utilisé. Merci de demander un nouveau lien."
      : "Ce lien de réinitialisation n’est plus valide ou a déjà été utilisé. Merci de refaire une demande.";
  }

  return raw;
}

export async function GET(req: NextRequest) {
  const mode = readMode(req.nextUrl.searchParams.get("mode"));
  const expectedEmail = normalizeEmail(req.nextUrl.searchParams.get("email"));
  if (!mode) return json({ continuation_available: false });

  const sealedValue = req.cookies.get(PASSWORD_FINISH_COOKIE)?.value;
  const continuation = openPasswordFinishContinuation(sealedValue, {
    mode,
    email: expectedEmail,
  });
  const response = json({ continuation_available: Boolean(continuation) });
  return sealedValue && !continuation ? clearContinuationCookie(response) : response;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const mode = readMode(body?.mode);
    const tokenHash = normalizeText(body?.token_hash);
    const expectedEmail = normalizeEmail(body?.email);
    const password = String(body?.password || "");

    if (!mode) {
      return json({ code: "invalid_action", error: "Type de lien invalide." }, 400);
    }

    const expectedType = getExpectedType(mode);
    const requestedType = normalizeText(body?.type) || expectedType;

    if (!isAllowedType(requestedType, expectedType)) {
      return json(
        { code: "invalid_action", error: "Ce lien ne correspond pas à cette action." },
        400,
      );
    }

    const sealedCookieValue = req.cookies.get(PASSWORD_FINISH_COOKIE)?.value;
    const sealedContinuation = openPasswordFinishContinuation(sealedCookieValue, {
      mode,
      email: expectedEmail,
    });
    // The encrypted HttpOnly continuation is authoritative. The body variant
    // remains accepted for legacy PKCE/session links, but failed writes never
    // expose session tokens back to browser JavaScript.
    const legacyContinuation = readContinuation(body?.continuation);
    const continuation = sealedContinuation?.session || legacyContinuation;

    if (!continuation && (!tokenHash || !isPlausibleTokenHash(tokenHash))) {
      const response = json(
        { code: "link_incomplete", error: "Lien incomplet. Merci de demander un nouveau lien." },
        400,
      );
      return sealedCookieValue ? clearContinuationCookie(response) : response;
    }

    const passwordPolicy = evaluatePassword(password);
    if (!passwordPolicy.isStrong) {
      return json(
        {
          code: "password_too_weak",
          error: "Mot de passe trop faible : 8+ caractères, lettre, chiffre, majuscule et symbole requis.",
        },
        400,
      );
    }

    const limited = await enforceRateLimit({
      name: "auth_finish_password",
      identifier: `${getClientIp(req)}:${expectedEmail || "unknown"}`,
      limit: 8,
      window: "15 m",
      failClosed: false,
    });
    if (limited) return limited;

    const supabaseAuth = buildAuthClient();
    let authUser: User | null = null;
    let session: Session | null = null;
    const credentialSource = sealedContinuation
      ? "sealed_cookie"
      : continuation
        ? "legacy_continuation"
        : "otp";

    if (continuation) {
      const { data: continuationData, error: continuationError } = await supabaseAuth.auth.setSession(continuation);
      if (continuationError || !continuationData.session) {
        log.warn("auth_password_continuation_rejected", {
          route: "/api/auth/finish-password",
          stage: "set_session",
          mode,
          error_code: errorCode(continuationError),
        });
        return clearContinuationCookie(json(
          {
            code: "session_failed",
            error: "La reprise sécurisée a expiré. Merci de demander un nouveau lien.",
          },
          401,
        ));
      }

      const { data: continuationUserData, error: continuationUserError } = await supabaseAuth.auth.getUser();
      if (continuationUserError || !continuationUserData.user) {
        log.warn("auth_password_continuation_rejected", {
          route: "/api/auth/finish-password",
          stage: "get_user",
          mode,
          error_code: errorCode(continuationUserError),
        });
        return clearContinuationCookie(json(
          {
            code: "session_failed",
            error: "La reprise sécurisée a expiré. Merci de demander un nouveau lien.",
          },
          401,
        ));
      }

      authUser = continuationUserData.user;
      session = continuationData.session;
      if (sealedContinuation && authUser.id !== sealedContinuation.userId) {
        log.warn("auth_password_continuation_rejected", {
          route: "/api/auth/finish-password",
          stage: "user_mismatch",
          mode,
        });
        return clearContinuationCookie(json(
          {
            code: "session_failed",
            error: "La reprise sécurisée ne correspond pas à ce compte. Merci de demander un nouveau lien.",
          },
          401,
        ));
      }
    } else {
      const { data, error: verifyError } = await supabaseAuth.auth.verifyOtp({
        type: expectedType,
        token_hash: tokenHash,
      });

      if (verifyError) {
        log.warn("auth_password_link_rejected", {
          route: "/api/auth/finish-password",
          stage: "verify_otp",
          mode,
          error_code: errorCode(verifyError),
        });
        const response = json(
          {
            code: "auth_link_invalid",
            error: getFriendlyOtpError(verifyError, mode),
          },
          400,
        );
        return sealedCookieValue ? clearContinuationCookie(response) : response;
      }

      authUser = data.user;
      session = data.session;
      if (session?.access_token && session.refresh_token) {
        const { data: establishedSessionData } = await supabaseAuth.auth
          .setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          })
          .catch(() => ({ data: { session: null } }));
        session = establishedSessionData.session || session;
      }
    }

    const userId = authUser?.id;
    const verifiedEmail = normalizeEmail(authUser?.email);

    if (!authUser || !userId) {
      return clearContinuationCookie(json(
        {
          code: "session_failed",
          error:
            mode === "invite"
              ? "La session d’activation n’a pas pu être créée. Merci de demander un nouveau lien."
              : "La session de réinitialisation n’a pas pu être créée. Merci de refaire une demande.",
        },
        400,
      ));
    }

    if (expectedEmail && verifiedEmail && verifiedEmail !== expectedEmail) {
      log.warn("auth_password_account_mismatch", {
        route: "/api/auth/finish-password",
        mode,
        user_id: userId,
      });
      return clearContinuationCookie(json(
        { code: "account_mismatch", error: "Ce lien ne correspond pas au compte attendu." },
        403,
      ));
    }

    // L’écriture administrateur est l’opération canonique : elle ne dépend ni
    // des cookies du navigateur ni d’une autre session ouverte dans un onglet.
    // La session issue du lien reste un secours légitime si le service admin a
    // un incident ponctuel.
    const { error: adminUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password,
      ...(mode === "invite" ? { email_confirm: true } : {}),
    });

    const adminPasswordRejected = isPasswordRejectedError(adminUpdateError);
    let passwordSaved = !adminUpdateError;
    let sessionUpdateError: unknown = null;
    // A policy rejection must not trigger a second password write. Keeping the
    // verified session untouched is what makes the next user choice reliable.
    if (adminUpdateError && !adminPasswordRejected) {
      const sessionUpdate = await supabaseAuth.auth.updateUser({ password });
      sessionUpdateError = sessionUpdate.error;
      passwordSaved = !sessionUpdate.error;
    }

    if (!passwordSaved) {
      const { data: latestSessionData } = await supabaseAuth.auth
        .getSession()
        .catch(() => ({ data: { session: null } }));
      const continuationPayload = sessionPayload(latestSessionData.session || session);
      const accountUnavailable =
        isUserUnavailableError(adminUpdateError) || isUserUnavailableError(sessionUpdateError);
      const passwordRejected =
        adminPasswordRejected || isPasswordRejectedError(sessionUpdateError);

      log.warn("auth_password_save_failed", {
        route: "/api/auth/finish-password",
        stage: "save_password",
        mode,
        user_id: userId,
        credential_source: credentialSource,
        retryable: Boolean(continuationPayload) && !accountUnavailable,
        admin_error_code: errorCode(adminUpdateError),
        session_error_code: errorCode(sessionUpdateError),
      });

      if (accountUnavailable) {
        return clearContinuationCookie(json(
          {
            code: "account_unavailable",
            error: "Ce compte n’existe plus ou n’est plus disponible.",
          },
          410,
        ));
      }

      if (continuationPayload) {
        const response = json(
          {
            code: passwordRejected ? "password_rejected" : "password_save_retryable",
            error: passwordRejected
              ? "Ce mot de passe a été refusé par le service d’authentification. Choisissez-en un autre."
              : "Le service d’authentification a rencontré un incident temporaire. Vous pouvez réessayer sans nouveau lien.",
            retryable: true,
            continuation_available: true,
          },
          passwordRejected ? 422 : 503,
        );
        return attachContinuationCookie(response, {
          mode,
          userId,
          email: verifiedEmail || expectedEmail,
          session: continuationPayload,
        });
      }

      return clearContinuationCookie(json(
        {
          code: "password_save_failed",
          error: "Impossible d’enregistrer ce mot de passe pour le moment.",
        },
        503,
      ));
    }

    const { data: finalSessionData } = await supabaseAuth.auth
      .getSession()
      .catch(() => ({ data: { session: null } }));
    const finalSession = finalSessionData.session || session;

    await ensureProfileRow(authUser).catch(() => null);
    await ensureNotificationPreferences(userId).catch(() => null);

    const authMetadata = authUser.user_metadata && typeof authUser.user_metadata === "object"
      ? (authUser.user_metadata as Record<string, unknown>)
      : {};
    const selectedLocale =
      tryNormalizeAppLocale(body?.language) ||
      tryNormalizeAppLocale(authMetadata.app_locale) ||
      tryNormalizeAppLocale(authMetadata.app_language) ||
      DEFAULT_APP_LOCALE;
    const selectedLanguage = appLanguageFromLocale(selectedLocale);
    const updatedAt = new Date().toISOString();

    // La langue choisie sur le lien devient la préférence unique du compte.
    await Promise.allSettled([
      supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...authMetadata,
          app_language: selectedLanguage,
          app_locale: selectedLocale,
        },
      }),
      supabaseAdmin
        .from("business_profiles")
        .upsert(
          {
            user_id: userId,
            app_language: selectedLanguage,
            updated_at: updatedAt,
          },
          { onConflict: "user_id" },
        ),
    ]);

    return clearContinuationCookie(json({
      ok: true,
      user_id: userId,
      email: verifiedEmail || expectedEmail,
      session: sessionPayload(finalSession),
    }));
  } catch (error) {
    log.error("auth_password_finish_exception", {
      route: "/api/auth/finish-password",
      error_code: errorCode(error),
    });
    return json(
      {
        code: "finish_failed",
        error: getSimpleFrenchErrorMessage(error, "Impossible de finaliser le mot de passe pour le moment."),
      },
      500,
    );
  }
}
