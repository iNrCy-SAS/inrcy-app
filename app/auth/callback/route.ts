import { NextResponse } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { safeInternalPath } from "@/lib/security";
import { ensureNotificationPreferences } from "@/lib/notifications";
import { ensureProfileRow } from "@/lib/ensureProfileRow";
import { ACTIVE_USER_COOKIE } from "@/lib/browserAccountCache";
import { appLanguageFromLocale, tryNormalizeAppLocale } from "@/i18n/config";

function getFallbackPath(type?: string | null) {
  if (type === "recovery") return "/auth/finish-reset";
  if (type === "invite") return "/auth/finish-invite";
  return "/login";
}

function getFinishPath(type?: string | null) {
  if (type === "recovery") return "/auth/finish-reset";
  if (type === "invite") return "/auth/finish-invite";
  return null;
}

function normalizeEmail(input: string | null | undefined) {
  const value = String(input || "").trim().toLowerCase();
  return value || null;
}

function localizeFinishPath(path: string, url: URL) {
  if (path !== "/auth/finish-invite" && path !== "/auth/finish-reset") return path;

  const locale = tryNormalizeAppLocale(
    url.searchParams.get("lang") || url.searchParams.get("locale"),
  );
  const language = locale ? appLanguageFromLocale(locale) : null;
  return language ? `${path}/${language}` : path;
}

function buildTargetUrl(origin: string, nextPath: string, expectedEmail?: string | null) {
  const target = new URL(nextPath, origin);
  const isPasswordRoute =
    target.pathname === "/set-password" ||
    target.pathname.startsWith("/auth/finish-invite") ||
    target.pathname.startsWith("/auth/finish-reset");
  if (expectedEmail && isPasswordRoute && !target.searchParams.get("email")) {
    target.searchParams.set("email", expectedEmail);
  }
  return target;
}

function redirectWithError(
  req: Request,
  fallbackPath: string,
  code?: string | null,
  description?: string | null,
  expectedEmail?: string | null,
) {
  const requestUrl = new URL(req.url);
  const url = buildTargetUrl(
    requestUrl.origin,
    localizeFinishPath(fallbackPath, requestUrl),
    expectedEmail,
  );
  if (code) url.searchParams.set("error_code", code);
  if (description) url.searchParams.set("error_description", description);
  return NextResponse.redirect(url);
}

function withActiveUserCookie(response: NextResponse, userId?: string | null, reqUrl?: URL) {
  if (!userId) return response;
  response.cookies.set(ACTIVE_USER_COOKIE, userId, {
    path: "/",
    sameSite: "lax",
    secure: (reqUrl?.protocol || "").toLowerCase() === "https:",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

function buildSwitchAccountUrl(url: URL, currentEmail: string, expectedEmail: string) {
  const switchUrl = new URL("/auth/switch-account", url.origin);
  switchUrl.searchParams.set("current_email", currentEmail);
  switchUrl.searchParams.set("expected_email", expectedEmail);
  switchUrl.searchParams.set("continue", `${url.pathname}${url.search}`);
  return switchUrl;
}

function buildFinishUrl(url: URL, type: string, tokenHash: string, nextPath: string, expectedEmail?: string | null) {
  const finishPath = localizeFinishPath(getFinishPath(type) || "/login", url);
  const target = new URL(finishPath, url.origin);
  target.searchParams.set("token_hash", tokenHash);
  target.searchParams.set("type", type);
  target.searchParams.set("next", nextPath);
  if (expectedEmail) {
    target.searchParams.set("email", expectedEmail);
  }
  return target;
}

function buildSessionFinishUrl(url: URL, type: string, nextPath: string, expectedEmail?: string | null) {
  const basePath = localizeFinishPath(getFinishPath(type) || "/login", url);
  const target = new URL(basePath, url.origin);
  target.searchParams.set("source", "session");
  target.searchParams.set("type", type);
  target.searchParams.set("next", nextPath);
  if (expectedEmail) target.searchParams.set("email", expectedEmail);
  return target;
}

export async function GET(req: Request) {
  const supabase = await createSupabaseServer();
  const url = new URL(req.url);
  const { searchParams } = url;

  const nextParam = safeInternalPath(searchParams.get("next") || "/dashboard", "/dashboard");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const expectedEmail = normalizeEmail(searchParams.get("email"));

  if (error) {
    return redirectWithError(req, getFallbackPath(type), error, errorDescription, expectedEmail);
  }

  if (tokenHash && type) {
    if (expectedEmail) {
      const { data: currentUserData } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      const currentEmail = normalizeEmail(currentUserData?.user?.email);
      if (currentEmail && currentEmail !== expectedEmail) {
        return NextResponse.redirect(buildSwitchAccountUrl(url, currentEmail, expectedEmail));
      }
    }

    const finishPath = getFinishPath(type);
    if (finishPath) {
      return NextResponse.redirect(buildFinishUrl(url, type, tokenHash, nextParam, expectedEmail));
    }

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (verifyError) {
      return redirectWithError(req, getFallbackPath(type), verifyError.code, verifyError.message, expectedEmail);
    }

    const authUser = data.user;
    const userId = authUser?.id;
    const verifiedEmail = normalizeEmail(authUser?.email);

    if (expectedEmail && verifiedEmail && verifiedEmail !== expectedEmail) {
      return redirectWithError(
        req,
        getFallbackPath(type),
        "email_mismatch",
        "Ce lien ne correspond pas au compte attendu.",
        expectedEmail,
      );
    }

    if (authUser) {
      await ensureProfileRow(authUser).catch(() => null);
    }
    if (userId) {
      await ensureNotificationPreferences(userId).catch(() => null);
    }

    const response = NextResponse.redirect(buildTargetUrl(url.origin, nextParam, expectedEmail || verifiedEmail));
    return withActiveUserCookie(response, userId, url);
  }

  if (code) {
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      return redirectWithError(req, "/login", exchangeError.code, exchangeError.message, expectedEmail);
    }

    const authUser = data?.user;
    const userId = authUser?.id;

    if (authUser) {
      await ensureProfileRow(authUser).catch(() => null);
    }
    if (userId) {
      await ensureNotificationPreferences(userId).catch(() => null);
    }

    const verifiedEmail = normalizeEmail(authUser?.email) || expectedEmail;
    const finishPath = getFinishPath(type);
    const target = finishPath
      ? buildSessionFinishUrl(url, type || "", nextParam, verifiedEmail)
      : buildTargetUrl(url.origin, nextParam, verifiedEmail);
    const response = NextResponse.redirect(target);
    return withActiveUserCookie(response, userId, url);
  }

  return NextResponse.redirect(new URL("/login", url.origin));
}
