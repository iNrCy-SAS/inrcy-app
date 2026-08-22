"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

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
  { value: "generated_content", label: "Contenus générés et médias" },
  { value: "contacts", label: "Contacts, imports et données d’envoi" },
  { value: "connections", label: "Connexions et intégrations" },
  { value: "documents", label: "Documents enregistrés" },
  { value: "activity", label: "Historique d’activité et statistiques" },
] as const;

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

async function apiError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { error?: string; code?: string; provider?: string } | null;
  const error = new Error(body?.error || fallback) as Error & { code?: string; provider?: string };
  error.code = body?.code;
  error.provider = body?.provider;
  return error;
}

export default function DeletionRequestForm() {
  const supabase = createClient();
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

  async function loadAccountState() {
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
    if (!response.ok) throw await apiError(response, "Impossible de charger votre espace confidentialité.");

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
  }

  useEffect(() => {
    let active = true;
    loadAccountState().catch((caught) => {
      if (!active) return;
      setView("error");
      setError(caught instanceof Error ? caught.message : "Impossible de charger la page.");
    });
    return () => {
      active = false;
    };
  }, []);

  async function runAuthenticatedAction(action: Action) {
    setBusy(action);
    setError("");
    setMessage("");
    setNativeProvider(null);

    if (action === "immediate") {
      const confirmed = window.confirm(
        "La suppression immédiate efface le compte et coupe l’accès maintenant. Les données supprimées ne pourront pas être récupérées. Continuer ?",
      );
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
      if (!response.ok) throw await apiError(response, "L’opération n’a pas pu être terminée.");
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
          `Votre demande est programmée. Le compte et ses services restent accessibles jusqu’au ${formatDate(result.end_date || result.scheduled_for) || "la date d’échéance"}.`,
        );
      } else if (action === "cancel_scheduled") {
        setMessage("La demande de suppression a été annulée. Votre compte reste conservé.");
      } else {
        setMessage("Les catégories de données sélectionnées ont été supprimées.");
        setPartialCategories([]);
      }
      await loadAccountState();
    } catch (caught) {
      const errorValue = caught as Error & { code?: string; provider?: string };
      if (errorValue.code === "NATIVE_MANAGEMENT_REQUIRED" && (errorValue.provider === "app_store" || errorValue.provider === "play_store")) {
        setNativeProvider(errorValue.provider);
      }
      setError(errorValue.message || "L’opération n’a pas pu être terminée.");
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
      setMessage("Après la résiliation dans le magasin, revenez ici et actualisez la page.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le magasin d’applications n’a pas pu être ouvert.");
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
      if (!response.ok) throw await apiError(response, "La demande n’a pas pu être envoyée.");
      setPublicDone(true);
      event.currentTarget.reset();
    } catch (caught) {
      setPublicError(caught instanceof Error ? caught.message : "La demande n’a pas pu être envoyée.");
    } finally {
      setPublicBusy(false);
    }
  }

  if (view === "loading") {
    return <div className={styles.formCard}><p className={styles.loading}>Vérification de votre session…</p></div>;
  }

  if (view === "error") {
    return (
      <div className={styles.formCard} role="alert">
        <h2>Votre espace confidentialité</h2>
        <p>{error || "Impossible de charger la page."}</p>
        <button className={styles.secondaryButton} type="button" onClick={() => { setView("loading"); loadAccountState().catch((caught) => { setView("error"); setError(caught instanceof Error ? caught.message : "Impossible de charger la page."); }); }}>
          Réessayer
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
            <span className={styles.cardEyebrow}>Compte connecté</span>
            <h2>Gérer mes données</h2>
          </div>
          <span className={styles.emailBadge}>{account.email || "Compte iNrCy"}</span>
        </div>

        {scheduled ? (
          <section className={styles.scheduledBox}>
            <div className={styles.statusLine}><span className={styles.statusDot} /> Suppression programmée</div>
            <p>
              Votre compte reste actif et vos services restent disponibles jusqu’au <strong>{formatDate(account.deletion?.scheduled_for) || "la date prévue"}</strong>.
              Il sera ensuite supprimé automatiquement.
            </p>
            <button className={styles.secondaryButton} type="button" onClick={() => runAuthenticatedAction("cancel_scheduled")} disabled={busy !== null}>
              {busy === "cancel_scheduled" ? "Annulation…" : "Annuler la suppression"}
            </button>
          </section>
        ) : (
          <>
            <section className={styles.choiceCard}>
              <div className={styles.choiceTitle}><span className={styles.choiceIcon}>⌛</span><div><h3>Supprimer à la fin de mon accès</h3><span className={styles.recommended}>Recommandé</span></div></div>
              <p>
                La résiliation est programmée sans couper vos services. Vous restez abonné et continuez à utiliser iNrCy pendant le préavis, jusqu’à la date de fin affichée.
              </p>
              {accessEnd ? <p className={styles.dateHint}>Échéance actuellement connue : <strong>{formatDate(accessEnd)}</strong>.</p> : null}
              {nativeProvider === "app_store" || nativeProvider === "play_store" ? (
                <button className={styles.secondaryButton} type="button" onClick={openStoreManagement} disabled={busy !== null}>
                  {busy === "native" ? "Ouverture…" : `Gérer dans ${nativeProvider === "app_store" ? "l’App Store" : "Google Play"}`}
                </button>
              ) : (
                <button className={styles.primaryButton} type="button" onClick={() => runAuthenticatedAction("end_of_access")} disabled={busy !== null}>
                  {busy === "end_of_access" ? "Programmation…" : "Résilier et programmer la suppression"}
                </button>
              )}
            </section>

            <section className={styles.choiceCard}>
              <div className={styles.choiceTitle}><span className={styles.choiceIcon}>×</span><div><h3>Supprimer immédiatement</h3></div></div>
              <p>L’accès est coupé maintenant et les données supprimées ne pourront pas être récupérées. La résiliation des renouvellements est traitée avant l’effacement.</p>
              <button className={styles.quietDangerButton} type="button" onClick={() => runAuthenticatedAction("immediate")} disabled={busy !== null}>
                {busy === "immediate" ? "Suppression…" : "Supprimer maintenant"}
              </button>
            </section>

            <section className={styles.partialCard}>
              <div className={styles.choiceTitle}><span className={styles.choiceIcon}>⌘</span><div><h3>Supprimer certaines données</h3></div></div>
              <p>Le compte, le profil et l’abonnement restent actifs. Choisissez les catégories à effacer.</p>
              <div className={styles.checkGrid}>
                {PARTIAL_OPTIONS.map((option) => (
                  <label key={option.value} className={styles.checkItem}>
                    <input type="checkbox" checked={partialCategories.includes(option.value)} onChange={() => togglePartialCategory(option.value)} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              <button className={styles.secondaryButton} type="button" onClick={() => runAuthenticatedAction("partial")} disabled={busy !== null || partialCategories.length === 0}>
                {busy === "partial" ? "Suppression…" : "Supprimer les catégories sélectionnées"}
              </button>
            </section>
          </>
        )}

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.successMessage} role="status">{message}</p> : null}
        {nativeProvider ? <p className={styles.smallNote}>Après la résiliation dans le magasin, revenez ici : la date d’expiration sera synchronisée automatiquement.</p> : null}
        <p className={styles.legalNote}>Les obligations légales (par exemple certaines pièces comptables) peuvent imposer une conservation limitée de données.</p>
      </div>
    );
  }

  if (publicDone) {
    return (
      <div className={styles.formCard} role="status">
        <div className={styles.successIcon} aria-hidden="true">✓</div>
        <h2>Demande bien reçue</h2>
        <p>Nous utiliserons l’adresse indiquée pour vérifier votre identité et vous répondre.</p>
        <Link className={styles.secondaryButton} href="/login">Se connecter pour gérer la suppression automatiquement</Link>
      </div>
    );
  }

  return (
    <div className={styles.formCard}>
      <div className={styles.accountHeader}>
        <div><span className={styles.cardEyebrow}>Accès sécurisé</span><h2>Suppression autonome</h2></div>
        <Link className={styles.loginPill} href="/login">Se connecter</Link>
      </div>
      <p>Connectez-vous pour supprimer votre compte vous-même, conserver vos services jusqu’à l’échéance ou effacer seulement certaines données.</p>
      <div className={styles.publicDivider}><span>Vous ne pouvez plus vous connecter ?</span></div>
      <form onSubmit={submitPublicRequest} className={styles.publicForm}>
        <div className={styles.compactChoiceGroup} role="group" aria-label="Type de demande">
          <label className={requestType === "account" ? styles.compactChoiceActive : styles.compactChoice}>
            <input type="radio" name="requestType" value="account" checked={requestType === "account"} onChange={() => setRequestType("account")} />
            <span>Compte entier</span>
          </label>
          <label className={requestType === "partial" ? styles.compactChoiceActive : styles.compactChoice}>
            <input type="radio" name="requestType" value="partial" checked={requestType === "partial"} onChange={() => setRequestType("partial")} />
            <span>Données ciblées</span>
          </label>
        </div>
        <div className={styles.inlineFields}>
          <label className={styles.field}><span>Nom et prénom</span><input name="fullName" autoComplete="name" maxLength={160} required /></label>
          <label className={styles.field}><span>E-mail du compte</span><input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        </div>
        <label className={styles.field}><span>{requestType === "partial" ? "Données à supprimer" : "Précisions"} <small>(facultatif)</small></span><textarea name="details" rows={2} maxLength={3000} required={requestType === "partial"} placeholder="Expliquez brièvement votre demande…" /></label>
        <label className={styles.confirmation}><input type="checkbox" required /><span>Je confirme être titulaire du compte ou autorisé à agir pour son compte.</span></label>
        <label className={styles.honeypot} aria-hidden="true">Site web<input name="website" tabIndex={-1} autoComplete="off" /></label>
        {publicError ? <p className={styles.error} role="alert">{publicError}</p> : null}
        <button className={styles.primaryButton} type="submit" disabled={publicBusy}>{publicBusy ? "Envoi…" : "Envoyer ma demande"}</button>
      </form>
    </div>
  );
}
