"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";
import {
  estimateGeneratorRevenue,
  getGeneratorRecommendation,
  sanitizeGeneratorBusinessSettings,
} from "@/lib/generatorSettings";
import { createClient } from "@/lib/supabaseClient";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

type Props = {
  opportunities: number | null;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.07)",
  color: "white",
  padding: "12px 13px",
  outline: "none",
  fontSize: 16,
  fontWeight: 800,
};

export default function GeneratorSettingsModal({
  opportunities,
  onClose,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avgBasket, setAvgBasket] = useState(250);
  const [conversionRate, setConversionRate] = useState(20);
  const [sector, setSector] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const recommendation = useMemo(
    () => getGeneratorRecommendation(sector),
    [sector],
  );
  const estimate = useMemo(
    () =>
      estimateGeneratorRevenue(opportunities ?? 10, {
        avgBasket,
        conversionRate,
      }),
    [avgBasket, conversionRate, opportunities],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        const supabase = createClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!authData.user) throw new Error("Utilisateur non connecté.");
        const userId = resolveActiveBrowserUserId(authData.user.id);
        const [profileResult, activityResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("avg_basket,lead_conversion_rate")
            .eq("user_id", userId)
            .maybeSingle(),
          supabase
            .from("business_profiles")
            .select("sector")
            .eq("user_id", userId)
            .maybeSingle(),
        ]);
        if (profileResult.error) throw profileResult.error;
        if (activityResult.error) throw activityResult.error;
        if (!active) return;
        const storedSector = activityResult.data?.sector ?? null;
        const nextRecommendation = getGeneratorRecommendation(storedSector);
        const current = sanitizeGeneratorBusinessSettings(
          profileResult.data?.avg_basket,
          profileResult.data?.lead_conversion_rate,
          nextRecommendation,
        );
        setSector(storedSector);
        setAvgBasket(current.avgBasket);
        setConversionRate(current.conversionRate);
      } catch (caught) {
        if (active) {
          setError(
            getSimpleFrenchErrorMessage(
              caught,
              "Impossible de charger les réglages du générateur.",
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
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const normalized = sanitizeGeneratorBusinessSettings(
        avgBasket,
        conversionRate,
        recommendation,
      );
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Utilisateur non connecté.");
      const userId = resolveActiveBrowserUserId(authData.user.id);
      const { error: saveError } = await supabase.from("profiles").upsert(
        {
          user_id: userId,
          avg_basket: normalized.avgBasket,
          lead_conversion_rate: normalized.conversionRate,
        },
        { onConflict: "user_id" },
      );
      if (saveError) throw saveError;
      setAvgBasket(normalized.avgBasket);
      setConversionRate(normalized.conversionRate);
      await invalidateBoosterGenerationContextClient("professional");
      window.dispatchEvent(new CustomEvent("inrcy:generator-settings-updated"));
      setSaving(false);
      setSaved(true);
      void Promise.resolve(onSaved?.()).catch(() => undefined);
      closeTimerRef.current = window.setTimeout(onClose, 1500);
    } catch (caught) {
      setError(
        getSimpleFrenchErrorMessage(
          caught,
          "Impossible d’enregistrer les réglages du générateur.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  const referenceCount = opportunities && opportunities > 0 ? opportunities : 10;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9200,
        display: "grid",
        placeItems: "center",
        padding: 14,
        background: "rgba(2,6,23,0.78)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <style jsx>{`
        @media (max-width: 620px) {
          div[data-generator-fields="2"] { grid-template-columns: 1fr !important; }
          div[data-generator-actions] { grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr) !important; }
          section[data-generator-settings-modal] { padding: 16px !important; border-radius: 20px !important; max-height: calc(100dvh - 16px) !important; }
        }
      `}</style>
      <section
        data-generator-settings-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="generator-settings-title"
        style={{
          width: "min(620px, 100%)",
          maxHeight: "min(760px, calc(100dvh - 28px))",
          overflowY: "auto",
          borderRadius: 26,
          border: "1px solid rgba(56,189,248,0.30)",
          background:
            "radial-gradient(circle at 10% 0%, rgba(56,189,248,0.16), transparent 35%), radial-gradient(circle at 90% 10%, rgba(244,114,182,0.16), transparent 35%), #081126",
          boxShadow: "0 35px 110px rgba(0,0,0,0.65)",
          padding: 22,
          boxSizing: "border-box",
          color: "white",
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 11, alignItems: "center", minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                width: 46,
                height: 46,
                flex: "0 0 46px",
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(145deg, rgba(56,189,248,0.98), rgba(139,92,246,0.96) 55%, rgba(244,114,182,0.94))",
                border: "1px solid rgba(255,255,255,0.26)",
                boxShadow: "0 10px 28px rgba(99,102,241,0.30), inset 0 1px 0 rgba(255,255,255,0.30)",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z" stroke="white" strokeWidth="1.9" />
                <path d="M19.1 13.1a7.7 7.7 0 0 0 .05-1.1 7.7 7.7 0 0 0-.05-1.1l2-1.55-1.9-3.3-2.35.95a8.1 8.1 0 0 0-1.9-1.1L14.6 3.4h-3.8l-.35 2.5a8.1 8.1 0 0 0-1.9 1.1L6.2 6.05l-1.9 3.3 2 1.55a7.7 7.7 0 0 0-.05 1.1c0 .37.02.73.05 1.1l-2 1.55 1.9 3.3 2.35-.95a8.1 8.1 0 0 0 1.9 1.1l.35 2.5h3.8l.35-2.5a8.1 8.1 0 0 0 1.9-1.1l2.35.95 1.9-3.3-2-1.55Z" stroke="white" strokeWidth="1.55" strokeLinejoin="round" />
              </svg>
            </span>
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <h2 id="generator-settings-title" style={{ margin: 0, fontSize: 20, lineHeight: 1.15 }}>
                Projection
              </h2>
              <p style={{ margin: 0, color: "rgba(255,255,255,0.68)", fontSize: 12.5, lineHeight: 1.3 }}>
                Affinez vos estimations !
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{ width: 36, height: 36, borderRadius: 13, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "white", cursor: "pointer", fontSize: 19, flex: "0 0 auto" }}
          >
            ×
          </button>
        </header>

        {loading ? (
          <div style={{ padding: "34px 0", textAlign: "center", color: "rgba(255,255,255,0.70)" }}>
            Chargement des réglages…
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            <div style={{ borderRadius: 17, border: "1px solid rgba(56,189,248,0.20)", background: "rgba(56,189,248,0.075)", padding: 14, display: "grid", gap: 7 }}>
              <strong style={{ fontSize: 13.5 }}>Repère conseillé · {recommendation.sectorLabel}</strong>
              <span style={{ color: "rgba(255,255,255,0.70)", fontSize: 12.5, lineHeight: 1.45 }}>
                Panier moyen {recommendation.avgBasket.toLocaleString("fr-FR")} € · transformation {recommendation.conversionRate} %. Vos valeurs enregistrées restent prioritaires.
              </span>
              <button
                type="button"
                onClick={() => {
                  setAvgBasket(recommendation.avgBasket);
                  setConversionRate(recommendation.conversionRate);
                  setSaved(false);
                }}
                style={{ justifySelf: "start", borderRadius: 999, border: "1px solid rgba(56,189,248,0.34)", background: "rgba(56,189,248,0.10)", color: "#bae6fd", padding: "8px 11px", cursor: "pointer", fontWeight: 800, fontSize: 12 }}
              >
                Appliquer les valeurs conseillées
              </button>
            </div>

            <div data-generator-fields="2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <label style={{ display: "grid", gap: 7, color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: 750 }}>
                Panier moyen (€)
                <input style={fieldStyle} type="number" min="1" step="1" inputMode="decimal" value={avgBasket} onChange={(event) => setAvgBasket(Math.max(0, Number(event.target.value) || 0))} />
              </label>
              <label style={{ display: "grid", gap: 7, color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: 750 }}>
                Taux de transformation (%)
                <input style={fieldStyle} type="number" min="1" max="100" step="1" inputMode="decimal" value={conversionRate} onChange={(event) => setConversionRate(Math.min(100, Math.max(0, Number(event.target.value) || 0)))} />
              </label>
            </div>

            <div style={{ borderRadius: 17, border: "1px solid rgba(244,114,182,0.24)", background: "linear-gradient(135deg, rgba(56,189,248,0.10), rgba(139,92,246,0.12), rgba(244,114,182,0.10))", padding: 15, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 3 }}>
                <span style={{ color: "rgba(255,255,255,0.66)", fontSize: 12 }}>
                  Projection pour {referenceCount} opportunité{referenceCount > 1 ? "s" : ""}
                </span>
                <strong style={{ fontSize: 24, letterSpacing: "-0.5px" }}>
                  {estimate.toLocaleString("fr-FR")} €
                </strong>
              </div>
              <span style={{ color: "rgba(255,255,255,0.58)", fontSize: 11.5, maxWidth: 260, lineHeight: 1.4 }}>
                Opportunités × taux de transformation × panier moyen. Il s’agit d’une estimation, pas d’une promesse de chiffre d’affaires.
              </span>
            </div>

            {error ? <div style={{ color: "#fca5a5", fontSize: 12.5, fontWeight: 750 }}>{error}</div> : null}
            {saved ? <div style={{ color: "#86efac", fontSize: 12.5, fontWeight: 850 }}>Réglages enregistrés ✓</div> : null}

            <div data-generator-actions style={{ position: "sticky", bottom: -1, display: "grid", gridTemplateColumns: "minmax(110px, 0.55fr) minmax(180px, 1fr)", gap: 10, paddingTop: 8, paddingBottom: "max(1px, env(safe-area-inset-bottom, 0px))", background: "linear-gradient(180deg, transparent, #081126 32%)" }}>
              <button type="button" onClick={onClose} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.06)", color: "white", padding: "12px", fontWeight: 850, cursor: "pointer" }}>
                Annuler
              </button>
              <button type="button" onClick={() => void save()} disabled={saving || avgBasket <= 0 || conversionRate <= 0} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.18)", background: "linear-gradient(135deg, #38bdf8, #8b5cf6 52%, #f472b6)", color: "white", padding: "12px", fontWeight: 950, cursor: saving ? "wait" : "pointer", opacity: saving || avgBasket <= 0 || conversionRate <= 0 ? 0.58 : 1 }}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
