"use client";

import { useTranslations } from "next-intl";


import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { APP_LANGUAGE_STORAGE_KEY, normalizeAppLanguage, type AppLanguageCode } from "@/lib/appLanguage";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { useDashboardI18n } from "../../_hooks/useDashboardI18n";
import {
  DEFAULT_MOBILE_SHORTCUTS,
  MOBILE_SHORTCUT_MAX,
  MOBILE_SHORTCUT_OPTIONS,
  getMobileShortcutLabel,
  loadMobileShortcutsPreference,
  saveMobileShortcutsPreference,
  type MobileShortcutId,
} from "@/lib/mobileShortcuts";

type Props = {
  mode?: "page" | "drawer";
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

type ClientLanguage = AppLanguageCode;
type DateFormat = "dd/MM/yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd" | "d MMMM yyyy";
type Currency = "EUR" | "USD" | "GBP" | "CHF" | "CAD";
type PreferencesForm = {
  clientLanguage: ClientLanguage;
  timezone: string;
  dateFormat: DateFormat;
  currency: Currency;
};

const TABLE = "business_profiles";
const STORAGE_KEY = "inrcy_general_preferences";
const CLIENT_LANGUAGE_CUSTOM_STORAGE_KEY = "inrcy_client_language_custom_v1";

const initialForm: PreferencesForm = {
  clientLanguage: "fr",
  timezone: "Europe/Paris",
  dateFormat: "dd/MM/yyyy",
  currency: "EUR",
};

const selectOption: React.CSSProperties = { color: "#0b1020", background: "#ffffff" };

const normalizeClientLanguage = (value: unknown): ClientLanguage => normalizeAppLanguage(value);

const normalizeTimezone = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return "Europe/Paris";
  return raw.slice(0, 80);
};

const normalizeDateFormat = (value: unknown): DateFormat => {
  const raw = String(value || "").trim();
  if (raw === "MM/dd/yyyy") return "MM/dd/yyyy";
  if (raw === "yyyy-MM-dd") return "yyyy-MM-dd";
  if (raw === "d MMMM yyyy") return "d MMMM yyyy";
  return "dd/MM/yyyy";
};

const normalizeCurrency = (value: unknown): Currency => {
  const raw = String(value || "").trim().toUpperCase();
  if (["USD", "GBP", "CHF", "CAD"].includes(raw)) return raw as Currency;
  return "EUR";
};

const hasPreferenceValue = (value: unknown): boolean => String(value ?? "").trim().length > 0;

function readDefaultAppLanguage(): ClientLanguage {
  if (typeof window === "undefined") return initialForm.clientLanguage;
  try {
    return normalizeClientLanguage(window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY));
  } catch {
    return initialForm.clientLanguage;
  }
}

function readClientLanguageIsCustom(local: Record<string, unknown>): boolean {
  if (typeof window === "undefined") return hasPreferenceValue(local.clientLanguage) || hasPreferenceValue(local.client_language);
  try {
    return window.localStorage.getItem(CLIENT_LANGUAGE_CUSTOM_STORAGE_KEY) === "1"
      || hasPreferenceValue(local.clientLanguage)
      || hasPreferenceValue(local.client_language);
  } catch {
    return hasPreferenceValue(local.clientLanguage) || hasPreferenceValue(local.client_language);
  }
}

function markClientLanguageCustom() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CLIENT_LANGUAGE_CUSTOM_STORAGE_KEY, "1"); } catch {}
}

const normalizePartialPreferences = (source: Record<string, unknown> | null | undefined): Partial<PreferencesForm> => {
  if (!source) return {};

  const preferences: Partial<PreferencesForm> = {};

  if (hasPreferenceValue(source.clientLanguage)) {
    preferences.clientLanguage = normalizeClientLanguage(source.clientLanguage);
  }
  if (hasPreferenceValue(source.client_language)) {
    preferences.clientLanguage = normalizeClientLanguage(source.client_language);
  }
  if (hasPreferenceValue(source.timezone)) {
    preferences.timezone = normalizeTimezone(source.timezone);
  }
  if (hasPreferenceValue(source.dateFormat)) {
    preferences.dateFormat = normalizeDateFormat(source.dateFormat);
  }
  if (hasPreferenceValue(source.date_format)) {
    preferences.dateFormat = normalizeDateFormat(source.date_format);
  }
  if (hasPreferenceValue(source.currency)) {
    preferences.currency = normalizeCurrency(source.currency);
  }

  return preferences;
};

