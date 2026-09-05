"use client";

import { useTranslations } from "next-intl";


import {
  readAccountCacheValue,
  resolveActiveBrowserUserId,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabaseClient";
import { APP_LANGUAGE_OPTIONS, APP_LANGUAGE_STORAGE_KEY, type AppLanguageCode, normalizeAppLanguage } from "@/lib/appLanguage";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import {
  AI_ENGINE_OPTIONS,
  getAiEngineOption,
} from "@/lib/aiEnginePreference";
import {
  BOOSTER_PREFERRED_CTA_OPTIONS,
} from "../../booster/publier/publishModal.shared";
import AiEngineInfoModal from "../../_components/AiEngineInfoModal";
import {
  enforceAiContentLengthForEdition,
  type AiContentLength,
} from "@/lib/aiContentLength";
import { hasPremiumDashboardAccess, type DashboardEdition } from "@/lib/dashboardEdition";
import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  DEFAULT_AI_CONFIGURATION_FORM,
  resolveCompatibleAiConfiguration,
  selectAiConfigurationCache,
  type AiConfigurationFormValues,
} from "@/lib/aiConfigurationCompatibility";

type Props = {
  edition?: DashboardEdition;
  onOpenAiMemory?: () => void;
  onSaved?: () => void | Promise<void>;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  hideAiMemoryShortcut?: boolean;
  workspaceMode?: boolean;
};

type AiConfigurationTab = "parameters" | "instructions";

function configurationSignature(form: AiConfigForm) {
  return JSON.stringify(form);
}

type AiConfigForm = AiConfigurationFormValues;

type ContentLengthSelectProps = {
  value: AiContentLength;
  onChange: (value: AiContentLength) => void;
  premiumAccess: boolean;
  ariaLabel: string;
  premiumLabel: string;
  labels: Record<AiContentLength, string>;
  controlStyle: React.CSSProperties;
};

const CONTENT_LENGTH_VALUES: AiContentLength[] = ["adapted", "short", "medium", "long", "deep"];

