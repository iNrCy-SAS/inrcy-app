"use client";

import { FormEvent, useState } from "react";

import styles from "./suppression-compte.module.css";

type RequestType = "account" | "partial";

export default function DeletionRequestForm() {
  const [requestType, setRequestType] = useState<RequestType>("account");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = {
      requestType,
      fullName: String(form.get("fullName") || ""),
      email: String(form.get("email") || ""),
      accountReference: String(form.get("accountReference") || ""),
      details: String(form.get("details") || ""),
      website: String(form.get("website") || ""),
    };

    try {
      const response = await fetch("/api/public/privacy/deletion-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message || "La demande n’a pas pu être envoyée.");
      setDone(true);
      formElement.reset();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className={styles.formCard} role="status">
        <div className={styles.successIcon} aria-hidden="true">✓</div>
        <h2>Demande bien reçue</h2>
        <p>
          Nous allons vérifier votre identité puis traiter votre demande. Vous recevrez notre réponse
          sur l’adresse e-mail indiquée.
        </p>
        <button className={styles.secondaryButton} type="button" onClick={() => setDone(false)}>
          Envoyer une autre demande
        </button>
      </div>
    );
  }

  return (
    <form className={styles.formCard} onSubmit={onSubmit}>
      <h2>Votre demande</h2>

      <fieldset className={styles.choiceGroup}>
        <legend>Que souhaitez-vous supprimer ?</legend>
        <label className={requestType === "account" ? styles.choiceActive : styles.choice}>
          <input
            type="radio"
            name="requestType"
            value="account"
            checked={requestType === "account"}
            onChange={() => setRequestType("account")}
          />
          <span><strong>Mon compte entier</strong><small>Compte iNrCy et données associées</small></span>
        </label>
        <label className={requestType === "partial" ? styles.choiceActive : styles.choice}>
          <input
            type="radio"
            name="requestType"
            value="partial"
            checked={requestType === "partial"}
            onChange={() => setRequestType("partial")}
          />
          <span><strong>Certaines données seulement</strong><small>Vous précisez les données concernées</small></span>
        </label>
      </fieldset>

      <label className={styles.field}>
        <span>Nom et prénom</span>
        <input name="fullName" autoComplete="name" maxLength={160} required />
      </label>

      <label className={styles.field}>
        <span>Adresse e-mail du compte</span>
        <input name="email" type="email" autoComplete="email" maxLength={254} required />
      </label>

      <label className={styles.field}>
        <span>Société ou référence du compte <small>(facultatif)</small></span>
        <input name="accountReference" maxLength={200} />
      </label>

      <label className={styles.field}>
        <span>{requestType === "partial" ? "Données à supprimer" : "Précisions"} {requestType === "account" ? <small>(facultatif)</small> : null}</span>
        <textarea
          name="details"
          rows={5}
          maxLength={3000}
          required={requestType === "partial"}
          placeholder={requestType === "partial" ? "Exemple : mes médias générés, mes contacts importés…" : "Ajoutez ici toute information utile."}
        />
      </label>

      <label className={styles.confirmation}>
        <input type="checkbox" required />
        <span>Je confirme être titulaire du compte ou autorisé à agir pour son compte.</span>
      </label>

      <label className={styles.honeypot} aria-hidden="true">
        Site web
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <button className={styles.submitButton} type="submit" disabled={busy}>
        {busy ? "Envoi en cours…" : "Envoyer ma demande"}
      </button>
    </form>
  );
}
