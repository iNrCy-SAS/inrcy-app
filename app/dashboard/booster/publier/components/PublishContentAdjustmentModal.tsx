"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { ChannelKey } from "../publishModal.shared";
import { PUBLISH_CHANNEL_IDENTITY } from "./publishChannelIdentity";
import css from "./PublishContentAdjustmentModal.module.css";

export type PublishContentAdjustmentInput = { idea: string; instruction: string; channels: ChannelKey[] };

type Props = {
  idea: string;
  instruction: string;
  channels: readonly { key: ChannelKey; label: string }[];
  busy: boolean;
  progress: number;
  progressLabel: string;
  error: string;
  onClose: () => void;
  onApply: (input: PublishContentAdjustmentInput) => void;
};

export default function PublishContentAdjustmentModal({ idea, instruction, channels, busy, progress, progressLabel, error, onClose, onApply }: Props) {
  const t = useTranslations("booster");
  const [step, setStep] = useState<1 | 2>(1);
  const [subject, setSubject] = useState(idea);
  const [guidance, setGuidance] = useState(instruction);
  const [selected, setSelected] = useState(() => channels.map(channel => channel.key));
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const chosen = channels.filter(channel => selected.includes(channel.key)).map(channel => channel.key);
  const changed = subject.trim() !== idea.trim() || guidance.trim() !== instruction.trim();
  const progressValue = Math.round(Math.max(0, Math.min(100, progress || 0)));

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);

  return createPortal(<dialog ref={dialog} className={css.dialog} data-step={step} aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
    <header className={css.header}>
      <div><span className={css.step}>{t("adjust_step", { step })}</span><h2 ref={heading} tabIndex={-1} id={titleId}>{t(step === 1 ? "adjust_title" : "adjust_channels_title")}</h2></div>
      <button type="button" aria-label={t("adjust_close")} disabled={busy} onClick={onClose}>×</button>
    </header>
    <div className={css.body}>
      <p id={descriptionId}>{t(step === 1 ? "adjust_intro" : "adjust_channels_intro")}</p>
      {step === 1 ? <div className={css.fields}>
        <label>{t("adjust_subject")}<textarea value={subject} maxLength={8_000} onChange={event => setSubject(event.target.value)} rows={5} /></label>
        <label>{t("adjust_instruction")}<textarea value={guidance} maxLength={4_000} onChange={event => setGuidance(event.target.value)} rows={5} /></label>
      </div> : <>
        <div className={css.selectionActions}><button type="button" disabled={busy} onClick={() => setSelected(channels.map(channel => channel.key))}>{t("adjust_select_all")}</button><button type="button" disabled={busy} onClick={() => setSelected([])}>{t("adjust_select_none")}</button><span>{t("adjust_selected", { count: chosen.length })}</span></div>
        <fieldset className={css.channels} disabled={busy}><legend className={css.srOnly}>{t("adjust_channels_title")}</legend>
          {channels.map(channel => <label key={channel.key} data-selected={selected.includes(channel.key)}><input type="checkbox" aria-label={channel.label} checked={selected.includes(channel.key)} onChange={event => setSelected(current => event.target.checked ? [...current, channel.key] : current.filter(key => key !== channel.key))} /><img src={PUBLISH_CHANNEL_IDENTITY[channel.key].icon} alt="" width={36} height={36} /></label>)}
        </fieldset>
      </>}
      {busy ? <div role="status" className={css.progress}>
        <div className={css.progressHeader}><span>{progressLabel || t("adjust_progress")}</span><strong aria-hidden="true">{progressValue}%</strong></div>
        <div role="progressbar" aria-label={t("adjust_progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue} className={css.progressTrack}><span style={{ width: `${progressValue}%` }} /></div>
      </div> : null}
      {error ? <p role="alert" className={css.error}>{error}</p> : null}
    </div>
    <footer className={css.footer}>
      <button type="button" disabled={busy} onClick={step === 1 ? onClose : () => setStep(1)}>{t(step === 1 ? "adjust_cancel" : "adjust_back")}</button>
      <button type="button" className={css.primary} disabled={busy || !subject.trim() || !changed || (step === 2 && !chosen.length)} onClick={() => step === 1 ? setStep(2) : onApply({ idea: subject.trim(), instruction: guidance.trim(), channels: chosen })}>{t(busy ? "adjust_progress" : step === 1 ? "adjust_choose_channels" : "adjust_apply")}</button>
    </footer>
  </dialog>, document.body);
}
