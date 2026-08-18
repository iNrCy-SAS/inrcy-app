"use client";

import { useTranslations } from "next-intl";


import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import { APP_LANGUAGE_OPTIONS, APP_LANGUAGE_STORAGE_KEY, type AppLanguageCode, normalizeAppLanguage } from "@/lib/appLanguage";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import {
  AI_ENGINE_OPTIONS,
  DEFAULT_AI_PREFERRED_ENGINE,
  getAiEngineOption,
  normalizeAiPreferredEngine,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import {
  BOOSTER_PREFERRED_CTA_OPTIONS,
  normalizeBoosterPreferredCta,
  type BoosterPreferredCta,
} from "../../booster/publier/publishModal.shared";
import AiEngineInfoModal from "../../_components/AiEngineInfoModal";

type Props = {
  mode?: "page" | "drawer";
  onSaved?: () => void;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

type AiConfigForm = {
  preferredEngine: AiPreferredEngine;
  tone: "serious" | "warm" | "fun" | "premium";
  textStyle: "simple" | "dynamic" | "expert" | "coulisses";
  originality: "classic" | "balanced" | "creative";
  length: "short" | "medium" | "detailed";
  emojiLevel: "none" | "light" | "dynamic";
  pronoun: "je" | "nous" | "vous" | "neutral";
  addressMode: "vous" | "tu";
  commercialLevel: "discreet" | "balanced" | "direct";
  mainGoal: "visibility" | "contacts" | "reassure" | "offer";
  preferredAngle: "local" | "quality" | "price" | "speed" | "trust";
  preferredCta: BoosterPreferredCta;
  language: AppLanguageCode;
  likedExample: string;
  forbiddenStyle: string;
};

const TABLE = "business_profiles";
const STORAGE_KEY = "inrcy_ai_configuration";
const AI_LANGUAGE_CUSTOM_STORAGE_KEY = "inrcy_ai_language_custom_v1";

const initialForm: AiConfigForm = {
  preferredEngine: DEFAULT_AI_PREFERRED_ENGINE,
  tone: "serious",
  textStyle: "simple",
  originality: "balanced",
  length: "medium",
  emojiLevel: "light",
  pronoun: "nous",
  addressMode: "vous",
  commercialLevel: "balanced",
  mainGoal: "contacts",
  preferredAngle: "trust",
  preferredCta: "devis",
  language: "fr",
  likedExample: "",
  forbiddenStyle: "",
};

const selectOption: React.CSSProperties = { color: "#0b1020", background: "#ffffff" };

const normalizeTone = (value: unknown): AiConfigForm["tone"] => {
  const raw = String(value || "").trim();
  if (raw === "fun") return "fun";
  if (raw === "premium") return "premium";
  if (["friendly", "warm", "chaleureux"].includes(raw)) return "warm";
  return "serious";
};

const normalizeTextStyle = (value: unknown): AiConfigForm["textStyle"] => {
  const raw = String(value || "").trim();
  if (["dynamic", "dynamique", "moderne"].includes(raw)) return "dynamic";
  if (["expert", "professionnel"].includes(raw)) return "expert";
  if (["coulisses", "histoire"].includes(raw)) return "coulisses";
  return "simple";
};

const normalizeOriginality = (value: unknown): AiConfigForm["originality"] => {
  const raw = String(value || "").trim();
  if (["classic", "classique", "stable"].includes(raw)) return "classic";
  if (["creative", "creatif"].includes(raw)) return "creative";
  return "balanced";
};

const normalizeLength = (value: unknown): AiConfigForm["length"] => {
  const raw = String(value || "").trim();
  if (raw === "short") return "short";
  if (raw === "detailed") return "detailed";
  return "medium";
};

const normalizeEmojiLevel = (value: unknown): AiConfigForm["emojiLevel"] => {
  const raw = String(value || "").trim();
  if (raw === "none") return "none";
  if (["dynamic", "many"].includes(raw)) return "dynamic";
  return "light";
};

const normalizePronoun = (value: unknown): AiConfigForm["pronoun"] => {
  const raw = String(value || "").trim();
  if (raw === "je") return "je";
  if (raw === "vous") return "vous";
  if (raw === "neutral") return "neutral";
  return "nous";
};

const normalizeAddressMode = (value: unknown): AiConfigForm["addressMode"] => {
  const raw = String(value || "").trim();
  if (raw === "tu") return "tu";
  return "vous";
};

const normalizeCommercialLevel = (value: unknown): AiConfigForm["commercialLevel"] => {
  const raw = String(value || "").trim();
  if (["discreet", "discret"].includes(raw)) return "discreet";
  if (raw === "direct") return "direct";
  return "balanced";
};

const normalizeMainGoal = (value: unknown): AiConfigForm["mainGoal"] => {
  const raw = String(value || "").trim();
  if (["visibility", "visible"].includes(raw)) return "visibility";
  if (["reassure", "rassurer"].includes(raw)) return "reassure";
  if (["offer", "offre"].includes(raw)) return "offer";
  return "contacts";
};

const normalizePreferredAngle = (value: unknown): AiConfigForm["preferredAngle"] => {
  const raw = String(value || "").trim();
  if (raw === "local") return "local";
  if (["quality", "qualite"].includes(raw)) return "quality";
  if (["price", "prix"].includes(raw)) return "price";
  if (["speed", "rapidite"].includes(raw)) return "speed";
  return "trust";
};

const normalizeLanguage = (value: unknown): AiConfigForm["language"] => normalizeAppLanguage(value);

const hasLanguageValue = (value: unknown): boolean => String(value ?? "").trim().length > 0;

function readDefaultAppLanguage(): AppLanguageCode {
  if (typeof window === "undefined") return initialForm.language;
  try {
    return normalizeLanguage(window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY));
  } catch {
    return initialForm.language;
  }
}

function readAiLanguageIsCustom(local: Partial<Record<string, unknown>>): boolean {
  if (typeof window === "undefined") return hasLanguageValue(local.language);
  try {
    return window.localStorage.getItem(AI_LANGUAGE_CUSTOM_STORAGE_KEY) === "1" || hasLanguageValue(local.language);
  } catch {
    return hasLanguageValue(local.language);
  }
}

function markAiLanguageCustom() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(AI_LANGUAGE_CUSTOM_STORAGE_KEY, "1"); } catch {}
}

