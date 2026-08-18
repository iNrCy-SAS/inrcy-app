import { NextResponse } from "next/server";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureNotificationPreferences } from "@/lib/notifications";
import { ensureProfileRow } from "@/lib/ensureProfileRow";
import { getClientIp, enforceRateLimit } from "@/lib/rateLimit";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
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
};

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
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
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
    const expectedEmail = normalizeEmail(body?.email);
    const password = String(body?.password || "");

    if (!mode) {
      return NextResponse.json({ code: "invalid_action", error: "Type de lien invalide." }, { status: 400 });
    }

    const expectedType = getExpectedType(mode);
    const requestedType = normalizeText(body?.type) || expectedType;

    if (!isAllowedType(requestedType, expectedType)) {
      return NextResponse.json(
        { code: "invalid_action", error: "Ce lien ne correspond pas à cette action." },
        { status: 400 },
      );
    }

    if (!tokenHash || !isPlausibleTokenHash(tokenHash)) {
      return NextResponse.json(
        { code: "link_incomplete", error: "Lien incomplet. Merci de demander un nouveau lien." },
        { status: 400 },
      );
    }

    if (!validatePassword(password)) {
      return NextResponse.json(
        {
          code: "password_too_weak",
          error: "Mot de passe trop faible : 8+ caractères, lettre, chiffre, majuscule et symbole requis.",
        },
        { status: 400 },
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
    const { data, error: verifyError } = await supabaseAuth.auth.verifyOtp({
      type: expectedType,
      token_hash: tokenHash,
    });

    if (verifyError) {
      return NextResponse.json(
        {
          code: "auth_link_invalid",
          error: getFriendlyOtpError(verifyError, mode),
        },
        { status: 400 },
      );
    }

    const authUser = data.user;
    const session = data.session;
    const userId = authUser?.id;
    const verifiedEmail = normalizeEmail(authUser?.email);

    if (!authUser || !userId) {
      return NextResponse.json(
        {
          code: "session_failed",
          error:
            mode === "invite"
              ? "La session d’activation n’a pas pu être créée. Merci de demander un nouveau lien."
              : "La session de réinitialisation n’a pas pu être créée. Merci de refaire une demande.",
        },
        { status: 400 },
      );
    }

    if (expectedEmail && verifiedEmail && verifiedEmail !== expectedEmail) {
      return NextResponse.json(
        { code: "account_mismatch", error: "Ce lien ne correspond pas au compte attendu." },
        { status: 400 },
      );
    }

    if (session?.access_token && session.refresh_token) {
      await supabaseAuth.auth
        .setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
        .catch(() => null);
    }

    const { error: sessionUpdateError } = await supabaseAuth.auth.updateUser({ password });

    if (sessionUpdateError) {
      const { error: adminUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
      });

      if (adminUpdateError) {
        return NextResponse.json(
          {
            code: "password_save_failed",
            error: getSimpleFrenchErrorMessage(
              adminUpdateError || sessionUpdateError,
              "Impossible d’enregistrer ce mot de passe pour le moment.",
            ),
          },
          { status: 400 },
        );
      }
    }

    const { data: finalSessionData } = await supabaseAuth.auth.getSession().catch(() => ({ data: { session: null } }));
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

    // La langue choisie sur le lien d'activation devient la préférence unique
    // du compte. Les deux écritures sont volontaires : Auth sert aux liens
    // publics, business_profiles au dashboard authentifié.
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

    return NextResponse.json({
      ok: true,
      user_id: userId,
      email: verifiedEmail || expectedEmail,
      session: finalSession
        ? {
            access_token: finalSession.access_token,
            refresh_token: finalSession.refresh_token,
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: "finish_failed",
        error: getSimpleFrenchErrorMessage(error, "Impossible de finaliser le mot de passe pour le moment."),
      },
      { status: 500 },
    );
  }
}
