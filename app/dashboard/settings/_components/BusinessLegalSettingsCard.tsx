"use client";

import { useTranslations } from "next-intl";


import React from "react";
import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";
import { refreshPublicProfileDependents } from "@/lib/publicProfileRefreshClient";
import { createClient } from "@/lib/supabaseClient";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";

type LegalForm = "EI" | "EURL" | "SARL" | "SAS" | "SASU" | "AUTRE";

type LegalSettings = {
  companyLegalName: string;
  legalForm: LegalForm;
  legalFormOther: string;
  hqAddress: string;
  hqZip: string;
  hqCity: string;
  hqCountry: string;
  siren: string;
  rcsCity: string;
  capitalSocial: string;
  capitalDispenseEi: boolean;
  vatNumber: string;
  vatDispense: boolean;
};

type Props = {
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

const initialSettings: LegalSettings = {
  companyLegalName: "",
  legalForm: "EI",
  legalFormOther: "",
  hqAddress: "",
  hqZip: "",
  hqCity: "",
  hqCountry: "France",
  siren: "",
  rcsCity: "",
  capitalSocial: "",
  capitalDispenseEi: true,
  vatNumber: "",
  vatDispense: false,
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.075)",
  color: "rgba(255,255,255,0.94)",
  padding: "11px 12px",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  minWidth: 0,
  color: "rgba(255,255,255,0.76)",
  fontSize: 12.5,
};

function signature(value: LegalSettings) {
  return JSON.stringify(value);
}