function ContentLengthSelect({
  value,
  onChange,
  premiumAccess,
  ariaLabel,
  premiumLabel,
  labels,
  controlStyle,
}: ContentLengthSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties | null>(null);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const estimatedMenuHeight = 208;
      const openAbove = window.innerHeight - rect.bottom < estimatedMenuHeight + 14 && rect.top > estimatedMenuHeight + 14;
      setMenuPosition({
        left: rect.left,
        top: openAbove ? rect.top - 6 : rect.bottom + 6,
        width: rect.width,
        transform: openAbove ? "translateY(-100%)" : undefined,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      data-content-length-select
      data-open={open ? "true" : "false"}
      style={{ position: "relative", zIndex: open ? 60 : 1, minWidth: 0 }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        style={{
          ...controlStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span>{labels[value]}</span>
        <span aria-hidden style={{ color: "rgba(255,255,255,.72)", fontSize: 12 }}>{open ? "⌃" : "⌄"}</span>
      </button>
      {open && menuPosition && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          style={{ ...contentLengthMenuStyle, ...menuPosition }}
        >
          {CONTENT_LENGTH_VALUES.map((optionValue) => {
            const premiumOption = optionValue === "deep";
            const locked = premiumOption && !premiumAccess;
            const selected = optionValue === value;
            return (
              <button
                key={optionValue}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={locked || undefined}
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  onChange(optionValue);
                  setOpen(false);
                }}
                style={{
                  ...contentLengthOptionStyle,
                  ...(selected ? contentLengthSelectedOptionStyle : {}),
                  ...(locked ? contentLengthLockedOptionStyle : {}),
                }}
              >
                <span>{labels[optionValue]}</span>
                {premiumOption ? <span style={contentLengthPremiumPillStyle}>{premiumLabel}</span> : null}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

const TABLE = "business_profiles";
const STORAGE_KEY = "inrcy_ai_configuration";
const AI_LANGUAGE_CUSTOM_STORAGE_KEY = "inrcy_ai_language_custom_v1";

const initialForm: AiConfigForm = DEFAULT_AI_CONFIGURATION_FORM;

const selectOption: React.CSSProperties = { color: "#f8fafc", background: "#111831" };
const configurationTabsStyle: React.CSSProperties = {
  position: "sticky",
  top: 55,
  zIndex: 15,
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
  padding: 7,
  borderRadius: 17,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(5,13,28,0.94)",
  boxShadow: "0 12px 34px rgba(0,0,0,0.25)",
  backdropFilter: "blur(18px)",
};
const configurationTabStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 8,
  borderRadius: 11,
  border: "1px solid transparent",
  background: "transparent",
  color: "rgba(255,255,255,0.68)",
  padding: "10px 8px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 900,
};
const activeConfigurationTabStyle: React.CSSProperties = {
  border: "1px solid rgba(251,191,36,0.30)",
  background: "linear-gradient(135deg, rgba(251,191,36,0.13), rgba(124,58,237,0.17))",
  color: "#fef3c7",
  boxShadow: "0 7px 22px rgba(251,191,36,0.08)",
};
const workspaceConfigurationTabsStyle: React.CSSProperties = {
  position: "relative",
  top: "auto",
  zIndex: 2,
  padding: 6,
  boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
};
const defaultParametersGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 14,
};
const workspaceParametersGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gridAutoRows: "1fr",
  alignItems: "stretch",
  gap: 17,
};
const workspaceVoiceGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  alignItems: "start",
  gap: "14px 16px",
  minWidth: 0,
};
const defaultActionsStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
  minWidth: 0,
  maxWidth: "100%",
};
const workspaceActionsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(105px, 145px) minmax(210px, 300px)",
  justifyContent: "end",
  gap: 9,
  minWidth: 0,
  maxWidth: "100%",
};
const contentLengthMenuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 10000,
  display: "grid",
  gap: 3,
  padding: 6,
  borderRadius: 13,
  border: "1px solid rgba(148,163,184,.24)",
  background: "#090f25",
  boxShadow: "0 18px 42px rgba(0,0,0,.45)",
  maxHeight: "min(250px, calc(100dvh - 24px))",
  overflowY: "auto",
};
const contentLengthOptionStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "7px 9px",
  borderRadius: 9,
  border: "1px solid transparent",
  background: "#101831",
  color: "rgba(255,255,255,.88)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 750,
  textAlign: "left",
};
const contentLengthSelectedOptionStyle: React.CSSProperties = {
  border: "1px solid rgba(125,211,252,.22)",
  background: "#202451",
  color: "white",
};
const contentLengthLockedOptionStyle: React.CSSProperties = {
  color: "rgba(203,213,225,.46)",
  background: "#11162b",
  cursor: "not-allowed",
};
const contentLengthPremiumPillStyle: React.CSSProperties = {
  flex: "0 0 auto",
  borderRadius: 999,
  border: "1px solid rgba(251,191,36,.42)",
  background: "rgba(251,191,36,.12)",
  color: "#fde68a",
  padding: "2px 6px",
  fontSize: 8.5,
  fontWeight: 950,
  letterSpacing: ".045em",
  textTransform: "uppercase",
};
const styleSecondaryFieldsStyle: React.CSSProperties = {
  gridColumn: "1 / -1",
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  alignItems: "start",
  gap: 16,
  minWidth: 0,
};
const styleSecondaryFieldStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "auto auto auto",
  alignContent: "start",
  gap: 6,
  minWidth: 0,
};
const instructionExamplesGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  alignItems: "stretch",
  gap: 16,
  minWidth: 0,
};
const instructionPanelStyle: React.CSSProperties = {
  minWidth: 0,
  padding: 14,
  borderRadius: 14,
  border: "1px solid rgba(125,211,252,0.13)",
  background: "#101831",
};

const hasLanguageValue = (value: unknown): boolean => String(value ?? "").trim().length > 0;

function readDefaultAppLanguage(): AppLanguageCode {
  if (typeof window === "undefined") return initialForm.language;
  try {
    return normalizeAppLanguage(window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY));
  } catch {
    return initialForm.language;
  }
}

function readAiLanguageIsCustom(
  local: Partial<Record<string, unknown>>,
  activeUserId: string | null,
  authUserId: string | null,
): boolean {
  if (typeof window === "undefined") return hasLanguageValue(local.language);
  let legacyGlobalValue: string | null = null;
  try { legacyGlobalValue = window.localStorage.getItem(AI_LANGUAGE_CUSTOM_STORAGE_KEY); } catch {}
  const selected = selectAiConfigurationCache({
    scopedValue: activeUserId
      ? readAccountCacheValue(AI_LANGUAGE_CUSTOM_STORAGE_KEY, activeUserId)
      : null,
    legacyGlobalValue,
    activeUserId,
    authUserId,
  });
  return selected.rawValue === "1" || hasLanguageValue(local.language);
}

