"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import styles from "./AdsCampaignDemoDialog.module.css";

export type AdsCampaignDemoDialogDetails = {
  campaignName: string;
  channelLabel: string;
  accountName: string;
  accountId: string;
};

type Props = {
  mode: "confirm" | "success";
  details: AdsCampaignDemoDialogDetails;
  busy: boolean;
  declarationLabel: string;
  declarationChecked: boolean;
  onDeclarationChange: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onReturnHome: () => void;
};

export default function AdsCampaignDemoDialog({ mode, details, busy, declarationLabel, declarationChecked, onDeclarationChange, onCancel, onConfirm, onReturnHome }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const declarationRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

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
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="ads-demo-dialog-title" aria-describedby="ads-demo-dialog-description" tabIndex={-1}>
        <div className={styles.header}>
          <span className={styles.brandMark} aria-hidden="true">✦</span>
          <div className={styles.brand}>iNr’<span>ADS</span><small>STUDIO DE CAMPAGNE</small></div>
          {mode === "confirm" && <button type="button" className={styles.close} onClick={onCancel} disabled={busy} aria-label="Annuler la création de la démo">×</button>}
        </div>
        <div className={styles.content}>
          <span className={styles.eyebrow}>{mode === "confirm" ? "VOTRE VALIDATION" : "DÉMO CRÉÉE"}</span>
          <h2 id="ads-demo-dialog-title">{mode === "confirm" ? "Créer votre démo en pause ?" : "Votre démo est créée en pause."}</h2>
          <p id="ads-demo-dialog-description">{mode === "confirm"
            ? "Vérifiez la campagne et le compte associé avant de confirmer. La création sur la plateforme se fera en pause, sans activation ni dépense."
            : "La campagne a été enregistrée dans iNrCy et créée en pause sur la plateforme. Aucune diffusion ni dépense n’a été lancée."}</p>
          <dl className={styles.summary}>
            <div><dt>Campagne</dt><dd>{details.campaignName}</dd></div>
            <div><dt>Canal</dt><dd>{details.channelLabel}</dd></div>
            <div><dt>Compte annonceur</dt><dd>{details.accountName}<small>{details.accountId}</small></dd></div>
            <div><dt>Statut</dt><dd className={styles.paused}>En pause · aucune dépense</dd></div>
          </dl>
          {mode === "confirm" && <label className={styles.declaration}>
            <input ref={declarationRef} type="checkbox" checked={declarationChecked} onChange={(event) => onDeclarationChange(event.target.checked)} disabled={busy} />
            <span>{declarationLabel}<small>Cette déclaration est requise avant la création sur la plateforme.</small></span>
          </label>}
          {mode === "success" && <p className={styles.verification}>Vérifiez également le statut de la campagne dans votre compte publicitaire.</p>}
          <div className={styles.actions}>
            {mode === "confirm" ? <>
              <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>Annuler</button>
              <button ref={primaryRef} type="button" className={styles.primary} onClick={onConfirm} disabled={busy || !declarationChecked}>{busy ? "Création en cours…" : "Confirmer la démo en pause"}</button>
            </> : <button ref={primaryRef} type="button" className={styles.primary} onClick={onReturnHome}>Retour à l’accueil iNr’ADS <span aria-hidden="true">→</span></button>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
