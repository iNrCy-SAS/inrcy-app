import { useTranslations } from "next-intl";
import type { BoosterCreationMode } from "@/lib/boosterCreationMode";
import PublishStepTitle from "./PublishStepTitle";

type PublishModalStyles = Readonly<Record<string, string>>;

type PublishCreationModePanelProps = {
  styles: PublishModalStyles;
  isMobile: boolean;
  mode: BoosterCreationMode | null;
  disabled: boolean;
  selectedChannelCount: number;
  error: string;
  showReset: boolean;
  onSelectMode: (mode: BoosterCreationMode) => void;
  onReset: () => void;
};

const MODE_OPTIONS: Array<{
  mode: BoosterCreationMode;
  icon: string;
  titleKey: "creer_avec_inrcy_6abf3922" | "creer_manuellement_89b2d47e";
  descriptionKey:
    | "decrivez_votre_intention_et_laissez_inrcy_594d642e"
    | "redigez_directement_vos_contenus_par_canal_3c8f02e2";
}> = [
  {
    mode: "ai",
    icon: "✨",
    titleKey: "creer_avec_inrcy_6abf3922",
    descriptionKey: "decrivez_votre_intention_et_laissez_inrcy_594d642e",
  },
  {
    mode: "manual",
    icon: "✍️",
    titleKey: "creer_manuellement_89b2d47e",
    descriptionKey: "redigez_directement_vos_contenus_par_canal_3c8f02e2",
  },
];

export default function PublishCreationModePanel({
  styles,
  isMobile,
  mode,
  disabled,
  selectedChannelCount,
  error,
  showReset,
  onSelectMode,
  onReset,
}: PublishCreationModePanelProps) {
  const i18nT = useTranslations("booster");
  const channelSelectionMissing = selectedChannelCount === 0;
  const selectionDisabled = disabled || channelSelectionMissing;

  return (
    <div
      className={styles.blockCard}
      data-testid="booster-creation-mode-panel"
      style={{ minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <PublishStepTitle styles={styles} step={2}>
          {i18nT("mode_de_creation_18e407f0")}{" "}</PublishStepTitle>
        {showReset ? (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onReset}
            disabled={disabled}
            style={{
              minHeight: 32,
              padding: "6px 12px",
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? "wait" : "pointer",
            }}
          >
            {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
        ) : null}
      </div>

      <div
        className={styles.subtitle}
        style={{ marginBottom: 12, maxWidth: "none", whiteSpace: "normal" }}
      >
        {i18nT("choisissez_votre_mode_de_creation_vous_4d39fb96")}{" "}</div>

      <div
        role="radiogroup"
        aria-label={i18nT("mode_de_creation_de_la_publication_970ff581")}
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "minmax(0, 1fr)"
            : "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {MODE_OPTIONS.map((option) => {
          const active = mode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`booster-creation-mode-${option.mode}`}
              onClick={() => onSelectMode(option.mode)}
              disabled={selectionDisabled}
              style={{
                minWidth: 0,
                minHeight: isMobile ? 94 : 100,
                padding: isMobile ? "13px 14px" : "15px 16px",
                borderRadius: 16,
                border: active
                  ? "1px solid rgba(76,195,255,0.78)"
                  : "1px solid rgba(255,255,255,0.15)",
                background: active
                  ? "linear-gradient(145deg, rgba(36,157,213,0.24), rgba(35,78,145,0.16))"
                  : "rgba(255,255,255,0.045)",
                boxShadow: active
                  ? "0 0 0 2px rgba(76,195,255,0.10), 0 14px 30px rgba(0,0,0,0.16)"
                  : "none",
                color: "white",
                textAlign: "left",
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr)",
                gap: 12,
                alignItems: "start",
                opacity: selectionDisabled ? 0.58 : 1,
                cursor: selectionDisabled ? "not-allowed" : "pointer",
                transition:
                  "border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  display: "grid",
                  placeItems: "center",
                  background: active
                    ? "rgba(76,195,255,0.18)"
                    : "rgba(255,255,255,0.08)",
                  fontSize: 19,
                  flex: "0 0 auto",
                }}
              >
                {option.icon}
              </span>
              <span style={{ display: "grid", gap: 6, minWidth: 0 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: isMobile ? 14 : 14.5,
                    fontWeight: 900,
                    lineHeight: 1.2,
                  }}
                >
                  <span>{i18nT(option.titleKey)}</span>
                  {active ? (
                    <span
                      style={{
                        borderRadius: 999,
                        border: "1px solid rgba(125,211,252,0.4)",
                        background: "rgba(14,165,233,0.14)",
                        color: "#dff6ff",
                        padding: "3px 7px",
                        fontSize: 10.5,
                        fontWeight: 900,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {i18nT("selectionne_846fb343")}{" "}</span>
                  ) : null}
                </span>
                <span
                  style={{
                    color: "rgba(255,255,255,0.68)",
                    fontSize: isMobile ? 12.25 : 12.5,
                    lineHeight: 1.4,
                    fontWeight: 650,
                  }}
                >
                  {i18nT(option.descriptionKey)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {channelSelectionMissing ? (
        <div
          role="status"
          style={{
            marginTop: 10,
            color: "rgba(255,255,255,0.68)",
            fontSize: 12.5,
            lineHeight: 1.35,
          }}
        >
          {i18nT("selectionnez_au_moins_un_canal_dans_93e1f00a")}{" "}</div>
      ) : null}
      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 10,
            color: "#ffb4b4",
            fontSize: 12.75,
            lineHeight: 1.35,
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
