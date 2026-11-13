"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useDashboardViewerAccess } from "../../_components/DashboardViewerAccessProvider";
import { useTranslations } from "next-intl";
import {
  AI_CTA_CHANNELS as ALL_AI_CTA_CHANNELS,
  isAiChannelCtaComplete,
  resolveAiChannelCtaMap,
  type AiChannelCtaConfig,
  type AiChannelCtaDestinations,
  type AiChannelCtaMap,
  type AiCtaChannel,
  type AiCtaChoice,
} from "@/lib/aiChannelCtaPreferences";
import { getSupportedPreferredCtasForChannel, normalizeCtaPhone } from "@/lib/boosterCtaPreferences";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import { isBoosterLinkCtaChoice } from "@/lib/boosterCtaActions";
import styles from "./AiChannelCtaPanel.module.css";
import { useInrAssistantLocalInterface } from "../../_hooks/useInrAssistantLocalInterface";

type Props = {
  value: AiChannelCtaMap;
  onChange: (value: AiChannelCtaMap) => void;
  disabled?: boolean;
  assistantActive?: boolean;
};



const CHOICE_ICONS: Record<AiCtaChoice | "none", string> = {
  none: "—",
  site: "↗",
  devis: "✦",
  appeler: "☎",
  message: "✉",
  whatsapp: "◉",
  custom: "⌁",
  reserver: "▦",
  commander: "☷",
  acheter: "◇",
  inscrire: "+",
};

const CHOICE_MODE: Record<AiCtaChoice, Exclude<AiChannelCtaConfig["mode"], "none">> = {
  site: "website",
  devis: "website",
  appeler: "call",
  message: "message",
  whatsapp: "custom",
  custom: "custom",
  reserver: "website",
  commander: "website",
  acheter: "website",
  inscrire: "website",
};

const NATIVE_CTA_CHANNELS = new Set<AiCtaChannel>(["gmb", "pinterest",  "site_web"]);

function automaticWebsite(channel: AiCtaChannel, destinations: AiChannelCtaDestinations | null) {

  if (channel === "site_web") return destinations?.siteWebUrl || destinations?.preferredWebsiteUrl || "";
  return destinations?.preferredWebsiteUrl || destinations?.siteWebUrl || "";
}

