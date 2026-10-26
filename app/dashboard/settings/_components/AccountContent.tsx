"use client";

import { useLocale, useTranslations } from "next-intl";


import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabaseClient";
import type { DashboardEdition } from "@/lib/dashboardEdition";
import { evaluatePassword } from "@/lib/passwordPolicy";
import { getTemporaryPasswordMetadata } from "@/lib/temporaryPasswordPolicy";
import styles from "./settingsContentLayout.module.css";
import accountStyles from "./AccountContent.module.css";

type Props = {
  mode?: "page" | "drawer";
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  edition?: DashboardEdition;
  onOpenSubscription?: () => void;
};

type AccountSubscriptionSummary = {
  plan?: string | null;
  status?: string | null;
  trial_end_at?: string | null;
  next_renewal_date?: string | null;
  cancel_requested_at?: string | null;
  end_date?: string | null;
};

function formatSubscriptionDate(value: string | null | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function accountPlanPresentation(
  edition: DashboardEdition,
  subscription: AccountSubscriptionSummary | null,
  i18nT: (key: string) => string,
  locale: string,
) {
  const status = String(subscription?.status ?? "").trim().toLowerCase();
  const statusView =
    status === "trialing"
      ? { label: i18nT("essai_21_jours_3095df3f"), color: "#8feaff" }
      : status === "active"
        ? { label: i18nT("actif_2eb75f84"), color: "#8ff7d0" }
        : status === "past_due" || status === "unpaid"
          ? { label: i18nT("a_regulariser_7046f900"), color: "#ffd38f" }
          : status === "trial_expired"
            ? { label: i18nT("essai_termine_be984f1c"), color: "#ffbd8f" }
            : status === "canceled" || status === "cancelled"
              ? { label: i18nT("resilie_1ca48fe3"), color: "#ff9bbd" }
              : { label: i18nT("a_verifier_8f5f7255"), color: "#c8d3ef" };

  const plan = String(subscription?.plan ?? "").trim().toLowerCase();
  const label =
    plan === "trial"
      ? "iNrCy Trial"
      : plan === "founder"
        ? "iNrCy Founder"
      : edition === "basic"
      ? `iNrCy ${i18nT("subscription_basic_name")}`
      : edition === "standard"
      ? i18nT("inrcy_standard_1dd18060")
      : edition === "founder"
        ? "iNrCy Founder"
        : i18nT("inrcy_premium_4c7d39c1");
  const description =
    edition === "basic"
      ? i18nT("subscription_basic_pitch")
      : edition === "standard"
      ? i18nT("booster_sur_10_canaux_inr_apos_38a43414")
      : edition === "founder"
        ? i18nT("passez_du_pilotage_de_votre_visibilite_37fbfe56")
        : i18nT("passez_du_pilotage_de_votre_visibilite_37fbfe56");

  const trialEnd = formatSubscriptionDate(subscription?.trial_end_at, locale);
  const renewal = formatSubscriptionDate(subscription?.next_renewal_date, locale);
  const accessEnd = formatSubscriptionDate(subscription?.end_date, locale);
  const detail =
    status === "trialing" && trialEnd
      ? `${i18nT("fin_de_votre_essai_f1bae9e9")} ${trialEnd}`
      : subscription?.cancel_requested_at && accessEnd
        ? `${i18nT("votre_acces_restera_actif_jusqu_au_1da564dd")} ${accessEnd}`
        : renewal
          ? `${i18nT("prochaine_echeance_97d55f4d")} ${renewal}`
          : null;

  return { label, description, detail, statusView };
}

function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={accountStyles.passwordRule} data-satisfied={ok}>
      <span aria-hidden="true">{ok ? "●" : "○"}</span>
      <span>{label}</span>
    </span>
  );
}

function AccountIcon({ kind }: { kind: "identity" | "security" | "plan" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === "identity" ? <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></> : null}
      {kind === "security" ? <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><rect x="9" y="10" width="6" height="6" rx="1" /><path d="M10 10V8a2 2 0 0 1 4 0v2" /></> : null}
      {kind === "plan" ? <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></> : null}
    </svg>
  );
}

