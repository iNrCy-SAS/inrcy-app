"use client";

import { useEffect, useId, useState } from "react";
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
    ? "Prêt"
    : status === "missing"
      ? "Manquant"
      : status === "unavailable"
        ? "À vérifier"
        : status === "invalid"
          ? "Format à corriger"
          : status === "checking"
            ? "Vérification…"
        : "Non sélectionné";
  const verificationMessage = status === "invalid"
    ? dimensionValidation?.message
    : status === "checking"
      ? "Lecture des dimensions et du ratio de l’image…"
      : status === "unavailable"
        ? "Dimensions non vérifiables dans l’aperçu. Le serveur les contrôlera avant la création de la campagne."
        : status === "ready" && dimensionValidation
          ? `${dimensionValidation.width} × ${dimensionValidation.height} px · format ${config.format} conforme.`
          : null;

  useEffect(() => {
    onFormatStatusChange?.(config.id, formatStatus);
  }, [config.id, formatStatus, onFormatStatusChange]);

  return (
    <section
      className={styles.slot}
      data-slot={config.id}
      data-status={status}
      data-selected={selected.length > 0}
      aria-labelledby={headingId}
    >
      <div className={styles.slotHeader}>
        <div>
          <span className={styles.format}>FORMAT {config.format}</span>
          <h4 id={headingId}>{config.title}</h4>
          <p>{config.description}</p>
        </div>
        <span className={styles.status} aria-live="polite">{statusLabel}</span>
      </div>

      <div className={styles.placements} role="group" aria-label={`Placements de ${config.title}`}>
        {config.placementLabels.map(({ id, label }) => (
          <span key={id} data-selected={selectedPlacements.includes(id)}>
            <span aria-hidden="true">{selectedPlacements.includes(id) ? "✓" : "○"}</span>
            {label}
          </span>
        ))}
      </div>

      <div className={styles.preview} data-format={config.id}>
        <div className={styles.previewFrame}>
          {hasImage && !previewFailed ? (
            <Image
              src={imageUrl!}
              alt={`Aperçu ${config.format} pour ${config.title}`}
              fill
              unoptimized
              sizes="(max-width: 680px) 65vw, 250px"
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
              <strong>{previewFailed ? "Aperçu indisponible" : "Votre visuel ici"}</strong>
              <small>{previewFailed ? "Vérifiez ou remplacez cette image." : `Image au format ${config.format}`}</small>
            </div>
          )}
        </div>
      </div>

      {verificationMessage ? (
        <p className={styles.validation} data-status={status} aria-live="polite">
          {verificationMessage}
        </p>
      ) : null}

      <div className={styles.actions} role="group" aria-label={`Actions pour ${config.title}`}>
        <button type="button" className={styles.generate} disabled={disabled} onClick={() => onGenerate(config.id)} aria-label={`Générer un visuel pour ${config.title}`}>
          <span aria-hidden="true">✦</span> Générer
        </button>
        <button type="button" disabled={disabled} onClick={() => onImport(config.id)} aria-label={`Importer un visuel pour ${config.title}`}>
          <span aria-hidden="true">↥</span> Importer
        </button>
        <button type="button" disabled={disabled} onClick={() => onChooseFromLibrary(config.id)} aria-label={`Choisir un visuel dans la médiathèque pour ${config.title}`}>
          <span aria-hidden="true">▦</span> Médiathèque
        </button>
        {hasImage ? (
          <button type="button" className={styles.remove} disabled={disabled} onClick={() => onRemove(config.id)} aria-label={`Retirer le visuel de ${config.title}`}>
            <span aria-hidden="true">×</span> Retirer
          </button>
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
  const id = useId();
  const selectedSlotCount = slots.filter((slot) =>
    slot.placementLabels.some(({ id: placement }) => selectedPlacements.includes(placement))
  ).length;
  return (
    <div className={[styles.pack, className].filter(Boolean).join(" ")} role="group" aria-label="Visuels Meta Ads">
      <div className={styles.intro}>
        <div>
          <span>PACK MÉDIAS META</span>
          <h3>Un visuel adapté à chaque emplacement.</h3>
          <p>Préparez séparément le fil et les formats plein écran. Chaque emplacement conserve son propre média.</p>
        </div>
        <strong aria-live="polite">{selectedSlotCount} format{selectedSlotCount > 1 ? "s" : ""} sélectionné{selectedSlotCount > 1 ? "s" : ""}</strong>
      </div>

      <div className={styles.grid}>
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
        <p className={styles.messengerNote}>Messenger est sélectionné. Vérifiez son format séparément avant une diffusion.</p>
      ) : null}
      <p className={styles.formatNote}>Les aperçus montrent un cadrage indicatif. Vérifiez les dimensions et les zones importantes de chaque image avant diffusion.</p>
    </div>
  );
}
