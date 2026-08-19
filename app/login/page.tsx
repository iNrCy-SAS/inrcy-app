"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabaseClient";
import { appLanguageFromLocale } from "@/i18n/config";
import {
  purgeAllBrowserAccountCaches,
  setActiveBrowserUserId,
} from "@/lib/browserAccountCache";
import { waitForServerAuthSession } from "@/lib/browserAuthSessionReady";
import { buildSupabaseEmailRedirectUrl } from "@/lib/authEmailLinks";
import AuthLanguageSelector from "@/app/auth/_components/AuthLanguageSelector";
import styles from "./login.module.css";

type WanderDot = {
  left: string; // %
  top: string; // %
  size: number; // px
  dur: number; // s
  delay: number; // s
  alpha: number; // 0-1
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;
  x5: number;
  y5: number;
};

type CSSVars = React.CSSProperties & Record<`--${string}`, string>;

type LoginDiagnosticReason = "network" | "technical" | "storage";

type LoginErrorState = {
  title: string;
  message: string;
  hint?: string;
  diagnosticReason?: LoginDiagnosticReason;
};

function rawErrorMessage(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (input instanceof Error) return String(input.message || "").trim();
  if (input && typeof input === "object") {
    const maybe = input as {
      message?: unknown;
      error?: unknown;
      statusText?: unknown;
      name?: unknown;
    };
    if (typeof maybe.message === "string") return maybe.message.trim();
    if (typeof maybe.error === "string") return maybe.error.trim();
    if (typeof maybe.statusText === "string") return maybe.statusText.trim();
    if (typeof maybe.name === "string") return maybe.name.trim();
  }
  return "";
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

type LoginErrorKind =
  | "invalidCredentials"
  | "emailUnconfirmed"
  | "linkUnavailable"
  | "network"
  | "storage"
  | "service"
  | "technical";

function classifyLoginError(input: unknown): LoginErrorKind {
  const raw = rawErrorMessage(input);
  const message = raw.toLowerCase();

  if (
    hasAny(message, [
      "invalid login credentials",
      "invalid credentials",
      "email not found",
      "wrong password",
    ])
  ) {
    return "invalidCredentials";
  }

  if (hasAny(message, ["email not confirmed", "email_not_confirmed"])) {
    return "emailUnconfirmed";
  }

  if (
    hasAny(message, [
      "otp_expired",
      "expired",
      "invalid token",
      "email link is invalid",
      "email rate limit",
      "over_email_send_rate_limit",
    ])
  ) {
    return "linkUnavailable";
  }

  if (
    hasAny(message, [
      "failed to fetch",
      "networkerror",
      "network request failed",
      "load failed",
      "fetch failed",
      "econnreset",
      "econnrefused",
      "enotfound",
      "socket hang up",
      "aborterror",
      "timeout",
      "timed out",
    ])
  ) {
    return "network";
  }

  if (
    hasAny(message, [
      "auth session missing",
      "session",
      "storage",
      "localstorage",
      "cookie",
      "cookies",
    ])
  ) {
    return "storage";
  }

  if (
    hasAny(message, [
      "500",
      "502",
      "503",
      "504",
      "server error",
      "internal server error",
      "service unavailable",
    ])
  ) {
    return "service";
  }

  return "technical";
}

function makeLoginError(
  title: string,
  message: string,
  options?: { hint?: string; diagnosticReason?: LoginDiagnosticReason },
): LoginErrorState {
  return {
    title,
    message,
    hint: options?.hint,
    diagnosticReason: options?.diagnosticReason,
  };
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function rint(min: number, max: number) {
  return Math.round(rand(min, max));
}

export default function LoginPage() {
  const locale = useLocale();
  const t = useTranslations("auth.login");
  const appLanguage = appLanguageFromLocale(locale);
  const [supabaseReady, setSupabaseReady] = useState(false);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [redirectingToDashboard, setRedirectingToDashboard] = useState(false);
  const [error, setError] = useState<LoginErrorState | null>(null);

  const friendlyLoginError = (
    input: unknown,
    fallback = t("errors.defaultLogin"),
  ): LoginErrorState => {
    switch (classifyLoginError(input)) {
      case "invalidCredentials":
        return makeLoginError(
          t("errors.invalidCredentialsTitle"),
          t("errors.invalidCredentialsMessage"),
          { hint: t("errors.invalidCredentialsHint") },
        );
      case "emailUnconfirmed":
        return makeLoginError(
          t("errors.emailUnconfirmedTitle"),
          t("errors.emailUnconfirmedMessage"),
          { hint: t("errors.emailUnconfirmedHint") },
        );
      case "linkUnavailable":
        return makeLoginError(
          t("errors.linkUnavailableTitle"),
          t("errors.linkUnavailableMessage"),
          { hint: t("errors.linkUnavailableHint") },
        );
      case "network":
        return makeLoginError(
          t("errors.networkTitle"),
          t("errors.networkMessage"),
          {
            hint: t("errors.networkHint"),
            diagnosticReason: "network",
          },
        );
      case "storage":
        return makeLoginError(
          t("errors.storageTitle"),
          t("errors.storageMessage"),
          {
            hint: t("errors.storageHint"),
            diagnosticReason: "storage",
          },
        );
      case "service":
        return makeLoginError(
          t("errors.serviceTitle"),
          t("errors.serviceMessage"),
          {
            hint: t("errors.serviceHint"),
            diagnosticReason: "technical",
          },
        );
      default:
        return makeLoginError(t("errors.technicalTitle"), fallback, {
          hint: t("errors.technicalHint"),
          diagnosticReason: "technical",
        });
    }
  };

  // ✅ ajout : message info (succès reset password)
  const [info, setInfo] = useState<string | null>(null);

  const dotColors = useMemo(
    () => [
      { a: "rgba(0,180,255,1)", b: "rgba(120,90,255,1)" },
      { a: "rgba(255,55,140,1)", b: "rgba(255,140,0,1)" },
      { a: "rgba(120,90,255,1)", b: "rgba(0,180,255,1)" },
      { a: "rgba(34,197,94,1)", b: "rgba(0,180,255,1)" },
      { a: "rgba(255,140,0,1)", b: "rgba(255,55,140,1)" },
      { a: "rgba(59,130,246,1)", b: "rgba(0,180,255,1)" },
      { a: "rgba(168,85,247,1)", b: "rgba(255,55,140,1)" },
      { a: "rgba(250,204,21,1)", b: "rgba(255,140,0,1)" },
      { a: "rgba(236,72,153,1)", b: "rgba(168,85,247,1)" },
      { a: "rgba(14,165,233,1)", b: "rgba(34,197,94,1)" },
    ],
    [],
  );

  const [mounted, setMounted] = useState(false);
  const [dots, setDots] = useState<WanderDot[]>([]);
  const handledHashRef = useRef(false);
  const redirectingToDashboardRef = useRef(false);

  const diagnosticHref = useMemo(() => {
    if (!error?.diagnosticReason) return "/diagnostic";
    const params = new URLSearchParams({
      from: "login",
      reason: error.diagnosticReason,
      auto: "1",
    });
    return `/diagnostic?${params.toString()}`;
  }, [error?.diagnosticReason]);

  useEffect(() => {
    if (typeof window === "undefined" || !supabaseReady) return;

    const supabase = supabaseRef.current;
    if (!supabase) return;

    const hash = window.location.hash;
    const search = window.location.search;
    const hasAuthFlowInUrl =
      hash.includes("access_token=") ||
      hash.includes("error=") ||
      search.includes("error=");

    if (hasAuthFlowInUrl) {
      redirectingToDashboardRef.current = false;
      setRedirectingToDashboard(false);
      setCheckingSession(false);
      return;
    }

    let cancelled = false;
    setCheckingSession(true);

    const redirectToDashboard = () => {
      if (cancelled) return;
      redirectingToDashboardRef.current = true;
      setRedirectingToDashboard(true);
      setCheckingSession(true);
      window.location.replace("/dashboard");
    };

    const ensureExistingSession = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;
        if (!session || cancelled) return;

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (!cancelled && !error && user) {
          setActiveBrowserUserId(user.id);
          const serverSessionReady = await waitForServerAuthSession();
          if (!cancelled && serverSessionReady) {
            redirectToDashboard();
          } else if (!cancelled) {
            setError(
              makeLoginError(
                t("errors.sessionUnsyncedTitle"),
                t("errors.sessionUnsyncedMessage"),
                {
                  hint: t("errors.sessionUnsyncedHint"),
                  diagnosticReason: "storage",
                },
              ),
            );
          }
        }
      } finally {
        if (!cancelled && !redirectingToDashboardRef.current)
          setCheckingSession(false);
      }
    };

    void ensureExistingSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!session) {
          redirectingToDashboardRef.current = false;
          setRedirectingToDashboard(false);
          setActiveBrowserUserId(null);
          setCheckingSession(false);
          return;
        }
        if (
          event === "SIGNED_IN" ||
          event === "TOKEN_REFRESHED" ||
          event === "INITIAL_SESSION"
        ) {
          // Keep the local account cache synchronized, but do not navigate from
          // the auth listener. The explicit login flow (or ensureExistingSession
          // on page load) performs the redirect only after the session has been
          // read back successfully. Redirecting here could race cookie persistence
          // and bounce /dashboard back to /login indefinitely.
          setActiveBrowserUserId(session.user.id);
        }
      },
    );

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, [supabaseReady, t]);

  // ✅ gestion lien expiré / invalide (2e clic invitation)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash;
    if (!hash || !hash.includes("error=")) return;

    const params = new URLSearchParams(hash.slice(1));
    const errorCode = params.get("error_code");
    const errorDesc = params.get("error_description") || "";

    if (
      errorCode === "otp_expired" ||
      errorDesc.toLowerCase().includes("expired") ||
      errorDesc.toLowerCase().includes("invalid")
    ) {
      setInfo(
        t("expiredLinkInfo"),
      );
    } else {
      setInfo(t("invalidLinkInfo"));
    }

    // nettoie l’URL (supprime le #error=...)
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname + window.location.search,
    );
  }, [t]);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined" || !supabaseReady) return;

      // évite double exécution (React strict mode + rerenders)
      if (handledHashRef.current) return;
      handledHashRef.current = true;

      const hash = window.location.hash;
      if (!hash || !hash.includes("access_token=")) return;

      const params = new URLSearchParams(hash.slice(1));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const type = params.get("type"); // invite | recovery | etc.

      if (!access_token || !refresh_token) return;

      const supabase = supabaseRef.current;
      if (!supabase) return;

      purgeAllBrowserAccountCaches();
      setActiveBrowserUserId(null);
      await (
        supabase.auth.signOut as (_options?: {
          scope?: "global" | "local" | "others";
        }) => Promise<unknown>
      )({ scope: "local" }).catch(() => null);

      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (error) {
        console.error("setSession error:", error);
        return;
      }

      const { data: userData } = await supabase.auth
        .getUser()
        .catch(() => ({ data: { user: null } }));
      if (userData?.user?.id) {
        setActiveBrowserUserId(userData.user.id);
      }

      // Les anciens liens "implicit flow" déposent la session dans le hash.
      // Une fois cette session vérifiée, ils rejoignent le même écran et le
      // même moteur serveur que les liens token_hash récents.
      const targetPath =
        type === "recovery"
          ? `/auth/finish-reset/${appLanguage}`
          : `/auth/finish-invite/${appLanguage}`;
      const targetParams = new URLSearchParams({
        source: "session",
        next: "/dashboard",
      });
      const verifiedEmail = String(userData?.user?.email || "").trim().toLowerCase();
      if (verifiedEmail) targetParams.set("email", verifiedEmail);
      const target = `${targetPath}?${targetParams.toString()}`;

      // hard redirect + on garde l'historique propre
      window.location.replace(target);
    })();
  }, [appLanguage, supabaseReady]);

  useEffect(() => {
    setMounted(true);

    supabaseRef.current = createClient();
    setSupabaseReady(true);

    const newDots: WanderDot[] = Array.from({ length: 20 }).map(() => ({
      left: `${rint(6, 94)}%`,
      top: `${rint(8, 92)}%`,
      size: rint(9, 14),
      dur: rint(10, 20),
      delay: Math.round(rand(0, 6) * 10) / 10,
      alpha: Math.round(rand(0.55, 0.95) * 100) / 100,

      x1: rint(-90, 90),
      y1: rint(-70, 70),
      x2: rint(-90, 90),
      y2: rint(-70, 70),
      x3: rint(-90, 90),
      y3: rint(-70, 70),
      x4: rint(-90, 90),
      y4: rint(-70, 70),
      x5: rint(-90, 90),
      y5: rint(-70, 70),
    }));

    setDots(newDots);
  }, []);

  // ✅ ajout : reset password
  async function onForgotPassword() {
    setError(null);
    setInfo(null);

    if (!email) {
      setError(
        makeLoginError(
          t("errors.emailRequiredTitle"),
          t("errors.emailRequiredMessage"),
          { hint: t("errors.emailRequiredHint") },
        ),
      );
      return;
    }

    setLoading(true);

    try {
      const supabase = supabaseRef.current;
      if (!supabase) {
        setError(
          makeLoginError(
            t("errors.authUnavailableTitle"),
            t("errors.authUnavailableMessage"),
            {
              hint: t("errors.authUnavailableHint"),
              diagnosticReason: "technical",
            },
          ),
        );
        return;
      }

      const appOrigin = (
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      ).replace(/\/$/, "");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildSupabaseEmailRedirectUrl(
          appOrigin,
          "/auth/finish-reset",
          appLanguage,
        ),
      });

      if (error) {
        setError(
          friendlyLoginError(
            error,
            t("errors.actionFailed"),
          ),
        );
        return;
      }

      setInfo(t("errors.resetSent"));
    } catch (err: unknown) {
      setError(
        friendlyLoginError(
          err,
          t("errors.resetFailed"),
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null); // ✅ ajout : on nettoie le message info quand on tente une connexion
    setLoading(true);

    try {
      const supabase = supabaseRef.current;
      if (!supabase) {
        setError(
          makeLoginError(
            t("errors.authUnavailableTitle"),
            t("errors.authUnavailableMessage"),
            {
              hint: t("errors.authUnavailableHint"),
              diagnosticReason: "technical",
            },
          ),
        );
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(
          friendlyLoginError(
            error,
            t("errors.actionFailed"),
          ),
        );
        return;
      }

      // ✅ attendre que la session soit bien créée/stockée
      let session = (await supabase.auth.getSession()).data.session;

      // petit délai de sécurité (évite le redirect trop tôt)
      if (!session) {
        await new Promise((r) => setTimeout(r, 200));
        session = (await supabase.auth.getSession()).data.session;
      }

      if (!session) {
        setError(
          makeLoginError(
            t("errors.sessionIncompleteTitle"),
            t("errors.sessionIncompleteMessage"),
            {
              hint: t("errors.sessionIncompleteHint"),
              diagnosticReason: "storage",
            },
          ),
        );
        return;
      }

      const { data: userData } = await supabase.auth
        .getUser()
        .catch(() => ({ data: { user: null } }));
      if (userData?.user?.id) {
        setActiveBrowserUserId(userData.user.id);
      }

      const serverSessionReady = await waitForServerAuthSession();
      if (!serverSessionReady) {
        setError(
          makeLoginError(
            t("errors.sessionUnsyncedTitle"),
            t("errors.sessionUnsyncedAfterLoginMessage"),
            {
              hint: t("errors.sessionUnsyncedHint"),
              diagnosticReason: "storage",
            },
          ),
        );
        return;
      }

      // Redirection complète uniquement après confirmation que la session est
      // lisible côté serveur. Cela évite un rebond /dashboard -> /login.
      window.location.replace("/dashboard");
    } catch (err: unknown) {
      setError(
        friendlyLoginError(err, t("errors.defaultLogin")),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen inrcy-soft-noise overflow-hidden">
      <AuthLanguageSelector />
      <div className="inrcy-noise-overlay" />

      {checkingSession || redirectingToDashboard ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-white/30 backdrop-blur-sm">
          <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-4 text-center shadow-xl">
            <div className="text-sm font-black text-slate-800">
              {t("sessionConnecting")}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-500">
              {t("sessionChecking")}
            </div>
          </div>
        </div>
      ) : null}

      <svg
        className="inrcy-lines"
        viewBox="0 0 1200 700"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="gLine" x1="0" x2="1">
            <stop offset="0" stopColor="rgba(0,180,255,0.20)" />
            <stop offset="0.55" stopColor="rgba(120,90,255,0.18)" />
            <stop offset="1" stopColor="rgba(255,55,140,0.18)" />
          </linearGradient>
          <radialGradient id="gHalo" cx="50%" cy="50%" r="60%">
            <stop offset="0" stopColor="rgba(255,255,255,0.45)" />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>

        <circle cx="600" cy="350" r="260" fill="url(#gHalo)" />
        <circle
          cx="600"
          cy="350"
          r="260"
          fill="none"
          stroke="url(#gLine)"
          strokeWidth="1"
          opacity="0.35"
        />
        <circle
          cx="600"
          cy="350"
          r="210"
          fill="none"
          stroke="url(#gLine)"
          strokeWidth="1"
          opacity="0.35"
        />
        <circle
          cx="600"
          cy="350"
          r="155"
          fill="none"
          stroke="url(#gLine)"
          strokeWidth="1"
          opacity="0.35"
        />
        <circle
          cx="600"
          cy="350"
          r="110"
          fill="none"
          stroke="url(#gLine)"
          strokeWidth="1"
          opacity="0.35"
        />

        <path
          d="M420 240 L520 185 L640 190 L760 255 L820 360 L720 470 L580 505 L460 445 L405 340 Z"
          fill="none"
          stroke="url(#gLine)"
          strokeWidth="1"
          opacity="0.35"
        />
        <path
          d="M520 185 L600 350 L760 255"
          fill="none"
          stroke="url(#gLine)"
          strokeWidth="1"
          opacity="0.25"
        />
        <path
          d="M460 445 L600 350 L820 360"
          fill="none"
          stroke="url(#gLine)"
          strokeWidth="1"
          opacity="0.25"
        />
        <path
          d="M420 240 L600 350 L580 505"
          fill="none"
          stroke="url(#gLine)"
          strokeWidth="1"
          opacity="0.25"
        />

        {[
          [420, 240],
          [520, 185],
          [640, 190],
          [760, 255],
          [820, 360],
          [720, 470],
          [580, 505],
          [460, 445],
          [405, 340],
          [600, 350],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="4" fill="rgba(120,90,255,0.35)" />
        ))}
      </svg>

      {mounted && (
        <div className="inrcy-float-field" aria-hidden="true">
          {dots.map((d, i) => {
            const c = dotColors[i % dotColors.length];
            return (
              <div
                key={i}
                className="inrcy-wander-dot"
                style={
                  {
                    left: d.left,
                    top: d.top,
                    width: `${d.size}px`,
                    height: `${d.size}px`,
                    opacity: d.alpha,
                    "--dur": `${d.dur}s`,
                    "--delay": `${d.delay}s`,
                    "--x1": `${d.x1}px`,
                    "--y1": `${d.y1}px`,
                    "--x2": `${d.x2}px`,
                    "--y2": `${d.y2}px`,
                    "--x3": `${d.x3}px`,
                    "--y3": `${d.y3}px`,
                    "--x4": `${d.x4}px`,
                    "--y4": `${d.y4}px`,
                    "--x5": `${d.x5}px`,
                    "--y5": `${d.y5}px`,
                    "--cA": c.a,
                    "--cB": c.b,
                  } as CSSVars
                }
              />
            );
          })}
        </div>
      )}

      <section className="relative z-10 flex min-h-screen items-center justify-center px-4">
        <div className="inrcy-card w-full max-w-[420px] p-6">
          <div className="flex flex-col items-center gap-2 pb-4">
            <div className="inrcy-logo-wrap">
              <Image
                src="/logo-inrcy.png"
                alt="iNrCy"
                width={120}
                height={45}
                priority
                className="inrcy-logo"
                style={{ width: 120, height: "auto" }}
              />
            </div>

            <div className="text-sm font-semibold tracking-wide text-slate-700">
              {t("clientArea")}
            </div>
            <div className="text-xs text-slate-500 text-center">
              {t("subtitle")}
            </div>
          </div>

          {/* ✅ évite l’overlay hydration quand une extension modifie les inputs */}
          <form
            suppressHydrationWarning
            onSubmit={onSubmit}
            className="space-y-3"
          >
            <div className="relative">
              <input
                suppressHydrationWarning
                data-testid="login-email"
                className="inrcy-input"
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                ✉️
              </span>
            </div>

            <div className="relative">
              <input
                suppressHydrationWarning
                data-testid="login-password"
                className="inrcy-input"
                type={showPassword ? "text" : "password"}
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                aria-label={
                  showPassword
                    ? t("hidePassword")
                    : t("showPassword")
                }
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>

            {error ? (
              <div
                className={styles.loginErrorBox}
                role="alert"
                data-testid="login-error"
              >
                <div className={styles.loginErrorBadge}>{t("errorBadge")}</div>
                <div>
                  <div className={styles.loginErrorTitle}>{error.title}</div>
                  <div className={styles.loginErrorText}>{error.message}</div>
                  {error.hint ? (
                    <div className={styles.loginErrorHint}>{error.hint}</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* ✅ ajout : message succès */}
            {info ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {info}
              </div>
            ) : null}

            <button
              data-testid="login-submit"
              className="inrcy-btn w-full"
              type="submit"
              disabled={
                loading ||
                checkingSession ||
                redirectingToDashboard ||
                !supabaseReady
              }
            >
              {loading
                ? t("submitting")
                : checkingSession || redirectingToDashboard
                  ? t("checking")
                  : !supabaseReady
                    ? t("initialising")
                    : t("submit")}
            </button>

            {/* ✅ aide connexion */}
            <div
              className={
                error?.diagnosticReason
                  ? styles.loginActions
                  : styles.loginActionsSolo
              }
            >
              <button
                data-testid="forgot-password"
                type="button"
                onClick={onForgotPassword}
                className={styles.forgotButton}
                disabled={
                  loading ||
                  checkingSession ||
                  redirectingToDashboard ||
                  !supabaseReady
                }
              >
                {t("forgotPassword")}
              </button>

              {error?.diagnosticReason ? (
                <a className={styles.diagnosticButton} href={diagnosticHref}>
                  <span className={styles.diagnosticButtonIcon}>✦</span>
                  {t("diagnoseError")}
                </a>
              ) : null}
            </div>
          </form>

          <div className="pt-4 text-center text-xs text-slate-500">
            {t("needHelp")} {" "}
            <a className="underline" href="mailto:contact@inrcy.com">
              contact@inrcy.com
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
