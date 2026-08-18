import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import {
  ChannelPublicationPreview,
  type PublicationPreview,
} from "@/app/dashboard/_components/ChannelImageAdapterTool";
import { pillBtn } from "../publishModal.styles";
import type { ChannelKey } from "../publishModal.shared";
import PublishStepTitle from "./PublishStepTitle";

type PublishModalStyles = Readonly<Record<string, string>>;

type PreviewReadinessTab = {
  key: ChannelKey;
  label: string;
  tone: "ready" | "warning" | "blocked";
  message?: string;
};

type PublishPreviewPanelProps = {
  styles: PublishModalStyles;
  isMobile: boolean;
  stepNumber: number;
  activePublicationPreview: PublicationPreview | null;
  previewReadinessTabs: PreviewReadinessTab[];
  activeImageChannel: ChannelKey;
  showPublicationPreview: boolean;
  setShowPublicationPreview: Dispatch<SetStateAction<boolean>>;
  setSynchronizedActiveChannel: (channel: ChannelKey) => void;
};

export default function PublishPreviewPanel({
  styles,
  isMobile,
  stepNumber,
  activePublicationPreview,
  previewReadinessTabs,
  activeImageChannel,
  showPublicationPreview,
  setShowPublicationPreview,
  setSynchronizedActiveChannel,
}: PublishPreviewPanelProps) {
  const i18nT = useTranslations("booster");
  if (!activePublicationPreview) return null;

  return (
    <div
      className={styles.blockCard}
      style={{
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        display: "grid",
        gap: showPublicationPreview ? 12 : 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gridTemplateRows: "auto auto",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ display: "contents" }}>
          <PublishStepTitle
            styles={styles}
            step={stepNumber}
            style={{
              marginBottom: 4,
              gridColumn: 1,
              gridRow: 1,
              minWidth: 0,
            }}
          >
            {i18nT("apercu_f0f53004")}{" "}</PublishStepTitle>
          <div
            className={styles.subtitle}
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(10, minmax(0, 1fr))",
              gap: isMobile ? 8 : 6,
              width: "100%",
              maxWidth: "100%",
              paddingBottom: 2,
              marginBottom: 0,
              minWidth: 0,
              gridColumn: "1 / -1",
              gridRow: 2,
            }}
          >
            {previewReadinessTabs.map((tab) => {
              const previewStatusStyle =
                tab.tone === "ready"
                  ? {
                      border: "1px solid rgba(34,197,94,0.34)",
                      color: "#bbf7d0",
                      background: "rgba(34,197,94,0.10)",
                    }
                  : tab.tone === "blocked"
                    ? {
                        border: "1px solid rgba(248,113,113,0.34)",
                        color: "#fecaca",
                        background: "rgba(248,113,113,0.10)",
                      }
                    : {
                        border: "1px solid rgba(251,191,36,0.36)",
                        color: "#fde68a",
                        background: "rgba(251,191,36,0.10)",
                      };
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setSynchronizedActiveChannel(tab.key)}
                  title={
                    tab.tone === "ready"
                      ? "Texte + image"
                      : tab.tone === "blocked"
                        ? tab.message || "Canal incompatible avec cette publication"
                        : "Texte seul ou image seule"
                  }
                  style={{
                    ...pillBtn,
                    ...previewStatusStyle,
                    ...(activeImageChannel === tab.key
                      ? {
                          border:
                            tab.tone === "ready"
                              ? "2px solid rgba(74,222,128,0.90)"
                              : tab.tone === "blocked"
                                ? "2px solid rgba(248,113,113,0.90)"
                                : "2px solid rgba(250,204,21,0.92)",
                          boxShadow:
                            tab.tone === "ready"
                              ? "0 0 0 1px rgba(74,222,128,0.26) inset, 0 0 0 1px rgba(74,222,128,0.20), 0 0 18px rgba(74,222,128,0.20)"
                              : tab.tone === "blocked"
                                ? "0 0 0 1px rgba(248,113,113,0.26) inset, 0 0 0 1px rgba(248,113,113,0.20), 0 0 18px rgba(248,113,113,0.18)"
                                : "0 0 0 1px rgba(250,204,21,0.26) inset, 0 0 0 1px rgba(250,204,21,0.20), 0 0 18px rgba(250,204,21,0.16)",
                        }
                      : {}),
                    width: "100%",
                    boxSizing: "border-box",
                    padding: isMobile ? "4px 6px" : "0 6px",
                    fontSize: isMobile ? "clamp(10px, 2.9vw, 12px)" : "clamp(8px, 0.78vw, 11px)",
                    whiteSpace: isMobile ? "normal" : "nowrap",
                    minWidth: 0,
                    minHeight: isMobile ? 43 : 34,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: isMobile ? "visible" : "hidden",
                    textOverflow: isMobile ? "clip" : "ellipsis",
                    lineHeight: isMobile ? 1.18 : undefined,
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => setShowPublicationPreview((visible) => !visible)}
          aria-expanded={showPublicationPreview}
          style={{
            gridColumn: 2,
            gridRow: 1,
            justifyContent: "center",
            whiteSpace: "nowrap",
          }}
        >
          {showPublicationPreview ? i18nT("masquer_adb05f2b") : i18nT("afficher_5e802040")}
        </button>
      </div>
      {showPublicationPreview ? (
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <ChannelPublicationPreview preview={activePublicationPreview} />
        </div>
      ) : null}
    </div>
  );
}
