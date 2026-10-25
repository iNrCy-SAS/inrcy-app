"use client";

import { useTranslations } from "next-intl";
import styles from "./LegalPrivacyContent.module.css";

import Link from "next/link";
import { useMemo, useState } from "react";

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

function PrivacyIcon({ kind }: { kind: "shield" | "export" | "cookies" | "delete" }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === "shield" ? <><path d="m24 6 14 5v11c0 10-14 19-14 19S10 32 10 22V11l14-5Z" fill="currentColor" fillOpacity=".1" /><path d="m17 23 5 5 10-11" /></> : null}
      {kind === "export" ? <><path d="M27 6H13a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h22a4 4 0 0 0 4-4V18L27 6Z" fill="currentColor" fillOpacity=".1" /><path d="M27 6v12h12M24 23v12m-5-5 5 5 5-5" /></> : null}
      {kind === "cookies" ? <><path d="M38 24a9 9 0 0 1-9-9 8 8 0 0 1-9-8 17.5 17.5 0 1 0 18 17Z" fill="currentColor" fillOpacity=".1" /><circle cx="17" cy="20" r="1.5" /><circle cx="14" cy="29" r="1.5" /><circle cx="24" cy="33" r="1.5" /><path d="M34 7v6m-3-3h6" /></> : null}
      {kind === "delete" ? <><path d="M11 14h26l-2 24a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4l-2-24Z" fill="currentColor" fillOpacity=".1" /><path d="M7 14h34M18 14V7h12v7m-10 9v11m8-11v11" /></> : null}
    </svg>
  );
}

export default function RgpdContent({ mode = "page" }: Props) {
  const i18nT = useTranslations("settings");
  const [busy, setBusy] = useState<"export" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const initialPrefs = useMemo(() => getCookiePrefs(), []);
  const [analytics, setAnalytics] = useState<boolean>(Boolean(initialPrefs?.analytics));

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

  function onToggleAnalytics(next: boolean) {
    setAnalytics(next);
    setCookiePrefs(next);
    setDone(i18nT("rgpd_cookie_saved"));
  }

  return (
    <div className={styles.surface} data-mode={mode}>
      <header className={styles.intro}>
        <span className={styles.introIcon}><PrivacyIcon kind="shield" /></span>
        <div>
          <h2>{i18nT("mes_donnees_rgpd_735ed1cb")}</h2>
          <p>{i18nT("telecharger_vos_donnees_gerer_vos_cookies_2af2d2a2")}</p>
        </div>
      </header>

      {(err || done) ? (
        <div className={styles.status} role="status">
          {err ? <div className={styles.error}>{err}</div> : null}
          {done ? <div className={styles.success}>{done}</div> : null}
        </div>
      ) : null}

      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.privacyCard} ${styles.blue}`}>
          <span className={styles.iconTile}><PrivacyIcon kind="export" /></span>
          <h3>{i18nT("export_portabilite_6f1c0665")}</h3>
          <p>{i18nT("genere_un_fichier_json_telechargeable_contenant_a96ab16c")}</p>
          <div className={styles.cardActions}>
            <button type="button" className={styles.actionButton} onClick={downloadExport} disabled={busy !== null} aria-busy={busy === "export" || undefined}>
              {busy === "export" ? i18nT("export_en_cours_a536865e") : i18nT("telecharger_mes_donnees_b4de503a")}
            </button>
          </div>
        </section>

        <section className={`${styles.card} ${styles.privacyCard} ${styles.violet}`}>
          <span className={styles.iconTile}><PrivacyIcon kind="cookies" /></span>
          <h3>{i18nT("cookies_524cf50b")}</h3>
          <p>{i18nT("les_cookies_necessaires_sont_toujours_actifs_6feb1cf6")}</p>
          <div className={styles.cardActions}>
            <label className={styles.cookieChoice}>
              <input type="checkbox" checked={analytics} onChange={(e) => onToggleAnalytics(Boolean(e.target.checked))} />
              <span>{i18nT("autoriser_la_mesure_d_audience_optionnel_f8b76c20")}</span>
            </label>
          </div>
        </section>

        <section className={`${styles.card} ${styles.privacyCard} ${styles.pink}`}>
          <span className={styles.iconTile}><PrivacyIcon kind="delete" /></span>
          <h3>{i18nT("suppression_du_compte_11789c76")}</h3>
          <p>{i18nT("account_deletion_choices_description")}</p>
          <div className={styles.cardActions}>
            <Link href="/suppression-compte" className={`${styles.actionButton} ${styles.dangerButton}`}>
              {i18nT("supprimer_mon_compte_e894aea3")}
            </Link>
            <p className={styles.note}>{i18nT("conseil_telechargez_d_abord_vos_donnees_5319daf3")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
