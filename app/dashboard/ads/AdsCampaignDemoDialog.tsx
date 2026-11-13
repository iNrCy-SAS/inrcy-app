"use client";

import { useLocale, useTranslations } from "next-intl";


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
  googleBudget?: { type: "daily" | "total"; totalEuros: number | null; startDate: string | null; timeZone: string };
  pinterestBudget?: { type: "daily" | "total"; totalEuros: number | null; startAt: string | null; endAt: string; timeZone: string; flexibleDaily: boolean };
  nativeBudget?: { type: "daily" | "total"; totalEuros: number | null; startAt: string | null; endAt: string; timeZone: string };
  linkedinBudget?: { type: "daily" | "total"; totalEuros: number | null; startAt: string | null; endAt: string };
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
  const i18nT = useTranslations("booster");
  const locale = useLocale();
  const nativeBudget = details.nativeBudget || details.linkedinBudget || details.googleBudget || details.pinterestBudget;
  const nativeCalendar = details.nativeBudget;
  const googleBudget = details.googleBudget;
  const linkedinBudget = details.linkedinBudget;
  const pinterestBudget = details.pinterestBudget;
  const formatInstant = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const declarationRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [waitingProgress, setWaitingProgress] = useState(0);
  const progress = mode === "success" && publicationPhase === "success"
    ? 100
    : Math.max(publicationPhase === "sending" ? 12 : 1, Math.min(99, waitingProgress));
  const progressLabel = publicationPhase === "saving" ? i18nT("wizard_step_channels") : i18nT("ads_sending");

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
          <div className={styles.brand}>{i18nT("inr_cb7c9950")}<span>{i18nT("ads_ui_0d1c315edb")}</span><small>{i18nT("studio_de_campagne_e15f8c54")}</small></div>
          {mode === "confirm" && <button type="button" className={styles.close} onClick={onCancel} disabled={busy} aria-label={i18nT("annuler_le_lancement_de_la_campagne_3a0d1b92")}>×</button>}
        </div>
        <div className={styles.content}>
          <span className={styles.eyebrow}>{mode === "confirm" ? i18nT("validation_finale_3d6f0309") : i18nT("campagne_creee_df2af619")}</span>
          <h2 id="ads-launch-dialog-title">{mode === "confirm" ? i18nT("lancer_cette_campagne_8d9bbce4") : launchStatus === "active" ? i18nT("votre_campagne_est_lancee_076a0840") : i18nT("votre_campagne_est_creee_en_pause_68ec4c5c")}</h2>
          <p id="ads-launch-dialog-description">{mode === "confirm"
            ? i18nT("verifiez_le_compte_et_choisissez_le_2f54398b")
            : launchStatus === "active"
              ? i18nT("la_campagne_a_ete_creee_et_c7f9b905")
              : i18nT("la_campagne_a_ete_creee_en_5e53dd36")}</p>
          <dl className={styles.summary}>
            <div><dt>{i18nT("campagne_53c2fc2a")}</dt><dd>{details.campaignName}</dd></div>
            <div><dt>{i18nT("canal_61f21e6f")}</dt><dd>{details.channelLabel}</dd></div>
            <div><dt>{i18nT("compte_annonceur_87bebaad")}</dt><dd>{details.accountName}<small>{details.accountId}</small></dd></div>
            <div><dt>{i18nT("budget_autorise_296950fc")}</dt><dd>{(nativeBudget?.type === "total" ? nativeBudget.totalEuros || 0 : details.dailyBudgetEuros).toLocaleString(locale, { style: "currency", currency: "EUR" })}{nativeBudget?.type === "total" ? i18nT("au_total_c8d2e40b") : i18nT("ads_ui_892bcf22ec")}<small>{nativeCalendar ? `${nativeCalendar.startAt ? new Date(nativeCalendar.startAt).toLocaleString(locale, { timeZone: nativeCalendar.timeZone }) : i18nT("ads_ui_899122fb1e")} → ${new Date(nativeCalendar.endAt).toLocaleString(locale, { timeZone: nativeCalendar.timeZone })} · ${nativeCalendar.timeZone}` : googleBudget ? `${googleBudget.startDate || i18nT("ads_ui_d5ac9b1a0c")} → ${details.endDate} · ${googleBudget.timeZone || i18nT("ads_ui_8c0f75415e")}${googleBudget.type === "daily" ? i18nT("ads_ui_c13aa3f32b") : ""}` : linkedinBudget ? `${linkedinBudget.startAt ? formatInstant(linkedinBudget.startAt) : i18nT("des_la_validation_de_linkedin_1f84bd29")} → ${formatInstant(linkedinBudget.endAt)}` : pinterestBudget ? `${pinterestBudget.startAt ? new Date(pinterestBudget.startAt).toLocaleString(locale, { timeZone: pinterestBudget.timeZone }) : i18nT("des_la_validation_de_pinterest_8f570560")} → ${new Date(pinterestBudget.endAt).toLocaleString(locale, { timeZone: pinterestBudget.timeZone })} · ${pinterestBudget.timeZone}${pinterestBudget.type === "daily" ? pinterestBudget.flexibleDaily ? i18nT("ads_ui_c13aa3f32b") : i18nT("ads_ui_242783fa36") : ""}` : i18nT("jusqu_au_value_bba1acea", { value0: new Date(`${details.endDate}T12:00:00`).toLocaleDateString(locale) })}</small></dd></div>
            {mode === "success" && <div><dt>{i18nT("statut_659499f3")}</dt><dd className={launchStatus === "active" ? styles.active : styles.paused}>{launchStatus === "active" ? i18nT("active_diffusion_autorisee_a77a019e") : i18nT("en_pause_aucune_diffusion_620f8f84")}</dd></div>}
          </dl>
          {mode === "confirm" && <fieldset className={styles.statusChoice}>
            <legend>{i18nT("statut_au_lancement_7489710b")}</legend>
            <label data-selected={launchStatus === "active" || undefined} data-disabled={!activeEnabled || undefined}>
              <input type="radio" name="ads-launch-status" value="active" checked={launchStatus === "active"} disabled={busy || !activeEnabled} onChange={() => onLaunchStatusChange("active")} />
              <span><strong>{i18nT("active_a733b809")}</strong><small>{activeEnabled ? i18nT("la_campagne_pourra_etre_diffusee_et_ce7f55b0") : activeDisabledReason || i18nT("ce_compte_n_est_pas_encore_c16c1342")}</small></span>
            </label>
            <label data-selected={launchStatus === "paused" || undefined} data-disabled={!pausedEnabled || undefined}>
              <input type="radio" name="ads-launch-status" value="paused" checked={launchStatus === "paused"} disabled={busy || !pausedEnabled} onChange={() => onLaunchStatusChange("paused")} />
              <span><strong>{i18nT("en_pause_3a366de4")}</strong><small>{i18nT("la_campagne_est_creee_sans_diffusion_e7e312b4")}</small></span>
            </label>
          </fieldset>}
          {mode === "confirm" && <label className={styles.declaration}>
            <input ref={declarationRef} type="checkbox" checked={declarationChecked} onChange={(event) => onDeclarationChange(event.target.checked)} disabled={busy} />
            <span>{declarationLabel}<small>{i18nT("cette_declaration_est_requise_avant_la_5cfc0496")}</small></span>
          </label>}
        </div>
        <div className={styles.actions}>
            {mode === "confirm" ? <>
              <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>{i18nT("annuler_49ba3292")}</button>
              <button ref={primaryRef} type="button" className={styles.primary} onClick={onConfirm} aria-busy={busy} aria-label={busy ? i18nT("value_en_cours_progression_indicative_value_12676698", { value0: progressLabel, value1: progress }) : undefined} disabled={busy || !declarationChecked || (launchStatus === "active" ? !activeEnabled : !pausedEnabled)}>{busy ? <>{progressLabel}… <span className={styles.progress}>{progress} %</span></> : launchStatus === "active" ? i18nT("confirmer_et_lancer_c0456e6e") : i18nT("confirmer_en_pause_2ca8c5ba")}</button>
            </> : <button ref={primaryRef} type="button" className={styles.primary} onClick={onReturnHome}><span className={styles.progress}>{progress} %</span> {" "}{i18nT("retour_a_l_accueil_inr_ads_a2d24c46")}{" "}<span aria-hidden="true">→</span></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
