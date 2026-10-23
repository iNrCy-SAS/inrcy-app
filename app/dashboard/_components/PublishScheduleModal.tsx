import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { confirmInrcy } from "@/lib/inrcyDialog";
import type { ChannelKey } from "../booster/publier/publishModal.shared";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import PublishExecutionProgress from "./PublishExecutionProgress";
import { PUBLISH_CHANNEL_IDENTITY } from "../booster/publier/components/publishChannelIdentity";
import css from "./PublishScheduleModal.module.css";

export type PublishScheduleSelection = {
  channel: ChannelKey;
  scheduledAt: string;
};

export type PublishScheduleItem = {
  channel: ChannelKey;
  label: string;
  mediaLabel: string;
  details?: string[];
  warnings?: string[];
  blockers: string[];
};

type PublishScheduleMode = "general" | "channel";

type PublishModalStyles = Readonly<Record<string, string>>;

type PublishScheduleModalProps = {
  open: boolean;
  styles: PublishModalStyles;
  items: PublishScheduleItem[];
  isMobile: boolean;
  saving: boolean;
  error: string;
  progress?: number;
  progressLabel?: string;
  successMessage?: string;
  savingLabel?: string;
  enableImmediateUnselectedWarning?: boolean;
  initialSelections?: PublishScheduleSelection[];
  onClose: () => void;
  onConfirm: (
    selections: PublishScheduleSelection[],
    immediateChannels: ChannelKey[],
  ) => void | Promise<void>;
  onSuccess?: () => void | Promise<void>;
  confirmLabel?: string;
  showReviewSummary?: boolean;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function getDefaultDateTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 60);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return {
    date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
  };
}

function toLocalIso(date: string, time: string) {
  const value = new Date(`${date}T${time || "00:00"}:00`);
  if (!Number.isFinite(value.getTime())) return "";
  return value.toISOString();
}

function openNativeDateTimePicker(input: HTMLInputElement | null) {
  if (!input || input.disabled) return;
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
  if (typeof pickerInput.showPicker === "function") {
    try {
      pickerInput.showPicker();
      return;
    } catch {
      // Safari et certains navigateurs peuvent refuser showPicker.
    }
  }
  input.click();
}

function CalendarMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 3v3M17 3v3M4.5 9.5h15M6.5 5h11A2.5 2.5 0 0 1 20 7.5v10A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5v-10A2.5 2.5 0 0 1 6.5 5Z" />
      <path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" />
    </svg>
  );
}

function ClockMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function ScheduleDateTimeField({
  type, label, pickerLabel, value, disabled, onChange,
}: {
  type: "date" | "time";
  label: string;
  pickerLabel: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  return (
    <div className={css.field} data-disabled={disabled || undefined}>
      <label htmlFor={inputId}>{label}</label>
      <div className={css.control}>
        <input
          id={inputId}
          ref={inputRef}
          type={type}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={pickerLabel}
          disabled={disabled}
          onClick={() => openNativeDateTimePicker(inputRef.current)}
        >
          {type === "date" ? <CalendarMiniIcon /> : <ClockMiniIcon />}
        </button>
      </div>
    </div>
  );
}

export default function PublishScheduleModal({
  open,
  styles,
  items,
  isMobile,
  saving,
  error,
  progress = 0,
  progressLabel,
  successMessage,
  savingLabel,
  enableImmediateUnselectedWarning = false,
  initialSelections,
  onClose,
  onConfirm,
  onSuccess,
  confirmLabel,
  showReviewSummary = true,
}: PublishScheduleModalProps) {
  const i18nT = useTranslations("booster");
  const resolvedProgressLabel = progressLabel || i18nT("programmation_en_cours_33f59055");
  const resolvedSuccessMessage = successMessage || i18nT("programmation_reussie_1307249b");
  const resolvedSavingLabel = savingLabel || i18nT("programmation_en_cours_33f59055");
  const publishableItems = useMemo(
    () => items.filter((item) => !item.blockers.length),
    [items],
  );
  const defaultDateTime = useMemo(() => getDefaultDateTime(), [open]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [dateByChannel, setDateByChannel] = useState<Record<string, string>>(
    {},
  );
  const [timeByChannel, setTimeByChannel] = useState<Record<string, string>>(
    {},
  );
  const [scheduleMode, setScheduleMode] =
    useState<PublishScheduleMode>("general");
  const [generalDate, setGeneralDate] = useState("");
  const [generalTime, setGeneralTime] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const channelDetailsId = titleId + "-channels";
  const busy = saving || submitting;
  const [baseline, setBaseline] = useState("");

  useEffect(() => {
    if (!open) return;
    const nextSelected: Record<string, boolean> = {};
    const nextDates: Record<string, string> = {};
    const nextTimes: Record<string, string> = {};
    const publishableChannels = items
      .filter((item) => item.blockers.length === 0)
      .map((item) => item.channel);
    const byChannel = new Map(
      (initialSelections || []).map((selection) => [selection.channel, selection]),
    );

    for (const item of items) {
      const selection = byChannel.get(item.channel);
      nextSelected[item.channel] = initialSelections?.length
        ? Boolean(selection)
        : item.blockers.length === 0;
      if (selection?.scheduledAt) {
        const date = new Date(selection.scheduledAt);
        if (Number.isFinite(date.getTime())) {
          nextDates[item.channel] = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
          nextTimes[item.channel] = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
        }
      }
    }

    const initialDates = publishableChannels
      .filter((channel) => nextSelected[channel])
      .map((channel) => `${nextDates[channel] || ""}T${nextTimes[channel] || ""}`)
      .filter((value) => value !== "T");
    const allPublishableSelected =
      publishableChannels.length > 0 &&
      publishableChannels.every((channel) => nextSelected[channel]);
    const oneSharedDateTime =
      initialDates.length === publishableChannels.length &&
      initialDates.length > 0 &&
      new Set(initialDates).size === 1;
    const nextMode: PublishScheduleMode =
      !initialSelections?.length || (allPublishableSelected && oneSharedDateTime)
        ? "general"
        : "channel";
    const firstSelectedChannel = publishableChannels.find(
      (channel) => nextSelected[channel] && nextDates[channel] && nextTimes[channel],
    );
    const nextGeneralDate = firstSelectedChannel
      ? nextDates[firstSelectedChannel]
      : defaultDateTime.date;
    const nextGeneralTime = firstSelectedChannel
      ? nextTimes[firstSelectedChannel]
      : defaultDateTime.time;

    setSelected(nextSelected);
    setDateByChannel(nextDates);
    setTimeByChannel(nextTimes);
    setScheduleMode(nextMode);
    setGeneralDate(nextGeneralDate);
    setGeneralTime(nextGeneralTime);
    setBaseline(
      JSON.stringify({
        mode: nextMode,
        generalDate: nextGeneralDate,
        generalTime: nextGeneralTime,
        selected: nextSelected,
        dates: nextDates,
        times: nextTimes,
      }),
    );
    setLocalError("");
    setSubmitting(false);
    setDoneMessage("");
  }, [
    open,
    items.map((item) => item.channel).join("|"),
    (initialSelections || [])
      .map((selection) => `${selection.channel}:${selection.scheduledAt}`)
      .join("|"),
  ]);

  const currentSignature = JSON.stringify({
    mode: scheduleMode,
    generalDate,
    generalTime,
    selected,
    dates: dateByChannel,
    times: timeByChannel,
  });
  const hasUnsavedChanges = open && Boolean(baseline) && currentSignature !== baseline;
  const { confirmExit } = useUnsavedExitGuard({
    active: open,
    shouldBlock: hasUnsavedChanges,
    onConfirmExit: onClose,
    eyebrow: i18nT("schedule_eyebrow"),
    title: i18nT("schedule_leave_title"),
    message: i18nT("schedule_leave_message"),
    confirmLabel: i18nT("schedule_leave_confirm"),
    cancelLabel: i18nT("schedule_leave_cancel"),
    variant: "warning",
  });

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => { previousFocus?.focus({ preventScroll: true }); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const activeDialog = document.activeElement?.closest('[aria-modal="true"]');
      if (activeDialog && activeDialog !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!busy) void confirmExit();
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
      )).filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, busy, confirmExit]);

  if (!open) return null;

  const isSelected = (channel: ChannelKey) =>
    selected[channel] !== undefined ? selected[channel] : true;
  const getDate = (channel: ChannelKey) =>
    dateByChannel[channel] || defaultDateTime.date;
  const getTime = (channel: ChannelKey) =>
    timeByChannel[channel] || defaultDateTime.time;
  const blockedItems = items.filter((item) => item.blockers.length > 0);
  const reviewDetails = Array.from(
    new Set(items.flatMap((item) => item.details || [])),
  );
  const reviewWarnings = Array.from(
    new Set(items.flatMap((item) => item.warnings || [])),
  );

  const activateGeneralMode = () => {
    if (busy || !publishableItems.length) return;
    setScheduleMode("general");
    setLocalError("");
  };

  const activateChannelMode = () => {
    if (busy || !publishableItems.length) return;
    setScheduleMode("channel");
    setSelected((current) => {
      const next = { ...current };
      for (const item of publishableItems) {
        if (next[item.channel] === undefined) next[item.channel] = true;
      }
      return next;
    });
    setDateByChannel((current) => {
      const next = { ...current };
      for (const item of publishableItems) {
        if (!next[item.channel]) next[item.channel] = generalDate || defaultDateTime.date;
      }
      return next;
    });
    setTimeByChannel((current) => {
      const next = { ...current };
      for (const item of publishableItems) {
        if (!next[item.channel]) next[item.channel] = generalTime || defaultDateTime.time;
      }
      return next;
    });
    setLocalError("");
  };

  const submit = async () => {
    if (busy || doneMessage) return;
    const selections = (
      scheduleMode === "general"
        ? publishableItems.map((item) => ({
            channel: item.channel,
            scheduledAt: toLocalIso(
              generalDate || defaultDateTime.date,
              generalTime || defaultDateTime.time,
            ),
          }))
        : publishableItems
            .filter((item) => isSelected(item.channel))
            .map((item) => ({
              channel: item.channel,
              scheduledAt: toLocalIso(
                getDate(item.channel),
                getTime(item.channel),
              ),
            }))
    ).filter((item) => item.scheduledAt);

    if (!selections.length) {
      setLocalError(i18nT("schedule_select_channel_error"));
      return;
    }

    const now = Date.now();
    const invalidPast = selections.some(
      (selection) => new Date(selection.scheduledAt).getTime() <= now + 60_000,
    );
    if (invalidPast) {
      setLocalError(i18nT("schedule_future_datetime_error"));
      return;
    }

    const immediateChannels =
      scheduleMode === "general"
        ? []
        : publishableItems
            .filter((item) => !isSelected(item.channel))
            .map((item) => item.channel);

    if (enableImmediateUnselectedWarning && immediateChannels.length) {
      const labels = publishableItems
        .filter((item) => immediateChannels.includes(item.channel))
        .map((item) => item.label)
        .join(", ");
      const confirmed = await confirmInrcy({
        title: i18nT("schedule_publish_others_title"),
        message: i18nT("schedule_publish_others_message", { channels: labels }),
        confirmLabel: i18nT("schedule_confirm"),
        cancelLabel: i18nT("schedule_back"),
        variant: "warning",
      });
      if (!confirmed) return;
    }

    setLocalError("");
    setSubmitting(true);
    try {
      await onConfirm(selections, immediateChannels);
      setDoneMessage(resolvedSuccessMessage);
      window.setTimeout(() => {
        void onSuccess?.();
      }, 850);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message) {
        setLocalError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const scheduledCount = scheduleMode === "general"
    ? publishableItems.length
    : publishableItems.filter((item) => isSelected(item.channel)).length;

  return createPortal(
    <div className={css.overlay} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) void confirmExit();
    }}>
      <div
        ref={dialogRef}
        className={css.dialog}
        data-mode={scheduleMode}
        data-mobile={isMobile || undefined}
        data-publish-schedule-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={css.header}>
          <span className={css.headerIcon}><CalendarMiniIcon /></span>
          <h2 id={titleId}>{i18nT("schedule_title")}</h2>
          <button type="button" className={css.close} aria-label={i18nT("schedule_close")} disabled={busy} onClick={() => void confirmExit()}>×</button>
        </header>
        <div className={css.body}>
          <div className={css.modes} role="radiogroup" aria-label={i18nT("schedule_eyebrow")}>
            <label className={css.mode} data-active={scheduleMode === "general"}>
              <input type="radio" name={titleId + "-mode"} checked={scheduleMode === "general"} onChange={activateGeneralMode} disabled={busy || !publishableItems.length} />
              <span><strong>{i18nT("schedule_general_title")}</strong><small>{i18nT("schedule_general_description")}</small></span>
            </label>
            <label className={css.mode} data-active={scheduleMode === "channel"}>
              <input type="radio" name={titleId + "-mode"} checked={scheduleMode === "channel"} onChange={activateChannelMode} disabled={busy || !publishableItems.length} aria-controls={channelDetailsId} />
              <span><strong>{i18nT("schedule_per_channel_title")}</strong><small>{i18nT("schedule_per_channel_description")}</small></span>
            </label>
          </div>
          <div className={css.summary}>
            <span>{i18nT("schedule_channels_summary", { count: scheduledCount, blocked: blockedItems.length })}</span>
            {blockedItems.length ? (
              <details className={css.blocked}>
                <summary>{i18nT("wizard_to_complete")} <span aria-hidden>⌄</span></summary>
                <div>{blockedItems.map((item) => <p key={item.channel}><strong>{item.label}</strong> · {item.blockers.join(" · ")}</p>)}</div>
              </details>
            ) : null}
          </div>
          {showReviewSummary && (reviewDetails.length || reviewWarnings.length) ? (
            <div className={css.review}>
              {reviewDetails.map((detail) => <p key={detail}>{detail}</p>)}
              {reviewWarnings.map((warning) => <p key={warning} className={css.warning}><span aria-hidden>⚠</span> {warning}</p>)}
            </div>
          ) : null}
          {scheduleMode === "general" ? (
            <div className={css.generalFields}>
              <ScheduleDateTimeField type="date" label={i18nT("date_eb9a4bc1")} pickerLabel={i18nT("schedule_open_general_calendar")} value={generalDate || defaultDateTime.date} disabled={busy || !publishableItems.length} onChange={setGeneralDate} />
              <ScheduleDateTimeField type="time" label={i18nT("heure_5073129f")} pickerLabel={i18nT("schedule_open_general_time")} value={generalTime || defaultDateTime.time} disabled={busy || !publishableItems.length} onChange={setGeneralTime} />
            </div>
          ) : null}
          {scheduleMode === "channel" ? (
            <div id={channelDetailsId} className={css.channelList}>
              {items.map((item) => {
                const unavailable = item.blockers.length > 0;
                const checked = !unavailable && isSelected(item.channel);
                const identity = PUBLISH_CHANNEL_IDENTITY[item.channel];
                return (
                  <section key={item.channel} className={css.channel} data-disabled={unavailable || undefined} data-selected={checked} style={{ "--channel-color": identity.color, "--channel-rgb": identity.rgb, "--channel-gradient": identity.gradient } as CSSProperties}>
                    <label className={css.channelLabel}>
                      <input type="checkbox" checked={checked} disabled={busy || unavailable} onChange={(event) => setSelected((current) => ({ ...current, [item.channel]: event.target.checked }))} />
                      <Image src={identity.icon} width={24} height={24} alt="" />
                      <span>
                        <strong>{item.label}</strong>
                        <small title={unavailable ? item.blockers.join(" · ") : undefined}>{unavailable ? item.blockers[0] : i18nT(checked ? "schedule_item_scheduled" : "schedule_item_now", { media: item.mediaLabel })}</small>
                      </span>
                    </label>
                    <div className={css.channelFields}>
                      <ScheduleDateTimeField type="date" label={i18nT("date_eb9a4bc1")} pickerLabel={i18nT("schedule_open_channel_calendar", { channel: item.label })} value={getDate(item.channel)} disabled={busy || !checked} onChange={(value) => setDateByChannel((current) => ({ ...current, [item.channel]: value }))} />
                      <ScheduleDateTimeField type="time" label={i18nT("heure_5073129f")} pickerLabel={i18nT("schedule_open_channel_time", { channel: item.label })} value={getTime(item.channel)} disabled={busy || !checked} onChange={(value) => setTimeByChannel((current) => ({ ...current, [item.channel]: value }))} />
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
          {busy ? <PublishExecutionProgress styles={styles} scheduling publishProgress={progress} publishProgressLabel={resolvedProgressLabel} /> : null}
          {localError || error ? <p className={css.error} role="alert">{localError || error}</p> : null}
          {doneMessage ? <p className={css.success} role="status">{doneMessage}</p> : null}
        </div>
        <footer className={css.footer}>
          <button type="button" className={css.cancel} onClick={() => void confirmExit()} disabled={busy}>{i18nT("schedule_cancel")}</button>
          <button type="button" className={css.confirm} onClick={() => void submit()} disabled={busy || Boolean(doneMessage) || !publishableItems.length}>
            {busy ? resolvedSavingLabel : confirmLabel || i18nT("schedule_assign_agent")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
