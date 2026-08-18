import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { getLocalizedChannelLabel, type ChannelKey } from "../publishModal.shared";

type PublishModalStyles = Readonly<Record<string, string>>;

type PublishWarningModalsProps = {
  styles: PublishModalStyles;
  emptyContentChannel: ChannelKey | null;
  onCloseEmptyContentWarnings: () => void;
  onValidateEmptyContentWarning: () => void;
  oversizedMedia: {
    name: string;
    mediaType: "image" | "video";
    sizeBytes: number;
    maxBytes: number;
    sourceMaxBytes: number;
    operation:
      | "none"
      | "compression"
      | "conversion"
      | "conversion_and_compression";
  } | null;
  onCloseOversizedMedia: () => void;
  onOptimizeOversizedMedia: () => void;
};

function formatBytes(value: number, locale: string, kilobytes: string, megabytes: string) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1_000_000) {
    return `${new Intl.NumberFormat(locale).format(Math.max(1, Math.round(bytes / 1_000)))} ${kilobytes}`;
  }
  const mb = bytes / 1_000_000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: mb >= 10 ? 0 : 1 }).format(mb)} ${megabytes}`;
}

function WarningShell({
  styles,
  children,
}: {
  styles: PublishModalStyles;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.fullscreenModalOverlay}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10010,
        background: "rgba(4, 8, 18, 0.72)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
    >
      <div
        className={styles.blockCard}
        style={{
          width: "min(520px, 100%)",
          display: "grid",
          gap: 14,
          background: "#111827",
          backgroundImage: "none",
          border: "1px solid rgba(148, 163, 184, 0.28)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.62)",
          backdropFilter: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function PublishWarningModals({
  styles,
  emptyContentChannel,
  onCloseEmptyContentWarnings,
  onValidateEmptyContentWarning,
  oversizedMedia,
  onCloseOversizedMedia,
  onOptimizeOversizedMedia,
}: PublishWarningModalsProps) {
  const locale = useLocale();
  const i18nT = useTranslations("booster");
  const displayBytes = (value: number) =>
    formatBytes(value, locale, i18nT("unit_kilobytes"), i18nT("unit_megabytes"));
  if (oversizedMedia) {
    const mediaLabel = oversizedMedia.mediaType === "video"
      ? i18nT("media_video_lowercase")
      : i18nT("media_image_lowercase");
    const sourceTooLarge =
      oversizedMedia.sizeBytes > oversizedMedia.sourceMaxBytes;
    const needsConversion =
      oversizedMedia.operation === "conversion" ||
      oversizedMedia.operation === "conversion_and_compression";
    const needsCompression =
      oversizedMedia.operation === "compression" ||
      oversizedMedia.operation === "conversion_and_compression";
    return (
      <WarningShell styles={styles}>
        <div
          aria-hidden="true"
          style={{
            width: 46,
            height: 46,
            display: "grid",
            placeItems: "center",
            borderRadius: 16,
            border: "1px solid rgba(251,191,36,.28)",
            background: "rgba(120,53,15,.18)",
            fontSize: 22,
          }}
        >
          ⚠️
        </div>
        <div style={{ display: "grid", gap: 9 }}>
          <div className={styles.blockTitle} style={{ marginBottom: 0 }}>
            {sourceTooLarge
              ? i18nT("fichier_source_trop_volumineux_dc9a0055")
              : needsConversion && needsCompression
                ? i18nT("format_et_poids_a_optimiser_7036249f")
                : needsConversion
                  ? i18nT("format_a_optimiser_2231dfcb")
                  : i18nT("fichier_trop_volumineux_9210818a")}
          </div>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.82)",
            }}
          >
            <strong style={{ overflowWrap: "anywhere" }}>{oversizedMedia.name}</strong>
            {needsCompression ? (
              <>
                {" "}{i18nT("oversized_media_compression_detail", {
                  size: displayBytes(oversizedMedia.sizeBytes),
                  media: mediaLabel,
                  max: displayBytes(oversizedMedia.maxBytes),
                })}
              </>
            ) : (
              <> {" "}{i18nT("doit_etre_converti_dans_un_format_99ec554e")}</>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              color: "rgba(255,255,255,0.62)",
            }}
          >
            {sourceTooLarge
              ? i18nT("inrcy_accepte_un_fichier_source_de_09666c76", { value0: displayBytes(oversizedMedia.sourceMaxBytes) })
              : i18nT("inrcy_va_adapter_automatiquement_le_format_07a3c98e")}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onCloseOversizedMedia}
          >
            {i18nT("fermer_5ab4ec64")}{" "}</button>
          {!sourceTooLarge ? (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={onOptimizeOversizedMedia}
            >
              {i18nT("optimiser_le_media_1bc4fc40")}{" "}</button>
          ) : null}
        </div>
      </WarningShell>
    );
  }

  if (emptyContentChannel) {
    return (
      <WarningShell styles={styles}>
        <div style={{ fontSize: 22 }}>⚠️</div>
        <div style={{ display: "grid", gap: 8 }}>
          <div className={styles.blockTitle} style={{ marginBottom: 0 }}>
            {i18nT("avertissement_1b3e2777")}{" "}</div>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.82)",
            }}
          >
            {i18nT("le_contenu_est_vide_pour_861601a1")}{" "}
            <strong>
              {getLocalizedChannelLabel(emptyContentChannel, (key) => i18nT(key as never))}
            </strong>
            {i18nT("voulez_vous_continuer_87ba948b")}{" "}</div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onCloseEmptyContentWarnings}
          >
            {i18nT("annuler_49ba3292")}{" "}</button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={onValidateEmptyContentWarning}
          >
            {i18nT("valider_be4220f7")}{" "}</button>
        </div>
      </WarningShell>
    );
  }

  return null;
}
