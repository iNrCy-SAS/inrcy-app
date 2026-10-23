"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { ChannelBubbleConnection } from "./channel-bubble.types";
import styles from "./DashboardChannelBubble.module.css";
import { getChannelPopoverPlacement } from "./channel-popover-position";

export default function ChannelPublicationTypes({ name, settings, disabled }: { name: string; settings: NonNullable<ChannelBubbleConnection["publicationTypes"]>; disabled?: boolean }) {
  const t = useTranslations("dashboard.channelBubble");
  const shell = useTranslations("shell");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const place = () => { if (trigger.current) setPosition(getChannelPopoverPlacement(trigger.current, menu.current, 280)); };
  const busy = Boolean(disabled || pending || settings.loading || settings.saving);
  const change = async (patch: Parameters<typeof settings.onChange>[0]) => {
    if (saving.current || busy) return;
    saving.current = true; setPending(true); setError("");
    try { if (await settings.onChange(patch) === false) setError(t("failed")); }
    catch { setError(t("failed")); }
    finally { saving.current = false; setPending(false); }
  };
  return <>
    <button ref={trigger} type="button" className={styles.iconAction} popoverTarget={id} disabled={disabled} aria-label={`${t("publicationTypes")} — ${name}`} title={t("publicationTypes")}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="15" height="15" rx="3" /><path d="M7 3h11a3 3 0 0 1 3 3v11M9 11l5 3-5 3v-6Z" /></svg>
      <span className={styles.actionText} aria-hidden="true">{t("formatsShort")}</span>
    </button>
    <div ref={menu} id={id} popover="auto" className={styles.typesMenu} role="group" aria-label={`${t("publicationTypes")} — ${name}`} style={position} onBeforeToggle={event => {
      if (event.newState !== "open") return;
      place();
      setError("");
      void Promise.resolve().then(settings.onLoad).catch(() => setError(t("failed")));
    }} onToggle={event => { if (event.newState === "open") place(); }}>
      <header className={styles.popoverHeader}><strong>{t("publicationTypes")}</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={t("close")}>×</button></header>
      {([
        { mode: "classic", label: "instagram_classic_mode", checked: true },
        { mode: "reel", label: "instagram_reels_mode", checked: settings.value.reelsEnabled, key: "reelsEnabled" },
        { mode: "story", label: "instagram_stories_mode", checked: settings.value.storiesEnabled, key: "storiesEnabled" },
      ] as const).map(option => <div key={option.mode} className={styles.typeOption}>
        <label><input type="checkbox" checked={option.checked} disabled={busy || option.mode === "classic"} onChange={event => { if ("key" in option) void change({ [option.key]: event.target.checked }); }} /><span>{shell(option.label)}</span></label>
        <button type="button" className={styles.defaultTypeButton} disabled={busy || !option.checked} aria-pressed={(settings.value.defaultMode || "classic") === option.mode} aria-label={`${shell("instagram_default_publication_mode")} : ${shell(option.label)}`} title={`${shell("instagram_default_publication_mode")} : ${shell(option.label)}`} onClick={() => void change({ defaultMode: option.mode })}>{(settings.value.defaultMode || "classic") === option.mode ? "★" : "☆"}</button>
      </div>)}
      <p className={styles.typesHint}>★ {shell("instagram_default_publication_mode")}</p>
      {error || settings.error ? <p className={styles.typesError} role="alert">{settings.error || error}</p> : null}
    </div>
  </>;
}
