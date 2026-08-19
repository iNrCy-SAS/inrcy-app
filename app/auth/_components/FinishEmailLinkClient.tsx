"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabaseClient";
import {
  purgeAllBrowserAccountCaches,
  setActiveBrowserUserId,
} from "@/lib/browserAccountCache";
import { waitForServerAuthSession } from "@/lib/browserAuthSessionReady";
import { appLanguageFromLocale, tryNormalizeAppLocale } from "@/i18n/config";
import { readAuthEmailLinkParams } from "@/lib/authEmailLinks";
import { evaluatePassword } from "@/lib/passwordPolicy";
import AuthLanguageSelector from "./AuthLanguageSelector";

type Mode = "invite" | "reset";

type Props = {
  mode: Mode;
  initialLanguage?: string;
  allowSessionFallback?: boolean;
};

type SessionContinuation = {
  access_token: string;
  refresh_token: string;
};

type FinishPasswordResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  retryable?: boolean;
  user_id?: string;
  email?: string | null;
  session?: Partial<SessionContinuation> | null;
  continuation_available?: boolean;
};

function normalizeEmail(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function readSessionContinuation(value?: Partial<SessionContinuation> | null) {
  const accessToken = String(value?.access_token || "").trim();
  const refreshToken = String(value?.refresh_token || "").trim();
  if (!accessToken || !refreshToken) return null;
  return { access_token: accessToken, refresh_token: refreshToken };
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

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 ${ok ? "text-emerald-300" : "text-slate-400"}`}>
      <span aria-hidden="true">{ok ? "●" : "○"}</span>
      <span>{label}</span>
    </div>
  );
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

export default function FinishEmailLinkClient({
  mode,
  initialLanguage,
  allowSessionFallback = false,
}: Props) {
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
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const [continuation, setContinuation] = useState<SessionContinuation | null>(null);
  const [serverContinuationAvailable, setServerContinuationAvailable] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const tokenHash = emailLinkParams.tokenHash;
  const rawType = searchParams.get("type");
  const type = (rawType || (mode === "invite" ? "invite" : "recovery")) as EmailOtpType;
  const expectedEmail = normalizeEmail(searchParams.get("email"));
  const accountEmail = expectedEmail || sessionEmail;
  const requestedNextPath = safeContinuePath(searchParams.get("next") || "/dashboard", "/dashboard");
  const nextPath = requestedNextPath.startsWith("/set-password") ? "/dashboard" : requestedNextPath;
  const sessionSourceRequested = allowSessionFallback || searchParams.get("source") === "session";
  const hasIncomingLinkError = Boolean(
    searchParams.get("error") ||
    searchParams.get("error_code") ||
    searchParams.get("error_description"),
  );
  const isInvite = mode === "invite";
  const strength = useMemo(() => evaluatePassword(password), [password]);
  const strengthLabel =
    strength.score <= 2
      ? t("weak")
      : strength.score <= 4
        ? t("medium")
        : t("strong");

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

    const prepareCredential = async () => {
      let browserContinuation: SessionContinuation | null = null;
      let serverCanResume = false;
      const { data, error } = await supabase.auth
        .getUser()
        .catch(() => ({ data: { user: null }, error: null }));
      if (cancelled) return;

      const currentUser = data?.user;
      const currentEmail = normalizeEmail(currentUser?.email);

      if (!error && currentUser) {
        setActiveBrowserUserId(currentUser.id);

        if (expectedEmail && currentEmail && currentEmail !== expectedEmail) {
          window.location.replace(buildSwitchAccountUrl(currentEmail, expectedEmail));
          return;
        }

        // A session is a valid continuation only when the route explicitly
        // requests it (legacy links/PKCE) or when it belongs to the email named
        // by the link. An unrelated open account can never consume the link.
        const canReuseCurrentSession =
          sessionSourceRequested || Boolean(expectedEmail && currentEmail === expectedEmail);

        if (canReuseCurrentSession) {
          const { data: sessionData } = await supabase.auth
            .getSession()
            .catch(() => ({ data: { session: null } }));
          browserContinuation = readSessionContinuation(sessionData.session);
          if (browserContinuation) {
            setContinuation(browserContinuation);
            setSessionEmail(currentEmail);
          }
        }
      }

      try {
        const statusUrl = new URL("/api/auth/finish-password", window.location.origin);
        statusUrl.searchParams.set("mode", mode);
        if (expectedEmail) statusUrl.searchParams.set("email", expectedEmail);
        const statusResponse = await fetch(statusUrl.toString(), {
          cache: "no-store",
          credentials: "same-origin",
        });
        const statusPayload = (await statusResponse.json().catch(() => null)) as
          | FinishPasswordResponse
          | null;
        serverCanResume = Boolean(statusResponse.ok && statusPayload?.continuation_available);
        if (serverCanResume) setServerContinuationAvailable(true);
      } catch {
        serverCanResume = false;
      }

      if (hasIncomingLinkError && !browserContinuation && !serverCanResume) {
        setLinkRejected(true);
        setMessage(t("linkInvalid"));
      } else if (sessionSourceRequested && !tokenHash && !browserContinuation && !serverCanResume) {
        setLinkRejected(true);
        setMessage(t("sessionFailed"));
      }

      setReady(true);
    };

    void prepareCredential();

    return () => {
      cancelled = true;
    };
  }, [
    expectedEmail,
    hasIncomingLinkError,
    mode,
    sessionSourceRequested,
    supabase,
    t,
    tokenHash,
  ]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((value) => (value > 1 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  function validatePassword() {
    if (!strength.isStrong) return t("tooWeak");
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
      case "password_rejected":
        return t("passwordRejected");
      case "password_save_retryable":
        return t("retryWithoutNewLink");
      case "invalid_action":
        return t("invalidAction");
      case "session_failed":
        return t("sessionFailed");
      case "account_mismatch":
        return t("accountMismatch");
      case "account_unavailable":
        return t("accountUnavailable");
      case "password_save_failed":
        return t("passwordSaveFailed");
      default:
        return t("finishFailed");
    }
  }

  async function onResendLink() {
    if (!accountEmail || resendLoading || resendCooldown > 0) return;

    setResendLoading(true);
    setResendError(null);
    setResendInfo(null);

    try {
      const res = await fetch("/api/auth/resend-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: accountEmail, mode, language: appLanguage }),
      });
      await res.json().catch(() => null);

      if (!res.ok) {
        setResendError(res.status === 429 ? t("resendRateLimited") : t("sendFailed"));
        return;
      }

      setResendInfo(
        isInvite
          ? t("resendInviteSuccess", { email: accountEmail })
          : t("resendResetSuccess", { email: accountEmail }),
      );
      setResendCooldown(30);
    } catch {
      setResendError(t("sendFailed"));
    } finally {
      setResendLoading(false);
    }
  }

  async function finishSuccessfulResponse(payload: FinishPasswordResponse) {
    const completedSession = readSessionContinuation(payload.session) || continuation;
    if (payload.user_id) setActiveBrowserUserId(payload.user_id);

    if (completedSession) {
      purgeAllBrowserAccountCaches();
      const { data: installedSession, error: sessionError } = await supabase.auth.setSession(completedSession);
      if (!sessionError) {
        const resolvedUserId = payload.user_id || installedSession.user?.id;
        if (resolvedUserId) setActiveBrowserUserId(resolvedUserId);
        const serverSessionReady = await waitForServerAuthSession();
        if (serverSessionReady) {
          setSuccess(isInvite ? t("inviteRedirectSuccess") : t("resetRedirectSuccess"));
          window.location.replace(nextPath);
          return;
        }
      }
    }

    // Le mot de passe est déjà enregistré. Une synchronisation de cookie ne
    // doit jamais obliger l’utilisateur à redemander un lien à usage unique.
    setSuccess(isInvite ? t("inviteLoginSuccess") : t("resetLoginSuccess"));
    window.setTimeout(() => {
      window.location.replace(`/login?lang=${appLanguage}`);
    }, 1200);
  }

  async function recoverAlreadyCommittedPassword() {
    if (!accountEmail) return false;

    purgeAllBrowserAccountCaches();
    setActiveBrowserUserId(null);
    await supabase.auth.signOut({ scope: "local" }).catch(() => null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: accountEmail,
      password,
    });
    if (error || !data.user || !data.session) return false;

    setActiveBrowserUserId(data.user.id);
    const serverSessionReady = await waitForServerAuthSession();
    setSuccess(isInvite ? t("inviteRedirectSuccess") : t("resetRedirectSuccess"));
    window.location.replace(serverSessionReady ? nextPath : `/login?lang=${appLanguage}`);
    return true;
  }

  async function submitPassword(
    credential: SessionContinuation | null,
    allowAutomaticRetry: boolean,
    continueOnServer = false,
  ): Promise<void> {
    const res = await fetch("/api/auth/finish-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        mode,
        type,
        token_hash: credential || continueOnServer ? undefined : tokenHash,
        continuation: continueOnServer ? undefined : credential,
        email: accountEmail,
        password,
        language: appLanguage,
      }),
    });

    const payload = (await res.json().catch(() => null)) as FinishPasswordResponse | null;

    if (res.ok && payload?.ok) {
      await finishSuccessfulResponse(payload);
      return;
    }

    const serverCanResume = Boolean(payload?.continuation_available);
    if (serverCanResume) {
      setServerContinuationAvailable(true);
      if (payload?.code === "password_save_retryable" && allowAutomaticRetry) {
        await wait(250);
        await submitPassword(null, false, true);
        return;
      }
    }

    if (payload?.code === "auth_link_invalid") {
      // Si la réponse du premier POST a été perdue après l’écriture du mot de
      // passe, le jeton est consommé mais le nouveau mot de passe fonctionne.
      // Une connexion contrôlée rend l’opération idempotente côté utilisateur.
      if (await recoverAlreadyCommittedPassword()) return;
      setLinkRejected(true);
    }

    if (
      !serverCanResume &&
      ["link_incomplete", "session_failed", "password_save_failed"].includes(payload?.code || "")
    ) {
      setLinkRejected(true);
    }

    if (payload?.code === "account_unavailable") {
      setAccountUnavailable(true);
      setLinkRejected(true);
    }

    setMessage(res.status === 429 ? t("resendRateLimited") : getFinishErrorMessage(payload?.code));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    setSuccess(null);
    setResendInfo(null);
    setResendError(null);

    if (linkRejected && !continuation && !serverContinuationAvailable) {
      setMessage(accountUnavailable ? t("accountUnavailable") : t("linkInvalid"));
      return;
    }

    if (!continuation && !tokenHash && !serverContinuationAvailable) {
      setMessage(sessionSourceRequested ? t("sessionFailed") : t("linkIncomplete"));
      return;
    }

    const validationError = validatePassword();
    if (validationError) {
      setMessage(validationError);
      return;
    }

    setLoading(true);
    try {
      await submitPassword(continuation, true, serverContinuationAvailable);
    } catch (error) {
      console.error(error);
      setMessage(isInvite ? t("inviteException") : t("resetException"));
    } finally {
      setLoading(false);
    }
  }

  const confirmTouched = confirm.length > 0;
  const confirmOk = confirmTouched && password === confirm;
  const hasCredential = Boolean(serverContinuationAvailable || continuation || tokenHash);
  const canSubmit =
    ready &&
    !loading &&
    (!linkRejected || Boolean(continuation) || serverContinuationAvailable) &&
    hasCredential &&
    strength.isAcceptable &&
    password === confirm;
  const canResend =
    !accountUnavailable && Boolean(accountEmail) && (linkRejected || !hasCredential);
  const title = isInvite ? t("inviteTitle") : t("resetTitle");
  const body = isInvite ? t("inviteBody") : t("resetBody");

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
      <AuthLanguageSelector />
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-300">
          {isInvite ? t("inviteEyebrow") : t("resetEyebrow")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-white">{title}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-200">{body}</p>
        {accountEmail ? (
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {t("expectedAccount")} <strong>{accountEmail}</strong>
          </p>
        ) : null}

        {ready && !hasCredential && !message ? (
          <p
            data-testid="auth-link-error"
            className="mt-5 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
          >
            {sessionSourceRequested ? t("sessionFailed") : t("linkIncomplete")}
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
            <div
              data-testid={linkRejected ? "auth-link-error" : "auth-password-error"}
              className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            >
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
