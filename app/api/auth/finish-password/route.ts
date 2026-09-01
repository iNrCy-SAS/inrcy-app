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
import { ensurePrincipalInrcyAccountProvisioned } from "@/lib/inrcyAccountProvisioning";
import { getClientIp, enforceRateLimit } from "@/lib/rateLimit";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { log } from "@/lib/observability/logger";
import { evaluatePassword } from "@/lib/passwordPolicy";
import {
  getPasswordWriteDiagnostic,
  passwordWriteErrorCode,
  writeVerifiedPassword,
} from "@/lib/verifiedPasswordWrite";
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
          error_code: passwordWriteErrorCode(continuationError),
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
          error_code: passwordWriteErrorCode(continuationUserError),
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
          error_code: passwordWriteErrorCode(verifyError),
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

    const passwordWrite = await writeVerifiedPassword({
      // This client owns only the session created from the current email link:
      // other accounts open in other browser tabs cannot affect this write.
      writeWithVerifiedSession: async () => {
        const { error } = await supabaseAuth.auth.updateUser({ password });
        return { error };
      },
      // The signed server continuation authorizes a service-role fallback only
      // when the verified session endpoint has a transient infrastructure error.
      writeWithAdminFallback: async () => {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          password,
          ...(mode === "invite" ? { email_confirm: true } : {}),
        });
        return { error };
      },
    });

    if (!passwordWrite.ok) {
      const { data: latestSessionData } = await supabaseAuth.auth
        .getSession()
        .catch(() => ({ data: { session: null } }));
      const continuationPayload = sessionPayload(latestSessionData.session || session);
      const accountUnavailable = passwordWrite.failureKind === "account_unavailable";
      const passwordPolicyMismatch = passwordWrite.failureKind === "password_rejected";
      const passwordRejected = passwordWrite.failureKind === "same_password";
      const sessionDiagnostic = getPasswordWriteDiagnostic(passwordWrite.sessionError);
      const adminDiagnostic = getPasswordWriteDiagnostic(passwordWrite.adminError);

      log.warn("auth_password_save_failed", {
        route: "/api/auth/finish-password",
        stage: "save_password",
        mode,
        user_id: userId,
        credential_source: credentialSource,
        retryable: Boolean(continuationPayload) && !accountUnavailable,
        failure_kind: passwordWrite.failureKind,
        session_error_code: sessionDiagnostic.code,
        session_error_reasons: sessionDiagnostic.reasons,
        session_minimum_length: sessionDiagnostic.minimumLength,
        admin_error_code: adminDiagnostic.code,
        admin_error_reasons: adminDiagnostic.reasons,
        admin_minimum_length: adminDiagnostic.minimumLength,
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
        const responseCode = passwordPolicyMismatch
          ? "password_policy_mismatch"
          : passwordRejected
            ? "password_rejected"
            : "password_save_retryable";
        const response = json(
          {
            code: responseCode,
            error: passwordPolicyMismatch
              ? "La politique du service d’authentification ne correspond pas aux critères affichés. Votre lien reste utilisable."
              : passwordRejected
                ? "Ce mot de passe est déjà utilisé pour ce compte. Choisissez-en un autre."
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
          code: passwordPolicyMismatch ? "password_policy_mismatch" : "password_save_failed",
          error: passwordPolicyMismatch
            ? "La politique du service d’authentification ne correspond pas aux critères affichés."
            : "Impossible d’enregistrer ce mot de passe pour le moment.",
        },
        503,
      ));
    }

    const { data: finalSessionData } = await supabaseAuth.auth
      .getSession()
      .catch(() => ({ data: { session: null } }));
    const finalSession = finalSessionData.session || session;

    // Dernière ceinture de sécurité pour une invitation créée pendant un
    // incident de déploiement. Un reset de mot de passe historique ne doit, lui,
    // jamais relancer un onboarding.
    if (mode === "invite") {
      await ensurePrincipalInrcyAccountProvisioned(authUser);
    }

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
        ...(mode === "invite" ? { email_confirm: true } : {}),
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
      error_code: passwordWriteErrorCode(error),
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
