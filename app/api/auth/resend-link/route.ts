import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getClientIp, enforceRateLimit } from "@/lib/rateLimit";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
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

function buildLocalizedFinishUrl(appOrigin: string, path: string, language: string) {
  const url = new URL(path, `${appOrigin}/`);
  url.searchParams.set("lang", language);
  return url.toString();
}

function successMessage(mode: ResendMode, email: string) {
  return mode === "invite"
    ? `Un nouveau lien d’accès vient d’être envoyé à ${email}.`
    : `Un nouveau lien de réinitialisation vient d’être envoyé à ${email}.`;
}

function genericInviteMessage(email: string) {
  return `Si un accès iNrCy existe pour ${email}, un nouveau lien vient d’être envoyé.`;
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
        redirectTo: buildLocalizedFinishUrl(appOrigin, "/auth/finish-reset", language),
      });

      if (error) {
        return NextResponse.json(
          { error: getSimpleFrenchErrorMessage(error, "Impossible d’envoyer un nouveau lien pour le moment.") },
          { status: 400 },
        );
      }

      return NextResponse.json({ ok: true, message: successMessage(mode, email) });
    }

    const canResendInvite = await hasKnownInrcyAccountForEmail(email);
    if (!canResendInvite) {
      return NextResponse.json({ ok: true, message: genericInviteMessage(email) });
    }

    const inviteResult = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: buildLocalizedFinishUrl(appOrigin, "/auth/finish-invite", language),
    });

    if (!inviteResult.error) {
      return NextResponse.json({ ok: true, message: successMessage(mode, email) });
    }

    if (isExistingAuthUserError(inviteResult.error)) {
      const recoveryResult = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: buildLocalizedFinishUrl(appOrigin, "/auth/finish-reset", language),
      });

      if (!recoveryResult.error) {
        return NextResponse.json({
          ok: true,
          message: `Un nouveau lien pour définir votre mot de passe vient d’être envoyé à ${email}.`,
        });
      }
    }

    return NextResponse.json(
      { error: getSimpleFrenchErrorMessage(inviteResult.error, "Impossible d’envoyer un nouveau lien pour le moment.") },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: getSimpleFrenchErrorMessage(error, "Impossible d’envoyer un nouveau lien pour le moment.") },
      { status: 500 },
    );
  }
}