export default function GeneralPreferencesContent({ mode = "drawer", onUnsavedChange }: Props) {
  const i18nT = useTranslations("settings");
  const t = useDashboardI18n();
  const [form, setForm] = useState<PreferencesForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [mobileShortcuts, setMobileShortcuts] = useState<MobileShortcutId[]>([...DEFAULT_MOBILE_SHORTCUTS]);
  const savedPreferencesSignatureRef = useRef("");

  useEffect(() => {
    if (loading) {
      onUnsavedChange?.(false);
      return;
    }
    onUnsavedChange?.(
      savedPreferencesSignatureRef.current !== ""
        && savedPreferencesSignatureRef.current !== JSON.stringify({ form, mobileShortcuts }),
    );
  }, [form, loading, mobileShortcuts, onUnsavedChange]);

  const card: React.CSSProperties = useMemo(() => ({
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: "clamp(12px, 3.6vw, 16px)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.045)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  }), []);

  const heroCard: React.CSSProperties = useMemo(() => ({
    ...card,
    position: "relative",
    overflow: "hidden",
    border: "1px solid rgba(56,189,248,0.22)",
    background: "linear-gradient(135deg, rgba(56,189,248,0.16), rgba(97,87,255,0.14), rgba(251,191,36,0.12))",
    boxShadow: "0 20px 60px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.10)",
  }), [card]);

  const sectionTitle: React.CSSProperties = {
    color: "rgba(255,255,255,0.94)",
    fontSize: 13,
    fontWeight: 950,
    letterSpacing: ".08em",
    textTransform: "uppercase",
  };

  const input: React.CSSProperties = useMemo(() => ({
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    minHeight: 44,
    boxSizing: "border-box",
    fontSize: 15,
    lineHeight: 1.35,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    padding: "10px 12px",
    color: "white",
    outline: "none",
  }), []);

  const label: React.CSSProperties = {
    display: "grid",
    gap: 9,
    minWidth: 0,
    maxWidth: "100%",
    padding: "12px",
    borderRadius: 15,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "linear-gradient(135deg, rgba(255,255,255,0.060), rgba(255,255,255,0.025))",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  };
  const labelTitle: React.CSSProperties = { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 800, lineHeight: 1.25 };
  const grid2: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", minWidth: 0, maxWidth: "100%" };
  const primaryBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "linear-gradient(135deg, rgba(251,191,36,.35), rgba(97,87,255,.28), rgba(0,200,255,.22))",
    color: "white",
    borderRadius: 14,
    padding: "10px 12px",
    cursor: saving ? "default" : "pointer",
    fontWeight: 900,
    fontSize: 16,
    width: "100%",
    opacity: saving ? 0.7 : 1,
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        let local: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
          local = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {}

        const supabase = createClient();
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw new Error(authErr.message);
        const user = authData?.user;

        const appDefaultLanguage = readDefaultAppLanguage();
        const clientLanguageIsCustom = readClientLanguageIsCustom(local);
        let dbPreferences: Partial<PreferencesForm> = {};
        if (user) {
          const { data, error: dbErr } = await supabase
            .from(TABLE)
            .select("client_language, timezone, date_format, currency, updated_at")
            .eq("user_id", resolveActiveBrowserUserId(user.id))
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (dbErr) throw new Error(dbErr.message);
          dbPreferences = normalizePartialPreferences(data);
          if (
            dbPreferences.clientLanguage === initialForm.clientLanguage
            && appDefaultLanguage !== initialForm.clientLanguage
            && !clientLanguageIsCustom
          ) {
            delete dbPreferences.clientLanguage;
          }
        }

        const migratedLocal = normalizePartialPreferences(local);

        const nextForm = { ...initialForm, clientLanguage: appDefaultLanguage, ...migratedLocal, ...dbPreferences };
        const nextMobileShortcuts = await loadMobileShortcutsPreference();
        setForm(nextForm);
        setMobileShortcuts(nextMobileShortcuts);
        savedPreferencesSignatureRef.current = JSON.stringify({ form: nextForm, mobileShortcuts: nextMobileShortcuts });
      } catch (e) {
        setError(getSimpleFrenchErrorMessage(e, "Impossible de charger les préférences générales."));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const set = <K extends keyof PreferencesForm>(key: K, value: PreferencesForm[K]) => {
    setSaved(false);
    setError("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setClientLanguage = (value: ClientLanguage) => {
    markClientLanguageCustom();
    set("clientLanguage", value);
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
      markClientLanguageCustom();

      const supabase = createClient();
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw new Error(authErr.message);
      const user = authData?.user;
      if (user) {
        const { error: upErr } = await supabase.from(TABLE).upsert(
          {
            user_id: resolveActiveBrowserUserId(user.id),
            client_language: form.clientLanguage,
            timezone: form.timezone,
            date_format: form.dateFormat,
            currency: form.currency,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
        if (upErr) throw new Error(upErr.message);
        await invalidateBoosterGenerationContextClient("professional");
      }

      await saveMobileShortcutsPreference(mobileShortcuts);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("inrcy:general-preferences-updated", {
          detail: {
            clientLanguage: form.clientLanguage,
            timezone: form.timezone,
            dateFormat: form.dateFormat,
            currency: form.currency,
          },
        }));
      }

      savedPreferencesSignatureRef.current = JSON.stringify({ form, mobileShortcuts });
      // Updating the baseline ref alone does not trigger the dirty-state
      // effect because the form values themselves did not change.
      onUnsavedChange?.(false);
      setSaved(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/client_language|timezone|date_format|currency/i.test(message)) {
        setError(i18nT("il_faut_d_abord_executer_le_57fe6660"));
      } else {
        setError(getSimpleFrenchErrorMessage(e, "Impossible d’enregistrer les préférences générales."));
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setForm({ ...initialForm, clientLanguage: readDefaultAppLanguage() });
    setMobileShortcuts([...DEFAULT_MOBILE_SHORTCUTS]);
    setSaved(false);
    setError("");
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CLIENT_LANGUAGE_CUSTOM_STORAGE_KEY);
    } catch {}
  };

  const toggleMobileShortcut = (id: MobileShortcutId) => {
    setSaved(false);
    setError("");
    setMobileShortcuts((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MOBILE_SHORTCUT_MAX) return current;
      return [...current, id];
    });
  };

  const moveMobileShortcut = (id: MobileShortcutId, direction: -1 | 1) => {
    setSaved(false);
    setMobileShortcuts((current) => {
      const index = current.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0, maxWidth: "100%", overflowX: "hidden" }}>
      <div style={heroCard}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -36,
            top: -44,
            width: 130,
            height: 130,
            borderRadius: 999,
            background: "radial-gradient(circle, rgba(56,189,248,0.30), transparent 66%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ fontSize: "clamp(16px, 4.6vw, 18px)", fontWeight: 950, color: "rgba(255,255,255,0.98)", marginBottom: 8, lineHeight: 1.25, overflowWrap: "break-word" }}>
          {i18nT("preferences_generales_9266b474")}{" "}</div>
        <div style={{ color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: 1.55, maxWidth: 620, overflowWrap: "break-word" }}>
          {i18nT("reglez_les_parametres_globaux_de_vos_1396fb07")}{" "}</div>
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}>{i18nT("chargement_01cba1df")}</div>
        ) : (
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={sectionTitle}>{i18nT("localisation_echanges_clients_548f849b")}</div>
              <div style={grid2}>
                <label style={label}>
                  <span style={labelTitle}>{i18nT("langue_clients_c45957b4")}</span>
                  <select style={input} value={form.clientLanguage} onChange={(e) => setClientLanguage(e.target.value as ClientLanguage)}>
                    <option value="fr" style={selectOption}>{i18nT("francais_2ca514eb")}</option>
                    <option value="en" style={selectOption}>{i18nT("english_649df08a")}</option>
                    <option value="es" style={selectOption}>{i18nT("espanol_2001ca08")}</option>
                    <option value="it" style={selectOption}>{i18nT("italiano_21df7394")}</option>
                    <option value="de" style={selectOption}>{i18nT("deutsch_a6a77092")}</option>
                    <option value="nl" style={selectOption}>{i18nT("nederlands_f61c54c1")}</option>
                    <option value="pt" style={selectOption}>{i18nT("portugues_053aa1d8")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("fuseau_horaire_28bb85a9")}</span>
                  <select style={input} value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                    <option value="Europe/Paris" style={selectOption}>{i18nT("europe_paris_f84bc266")}</option>
                    <option value="Europe/London" style={selectOption}>{i18nT("europe_london_3619d14f")}</option>
                    <option value="Europe/Madrid" style={selectOption}>{i18nT("europe_madrid_971b64ad")}</option>
                    <option value="Europe/Rome" style={selectOption}>{i18nT("europe_rome_6a5576ae")}</option>
                    <option value="Europe/Berlin" style={selectOption}>{i18nT("europe_berlin_d34f4198")}</option>
                    <option value="Europe/Brussels" style={selectOption}>{i18nT("europe_brussels_2efaae56")}</option>
                    <option value="Europe/Amsterdam" style={selectOption}>{i18nT("europe_amsterdam_5bb9fd02")}</option>
                    <option value="Europe/Lisbon" style={selectOption}>{i18nT("europe_lisbon_1960f0bb")}</option>
                    <option value="America/New_York" style={selectOption}>{i18nT("america_new_york_91a5e4a6")}</option>
                    <option value="America/Toronto" style={selectOption}>{i18nT("america_toronto_c0c13522")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("format_de_date_cda3f090")}</span>
                  <select style={input} value={form.dateFormat} onChange={(e) => set("dateFormat", e.target.value as DateFormat)}>
                    <option value="dd/MM/yyyy" style={selectOption}>19/06/2026</option>
                    <option value="MM/dd/yyyy" style={selectOption}>06/19/2026</option>
                    <option value="yyyy-MM-dd" style={selectOption}>2026-06-19</option>
                    <option value="d MMMM yyyy" style={selectOption}>{i18nT("19_juin_2026_62fad7a7")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("devise_eb2e42c4")}</span>
                  <select style={input} value={form.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
                    <option value="EUR" style={selectOption}>{i18nT("eur_04d81b67")}</option>
                    <option value="USD" style={selectOption}>{i18nT("usd_3b9db8a9")}</option>
                    <option value="GBP" style={selectOption}>{i18nT("gbp_d57cc56e")}</option>
                    <option value="CHF" style={selectOption}>CHF</option>
                    <option value="CAD" style={selectOption}>{i18nT("cad_a9042e51")}</option>
                  </select>
                </label>
              </div>
            </div>


            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={sectionTitle}>{i18nT("raccourcis_mobiles_db886e5d")}</div>
                <div style={{ marginTop: 6, color: "rgba(255,255,255,0.70)", fontSize: 12.5, lineHeight: 1.5 }}>
                  {i18nT("choisissez_jusqu_a_9d086004")}{" "}{MOBILE_SHORTCUT_MAX} {" "}{i18nT("outils_pour_le_bloc_839a3e2f")}{" "}<strong>{i18nT("raccourcis_0e0d6404")}</strong> {" "}{i18nT("du_menu_mobile_le_choix_est_6892ed72")}{" "}</div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {mobileShortcuts.map((id, index) => (
                  <div key={id} style={{ ...label, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ ...labelTitle, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {index + 1}. {getMobileShortcutLabel(id, t.locale)}
                    </span>
                    <span style={{ display: "inline-flex", gap: 6, flex: "0 0 auto" }}>
                      <button type="button" aria-label={i18nT("monter_dd1b79d9")} disabled={index === 0} onClick={() => moveMobileShortcut(id, -1)} style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "white", cursor: index === 0 ? "default" : "pointer", opacity: index === 0 ? 0.35 : 1 }}>↑</button>
                      <button type="button" aria-label={i18nT("descendre_383f2e3e")} disabled={index === mobileShortcuts.length - 1} onClick={() => moveMobileShortcut(id, 1)} style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "white", cursor: index === mobileShortcuts.length - 1 ? "default" : "pointer", opacity: index === mobileShortcuts.length - 1 ? 0.35 : 1 }}>↓</button>
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ ...grid2, alignItems: "stretch" }}>
                {MOBILE_SHORTCUT_OPTIONS.map((option) => {
                  const checked = mobileShortcuts.includes(option.id);
                  const disabled = !checked && mobileShortcuts.length >= MOBILE_SHORTCUT_MAX;
                  return (
                    <label key={option.id} style={{ ...label, display: "flex", gridTemplateColumns: "auto 1fr", alignItems: "center", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleMobileShortcut(option.id)}
                        style={{ width: 18, height: 18, accentColor: "#8b5cf6" }}
                      />
                      <span style={labelTitle}>{getMobileShortcutLabel(option.id, t.locale)}</span>
                    </label>
                  );
                })}
              </div>

              <div style={{ color: mobileShortcuts.length >= MOBILE_SHORTCUT_MAX ? "rgba(251,191,36,0.95)" : "rgba(255,255,255,0.64)", fontSize: 12, fontWeight: 800 }}>
                {mobileShortcuts.length} / {MOBILE_SHORTCUT_MAX} {" "}{i18nT("raccourcis_selectionnes_14f4e07e")}{" "}</div>
            </div>

            {error ? <div style={{ color: "rgba(248,113,113,0.95)", fontWeight: 800 }}>{error}</div> : null}
            {saved ? <div style={{ color: "rgba(34,197,94,0.95)", fontWeight: 900 }}>{i18nT("preferences_enregistrees_d062995f")}</div> : null}

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", minWidth: 0, maxWidth: "100%" }}>
              <button type="button" style={primaryBtn} disabled={saving} onClick={save}>{saving ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_f7c8bcd8")}</button>
              <button type="button" disabled={saving} onClick={reset} style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "white", borderRadius: 14, padding: "10px 12px", cursor: saving ? "default" : "pointer", fontWeight: 900, fontSize: 16 }}>
                {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
