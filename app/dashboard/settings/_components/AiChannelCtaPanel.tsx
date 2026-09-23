"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "next-intl";
import {
  AI_CTA_CHANNELS,
  isAiChannelCtaComplete,
  type AiChannelCtaConfig,
  type AiChannelCtaDestinations,
  type AiChannelCtaMap,
  type AiCtaChannel,
  type AiCtaChoice,
} from "@/lib/aiChannelCtaPreferences";
import { getSupportedPreferredCtasForChannel } from "@/lib/boosterCtaPreferences";
import styles from "./AiChannelCtaPanel.module.css";

type Props = {
  value: AiChannelCtaMap;
  onChange: (value: AiChannelCtaMap) => void;
  disabled?: boolean;
};

const COPY = {
  fr: {
    title: "Un CTA adapté à chaque canal",
    description: "Choisissez une action par canal. Sans réglage, aucun CTA n’est ajouté.",
    progress: "canaux configurés",
    select: "Action à proposer",
    empty: "Aucun CTA",
    site: "Voir le site",
    devis: "Demander un devis",
    appeler: "Appeler",
    message: "Envoyer un message",
    whatsapp: "Écrire sur WhatsApp",
    custom: "Lien personnalisé",
    label: "Texte du CTA",
    url: "Lien de destination · vide = site du profil",
    customUrl: "Lien personnalisé",
    phone: "Téléphone · vide = numéro du profil",
    automatic: "Destination automatique",
    missingDestination: "Ajoutez d’abord un site ou un numéro au profil, ou renseignez-le ici.",
    configured: "Configuré",
    incomplete: "À compléter",
    notConfigured: "Sans CTA",
    native: "Bouton cliquable quand le canal le permet",
    text: "Invitation ajoutée au texte du canal",
    noLinks: "Les liens de légende ne sont pas cliquables sur ce canal.",
    preview: "APERÇU DU CTA",
    settings: "RÉGLAGES DU CTA",
    previewEmpty: "Choisissez une action à gauche pour visualiser ce qui sera proposé sur ce canal.",
    previewDestination: "Destination",
    settingsEmpty: "Choisissez une action ci-dessus. Les réglages utiles apparaîtront ici, sans étape inutile.",
    choiceHints: {
      none: "Ne rien ajouter à ce canal",
      site: "Vers le site de votre profil",
      devis: "Pour recevoir une demande de devis",
      appeler: "Utilise votre numéro de téléphone",
      message: "Invite le client à vous écrire",
      whatsapp: "Ouvre une conversation WhatsApp",
      custom: "Vers l’adresse de votre choix",
    },
  },
  en: {
    title: "A CTA for each channel",
    description: "Choose an action per channel. Without a setting, no CTA is added.",
    progress: "channels configured",
    select: "Action to offer",
    empty: "No CTA",
    site: "Visit website",
    devis: "Request a quote",
    appeler: "Call",
    message: "Send a message",
    whatsapp: "Message on WhatsApp",
    custom: "Custom link",
    label: "CTA text",
    url: "Destination URL · blank = profile website",
    customUrl: "Custom link",
    phone: "Phone · blank = profile number",
    automatic: "Automatic destination",
    missingDestination: "Add a website or phone to the profile, or enter one here.",
    configured: "Configured",
    incomplete: "Complete details",
    notConfigured: "No CTA",
    native: "Clickable button where supported",
    text: "Invitation added to the channel text",
    noLinks: "Caption links are not clickable on this channel.",
    preview: "CTA PREVIEW",
    settings: "CTA SETTINGS",
    previewEmpty: "Choose an action on the left to preview what this channel will offer.",
    previewDestination: "Destination",
    settingsEmpty: "Choose an action above. The relevant settings will appear here, with no unnecessary steps.",
    choiceHints: {
      none: "Add nothing to this channel",
      site: "To your profile website",
      devis: "Collect a quote request",
      appeler: "Uses your phone number",
      message: "Invite customers to contact you",
      whatsapp: "Opens a WhatsApp conversation",
      custom: "To an address of your choice",
    },
  },
} as const;

const CHOICE_ICONS: Record<AiCtaChoice | "none", string> = {
  none: "—",
  site: "↗",
  devis: "✦",
  appeler: "☎",
  message: "✉",
  whatsapp: "◉",
  custom: "⌁",
};

const CHOICE_MODE: Record<AiCtaChoice, AiChannelCtaConfig["mode"]> = {
  site: "website",
  devis: "website",
  appeler: "call",
  message: "message",
  whatsapp: "custom",
  custom: "custom",
};

const NATIVE_CTA_CHANNELS = new Set<AiCtaChannel>(["gmb", "pinterest", "inrcy_site", "site_web"]);

function automaticWebsite(channel: AiCtaChannel, destinations: AiChannelCtaDestinations | null) {
  if (channel === "inrcy_site") return destinations?.inrcySiteUrl || destinations?.preferredWebsiteUrl || "";
  if (channel === "site_web") return destinations?.siteWebUrl || destinations?.preferredWebsiteUrl || "";
  return destinations?.preferredWebsiteUrl || destinations?.siteWebUrl || destinations?.inrcySiteUrl || "";
}

