import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getClientIp, enforceRateLimit } from "@/lib/rateLimit";
import { log } from "@/lib/observability/logger";
import { buildSupabaseEmailRedirectUrl } from "@/lib/authEmailLinks";
import {
  hasKnownInrcyAccountForEmail,
  isExistingAuthUserError,
} from "@/lib/supabaseAuthBusinessErrors";
import {
  APP_LOCALE_COOKIE,
  DEFAULT_APP_LOCALE,
  LEGACY_APP_LOCALE_COOKIE,
  appLanguageFromLocale,
  appLocaleFromAcceptLanguage,
  tryNormalizeAppLocale,
} from "@/i18n/config";

export const runtime = "nodejs";

type ResendMode = "invite" | "reset";

type Body = {
  email?: string;
  mode?: ResendMode;
  language?: string;
  lang?: string;
  locale?: string;
};

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildAppOrigin() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://app.inrcy.com").replace(/\/$/, "");
}

async function resolveRequestLanguage(req: Request, body: Body | null) {
  const cookieStore = await cookies();
  const locale =
    tryNormalizeAppLocale(body?.language || body?.lang || body?.locale) ||
    tryNormalizeAppLocale(cookieStore.get(APP_LOCALE_COOKIE)?.value) ||
    tryNormalizeAppLocale(cookieStore.get(LEGACY_APP_LOCALE_COOKIE)?.value) ||
    appLocaleFromAcceptLanguage(req.headers.get("accept-language")) ||
    DEFAULT_APP_LOCALE;

  return appLanguageFromLocale(locale);
}

function genericSuccessMessage() {
  return "Si ce compte existe, un nouveau lien sera envoyé à cette adresse.";
}

function sendFailed() {
  return NextResponse.json(
    { error: "Impossible d’envoyer un nouveau lien pour le moment. Veuillez réessayer ou contacter le support." },
    { status: 503 },
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const email = normalizeEmail(body?.email);
    const mode = body?.mode === "invite" ? "invite" : body?.mode === "reset" ? "reset" : null;
    const language = await resolveRequestLanguage(req, body);

    if (!mode) {
      return NextResponse.json({ error: "Type de lien invalide." }, { status: 400 });
    }

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "Adresse email invalide." }, { status: 400 });
    }

    const limited = await enforceRateLimit({
      name: `auth_resend_link_${mode}`,
      identifier: `${getClientIp(req)}:${email}`,
      limit: 3,
      window: "15 m",
      failClosed: true,
    });
    if (limited) return limited;

    const appOrigin = buildAppOrigin();

    if (mode === "reset") {
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: buildSupabaseEmailRedirectUrl(appOrigin, "/auth/finish-reset", language),
      });

      if (error) {
        log.warn("auth_resend_link_failed", { mode, error_code: error.code || "unknown" });
        return sendFailed();
      }

      return NextResponse.json({ ok: true, message: genericSuccessMessage() });
    }

    const canResendInvite = await hasKnownInrcyAccountForEmail(email);
    if (!canResendInvite) {
      return NextResponse.json({ ok: true, message: genericSuccessMessage() });
    }

    const inviteResult = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { app_language: language },
      redirectTo: buildSupabaseEmailRedirectUrl(appOrigin, "/auth/finish-invite", language),
    });

    if (!inviteResult.error) {
      return NextResponse.json({ ok: true, message: genericSuccessMessage() });
    }

    if (isExistingAuthUserError(inviteResult.error)) {
      const recoveryResult = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: buildSupabaseEmailRedirectUrl(appOrigin, "/auth/finish-reset", language),
      });

      if (!recoveryResult.error) {
        return NextResponse.json({
          ok: true,
          message: genericSuccessMessage(),
        });
      }
      log.warn("auth_resend_link_failed", {
        mode,
        stage: "recovery_fallback",
        error_code: recoveryResult.error.code || "unknown",
      });
    }

    log.warn("auth_resend_link_failed", {
      mode,
      stage: "invite",
      error_code: inviteResult.error.code || "unknown",
    });
    return sendFailed();
  } catch (error) {
    log.error("auth_resend_link_exception", {
      error_code: error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unknown",
    });
    return sendFailed();
  }
}