export default function AccountContent({
  mode: _mode = "page",
  onUnsavedChange,
  edition = "premium",
  onOpenSubscription,
}: Props) {
  const i18nT = useTranslations("settings");
  const passwordT = useTranslations("auth.password");
  const locale = useLocale();
  const accountId = useId();
  const [email, setEmail] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
  const [temporaryPasswordExpiresAt, setTemporaryPasswordExpiresAt] = useState<string | null>(null);
  const [subscriptionSummary, setSubscriptionSummary] = useState<AccountSubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [ok, setOk] = useState<string>("");

  useEffect(() => {
    onUnsavedChange?.(Boolean(currentPassword || newPassword || confirm));
  }, [confirm, currentPassword, newPassword, onUnsavedChange]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setMsg("");
      setOk("");
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();
        if (error) throw new Error(error.message);
        const user = data.user;
        setEmail(user?.email || "");
        setTemporaryPasswordExpiresAt(getTemporaryPasswordMetadata(user?.app_metadata)?.expires_at || null);
        if (user) {
          const { data: subscriptionData } = await supabase
            .from("subscriptions")
            .select("plan,status,trial_end_at,next_renewal_date,cancel_requested_at,end_date")
            .eq("user_id", user.id)
            .maybeSingle();
          setSubscriptionSummary((subscriptionData as AccountSubscriptionSummary | null) ?? null);
        }
        const raw = (data.user as any)?.created_at as string | undefined;
        if (raw) {
          const d = new Date(raw);
          setCreatedAt(
            Number.isFinite(d.getTime()) ? d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }) : ""
          );
        }
      } catch (e: unknown) {
        console.error(e);
        setMsg(passwordT("accountLoadFailed"));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [locale, passwordT]);

  const strength = useMemo(() => evaluatePassword(newPassword), [newPassword]);
  const canSubmit = !busy && !!currentPassword && !!newPassword && newPassword === confirm && strength.isAcceptable;
  const planPresentation = useMemo(
    () => accountPlanPresentation(edition, subscriptionSummary, i18nT, locale),
    [edition, subscriptionSummary, i18nT, locale],
  );

  async function onChangePassword() {
    setMsg("");
    setOk("");
    if (!currentPassword) {
      setMsg(passwordT("currentRequired"));
      return;
    }
    if (!strength.isStrong) {
      setMsg(passwordT("tooWeak"));
      return;
    }
    if (newPassword !== confirm) {
      setMsg(passwordT("mismatch"));
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();

      const response = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, password: newPassword }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (result.code === "current_password_incorrect") {
          setMsg(passwordT("currentIncorrect"));
          return;
        }
        throw new Error("password_update_failed");
      }
      if (result.requires_login) window.location.assign(`/login?email=${encodeURIComponent(email)}`);
      else await supabase.auth.getUser();

      setOk(passwordT("updateSuccess"));
      setTemporaryPasswordExpiresAt(null);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (e: unknown) {
      console.error(e);
      setMsg(passwordT("updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className={accountStyles.loading} role="status">{i18nT("chargement_01cba1df")}</div>;

  return (
    <div className={styles.workspace}>
      <div className={accountStyles.stack}>
        <div className={accountStyles.overview}>
          <section className={accountStyles.identityCard} aria-labelledby={`${accountId}-identity`}>
            <div className={accountStyles.cardHeading}>
              <span className={accountStyles.identityIcon}><AccountIcon kind="identity" /></span>
              <div>
                <h2 id={`${accountId}-identity`}>{i18nT("identifiants_7e7dc904")}</h2>
                {createdAt ? (
                  <p className={accountStyles.createdAt}><span>{i18nT("date_de_creation_d5e8d1af")}</span><strong>{createdAt}</strong></p>
                ) : null}
              </div>
            </div>
            <p className={accountStyles.description}>{i18nT("votre_email_de_connexion_est_affiche_84123fc4")}</p>
            <label className={accountStyles.field} htmlFor={`${accountId}-email`}>
              <span>{i18nT("mail_92379cbb")}</span>
              <input id={`${accountId}-email`} className={accountStyles.input} value={email} readOnly />
            </label>
          </section>

          <section className={accountStyles.planCard} aria-labelledby={`${accountId}-plan`}>
            <div className={accountStyles.planHeading}>
              <span className={accountStyles.planIcon}><AccountIcon kind="plan" /></span>
              <div className={accountStyles.planName}>
                <span>{i18nT("votre_forfait_6d06f631")}</span>
                <h2 id={`${accountId}-plan`}>{planPresentation.label}</h2>
              </div>
              <span className={accountStyles.planStatus} style={{ "--account-status": planPresentation.statusView.color } as CSSProperties}>
                <i aria-hidden="true" />{planPresentation.statusView.label}
              </span>
            </div>
            <p className={accountStyles.planDescription}>{planPresentation.description}</p>
            {planPresentation.detail ? <p className={accountStyles.planDetail}>{planPresentation.detail}</p> : null}
            {onOpenSubscription ? (
              <button type="button" onClick={onOpenSubscription} className={accountStyles.planButton}>{i18nT("voir_mon_abonnement_d5b2da25")}</button>
            ) : (
              <a href="/dashboard?panel=abonnement&panelSource=settings" className={accountStyles.planButton}>{i18nT("voir_mon_abonnement_d5b2da25")}</a>
            )}
          </section>
        </div>

        <section className={accountStyles.securityCard} aria-labelledby={`${accountId}-security`}>
          <div className={accountStyles.cardHeading}>
            <span className={accountStyles.securityIcon}><AccountIcon kind="security" /></span>
            <h2 id={`${accountId}-security`}>{i18nT("modifier_le_mot_de_passe_b6eec6a6")}</h2>
          </div>
          {temporaryPasswordExpiresAt ? (
            <p className={accountStyles.description} role="status">
              {passwordT("temporaryPasswordNotice", { date: new Date(temporaryPasswordExpiresAt).toLocaleDateString(locale) })}
            </p>
          ) : null}
          <div className={accountStyles.passwordFields}>
            <label className={`${accountStyles.field} ${accountStyles.fullWidth}`} htmlFor={`${accountId}-current`}>
              <span>{i18nT("mot_de_passe_actuel_f9242976")}</span>
              <input id={`${accountId}-current`} className={accountStyles.input} type="password" value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            </label>
            <label className={accountStyles.field} htmlFor={`${accountId}-new`}>
              <span>{i18nT("nouveau_mot_de_passe_3a713829")}</span>
              <input id={`${accountId}-new`} className={accountStyles.input} type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </label>
            <label className={accountStyles.field} htmlFor={`${accountId}-confirm`}>
              <span>{i18nT("confirmer_le_mot_de_passe_88362d0d")}</span>
              <input id={`${accountId}-confirm`} className={accountStyles.input} type="password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </label>
            <div className={`${accountStyles.passwordRules} ${accountStyles.fullWidth}`}>
              <Rule ok={strength.rules.minLen} label={i18nT("8_caracteres_85066a4b")} />
              <Rule ok={strength.rules.hasLetter} label={i18nT("1_lettre_2147bd0b")} />
              <Rule ok={strength.rules.hasNumber} label={i18nT("1_chiffre_6d6bd070")} />
              <Rule ok={strength.rules.hasUpper} label={i18nT("1_majuscule_6f8fac24")} />
              <Rule ok={strength.rules.hasSymbol} label={i18nT("1_symbole_412b784c")} />
            </div>
            <button className={`${accountStyles.primaryButton} ${accountStyles.fullWidth}`} type="button" onClick={onChangePassword}
              disabled={!canSubmit} aria-busy={busy || undefined}>
              {i18nT("modifier_le_mot_de_passe_b6eec6a6")}
            </button>
            {msg ? <p className={`${accountStyles.feedback} ${accountStyles.fullWidth}`} role="alert">⚠️ {msg}</p> : null}
            {ok ? <p className={`${accountStyles.feedback} ${accountStyles.success} ${accountStyles.fullWidth}`} role="status">{ok}</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
