"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabaseClient";
import { purgeAllBrowserAccountCaches, setActiveBrowserUserId } from "@/lib/browserAccountCache";
import { appLanguageFromLocale } from "@/i18n/config";
import AuthLanguageSelector from "@/app/auth/_components/AuthLanguageSelector";

function safeContinuePath(input: string | null) {
  if (!input) return "/login";
  if (!input.startsWith("/") || input.startsWith("//")) return "/login";
  return input;
}

type Props = {
  currentEmail: string | null;
  expectedEmail: string | null;
  continuePath: string | null;
};

export default function SwitchAccountClient({ currentEmail, expectedEmail, continuePath }: Props) {
  const nextPath = useMemo(() => safeContinuePath(continuePath), [continuePath]);
  const locale = useLocale();
  const appLanguage = appLanguageFromLocale(locale);
  const t = useTranslations("auth.switchAccount");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      purgeAllBrowserAccountCaches();
      setActiveBrowserUserId(null);
      await (supabase.auth.signOut as (_options?: { scope?: "global" | "local" | "others" }) => Promise<unknown>)({ scope: "local" }).catch(() => null);
      window.location.replace(nextPath);
    } catch (e) {
      console.error(e);
      setError(t("error"));
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
      <AuthLanguageSelector />
      <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-300">{t("eyebrow")}</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">{t("title")}</h1>
        <p className="mt-4 text-sm leading-6 text-slate-200">
          {currentEmail
            ? t.rich("accountMismatch", {
                expected: expectedEmail || t("invitedAccount"),
                current: currentEmail,
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : t.rich("expectedAccount", {
                expected: expectedEmail || t("invitedAccount"),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {t("explanation")}
        </p>

        {error ? <p className="mt-5 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleContinue}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t("signingOut") : t("continue")}
          </button>
          <Link
            href={`/login?lang=${appLanguage}`}
            className="inline-flex items-center justify-center rounded-2xl border border-white/15 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/5"
          >
            {t("backToLogin")}
          </Link>
        </div>
      </div>
    </main>
  );
}