export default function AiConfigurationContent({ mode = "drawer", onSaved, onUnsavedChange }: Props) {
  const i18nT = useTranslations("settings");
  const [form, setForm] = useState<AiConfigForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [engineInfoOpen, setEngineInfoOpen] = useState(false);
  const savedFormSignatureRef = useRef("");
  const selectedEngineOption = getAiEngineOption(form.preferredEngine);

  useEffect(() => {
    if (loading) {
      onUnsavedChange?.(false);
      return;
    }
    onUnsavedChange?.(
      savedFormSignatureRef.current !== "" && savedFormSignatureRef.current !== JSON.stringify(form),
    );
  }, [form, loading, onUnsavedChange]);

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

  const signatureCard: React.CSSProperties = useMemo(() => ({
    ...card,
    position: "relative",
    overflow: "hidden",
    border: "1px solid rgba(251,191,36,0.22)",
    background:
      "linear-gradient(135deg, rgba(251,191,36,0.18), rgba(56,189,248,0.16), rgba(167,139,250,0.18), rgba(244,114,182,0.14))",
    boxShadow: "0 20px 60px rgba(0,0,0,0.22), 0 0 34px rgba(251,191,36,0.12), inset 0 1px 0 rgba(255,255,255,0.10)",
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

  const label: React.CSSProperties = { display: "grid", gap: 8, minWidth: 0, maxWidth: "100%" };
  const labelTitle: React.CSSProperties = { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 800, lineHeight: 1.25 };
  const hint: React.CSSProperties = { color: "rgba(255,255,255,0.65)", fontSize: 12, lineHeight: 1.35 };
  const grid2: React.CSSProperties = { display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", minWidth: 0, maxWidth: "100%" };
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
        let local: Partial<Record<keyof AiConfigForm | "communicationStyle" | "creativity" | "aiVoice" | "customInstructions", unknown>> = {};
        try {
          local = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
        } catch {}

        const supabase = createClient();
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw new Error(authErr.message);
        const user = authData?.user;

        const appDefaultLanguage = readDefaultAppLanguage();
        const aiLanguageIsCustom = readAiLanguageIsCustom(local);
        let dbTone: Partial<AiConfigForm> = {};
        if (user) {
          const { data, error: dbErr } = await supabase
            .from(TABLE)
            .select("*")
            .eq("user_id", resolveActiveBrowserUserId(user.id))
            .maybeSingle();
          if (dbErr) throw new Error(dbErr.message);
          const dbLanguage = hasLanguageValue(data?.ai_language) ? normalizeLanguage(data?.ai_language) : undefined;
          const shouldUseDbLanguage = Boolean(dbLanguage && (aiLanguageIsCustom || dbLanguage !== initialForm.language));
          dbTone = {
            preferredEngine: normalizeAiPreferredEngine(data?.ai_preferred_engine),
            tone: normalizeTone(data?.tone),
            textStyle: normalizeTextStyle(data?.communication_style),
            originality: normalizeOriginality(data?.ai_creativity),
            length: normalizeLength(data?.ai_length),
            emojiLevel: normalizeEmojiLevel(data?.emoji_level),
            pronoun: normalizePronoun(data?.ai_voice),
            addressMode: normalizeAddressMode(data?.address_mode),
            commercialLevel: normalizeCommercialLevel(data?.ai_commercial_level),
            mainGoal: normalizeMainGoal(data?.ai_main_goal),
            preferredAngle: normalizePreferredAngle(data?.ai_preferred_angle),
            preferredCta: normalizeBoosterPreferredCta(data?.preferred_cta || initialForm.preferredCta),
            ...(shouldUseDbLanguage && dbLanguage ? { language: dbLanguage } : {}),
            likedExample: String(data?.ai_liked_example || initialForm.likedExample).slice(0, 1200),
            forbiddenStyle: String(data?.ai_custom_instructions || initialForm.forbiddenStyle).slice(0, 700),
          };
        }

        const migratedLocal: Partial<AiConfigForm> = {
          preferredEngine: normalizeAiPreferredEngine(local.preferredEngine),
          tone: normalizeTone(local.tone),
          textStyle: normalizeTextStyle(local.textStyle ?? local.communicationStyle),
          originality: normalizeOriginality(local.originality ?? local.creativity),
          length: normalizeLength(local.length),
          emojiLevel: normalizeEmojiLevel(local.emojiLevel),
          pronoun: normalizePronoun(local.pronoun ?? local.aiVoice),
          addressMode: normalizeAddressMode(local.addressMode),
          commercialLevel: normalizeCommercialLevel(local.commercialLevel),
          mainGoal: normalizeMainGoal(local.mainGoal),
          preferredAngle: normalizePreferredAngle(local.preferredAngle),
          preferredCta: normalizeBoosterPreferredCta(local.preferredCta || initialForm.preferredCta),
          ...(hasLanguageValue(local.language) ? { language: normalizeLanguage(local.language) } : {}),
          likedExample: String(local.likedExample || "").slice(0, 1200),
          forbiddenStyle: String(local.forbiddenStyle ?? local.customInstructions ?? "").slice(0, 700),
        };

        const merged = { ...initialForm, language: appDefaultLanguage, ...migratedLocal, ...dbTone } as AiConfigForm;
        const nextForm = {
          ...merged,
          preferredCta: normalizeBoosterPreferredCta(merged.preferredCta),
        } as AiConfigForm;
        setForm(nextForm);
        savedFormSignatureRef.current = JSON.stringify(nextForm);
      } catch (e) {
        setError(getSimpleFrenchErrorMessage(e, "Impossible de charger la configuration IA."));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const set = <K extends keyof AiConfigForm>(key: K, value: AiConfigForm[K]) => {
    setSaved(false);
    setError("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setGenerationLanguage = (value: AiConfigForm["language"]) => {
    markAiLanguageCustom();
    set("language", value);
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
      markAiLanguageCustom();

      const supabase = createClient();
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw new Error(authErr.message);
      const user = authData?.user;
      if (user) {
        const { error: upErr } = await supabase.from(TABLE).upsert(
          {
            user_id: resolveActiveBrowserUserId(user.id),
            ai_preferred_engine: form.preferredEngine,
            tone: form.tone,
            preferred_cta: form.preferredCta,
            communication_style: form.textStyle,
            emoji_level: form.emojiLevel,
            ai_length: form.length,
            address_mode: form.addressMode,
            ai_voice: form.pronoun,
            ai_creativity: form.originality,
            ai_commercial_level: form.commercialLevel,
            ai_main_goal: form.mainGoal,
            ai_preferred_angle: form.preferredAngle,
            ai_language: form.language,
            ai_liked_example: form.likedExample.trim(),
            ai_custom_instructions: form.forbiddenStyle.trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
        if (upErr) throw new Error(upErr.message);
        await invalidateBoosterGenerationContextClient("professional");
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("inrcy:ai-configuration-updated", {
          detail: {
            aiPreferredEngine: form.preferredEngine,
            aiLanguage: form.language,
            preferredCta: form.preferredCta,
          },
        }));
      }

      savedFormSignatureRef.current = JSON.stringify(form);
      // The saved signature changes without changing `form`, so the dirty
      // effect does not necessarily rerun. Clear the parent guard immediately
      // before the drawer's delayed close callback executes.
      onUnsavedChange?.(false);
      setSaved(true);
      if (onSaved) {
        if (typeof window !== "undefined") {
          window.setTimeout(() => onSaved(), 900);
        } else {
          onSaved();
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/ai_preferred_engine|ai_commercial_level|ai_main_goal|ai_preferred_angle|ai_liked_example|ai_language/i.test(message)) {
        setError(i18nT("il_faut_d_abord_executer_le_eaabb47e"));
      } else {
        setError(getSimpleFrenchErrorMessage(e, "Impossible d’enregistrer la configuration IA."));
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setForm({ ...initialForm, language: readDefaultAppLanguage() });
    setSaved(false);
    setError("");
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(AI_LANGUAGE_CUSTOM_STORAGE_KEY);
    } catch {}
  };

  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0, maxWidth: "100%", overflowX: "hidden" }}>
      <div style={signatureCard}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -36,
            top: -44,
            width: 130,
            height: 130,
            borderRadius: 999,
            background: "radial-gradient(circle, rgba(251,191,36,0.30), transparent 66%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ fontSize: "clamp(16px, 4.6vw, 18px)", fontWeight: 950, color: "rgba(255,255,255,0.98)", marginBottom: 8, lineHeight: 1.25, overflowWrap: "break-word" }}>
          {i18nT("votre_signature_ia_329379e6")}{" "}</div>
        <div style={{ color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: 1.55, maxWidth: 560, overflowWrap: "break-word" }}>
          {i18nT("reglez_une_fois_votre_facon_de_4a141f29")}{" "}</div>
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}>{i18nT("chargement_01cba1df")}</div>
        ) : (
          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                <div style={sectionTitle}>{i18nT("moteur_ia_a7f9dad3")}</div>
                <button
                  type="button"
                  onClick={() => setEngineInfoOpen(true)}
                  aria-label={i18nT("informations_sur_les_moteurs_ia_499c34b6")}
                  title={i18nT("informations_sur_les_moteurs_ia_499c34b6")}
                  style={{
                    width: 19,
                    height: 19,
                    borderRadius: 999,
                    border: "1px solid rgba(125,211,252,0.44)",
                    background: "rgba(125,211,252,0.12)",
                    color: "#bae6fd",
                    display: "inline-grid",
                    placeItems: "center",
                    padding: 0,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 950,
                    lineHeight: 1,
                  }}
                >
                  i
                </button>
              </div>
              <label style={label}>
                <span style={labelTitle}>{i18nT("choisir_votre_moteur_preferentiel_05cc6c63")}</span>
                <select
                  style={input}
                  value={form.preferredEngine}
                  onChange={(e) => set("preferredEngine", e.target.value as AiConfigForm["preferredEngine"])}
                >
                  {AI_ENGINE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} style={selectOption}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span style={hint}>
                  {i18nT("tendance_f01115d3")}{" "}{selectedEngineOption.naturalTendency} {" "}{i18nT("inrcy_garde_vos_regles_metier_3bcab680")}{" "}{!selectedEngineOption.supportsVision
                    ? i18nT("les_images_passent_par_une_analyse_95521dc0")
                    : ""}
                </span>
              </label>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={sectionTitle}>{i18nT("style_des_contenus_c6452c23")}</div>
              <div style={grid2}>
                <label style={label}>
                  <span style={labelTitle}>{i18nT("ton_du_contenu_10a3083a")}</span>
                  <select style={input} value={form.tone} onChange={(e) => set("tone", e.target.value as AiConfigForm["tone"])}>
                    <option value="serious" style={selectOption}>{i18nT("serieux_5157cfa7")}</option>
                    <option value="warm" style={selectOption}>{i18nT("chaleureux_dc07a406")}</option>
                    <option value="fun" style={selectOption}>{i18nT("fun_5f941ab6")}</option>
                    <option value="premium" style={selectOption}>{i18nT("premium_6c2f2888")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("style_du_texte_0187c8e2")}</span>
                  <select style={input} value={form.textStyle} onChange={(e) => set("textStyle", e.target.value as AiConfigForm["textStyle"])}>
                    <option value="simple" style={selectOption}>{i18nT("simple_et_clair_72318cdd")}</option>
                    <option value="dynamic" style={selectOption}>{i18nT("dynamique_8773c690")}</option>
                    <option value="expert" style={selectOption}>{i18nT("conseil_d_expert_69d781fc")}</option>
                    <option value="coulisses" style={selectOption}>{i18nT("coulisses_histoire_7ac223f9")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("originalite_dac73a39")}</span>
                  <select style={input} value={form.originality} onChange={(e) => set("originality", e.target.value as AiConfigForm["originality"])}>
                    <option value="classic" style={selectOption}>{i18nT("classique_21d58b2b")}</option>
                    <option value="balanced" style={selectOption}>{i18nT("equilibree_dc8d254a")}</option>
                    <option value="creative" style={selectOption}>{i18nT("creative_e62adb99")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("longueur_26218b9b")}</span>
                  <select style={input} value={form.length} onChange={(e) => set("length", e.target.value as AiConfigForm["length"])}>
                    <option value="short" style={selectOption}>{i18nT("court_65dfd1c0")}</option>
                    <option value="medium" style={selectOption}>{i18nT("moyen_de03c108")}</option>
                    <option value="detailed" style={selectOption}>{i18nT("detaille_6a3d00d4")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("emojis_ac171aac")}</span>
                  <select style={input} value={form.emojiLevel} onChange={(e) => set("emojiLevel", e.target.value as AiConfigForm["emojiLevel"])}>
                    <option value="none" style={selectOption}>{i18nT("aucun_b2ed82f1")}</option>
                    <option value="light" style={selectOption}>{i18nT("leger_8ad52b02")}</option>
                    <option value="dynamic" style={selectOption}>{i18nT("beaucoup_32bb785f")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("langue_du_contenu_genere_04491b9a")}</span>
                  <select style={input} value={form.language} onChange={(e) => setGenerationLanguage(e.target.value as AiConfigForm["language"])}>
                    {APP_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} style={selectOption}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={sectionTitle}>{i18nT("facon_de_parler_aa932a4e")}</div>
              <div style={grid2}>
                <label style={label}>
                  <span style={labelTitle}>{i18nT("pronom_utilise_70514e6c")}</span>
                  <select style={input} value={form.pronoun} onChange={(e) => set("pronoun", e.target.value as AiConfigForm["pronoun"])}>
                    <option value="je" style={selectOption}>{i18nT("je_a207fb96")}</option>
                    <option value="nous" style={selectOption}>{i18nT("nous_1a432a70")}</option>
                    <option value="vous" style={selectOption}>{i18nT("vous_ac3daf66")}</option>
                    <option value="neutral" style={selectOption}>{i18nT("neutre_8984c075")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("relation_avec_le_lecteur_828bcf75")}</span>
                  <select style={input} value={form.addressMode} onChange={(e) => set("addressMode", e.target.value as AiConfigForm["addressMode"])}>
                    <option value="vous" style={selectOption}>{i18nT("vouvoiement_c5254349")}</option>
                    <option value="tu" style={selectOption}>{i18nT("tutoiement_01debf43")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("niveau_commercial_eb602ac7")}</span>
                  <select style={input} value={form.commercialLevel} onChange={(e) => set("commercialLevel", e.target.value as AiConfigForm["commercialLevel"])}>
                    <option value="discreet" style={selectOption}>{i18nT("discret_ddf3fbc7")}</option>
                    <option value="balanced" style={selectOption}>{i18nT("equilibre_4e3141e0")}</option>
                    <option value="direct" style={selectOption}>{i18nT("direct_bc81524a")}</option>
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={sectionTitle}>{i18nT("objectif_des_contenus_2c129870")}</div>
              <div style={grid2}>
                <label style={label}>
                  <span style={labelTitle}>{i18nT("objectif_principal_cbb91d55")}</span>
                  <select style={input} value={form.mainGoal} onChange={(e) => set("mainGoal", e.target.value as AiConfigForm["mainGoal"])}>
                    <option value="visibility" style={selectOption}>{i18nT("faire_connaitre_l_entreprise_b8357544")}</option>
                    <option value="contacts" style={selectOption}>{i18nT("obtenir_des_contacts_e3239ba6")}</option>
                    <option value="reassure" style={selectOption}>{i18nT("rassurer_les_clients_6b36d862")}</option>
                    <option value="offer" style={selectOption}>{i18nT("mettre_en_avant_une_offre_bcabf361")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("angle_prefere_082c1a4d")}</span>
                  <select style={input} value={form.preferredAngle} onChange={(e) => set("preferredAngle", e.target.value as AiConfigForm["preferredAngle"])}>
                    <option value="local" style={selectOption}>{i18nT("local_proximite_fbac0b33")}</option>
                    <option value="quality" style={selectOption}>{i18nT("qualite_du_travail_7ea25fd2")}</option>
                    <option value="price" style={selectOption}>{i18nT("prix_avantage_911e00ab")}</option>
                    <option value="speed" style={selectOption}>{i18nT("rapidite_reactivite_a93ebdbd")}</option>
                    <option value="trust" style={selectOption}>{i18nT("confiance_7b2239f6")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("bouton_prefere_636a62cc")}</span>
                  <select style={input} value={form.preferredCta} onChange={(e) => set("preferredCta", e.target.value as AiConfigForm["preferredCta"])}>
                    {BOOSTER_PREFERRED_CTA_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value} style={selectOption}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={sectionTitle}>{i18nT("inspiration_limites_9c94746f")}</div>
              <label style={label}>
                <span style={labelTitle}>{i18nT("exemple_de_contenu_que_vous_aimez_1b4d869b")}</span>
                <textarea
                  style={{ ...input, minHeight: 112, resize: "vertical", lineHeight: 1.45 }}
                  value={form.likedExample}
                  maxLength={1200}
                  onChange={(e) => set("likedExample", e.target.value.slice(0, 1200))}
                  placeholder={i18nT("collez_ici_une_publication_que_vous_8dbef14d")}
                />
                <span style={hint}>{i18nT("optionnel_mais_tres_puissant_pour_obtenir_2bd4cf4f")}</span>
              </label>

              <label style={label}>
                <span style={labelTitle}>{i18nT("a_eviter_absolument_81a0d9e0")}</span>
                <textarea
                  style={{ ...input, minHeight: 96, resize: "vertical", lineHeight: 1.45 }}
                  value={form.forbiddenStyle}
                  maxLength={700}
                  onChange={(e) => set("forbiddenStyle", e.target.value.slice(0, 700))}
                  placeholder={i18nT("ex_eviter_un_ton_trop_commercial_e0c64d10")}
                />
                <span style={hint}>{i18nT("mots_promesses_ou_tournures_qui_ne_e49a83bd")}</span>
              </label>
            </div>

            {error ? <div style={{ color: "rgba(248,113,113,0.95)", fontWeight: 800 }}>{error}</div> : null}
            {saved ? <div style={{ color: "rgba(34,197,94,0.95)", fontWeight: 900 }}>{i18nT("configuration_ia_enregistree_1ad4bba6")}</div> : null}

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", minWidth: 0, maxWidth: "100%" }}>
              <button type="button" style={primaryBtn} disabled={saving} onClick={save}>{saving ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_f7c8bcd8")}</button>
              <button type="button" disabled={saving} onClick={reset} style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "white", borderRadius: 14, padding: "10px 12px", cursor: saving ? "default" : "pointer", fontWeight: 900, fontSize: 16 }}>
                {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ ...card, color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 1.45 }}>
        {i18nT("astuce_plus_mon_activite_et_votre_9776da1b")}{" "}</div>
      <AiEngineInfoModal
        open={engineInfoOpen}
        activeEngine={form.preferredEngine}
        onClose={() => setEngineInfoOpen(false)}
      />
    </div>
  );
}
