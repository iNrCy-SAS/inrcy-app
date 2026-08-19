"use client";

import { useLocale, useTranslations } from "next-intl";


import { useMemo, useState } from "react";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { createClient } from "@/lib/supabaseClient";
import { purgeAllBrowserAccountCaches, setActiveBrowserUserId } from "@/lib/browserAccountCache";
import { appLanguageFromLocale } from "@/i18n/config";

const LS_KEY = "inrcy_cookie_consent";

function getCookiePrefs() {
  if (typeof window === "undefined") return null as any;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCookiePrefs(analytics: boolean) {
  if (typeof window === "undefined") return;
  try {
    const next = { v: 1, ts: Date.now(), analytics };
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("inrcy:cookie-consent", { detail: next }));
  } catch {
    // no-op
  }
}

type Props = {
  mode?: "page" | "drawer";
};

export default function RgpdContent({ mode = "page" }: Props) {
  const i18nT = useTranslations("settings");
  const locale = useLocale();
  const appLanguage = appLanguageFromLocale(locale);
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const initialPrefs = useMemo(() => getCookiePrefs(), []);
  const [analytics, setAnalytics] = useState<boolean>(Boolean(initialPrefs?.analytics));

  const card: React.CSSProperties = {
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.045)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  };

  const btn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    borderRadius: 14,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  };

  const dangerBtn: React.CSSProperties = {
    ...btn,
    border: "1px solid rgba(255,120,120,0.35)",
    background: "rgba(255, 77, 166, 0.10)",
  };

  async function downloadExport() {
    setErr(null);
    setDone(null);
    setBusy("export");
    try {
      const res = await fetch("/api/account/export", { method: "GET" });
      if (!res.ok) {
        throw new Error(`account_export_${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inrcy-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setDone(i18nT("rgpd_export_done"));
    } catch {
      setErr(i18nT("rgpd_export_failed"));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    setErr(null);
    setDone(null);
    const ok = await confirmInrcy({
      title: i18nT("supprimer_le_compte_c19124b5"),
      message: i18nT("cette_action_supprime_votre_compte_inrcy_d9cb27ec"),
      confirmLabel: i18nT("supprimer_mon_compte_e894aea3"),
      variant: "danger",
    });
    if (!ok) return;

    setBusy("delete");
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `account_delete_${res.status}`);
      }
      setDone(i18nT("rgpd_delete_done"));

      // L’API supprime les cookies serveur. Le navigateur peut encore conserver
      // une session locale et les caches multicompte : ils doivent disparaître
      // avant toute nouvelle inscription avec la même adresse.
      purgeAllBrowserAccountCaches();
      setActiveBrowserUserId(null);
      const supabase = createClient();
      await supabase.auth.signOut({ scope: "local" }).catch(() => null);
      window.location.replace(`/login?lang=${appLanguage}`);
    } catch {
      setErr(i18nT("rgpd_delete_failed"));
    } finally {
      setBusy(null);
    }
  }

  function onToggleAnalytics(next: boolean) {
    setAnalytics(next);
    setCookiePrefs(next);
    setDone(i18nT("rgpd_cookie_saved"));
  }

  const info: React.CSSProperties = {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.25)",
    fontSize: 13,
    lineHeight: 1.45,
    opacity: 0.9,
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900 }}>{i18nT("mes_donnees_rgpd_735ed1cb")}</h3>
        <p style={{ margin: "10px 0 0", opacity: 0.85, lineHeight: 1.5 }}>
          {i18nT("telecharger_vos_donnees_gerer_vos_cookies_2af2d2a2")}{" "}</p>

        {(err || done) && (
          <div style={info}>
            {err ? <div style={{ color: "#ff9aa2", fontWeight: 900 }}>{err}</div> : null}
            {done ? <div style={{ color: "#b5ffcf", fontWeight: 900 }}>{done}</div> : null}
          </div>
        )}
      </div>

      <div style={card}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 900 }}>{i18nT("export_portabilite_6f1c0665")}</h4>
        <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>
          {i18nT("genere_un_fichier_json_telechargeable_contenant_a96ab16c")}{" "}</p>
        <div style={{ marginTop: 10 }}>
          <button type="button" style={btn} onClick={downloadExport} disabled={busy !== null}>
            {busy === "export" ? i18nT("export_en_cours_a536865e") : i18nT("telecharger_mes_donnees_b4de503a")}
          </button>
        </div>
      </div>

      <div style={card}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 900 }}>{i18nT("cookies_524cf50b")}</h4>
        <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>
          {i18nT("les_cookies_necessaires_sont_toujours_actifs_6feb1cf6")}{" "}</p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, opacity: 0.9 }}>
          <input type="checkbox" checked={analytics} onChange={(e) => onToggleAnalytics(Boolean(e.target.checked))} />
          <span>{i18nT("autoriser_la_mesure_d_audience_optionnel_f8b76c20")}</span>
        </label>
      </div>

      <div style={card}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 900 }}>{i18nT("suppression_du_compte_11789c76")}</h4>
        <p style={{ margin: "8px 0 0", opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>
          {i18nT("supprime_votre_compte_et_les_donnees_dd539173")}{" "}</p>
        <div style={{ marginTop: 10 }}>
          <button type="button" style={dangerBtn} onClick={deleteAccount} disabled={busy !== null}>
            {busy === "delete" ? i18nT("suppression_en_cours_29d17a80") : i18nT("supprimer_mon_compte_e894aea3")}
          </button>
        </div>
        <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12, lineHeight: 1.4 }}>
          {i18nT("conseil_telechargez_d_abord_vos_donnees_5319daf3")}{" "}</div>
      </div>

      {mode === "drawer" ? null : null}
    </div>
  );
}
