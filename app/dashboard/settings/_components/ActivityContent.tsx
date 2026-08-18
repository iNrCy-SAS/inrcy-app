"use client";

import { useTranslations } from "next-intl";


import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";
import { refreshPublicProfileDependents } from "@/lib/publicProfileRefreshClient";

import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import {
  ACTIVITY_SECTOR_OPTIONS,
  decodeBusinessSector,
  encodeBusinessSector,
} from "@/lib/activitySectors";
import {
  getJobsForSector,
  getServicesForSectorAndJob,
  getJobLabel,
  isValidJobForSector,
  findJobValueByLabel,
} from "@/lib/activityCatalog";
import {
  searchActivityJobs,
  type ActivityJobSearchResult,
} from "@/lib/activityJobSearch";
import {
  combineOpeningSchedule,
  normalizeOpeningScheduleText,
} from "@/lib/openingSchedule";
import EditableTags from "./EditableTags";

type Props = {
  mode?: "page" | "drawer";
  onboarding?: boolean;
  onActivitySaved?: () => void;
  onActivityReset?: () => void;
  onCloseDrawer?: () => void;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

type BusinessActivityForm = {
  sectorCategory: string;
  sector: string; // métier (code)
  activityDescription: string;
  services: string[];
  interventionZones: string[];
  openingSchedule: string;
  strengths: string[];
  customerTypes: string[];
};

const TABLE = "business_profiles";

export default function ActivityContent({
  mode = "page",
  onboarding = false,
  onActivitySaved,
  onActivityReset,
  onCloseDrawer,
  onUnsavedChange,
}: Props) {
  const i18nT = useTranslations("settings");
  const initial: BusinessActivityForm = useMemo(
    () => ({
      sectorCategory: "",
      sector: "",
      activityDescription: "",
      services: [],
      interventionZones: [],
      openingSchedule: "",
      strengths: [],
      customerTypes: [],
    }),
    [],
  );

  const [form, setForm] = useState<BusinessActivityForm>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>("");
  const [jobSearch, setJobSearch] = useState("");
  const [jobSearchOpen, setJobSearchOpen] = useState(false);
  const [manualSelectionOpen, setManualSelectionOpen] = useState(false);
  const activityBaselineRef = useRef("");

  const activitySnapshot = (value: BusinessActivityForm) => JSON.stringify(value);

  const currentJobOptions = useMemo(() => {
    const base = getJobsForSector(form.sectorCategory);
    if (!form.sector) return base;
    const currentExists = base.some((opt) => opt.value === form.sector);
    if (currentExists) return base;
    const fallbackLabel =
      getJobLabel(form.sectorCategory, form.sector) || form.sector;
    return [...base, { value: form.sector, label: fallbackLabel }];
  }, [form.sectorCategory, form.sector]);

  const currentServiceOptions = useMemo(
    () => getServicesForSectorAndJob(form.sectorCategory, form.sector),
    [form.sectorCategory, form.sector],
  );
  const isCustomJobSector = form.sectorCategory === "autre";
  const selectedJobLabel = useMemo(
    () => getJobLabel(form.sectorCategory, form.sector) || form.sector,
    [form.sectorCategory, form.sector],
  );
  const selectedSectorLabel = useMemo(
    () =>
      ACTIVITY_SECTOR_OPTIONS.find(
        (option) => option.value === form.sectorCategory,
      )?.label || "",
    [form.sectorCategory],
  );
  const jobSearchResults = useMemo(
    () => searchActivityJobs(jobSearch, 8),
    [jobSearch],
  );

  const allSelectedServices = form.services;

  const card: React.CSSProperties = {
    padding: 16,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.045)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  };

  const input: React.CSSProperties = {
    width: "100%",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    padding: "10px 12px",
    color: "white",
    outline: "none",
  };

  const label: React.CSSProperties = {
    display: "grid",
    gap: 8,
  };

  const labelTitle: React.CSSProperties = {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: 800,
  };

  const hint: React.CSSProperties = {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    lineHeight: 1.35,
  };

  const selectOption: React.CSSProperties = {
    color: "#0b1020",
    background: "#ffffff",
  };

  const primaryBtn: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.18)",
    background:
      "linear-gradient(135deg, rgba(255, 77, 166, 0.35), rgba(97, 87, 255, 0.28), rgba(0, 200, 255, 0.22))",
    color: "white",
    borderRadius: 14,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 900,
    textDecoration: "none",
    display: "inline-flex",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    opacity: saving ? 0.7 : 1,
  };

  const checkboxGrid: React.CSSProperties = {
    display: "grid",
    gap: 10,
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    marginTop: 4,
  };

  const chipLabel: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.92)",
    minWidth: 0,
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const supabase = createClient();
        const { data: authData, error: authErr } =
          await supabase.auth.getUser();
        if (authErr) throw new Error(authErr.message);
        const user = authData?.user;
        if (!user) return;

        const { data, error: dbErr } = await supabase
          .from(TABLE)
          .select("*")
          .eq("user_id", resolveActiveBrowserUserId(user.id))
          .maybeSingle();

        if (dbErr) throw new Error(dbErr.message);
        if (!data) return;

        const decodedSector = decodeBusinessSector(data.sector ?? "");
        const rawServices = Array.isArray(data.services)
          ? data.services
              .map((s: unknown) => String(s || "").trim())
              .filter(Boolean)
          : normalizeLines(data.services_text ?? "");
        const normalizedProfession =
          decodedSector.sectorCategory === "autre"
            ? decodedSector.profession
            : isValidJobForSector(
                  decodedSector.sectorCategory,
                  decodedSector.profession,
                )
              ? decodedSector.profession
              : findJobValueByLabel(
                  decodedSector.sectorCategory,
                  decodedSector.profession,
                ) || "";
        const knownServices = normalizedProfession
          ? getServicesForSectorAndJob(
              decodedSector.sectorCategory,
              normalizedProfession,
            )
          : [];
        // Les anciens choix et les anciennes prestations libres deviennent
        // tous des tags. Pour un nouveau métier sans choix existant, les huit
        // recommandations sont proposées immédiatement.
        const services = rawServices.length > 0 ? rawServices : knownServices;

        setForm({
          sectorCategory: decodedSector.sectorCategory,
          sector: normalizedProfession,
          activityDescription:
            data.business_description ?? data.activity_description ?? "",
          services,
          interventionZones: Array.isArray(data.intervention_zones)
            ? data.intervention_zones
                .map((item: unknown) => String(item || "").trim())
                .filter(Boolean)
            : normalizeCommaList(data.intervention_zones_text ?? ""),
          openingSchedule: combineOpeningSchedule(
            data.opening_days,
            data.opening_hours,
          ),
          strengths: Array.isArray(data.strengths)
            ? data.strengths
                .map((item: unknown) => String(item || "").trim())
                .filter(Boolean)
            : normalizeLines(data.strengths_text ?? ""),
          customerTypes: Array.isArray(data.customer_typologies)
            ? data.customer_typologies
                .map((item: unknown) => String(item || ""))
                .filter(Boolean)
            : [],
        });
        setJobSearch(
          getJobLabel(decodedSector.sectorCategory, normalizedProfession) ||
            normalizedProfession,
        );
      } catch (e: unknown) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    if (loading) return;
    const snapshot = activitySnapshot(form);
    if (!activityBaselineRef.current) activityBaselineRef.current = snapshot;
    onUnsavedChange?.(snapshot !== activityBaselineRef.current);
  }, [form, loading, onUnsavedChange]);

  const set = <K extends keyof BusinessActivityForm>(
    key: K,
    value: BusinessActivityForm[K],
  ) => {
    setSaved(false);
    setError("");
    setForm((p) => ({ ...p, [key]: value }));
  };

  const confirmServiceReplacement = async () => {
    if (!form.services.length) return true;
    const normalizeForComparison = (values: string[]) =>
      values.map((value) => value.trim().toLocaleLowerCase("fr")).sort();
    const currentValues = normalizeForComparison(form.services);
    const recommendations = normalizeForComparison(currentServiceOptions);
    const usesOnlyRecommendations =
      currentValues.length === recommendations.length &&
      currentValues.every((value, index) => value === recommendations[index]);
    if (usesOnlyRecommendations) return true;
    return confirmInrcy({
      eyebrow: i18nT("mon_activite_7732bf80"),
      title: i18nT("adapter_les_prestations_au_nouveau_metier_4600da94"),
      message:
        i18nT("vos_prestations_actuelles_seront_remplacees_par_e147469e"),
      confirmLabel: i18nT("adapter_les_prestations_c904a349"),
      cancelLabel: i18nT("conserver_mon_metier_4aa6ce68"),
      variant: "warning",
    });
  };

  const handleSectorChange = async (sectorCategory: string) => {
    if (sectorCategory === form.sectorCategory) return;
    if (!(await confirmServiceReplacement())) return;
    setSaved(false);
    setError("");
    setJobSearch("");
    setForm((p) => ({
      ...p,
      sectorCategory,
      sector: "",
      services: [],
    }));
  };

  const handleProfessionChange = async (
    sector: string,
    options?: { preserveServices?: boolean },
  ) => {
    if (sector === form.sector) return;
    if (!options?.preserveServices && !(await confirmServiceReplacement())) return;
    setSaved(false);
    setError("");
    setJobSearch(getJobLabel(form.sectorCategory, sector) || sector);
    setForm((p) => ({
      ...p,
      sector,
      services: options?.preserveServices
        ? p.services
        : getServicesForSectorAndJob(p.sectorCategory, sector),
    }));
  };

  const handleSearchSelection = async (result: ActivityJobSearchResult) => {
    const keepsCurrentSelection =
      form.sectorCategory === result.sectorCategory && form.sector === result.job;
    if (!keepsCurrentSelection && !(await confirmServiceReplacement())) return;
    setSaved(false);
    setError("");
    setJobSearch(result.jobLabel);
    setJobSearchOpen(false);
    setManualSelectionOpen(false);
    setForm((p) => ({
      ...p,
      sectorCategory: result.sectorCategory,
      sector: result.job,
      services: keepsCurrentSelection
        ? p.services
        : getServicesForSectorAndJob(result.sectorCategory, result.job),
    }));
  };

  const toggleCustomerType = (customerType: string) => {
    setSaved(false);
    setError("");
    setForm((p) => ({
      ...p,
      customerTypes: p.customerTypes.includes(customerType)
        ? p.customerTypes.filter((item) => item !== customerType)
        : [...p.customerTypes, customerType],
    }));
  };

  function normalizeLines(v: string) {
    return String(v || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const normalizeCommaList = (v: string) =>
    v
      .split(/,|;|\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  const save = async () => {
    if (onboarding) {
      const missing: string[] = [];
      if (!form.sectorCategory.trim() || !form.sector.trim()) missing.push("le métier");
      if (!allSelectedServices.length) missing.push("les prestations");
      if (!form.interventionZones.length) missing.push("les zones d’intervention");
      if (!normalizeOpeningScheduleText(form.openingSchedule).trim()) {
        missing.push("les horaires d’ouverture");
      }
      if (!form.strengths.length) missing.push("les forces");
      if (!form.customerTypes.length) missing.push("la clientèle");
      if (missing.length) {
        setError(i18nT("pour_continuer_completez_value_ad238d6f", { value0: missing.join(", ") }));
        return;
      }
    }
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const supabase = createClient();
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw new Error(authErr.message);
      const user = authData?.user;
      if (!user) throw new Error("Utilisateur non connecté.");

      const payload = {
        user_id: resolveActiveBrowserUserId(user.id),
        sector: encodeBusinessSector(
          form.sectorCategory,
          getJobLabel(form.sectorCategory, form.sector) || form.sector.trim(),
        ),
        services: allSelectedServices,
        business_description: form.activityDescription.trim(),
        intervention_zones: form.interventionZones,
        // Compatibilité sans migration SQL : le nouveau champ unifié est stocké
        // dans opening_hours et l’ancien opening_days est vidé à la sauvegarde.
        opening_days: "",
        opening_hours: normalizeOpeningScheduleText(form.openingSchedule),
        strengths: form.strengths,
        customer_typologies: form.customerTypes,
        updated_at: new Date().toISOString(),
      };

      const { error: upErr } = await supabase
        .from(TABLE)
        .upsert(payload, { onConflict: "user_id" });
      if (upErr) throw new Error(upErr.message);
      const [publicProfileRefreshed] = await Promise.all([
        refreshPublicProfileDependents("activity"),
        invalidateBoosterGenerationContextClient("professional"),
      ]);
      if (!publicProfileRefreshed) {
        console.warn("[activity] iNrBadge/iNrSearch refresh deferred");
      }

      const isComplete =
        form.sectorCategory.trim().length > 0 &&
        form.sector.trim().length > 0 &&
        allSelectedServices.length > 0 &&
        form.interventionZones.length > 0 &&
        normalizeOpeningScheduleText(form.openingSchedule).length > 0 &&
        form.strengths.length > 0 &&
        form.customerTypes.length > 0;

      if (isComplete) {
        try {
          const resAward = await fetch("/api/loyalty/award", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              actionKey: "activity_complete",
              amount: 100,
              sourceId: "once",
              label: i18nT("activite_completee_241e5f48"),
              meta: { origin: "activity" },
            }),
          });
          if (!resAward.ok) {
            console.warn("UI award failed (activity_complete)");
          }
        } catch {
          // ignore
        }
      }

      activityBaselineRef.current = activitySnapshot(form);
      onUnsavedChange?.(false);
      setSaved(true);
      onActivitySaved?.();
      if (mode === "drawer") {
        window.setTimeout(() => onCloseDrawer?.(), 700);
      } else {
        window.setTimeout(() => setSaved(false), 2500);
      }
    } catch (e: unknown) {
      setError(
        getSimpleFrenchErrorMessage(
          e,
          "Impossible d'enregistrer cette activité.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const ok = await confirmInrcy({
      title: i18nT("reinitialiser_l_activite_f01d8d88"),
      message:
        i18nT("cela_efface_les_informations_d_activite_2a4693ce"),
      confirmLabel: i18nT("reinitialiser_e0e2ad54"),
      variant: "danger",
    });
    if (!ok) return;
    setForm(initial);
    setJobSearch("");
    setJobSearchOpen(false);
    setManualSelectionOpen(false);
    setSaved(false);
    setError("");
    activityBaselineRef.current = activitySnapshot(initial);
    onUnsavedChange?.(false);
    onActivityReset?.();
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        color: "rgba(255,255,255,0.92)",
        paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div
        style={{
          ...card,
          display: "flex",
          alignItems: "center",
          gap: 13,
          border: onboarding
            ? "1px solid rgba(167,139,250,0.26)"
            : card.border,
          background: onboarding
            ? "linear-gradient(135deg, rgba(56,189,248,0.14), rgba(139,92,246,0.17), rgba(244,114,182,0.11))"
            : card.background,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 46,
            height: 46,
            flex: "0 0 auto",
            display: "grid",
            placeItems: "center",
            borderRadius: 15,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(4,10,24,0.34)",
            fontSize: 24,
          }}
        >
          🎯
        </span>
        <div style={{ display: "grid", gap: 3 }}>
          <strong style={{ fontSize: onboarding ? 18 : 15 }}>
            {onboarding ? i18nT("presentez_votre_activite_59c7948b") : i18nT("votre_activite_professionnelle_c67bbd58")}
          </strong>
          <span style={{ opacity: 0.72, lineHeight: 1.4, fontSize: 13 }}>
            {i18nT("inrcy_s_appuie_sur_ces_informations_383b09e1")}{" "}</span>
        </div>
      </div>

      <div style={card}>
        {loading ? (
          <div style={{ opacity: 0.75 }}>{i18nT("chargement_01cba1df")}</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={label}>
              <span style={{ ...labelTitle, fontSize: 15 }}>
                {i18nT("trouvez_votre_metier_ab343504")}{" "}</span>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      position: "absolute",
                      left: 12,
                      color: "rgba(255,255,255,0.55)",
                      pointerEvents: "none",
                    }}
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    type="text"
                    autoComplete="off"
                    style={{ ...input, paddingLeft: 40, paddingRight: 38 }}
                    value={jobSearch}
                    onFocus={() => setJobSearchOpen(true)}
                    onBlur={() =>
                      window.setTimeout(() => setJobSearchOpen(false), 120)
                    }
                    onChange={(e) => {
                      setJobSearch(e.target.value);
                      setJobSearchOpen(true);
                    }}
                    placeholder={i18nT("ex_paysagiste_coiffeur_agence_de_communication_12b74806")}
                    role="combobox"
                    aria-label={i18nT("rechercher_votre_metier_da143d6f")}
                    aria-autocomplete="list"
                    aria-controls="activity-job-search-results"
                    aria-expanded={jobSearchOpen && jobSearch.trim().length > 0}
                  />
                  {jobSearch ? (
                    <button
                      type="button"
                      aria-label={i18nT("effacer_la_recherche_189351c0")}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setJobSearch("");
                        setJobSearchOpen(true);
                      }}
                      style={{
                        position: "absolute",
                        right: 8,
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        border: 0,
                        background: "transparent",
                        color: "rgba(255,255,255,0.65)",
                        cursor: "pointer",
                        fontSize: 18,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>

                {jobSearchOpen && jobSearch.trim() ? (
                  <div
                    id="activity-job-search-results"
                    role="listbox"
                    aria-label={i18nT("resultats_des_metiers_664b3798")}
                    style={{
                      position: "absolute",
                      zIndex: 30,
                      left: 0,
                      right: 0,
                      top: "calc(100% + 6px)",
                      maxHeight: 310,
                      overflowY: "auto",
                      padding: 6,
                      borderRadius: 14,
                      border: "1px solid rgba(125,211,252,0.28)",
                      background: "rgba(11,16,32,0.98)",
                      boxShadow: "0 18px 45px rgba(0,0,0,0.45)",
                      backdropFilter: "blur(18px)",
                      WebkitBackdropFilter: "blur(18px)",
                    }}
                  >
                    {jobSearchResults.length > 0 ? (
                      jobSearchResults.map((result) => (
                        <button
                          key={`${result.sectorCategory}:${result.job}`}
                          type="button"
                          role="option"
                          aria-selected={
                            form.sectorCategory === result.sectorCategory &&
                            form.sector === result.job
                          }
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void handleSearchSelection(result)}
                          style={{
                            width: "100%",
                            display: "grid",
                            gap: 3,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: 0,
                            background:
                              form.sectorCategory === result.sectorCategory &&
                              form.sector === result.job
                                ? "rgba(56,189,248,0.14)"
                                : "transparent",
                            color: "white",
                            textAlign: "left",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ fontWeight: 850, fontSize: 14 }}>
                            {result.jobLabel}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: "rgba(186,230,253,0.76)",
                            }}
                          >
                            {i18nT("secteur_value_ef2c6faa", { value0: result.sectorLabel })}</span>
                        </button>
                      ))
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gap: 8,
                          padding: "10px 12px",
                          color: "rgba(255,255,255,0.72)",
                          fontSize: 13,
                        }}
                      >
                        <span>{i18nT("aucun_metier_correspondant_6b9c6162")}</span>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setManualSelectionOpen(true);
                            setJobSearchOpen(false);
                          }}
                          style={{
                            justifySelf: "start",
                            border: 0,
                            background: "transparent",
                            color: "#7dd3fc",
                            padding: 0,
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          {i18nT("parcourir_manuellement_ce6cc06c")}{" "}</button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <span style={hint}>
                {i18nT("tapez_quelques_lettres_la_recherche_reconnait_5941b098")}{" "}</span>

              {form.sectorCategory && form.sector ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 8,
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid rgba(56,189,248,0.22)",
                    background: "rgba(56,189,248,0.07)",
                  }}
                >
                  <div style={{ display: "grid", gap: 2 }}>
                    <span style={{ ...hint, fontSize: 11 }}>
                      {i18nT("secteur_d_activite_04b6a420")}{" "}</span>
                    <span style={{ fontSize: 13, fontWeight: 850 }}>
                      {selectedSectorLabel}
                    </span>
                  </div>
                  <div style={{ display: "grid", gap: 2 }}>
                    <span style={{ ...hint, fontSize: 11 }}>{i18nT("metier_96ffe41e")}</span>
                    <span style={{ fontSize: 13, fontWeight: 850 }}>
                      {selectedJobLabel}
                    </span>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setManualSelectionOpen((current) => !current)}
                style={{
                  justifySelf: "start",
                  border: 0,
                  background: "transparent",
                  color: "#7dd3fc",
                  padding: "2px 0",
                  cursor: "pointer",
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                {manualSelectionOpen
                  ? i18nT("masquer_la_selection_manuelle_ab711e29")
                  : i18nT("parcourir_les_secteurs_et_metiers_manuellement_769da717")}
              </button>
            </div>

            {manualSelectionOpen ? (
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.025)",
                }}
              >
                <label style={label}>
                  <span style={labelTitle}>{i18nT("secteur_d_activite_04b6a420")}</span>
                  <select
                    style={input}
                    value={form.sectorCategory}
                    onChange={(e) => void handleSectorChange(e.target.value)}
                  >
                    <option value="" style={selectOption}>
                      {i18nT("choisir_un_secteur_376c1b7a")}{" "}</option>
                    {ACTIVITY_SECTOR_OPTIONS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        style={selectOption}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span style={hint}>
                    {i18nT("cette_categorie_pilote_les_modeles_proposes_a6246c0e")}{" "}</span>
                </label>

                <label style={label}>
                  <span style={labelTitle}>{i18nT("metier_96ffe41e")}</span>
                  {isCustomJobSector ? (
                    <input
                      style={input}
                      value={form.sector}
                      onChange={(e) =>
                        void handleProfessionChange(e.target.value, {
                          preserveServices: true,
                        })
                      }
                      disabled={!form.sectorCategory}
                      placeholder={i18nT("ex_cordiste_coach_vocal_fabricant_sur_1e1f8017")}
                    />
                  ) : (
                    <select
                      style={input}
                      value={form.sector}
                      onChange={(e) => void handleProfessionChange(e.target.value)}
                      disabled={!form.sectorCategory}
                    >
                      <option value="" style={selectOption}>
                        {i18nT("choisir_un_metier_9b734694")}{" "}</option>
                      {currentJobOptions.map((option) => (
                        <option
                          key={option.value}
                          value={option.value}
                          style={selectOption}
                        >
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <span style={hint}>
                    {i18nT("le_secteur_et_le_metier_restent_0aa314e2")}{" "}</span>
                </label>
              </div>
            ) : null}

            <label style={label}>
              <span style={labelTitle}>{i18nT("presentation_courte_de_l_activite_3ea5cb74")}</span>
              <textarea
                style={{ ...input, minHeight: 96, resize: "vertical" }}
                value={form.activityDescription}
                onChange={(e) => set("activityDescription", e.target.value)}
                placeholder={i18nT("ex_entreprise_familiale_specialisee_dans_les_ddbe7462")}
              />
              <span style={hint}>
                {i18nT("optionnel_mais_tres_utile_pour_que_0af0d364")}{" "}</span>
            </label>

            <div style={label}>
              <span style={labelTitle}>{i18nT("prestations_principales_5eb72f11")}</span>
              <EditableTags
                values={form.services}
                onChange={(values) => set("services", values)}
                addLabel={i18nT("ajouter_une_prestation_f819082b")}
                placeholder={i18nT("ex_intervention_week_end_931e57fb")}
                emptyText={
                  form.sector
                    ? "Ajoutez au moins une prestation représentative de votre activité."
                    : "Choisissez d’abord un métier : iNrCy proposera automatiquement jusqu’à 8 prestations."
                }
                maxItems={20}
              />
              <span style={hint}>
                {i18nT("inrcy_propose_automatiquement_les_prestations_li_7e2f1891")}{" "}</span>
            </div>

            <div style={label}>
              <span style={labelTitle}>{i18nT("zones_d_intervention_a4999f61")}</span>
              <EditableTags
                values={form.interventionZones}
                onChange={(values) => set("interventionZones", values)}
                addLabel={i18nT("ajouter_une_zone_85f56481")}
                placeholder={i18nT("ex_arras_c3287f39")}
                emptyText={i18nT("ajoutez_les_villes_secteurs_ou_rayons_dc934f3a")}
                maxItems={30}
              />
              <span style={hint}>
                {i18nT("une_zone_par_tag_aide_l_7516e004")}{" "}</span>
            </div>

            <label style={label}>
              <span style={labelTitle}>{i18nT("jours_et_horaires_d_ouverture_7e60aca2")}</span>
              <textarea
                style={{ ...input, minHeight: 128, resize: "vertical" }}
                value={form.openingSchedule}
                onChange={(e) => set("openingSchedule", e.target.value)}
                placeholder={i18nT("lundi_9h_13h_mardi_15h_19h_65f9b0b1")}
                maxLength={1200}
              />
              <span style={hint}>{i18nT("une_ligne_par_jour_est_recommandee_d8baf034")}</span>
            </label>

            <div style={label}>
              <span style={labelTitle}>{i18nT("vos_forces_29964107")}</span>
              <EditableTags
                values={form.strengths}
                onChange={(values) => set("strengths", values)}
                addLabel={i18nT("ajouter_une_force_58699841")}
                placeholder={i18nT("ex_intervention_rapide_e8d23c44")}
                emptyText={i18nT("ajoutez_3_a_6_forces_qui_c9dbc997")}
                maxItems={12}
              />
              <span style={hint}>{i18nT("3_a_6_forces_suffisent_court_56d52d7c")}</span>
            </div>

            <div style={label}>
              <span style={labelTitle}>{i18nT("typologie_de_clientele_4d08c355")}</span>
              <div style={checkboxGrid}>
                {[
                  { value: "particuliers", label: i18nT("particuliers_918ed212") },
                  { value: "professionnels", label: i18nT("professionnels_8d94a78e") },
                  { value: "collectivites", label: i18nT("collectivites_c0c84588") },
                ].map((option) => {
                  const checked = form.customerTypes.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      style={{
                        ...chipLabel,
                        boxShadow: checked
                          ? "0 0 0 1px rgba(56,189,248,0.35) inset"
                          : undefined,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCustomerType(option.value)}
                        style={{ accentColor: "#38bdf8", flex: "0 0 auto" }}
                      />
                      <span style={{ minWidth: 0 }}>{option.label}</span>
                    </label>
                  );
                })}
              </div>
              <span style={hint}>
                {i18nT("aide_l_ia_a_adapter_les_35ed6a9c")}{" "}</span>
            </div>

            {error ? (
              <div style={{ color: "rgba(248,113,113,0.95)", fontWeight: 800 }}>
                {error}
              </div>
            ) : null}
            {saved ? (
              <div style={{ color: "rgba(34,197,94,0.95)", fontWeight: 900 }}>
                {i18nT("enregistre_a5dfbc23")}{" "}</div>
            ) : null}

            <div
              data-activity-actions
              style={{
                position: "sticky",
                bottom: 0,
                zIndex: 8,
                display: "grid",
                gap: 10,
                gridTemplateColumns: "minmax(180px, 1.35fr) minmax(130px, 0.72fr)",
                padding: "11px 0 max(2px, env(safe-area-inset-bottom, 0px))",
                background:
                  "linear-gradient(180deg, rgba(6,16,31,0), rgba(6,16,31,0.96) 28%)",
              }}
            >
              <button
                type="button"
                style={primaryBtn}
                disabled={saving}
                onClick={save}
              >
                {saving
                  ? i18nT("enregistrement_e7d5f232")
                  : onboarding
                    ? i18nT("enregistrer_et_continuer_c75a7f90")
                    : i18nT("enregistrer_f7c8bcd8")}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleReset}
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "white",
                  borderRadius: 14,
                  padding: "10px 12px",
                  cursor: saving ? "not-allowed" : "pointer",
                  fontWeight: 800,
                }}
              >
                {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
            </div>

            {mode === "drawer" ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {i18nT("astuce_plus_vos_informations_sont_precises_4518ea45")}{" "}</div>
            ) : null}
          </div>
        )}
      </div>
      <style jsx>{`
        @media (max-width: 620px) {
          div[data-activity-actions] {
            grid-template-columns: minmax(0, 1.28fr) minmax(0, 0.72fr) !important;
          }
        }
      `}</style>
    </div>
  );
}
