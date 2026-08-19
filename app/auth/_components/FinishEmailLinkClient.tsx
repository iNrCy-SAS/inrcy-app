"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabaseClient";
import { setActiveBrowserUserId } from "@/lib/browserAccountCache";
import { appLanguageFromLocale, tryNormalizeAppLocale } from "@/i18n/config";
import { readAuthEmailLinkParams } from "@/lib/authEmailLinks";
import AuthLanguageSelector from "./AuthLanguageSelector";

type Mode = "invite" | "reset";

type Props = {
  mode: Mode;
  initialLanguage?: string;
};

type FinishPasswordResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  user_id?: string;
  email?: string | null;
  session?: {
    access_token?: string;
    refresh_token?: string;
  } | null;
};

function normalizeEmail(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function safeContinuePath(input: string | null, fallback: string) {
  if (!input) return fallback;
  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  return input;
}

function buildSwitchAccountUrl(currentEmail: string, expectedEmail: string) {
  const url = new URL("/auth/switch-account", window.location.origin);
  url.searchParams.set("current_email", currentEmail);
  url.searchParams.set("expected_email", expectedEmail);
  url.searchParams.set("continue", `${window.location.pathname}${window.location.search}`);
  return url.toString();
}

function getPasswordStrength(pw: string) {
  const rules = {
    minLen: pw.length >= 8,
    hasLetter: /[a-zA-Z]/.test(pw),
    hasNumber: /\d/.test(pw),
    hasUpper: /[A-Z]/.test(pw),
    hasSymbol: /[^a-zA-Z0-9]/.test(pw),
  };

  const score = Object.values(rules).filter(Boolean).length;
  const percent = (score / 5) * 100;
  const isStrong = score === 5;

  return { rules, score, percent, isStrong };
}

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 ${ok ? "text-emerald-300" : "text-slate-400"}`}>
      <span aria-hidden="true">{ok ? "●" : "○"}</span>
      <span>{label}</span>
    </div>
  );
}

export default function FinishEmailLinkClient({ mode, initialLanguage }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const currentLocale = useLocale();
  const emailLinkParams = useMemo(
    () => readAuthEmailLinkParams(searchParams),
    [searchParams],
  );
  const recoveredLocale = tryNormalizeAppLocale(
    emailLinkParams.language || initialLanguage,
  );
  const appLanguage = appLanguageFromLocale(recoveredLocale || currentLocale);
  const t = useTranslations("auth.password");

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendInfo, setResendInfo] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [linkRejected, setLinkRejected] = useState(false);

  const tokenHash = emailLinkParams.tokenHash;
  const rawType = searchParams.get("type");
  const type = (rawType || (mode === "invite" ? "invite" : "recovery")) as EmailOtpType;
  const expectedEmail = normalizeEmail(searchParams.get("email"));
  const requestedNextPath = safeContinuePath(searchParams.get("next") || "/dashboard", "/dashboard");
  const nextPath = requestedNextPath.startsWith("/set-password") ? "/dashboard" : requestedNextPath;
  const isInvite = mode === "invite";
  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const strengthLabel =
    strength.score <= 2 ? t("weak") : strength.score <= 4 ? t("medium") : t("strong");

  useEffect(() => {
    if (!emailLinkParams.recoveredMalformedQuery || !tokenHash) return;

    const canonicalUrl = new URL(window.location.href);
    if (emailLinkParams.language) {
      canonicalUrl.searchParams.set("lang", emailLinkParams.language);
    } else {
      canonicalUrl.searchParams.delete("lang");
    }
    canonicalUrl.searchParams.set("token_hash", tokenHash);
    window.history.replaceState(
      window.history.state,
      "",
      `${canonicalUrl.pathname}${canonicalUrl.search}${canonicalUrl.hash}`,
    );
  }, [emailLinkParams.language, emailLinkParams.recoveredMalformedQuery, tokenHash]);

  useEffect(() => {
    let cancelled = false;

    const checkCurrentSession = async () => {
      if (!expectedEmail) {
        if (!cancelled) setReady(true);
        return;
      }

      const { data, error } = await supabase.auth.getUser().catch(() => ({ data: { user: null }, error: null }));
      if (cancelled) return;

      const currentUser = data?.user;
      if (error || !currentUser) {
        setReady(true);
        return;
      }

      if (currentUser.id) {
        setActiveBrowserUserId(currentUser.id);
      }

      const currentEmail = normalizeEmail(currentUser.email);
      if (currentEmail && currentEmail !== expectedEmail) {
        window.location.replace(buildSwitchAccountUrl(currentEmail, expectedEmail));
        return;
      }

      setReady(true);
    };

    void checkCurrentSession();

    return () => {
      cancelled = true;
    };
  }, [expectedEmail, supabase]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((value) => (value > 1 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  function validatePassword() {
    if (!strength.isStrong) {
      return t("tooWeak");
    }
    if (password !== confirm) return t("mismatch");
    return null;
  }

  function getFinishErrorMessage(code?: string) {
    switch (code) {
      case "auth_link_invalid":
        return t("linkInvalid");
      case "link_incomplete":
        return t("linkIncomplete");
      case "password_too_weak":
        return t("tooWeak");
      case "invalid_action":
        return t("invalidAction");
      case "session_failed":
        return t("sessionFailed");
      case "account_mismatch":
        return t("accountMismatch");
      case "password_save_failed":
        return t("passwordSaveFailed");
      default:
        return t("finishFailed");
    }
  }

  async function onResendLink() {
    if (!expectedEmail || resendLoading || resendCooldown > 0) return;

    setResendLoading(true);
    setResendError(null);
    setResendInfo(null);

    try {
      const res = await fetch("/api/auth/resend-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: expectedEmail, mode, language: appLanguage }),
      });
      await res.json().catch(() => null);

      if (!res.ok) {
        setResendError(res.status === 429 ? t("resendRateLimited") : t("sendFailed"));
        return;
      }

      setResendInfo(
        isInvite
          ? t("resendInviteSuccess", { email: expectedEmail })
          : t("resendResetSuccess", { email: expectedEmail }),
      );
      setResendCooldown(30);
    } catch {
      setResendError(t("sendFailed"));
    } finally {
      setResendLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    setSuccess(null);
    setResendInfo(null);
    setResendError(null);

    if (linkRejected) {
      setMessage(t("linkInvalid"));
      return;
    }

    if (!tokenHash) {
      setMessage(t("linkIncomplete"));
      return;
    }

    const validationError = validatePassword();
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/finish-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          type,
          token_hash: tokenHash,
          email: expectedEmail,
          password,
          language: appLanguage,
        }),
      });

      const payload = (await res.json().catch(() => null)) as FinishPasswordResponse | null;

      if (!res.ok || !payload?.ok) {
        if (payload?.code === "auth_link_invalid") {
          // Empêche les nouveaux POST /auth/v1/verify avec le même lien déjà
          // refusé pendant que cette page reste ouverte.
          setLinkRejected(true);
        }
        setMessage(getFinishErrorMessage(payload?.code));
        return;
      }

      if (payload.user_id) {
        setActiveBrowserUserId(payload.user_id);
      }

      if (payload.session?.access_token && payload.session?.refresh_token) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: payload.session.access_token,
          refresh_token: payload.session.refresh_token,
        });

        if (!sessionError) {
          setSuccess(
            isInvite
              ? t("inviteRedirectSuccess")
              : t("resetRedirectSuccess"),
          );
          window.location.replace(nextPath);
          return;
        }
      }

      setSuccess(
        isInvite
          ? t("inviteLoginSuccess")
          : t("resetLoginSuccess"),
      );
      window.setTimeout(() => {
        window.location.replace(`/login?lang=${appLanguage}`);
      }, 1200);
    } catch (error) {
      console.error(error);
      setMessage(
        isInvite
          ? t("inviteException")
          : t("resetException"),
      );
    } finally {
      setLoading(false);
    }
  }

  const confirmTouched = confirm.length > 0;
  const confirmOk = confirmTouched && password === confirm;
  const canSubmit = ready && !loading && !linkRejected && Boolean(tokenHash) && strength.isStrong && password === confirm;
  const canResend = Boolean(expectedEmail) && (linkRejected || !tokenHash);
  const title = isInvite ? t("inviteTitle") : t("resetTitle");
  const body = isInvite
    ? t("inviteBody")
    : t("resetBody");

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
      <AuthLanguageSelector />
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-300">
          {isInvite ? t("inviteEyebrow") : t("resetEyebrow")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-white">{title}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-200">{body}</p>
        {expectedEmail ? (
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {t("expectedAccount")} <strong>{expectedEmail}</strong>
          </p>
        ) : null}

        {!tokenHash ? (
          <p className="mt-5 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {t("linkIncomplete")}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-7 space-y-4">
          <div className="relative">
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 pr-12 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-300"
              type={showPassword ? "text" : "password"}
              placeholder={t("newPassword")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
              aria-label={showPassword ? t("hidePassword") : t("showPassword")}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">{t("protectionLevel")}</span>
              <span
                className={
                  strength.score === 5
                    ? "text-emerald-300"
                    : strength.score >= 3
                    ? "text-amber-300"
                    : "text-rose-300"
                }
              >
                {strengthLabel}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                style={{ width: `${strength.percent}%` }}
                className="h-full rounded-full bg-cyan-300 transition-all"
              />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-1 text-xs">
              <Rule ok={strength.rules.minLen} label={t("minLength")} />
              <Rule ok={strength.rules.hasLetter} label={t("letter")} />
              <Rule ok={strength.rules.hasNumber} label={t("number")} />
              <Rule ok={strength.rules.hasUpper} label={t("uppercase")} />
              <Rule ok={strength.rules.hasSymbol} label={t("symbol")} />
            </div>
          </div>

          <div className="relative">
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/95 px-4 py-3 pr-12 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-300"
              type={showConfirmPassword ? "text" : "password"}
              placeholder={t("confirmPassword")}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800"
              aria-label={showConfirmPassword ? t("hidePassword") : t("showPassword")}
            >
              {showConfirmPassword ? "🙈" : "👁️"}
            </button>
          </div>

          {confirmTouched ? (
            confirmOk ? (
              <p className="text-xs text-emerald-300">{t("passwordsMatch")}</p>
            ) : (
              <p className="text-xs text-rose-300">{t("passwordsDoNotMatch")}</p>
            )
          ) : null}

          {message ? (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {message}
            </div>
          ) : null}

          {canResend ? (
            <div className="space-y-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3">
              <div className="text-sm text-cyan-50">
                {isInvite ? t("needInviteLink") : t("needResetLink")}
              </div>
              <button
                type="button"
                onClick={onResendLink}
                disabled={resendLoading || resendCooldown > 0}
                className="inline-flex w-full items-center justify-center rounded-xl border border-cyan-200/30 bg-white/10 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resendLoading
                  ? t("sending")
                  : resendCooldown > 0
                  ? t("resendIn", { seconds: resendCooldown })
                  : t("sendNewLink")}
              </button>
              {resendInfo ? <div className="text-sm text-emerald-200">{resendInfo}</div> : null}
              {resendError ? <div className="text-sm text-rose-200">{resendError}</div> : null}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {success}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex flex-1 items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {!ready
                ? t("verifying")
                : loading
                ? t("saving")
                : isInvite
                ? t("createPassword")
                : t("resetPassword")}
            </button>
            <Link
              href={`/login?lang=${appLanguage}`}
              className="inline-flex items-center justify-center rounded-2xl border border-white/15 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/5"
            >
              {t("backToLogin")}
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
