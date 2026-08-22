"use client";

import { useTranslations } from "next-intl";


import { useEffect, useMemo, useRef, useState } from "react";
import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";
import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  extractLogoPathFromUrl,
  getProfileLogoDisplayUrl,
  LOGO_BUCKET,
  resolveProfileLogoUrl,
  revokeBlobUrl,
  validateProfileLogoFile,
} from "@/lib/profileLogo";
import { refreshPublicProfileDependents } from "@/lib/publicProfileRefreshClient";
import { createClient } from "@/lib/supabaseClient";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import OnboardingStepFooter from "./OnboardingStepFooter";

type Props = {
  mode?: "page" | "drawer";
  onboarding?: boolean;
  onProfileSaved?: () => unknown | Promise<unknown>;
  onProfileReset?: () => unknown | Promise<unknown>;
  onCloseDrawer?: () => unknown | Promise<unknown>;
  onOnboardingPrevious?: () => void | Promise<void>;
  onOnboardingNext?: () => void | Promise<void>;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

type ProfileForm = {
  contactEmail: string;
  firstName: string;
  lastName: string;
  phone: string;
  companyName: string;
  hqZip: string;
  hqCity: string;
  logoPreview: string;
  logoFile: File | null;
  logoPath: string;
};

function profileSnapshot(form: ProfileForm) {
  return JSON.stringify({
    ...form,
    logoFile: form.logoFile
      ? `${form.logoFile.name}:${form.logoFile.size}:${form.logoFile.lastModified}`
      : null,
  });
}

export default function ProfilContent({
  mode = "page",
  onboarding = false,
  onProfileSaved,
  onProfileReset,
  onCloseDrawer,
  onOnboardingPrevious,
  onOnboardingNext,
  onUnsavedChange,
}: Props) {
  const i18nT = useTranslations("settings");
  const initial = useMemo<ProfileForm>(
    () => ({
      contactEmail: "",
      firstName: "",
      lastName: "",
      phone: "",
      companyName: "",
      hqZip: "",
      hqCity: "",
      logoPreview: "",
      logoFile: null,
      logoPath: "",
    }),
    [],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const baselineRef = useRef("");
  const [form, setForm] = useState<ProfileForm>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState("");
  const [logoError, setLogoError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const supabase = createClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        const user = authData?.user;
        if (!user || !active) return;

        const authenticatedEmail = user.email?.trim() || "";
        const { data, error } = await supabase
          .from("profiles")
          .select("contact_email,first_name,last_name,phone,company_legal_name,hq_zip,hq_city,logo_path,logo_url")
          .eq("user_id", resolveActiveBrowserUserId(user.id))
          .maybeSingle();
        if (error) throw error;

        const resolvedLogo = data
          ? await resolveProfileLogoUrl(supabase, {
              logo_path: data.logo_path ?? null,
              logo_url: data.logo_url ?? null,
            })
          : { logoUrl: "", logoPath: "" };
        if (!active) return;

        const next: ProfileForm = {
          contactEmail: data?.contact_email?.trim() || authenticatedEmail,
          firstName: data?.first_name ?? "",
          lastName: data?.last_name ?? "",
          phone: data?.phone ?? "",
          companyName: data?.company_legal_name ?? "",
          hqZip: data?.hq_zip ?? "",
          hqCity: data?.hq_city ?? "",
          logoPreview: resolvedLogo.logoUrl,
          logoFile: null,
          logoPath: resolvedLogo.logoPath,
        };
        setForm(next);
        baselineRef.current = profileSnapshot(next);
      } catch (error) {
        console.error(error);
        if (active) {
          setGlobalError(
            getClientUserFacingErrorMessage(error, i18nT("profile_load_failed")),
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

  useEffect(() => {
    if (loading || !baselineRef.current) return;
    onUnsavedChange?.(profileSnapshot(form) !== baselineRef.current);
  }, [form, loading, onUnsavedChange]);

  const update = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setSaved(false);
    setGlobalError("");
    if (String(key).startsWith("logo")) setLogoError("");
    setErrors((current) => {
      if (!current[String(key)]) return current;
      const next = { ...current };
      delete next[String(key)];
      return next;
    });
    setForm((current) => ({ ...current, [key]: value }));
  };

  const validate = () => {
    const next: Record<string, string> = {};
    const email = form.contactEmail.trim();
    if (!email) {
      next.contactEmail = i18nT("professional_email_required");
    } else if (!/^\S+@\S+\.\S+$/.test(email)) {
      next.contactEmail = i18nT("invalid_email");
    }
    if (!form.firstName.trim()) next.firstName = i18nT("first_name_required");
    if (!form.lastName.trim()) next.lastName = i18nT("last_name_required");
    if (!form.phone.trim()) next.phone = i18nT("phone_required");
    if (!form.companyName.trim()) {
      next.companyName = i18nT("company_name_required");
    }
    if (!form.hqZip.trim()) next.hqZip = i18nT("postal_code_required");
    if (!form.hqCity.trim()) next.hqCity = i18nT("city_required");
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const isProfileComplete = () => {
    const required = [
      form.firstName,
      form.lastName,
      form.phone,
      form.contactEmail,
      form.companyName,
      form.hqZip,
      form.hqCity,
    ];
    return (
      required.every((value) => value.trim().length > 0) &&
      /^\S+@\S+\.\S+$/.test(form.contactEmail.trim())
    );
  };

  async function uploadLogo(file: File) {
    const prepareResponse = await fetch("/api/profile/logo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      }),
    });
    const prepared = await prepareResponse.json().catch(() => ({}));
    if (
      !prepareResponse.ok ||
      !prepared?.ok ||
      !prepared?.path ||
      !prepared?.token ||
      !prepared?.mimeType
    ) {
      throw new Error(
        prepared?.error || i18nT("logo_save_failed"),
      );
    }

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(LOGO_BUCKET)
      .uploadToSignedUrl(prepared.path, prepared.token, file, {
        cacheControl: "3600",
        contentType: prepared.mimeType,
      });
    if (uploadError) {
      throw new Error(i18nT("logo_upload_failed"));
    }

    const completeResponse = await fetch(
      `/api/profile/logo?path=${encodeURIComponent(prepared.path)}`,
    );
    const completed = await completeResponse.json().catch(() => ({}));
    if (!completeResponse.ok || !completed?.ok || !completed?.path || !completed?.displayUrl) {
      throw new Error(completed?.error || i18nT("logo_preview_failed"));
    }
    return { path: String(completed.path), signedUrl: String(completed.displayUrl) };
  }

  const handleSave = async (onSuccess?: () => void | Promise<void>) => {
    if (saving) return;
    setGlobalError("");
    setSaved(false);
    if (!validate()) {
      setGlobalError(i18nT("certaines_informations_sont_invalides_verifiez_l_4906f2b7"));
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const user = authData?.user;
      if (!user) throw new Error(i18nT("user_not_authenticated"));

      let logoUrl = form.logoPreview || "";
      let logoPath = form.logoPath || extractLogoPathFromUrl(form.logoPreview) || "";
      if (form.logoFile) {
        const previousPreview = form.logoPreview;
        const uploaded = await uploadLogo(form.logoFile);
        revokeBlobUrl(previousPreview);
        logoUrl = uploaded.signedUrl;
        logoPath = uploaded.path;
      }

      const { error } = await supabase.from("profiles").upsert(
        {
          user_id: resolveActiveBrowserUserId(user.id),
          contact_email: form.contactEmail.trim(),
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          phone: form.phone.trim(),
          // Le nom public reste sur la colonne historique afin que tous les
          // outils et les comptes existants continuent de fonctionner.
          company_legal_name: form.companyName.trim(),
          hq_zip: form.hqZip.trim(),
          hq_city: form.hqCity.trim(),
          logo_path: logoPath || null,
          logo_url: logoPath
            ? logoUrl || getProfileLogoDisplayUrl(logoPath)
            : logoUrl || null,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;

      const [publicProfileRefreshed] = await Promise.all([
        refreshPublicProfileDependents("profile"),
        invalidateBoosterGenerationContextClient("professional"),
      ]);
      if (!publicProfileRefreshed) {
        console.warn("[profile] iNrBadge/iNrSearch refresh deferred");
      }

      if (isProfileComplete()) {
        try {
          await fetch("/api/loyalty/award", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              actionKey: "profile_complete",
              amount: 100,
              sourceId: "once",
              label: i18nT("profil_complete_daaeced5"),
              meta: { origin: "profile" },
            }),
          });
        } catch {
          // La récompense ne doit jamais bloquer l’enregistrement.
        }
      }

      const savedForm: ProfileForm = {
        ...form,
        logoPreview: logoUrl,
        logoPath,
        logoFile: null,
      };
      setForm(savedForm);
      baselineRef.current = profileSnapshot(savedForm);
      onUnsavedChange?.(false);
      setSaved(true);
      await onProfileSaved?.();
      if (onSuccess) {
        await onSuccess();
      } else if (mode === "drawer") {
        window.setTimeout(() => onCloseDrawer?.(), 450);
      } else {
        window.setTimeout(() => setSaved(false), 2500);
      }
    } catch (error) {
      console.error(error);
      setGlobalError(
        getClientUserFacingErrorMessage(error, i18nT("profile_save_failed")),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const confirmed = await confirmInrcy({
      title: i18nT("reinitialiser_le_profil_ac580741"),
      message: i18nT("les_informations_visibles_dans_ce_formulaire_ac3155d0"),
      confirmLabel: i18nT("reinitialiser_e0e2ad54"),
      variant: "danger",
    });
    if (!confirmed) return;
    revokeBlobUrl(form.logoPreview);
    setForm(initial);
    setErrors({});
    setGlobalError("");
    setLogoError("");
    setSaved(false);
    baselineRef.current = profileSnapshot(initial);
    onUnsavedChange?.(false);
    await onProfileReset?.();
  };

  const fieldStyle = (key: keyof ProfileForm): React.CSSProperties => ({
    ...inputStyle,
    border: errors[String(key)]
      ? "1px solid rgba(248,113,113,0.85)"
      : inputStyle.border,
  });

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        color: "rgba(255,255,255,0.94)",
        paddingBottom: "max(24px, var(--inrcy-safe-area-bottom))",
      }}
    >
      {onboarding ? (
        <section style={onboardingHeroStyle}>
          <span style={onboardingIconStyle}>👋</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 950 }}>{i18nT("faisons_connaissance_06564687")}</div>
            <div style={{ marginTop: 4, color: "rgba(255,255,255,0.72)", lineHeight: 1.4 }}>
              {i18nT("quelques_informations_essentielles_suffisent_pou_424524c0")}{" "}</div>
          </div>
        </section>
      ) : (
        <section style={introStyle}>
          <strong>{i18nT("votre_identite_professionnelle_60502e51")}</strong>
          <span>{i18nT("ces_informations_alimentent_votre_signature_et_cc93cb1e")}</span>
        </section>
      )}

      <section style={cardStyle}>
        {loading ? (
          <div style={{ color: "rgba(255,255,255,0.68)" }}>{i18nT("chargement_01cba1df")}</div>
        ) : (
          <div style={{ display: "grid", gap: 13 }}>
            <div style={sectionTitleStyle}>
              <span style={sectionBubbleStyle}>1</span>
              <div>
                <div style={{ fontWeight: 950 }}>{i18nT("vous_contacter_514d4b54")}</div>
                <div style={hintStyle}>{i18nT("utilise_dans_les_signatures_et_les_51bb6225")}</div>
              </div>
            </div>

            <label style={labelStyle}>
              <span style={labelTextStyle}>{i18nT("email_professionnel_26f8e47c")}</span>
              <input
                type="email"
                autoComplete="email"
                value={form.contactEmail}
                onChange={(event) => update("contactEmail", event.target.value)}
                placeholder="contact@entreprise.fr"
                style={fieldStyle("contactEmail")}
              />
              {errors.contactEmail ? <span style={errorStyle}>{errors.contactEmail}</span> : null}
            </label>

            <div data-profile-grid="two" style={gridTwoStyle}>
              <label style={labelStyle}>
                <span style={labelTextStyle}>{i18nT("prenom_72fe3505")}</span>
                <input
                  autoComplete="given-name"
                  value={form.firstName}
                  onChange={(event) => update("firstName", event.target.value)}
                  placeholder={i18nT("paul_c3687ab9")}
                  style={fieldStyle("firstName")}
                />
                {errors.firstName ? <span style={errorStyle}>{errors.firstName}</span> : null}
              </label>
              <label style={labelStyle}>
                <span style={labelTextStyle}>{i18nT("nom_463a6959")}</span>
                <input
                  autoComplete="family-name"
                  value={form.lastName}
                  onChange={(event) => update("lastName", event.target.value)}
                  placeholder={i18nT("martin_7347fd3b")}
                  style={fieldStyle("lastName")}
                />
                {errors.lastName ? <span style={errorStyle}>{errors.lastName}</span> : null}
              </label>
            </div>

            <label style={labelStyle}>
              <span style={labelTextStyle}>{i18nT("telephone_f846c67a")}</span>
              <input
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                placeholder="06 12 34 56 78"
                style={fieldStyle("phone")}
              />
              {errors.phone ? <span style={errorStyle}>{errors.phone}</span> : null}
            </label>
          </div>
        )}
      </section>

      {!loading ? (
        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 13 }}>
            <div style={sectionTitleStyle}>
              <span style={sectionBubbleStyle}>2</span>
              <div>
                <div style={{ fontWeight: 950 }}>{i18nT("votre_entreprise_c001322f")}</div>
                <div style={hintStyle}>{i18nT("le_nom_affiche_et_votre_implantation_d0cbc5ff")}</div>
              </div>
            </div>

            <label style={labelStyle}>
              <span style={labelTextStyle}>{i18nT("nom_de_l_entreprise_299b652c")}</span>
              <input
                autoComplete="organization"
                value={form.companyName}
                onChange={(event) => update("companyName", event.target.value)}
                placeholder={i18nT("votre_entreprise_c001322f")}
                style={fieldStyle("companyName")}
              />
              {errors.companyName ? <span style={errorStyle}>{errors.companyName}</span> : null}
            </label>

            <div data-profile-grid="location" style={locationGridStyle}>
              <label style={labelStyle}>
                <span style={labelTextStyle}>{i18nT("code_postal_71f695db")}</span>
                <input
                  inputMode="text"
                  autoComplete="postal-code"
                  value={form.hqZip}
                  onChange={(event) => update("hqZip", event.target.value.slice(0, 12))}
                  placeholder="62000"
                  style={fieldStyle("hqZip")}
                />
                {errors.hqZip ? <span style={errorStyle}>{errors.hqZip}</span> : null}
              </label>
              <label style={labelStyle}>
                <span style={labelTextStyle}>{i18nT("ville_e23c3241")}</span>
                <input
                  autoComplete="address-level2"
                  value={form.hqCity}
                  onChange={(event) => update("hqCity", event.target.value)}
                  placeholder={i18nT("arras_14599ac1")}
                  style={fieldStyle("hqCity")}
                />
                {errors.hqCity ? <span style={errorStyle}>{errors.hqCity}</span> : null}
              </label>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <span style={labelTextStyle}>{i18nT("logo_de_l_entreprise_a1d7bdb9")}{" "}<em style={optionalStyle}>{i18nT("optional_label")}</em></span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const validationError = validateProfileLogoFile(file);
                  if (validationError) {
                    setLogoError(validationError);
                    event.currentTarget.value = "";
                    return;
                  }
                  setLogoError("");
                  revokeBlobUrl(form.logoPreview);
                  update("logoFile", file);
                  update("logoPreview", URL.createObjectURL(file));
                }}
              />

              <div style={logoRowStyle}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={logoPreviewStyle}
                  aria-label={i18nT("choisir_le_logo_de_l_entreprise_77e2284b")}
                >
                  {form.logoPreview ? (
                    <img src={form.logoPreview} alt={i18nT("logo_83fce832")} style={logoImageStyle} />
                  ) : (
                    <span style={{ fontSize: 22 }}>🏢</span>
                  )}
                </button>
                <div style={{ display: "grid", gap: 7, minWidth: 0 }}>
                  <button type="button" onClick={() => fileInputRef.current?.click()} style={secondaryButtonStyle}>
                    {form.logoPreview ? i18nT("remplacer_le_logo_603cabb5") : i18nT("ajouter_un_logo_5b311e6a")}
                  </button>
                  <span style={hintStyle}>{i18nT("png_jpg_jpeg_webp_ou_svg_410fa833")}</span>
                  {form.logoPreview ? (
                    <button
                      type="button"
                      onClick={() => {
                        revokeBlobUrl(form.logoPreview);
                        update("logoFile", null);
                        update("logoPreview", "");
                        update("logoPath", "");
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      style={removeButtonStyle}
                    >
                      {i18nT("supprimer_1acfc1c7")}{" "}</button>
                  ) : null}
                </div>
              </div>
              {logoError ? <span style={errorStyle}>{logoError}</span> : null}
            </div>
          </div>
        </section>
      ) : null}

      {globalError ? <div style={errorBannerStyle}>{globalError}</div> : null}
      {saved ? <div style={successBannerStyle}>{i18nT("profil_enregistre_d21b6a7e")}</div> : null}

      {!loading ? (
        onboarding ? (
          <OnboardingStepFooter
            busy={saving}
            previousDisabled
            onPrevious={onOnboardingPrevious ?? (() => undefined)}
            onNext={() => handleSave(onOnboardingNext)}
            onReset={handleReset}
          />
        ) : (
          <div data-profile-actions style={actionsStyle}>
            <button type="button" onClick={handleReset} disabled={saving} style={resetButtonStyle}>
              {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              aria-busy={saving}
              style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1 }}
            >
              {saving
                ? i18nT("enregistrement_e7d5f232")
                : i18nT("enregistrer_f7c8bcd8")}
            </button>
          </div>
        )
      ) : null}

      <style jsx>{`
        @media (max-width: 620px) {
          div[data-profile-grid="two"],
          div[data-profile-grid="location"] {
            grid-template-columns: 1fr !important;
          }
          div[data-profile-actions] {
            grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr) !important;
          }
        }
      `}</style>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.13)",
  background: "rgba(3,9,23,0.38)",
  color: "white",
  outline: "none",
};

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 18,
  border: "1px solid rgba(125,211,252,0.15)",
  background:
    "linear-gradient(145deg, rgba(14,31,58,0.72), rgba(35,25,64,0.58))",
  boxShadow: "0 16px 44px rgba(0,0,0,0.20)",
};

const introStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.72)",
};

const onboardingHeroStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: 16,
  borderRadius: 20,
  border: "1px solid rgba(56,189,248,0.24)",
  background:
    "linear-gradient(135deg, rgba(56,189,248,0.16), rgba(139,92,246,0.16), rgba(244,114,182,0.12))",
};

const onboardingIconStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(4,10,24,0.38)",
  fontSize: 26,
};

const sectionTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const sectionBubbleStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  borderRadius: 999,
  border: "1px solid rgba(56,189,248,0.34)",
  background: "rgba(56,189,248,0.13)",
  color: "#bae6fd",
  fontWeight: 950,
};

const labelStyle: React.CSSProperties = { display: "grid", gap: 6 };
const labelTextStyle: React.CSSProperties = { fontSize: 13, fontWeight: 800 };
const hintStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.60)",
  fontSize: 12,
  lineHeight: 1.4,
};
const errorStyle: React.CSSProperties = { color: "#fca5a5", fontSize: 12 };
const optionalStyle: React.CSSProperties = {
  marginLeft: 5,
  color: "rgba(255,255,255,0.50)",
  fontSize: 11,
  fontStyle: "normal",
  fontWeight: 650,
};
const gridTwoStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};
const locationGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "130px minmax(0, 1fr)",
  gap: 10,
};
const logoRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  minWidth: 0,
};
const logoPreviewStyle: React.CSSProperties = {
  width: 68,
  height: 68,
  padding: 4,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  borderRadius: 17,
  border: "1px solid rgba(125,211,252,0.28)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
  overflow: "hidden",
};
const logoImageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  borderRadius: 13,
};
const secondaryButtonStyle: React.CSSProperties = {
  justifySelf: "start",
  borderRadius: 11,
  border: "1px solid rgba(125,211,252,0.34)",
  background: "rgba(56,189,248,0.10)",
  color: "white",
  padding: "8px 10px",
  cursor: "pointer",
  fontWeight: 850,
};
const removeButtonStyle: React.CSSProperties = {
  justifySelf: "start",
  padding: 0,
  border: 0,
  background: "transparent",
  color: "#fda4af",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 800,
};
const errorBannerStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(248,113,113,0.30)",
  background: "rgba(127,29,29,0.18)",
  color: "#fecaca",
  fontSize: 13,
  fontWeight: 750,
};
const successBannerStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(52,211,153,0.30)",
  background: "rgba(6,78,59,0.20)",
  color: "#a7f3d0",
  fontSize: 13,
  fontWeight: 850,
};
const actionsStyle: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  zIndex: 8,
  display: "grid",
  gridTemplateColumns: "auto minmax(180px, 1fr)",
  gap: 10,
  padding: "11px 0 max(2px, var(--inrcy-safe-area-bottom))",
  background: "linear-gradient(180deg, rgba(6,16,31,0), rgba(6,16,31,0.96) 28%)",
};
const resetButtonStyle: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.13)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 800,
};
const primaryButtonStyle: React.CSSProperties = {
  borderRadius: 13,
  border: "1px solid rgba(125,211,252,0.34)",
  background: "linear-gradient(100deg, #0ea5e9, #7c3aed 55%, #ec4899)",
  color: "white",
  padding: "11px 14px",
  cursor: "pointer",
  fontWeight: 950,
  boxShadow: "0 12px 30px rgba(124,58,237,0.22)",
};
