"use client";

import { useTranslations } from "next-intl";


import { FormEvent, useState } from "react";
import Link from "next/link";
import styles from "./InrSearchLeadForm.module.css";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";

const VISITOR_STORAGE_KEY = "inrcy.inrsearch.visitor";

type Props = {
  slug: string;
  companyName: string;
  modal?: boolean;
};

type FormState = {
  displayName: string;
  companyName: string;
  phone: string;
  email: string;
  message: string;
  consent: boolean;
  website: string;
};

const EMPTY_FORM: FormState = {
  displayName: "",
  companyName: "",
  phone: "",
  email: "",
  message: "",
  consent: false,
  website: "",
};

function getVisitorId() {
  try {
    const existing = window.sessionStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing) return existing;
    const next = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    window.sessionStorage.setItem(VISITOR_STORAGE_KEY, next);
    return next;
  } catch {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function detectSource() {
  const params = new URLSearchParams(window.location.search);
  const explicit = String(params.get("utm_source") || params.get("source") || "").toLowerCase();
  const referrer = document.referrer.toLowerCase();
  const haystack = `${explicit} ${referrer}`;
  if (/chatgpt|openai/.test(haystack)) return "chatgpt";
  if (/perplexity/.test(haystack)) return "perplexity";
  if (/gemini|bard\.google/.test(haystack)) return "gemini";
  if (/copilot|bing\.com\/chat/.test(haystack)) return "copilot";
  if (/google\./.test(haystack)) return "google";
  if (/bing\./.test(haystack)) return "bing";
  if (/facebook|instagram|linkedin|tiktok|youtube|pinterest/.test(haystack)) return "social";
  if (!document.referrer && !explicit) return "direct";
  return "other";
}

export default function InrSearchLeadForm({ slug, companyName, modal = false }: Props) {
  const i18nT = useTranslations("public");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!form.displayName.trim() && !form.companyName.trim()) {
      setError(i18nT("indiquez_votre_nom_ou_le_nom_51f6ba57"));
      return;
    }
    if (!form.email.trim() && !form.phone.trim()) {
      setError(i18nT("indiquez_un_email_ou_un_telephone_5f648834"));
      return;
    }
    if (!form.consent) {
      setError(i18nT("votre_accord_est_necessaire_pour_transmettre_d176e20f"));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/inr-search/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({
          slug,
          ...form,
          source: detectSource(),
          visitorId: getVisitorId(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Impossible d’envoyer votre demande pour le moment.");
      }
      setSent(true);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(getClientUserFacingErrorMessage(err, "Impossible d’envoyer votre demande pour le moment."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`${styles.section} ${modal ? styles.modalSection : ""}`} id="demande" aria-labelledby="demande-title">
      <div className={styles.intro}>
        <span className={styles.kicker}>{i18nT("contact_direct_bdb8702a")}</span>
        <h2 id="demande-title">{i18nT("presentez_votre_besoin_a_value_a83fd5b4", { value0: companyName })}</h2>
        <p>{i18nT("decrivez_votre_projet_en_quelques_lignes_86091575")}</p>
        <div className={styles.signals}>
          <span><i>✓</i> {" "}{i18nT("demande_transmise_immediatement_a6426e83")}</span>
          <span><i>✓</i> {" "}{i18nT("aucun_compte_a_creer_aa91e48a")}</span>
          <span><i>✓</i> {" "}{i18nT("coordonnees_envoyees_uniquement_a_cette_entrepri_e62d5fee")}</span>
        </div>
      </div>

      <div className={styles.formCard}>
        {sent ? (
          <div className={styles.success} role="status" aria-live="polite">
            <span aria-hidden="true">✓</span>
            <h3>{i18nT("votre_demande_est_bien_partie_f10f2ef2")}</h3>
            <p>{i18nT("value_a_recu_vos_coordonnees_et_2ec4d9f6", { value0: companyName })}</p>
            <button type="button" onClick={() => setSent(false)}>{i18nT("envoyer_une_autre_demande_fd2f9cde")}</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <input
              className={styles.honeypot}
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={form.website}
              onChange={(event) => update("website", event.target.value)}
            />

            <div className={styles.formGrid}>
              <label>
                <span>{i18nT("nom_et_prenom_cfad8e02")}{" "}<b>*</b></span>
                <input
                  name="displayName"
                  value={form.displayName}
                  onChange={(event) => update("displayName", event.target.value)}
                  autoComplete="name"
                  placeholder={i18nT("marie_dupont_fb29a763")}
                  maxLength={180}
                />
              </label>
              <label>
                <span>{i18nT("entreprise_d03e74b6")}</span>
                <input
                  name="companyName"
                  value={form.companyName}
                  onChange={(event) => update("companyName", event.target.value)}
                  autoComplete="organization"
                  placeholder={i18nT("nom_de_votre_entreprise_87f2ec87")}
                  maxLength={140}
                />
              </label>
              <label>
                <span>{i18nT("telephone_d3b023ea")}</span>
                <input
                  name="phone"
                  value={form.phone}
                  onChange={(event) => update("phone", event.target.value)}
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="06 00 00 00 00"
                  maxLength={40}
                />
              </label>
              <label>
                <span>{i18nT("email_84add5b2")}</span>
                <input
                  name="email"
                  value={form.email}
                  onChange={(event) => update("email", event.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  type="email"
                  placeholder="vous@exemple.fr"
                  maxLength={254}
                />
              </label>
            </div>

            <label className={styles.messageField}>
              <span>{i18nT("votre_demande_afba342f")}</span>
              <textarea
                name="message"
                value={form.message}
                onChange={(event) => update("message", event.target.value)}
                rows={5}
                maxLength={1400}
                placeholder={i18nT("decrivez_votre_projet_votre_besoin_ou_271d1264")}
              />
            </label>

            <label className={styles.consent}>
              <input name="consent" type="checkbox" checked={form.consent} onChange={(event) => update("consent", event.target.checked)} />
              <span>{i18nT("j_accepte_que_mes_coordonnees_soient_da6a7dae")}{" "}{companyName} {" "}{i18nT("afin_d_etre_recontacte_consultez_la_3a77b073")}{" "}<Link href="/legal/confidentialite" target="_blank">{i18nT("politique_de_confidentialite_f3b40d83")}</Link>.</span>
            </label>

            {error ? <div className={styles.error} role="alert">{error}</div> : null}

            <button className={styles.submit} type="submit" disabled={submitting}>
              <span>{submitting ? i18nT("transmission_en_cours_7b990bf1") : i18nT("envoyer_ma_demande_0eb22583")}</span>
              <i aria-hidden="true">→</i>
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
