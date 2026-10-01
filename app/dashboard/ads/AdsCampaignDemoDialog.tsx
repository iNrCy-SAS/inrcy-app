"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nextAdsPublicationProgress, type AdsPublicationPhase } from "@/lib/adsPublicationProgress";

import styles from "./AdsCampaignDemoDialog.module.css";

export type AdsCampaignDemoDialogDetails = {
  campaignName: string;
  channelLabel: string;
  accountName: string;
  accountId: string;
  dailyBudgetEuros: number;
  endDate: string;
};

export type AdsCampaignLaunchStatus = "active" | "paused";

type Props = {
  mode: "confirm" | "success";
  details: AdsCampaignDemoDialogDetails;
  busy: boolean;
  publicationPhase: AdsPublicationPhase;
  declarationLabel: string;
  declarationChecked: boolean;
  launchStatus: AdsCampaignLaunchStatus;
  activeEnabled: boolean;
  pausedEnabled: boolean;
  activeDisabledReason?: string;
  onDeclarationChange: (checked: boolean) => void;
  onLaunchStatusChange: (status: AdsCampaignLaunchStatus) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onReturnHome: () => void;
};

export default function AdsCampaignDemoDialog({ mode, details, busy, publicationPhase, declarationLabel, declarationChecked, launchStatus, activeEnabled, pausedEnabled, activeDisabledReason, onDeclarationChange, onLaunchStatusChange, onCancel, onConfirm, onReturnHome }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const declarationRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [waitingProgress, setWaitingProgress] = useState(0);
  const progress = mode === "success" && publicationPhase === "success"
    ? 100
    : Math.max(publicationPhase === "sending" ? 12 : 1, Math.min(99, waitingProgress));
  const progressLabel = publicationPhase === "saving" ? "Préparation" : "Envoi";

  useEffect(() => {
    if (!busy || (publicationPhase !== "saving" && publicationPhase !== "sending")) return;
    const timer = window.setInterval(() => {
      setWaitingProgress((current) => nextAdsPublicationProgress(current, publicationPhase));
    }, 850);
    return () => window.clearInterval(timer);
  }, [busy, publicationPhase]);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const underlyingDialog = document.querySelector<HTMLElement>('[data-dashboard-settings-modal="true"]');
    const wasInert = underlyingDialog?.inert ?? false;
    const priorAriaHidden = underlyingDialog?.getAttribute("aria-hidden");
    if (underlyingDialog) {
      underlyingDialog.inert = true;
      underlyingDialog.setAttribute("aria-hidden", "true");
    }
    return () => {
      if (underlyingDialog) {
        underlyingDialog.inert = wasInert;
        if (priorAriaHidden == null) underlyingDialog.removeAttribute("aria-hidden");
        else underlyingDialog.setAttribute("aria-hidden", priorAriaHidden);
      }
      openerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (busy) dialogRef.current?.focus();
    else if (mode === "confirm" && !declarationChecked) declarationRef.current?.focus();
    else primaryRef.current?.focus();
  }, [busy, mode, declarationChecked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mode === "confirm" && !busy) {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || []).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, mode, onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.overlay}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="ads-launch-dialog-title" aria-describedby="ads-launch-dialog-description" tabIndex={-1}>
        <div className={styles.header}>
          <span className={styles.brandMark} aria-hidden="true">✦</span>
          <div className={styles.brand}>iNr’<span>ADS</span><small>STUDIO DE CAMPAGNE</small></div>
          {mode === "confirm" && <button type="button" className={styles.close} onClick={onCancel} disabled={busy} aria-label="Annuler le lancement de la campagne">×</button>}
        </div>
        <div className={styles.content}>
          <span className={styles.eyebrow}>{mode === "confirm" ? "VALIDATION FINALE" : "CAMPAGNE CRÉÉE"}</span>
          <h2 id="ads-launch-dialog-title">{mode === "confirm" ? "Lancer cette campagne ?" : launchStatus === "active" ? "Votre campagne est lancée." : "Votre campagne est créée en pause."}</h2>
          <p id="ads-launch-dialog-description">{mode === "confirm"
            ? "Vérifiez le compte et choisissez le statut appliqué au moment de la création sur la plateforme publicitaire."
            : launchStatus === "active"
              ? "La campagne a été créée et activée sur la plateforme. Sa diffusion reste soumise à la validation de la régie."
              : "La campagne a été créée en pause sur la plateforme. Aucune diffusion ni dépense n’a été lancée."}</p>
          <dl className={styles.summary}>
            <div><dt>Campagne</dt><dd>{details.campaignName}</dd></div>
            <div><dt>Canal</dt><dd>{details.channelLabel}</dd></div>
            <div><dt>Compte annonceur</dt><dd>{details.accountName}<small>{details.accountId}</small></dd></div>
            <div><dt>Budget autorisé</dt><dd>{details.dailyBudgetEuros.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} / jour<small>Jusqu’au {new Date(`${details.endDate}T12:00:00`).toLocaleDateString("fr-FR")}</small></dd></div>
            {mode === "success" && <div><dt>Statut</dt><dd className={launchStatus === "active" ? styles.active : styles.paused}>{launchStatus === "active" ? "Active · diffusion autorisée" : "En pause · aucune diffusion"}</dd></div>}
          </dl>
          {mode === "confirm" && <fieldset className={styles.statusChoice}>
            <legend>Statut au lancement</legend>
            <label data-selected={launchStatus === "active" || undefined} data-disabled={!activeEnabled || undefined}>
              <input type="radio" name="ads-launch-status" value="active" checked={launchStatus === "active"} disabled={busy || !activeEnabled} onChange={() => onLaunchStatusChange("active")} />
              <span><strong>Active</strong><small>{activeEnabled ? "La campagne pourra être diffusée et engager des dépenses dès qu’elle aura été validée par la plateforme." : activeDisabledReason || "Ce compte n’est pas encore autorisé à lancer une diffusion active."}</small></span>
            </label>
            <label data-selected={launchStatus === "paused" || undefined} data-disabled={!pausedEnabled || undefined}>
              <input type="radio" name="ads-launch-status" value="paused" checked={launchStatus === "paused"} disabled={busy || !pausedEnabled} onChange={() => onLaunchStatusChange("paused")} />
              <span><strong>En pause</strong><small>La campagne est créée sans diffusion ni dépense et pourra être activée plus tard.</small></span>
            </label>
          </fieldset>}
          {mode === "confirm" && <label className={styles.declaration}>
            <input ref={declarationRef} type="checkbox" checked={declarationChecked} onChange={(event) => onDeclarationChange(event.target.checked)} disabled={busy} />
            <span>{declarationLabel}<small>Cette déclaration est requise avant la création sur la plateforme.</small></span>
          </label>}
        </div>
        <div className={styles.actions}>
            {mode === "confirm" ? <>
              <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>Annuler</button>
              <button ref={primaryRef} type="button" className={styles.primary} onClick={onConfirm} aria-busy={busy} aria-label={busy ? `${progressLabel} en cours, progression indicative : ${progress} pour cent` : undefined} disabled={busy || !declarationChecked || (launchStatus === "active" ? !activeEnabled : !pausedEnabled)}>{busy ? <>{progressLabel}… <span className={styles.progress}>{progress} %</span></> : launchStatus === "active" ? "Confirmer et lancer" : "Confirmer en pause"}</button>
            </> : <button ref={primaryRef} type="button" className={styles.primary} onClick={onReturnHome}><span className={styles.progress}>{progress} %</span> Retour à l’accueil iNr’ADS <span aria-hidden="true">→</span></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
