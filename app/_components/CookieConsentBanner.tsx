"use client";

import { useTranslations } from "next-intl";


import { useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import { usePathname } from "next/navigation";

type Consent = {
  v: 1;
  ts: number;
  analytics: boolean;
};

const LS_KEY = "inrcy_cookie_consent";

function parseConsent(raw: string | null): Consent | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const candidate = parsed as Partial<Consent>;
    if (candidate.v !== 1) return null;
    if (typeof candidate.ts !== "number") return null;
    if (typeof candidate.analytics !== "boolean") return null;

    return {
      v: 1,
      ts: candidate.ts,
      analytics: candidate.analytics,
    };
  } catch {
    return null;
  }
}

function getConsentSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function writeConsent(next: Consent) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("inrcy:cookie-consent"));
  } catch {
    // no-op
  }
}

function subscribeToConsent(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("inrcy:cookie-consent", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("inrcy:cookie-consent", onStoreChange);
  };
}

export default function CookieConsentBanner() {
  const i18nT = useTranslations("shell");
  const pathname = usePathname();
  const isClient = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );
  const [open, setOpen] = useState(false);

  const consentRaw = useSyncExternalStore(subscribeToConsent, getConsentSnapshot, () => null);
  const consent = useMemo(() => parseConsent(consentRaw), [consentRaw]);

  if (!isClient) return null;

  const shouldHideOnThisPage = pathname?.startsWith("/login") || pathname?.startsWith("/legal");
  if (shouldHideOnThisPage) return null;

  const shouldShow = !consent;
  if (!shouldShow && !open) return null;

  const card: CSSProperties = {
    position: "fixed",
    left: 12,
    right: 12,
    bottom: 12,
    zIndex: 999999,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(16,16,16,0.88)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    color: "white",
    padding: 14,
    maxWidth: 980,
    margin: "0 auto",
    boxShadow: "0 14px 40px rgba(0,0,0,0.32)",
  };

  const btn: CSSProperties = {
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)",
    color: "white",
    borderRadius: 12,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
    minHeight: 42,
    width: "100%",
  };

  const primaryBtn: CSSProperties = {
    ...btn,
    background:
      "linear-gradient(135deg, rgba(0, 200, 255, 0.18), rgba(97, 87, 255, 0.18), rgba(255, 77, 166, 0.14))",
    border: "1px solid rgba(255,255,255,0.18)",
  };

  const linkBtn: CSSProperties = {
    ...btn,
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.85)",
    textDecoration: "underline",
    padding: 0,
    borderRadius: 0,
    fontWeight: 700,
    width: "fit-content",
  };

  const setAll = (analytics: boolean) => {
    const next: Consent = { v: 1, ts: Date.now(), analytics };
    writeConsent(next);
    setOpen(false);
  };

  const isMobile = typeof window !== "undefined" ? window.innerWidth <= 640 : false;

  const actionRow: CSSProperties = {
    marginTop: 10,
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr 1fr" : "minmax(0, 1fr) repeat(3, auto)",
    alignItems: "center",
    gap: 10,
  };

  return (
    <div style={card} role="dialog" aria-live="polite" aria-label={i18nT("consentement_cookies_d393aeca")}>
      <div style={{ fontWeight: 1000, marginBottom: 6 }}>{i18nT("cookies_524cf50b")}</div>

      <div style={{ width: "100%", opacity: 0.86, lineHeight: 1.42, fontSize: 13 }}>
        {i18nT("inrcy_utilise_des_cookies_be40ecb7")}{" "}<b>{i18nT("strictement_necessaires_396f10ee")}</b> {" "}{i18nT("au_fonctionnement_connexion_securite_les_cookies_d89c9d61")}{" "}</div>

      <div style={actionRow}>
        <a href="/legal/confidentialite" style={{ ...linkBtn, gridColumn: isMobile ? "1 / -1" : undefined }}>
          {i18nT("politique_de_confidentialite_42b0e51e")}{" "}</a>
        <button type="button" onClick={() => setOpen((v) => !v)} style={{ ...btn, width: isMobile ? "100%" : undefined }}>
          {open ? i18nT("fermer_les_reglages_354f1fa6") : i18nT("gerer_mes_cookies_7f8d3e65")}
        </button>
        <button type="button" onClick={() => setAll(false)} style={{ ...btn, width: isMobile ? "100%" : undefined }}>
          {i18nT("refuser_62897154")}{" "}</button>
        <button type="button" onClick={() => setAll(true)} style={{ ...primaryBtn, width: isMobile ? "100%" : undefined }}>
          {i18nT("accepter_f8b9b80e")}{" "}</button>
      </div>

      {open ? (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid rgba(255,255,255,0.10)",
            display: "grid",
            gap: 10,
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.9 }}>
            <input type="checkbox" checked readOnly />
            <span>
              <b>{i18nT("necessaires_c79b873d")}</b> {" "}{i18nT("toujours_actifs_cb18713e")}{" "}</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.9 }}>
            <input
              type="checkbox"
              checked={Boolean(consent?.analytics)}
              onChange={(e) => setAll(Boolean(e.target.checked))}
            />
            <span>
              <b>{i18nT("mesure_d_audience_f4275bb4")}</b> {" "}{i18nT("optionnel_6f73b232")}{" "}</span>
          </label>
          <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
            {i18nT("note_inrcy_ne_force_pas_l_5ba6b0cf")}{" "}</div>
        </div>
      ) : null}
    </div>
  );
}
