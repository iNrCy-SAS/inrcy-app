"use client";

import { translateAdsUiChoices } from "./adsUiCopy";
import { useTranslations } from "next-intl";


import { useMemo, useEffect, useId, useState } from "react";
import Image from "next/image";
import {
  validateMetaCreativeDimensions,
  type MetaCreativeDimensionValidation,
} from "@/lib/adsMetaCreativeDimensions";
import styles from "./MetaAdsMediaPack.module.css";

export type MetaAdsMediaSlot = "feed" | "story_reel";
export type MetaAdsMediaFormatStatus = "empty" | "checking" | "valid" | "invalid" | "unavailable";
export type MetaAdsPlacement =
  | "facebook_feed"
  | "instagram_feed"
  | "stories"
  | "reels"
  | "messenger";

export type MetaAdsMediaPackProps = {
  feedImageUrl: string | null;
  storyReelImageUrl: string | null;
  selectedPlacements: readonly MetaAdsPlacement[];
  disabled?: boolean;
  className?: string;
  onGenerate: (slot: MetaAdsMediaSlot) => void;
  onImport: (slot: MetaAdsMediaSlot) => void;
  onChooseFromLibrary: (slot: MetaAdsMediaSlot) => void;
  onRemove: (slot: MetaAdsMediaSlot) => void;
  onFormatStatusChange?: (slot: MetaAdsMediaSlot, status: MetaAdsMediaFormatStatus) => void;
};

type SlotConfig = {
  id: MetaAdsMediaSlot;
  title: string;
  format: string;
  description: string;
  placementLabels: readonly { id: MetaAdsPlacement; label: string }[];
};

const slots: readonly SlotConfig[] = [
  {
    id: "feed",
    title: "Fils Facebook et Instagram",
    format: "4:5",
    description: "Un visuel vertical pour les fils d’actualité.",
    placementLabels: [
      { id: "facebook_feed", label: "Fil Facebook" },
      { id: "instagram_feed", label: "Fil Instagram" },
    ],
  },
  {
    id: "story_reel",
    title: "Stories et Reels",
    format: "9:16",
    description: "Un visuel plein écran pour les formats immersifs.",
    placementLabels: [
      { id: "stories", label: "Stories" },
      { id: "reels", label: "Reels" },
    ],
  },
];
const RAW_slots = slots;


type SlotCardProps = {
  config: SlotConfig;
  imageUrl: string | null;
  selectedPlacements: readonly MetaAdsPlacement[];
  disabled: boolean;
  headingId: string;
  onGenerate: MetaAdsMediaPackProps["onGenerate"];
  onImport: MetaAdsMediaPackProps["onImport"];
  onChooseFromLibrary: MetaAdsMediaPackProps["onChooseFromLibrary"];
  onRemove: MetaAdsMediaPackProps["onRemove"];
  onFormatStatusChange?: MetaAdsMediaPackProps["onFormatStatusChange"];
};

