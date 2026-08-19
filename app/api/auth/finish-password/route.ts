import { NextResponse } from "next/server";
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
import {
  DEFAULT_APP_LOCALE,
  appLanguageFromLocale,
  tryNormalizeAppLocale,
} from "@/i18n/config";

export const runtime = "nodejs";

type FinishMode = "invite" | "reset";

type SessionContinuation = {
  access_token?: string;
  refresh_token?: string;
};

type Body = {
  mode?: FinishMode;
  token_hash?: string;
  type?: string;
  email?: string | null;
  password?: string;
  language?: string;
  continuation?: SessionContinuation | null;
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

function isPlausibleSessionToken(value: string) {
  return value.length >= 20 && value.length <= 16_384 && !/\s/.test(value);
}

function readContinuation(value: SessionContinuation | null | undefined) {
  const accessToken = normalizeText(value?.access_token);
  const refreshToken = normalizeText(value?.refresh_token);
  if (!isPlausibleSessionToken(accessToken) || !isPlausibleSessionToken(refreshToken)) {
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

function validatePassword(password: string) {
  const hasMinLength = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);

  return hasMinLength && hasLetter && hasNumber && hasUpper && hasSymbol;
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

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const mode: FinishMode | null = body?.mode === "invite" ? "invite" : body?.mode === "reset" ? "reset" : null;
    const tokenHash = normalizeText(body?.token_hash);
    const continuation = readContinuation(body?.continuation);
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

    if (!continuation && (!tokenHash || !isPlausibleTokenHash(tokenHash))) {
      return json(
        { code: "link_incomplete", error: "Lien incomplet. Merci de demander un nouveau lien." },
        400,
      );
    }

    if (!validatePassword(password)) {
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
    const credentialSource = continuation ? "continuation" : "otp";

    if (continuation) {
      const { data: continuationData, error: continuationError } = await supabaseAuth.auth.setSession(continuation);
      if (continuationError || !continuationData.session) {
        log.warn("auth_password_continuation_rejected", {
          route: "/api/auth/finish-password",
          stage: "set_session",
          mode,
          error_code: errorCode(continuationError),
        });
        return json(
          {
            code: "session_failed",
            error: "La reprise sécurisée a expiré. Merci de demander un nouveau lien.",
          },
          401,
        );
      }

      const { data: continuationUserData, error: continuationUserError } = await supabaseAuth.auth.getUser();
      if (continuationUserError || !continuationUserData.user) {
        log.warn("auth_password_continuation_rejected", {
          route: "/api/auth/finish-password",
          stage: "get_user",
          mode,
          error_code: errorCode(continuationUserError),
        });
        return json(
          {
            code: "session_failed",
            error: "La reprise sécurisée a expiré. Merci de demander un nouveau lien.",
          },
          401,
        );
      }

      authUser = continuationUserData.user;
      session = continuationData.session;
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
        return json(
          {
            code: "auth_link_invalid",
            error: getFriendlyOtpError(verifyError, mode),
          },
          400,
        );
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
      return json(
        {
          code: "session_failed",
          error:
            mode === "invite"
              ? "La session d’activation n’a pas pu être créée. Merci de demander un nouveau lien."
              : "La session de réinitialisation n’a pas pu être créée. Merci de refaire une demande.",
        },
        400,
      );
    }

    if (expectedEmail && verifiedEmail && verifiedEmail !== expectedEmail) {
      log.warn("auth_password_account_mismatch", {
        route: "/api/auth/finish-password",
        mode,
        user_id: userId,
      });
      return json(
        { code: "account_mismatch", error: "Ce lien ne correspond pas au compte attendu." },
        403,
      );
    }

    // L’écriture administrateur est l’opération canonique : elle ne dépend ni
    // des cookies du navigateur ni d’une autre session ouverte dans un onglet.
    // La session issue du lien reste un secours légitime si le service admin a
    // un incident ponctuel.
    const { error: adminUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password,
      ...(mode === "invite" ? { email_confirm: true } : {}),
    });

    let sessionUpdateError: unknown = null;
    if (adminUpdateError) {
      const sessionUpdate = await supabaseAuth.auth.updateUser({ password });
      sessionUpdateError = sessionUpdate.error;
    }

    if (adminUpdateError && sessionUpdateError) {
      const continuationPayload = sessionPayload(session);
      const accountUnavailable =
        isUserUnavailableError(adminUpdateError) || isUserUnavailableError(sessionUpdateError);
      const passwordRejected =
        isPasswordRejectedError(adminUpdateError) || isPasswordRejectedError(sessionUpdateError);

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
        return json(
          {
            code: "account_unavailable",
            error: "Ce compte n’existe plus ou n’est plus disponible.",
          },
          410,
        );
      }

      if (continuationPayload) {
        return json(
          {
            code: passwordRejected ? "password_rejected" : "password_save_retryable",
            error: passwordRejected
              ? "Ce mot de passe a été refusé par le service d’authentification. Choisissez-en un autre."
              : "Le service d’authentification a rencontré un incident temporaire. Vous pouvez réessayer sans nouveau lien.",
            retryable: true,
            continuation: continuationPayload,
          },
          passwordRejected ? 422 : 503,
        );
      }

      return json(
        {
          code: "password_save_failed",
          error: "Impossible d’enregistrer ce mot de passe pour le moment.",
        },
        503,
      );
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

    return json({
      ok: true,
      user_id: userId,
      email: verifiedEmail || expectedEmail,
      session: sessionPayload(finalSession),
    });
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