function markAiLanguageCustom(activeUserId: string | null) {
  if (!activeUserId) return;
  writeAccountCacheValue(AI_LANGUAGE_CUSTOM_STORAGE_KEY, "1", activeUserId);
}

export default function AiConfigurationContent({
  edition = "standard",
  onOpenAiMemory,
  onSaved,
  onUnsavedChange,
  hideAiMemoryShortcut = false,
  workspaceMode = false,
}: Props) {
  const i18nT = useTranslations("settings");
  const sectionT = useTranslations("dashboard.settingsSections");
  const memoryT = useTranslations("dashboard.aiMemory");
  const configurationT = useTranslations("dashboard.aiConfiguration");
  const premiumAccess = hasPremiumDashboardAccess(edition);
  const [activeTab, setActiveTab] = useState<AiConfigurationTab>("parameters");
  const [form, setForm] = useState<AiConfigForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [engineInfoOpen, setEngineInfoOpen] = useState(false);
  const savedFormSignatureRef = useRef("");
  const loadSucceededRef = useRef(false);
  const activeUserIdRef = useRef<string | null>(null);
  const selectedEngineOption = getAiEngineOption(form.preferredEngine);

  useEffect(() => {
    if (loading) {
      onUnsavedChange?.(false);
      return;
    }
    onUnsavedChange?.(
      savedFormSignatureRef.current !== "" && savedFormSignatureRef.current !== configurationSignature(form),
    );
  }, [form, loading, onUnsavedChange]);

  const card: React.CSSProperties = useMemo(() => ({
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    padding: workspaceMode ? "clamp(16px, 1.35vw, 21px)" : "clamp(12px, 3.6vw, 16px)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.045)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  }), [workspaceMode]);

  const signatureCard: React.CSSProperties = useMemo(() => ({
    ...card,
    position: "relative",
    overflow: "hidden",
    border: "1px solid rgba(251,191,36,0.22)",
    background:
      "linear-gradient(135deg, rgba(251,191,36,0.18), rgba(56,189,248,0.16), rgba(167,139,250,0.18), rgba(244,114,182,0.14))",
    boxShadow: "0 20px 60px rgba(0,0,0,0.22), 0 0 34px rgba(251,191,36,0.12), inset 0 1px 0 rgba(255,255,255,0.10)",
  }), [card]);

  const configurationCard: React.CSSProperties = useMemo(() => ({
    ...card,
    position: "relative",
    overflow: "visible",
    display: "grid",
    gap: workspaceMode ? 16 : 18,
    border: "1px solid rgba(125,211,252,0.16)",
    background:
      "linear-gradient(145deg, rgba(14,31,58,0.7), rgba(35,25,64,0.54))",
    boxShadow: "0 16px 42px rgba(0,0,0,0.18)",
  }), [card, workspaceMode]);

  const configurationHeader: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 11,
    paddingBottom: workspaceMode ? 12 : 12,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  };

  const configurationBubble: React.CSSProperties = {
    width: 32,
    height: 32,
    flex: "0 0 auto",
    display: "grid",
    placeItems: "center",
    borderRadius: 11,
    border: "1px solid rgba(251,191,36,0.34)",
    background: "rgba(251,191,36,0.13)",
    color: "#fde68a",
    fontWeight: 950,
  };

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
    minHeight: workspaceMode ? 38 : 44,
    boxSizing: "border-box",
    fontSize: 15,
    lineHeight: 1.35,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#171d38",
    padding: workspaceMode ? "8px 10px" : "10px 12px",
    color: "white",
    outline: "none",
  }), [workspaceMode]);

  const label: React.CSSProperties = { display: "grid", gap: workspaceMode ? 5 : 8, minWidth: 0, maxWidth: "100%" };
  const labelTitle: React.CSSProperties = { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 800, lineHeight: 1.25 };
  const hint: React.CSSProperties = { color: "rgba(255,255,255,0.65)", fontSize: workspaceMode ? 11 : 12, lineHeight: 1.35 };
  const grid2: React.CSSProperties = { display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", minWidth: 0, maxWidth: "100%" };
  const primaryBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "linear-gradient(135deg, rgba(251,191,36,.35), rgba(97,87,255,.28), rgba(0,200,255,.22))",
    color: "white",
    borderRadius: 14,
    minHeight: workspaceMode ? 38 : 44,
    padding: workspaceMode ? "8px 11px" : "10px 12px",
    cursor: saving ? "default" : "pointer",
    fontWeight: 900,
    fontSize: workspaceMode ? 12.5 : 16,
    width: "100%",
    opacity: saving ? 0.7 : 1,
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      loadSucceededRef.current = false;
      try {
        const supabase = createClient();
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw new Error(authErr.message);
        const user = authData?.user;
        const activeUserId = user ? resolveActiveBrowserUserId(user.id) : null;
        activeUserIdRef.current = activeUserId;

        let legacyGlobalValue: string | null = null;
        try { legacyGlobalValue = localStorage.getItem(STORAGE_KEY); } catch {}
        const cacheSelection = selectAiConfigurationCache({
          scopedValue: activeUserId
            ? readAccountCacheValue(STORAGE_KEY, activeUserId)
            : null,
          legacyGlobalValue,
          activeUserId,
          authUserId: user?.id || null,
        });
        let local: Record<string, unknown> = {};
        let validLocalCache = false;
        try {
          const parsed = JSON.parse(cacheSelection.rawValue || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            local = parsed as Record<string, unknown>;
            validLocalCache = true;
          }
        } catch {}
        if (cacheSelection.source === "legacy-global" && activeUserId && validLocalCache) {
          // Migration douce : on garde la clé historique mais toutes les
          // prochaines lectures de ce compte passent par sa clé dédiée.
          writeAccountCacheValue(STORAGE_KEY, JSON.stringify(local), activeUserId);
        }

        const appDefaultLanguage = readDefaultAppLanguage();
        const aiLanguageIsCustom = readAiLanguageIsCustom(local, activeUserId, user?.id || null);
        let businessProfile: Record<string, unknown> | null = null;
        let useDbLanguage = false;
        if (user) {
          const { data, error: dbErr } = await supabase
            .from(TABLE)
            .select("*")
            .eq("user_id", activeUserId)
            .maybeSingle();
          if (dbErr) throw new Error(dbErr.message);
          businessProfile = data as Record<string, unknown> | null;
          const dbLanguage = hasLanguageValue(data?.ai_language)
            ? normalizeAppLanguage(data?.ai_language)
            : undefined;
          useDbLanguage = Boolean(
            dbLanguage && (aiLanguageIsCustom || dbLanguage !== initialForm.language),
          );
        }

        const nextForm = resolveCompatibleAiConfiguration({
          local,
          businessProfile,
          edition,
          appDefaultLanguage,
          useDbLanguage,
        });
        setForm(nextForm);
        savedFormSignatureRef.current = configurationSignature(nextForm);
        loadSucceededRef.current = true;
      } catch (e) {
        loadSucceededRef.current = false;
        setError(getClientUserFacingErrorMessage(e, i18nT("ai_configuration_load_failed")));
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
    markAiLanguageCustom(activeUserIdRef.current);
    set("language", value);
  };

  const save = async () => {
    if (saving) return;
    if (!loadSucceededRef.current) {
      setError(i18nT("ai_configuration_load_failed"));
      return;
    }
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const safeWebLength = enforceAiContentLengthForEdition(form.webLength, edition);
      const safeSocialLength = enforceAiContentLengthForEdition(form.socialLength, edition);
      const safeForm = {
        ...form,
        webLength: safeWebLength,
        socialLength: safeSocialLength,
      };
      const supabase = createClient();
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw new Error(authErr.message);
      const user = authData?.user;
      const activeUserId = user ? resolveActiveBrowserUserId(user.id) : activeUserIdRef.current;
      activeUserIdRef.current = activeUserId;
      if (activeUserId) {
        writeAccountCacheValue(STORAGE_KEY, JSON.stringify(safeForm), activeUserId);
        markAiLanguageCustom(activeUserId);
      }
      if (user) {
        const basePayload = {
          user_id: activeUserId,
          ai_preferred_engine: form.preferredEngine,
          tone: form.tone,
          preferred_cta: form.preferredCta,
          communication_style: form.textStyle,
          emoji_level: form.emojiLevel,
          // Compatibilité descendante : les anciens clients continuent à
          // comprendre ai_length jusqu'à leur migration complète.
          ai_length: safeSocialLength === "long" || safeSocialLength === "deep"
            ? "detailed"
            : safeSocialLength === "adapted"
              ? "medium"
              : safeSocialLength,
          ai_web_length: safeWebLength,
          ai_social_length: safeSocialLength,
          address_mode: form.addressMode,
          ai_voice: form.pronoun,
          ai_creativity: form.originality,
          ai_commercial_level: form.commercialLevel,
          ai_technicality_level: form.technicalityLevel,
          ai_humor_level: form.humorLevel,
          ai_main_goal: form.mainGoal,
          ai_preferred_angle: form.preferredAngle,
          ai_language: form.language,
          ai_liked_example: form.likedExample.trim(),
          ai_custom_instructions: form.forbiddenStyle.trim(),
          updated_at: new Date().toISOString(),
        };
        let { error: upErr } = await supabase.from(TABLE).upsert(
          { ...basePayload, ai_liked_example_2: form.likedExample2.trim() },
          { onConflict: "user_id" },
        );
        if (upErr && /ai_liked_example_2|schema cache|column/i.test(upErr.message)) {
          ({ error: upErr } = await supabase.from(TABLE).upsert(basePayload, { onConflict: "user_id" }));
        }
        if (upErr) throw new Error(upErr.message);
        await invalidateBoosterGenerationContextClient("professional");
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("inrcy:ai-configuration-updated", {
          detail: {
              aiPreferredEngine: form.preferredEngine,
              aiLanguage: form.language,
              preferredCta: form.preferredCta,
              aiWebLength: safeWebLength,
              aiSocialLength: safeSocialLength,
          },
        }));
      }

      if (safeWebLength !== form.webLength || safeSocialLength !== form.socialLength) {
        setForm(safeForm);
      }
      savedFormSignatureRef.current = configurationSignature(safeForm);
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
      if (/ai_preferred_engine|ai_commercial_level|ai_technicality_level|ai_humor_level|ai_main_goal|ai_preferred_angle|ai_liked_example|ai_language|ai_web_length|ai_social_length/i.test(message)) {
        setError(i18nT("il_faut_d_abord_executer_le_eaabb47e"));
      } else {
        setError(getClientUserFacingErrorMessage(e, i18nT("ai_configuration_save_failed")));
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const confirmed = await confirmInrcy({
      title: configurationT("resetTitle"),
      message: configurationT("resetMessage"),
      confirmLabel: configurationT("resetConfirm"),
      variant: "warning",
    });
    if (!confirmed) return;
    setForm({ ...initialForm, language: readDefaultAppLanguage() });
    setSaved(false);
    setError("");
    const activeUserId = activeUserIdRef.current;
    if (activeUserId) {
      // La valeur scopée vide empêche l'ancienne clé globale d'être réimportée
      // après une réinitialisation volontaire.
      writeAccountCacheValue(STORAGE_KEY, "{}", activeUserId);
      writeAccountCacheValue(AI_LANGUAGE_CUSTOM_STORAGE_KEY, "0", activeUserId);
    }
  };

  return (
    <div
      data-ai-configuration-workspace={workspaceMode ? "true" : "false"}
      style={{ display: "grid", gap: workspaceMode ? 13 : 16, minWidth: 0, maxWidth: "100%", overflow: "visible" }}
    >
      {!workspaceMode ? <div style={signatureCard}>
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
      </div> : null}

      {!hideAiMemoryShortcut ? (
        <button
          type="button"
          onClick={onOpenAiMemory}
          style={{
            ...card,
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 1fr) auto",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
            color: "white",
            cursor: "pointer",
            border: "1px solid rgba(167,139,250,0.34)",
            background: "linear-gradient(135deg, rgba(124,58,237,0.19), rgba(14,165,233,0.12))",
          }}
        >
          <span aria-hidden style={{ fontSize: 24 }}>🧠</span>
          <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{memoryT("openTitle")}</strong>
            <span style={hint}>{memoryT("openDescription")}</span>
          </span>
          <span aria-hidden style={{ color: "#c4b5fd", fontSize: 20 }}>›</span>
        </button>
      ) : null}

      <nav
        aria-label={configurationT("tabsLabel")}
        role="tablist"
        style={{
          ...configurationTabsStyle,
          ...(workspaceMode ? workspaceConfigurationTabsStyle : {}),
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "parameters"}
          onClick={() => setActiveTab("parameters")}
          style={{
            ...configurationTabStyle,
            ...(activeTab === "parameters" ? activeConfigurationTabStyle : {}),
          }}
        >
          <span aria-hidden>⚙️</span>
          <span>{configurationT("tabParameters")}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "instructions"}
          onClick={() => setActiveTab("instructions")}
          style={{
            ...configurationTabStyle,
            ...(activeTab === "instructions" ? activeConfigurationTabStyle : {}),
          }}
        >
          <span aria-hidden>🧭</span>
          <span>{configurationT("tabInstructions")}</span>
        </button>
      </nav>

      <div style={loading ? card : { display: "grid", gap: 12 }}>
        {loading ? (
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}>{i18nT("chargement_01cba1df")}</div>
        ) : (
          <div style={{ display: "grid", gap: workspaceMode ? 14 : 14 }}>
            {activeTab === "parameters" ? (
              <div
                data-ai-parameters-grid={workspaceMode ? "workspace" : "default"}
                style={workspaceMode ? workspaceParametersGridStyle : defaultParametersGridStyle}
              >
            <section data-ai-section="foundation" style={workspaceMode ? { ...configurationCard, height: "100%" } : configurationCard}>
              <div style={configurationHeader}>
                <span style={configurationBubble}>1</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 950 }}>
                    {sectionT("aiFoundationTitle")}
                  </div>
                  <div style={hint}>{sectionT("aiFoundationDescription")}</div>
                </div>
              </div>

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

              <label style={label}>
                <span style={labelTitle}>{i18nT("langue_du_contenu_genere_04491b9a")}</span>
                <select style={input} value={form.language} onChange={(e) => setGenerationLanguage(e.target.value as AiConfigForm["language"])}>
                  {APP_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} style={selectOption}>{option.label}</option>
                  ))}
                </select>
              </label>
            </section>

            <section data-ai-section="style" style={workspaceMode ? { ...configurationCard, height: "100%", zIndex: 4 } : configurationCard}>
              <div style={configurationHeader}>
                <span style={configurationBubble}>2</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 950 }}>
                    {i18nT("style_des_contenus_c6452c23")}
                  </div>
                  <div style={hint}>{sectionT("aiVoiceDescription")}</div>
                </div>
              </div>

              <div data-ai-card-fields style={workspaceMode ? workspaceVoiceGridStyle : grid2}>
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
                    <option value="local_humain" style={selectOption}>{configurationT("styleLocalHuman")}</option>
                    <option value="dynamic" style={selectOption}>{i18nT("dynamique_8773c690")}</option>
                    <option value="expert" style={selectOption}>{i18nT("conseil_d_expert_69d781fc")}</option>
                    <option value="premium" style={selectOption}>{configurationT("stylePremium")}</option>
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

                <div
                  data-content-length-group
                  data-content-length-fields
                  data-style-secondary-fields
                  style={styleSecondaryFieldsStyle}
                >
                  <div style={styleSecondaryFieldStyle}>
                    <span style={labelTitle}>{memoryT("contentLengthTitle")}</span>
                    <ContentLengthSelect
                      value={form.webLength}
                      onChange={(next) => set("webLength", next)}
                      premiumAccess={premiumAccess}
                      ariaLabel={`${memoryT("contentLengthTitle")} — ${memoryT("webLengthLabel")}`}
                      premiumLabel={memoryT("premiumBadge")}
                      labels={{
                        adapted: memoryT("lengthAdapted"),
                        short: memoryT("lengthShort"),
                        medium: memoryT("lengthMedium"),
                        long: memoryT("lengthLong"),
                        deep: memoryT("lengthDeepPremium").split("—")[0]?.trim() || memoryT("lengthDeepPremium"),
                      }}
                      controlStyle={input}
                    />
                    <span style={hint}>{memoryT("webLengthLabel")}</span>
                  </div>

                  <div style={styleSecondaryFieldStyle}>
                    <span style={labelTitle}>{memoryT("contentLengthTitle")}</span>
                    <ContentLengthSelect
                      value={form.socialLength}
                      onChange={(next) => set("socialLength", next)}
                      premiumAccess={premiumAccess}
                      ariaLabel={`${memoryT("contentLengthTitle")} — ${memoryT("socialLengthLabel")}`}
                      premiumLabel={memoryT("premiumBadge")}
                      labels={{
                        adapted: memoryT("lengthAdapted"),
                        short: memoryT("lengthShort"),
                        medium: memoryT("lengthMedium"),
                        long: memoryT("lengthLong"),
                        deep: memoryT("lengthDeepPremium").split("—")[0]?.trim() || memoryT("lengthDeepPremium"),
                      }}
                      controlStyle={input}
                    />
                    <span style={hint}>{memoryT("socialLengthLabel")}</span>
                  </div>

                  <label style={styleSecondaryFieldStyle}>
                    <span style={labelTitle}>{i18nT("emojis_ac171aac")}</span>
                    <select style={input} value={form.emojiLevel} onChange={(e) => set("emojiLevel", e.target.value as AiConfigForm["emojiLevel"])}>
                      <option value="none" style={selectOption}>{i18nT("aucun_b2ed82f1")}</option>
                      <option value="light" style={selectOption}>{i18nT("leger_8ad52b02")}</option>
                      <option value="dynamic" style={selectOption}>{i18nT("beaucoup_32bb785f")}</option>
                    </select>
                    <span style={hint}>{configurationT("emojiHint")}</span>
                  </label>
                </div>

              </div>

            </section>

            <section data-ai-section="voice" style={workspaceMode ? { ...configurationCard, height: "100%" } : configurationCard}>
              <div style={configurationHeader}>
                <span style={configurationBubble}>3</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 950 }}>
                    {i18nT("facon_de_parler_aa932a4e")}
                  </div>
                  <div style={hint}>{configurationT("voiceCardDescription")}</div>
                </div>
              </div>

              <div data-ai-card-fields style={workspaceMode ? workspaceVoiceGridStyle : grid2}>
                <label style={label}>
                  <span style={labelTitle}>{i18nT("pronom_utilise_70514e6c")}</span>
                  <select style={input} value={form.pronoun} onChange={(e) => set("pronoun", e.target.value as AiConfigForm["pronoun"])}>
                    <option value="auto" style={selectOption}>{configurationT("voiceAutomatic")}</option>
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

                <label style={label}>
                  <span style={labelTitle}>{configurationT("technicalityLabel")}</span>
                  <select style={input} value={form.technicalityLevel} onChange={(e) => set("technicalityLevel", e.target.value as AiConfigForm["technicalityLevel"])}>
                    <option value="accessible" style={selectOption}>{configurationT("technicalityAccessible")}</option>
                    <option value="balanced" style={selectOption}>{configurationT("technicalityBalanced")}</option>
                    <option value="expert" style={selectOption}>{configurationT("technicalityExpert")}</option>
                  </select>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{configurationT("humorLabel")}</span>
                  <select style={input} value={form.humorLevel} onChange={(e) => set("humorLevel", e.target.value as AiConfigForm["humorLevel"])}>
                    <option value="none" style={selectOption}>{configurationT("humorNone")}</option>
                    <option value="light" style={selectOption}>{configurationT("humorLight")}</option>
                    <option value="present" style={selectOption}>{configurationT("humorPresent")}</option>
                  </select>
                </label>
              </div>

            </section>

            <section data-ai-section="goals" style={workspaceMode ? { ...configurationCard, height: "100%" } : configurationCard}>
              <div style={configurationHeader}>
                <span style={configurationBubble}>4</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 950 }}>
                    {sectionT("aiGoalsTitle")}
                  </div>
                  <div style={hint}>{sectionT("aiGoalsDescription")}</div>
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

            </section>
              </div>
            ) : null}

            {activeTab === "instructions" ? (
              <section
                data-ai-section="instructions"
                style={configurationCard}
              >
                <div style={configurationHeader}>
                  <span style={configurationBubble}>🧭</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 950 }}>
                      {configurationT("instructionsTitle")}
                    </div>
                    <div style={hint}>{configurationT("instructionsDescription")}</div>
                  </div>
                </div>

                <div data-instruction-examples style={instructionExamplesGridStyle}>
                  <label style={{ ...label, ...instructionPanelStyle }}>
                    <span style={labelTitle}>{configurationT("likedContent1Label")}</span>
                    <textarea
                      style={{ ...input, minHeight: workspaceMode ? 150 : 165, resize: "vertical", lineHeight: 1.45 }}
                      value={form.likedExample}
                      maxLength={1200}
                      onChange={(e) => set("likedExample", e.target.value.slice(0, 1200))}
                      placeholder={configurationT("likedContentPlaceholder")}
                    />
                    <span style={hint}>{configurationT("likedContentHint")}</span>
                  </label>

                  <label style={{ ...label, ...instructionPanelStyle }}>
                    <span style={labelTitle}>{configurationT("likedContent2Label")}</span>
                    <textarea
                      style={{ ...input, minHeight: workspaceMode ? 150 : 165, resize: "vertical", lineHeight: 1.45 }}
                      value={form.likedExample2}
                      maxLength={1200}
                      onChange={(e) => set("likedExample2", e.target.value.slice(0, 1200))}
                      placeholder={configurationT("likedContentPlaceholder")}
                    />
                    <span style={hint}>{configurationT("likedContentHint")}</span>
                  </label>
                </div>

                <label data-custom-instructions style={{ ...label, ...instructionPanelStyle }}>
                  <span style={labelTitle}>{configurationT("customInstructionsLabel")}</span>
                  <textarea
                    style={{ ...input, minHeight: workspaceMode ? 190 : 210, resize: "vertical", lineHeight: 1.45 }}
                    value={form.forbiddenStyle}
                    maxLength={700}
                    onChange={(e) => set("forbiddenStyle", e.target.value.slice(0, 700))}
                    placeholder={configurationT("customInstructionsPlaceholder")}
                  />
                  <span style={hint}>{configurationT("customInstructionsHint")}</span>
                </label>
              </section>
            ) : null}

            {error ? <div style={{ color: "rgba(248,113,113,0.95)", fontWeight: 800 }}>{error}</div> : null}
            {saved ? <div style={{ color: "rgba(34,197,94,0.95)", fontWeight: 900 }}>{i18nT("configuration_ia_enregistree_1ad4bba6")}</div> : null}

            <div
              data-ai-configuration-actions
              style={workspaceMode ? workspaceActionsStyle : defaultActionsStyle}
            >
              <button type="button" disabled={saving} onClick={() => void reset()} style={{ minHeight: workspaceMode ? 38 : 44, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "white", borderRadius: workspaceMode ? 11 : 14, padding: workspaceMode ? "8px 10px" : "10px 12px", cursor: saving ? "default" : "pointer", fontWeight: 850, fontSize: workspaceMode ? 12 : 16 }}>
                {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
              <button type="button" style={primaryBtn} disabled={saving || !loadSucceededRef.current} onClick={() => void save()}>{saving ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_f7c8bcd8")}</button>
            </div>
          </div>
        )}
      </div>

      {!workspaceMode ? (
        <div style={{ ...card, color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 1.45 }}>
          {i18nT("astuce_plus_mon_activite_et_votre_9776da1b")}{" "}
        </div>
      ) : null}
      <style jsx>{`
        @media (max-width: 1120px) {
          div[data-ai-parameters-grid="workspace"] {
            grid-template-columns: 1fr !important;
            grid-auto-rows: auto !important;
          }
        }
        @media (max-width: 760px) {
          [data-ai-card-fields] {
            grid-template-columns: 1fr !important;
          }
          [data-content-length-group] {
            grid-column: 1 !important;
          }
          section[data-ai-section="instructions"] {
            grid-template-columns: 1fr !important;
          }
          [data-instruction-examples],
          [data-style-secondary-fields] {
            grid-template-columns: 1fr !important;
          }
          [data-content-length-fields] {
            grid-template-columns: 1fr !important;
          }
          div[data-ai-configuration-actions] {
            grid-template-columns: minmax(0, .75fr) minmax(0, 1.25fr) !important;
          }
        }
      `}</style>
      <AiEngineInfoModal
        open={engineInfoOpen}
        activeEngine={form.preferredEngine}
        onClose={() => setEngineInfoOpen(false)}
      />
    </div>
  );
}