export default function AiChannelCtaPanel({ value, onChange, disabled = false }: Props) {
  const language = useLocale().split("-")[0];
  const copy = language === "fr" ? COPY.fr : COPY.en;
  const [activeChannel, setActiveChannel] = useState<AiCtaChannel>("inrcy_site");
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [destinations, setDestinations] = useState<AiChannelCtaDestinations | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/booster/cta-defaults", { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("cta_destinations_unavailable");
        return response.json() as Promise<AiChannelCtaDestinations>;
      })
      .then((loaded) => setDestinations(loaded))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    dropdownRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
  }, [menuOpen, activeChannel]);
  const configuredCount = AI_CTA_CHANNELS.filter(({ key }) =>
    isAiChannelCtaComplete(key, value[key], destinations),
  ).length;
  const activeMeta = AI_CTA_CHANNELS.find(({ key }) => key === activeChannel)!;
  const activeIndex = AI_CTA_CHANNELS.findIndex(({ key }) => key === activeChannel);
  const navigate = (direction: -1 | 1) => {
    const nextIndex = (activeIndex + direction + AI_CTA_CHANNELS.length) % AI_CTA_CHANNELS.length;
    setMenuOpen(false);
    setActiveChannel(AI_CTA_CHANNELS[nextIndex].key);
  };
  const selected = value[activeChannel];
  const complete = isAiChannelCtaComplete(activeChannel, selected, destinations);
  const choices = getSupportedPreferredCtasForChannel(activeChannel).filter((choice) => choice !== "none");
  const selectionOptions: Array<AiCtaChoice | "none"> = ["none", ...choices];
  const needsUrl = selected?.choice === "site" || selected?.choice === "devis" || selected?.choice === "custom";
  const needsPhone = selected?.choice === "appeler" || selected?.choice === "whatsapp";
  const automaticDestination = selected?.choice === "custom" ? "" : needsUrl
    ? automaticWebsite(activeChannel, destinations)
    : destinations?.phone || "";

  const update = (channel: AiCtaChannel, patch: Partial<AiChannelCtaConfig> | null) => {
    const next = { ...value };
    if (patch === null) {
      delete next[channel];
    } else {
      next[channel] = { ...next[channel], ...patch } as AiChannelCtaConfig;
    }
    onChange(next);
  };

  const selectChoice = (choice: AiCtaChoice | "none") => {
    setMenuOpen(false);
    if (choice === "none") {
      update(activeChannel, null);
    } else {
      update(activeChannel, {
        choice,
        mode: CHOICE_MODE[choice],
        label: copy[choice],
        url: "",
        phone: "",
      });
    }
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const current = options.findIndex((option) => option === document.activeElement);
    const next = event.key === "ArrowDown" ? (current + 1) % options.length
      : event.key === "ArrowUp" ? (current - 1 + options.length) % options.length
        : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : -1;
    if (next >= 0) {
      event.preventDefault();
      options[next]?.focus();
    }
  };

  return (
    <section className={styles.panel} data-ai-section="channel-ctas">
      <div className={styles.intro}>
        <div className={styles.introText}>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className={styles.progress} aria-label={`${configuredCount * 10} %, ${configuredCount}/10 ${copy.progress}`}>
          <strong>{configuredCount * 10}<small> %</small></strong>
          <span>{configuredCount}/10 {copy.progress}</span>
        </div>
      </div>

      <div className={styles.channelTabs} role="tablist" aria-label={copy.select}>
        {AI_CTA_CHANNELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeChannel === key}
            className={`${styles.channelTab} ${activeChannel === key ? styles.channelTabActive : ""} ${isAiChannelCtaComplete(key, value[key], destinations) ? styles.channelTabReady : value[key] ? styles.channelTabPending : ""}`}
            onClick={() => { setMenuOpen(false); setActiveChannel(key); }}
          >
            <span>{label}</span>
            <span className={`${styles.dot} ${isAiChannelCtaComplete(key, value[key], destinations) ? styles.dotReady : value[key] ? styles.dotPending : ""}`} aria-hidden />
          </button>
        ))}
      </div>

      <div
        className={styles.editorCarousel}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); }
        }}
      >
        <button type="button" className={styles.navArrow} aria-label="Canal précédent" onClick={() => navigate(-1)}>‹</button>
        <div className={styles.framePair} data-cta-channel={activeChannel} role="tabpanel">
        <article className={styles.card}>
          <div className={styles.cardHeading}>
            <span className={styles.cardIndex}>{String(activeIndex + 1).padStart(2, "0")}</span>
            <span className={styles.cardTitle}><small>{copy.settings}</small><strong>{activeMeta.label}</strong></span>
            <span className={`${styles.status} ${complete ? styles.ready : selected ? styles.pending : ""}`}>
              {complete ? copy.configured : selected ? copy.incomplete : copy.notConfigured}
            </span>
          </div>
          <div className={styles.controls}>
              <div className={styles.field}>
                <span id="cta-action-label">{copy.select}</span>
                <div className={styles.dropdown} ref={dropdownRef}>
                  <button
                    ref={triggerRef}
                    type="button"
                    className={`${styles.selectTrigger} ${menuOpen ? styles.selectTriggerOpen : ""}`}
                    aria-labelledby="cta-action-label"
                    aria-haspopup="listbox"
                    aria-expanded={menuOpen}
                    aria-controls={menuOpen ? `cta-choice-list-${activeChannel}` : undefined}
                    disabled={disabled}
                    onClick={() => setMenuOpen((open) => !open)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setMenuOpen(true);
                      }
                    }}
                  >
                    <span className={styles.selectIcon} aria-hidden>{CHOICE_ICONS[selected?.choice || "none"]}</span>
                    <span className={styles.selectValue}>{selected ? copy[selected.choice] : copy.empty}</span>
                    <span className={styles.selectChevron} aria-hidden>⌄</span>
                  </button>
                  {menuOpen ? (
                    <div
                      id={`cta-choice-list-${activeChannel}`}
                      className={styles.dropdownMenu}
                      role="listbox"
                      aria-labelledby="cta-action-label"
                      onKeyDown={handleMenuKeyDown}
                    >
                      {selectionOptions.map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          role="option"
                          aria-selected={(selected?.choice || "none") === choice}
                          className={styles.dropdownOption}
                          onClick={() => selectChoice(choice)}
                        >
                          <span className={styles.optionIcon} aria-hidden>{CHOICE_ICONS[choice]}</span>
                          <span className={styles.optionCopy}>
                            <strong>{choice === "none" ? copy.empty : copy[choice]}</strong>
                            <small>{copy.choiceHints[choice]}</small>
                          </span>
                          <span className={styles.optionCheck} aria-hidden>{(selected?.choice || "none") === choice ? "✓" : ""}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              {selected ? (
                <div className={styles.details}>
                  <label className={styles.field}>
                    <span>{copy.label}</span>
                    <input
                      value={selected.label}
                      maxLength={180}
                      disabled={disabled}
                      onChange={(event) => update(activeChannel, { label: event.target.value })}
                    />
                  </label>
                  {needsUrl ? (
                    <label className={styles.field}>
                      <span>{selected.choice === "custom" ? copy.customUrl : copy.url}</span>
                      <input
                        type="url"
                        inputMode="url"
                        placeholder={selected.choice === "custom" ? "https://…" : automaticDestination || "https://…"}
                        value={selected.url}
                        disabled={disabled}
                        onChange={(event) => update(activeChannel, { url: event.target.value })}
                      />
                    </label>
                  ) : null}
                  {needsPhone ? (
                    <label className={styles.field}>
                      <span>{copy.phone}</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        placeholder={automaticDestination || "+33 6…"}
                        value={selected.phone}
                        disabled={disabled}
                        onChange={(event) => update(activeChannel, { phone: event.target.value })}
                      />
                    </label>
                  ) : null}
                </div>
              ) : <p className={styles.settingsEmpty}>{copy.settingsEmpty}</p>}
              {selected && (needsUrl || needsPhone) ? (
                <p className={styles.destination}>
                  {automaticDestination ? `${copy.automatic} : ${automaticDestination}` : copy.missingDestination}
                </p>
              ) : null}
          </div>
        </article>
        <aside className={styles.previewCard} aria-label={copy.preview}>
          <div className={styles.previewHeading}>
            <span className={styles.previewEyebrow}>{copy.preview}</span>
            <strong>{activeMeta.label}</strong>
          </div>
          {selected ? (
            <div className={styles.previewCanvas}>
              <span className={styles.previewAura} aria-hidden>✦</span>
              <span className={`${styles.previewText} ${complete ? "" : styles.previewTextPending}`}>{selected.label || copy[selected.choice]}</span>
              {needsUrl || needsPhone ? (
                <span className={styles.previewTarget}>
                  {copy.previewDestination} · {selected.url || selected.phone || automaticDestination || "—"}
                </span>
              ) : null}
            </div>
          ) : (
            <div className={styles.previewEmpty}>
              <span className={styles.previewEmptyIcon} aria-hidden>✦</span>
              <strong>{copy.empty}</strong>
              <p>{copy.previewEmpty}</p>
            </div>
          )}
          {selected ? (
            <p className={styles.capability}>
              {!complete ? copy.missingDestination :
                activeChannel === "instagram" || activeChannel === "tiktok" ? copy.noLinks :
                  NATIVE_CTA_CHANNELS.has(activeChannel) ? copy.native : copy.text}
            </p>
          ) : null}
        </aside>
        </div>
        <button type="button" className={styles.navArrow} aria-label="Canal suivant" onClick={() => navigate(1)}>›</button>
      </div>
    </section>
  );
}
