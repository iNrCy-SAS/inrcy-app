"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import {
  computeNextBusinessDnaAutomaticOccurrence,
  defaultBusinessDnaAutomaticSchedule,
  type BusinessDnaAutomaticSchedule,
} from "@/lib/businessDnaAutomaticSchedule";
import styles from "./BusinessDnaAnalysisScheduleModal.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const record = payload as Record<string, unknown>;
  return String(record.user_message || record.error || fallback);
}

function parseSchedule(value: unknown): BusinessDnaAutomaticSchedule {
  const fallback = defaultBusinessDnaAutomaticSchedule();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const schedule = value as Record<string, unknown>;
  return {
    enabled: schedule.enabled === true,
    dayOfMonth: Number.isInteger(Number(schedule.dayOfMonth))
      ? Math.min(28, Math.max(1, Number(schedule.dayOfMonth)))
      : fallback.dayOfMonth,
    time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(schedule.time || ""))
      ? String(schedule.time)
      : fallback.time,
    timezone: typeof schedule.timezone === "string" && schedule.timezone
      ? schedule.timezone
      : fallback.timezone,
    nextRunAt: typeof schedule.nextRunAt === "string" && schedule.nextRunAt
      ? schedule.nextRunAt
      : null,
    lastProcessedPeriod:
      typeof schedule.lastProcessedPeriod === "string" && schedule.lastProcessedPeriod
        ? schedule.lastProcessedPeriod
        : null,
    lastStatus: ["never", "running", "success", "failed", "skipped_no_source"].includes(
      String(schedule.lastStatus || ""),
    )
      ? schedule.lastStatus as BusinessDnaAutomaticSchedule["lastStatus"]
      : "never",
    lastRunAt: typeof schedule.lastRunAt === "string" && schedule.lastRunAt
      ? schedule.lastRunAt
      : null,
    lastSuccessAt: typeof schedule.lastSuccessAt === "string" && schedule.lastSuccessAt
      ? schedule.lastSuccessAt
      : null,
  };
}

export default function BusinessDnaAnalysisScheduleModal({ open, onClose }: Props) {
  const t = useTranslations("dashboard.aiMemory");
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [schedule, setSchedule] = useState<BusinessDnaAutomaticSchedule>(
    defaultBusinessDnaAutomaticSchedule(),
  );
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch("/api/ai-memory/analysis-schedule", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(apiErrorMessage(payload, t("analysisScheduleLoadError")));
        setSchedule(parseSchedule(payload.schedule));
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : t("analysisScheduleLoadError"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadAttempt, open, t]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled])",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  const previewRunAt = useMemo(() => {
    if (!schedule.enabled) return null;
    try {
      return computeNextBusinessDnaAutomaticOccurrence({
        dayOfMonth: schedule.dayOfMonth,
        time: schedule.time,
        timezone: schedule.timezone,
        lastProcessedPeriod: schedule.lastProcessedPeriod,
      }).runAt;
    } catch {
      return schedule.nextRunAt;
    }
  }, [schedule]);

  const formattedNextRun = useMemo(() => {
    if (!previewRunAt) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: schedule.timezone,
      }).format(new Date(previewRunAt));
    } catch {
      return new Date(previewRunAt).toLocaleString();
    }
  }, [previewRunAt, schedule.timezone]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/ai-memory/analysis-schedule", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: schedule.enabled,
          dayOfMonth: schedule.dayOfMonth,
          time: schedule.time,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, t("analysisScheduleSaveError")));
      setSchedule(parseSchedule(payload.schedule));
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("analysisScheduleSaveError"));
    } finally {
      setSaving(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-dna-schedule-title"
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <span aria-hidden className={styles.icon}>◷</span>
            <div>
              <p className={styles.eyebrow}>{t("analysisScheduleEyebrow")}</p>
              <div className={styles.titleRow}>
                <h2 id="business-dna-schedule-title" className={styles.title}>
                  {t("analysisScheduleTitle")}
                </h2>
                <span className={styles.freeBadge}>{t("analysisScheduleFreeBadge")}</span>
              </div>
              <p className={styles.description}>{t("analysisScheduleDescription")}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            aria-label={t("analysisScheduleClose")}
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {loading ? (
          <div className={styles.loading}>{t("analysisScheduleLoading")}</div>
        ) : (
          <>
            <div className={styles.body}>
              <div className={styles.switchRow}>
                <span className={styles.switchCopy}>
                  <strong>{t("analysisScheduleToggle")}</strong>
                  <span>{t("analysisScheduleToggleHint")}</span>
                </span>
                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={t("analysisScheduleToggle")}
                    checked={schedule.enabled}
                    disabled={saving}
                    onChange={(event) => setSchedule((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))}
                  />
                  <span aria-hidden className={styles.switchTrack} />
                </label>
              </div>

              <div className={styles.fields}>
                <div className={styles.field}>
                  <label htmlFor="business-dna-schedule-day">{t("analysisScheduleDay")}</label>
                  <select
                    id="business-dna-schedule-day"
                    value={schedule.dayOfMonth}
                    disabled={saving}
                    onChange={(event) => setSchedule((current) => ({
                      ...current,
                      dayOfMonth: Number(event.target.value),
                    }))}
                  >
                    {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                      <option key={day} value={day}>
                        {t("analysisScheduleDayOption", { day })}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="business-dna-schedule-time">{t("analysisScheduleTime")}</label>
                  <input
                    id="business-dna-schedule-time"
                    type="time"
                    value={schedule.time}
                    disabled={saving}
                    onChange={(event) => setSchedule((current) => ({
                      ...current,
                      time: event.target.value,
                    }))}
                  />
                </div>
              </div>

              <div className={styles.preview} aria-live="polite">
                <span aria-hidden className={styles.previewIcon}>✦</span>
                <span className={styles.previewCopy}>
                  <strong>
                    {schedule.enabled
                      ? t("analysisScheduleEnabledSummary", {
                          day: schedule.dayOfMonth,
                          time: schedule.time.replace(":", "h"),
                        })
                      : t("analysisScheduleDisabledSummary")}
                  </strong>
                  <span>
                    {schedule.enabled && formattedNextRun
                      ? t("analysisScheduleNext", { date: formattedNextRun })
                      : t("analysisScheduleDisabledHint")}
                  </span>
                </span>
              </div>

              <p className={styles.quotaNote}>{t("analysisScheduleQuotaHint")}</p>

              {error ? (
                <div className={styles.error} role="alert">
                  <span>{error}</span>
                  <button
                    type="button"
                    className={styles.retryButton}
                    disabled={saving}
                    onClick={() => setLoadAttempt((current) => current + 1)}
                  >
                    {t("retry")}
                  </button>
                </div>
              ) : null}
            </div>

            <footer className={styles.footer}>
              <button
                type="button"
                className={styles.cancelButton}
                disabled={saving}
                onClick={onClose}
              >
                {t("analysisScheduleCancel")}
              </button>
              <button
                type="button"
                className={styles.saveButton}
                disabled={saving || Boolean(error)}
                aria-busy={saving}
                onClick={() => void save()}
              >
                {saving ? t("analysisScheduleSaving") : t("analysisScheduleSave")}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