export default function BusinessLegalSettingsCard({ onUnsavedChange }: Props) {
  const i18nT = useTranslations("documents");
  const settingsT = useTranslations("settings");
  const [form, setForm] = React.useState<LegalSettings>(initialSettings);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const baselineRef = React.useRef("");

  React.useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const supabase = createClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!authData.user) throw new Error(settingsT("user_not_authenticated"));
        const userId = resolveActiveBrowserUserId(authData.user.id);
        const { data, error: loadError } = await supabase
          .from("profiles")
          .select(
            "company_legal_name,legal_form,legal_form_other,hq_address,hq_zip,hq_city,hq_country,siren,rcs_city,capital_social,capital_dispense_ei,vat_number,vat_dispense",
          )
          .eq("user_id", userId)
          .maybeSingle();
        if (loadError) throw loadError;
        if (!active) return;
        const next: LegalSettings = {
          companyLegalName: data?.company_legal_name ?? "",
          legalForm: (data?.legal_form || "EI") as LegalForm,
          legalFormOther: data?.legal_form_other ?? "",
          hqAddress: data?.hq_address ?? "",
          hqZip: data?.hq_zip ?? "",
          hqCity: data?.hq_city ?? "",
          hqCountry: data?.hq_country ?? "France",
          siren: data?.siren ?? "",
          rcsCity: data?.rcs_city ?? "",
          capitalSocial: data?.capital_social ?? "",
          capitalDispenseEi: Boolean(data?.capital_dispense_ei),
          vatNumber: data?.vat_number ?? "",
          vatDispense: Boolean(data?.vat_dispense),
        };
        setForm(next);
        baselineRef.current = signature(next);
        onUnsavedChange?.(false);
      } catch (caught) {
        if (active) {
          setError(
            getClientUserFacingErrorMessage(
              caught,
              settingsT("business_legal_load_failed"),
            ),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [onUnsavedChange]);

  React.useEffect(() => {
    if (loading || !baselineRef.current) return;
    onUnsavedChange?.(signature(form) !== baselineRef.current);
  }, [form, loading, onUnsavedChange]);

  function update<K extends keyof LegalSettings>(key: K, value: LegalSettings[K]) {
    setSaved(false);
    setError("");
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error(settingsT("user_not_authenticated"));
      const userId = resolveActiveBrowserUserId(authData.user.id);
      const payload = {
        user_id: userId,
        company_legal_name: form.companyLegalName.trim(),
        legal_form: form.legalForm,
        legal_form_other:
          form.legalForm === "AUTRE" ? form.legalFormOther.trim() : "",
        hq_address: form.hqAddress.trim(),
        hq_zip: form.hqZip.trim(),
        hq_city: form.hqCity.trim(),
        hq_country: form.hqCountry.trim() || "France",
        siren: form.siren.replace(/\s+/g, "").trim(),
        rcs_city: form.rcsCity.trim(),
        capital_social: form.capitalDispenseEi
          ? ""
          : form.capitalSocial.trim(),
        capital_dispense_ei: form.capitalDispenseEi,
        vat_number: form.vatDispense ? "" : form.vatNumber.trim(),
        vat_dispense: form.vatDispense,
      };
      const { error: saveError } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "user_id" });
      if (saveError) throw saveError;
      await Promise.all([
        refreshPublicProfileDependents("profile"),
        invalidateBoosterGenerationContextClient("professional"),
      ]);
      const normalized: LegalSettings = {
        ...form,
        companyLegalName: payload.company_legal_name,
        legalFormOther: payload.legal_form_other,
        hqAddress: payload.hq_address,
        hqZip: payload.hq_zip,
        hqCity: payload.hq_city,
        hqCountry: payload.hq_country,
        siren: payload.siren,
        rcsCity: payload.rcs_city,
        capitalSocial: payload.capital_social,
        vatNumber: payload.vat_number,
      };
      setForm(normalized);
      baselineRef.current = signature(normalized);
      onUnsavedChange?.(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (caught) {
      setError(
        getClientUserFacingErrorMessage(
          caught,
          settingsT("business_legal_save_failed"),
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  const completedFields = [
    form.companyLegalName,
    form.hqAddress,
    form.hqZip,
    form.hqCity,
    form.hqCountry,
    form.siren,
  ].filter((value) => value.trim().length > 0).length;

  return (
    <section
      style={{
        borderRadius: 20,
        border: "1px solid rgba(251,146,60,0.30)",
        background:
          "linear-gradient(145deg, rgba(56,189,248,0.12), rgba(244,114,182,0.10) 52%, rgba(251,146,60,0.12))",
        boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
        padding: 16,
        minWidth: 0,
      }}
    >
      <style jsx>{`
        @media (max-width: 620px) {
          div[data-legal-grid="2"] { grid-template-columns: 1fr !important; }
        }
        select option { color: #111827; }
      `}</style>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
          <span
            aria-hidden="true"
            style={{
              width: 38,
              height: 38,
              borderRadius: 13,
              display: "grid",
              placeItems: "center",
              background:
                "linear-gradient(135deg, rgba(56,189,248,0.32), rgba(244,114,182,0.28), rgba(251,146,60,0.30))",
              border: "1px solid rgba(255,255,255,0.16)",
              flex: "0 0 auto",
            }}
          >
            🏢
          </span>
          <div style={{ display: "grid", gap: 4 }}>
            <strong style={{ color: "white", fontSize: 16 }}>
              {i18nT("informations_juridiques_de_l_entreprise_94a492a8")}{" "}</strong>
            <span
              style={{
                color: "rgba(255,255,255,0.68)",
                fontSize: 12.5,
                lineHeight: 1.45,
              }}
            >
              {i18nT("utilisees_uniquement_pour_vos_devis_factures_75f96f4c")}{" "}</span>
          </div>
        </div>
        <span
          style={{
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(8,15,35,0.42)",
            padding: "7px 10px",
            color:
              completedFields >= 6 ? "#86efac" : "rgba(255,255,255,0.72)",
            fontSize: 12,
            fontWeight: 850,
          }}
        >
          {completedFields >= 6
            ? i18nT("pret_pour_encaisser_56edff06")
            : settingsT("essential_fields_progress", { count: completedFields })}
        </span>
      </div>

      {loading ? (
        <div style={{ marginTop: 14, color: "rgba(255,255,255,0.68)" }}>
          {i18nT("chargement_des_informations_08161892")}{" "}</div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 15 }}>
          <div data-legal-grid="2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <label style={labelStyle}>
              <span>{i18nT("raison_sociale_28eaf8b0")}</span>
              <input style={fieldStyle} value={form.companyLegalName} onChange={(event) => update("companyLegalName", event.target.value)} placeholder={i18nT("ex_dupont_renovation_5913229c")} />
            </label>
            <label style={labelStyle}>
              <span>{i18nT("forme_juridique_a7c1add5")}</span>
              <select style={fieldStyle} value={form.legalForm} onChange={(event) => update("legalForm", event.target.value as LegalForm)}>
                <option value="EI">EI</option>
                <option value="EURL">EURL</option>
                <option value="SARL">SARL</option>
                <option value="SAS">SAS</option>
                <option value="SASU">SASU</option>
                <option value="AUTRE">{i18nT("autre_43dacf9e")}</option>
              </select>
            </label>
          </div>

          {form.legalForm === "AUTRE" ? (
            <label style={labelStyle}>
              <span>{i18nT("precisez_la_forme_juridique_0f6374b5")}</span>
              <input style={fieldStyle} value={form.legalFormOther} onChange={(event) => update("legalFormOther", event.target.value)} placeholder={i18nT("ex_association_126ba3db")} />
            </label>
          ) : null}

          <label style={labelStyle}>
            <span>{i18nT("adresse_du_siege_social_bd12217c")}</span>
            <input style={fieldStyle} value={form.hqAddress} onChange={(event) => update("hqAddress", event.target.value)} placeholder={i18nT("numero_et_voie_ca13900b")} />
          </label>

          <div data-legal-grid="2" style={{ display: "grid", gridTemplateColumns: "0.8fr 1.2fr", gap: 10 }}>
            <label style={labelStyle}>
              <span>{i18nT("code_postal_74779109")}</span>
              <input style={fieldStyle} value={form.hqZip} onChange={(event) => update("hqZip", event.target.value)} inputMode="numeric" placeholder="62000" />
            </label>
            <label style={labelStyle}>
              <span>{i18nT("ville_97217611")}</span>
              <input style={fieldStyle} value={form.hqCity} onChange={(event) => update("hqCity", event.target.value)} placeholder={i18nT("arras_14599ac1")} />
            </label>
          </div>

          <div data-legal-grid="2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <label style={labelStyle}>
              <span>{i18nT("pays_2a78f0e9")}</span>
              <input style={fieldStyle} value={form.hqCountry} onChange={(event) => update("hqCountry", event.target.value)} placeholder={i18nT("france_e3772ac4")} />
            </label>
            <label style={labelStyle}>
              <span>SIREN</span>
              <input style={fieldStyle} value={form.siren} onChange={(event) => update("siren", event.target.value)} inputMode="numeric" placeholder="123 456 789" />
            </label>
          </div>

          <div data-legal-grid="2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <label style={labelStyle}>
              <span>{i18nT("ville_du_rcs_ef0528f2")}</span>
              <input style={fieldStyle} value={form.rcsCity} onChange={(event) => update("rcsCity", event.target.value)} placeholder={i18nT("arras_14599ac1")} />
            </label>
            <label style={labelStyle}>
              <span>{i18nT("capital_social_49380151")}</span>
              <input style={{ ...fieldStyle, opacity: form.capitalDispenseEi ? 0.55 : 1 }} value={form.capitalSocial} onChange={(event) => update("capitalSocial", event.target.value)} disabled={form.capitalDispenseEi} inputMode="decimal" placeholder={i18nT("ex_1_000_2ccfa56c")} />
            </label>
          </div>

          <label style={{ display: "flex", gap: 9, alignItems: "center", color: "rgba(255,255,255,0.78)", fontSize: 12.5 }}>
            <input type="checkbox" checked={form.capitalDispenseEi} onChange={(event) => update("capitalDispenseEi", event.target.checked)} />
            {i18nT("capital_social_non_applicable_dispense_daab3a5a")}{" "}</label>

          <label style={labelStyle}>
            <span>{i18nT("numero_de_tva_intracommunautaire_94082910")}</span>
            <input style={{ ...fieldStyle, opacity: form.vatDispense ? 0.55 : 1 }} value={form.vatNumber} onChange={(event) => update("vatNumber", event.target.value)} disabled={form.vatDispense} placeholder={i18nT("ex_fr12345678901_d77e14ad")} />
          </label>
          <label style={{ display: "flex", gap: 9, alignItems: "center", color: "rgba(255,255,255,0.78)", fontSize: 12.5 }}>
            <input type="checkbox" checked={form.vatDispense} onChange={(event) => update("vatDispense", event.target.checked)} />
            {i18nT("tva_non_applicable_franchise_en_base_fcae739a")}{" "}</label>

          {error ? <div style={{ color: "#fca5a5", fontSize: 12.5, fontWeight: 750 }}>{error}</div> : null}
          {saved ? <div style={{ color: "#86efac", fontSize: 12.5, fontWeight: 850 }}>{i18nT("informations_juridiques_enregistrees_91dab432")}</div> : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            style={{
              border: "1px solid rgba(56,189,248,0.50)",
              borderRadius: 13,
              background:
                "linear-gradient(135deg, rgba(56,189,248,0.30), rgba(244,114,182,0.24), rgba(251,146,60,0.24))",
              color: "white",
              padding: "12px 14px",
              fontWeight: 900,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.65 : 1,
            }}
          >
            {saving ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_les_informations_juridiques_9f518676")}
          </button>
        </div>
      )}
    </section>
  );
}
