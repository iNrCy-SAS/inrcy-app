"use client";
import { getClientUserFacingErrorMessage as getSafeClientErrorMessage } from "@/lib/userFacingErrors";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import { createClient } from "@/lib/supabaseClient";
import { purgeAllBrowserAccountCaches, setActiveBrowserUserId } from "@/lib/browserAccountCache";
import { openNativeSubscriptionManagement } from "@/lib/nativeBillingManagement";

import styles from "./suppression-compte.module.css";

type RequestType = "account" | "partial";
type AuthView = "loading" | "anonymous" | "authenticated" | "error";
type Action = "end_of_access" | "immediate" | "partial" | "cancel_scheduled";
type NativeProvider = "app_store" | "play_store";

type SubscriptionState = {
  plan?: string | null;
  status?: string | null;
  billing_provider?: string | null;
  billing_cycle?: string | null;
  next_renewal_date?: string | null;
  end_date?: string | null;
  cancel_requested_at?: string | null;
  native_expires_at?: string | null;
  native_will_renew?: boolean | null;
  access_end_date?: string | null;
};

type DeletionState = {
  mode?: "end_of_access" | "immediate" | null;
  status?: "scheduled" | "processing" | "completed" | "cancelled" | "failed" | null;
  scheduled_for?: string | null;
  billing_provider?: string | null;
};

type AccountState = {
  email: string | null;
  subscription: SubscriptionState | null;
  deletion: DeletionState | null;
};

const PARTIAL_OPTIONS = [
  { value: "generated_content", labelKey: "public.deletion_partial_generated_content" },
  { value: "contacts", labelKey: "public.deletion_partial_contacts" },
  { value: "connections", labelKey: "public.deletion_partial_connections" },
  { value: "documents", labelKey: "public.deletion_partial_documents" },
  { value: "activity", labelKey: "public.deletion_partial_activity" },
] as const;

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

async function apiError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string; code?: string; provider?: string } | null;
  const error = new Error(getSafeClientErrorMessage(body, fallback)) as Error & { code?: string; provider?: string };
  error.code = body?.code;
  error.provider = body?.provider;
  return error;
}

