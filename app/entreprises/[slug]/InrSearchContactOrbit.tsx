"use client";

import { useTranslations } from "next-intl";


import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import InrSearchLeadForm from "./InrSearchLeadForm";
import InrSearchLogo from "./InrSearchLogo";
import {
  INR_SEARCH_OPEN_CONTACT_EVENT,
  type InrSearchOpenContactDetail,
} from "./inrSearchContactEvents";
import styles from "./inrSearchPublic.module.css";

type Props = {
  slug: string;
  companyName: string;
  logoUrl: string;
  profession: string;
  city: string;
  phone: string;
  phoneHref: string;
  email: string;
  emailHref: string;
  addressLine: string;
  websiteUrl: string;
  directionsUrl: string;
};

type Signal = {
  key: string;
  label: string;
  value: string;
  href: string;
  action: string;
  glyph: string;
};

export default function InrSearchContactOrbit({
  slug,
  companyName,
  logoUrl,
  profession,
  city,
  phone,
  phoneHref,
  email,
  emailHref,
  addressLine,
  websiteUrl,
  directionsUrl,
}: Props) {
  const i18nT = useTranslations("public");
  const [formOpen, setFormOpen] = useState(false);
  const [activeSignal, setActiveSignal] = useState<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openForm = (trigger?: HTMLElement | null) => {
    returnFocusRef.current = trigger || document.activeElement as HTMLElement | null;
    setFormOpen(true);
  };

  useEffect(() => {
    const onOpenContact = (event: Event) => {
      const trigger = (event as CustomEvent<InrSearchOpenContactDetail>).detail?.trigger;
      openForm(trigger);
    };

    window.addEventListener(INR_SEARCH_OPEN_CONTACT_EVENT, onOpenContact);
    return () => window.removeEventListener(INR_SEARCH_OPEN_CONTACT_EVENT, onOpenContact);
  }, []);

  useEffect(() => {
    if (!formOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFormOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [formOpen]);

  const signals: Signal[] = [
    phone && phoneHref ? { key: "phone", label: i18nT("appeler_de49ee03"), value: phone, href: phoneHref, action: "phone", glyph: "☎" } : null,
    email && emailHref ? { key: "email", label: i18nT("ecrire_4a2abc77"), value: email, href: emailHref, action: "email", glyph: "✉" } : null,
    addressLine ? { key: "location", label: i18nT("localiser_863066a6"), value: addressLine, href: directionsUrl || "#contact", action: directionsUrl ? "directions" : "", glyph: "⌖" } : null,
    websiteUrl ? { key: "website", label: i18nT("site_internet_bcabc83e"), value: "Visiter le site", href: websiteUrl, action: "website", glyph: "◎" } : null,
  ].filter(Boolean) as Signal[];

  return (
    <div className={styles.contactUniverse}>
      <div className={styles.contactOrbitHeader}>
        <div>
          <span className={styles.contactOrbitEyebrow}>{i18nT("generateur_de_convergence_a8282757")}</span>
          <h2>{i18nT("contacter_value_78104412", { value0: companyName })}</h2>
          <p>{i18nT("choisissez_le_moyen_qui_vous_convient_851e9a78", { value0: companyName })}</p>
        </div>
        <span className={styles.contactOrbitStatus}><i /> {signals.length} voie{signals.length > 1 ? "s" : ""} {" "}{i18nT("de_contact_f4ec0c36")}</span>
      </div>

      <div
        className={styles.contactConvergence}
        data-active-signal={activeSignal === null ? "none" : String(activeSignal)}
        onMouseLeave={() => setActiveSignal(null)}
      >
        <svg className={styles.contactEnergyLines} viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
          <path data-line-index="0" d="M500 260 C390 260 350 120 230 120" pathLength="1" />
          <path data-line-index="1" d="M500 260 C610 260 650 120 770 120" pathLength="1" />
          <path data-line-index="2" d="M500 260 C390 260 350 400 230 400" pathLength="1" />
          <path data-line-index="3" d="M500 260 C610 260 650 400 770 400" pathLength="1" />
          <circle cx="500" cy="260" r="8" />
        </svg>

        <div className={styles.contactCore}>
          <span className={styles.contactCoreHalo} aria-hidden="true" />
          <span className={styles.contactCoreRotor} aria-hidden="true"><i /><i /><i /></span>
          <InrSearchLogo
            src={logoUrl}
            alt=""
            companyName={companyName}
            width={126}
            height={126}
            fallbackClassName={styles.contactCoreFallback}
          />
          <small>{profession || i18nT("entreprise_d03e74b6")}</small>
          <strong>{companyName}</strong>
          <em>{city || i18nT("a_votre_ecoute_0a2de931")}</em>
          <button type="button" onClick={(event) => openForm(event.currentTarget)}>{i18nT("presenter_mon_besoin_7ee41902")}{" "}<span aria-hidden="true">↗</span></button>
        </div>

        <div className={styles.contactSignals} role="list" aria-label={i18nT("moyens_de_contacter_l_entreprise_cd56744a")}>
          {signals.map((signal, index) => (
            <a
              className={styles.contactSignal}
              data-signal-index={index}
              key={signal.key}
              href={signal.href}
              target={signal.href.startsWith("http") ? "_blank" : undefined}
              rel={signal.href.startsWith("http") ? "noopener noreferrer" : undefined}
              data-inrsearch-action={signal.action || undefined}
              data-inrsearch-target={signal.href}
              role="listitem"
              onMouseEnter={() => setActiveSignal(index)}
              onFocus={() => setActiveSignal(index)}
              onBlur={() => setActiveSignal(null)}
            >
              <span aria-hidden="true">{signal.glyph}</span>
              <small>{signal.label}</small>
              <strong>{signal.value}</strong>
              <i aria-hidden="true">↗</i>
            </a>
          ))}
        </div>

        <div className={styles.contactLegalLinks}>
          <a href="/legal/mentions-legales" target="_blank" rel="noopener noreferrer" data-inrsearch-gesture-ignore>{i18nT("mentions_legales_414291e0")}</a>
          <span aria-hidden="true">·</span>
          <a href="/legal/confidentialite" target="_blank" rel="noopener noreferrer" data-inrsearch-gesture-ignore>{i18nT("confidentialite_89314676")}</a>
        </div>
      </div>

      {typeof document !== "undefined" && formOpen
        ? createPortal(
            <div
              ref={modalRef}
              className={styles.contactModalBackdrop}
              role="dialog"
              aria-modal="true"
              aria-label={i18nT("presenter_un_besoin_a_value_02a7ee58", { value0: companyName })}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setFormOpen(false);
              }}
            >
              <div className={styles.contactModalShell}>
                <button ref={closeButtonRef} className={styles.contactModalClose} type="button" onClick={() => setFormOpen(false)} aria-label={i18nT("fermer_le_formulaire_4122eb9c")}>×</button>
                <InrSearchLeadForm slug={slug} companyName={companyName} modal />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