function SlotCard({
  config,
  imageUrl,
  selectedPlacements,
  disabled,
  headingId,
  onGenerate,
  onImport,
  onChooseFromLibrary,
  onRemove,
  onFormatStatusChange,
}: SlotCardProps) {
  const i18nT = useTranslations("booster");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [dimensionValidation, setDimensionValidation] = useState<MetaCreativeDimensionValidation | null>(null);
  const selected = config.placementLabels.filter(({ id }) => selectedPlacements.includes(id));
  const hasImage = Boolean(imageUrl?.trim());
  const formatStatus: MetaAdsMediaFormatStatus = !hasImage
    ? "empty"
    : previewFailed
      ? "unavailable"
      : dimensionValidation
        ? dimensionValidation.valid
          ? "valid"
          : "invalid"
        : "checking";
  const status = formatStatus === "unavailable"
    ? "unavailable"
    : formatStatus === "valid"
      ? "ready"
      : formatStatus === "invalid"
        ? "invalid"
        : formatStatus === "checking"
          ? "checking"
      : selected.length
        ? "missing"
        : "optional";
  const statusLabel = status === "ready"
    ? i18nT("wizard_ready")
    : status === "missing"
      ? "Manquant"
      : status === "unavailable"
        ? i18nT("a_verifier_8f5f7255")
        : status === "invalid"
          ? i18nT("ads_ui_298a487c75")
          : status === "checking"
            ? i18nT("verification_30a67937")
        : i18nT("ads_ui_7681d402b8");
  const verificationMessage = status === "invalid"
    ? dimensionValidation?.message
    : status === "checking"
      ? i18nT("ads_ui_05ac740fdc")
      : status === "unavailable"
        ? i18nT("ads_ui_0e1672f3ff")
        : status === "ready" && dimensionValidation
          ? `${dimensionValidation.width} × ${dimensionValidation.height} px · format ${config.format} conforme.`
          : null;

  useEffect(() => {
    onFormatStatusChange?.(config.id, formatStatus);
  }, [config.id, formatStatus, onFormatStatusChange]);

  return (
    <section
      className={styles.slot}
      role="listitem"
      data-slot={config.id}
      data-status={status}
      data-selected={selected.length > 0}
      aria-labelledby={headingId}
    >
      <div className={styles.slotHeader}>
        <div>
          <span className={styles.format}>{i18nT("ads_ui_795349a1ba")}{config.format}</span>
          <h4 id={headingId}>{config.title}</h4>
          <p>{config.description}</p>
        </div>
        <span className={styles.status} aria-live="polite">{statusLabel}</span>
      </div>

      <div className={styles.placements} role="group" aria-label={i18nT("placements_de_value_b49ef8f8", { value0: config.title })}>
        {config.placementLabels.map(({ id, label }) => (
          <span key={id} data-selected={selectedPlacements.includes(id)}>
            <span aria-hidden="true">{selectedPlacements.includes(id) ? "✓" : "○"}</span>
            {label}
          </span>
        ))}
      </div>

      <div className={styles.preview} data-format={config.id} aria-label={i18nT("apercu_complet_value_pour_value_9f8f4353", { value0: config.format, value1: config.title })}>
        <div className={styles.previewFrame}>
          {hasImage && !previewFailed ? (
            <Image
              src={imageUrl!}
              alt={i18nT("apercu_value_pour_value_0d9e3eba", { value0: config.format, value1: config.title })}
              fill
              unoptimized
              sizes="(max-width: 680px) 82vw, (max-width: 1200px) 42vw, 520px"
              className={styles.previewImage}
              onLoad={(event) => {
                const image = event.currentTarget;
                setPreviewFailed(false);
                setDimensionValidation(validateMetaCreativeDimensions(
                  config.id === "feed" ? "feed" : "storyReel",
                  { width: image.naturalWidth, height: image.naturalHeight },
                ));
              }}
              onError={() => {
                setDimensionValidation(null);
                setPreviewFailed(true);
              }}
            />
          ) : (
            <div className={styles.previewEmpty}>
              <span aria-hidden="true">{previewFailed ? "!" : "✦"}</span>
              <strong>{previewFailed ? i18nT("apercu_indisponible_d0ce704a") : i18nT("votre_visuel_ici_b12dccc6")}</strong>
              <small>{previewFailed ? i18nT("verifiez_ou_remplacez_cette_image_f5c220b3") : i18nT("image_au_format_value_fe60236b", { value0: config.format })}</small>
            </div>
          )}
        </div>
      </div>

      {verificationMessage ? (
        <p className={styles.validation} data-status={status} aria-live="polite">
          {verificationMessage}
        </p>
      ) : null}

      <div className={styles.actions} role="group" aria-label={i18nT("actions_pour_value_4e0423d4", { value0: config.title })}>
        <button type="button" className={styles.generate} disabled={disabled} onClick={() => onGenerate(config.id)} aria-label={i18nT("generer_un_visuel_pour_value_be0bdfce", { value0: config.title })}>
          <span aria-hidden="true">✦</span> {" "}{i18nT("generer_bd221c07")}{" "}</button>
        <button type="button" disabled={disabled} onClick={() => onImport(config.id)} aria-label={i18nT("importer_un_visuel_pour_value_af950dc6", { value0: config.title })}>
          <span aria-hidden="true">↥</span> {" "}{i18nT("importer_f54cfe90")}{" "}</button>
        <button type="button" disabled={disabled} onClick={() => onChooseFromLibrary(config.id)} aria-label={i18nT("choisir_un_visuel_dans_la_mediatheque_5a1fc1a0", { value0: config.title })}>
          <span aria-hidden="true">▦</span> {" "}{i18nT("mediatheque_e4fa8e31")}{" "}</button>
        {hasImage ? (
          <button type="button" className={styles.remove} disabled={disabled} onClick={() => onRemove(config.id)} aria-label={i18nT("retirer_le_visuel_de_value_380894df", { value0: config.title })}>
            <span aria-hidden="true">×</span> {" "}{i18nT("retirer_54ec24a1")}{" "}</button>
        ) : null}
      </div>
    </section>
  );
}

export default function MetaAdsMediaPack({
  feedImageUrl,
  storyReelImageUrl,
  selectedPlacements,
  disabled = false,
  className,
  onGenerate,
  onImport,
  onChooseFromLibrary,
  onRemove,
  onFormatStatusChange,
}: MetaAdsMediaPackProps) {
  const i18nT = useTranslations("booster");
  const { slots } = useMemo(() => ({ slots: translateAdsUiChoices(RAW_slots, i18nT) }), [i18nT]);
  const id = useId();
  const selectedSlotCount = slots.filter((slot) =>
    slot.placementLabels.some(({ id: placement }) => selectedPlacements.includes(placement))
  ).length;
  return (
    <div className={[styles.pack, className].filter(Boolean).join(" ")} role="group" aria-label={i18nT("visuels_meta_ads_c9fe2fc7")} data-media-gallery="meta">
      <div className={styles.intro}>
        <div>
          <span>{i18nT("pack_medias_meta_9b200a39")}</span>
          <h3>{i18nT("un_visuel_adapte_a_chaque_emplacement_5cb1e9c7")}</h3>
          <p>{i18nT("preparez_separement_le_fil_et_les_f4ca1b8d")}</p>
        </div>
        <strong aria-live="polite">{i18nT("ads_formats_selected", { count: selectedSlotCount })}</strong>
      </div>

      <div className={styles.grid} role="list" aria-label={i18nT("galerie_des_formats_meta_ads_ece13be6")}>
        {slots.map((config) => {
          const imageUrl = config.id === "feed" ? feedImageUrl : storyReelImageUrl;
          return (
            <SlotCard
              key={`${config.id}:${imageUrl || "empty"}`}
              config={config}
              imageUrl={imageUrl}
              selectedPlacements={selectedPlacements}
              disabled={disabled}
              headingId={`${id}-${config.id}`}
              onGenerate={onGenerate}
              onImport={onImport}
              onChooseFromLibrary={onChooseFromLibrary}
              onRemove={onRemove}
              onFormatStatusChange={onFormatStatusChange}
            />
          );
        })}
      </div>

      {selectedPlacements.includes("messenger") ? (
        <p className={styles.messengerNote}>{i18nT("messenger_est_selectionne_verifiez_son_format_f24f5a41")}</p>
      ) : null}
      <p className={styles.formatNote}>{i18nT("chaque_image_est_affichee_en_entier_5e7e72fb")}</p>
    </div>
  );
}
