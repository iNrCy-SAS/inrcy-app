import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { confirmInrcy } from "@/lib/inrcyDialog";
import type { ChannelKey } from "../booster/publier/publishModal.shared";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import PublishExecutionProgress from "./PublishExecutionProgress";

export type PublishScheduleSelection = {
  channel: ChannelKey;
  scheduledAt: string;
};

export type PublishScheduleItem = {
  channel: ChannelKey;
  label: string;
  mediaLabel: string;
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
  const generalDateInputRef = useRef<HTMLInputElement | null>(null);
  const generalTimeInputRef = useRef<HTMLInputElement | null>(null);
  const dateInputRefs = useRef<
    Partial<Record<ChannelKey, HTMLInputElement | null>>
  >({});
  const timeInputRefs = useRef<
    Partial<Record<ChannelKey, HTMLInputElement | null>>
  >({});
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

  if (!open) return null;

  const isSelected = (channel: ChannelKey) =>
    selected[channel] !== undefined ? selected[channel] : true;
  const getDate = (channel: ChannelKey) =>
    dateByChannel[channel] || defaultDateTime.date;
  const getTime = (channel: ChannelKey) =>
    timeByChannel[channel] || defaultDateTime.time;
  const busy = saving || submitting;
  const blockedItems = items.filter((item) => item.blockers.length > 0);

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

  return (
    <div
      className={styles.fullscreenModalOverlay}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10013,
        background: "rgba(4, 8, 18, 0.74)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <div
        className={styles.blockCard}
        style={{
          width: "min(780px, 100%)",
          maxHeight:
            "calc(100dvh - var(--inrcy-mobile-bottom-nav-total-height, calc(50px + env(safe-area-inset-bottom, 0px))) - 32px)",
          overflowY: "auto",
          display: "grid",
          gap: 14,
          background: "#111827",
          backgroundImage: "none",
          border: "1px solid rgba(148, 163, 184, 0.28)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.62)",
          backdropFilter: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 22 }}>🕒</div>
            <div className={styles.blockTitle} style={{ marginBottom: 0 }}>
              {i18nT("schedule_title")}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.72)",
                lineHeight: 1.45,
              }}
            >
              {i18nT("schedule_description")}
            </div>
          </div>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void confirmExit()}
            disabled={busy}
          >
            {i18nT("schedule_close")}
          </button>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <section
            style={{
              display: "grid",
              gap: 12,
              borderRadius: 18,
              padding: 14,
              background:
                scheduleMode === "general"
                  ? "rgba(34,197,94,0.10)"
                  : "rgba(255,255,255,0.04)",
              border:
                scheduleMode === "general"
                  ? "1px solid rgba(34,197,94,0.34)"
                  : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              <input
                type="radio"
                name="publish-schedule-mode"
                checked={scheduleMode === "general"}
                onChange={activateGeneralMode}
                disabled={busy || !publishableItems.length}
                style={{ marginTop: 3 }}
              />
              <span style={{ display: "grid", gap: 4 }}>
                <strong style={{ color: "#fff", fontSize: 15 }}>
                  {i18nT("schedule_general_title")}
                </strong>
                <span
                  style={{
                    fontSize: 12,
                    lineHeight: 1.4,
                    color: "rgba(255,255,255,0.66)",
                  }}
                >
                  {i18nT("schedule_general_description")}
                </span>
              </span>
            </label>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "1fr"
                  : "minmax(0,1fr) minmax(162px,170px) minmax(136px,145px)",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: "rgba(255,255,255,0.68)",
                }}
              >
                {i18nT("schedule_channels_summary", {
                  count: publishableItems.length,
                  blocked: blockedItems.length,
                })}
              </div>
              <div
                className={styles.scheduleDateTimeField}
                data-disabled={
                  scheduleMode !== "general" || busy ? "true" : "false"
                }
                onClick={() =>
                  openNativeDateTimePicker(generalDateInputRef.current)
                }
              >
                <input
                  ref={generalDateInputRef}
                  className={styles.scheduleDateTimeInput}
                  type="date"
                  value={generalDate || defaultDateTime.date}
                  disabled={scheduleMode !== "general" || busy}
                  onChange={(event) => setGeneralDate(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.scheduleDateTimePickerButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    openNativeDateTimePicker(generalDateInputRef.current);
                  }}
                  disabled={scheduleMode !== "general" || busy}
                  aria-label={i18nT("schedule_open_general_calendar")}
                >
                  <CalendarMiniIcon />
                </button>
              </div>
              <div
                className={styles.scheduleDateTimeField}
                data-disabled={
                  scheduleMode !== "general" || busy ? "true" : "false"
                }
                onClick={() =>
                  openNativeDateTimePicker(generalTimeInputRef.current)
                }
              >
                <input
                  ref={generalTimeInputRef}
                  className={styles.scheduleDateTimeInput}
                  type="time"
                  value={generalTime || defaultDateTime.time}
                  disabled={scheduleMode !== "general" || busy}
                  onChange={(event) => setGeneralTime(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.scheduleDateTimePickerButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    openNativeDateTimePicker(generalTimeInputRef.current);
                  }}
                  disabled={scheduleMode !== "general" || busy}
                  aria-label={i18nT("schedule_open_general_time")}
                >
                  <ClockMiniIcon />
                </button>
              </div>
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gap: scheduleMode === "channel" ? 10 : 0,
              borderRadius: 18,
              padding: 14,
              background:
                scheduleMode === "channel"
                  ? "rgba(59,130,246,0.10)"
                  : "rgba(255,255,255,0.04)",
              border:
                scheduleMode === "channel"
                  ? "1px solid rgba(96,165,250,0.34)"
                  : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <label
              aria-expanded={scheduleMode === "channel"}
              aria-controls="publish-schedule-channel-details"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                border: 0,
                padding: 0,
                background: "transparent",
                color: "inherit",
                textAlign: "left",
                cursor:
                  busy || !publishableItems.length ? "not-allowed" : "pointer",
              }}
            >
              <span style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <input
                  type="radio"
                  name="publish-schedule-mode"
                  checked={scheduleMode === "channel"}
                  onChange={activateChannelMode}
                  disabled={busy || !publishableItems.length}
                  style={{ marginTop: 3 }}
                />
                <span style={{ display: "grid", gap: 4 }}>
                  <strong style={{ color: "#fff", fontSize: 15 }}>
                    {i18nT("schedule_per_channel_title")}
                  </strong>
                  <span
                    style={{
                      fontSize: 12,
                      lineHeight: 1.4,
                      color: "rgba(255,255,255,0.66)",
                    }}
                  >
                    {i18nT("schedule_per_channel_description")}
                  </span>
                </span>
              </span>
              <span
                aria-hidden="true"
                style={{
                  fontSize: 18,
                  lineHeight: 1,
                  transform:
                    scheduleMode === "channel"
                      ? "rotate(180deg)"
                      : "rotate(0deg)",
                  transition: "transform 160ms ease",
                }}
              >
                ⌄
              </span>
            </label>

            {scheduleMode === "channel" ? (
              <div
                id="publish-schedule-channel-details"
                style={{ display: "grid", gap: 10, paddingTop: 2 }}
              >
                {items.map((item) => {
                  const disabled = item.blockers.length > 0;
                  const checked = !disabled && isSelected(item.channel);
                  return (
                    <div
                      key={item.channel}
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "1fr"
                          : "minmax(0,1fr) minmax(162px,170px) minmax(136px,145px)",
                        gap: 10,
                        alignItems: "center",
                        borderRadius: 16,
                        padding: 12,
                        background: disabled
                          ? "rgba(248,113,113,0.08)"
                          : "rgba(255,255,255,0.045)",
                        border: disabled
                          ? "1px solid rgba(248,113,113,0.24)"
                          : "1px solid rgba(255,255,255,0.08)",
                        opacity: disabled ? 0.78 : 1,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          minWidth: 0,
                          cursor: disabled ? "not-allowed" : "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled || busy}
                          onChange={(event) =>
                            setSelected((current) => ({
                              ...current,
                              [item.channel]: event.target.checked,
                            }))
                          }
                          style={{ marginTop: 3 }}
                        />
                        <span
                          style={{ display: "grid", gap: 4, minWidth: 0 }}
                        >
                          <strong style={{ color: "#fff", fontSize: 14 }}>
                            {item.label}
                          </strong>
                          <span
                            style={{
                              fontSize: 12,
                              color: disabled
                                ? "#fecaca"
                                : "rgba(255,255,255,0.62)",
                              lineHeight: 1.35,
                            }}
                          >
                            {disabled
                              ? item.blockers.join(" · ")
                              : checked
                                ? i18nT("schedule_item_scheduled", { media: item.mediaLabel })
                                : i18nT("schedule_item_now", { media: item.mediaLabel })}
                          </span>
                        </span>
                      </label>
                      <div
                        className={styles.scheduleDateTimeField}
                        data-disabled={
                          disabled || !checked || busy ? "true" : "false"
                        }
                        onClick={() =>
                          openNativeDateTimePicker(
                            dateInputRefs.current[item.channel] || null,
                          )
                        }
                      >
                        <input
                          ref={(node) => {
                            dateInputRefs.current[item.channel] = node;
                          }}
                          className={styles.scheduleDateTimeInput}
                          type="date"
                          value={getDate(item.channel)}
                          disabled={disabled || !checked || busy}
                          onChange={(event) =>
                            setDateByChannel((current) => ({
                              ...current,
                              [item.channel]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className={styles.scheduleDateTimePickerButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            openNativeDateTimePicker(
                              dateInputRefs.current[item.channel] || null,
                            );
                          }}
                          disabled={disabled || !checked || busy}
                          aria-label={i18nT("schedule_open_channel_calendar", { channel: item.label })}
                        >
                          <CalendarMiniIcon />
                        </button>
                      </div>
                      <div
                        className={styles.scheduleDateTimeField}
                        data-disabled={
                          disabled || !checked || busy ? "true" : "false"
                        }
                        onClick={() =>
                          openNativeDateTimePicker(
                            timeInputRefs.current[item.channel] || null,
                          )
                        }
                      >
                        <input
                          ref={(node) => {
                            timeInputRefs.current[item.channel] = node;
                          }}
                          className={styles.scheduleDateTimeInput}
                          type="time"
                          value={getTime(item.channel)}
                          disabled={disabled || !checked || busy}
                          onChange={(event) =>
                            setTimeByChannel((current) => ({
                              ...current,
                              [item.channel]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className={styles.scheduleDateTimePickerButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            openNativeDateTimePicker(
                              timeInputRefs.current[item.channel] || null,
                            );
                          }}
                          disabled={disabled || !checked || busy}
                          aria-label={i18nT("schedule_open_channel_time", { channel: item.label })}
                        >
                          <ClockMiniIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        </div>

        {busy ? (
          <PublishExecutionProgress
            styles={styles}
            scheduling
            publishProgress={progress}
            publishProgressLabel={resolvedProgressLabel}
          />
        ) : null}

        {localError || error ? (
          <div style={{ color: "#fecaca", fontSize: 13, lineHeight: 1.45 }}>
            {localError || error}
          </div>
        ) : null}
        {doneMessage ? (
          <div
            style={{
              color: "#bbf7d0",
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.45,
            }}
          >
            {doneMessage}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            flexWrap: "wrap",
            position: "sticky",
            bottom: -1,
            paddingTop: 4,
            background: "#111827",
          }}
        >
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void confirmExit()}
            disabled={busy}
          >
            {i18nT("schedule_cancel")}
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={submit}
            disabled={busy || Boolean(doneMessage) || !publishableItems.length}
            style={{
              opacity:
                busy || doneMessage || !publishableItems.length ? 0.58 : 1,
            }}
          >
            {busy ? resolvedSavingLabel : i18nT("schedule_assign_agent")}
          </button>
        </div>
      </div>
    </div>
  );
}