export default function DeletionRequestForm() {
  const t = useTranslations();
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<AuthView>("loading");
  const [account, setAccount] = useState<AccountState | null>(null);
  const [busy, setBusy] = useState<Action | "native" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [nativeProvider, setNativeProvider] = useState<NativeProvider | null>(null);
  const [partialCategories, setPartialCategories] = useState<string[]>([]);

  const [requestType, setRequestType] = useState<RequestType>("account");
  const [publicBusy, setPublicBusy] = useState(false);
  const [publicError, setPublicError] = useState("");
  const [publicDone, setPublicDone] = useState(false);

  const loadAccountState = useCallback(async () => {
    setError("");
    let data: { user: { email?: string | null } | null };
    try {
      const authResult = await supabase.auth.getUser();
      data = { user: authResult.data.user };
    } catch {
      // The public Google Play page must remain usable even if the optional
      // browser Supabase configuration is unavailable during a cold render.
      setAccount(null);
      setView("anonymous");
      return;
    }
    if (!data.user) {
      setAccount(null);
      setView("anonymous");
      return;
    }

    const response = await fetch("/api/account/deletion", {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) {
      setAccount(null);
      setView("anonymous");
      return;
    }
    if (!response.ok) throw await apiError(response, t("public.deletion_load_error"));

    const result = (await response.json()) as {
      user?: { email?: string | null };
      subscription?: SubscriptionState | null;
      deletion?: DeletionState | null;
    };
    setAccount({
      email: result.user?.email ?? data.user.email ?? null,
      subscription: result.subscription ?? null,
      deletion: result.deletion ?? null,
    });
    setView("authenticated");
  }, [supabase, t]);

  useEffect(() => {
    let active = true;
    loadAccountState().catch((caught) => {
      if (!active) return;
      setView("error");
      setError(getSafeClientErrorMessage(caught, t("public.deletion_page_error")));
    });
    return () => {
      active = false;
    };
  }, [loadAccountState, t]);

  async function runAuthenticatedAction(action: Action) {
    setBusy(action);
    setError("");
    setMessage("");
    setNativeProvider(null);

    const confirmationMessage =
      action === "immediate"
        ? t("public.deletion_confirmation_immediate")
        : action === "end_of_access"
          ? t("public.deletion_confirmation_end_access")
          : action === "partial"
            ? t("public.deletion_confirmation_partial", { count: partialCategories.length })
            : null;

    if (confirmationMessage) {
      const confirmed = window.confirm(confirmationMessage);
      if (!confirmed) {
        setBusy(null);
        return;
      }
    }

    try {
      const response = await fetch("/api/account/deletion", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          mode: action,
          ...(action === "partial" ? { categories: partialCategories } : {}),
        }),
      });
      if (!response.ok) throw await apiError(response, t("public.deletion_operation_error"));
      const result = (await response.json()) as {
        deleted?: boolean;
        scheduled_for?: string | null;
        end_date?: string | null;
      };

      if (result.deleted) {
        purgeAllBrowserAccountCaches();
        setActiveBrowserUserId(null);
        await supabase.auth.signOut({ scope: "local" }).catch(() => null);
        window.location.replace("/login");
        return;
      }

      if (action === "end_of_access") {
        setMessage(
          t("public.deletion_scheduled_notice", { date: formatDate(result.end_date || result.scheduled_for, locale) || t("public.deletion_end_date_fallback") }),
        );
      } else if (action === "cancel_scheduled") {
        setMessage(t("public.deletion_cancelled_notice"));
      } else {
        setMessage(t("public.deletion_partial_deleted_notice"));
        setPartialCategories([]);
      }
      await loadAccountState();
    } catch (caught) {
      const errorValue = caught as Error & { code?: string; provider?: string };
      if (errorValue.code === "NATIVE_MANAGEMENT_REQUIRED" && (errorValue.provider === "app_store" || errorValue.provider === "play_store")) {
        setNativeProvider(errorValue.provider);
      }
      setError(getSafeClientErrorMessage(errorValue, t("public.deletion_operation_error")));
    } finally {
      setBusy(null);
    }
  }

  async function openStoreManagement() {
    if (!nativeProvider) return;
    setBusy("native");
    setError("");
    try {
      await openNativeSubscriptionManagement(nativeProvider);
      setMessage(t("public.deletion_store_return_notice"));
    } catch (caught) {
      setError(getSafeClientErrorMessage(caught, t("public.deletion_store_error")));
    } finally {
      setBusy(null);
    }
  }

  function togglePartialCategory(value: string) {
    setPartialCategories((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function submitPublicRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPublicBusy(true);
    setPublicError("");
    const form = new FormData(event.currentTarget);
    const details = String(form.get("details") || "").trim();
    try {
      const response = await fetch("/api/public/privacy/deletion-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestType,
          fullName: String(form.get("fullName") || ""),
          email: String(form.get("email") || ""),
          details,
          website: String(form.get("website") || ""),
        }),
      });
      if (!response.ok) throw await apiError(response, t("public.deletion_request_error"));
      setPublicDone(true);
      event.currentTarget.reset();
    } catch (caught) {
      setPublicError(getSafeClientErrorMessage(caught, t("public.deletion_request_error")));
    } finally {
      setPublicBusy(false);
    }
  }

  if (view === "loading") {
    return <div className={styles.formCard}><p className={styles.loading}>{t("public.deletion_session_check")}</p></div>;
  }

  if (view === "error") {
    return (
      <div className={styles.formCard} role="alert">
        <h2>{t("public.deletion_privacy_space")}</h2>
        <p>{error || t("public.deletion_page_error")}</p>
        <button className={styles.secondaryButton} type="button" onClick={() => { setView("loading"); loadAccountState().catch((caught) => { setView("error"); setError(getSafeClientErrorMessage(caught, t("public.deletion_page_error"))); }); }}>
          {t("public.reessayer_895d416b")}
        </button>
      </div>
    );
  }

  if (view === "authenticated" && account) {
    const scheduled = account.deletion?.status === "scheduled";
    const accessEnd = account.subscription?.access_end_date || account.deletion?.scheduled_for;

    return (
      <div className={styles.formCard}>
        <div className={styles.accountHeader}>
          <div>
            <span className={styles.cardEyebrow}>{t("shell.compte_connecte_a442afe1")}</span>
            <h2>{t("public.deletion_manage_data")}</h2>
          </div>
          <span className={styles.emailBadge}>{account.email || t("public.deletion_account_fallback")}</span>
        </div>

        {scheduled ? (
          <section className={styles.scheduledBox}>
            <div className={styles.statusLine}><span className={styles.statusDot} /> {t("public.deletion_scheduled_status")}</div>
            <p>
              {t.rich("public.deletion_scheduled_help", { date: formatDate(account.deletion?.scheduled_for, locale) || t("public.deletion_end_date_fallback"), strong: chunks => <strong>{chunks}</strong> })}
            </p>
            <button className={styles.secondaryButton} type="button" onClick={() => runAuthenticatedAction("cancel_scheduled")} disabled={busy !== null}>
              {busy === "cancel_scheduled" ? t("mails.annulation_0cfb2a1c") : t("public.deletion_cancel_action")}
            </button>
          </section>
        ) : (
          <>
            <section className={styles.choiceCard}>
              <div className={styles.choiceTitle}><span className={styles.choiceIcon}>⌛</span><div><h3>{t("public.deletion_end_access_title")}</h3><span className={styles.recommended}>{t("media.ai_generator_model_recommended_short")}</span></div></div>
              <p>
                {t("public.deletion_end_access_description")}
              </p>
              {accessEnd ? <p className={styles.dateHint}>{t.rich("public.deletion_known_end_date", { date: formatDate(accessEnd, locale) || "", strong: chunks => <strong>{chunks}</strong> })}</p> : null}
              {nativeProvider === "app_store" || nativeProvider === "play_store" ? (
                <button className={styles.secondaryButton} type="button" onClick={openStoreManagement} disabled={busy !== null}>
                  {busy === "native" ? t("public.ouverture_3333ad14") : t("public.deletion_manage_store", { store: nativeProvider === "app_store" ? "App Store" : "Google Play" })}
                </button>
              ) : (
                <button className={styles.primaryButton} type="button" onClick={() => runAuthenticatedAction("end_of_access")} disabled={busy !== null}>
                  {busy === "end_of_access" ? t("public.deletion_scheduling") : t("public.deletion_schedule_action")}
                </button>
              )}
            </section>

            <section className={styles.choiceCard}>
              <div className={styles.choiceTitle}><span className={styles.choiceIcon}>×</span><div><h3>{t("public.deletion_immediate_title")}</h3></div></div>
              <p>{t("public.deletion_immediate_description")}</p>
              <button className={styles.quietDangerButton} type="button" onClick={() => runAuthenticatedAction("immediate")} disabled={busy !== null}>
                {busy === "immediate" ? t("mails.suppression_a620db43") : t("public.deletion_immediate_action")}
              </button>
            </section>

            <section className={styles.partialCard}>
              <div className={styles.choiceTitle}><span className={styles.choiceIcon}>⌘</span><div><h3>{t("public.deletion_partial_title")}</h3></div></div>
              <p>{t("public.deletion_partial_description")}</p>
              <div className={styles.checkGrid}>
                {PARTIAL_OPTIONS.map((option) => (
                  <label key={option.value} className={styles.checkItem}>
                    <input type="checkbox" checked={partialCategories.includes(option.value)} onChange={() => togglePartialCategory(option.value)} />
                    <span>{t(option.labelKey)}</span>
                  </label>
                ))}
              </div>
              <button className={styles.secondaryButton} type="button" onClick={() => runAuthenticatedAction("partial")} disabled={busy !== null || partialCategories.length === 0}>
                {busy === "partial" ? t("mails.suppression_a620db43") : t("public.deletion_partial_action")}
              </button>
            </section>
          </>
        )}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.successMessage} role="status">{message}</p> : null}
        {nativeProvider ? <p className={styles.smallNote}>{t("public.deletion_store_sync_note")}</p> : null}
        <p className={styles.legalNote}>{t("public.deletion_retention_notice")}</p>
      </div>
    );
  }

  if (publicDone) {
    return (
      <div className={styles.formCard} role="status">
        <div className={styles.successIcon} aria-hidden="true">✓</div>
        <h2>{t("public.deletion_received_title")}</h2>
        <p>{t("public.deletion_received_description")}</p>
        <Link className={styles.secondaryButton} href="/login">{t("public.deletion_login_manage")}</Link>
      </div>
    );
  }

  return (
    <div className={styles.formCard}>
      <div className={styles.accountHeader}>
        <div><span className={styles.cardEyebrow}>{t("public.deletion_secure_access")}</span><h2>{t("public.deletion_self_service_title")}</h2></div>
        <Link className={styles.loginPill} href="/login">{t("public.deletion_login")}</Link>
      </div>
      <p>{t("public.deletion_login_description")}</p>
      <div className={styles.publicDivider}><span>{t("public.deletion_lost_access")}</span></div>
      <form onSubmit={submitPublicRequest} className={styles.publicForm}>
        <div className={styles.compactChoiceGroup} role="group" aria-label={t("public.deletion_request_type")}>
          <label className={requestType === "account" ? styles.compactChoiceActive : styles.compactChoice}>
            <input type="radio" name="requestType" value="account" checked={requestType === "account"} onChange={() => setRequestType("account")} />
            <span>{t("public.deletion_whole_account")}</span>
          </label>
          <label className={requestType === "partial" ? styles.compactChoiceActive : styles.compactChoice}>
            <input type="radio" name="requestType" value="partial" checked={requestType === "partial"} onChange={() => setRequestType("partial")} />
            <span>{t("public.deletion_targeted_data")}</span>
          </label>
        </div>
        <div className={styles.inlineFields}>
          <label className={styles.field}><span>{t("public.nom_et_prenom_cfad8e02")}</span><input name="fullName" autoComplete="name" maxLength={160} required /></label>
          <label className={styles.field}><span>{t("public.deletion_account_email")}</span><input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        </div>
        <label className={styles.field}><span>{t.rich("public.deletion_details", { required: requestType === "partial" ? "yes" : "no", label: t("public.deletion_data_to_remove"), small: chunks => <small>{chunks}</small> })}</span><textarea name="details" rows={2} maxLength={3000} required={requestType === "partial"} placeholder={t("public.deletion_details_placeholder")} /></label>
        <label className={styles.confirmation}><input type="checkbox" required /><span>{t("public.deletion_consent")}</span></label>
        <label className={styles.honeypot} aria-hidden="true">{t("dashboard.inrSearchPresentation.website")}<input name="website" tabIndex={-1} autoComplete="off" /></label>
        {publicError ? <p className={styles.error} role="alert">{publicError}</p> : null}
        <button className={styles.primaryButton} type="submit" disabled={publicBusy}>{publicBusy ? t("shell.ai_report_sending") : t("public.envoyer_ma_demande_0eb22583")}</button>
      </form>
    </div>
  );
}
