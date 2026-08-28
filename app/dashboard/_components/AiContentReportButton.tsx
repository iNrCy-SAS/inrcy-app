"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import styles from "./AiContentReportButton.module.css";

type AiContentReportButtonProps = {
  surface: string;
  content?: string;
  className?: string;
};

type ReportState = "idle" | "sending" | "sent" | "error";

export default function AiContentReportButton({ surface, content = "", className = "" }: AiContentReportButtonProps) {
  const t = useTranslations("shell");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("offensive");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<ReportState>("idle");
  const [error, setError] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function showDialog() {
    setReason("offensive");
    setComment("");
    setError("");
    setStatus("idle");
    setOpen(true);
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError("");

    try {
      const response = await fetch("/api/content-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          surface,
          reason,
          comment,
          contentExcerpt: content.slice(0, 4000),
          sourceUrl: window.location.href,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || t("ai_report_send_failed"));
      setStatus("sent");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : t("ai_report_generic_error"));
      setStatus("error");
    }
  }

  const dialog = open ? (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) setOpen(false);
    }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="ai-report-title">
        <button className={styles.closeButton} type="button" onClick={() => setOpen(false)} aria-label={t("ai_report_close")}>×</button>
        {status === "sent" ? (
          <div className={styles.success} role="status">
            <span className={styles.successIcon} aria-hidden="true">✓</span>
            <h2 id="ai-report-title">{t("ai_report_sent_title")}</h2>
            <p>{t("ai_report_sent_body")}</p>
            <button className={styles.primaryButton} type="button" onClick={() => setOpen(false)}>{t("ai_report_close")}</button>
          </div>
        ) : (
          <form onSubmit={submitReport}>
            <span className={styles.eyebrow}>iNrCy</span>
            <h2 id="ai-report-title">{t("ai_report_dialog_title")}</h2>
            <p className={styles.intro}>{t("ai_report_dialog_intro")}</p>

            <label className={styles.field}>
              <span>{t("ai_report_reason_label")}</span>
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="offensive">{t("ai_report_reason_offensive")}</option>
                <option value="unsafe">{t("ai_report_reason_unsafe")}</option>
                <option value="false_information">{t("ai_report_reason_false_information")}</option>
                <option value="copyright">{t("ai_report_reason_copyright")}</option>
                <option value="other">{t("ai_report_reason_other")}</option>
              </select>
            </label>

            <label className={styles.field}>
              <span>{t("ai_report_details_label")}</span>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} maxLength={2000} placeholder={t("ai_report_details_placeholder")} />
            </label>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <div className={styles.actions}>
              <button className={styles.secondaryButton} type="button" onClick={() => setOpen(false)}>{t("ai_report_cancel")}</button>
              <button className={styles.primaryButton} type="submit" disabled={status === "sending"}>{status === "sending" ? t("ai_report_sending") : t("ai_report_send")}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  ) : null;

  return (
    <>
      <button className={`${styles.reportButton} ${className}`.trim()} type="button" onClick={showDialog} title={t("ai_report_button_title")}>
        <span aria-hidden="true">⚑</span> {t("ai_report_button_label")}
      </button>
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
