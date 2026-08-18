"use client";

import { useTranslations } from "next-intl";


import React from "react";
import BusinessLegalSettingsCard from "./BusinessLegalSettingsCard";
import { getSimpleFrenchApiError, getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import {
  DEFAULT_INRDOCUMENTS_SETTINGS,
  DOCUMENT_ACCENT_COLORS,
  DOCUMENT_DESIGN_PRESETS,
  DOCUMENT_KINDS,
  DOCUMENT_OPERATION_CATEGORIES,
  DOCUMENT_PAYMENT_METHODS,
  DOCUMENT_STATUSES,
  DOCUMENT_VAT_RATES,
  INRDOCUMENTS_SETTINGS_UPDATED_EVENT,
  InrDocumentsSettings,
  normalizeInrDocumentsSettings,
} from "@/lib/inrdocumentsSettings";

const operationLabels: Record<string, string> = {
  "": "—",
  vente: "Vente",
  prestation: "Prestation de services",
  mixte: "Vente + prestation",
};

const paymentLabels: Record<string, string> = {
  "": "—",
  virement: "Virement bancaire",
  cb: "Carte bancaire",
  cheque: "Chèque",
  especes: "Espèces",
  abonnement: "Abonnement",
};

const documentKindLabels: Record<string, string> = {
  invoice: "Facture",
  deposit: "Facture d’acompte",
  credit_note: "Avoir",
};

const statusLabels: Record<string, string> = {
  "": "—",
  brouillon: "Brouillon",
  en_attente_paiement: "En attente de paiement",
  envoye: "Envoyé",
  paye: "Payé",
};

const designPresetLabels: Record<string, string> = {
  standard: "Standard",
  business: "Business",
  encadre: "Encadré",
  signature: "Signature",
};

const accentColorLabels: Record<string, string> = {
  blue: "Bleu",
  violet: "Violet",
  orange: "Orange",
  green: "Vert",
  gray: "Gris pro",
  rose: "Rose",
  teal: "Turquoise",
  gold: "Or",
};

const fieldStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "rgba(255,255,255,0.92)",
  padding: "11px 12px",
  outline: "none",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 12.5,
  color: "rgba(255,255,255,0.76)",
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.08)",
  padding: "11px 12px",
  cursor: "pointer",
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

function dispatchUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INRDOCUMENTS_SETTINGS_UPDATED_EVENT));
}

function GlassCard({ icon, title, subtitle, children }: { icon: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.045))",
        boxShadow: "0 18px 50px rgba(0,0,0,0.26)",
        padding: 14,
        boxSizing: "border-box",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span
          aria-hidden="true"
          style={{
            width: 28,
            height: 28,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg, rgba(56,189,248,0.22), rgba(244,114,182,0.18))",
            border: "1px solid rgba(255,255,255,0.10)",
            flex: "0 0 auto",
          }}
        >
          {icon}
        </span>
        <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 950, letterSpacing: "-0.2px", color: "rgba(255,255,255,0.94)" }}>{title}</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.68)", lineHeight: 1.45 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 12, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function Notice({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" | "success" }) {
  const color = tone === "error" ? "#fca5a5" : tone === "success" ? "#86efac" : "rgba(255,255,255,0.66)";
  return <div style={{ fontSize: 12.5, lineHeight: 1.45, color }}>{children}</div>;
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div data-doc-settings-grid="2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      {children}
    </label>
  );
}

