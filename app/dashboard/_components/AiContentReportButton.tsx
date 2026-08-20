"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "next-intl";

import styles from "./AiContentReportButton.module.css";

type AiContentReportButtonProps = {
  surface: string;
  content?: string;
  className?: string;
};

type ReportState = "idle" | "sending" | "sent" | "error";

export default function AiContentReportButton({ surface, content = "", className = "" }: AiContentReportButtonProps) {
  const locale = useLocale();
  const isFrench = locale.toLowerCase().startsWith("fr");
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
      if (!response.ok) throw new Error(result?.message || (isFrench ? "Envoi impossible." : "Unable to send report."));
      setStatus("sent");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : (isFrench ? "Une erreur est survenue." : "An error occurred."));
      setStatus("error");
    }
  }

  const dialog = open ? (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) setOpen(false);
    }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="ai-report-title">
        <button className={styles.closeButton} type="button" onClick={() => setOpen(false)} aria-label={isFrench ? "Fermer" : "Close"}>×</button>
        {status === "sent" ? (
          <div className={styles.success} role="status">
            <span className={styles.successIcon} aria-hidden="true">✓</span>
            <h2 id="ai-report-title">{isFrench ? "Signalement envoyé" : "Report sent"}</h2>
            <p>{isFrench ? "Merci. L’équipe iNrCy va examiner ce contenu." : "Thank you. The iNrCy team will review this content."}</p>
            <button className={styles.primaryButton} type="button" onClick={() => setOpen(false)}>{isFrench ? "Fermer" : "Close"}</button>
          </div>
        ) : (
          <form onSubmit={submitReport}>
            <span className={styles.eyebrow}>iNrCy</span>
            <h2 id="ai-report-title">{isFrench ? "Signaler ce contenu" : "Report this content"}</h2>
            <p className={styles.intro}>{isFrench ? "Indiquez pourquoi ce contenu généré vous paraît inapproprié." : "Tell us why this generated content seems inappropriate."}</p>

            <label className={styles.field}>
              <span>{isFrench ? "Motif" : "Reason"}</span>
              <select value={reason} onChange={(event) => setReason(event.target.value)}>
                <option value="offensive">{isFrench ? "Contenu offensant ou inapproprié" : "Offensive or inappropriate content"}</option>
                <option value="unsafe">{isFrench ? "Contenu dangereux" : "Unsafe content"}</option>
                <option value="false_information">{isFrench ? "Information fausse ou trompeuse" : "False or misleading information"}</option>
                <option value="copyright">{isFrench ? "Droit d’auteur ou marque" : "Copyright or trademark"}</option>
                <option value="other">{isFrench ? "Autre" : "Other"}</option>
              </select>
            </label>

            <label className={styles.field}>
              <span>{isFrench ? "Précisions (facultatif)" : "Details (optional)"}</span>
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} maxLength={2000} placeholder={isFrench ? "Expliquez brièvement le problème…" : "Briefly describe the issue…"} />
            </label>

            {error ? <p className={styles.error} role="alert">{error}</p> : null}

            <div className={styles.actions}>
              <button className={styles.secondaryButton} type="button" onClick={() => setOpen(false)}>{isFrench ? "Annuler" : "Cancel"}</button>
              <button className={styles.primaryButton} type="submit" disabled={status === "sending"}>{status === "sending" ? (isFrench ? "Envoi…" : "Sending…") : (isFrench ? "Envoyer" : "Send")}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  ) : null;

  return (
    <>
      <button className={`${styles.reportButton} ${className}`.trim()} type="button" onClick={showDialog} title={isFrench ? "Signaler un contenu généré inapproprié" : "Report inappropriate generated content"}>
        <span aria-hidden="true">⚑</span> {isFrench ? "Signaler" : "Report"}
      </button>
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