export default function AiChannelCtaPanel({ value, onChange, disabled = false, assistantActive = true }: Props) {
  const channelT = useTranslations("dashboard");
  const { metaPilotEnabled, actorUserId, activeAccountId } = useDashboardViewerAccess();
  const AI_CTA_CHANNELS = ALL_AI_CTA_CHANNELS.filter(({ key }) => key !== "threads" || metaPilotEnabled)
    .map(channel => channel.key === "site_web" ? { ...channel, label: channelT("inrSearchPresentation.website") } : channel);
  const i18nT = useTranslations();
  const copy = {
    title: i18nT("settings.cta_title"),
    description: i18nT("settings.cta_description"),
    select: i18nT("settings.cta_select"),
    empty: i18nT("settings.cta_empty"),
    site: i18nT("booster.voir_le_site_5bf01317"),
    devis: i18nT("booster.demander_un_devis_8a1f1c6c"),
    appeler: i18nT("booster.appeler_de49ee03"),
    message: i18nT("booster.envoyer_un_message_c211810b"),
    whatsapp: i18nT("settings.ecrire_sur_whatsapp_c86e042a"),
    custom: i18nT("booster.lien_personnalise_d1d21cea"),
    reserver: i18nT("booster.cta_action_reserver"),
    commander: i18nT("settings.commander_79056c7a"),
    acheter: i18nT("settings.video_credit_buy"),
    inscrire: i18nT("booster.cta_action_inscrire"),
    label: i18nT("booster.texte_du_cta_f158373f"),
    url: i18nT("settings.cta_url"),
    customUrl: i18nT("booster.lien_personnalise_d1d21cea"),
    phone: i18nT("settings.cta_phone"),
    automatic: i18nT("settings.cta_automatic"),
    missingDestination: i18nT("settings.cta_missing_destination"),
    configured: i18nT("settings.cta_configured"),
    default: i18nT("settings.cta_default"),
    incomplete: i18nT("booster.wizard_to_complete"),
    notConfigured: i18nT("settings.cta_not_configured"),
    native: i18nT("settings.cta_native"),
    text: i18nT("settings.cta_text"),
    callText: i18nT("settings.cta_call_text"),
    googleCall: i18nT("settings.cta_google_call"),
    storyCall: i18nT("settings.cta_story_call"),
    noLinks: i18nT("settings.cta_no_links"),
    shortsLinks: i18nT("settings.cta_shorts_links"),
    preview: i18nT("settings.cta_preview"),
    settings: i18nT("settings.cta_settings"),
    previewEmpty: i18nT("settings.cta_preview_empty"),
    previewDestination: i18nT("mails.destination_d4271349"),
    settingsEmpty: i18nT("settings.cta_settings_empty"),
    actionUrl: i18nT("settings.cta_action_url"),
    choiceHints: {
      reserver: i18nT("settings.cta_choice_hints_reserver"),
      commander: i18nT("settings.cta_choice_hints_commander"),
      acheter: i18nT("settings.cta_choice_hints_acheter"),
      inscrire: i18nT("settings.cta_choice_hints_inscrire"),
      none: i18nT("settings.cta_choice_hints_none"),
      site: i18nT("settings.cta_choice_hints_site"),
      devis: i18nT("settings.cta_choice_hints_devis"),
      appeler: i18nT("settings.cta_choice_hints_appeler"),
      message: i18nT("settings.cta_choice_hints_message"),
      whatsapp: i18nT("settings.cta_choice_hints_whatsapp"),
      custom: i18nT("settings.cta_choice_hints_custom"),
    },
  };
  const [selectedActiveChannel, setActiveChannel] = useState<AiCtaChannel>("site_web");
  const activeChannel = selectedActiveChannel === "threads" && !metaPilotEnabled ? "site_web" : selectedActiveChannel;
  const [menuOpen, setMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [accountId, setAccountId] = useState(() => getActiveBrowserUserId() || activeAccountId);
  const [loadedDestinations, setLoadedDestinations] = useState<{ actor: string; account: string; value: AiChannelCtaDestinations } | null>(null);
  const currentAccountId = getActiveBrowserUserId() || activeAccountId;
  const destinations = loadedDestinations?.actor === actorUserId && loadedDestinations.account === currentAccountId ? loadedDestinations.value : null;
  useEffect(() => {
    const update = () => setAccountId(getActiveBrowserUserId() || activeAccountId);
    update();
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, update);
    return () => window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, update);
  }, [activeAccountId]);
  const effectiveValue = useMemo(() => ({ ...resolveAiChannelCtaMap(value, destinations), ...value }), [value, destinations]);
  const activeSelection = (channel: AiCtaChannel) => {
    const selection = effectiveValue[channel];
    return selection?.choice === "none" ? undefined : selection;
  };
  useEffect(() => {
    if (!actorUserId || !accountId || (getActiveBrowserUserId() || activeAccountId) !== accountId) return;
    const controller = new AbortController();
    void fetch("/api/booster/cta-defaults", { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("cta_destinations_unavailable");
        return response.json() as Promise<AiChannelCtaDestinations>;
      })
      .then((loaded) => {
        if (!controller.signal.aborted && (getActiveBrowserUserId() || activeAccountId) === accountId) {
          setLoadedDestinations({ actor: actorUserId, account: accountId, value: loaded });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [actorUserId, accountId, activeAccountId]);
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
    isAiChannelCtaComplete(key, activeSelection(key), destinations),
  ).length;
  const configuredPercent = Math.round((configuredCount / AI_CTA_CHANNELS.length) * 100);
  const progressLabel = i18nT("settings.cta_configured_count", { configured: configuredCount, total: AI_CTA_CHANNELS.length });
  const activeMeta = AI_CTA_CHANNELS.find(({ key }) => key === activeChannel)!;
  const activeIndex = AI_CTA_CHANNELS.findIndex(({ key }) => key === activeChannel);
  const navigate = (direction: -1 | 1) => {
    const nextIndex = (activeIndex + direction + AI_CTA_CHANNELS.length) % AI_CTA_CHANNELS.length;
    setMenuOpen(false);
    setActiveChannel(AI_CTA_CHANNELS[nextIndex].key);
  };
  useInrAssistantLocalInterface("writing_cta_channels", { activeChannel, menuOpen }, {
    previous: { invoke: () => navigate(-1), matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "activeChannel" in snapshot && "menuOpen" in snapshot && snapshot.activeChannel === AI_CTA_CHANNELS[(activeIndex - 1 + AI_CTA_CHANNELS.length) % AI_CTA_CHANNELS.length].key && snapshot.menuOpen === false) },
    next: { invoke: () => navigate(1), matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "activeChannel" in snapshot && "menuOpen" in snapshot && snapshot.activeChannel === AI_CTA_CHANNELS[(activeIndex + 1) % AI_CTA_CHANNELS.length].key && snapshot.menuOpen === false) },
    select: { invoke: key => { const channel = AI_CTA_CHANNELS.find(channel => channel.key === key); if (!channel) throw new Error("CTA channel unavailable"); setMenuOpen(false); setActiveChannel(channel.key); }, matches: (snapshot, key) => Boolean(snapshot && typeof snapshot === "object" && "activeChannel" in snapshot && "menuOpen" in snapshot && snapshot.activeChannel === key && snapshot.menuOpen === false) },
  }, assistantActive, disabled);
  useInrAssistantLocalInterface("writing_cta_choices", { menuOpen }, {
    open: { invoke: () => setMenuOpen(true), matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "menuOpen" in snapshot && snapshot.menuOpen === true) },
    close: { invoke: () => setMenuOpen(false), matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "menuOpen" in snapshot && snapshot.menuOpen === false) },
  }, assistantActive, disabled);
  const selected = activeSelection(activeChannel);
  const complete = isAiChannelCtaComplete(activeChannel, selected, destinations);
  const choices = getSupportedPreferredCtasForChannel(activeChannel).filter((choice) => choice !== "none");
  const selectionOptions: Array<AiCtaChoice | "none"> = ["none", ...choices];
  const specificLink = isBoosterLinkCtaChoice(selected?.choice);
  const needsUrl = specificLink || selected?.choice === "site" || selected?.choice === "devis" || selected?.choice === "custom";
  const needsPhone = selected?.choice === "appeler" || selected?.choice === "whatsapp";
  const automaticDestination = selected?.choice === "custom" || specificLink ? "" : needsUrl
    ? automaticWebsite(activeChannel, destinations)
    : destinations?.phone || "";
  const callPreviewPhone = selected?.choice === "appeler"
    ? normalizeCtaPhone(selected.phone) || normalizeCtaPhone(destinations?.phone)
    : "";
  const previewLabel = selected ? selected.label || copy[selected.choice] : "";
  const previewText = selected?.choice === "appeler" && activeChannel !== "gmb" &&
    callPreviewPhone && !previewLabel.includes(callPreviewPhone)
    ? `${previewLabel} : ${callPreviewPhone}`
    : previewLabel;
  let capabilityText = "";
  if (selected) {
    if (!complete) capabilityText = copy.missingDestination;
    else if (selected.choice === "appeler") {
      capabilityText = activeChannel === "gmb"
        ? copy.native
        : `${copy.callText}${activeChannel === "facebook" || activeChannel === "instagram" ? ` ${copy.storyCall}` : ""}`;
    } else if (activeChannel === "instagram" || activeChannel === "tiktok") {
      capabilityText = copy.noLinks;
    } else if (activeChannel === "youtube_shorts") {
      capabilityText = copy.shortsLinks;
    } else {
      capabilityText = NATIVE_CTA_CHANNELS.has(activeChannel) ? copy.native : copy.text;
    }
  }

  const update = (channel: AiCtaChannel, patch: Partial<AiChannelCtaConfig> | null) => {
    const next = { ...value };
    if (patch === null) {
      next[channel] = { choice: "none", mode: "none", label: "", url: "", phone: "" };
    } else {
      next[channel] = { ...effectiveValue[channel], ...patch } as AiChannelCtaConfig;
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
        <div className={styles.progress} aria-label={`${configuredPercent} %, ${progressLabel}`}>
          <strong>{configuredPercent}<small> %</small></strong>
          <span>{progressLabel}</span>
        </div>
      </div>

      <div className={styles.channelTabs} role="tablist" aria-label={copy.select}>
        {AI_CTA_CHANNELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeChannel === key}
            className={`${styles.channelTab} ${activeChannel === key ? styles.channelTabActive : ""} ${isAiChannelCtaComplete(key, activeSelection(key), destinations) ? styles.channelTabReady : activeSelection(key) ? styles.channelTabPending : ""}`}
            onClick={() => { setMenuOpen(false); setActiveChannel(key); }}
          >
            <span>{label}</span>
            <span className={`${styles.dot} ${isAiChannelCtaComplete(key, activeSelection(key), destinations) ? styles.dotReady : activeSelection(key) ? styles.dotPending : ""}`} aria-hidden />
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
        <button type="button" className={styles.navArrow} aria-label={channelT("canal_precedent_e644dfdf")} onClick={() => navigate(-1)}>‹</button>
        <div className={styles.framePair} data-cta-channel={activeChannel} role="tabpanel">
        <article className={styles.card}>
          <div className={styles.cardHeading}>
            <span className={styles.cardIndex}>{String(activeIndex + 1).padStart(2, "0")}</span>
            <span className={styles.cardTitle}><small>{copy.settings}</small><strong>{activeMeta.label}</strong></span>
            <span className={`${styles.status} ${complete ? styles.ready : selected ? styles.pending : ""}`}>
              {complete ? value[activeChannel] ? copy.configured : copy.default : selected ? copy.incomplete : copy.notConfigured}
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
                      placeholder={copy[selected.choice]}
                      maxLength={180}
                      disabled={disabled}
                      onChange={(event) => update(activeChannel, { label: event.target.value })}
                    />
                  </label>
                  {needsUrl ? (
                    <label className={styles.field}>
                      <span>{specificLink ? copy.actionUrl : selected.choice === "custom" ? copy.customUrl : copy.url}</span>
                      <input
                        type="url"
                        inputMode="url"
                        placeholder={selected.choice === "custom" || specificLink ? "https://…" : automaticDestination || "https://…"}
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
              {selected && (needsUrl || needsPhone) && !(activeChannel === "gmb" && selected.choice === "appeler") ? (
                <p className={styles.destination}>
                  {selected.url || selected.phone ? `${copy.previewDestination} : ${selected.url || selected.phone}` : automaticDestination ? `${copy.automatic} : ${automaticDestination}` : copy.missingDestination}
                </p>
              ) : null}
              {activeChannel === "gmb" && selected?.choice === "appeler" ? (
                <p className={styles.destination}>{copy.googleCall}</p>
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
              <span className={`${styles.previewText} ${complete ? "" : styles.previewTextPending}`}>
                {previewText}
              </span>
              {(needsUrl || needsPhone) && selected.choice !== "appeler" ? (
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
            <p className={styles.capability}>{capabilityText}</p>
          ) : null}
        </aside>
        </div>
        <button type="button" className={styles.navArrow} aria-label={channelT("canal_suivant_d20db274")} onClick={() => navigate(1)}>›</button>
      </div>
    </section>
  );
}
