"use client";

import { useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import styles from "./DashboardChannelBubble.module.css";
import { getChannelPopoverPlacement } from "./channel-popover-position";

export default function ChannelBoardCreator({ onCreate, disabled }: { onCreate: (name: string) => boolean | Promise<boolean>; disabled?: boolean }) {
  const t = useTranslations("dashboard.channelBubble");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const place = () => { if (trigger.current) setPosition(getChannelPopoverPlacement(trigger.current, menu.current, 300)); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim().replace(/\s+/g, " ");
    if (disabled || submitting.current || !nextName || nextName.length > 180) return;
    submitting.current = true; setPending(true); setError("");
    try {
      if (await onCreate(nextName)) {
        setName("");
        menu.current?.hidePopover();
      } else setError(t("createBoardFailed"));
    } catch { setError(t("createBoardFailed")); }
    finally { submitting.current = false; setPending(false); }
  };
  return <>
    <button ref={trigger} type="button" className={`${styles.iconAction} ${styles.createBoardTrigger}`} popoverTarget={id} disabled={disabled || pending} aria-label={t("createBoard")} title={t("createBoard")}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    <div ref={menu} id={id} popover="auto" role="group" aria-label={t("createBoard")} className={`${styles.typesMenu} ${styles.boardCreator}`} style={position} onBeforeToggle={event => {
      if (event.newState !== "open") return;
      place();
      setError("");
    }} onToggle={event => { if (event.newState === "open") { place(); input.current?.focus(); } }}>
      <header className={styles.popoverHeader}><strong>{t("createBoard")}</strong><button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={t("close")}>×</button></header>
      <form onSubmit={event => void submit(event)} className={styles.boardCreatorForm} aria-busy={pending}>
        <label htmlFor={`${id}-name`}>{t("boardName")}</label>
        <input ref={input} id={`${id}-name`} type="text" maxLength={180} required value={name} disabled={pending} onChange={event => setName(event.target.value)} autoComplete="off" />
        {error ? <p className={styles.typesError} role="alert">{error}</p> : null}
        <button type="submit" className={styles.action} disabled={disabled || pending || !name.trim()}>{pending ? t("loading") : t("createBoard")}</button>
      </form>
    </div>
  </>;
}