type Props = {
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

export default function DocumentsSettingsContent({ onUnsavedChange }: Props) {
  const i18nT = useTranslations("documents");
  const [settings, setSettings] = React.useState<InrDocumentsSettings>(DEFAULT_INRDOCUMENTS_SETTINGS);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [documentsDirty, setDocumentsDirty] = React.useState(false);
  const [legalDirty, setLegalDirty] = React.useState(false);
  const savedSettingsSignatureRef = React.useRef("");

  React.useEffect(() => {
    if (loading) {
      setDocumentsDirty(false);
      return;
    }
    setDocumentsDirty(
      savedSettingsSignatureRef.current !== "" && savedSettingsSignatureRef.current !== JSON.stringify(settings),
    );
  }, [loading, settings]);

  React.useEffect(() => {
    onUnsavedChange?.(documentsDirty || legalDirty);
  }, [documentsDirty, legalDirty, onUnsavedChange]);

  const loadSettings = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/documents/settings", { cache: "no-store" });
      if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible de charger les réglages Devis & Factures."));
      const json = await response.json().catch(() => ({}));
      const nextSettings = normalizeInrDocumentsSettings(json?.settings);
      setSettings(nextSettings);
      savedSettingsSignatureRef.current = JSON.stringify(nextSettings);
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, "Impossible de charger les réglages Devis & Factures."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  function updateLocal(patch: Partial<InrDocumentsSettings>) {
    setSettings((current) => normalizeInrDocumentsSettings({
      common: { ...current.common, ...(patch.common || {}) },
      quote: { ...current.quote, ...(patch.quote || {}) },
      invoice: { ...current.invoice, ...(patch.invoice || {}) },
    }));
  }

  async function saveSettings() {
    try {
      setSaving(true);
      setError(null);
      setNotice(null);
      const response = await fetch("/api/documents/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible d’enregistrer les réglages Devis & Factures."));
      const json = await response.json().catch(() => ({}));
      const nextSettings = normalizeInrDocumentsSettings(json?.settings);
      setSettings(nextSettings);
      savedSettingsSignatureRef.current = JSON.stringify(nextSettings);
      setDocumentsDirty(false);
      setNotice(i18nT("reglages_enregistres_1ea1f406"));
      dispatchUpdated();
    } catch (e: any) {
      setError(getSimpleFrenchErrorMessage(e, "Impossible d’enregistrer les réglages Devis & Factures."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12, width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" }}>
      <style jsx>{`
        select option { color: #111827; }
        @media (max-width: 620px) {
          div[data-doc-settings-grid="2"] { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "linear-gradient(135deg, rgba(56,189,248,0.16), rgba(244,114,182,0.12), rgba(251,146,60,0.10))",
          padding: 14,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 950, color: "rgba(255,255,255,0.94)" }}>{i18nT("devis_factures_0857f47f")}</div>
        <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.70)", lineHeight: 1.45 }}>
          {i18nT("ces_valeurs_remplissent_automatiquement_les_nouv_40dd8ef7")}{" "}</div>
      </div>

      <BusinessLegalSettingsCard onUnsavedChange={setLegalDirty} />

      {loading ? <Notice>{i18nT("chargement_des_reglages_d3437d0f")}</Notice> : null}

      <GlassCard icon="⚙️" title={i18nT("commun_f5f06977")} subtitle="Ce qui sert aux devis et aux factures.">
        <Grid2>
          <Field label={i18nT("categorie_d_operation_298de450")}>
            <select style={fieldStyle} value={settings.common.operationCategory} onChange={(e) => updateLocal({ common: { ...settings.common, operationCategory: e.target.value as any } })}>
              {DOCUMENT_OPERATION_CATEGORIES.map((key) => <option key={key} value={key}>{operationLabels[key]}</option>)}
            </select>
          </Field>
          <Field label={i18nT("acompte_79f9f101")}>
            <select
              style={fieldStyle}
              value={settings.common.depositKind}
              onChange={(e) => updateLocal({ common: { ...settings.common, depositKind: e.target.value as any, depositValue: e.target.value ? settings.common.depositValue : "" } })}
            >
              <option value="">—</option>
              <option value="percent">{i18nT("pourcentage_e34218e3")}</option>
              <option value="amount">{i18nT("montant_4adcd9fc")}</option>
            </select>
          </Field>
        </Grid2>

        <Grid2>
          <Field label={i18nT("valeur_acompte_18f70f89")}>
            <input
              style={fieldStyle}
              type="number"
              min="0"
              step="0.01"
              value={settings.common.depositValue}
              disabled={!settings.common.depositKind}
              onChange={(e) => updateLocal({ common: { ...settings.common, depositValue: e.target.value } })}
              placeholder={settings.common.depositKind === "amount" ? "Ex : 300" : "Ex : 30"}
            />
          </Field>
          <Field label={i18nT("notes_70440046")}>
            <input style={fieldStyle} value={settings.common.notes} onChange={(e) => updateLocal({ common: { ...settings.common, notes: e.target.value } })} placeholder={i18nT("ex_merci_pour_votre_confiance_2a2ef0a8")} />
          </Field>
        </Grid2>
      </GlassCard>

      <GlassCard icon="🧾" title={i18nT("prestation_b51f479f")} subtitle="La première ligne proposée dans le document.">
        <Grid2>
          <Field label={i18nT("libelle_f5485bba")}>
            <input style={fieldStyle} value={settings.common.defaultLine.label} onChange={(e) => updateLocal({ common: { ...settings.common, defaultLine: { ...settings.common.defaultLine, label: e.target.value } } })} placeholder={i18nT("prestation_b51f479f")} />
          </Field>
          <Field label={i18nT("prix_ht_362207ca")}>
            <input style={fieldStyle} type="number" min="0" step="0.01" value={settings.common.defaultLine.unitPrice} onChange={(e) => updateLocal({ common: { ...settings.common, defaultLine: { ...settings.common.defaultLine, unitPrice: Number(e.target.value) || 0 } } })} />
          </Field>
        </Grid2>
        <Grid2>
          <Field label={i18nT("quantite_09a38fda")}>
            <input style={fieldStyle} type="number" min="1" step="0.01" value={settings.common.defaultLine.qty} onChange={(e) => updateLocal({ common: { ...settings.common, defaultLine: { ...settings.common.defaultLine, qty: Number(e.target.value) || 1 } } })} />
          </Field>
          <Field label="TVA">
            <select style={fieldStyle} value={settings.common.defaultLine.vatRate} onChange={(e) => updateLocal({ common: { ...settings.common, defaultLine: { ...settings.common.defaultLine, vatRate: Number(e.target.value) } } })}>
              {DOCUMENT_VAT_RATES.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
            </select>
          </Field>
        </Grid2>
      </GlassCard>

      <GlassCard icon="💳" title={i18nT("paiement_0564e9ba")} subtitle="Conditions de règlement reprises sur les documents.">
        <Grid2>
          <Field label={i18nT("mode_de_paiement_71aed79c")}>
            <select style={fieldStyle} value={settings.common.paymentMethod} onChange={(e) => updateLocal({ common: { ...settings.common, paymentMethod: e.target.value as any } })}>
              {DOCUMENT_PAYMENT_METHODS.map((key) => <option key={key} value={key}>{paymentLabels[key]}</option>)}
            </select>
          </Field>
          <Field label="IBAN">
            <input style={fieldStyle} value={settings.common.paymentDetails} onChange={(e) => updateLocal({ common: { ...settings.common, paymentDetails: e.target.value } })} placeholder={i18nT("ex_iban_fr76_6fc76637")} />
          </Field>
        </Grid2>
        <Grid2>
          <Field label={i18nT("echeance_facture_jours_3cb564f9")}>
            <input style={fieldStyle} type="number" min="1" value={settings.invoice.dueDays} onChange={(e) => updateLocal({ invoice: { ...settings.invoice, dueDays: Number(e.target.value) || 1 } })} />
          </Field>
          <Field label={i18nT("penalites_de_retard_1668daa8")}>
            <input style={fieldStyle} type="number" min="0" step="0.01" value={settings.invoice.lateFeeRate} onChange={(e) => updateLocal({ invoice: { ...settings.invoice, lateFeeRate: e.target.value } })} placeholder={i18nT("ex_12_00_883dce79")} />
          </Field>
        </Grid2>
        <label style={checkboxLabelStyle}>
          <input type="checkbox" checked={settings.invoice.fixedRecoveryFee40} onChange={(e) => updateLocal({ invoice: { ...settings.invoice, fixedRecoveryFee40: e.target.checked } })} />
          <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
            <strong style={{ color: "rgba(255,255,255,0.92)", fontSize: 13.5 }}>{i18nT("indemnite_forfaitaire_de_40_8a3e9ec4")}</strong>
            <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 12.5 }}>{i18nT("mentionnee_en_cas_de_retard_de_3320d8da")}</span>
          </span>
        </label>
      </GlassCard>

      <GlassCard icon="✍️" title={i18nT("devis_f7622f90")} subtitle="Réglages appliqués uniquement aux nouveaux devis.">
        <Field label={i18nT("duree_de_validite_jours_f911e91b")}>
          <input style={fieldStyle} type="number" min="1" value={settings.quote.validityDays} onChange={(e) => updateLocal({ quote: { ...settings.quote, validityDays: Number(e.target.value) || 1 } })} />
        </Field>
        <Field label={i18nT("mention_specifique_75d1c5fb")}>
          <textarea style={{ ...fieldStyle, resize: "vertical" }} rows={2} value={settings.quote.mention} onChange={(e) => updateLocal({ quote: { ...settings.quote, mention: e.target.value } })} placeholder={i18nT("ex_devis_valable_selon_disponibilite_2cc98990")} />
        </Field>
      </GlassCard>

      <GlassCard icon="€" title={i18nT("factures_da35e4f2")} subtitle="Réglages appliqués uniquement aux nouvelles factures.">
        <Grid2>
          <Field label={i18nT("type_de_document_69938df4")}>
            <select style={fieldStyle} value={settings.invoice.documentKind} onChange={(e) => updateLocal({ invoice: { ...settings.invoice, documentKind: e.target.value as any } })}>
              {DOCUMENT_KINDS.map((key) => <option key={key} value={key}>{documentKindLabels[key]}</option>)}
            </select>
          </Field>
          <Field label={i18nT("statut_659499f3")}>
            <select style={fieldStyle} value={settings.invoice.status} onChange={(e) => updateLocal({ invoice: { ...settings.invoice, status: e.target.value as any } })}>
              {DOCUMENT_STATUSES.map((key) => <option key={key} value={key}>{statusLabels[key]}</option>)}
            </select>
          </Field>
        </Grid2>
        <label style={checkboxLabelStyle}>
          <input type="checkbox" checked={settings.invoice.vatOnDebits} onChange={(e) => updateLocal({ invoice: { ...settings.invoice, vatOnDebits: e.target.checked } })} />
          <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
            <strong style={{ color: "rgba(255,255,255,0.92)", fontSize: 13.5 }}>{i18nT("tva_sur_les_debits_d46bfbae")}</strong>
            <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 12.5 }}>{i18nT("cochee_automatiquement_sur_les_nouvelles_facture_f4985377")}</span>
          </span>
        </label>
        <Field label={i18nT("mention_specifique_75d1c5fb")}>
          <textarea style={{ ...fieldStyle, resize: "vertical" }} rows={2} value={settings.invoice.mention} onChange={(e) => updateLocal({ invoice: { ...settings.invoice, mention: e.target.value } })} placeholder={i18nT("ex_aucun_escompte_pour_paiement_anticipe_8ec87ff7")} />
        </Field>
      </GlassCard>

      <GlassCard icon="🎨" title={i18nT("design_du_document_a7dcf5f8")} subtitle="Donnez un peu de vie aux devis et factures sans perdre le côté professionnel.">
        <Grid2>
          <Field label={i18nT("style_99a0efc6")}>
            <select
              style={fieldStyle}
              value={settings.common.design.preset}
              onChange={(e) => updateLocal({ common: { ...settings.common, design: { ...settings.common.design, preset: e.target.value as any } } })}
            >
              {DOCUMENT_DESIGN_PRESETS.map((key) => <option key={key} value={key}>{designPresetLabels[key]}</option>)}
            </select>
          </Field>
          <Field label={i18nT("couleur_145c4326")}>
            <select
              style={fieldStyle}
              value={settings.common.design.accentColor}
              onChange={(e) => updateLocal({ common: { ...settings.common, design: { ...settings.common.design, accentColor: e.target.value as any } } })}
            >
              {DOCUMENT_ACCENT_COLORS.map((key) => <option key={key} value={key}>{accentColorLabels[key]}</option>)}
            </select>
          </Field>
        </Grid2>
        <Grid2>
          <label style={checkboxLabelStyle}>
            <input type="checkbox" checked={settings.common.design.frame} onChange={(e) => updateLocal({ common: { ...settings.common, design: { ...settings.common.design, frame: e.target.checked } } })} />
            <span style={{ color: "rgba(255,255,255,0.92)", fontSize: 13.5, fontWeight: 800 }}>{i18nT("cadre_exterieur_a62d3c80")}</span>
          </label>
          <label style={checkboxLabelStyle}>
            <input type="checkbox" checked={settings.common.design.coloredTotals} onChange={(e) => updateLocal({ common: { ...settings.common, design: { ...settings.common.design, coloredTotals: e.target.checked } } })} />
            <span style={{ color: "rgba(255,255,255,0.92)", fontSize: 13.5, fontWeight: 800 }}>{i18nT("bloc_total_colore_0bc347e3")}</span>
          </label>
        </Grid2>
        <label style={checkboxLabelStyle}>
          <input type="checkbox" checked={settings.common.design.coloredParties} onChange={(e) => updateLocal({ common: { ...settings.common, design: { ...settings.common.design, coloredParties: e.target.checked } } })} />
          <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
            <strong style={{ color: "rgba(255,255,255,0.92)", fontSize: 13.5 }}>{i18nT("coordonnees_encadrees_eee5eb90")}</strong>
            <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 12.5 }}>{i18nT("prestataire_et_client_dans_deux_cadres_20e27dfa")}</span>
          </span>
        </label>
      </GlassCard>

      {saving ? <Notice>{i18nT("enregistrement_e7d5f232")}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <button
        type="button"
        onClick={() => void saveSettings()}
        disabled={loading || saving}
        style={{
          borderRadius: 12,
          border: "1px solid rgba(56,189,248,0.5)",
          background: "linear-gradient(135deg, rgba(56,189,248,0.25), rgba(244,114,182,0.18))",
          color: "white",
          padding: "12px 14px",
          fontWeight: 950,
          cursor: loading || saving ? "not-allowed" : "pointer",
          opacity: loading || saving ? 0.65 : 1,
        }}
      >
        {saving ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_les_reglages_a47974c5")}
      </button>
    </div>
  );
}
