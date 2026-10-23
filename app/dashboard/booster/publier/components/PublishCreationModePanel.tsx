import { useTranslations } from "next-intl";
import type { BoosterCreationMode } from "@/lib/boosterCreationMode";
import css from "./PublishCreationModePanel.module.css";

type PublishCreationModePanelProps = {
  styles: Readonly<Record<string, string>>;
  isMobile: boolean;
  mode: BoosterCreationMode | null;
  disabled: boolean;
  error: string;
  showReset: boolean;
  onSelectMode: (mode: BoosterCreationMode) => void;
  onReset: () => void;
};

const MODE_OPTIONS = [
  { mode: "ai", titleKey: "wizard_automatic", descriptionKey: "wizard_automatic_help" },
  { mode: "manual", titleKey: "wizard_manual", descriptionKey: "wizard_manual_help" },
] as const;

export default function PublishCreationModePanel({
  styles, mode, disabled, error, showReset, onSelectMode, onReset,
}: PublishCreationModePanelProps) {
  const t = useTranslations("booster");
  return (
    <div className={css.panel} data-testid="booster-creation-mode-panel">
      <div role="radiogroup" aria-label={t("mode_de_creation_de_la_publication_970ff581")} className={css.choices}>
        {MODE_OPTIONS.map((option) => (
          <button key={option.mode} type="button" role="radio"
            aria-checked={mode === option.mode}
            data-testid={`booster-creation-mode-${option.mode}`}
            className={css.choice} data-mode={option.mode}
            onClick={() => onSelectMode(option.mode)} disabled={disabled}>
            <span className={css.icon} aria-hidden="true">
              {option.mode === "ai" ? (
                <svg viewBox="0 0 32 32" fill="none"><path d="m16 4 3.2 8.8L28 16l-8.8 3.2L16 28l-3.2-8.8L4 16l8.8-3.2L16 4Z" fill="currentColor" /><path d="m26 2 1.1 3L30 6l-2.9 1L26 10l-1.1-3L22 6l2.9-1L26 2Z" fill="currentColor" /></svg>
              ) : (
                <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m20.5 5.5 6 6M6 26l2-8L21.5 4.5a3.5 3.5 0 0 1 5 5L13 23l-7 3Z" /><path d="M18 27h10" /></svg>
              )}
            </span>
            <span className={css.copy}>
              <span className={css.title}>{t(option.titleKey)}</span>
              <span className={css.description}>{t(option.descriptionKey)}</span>
            </span>
            <span className={css.radio} aria-hidden="true">{mode === option.mode ? "✓" : ""}</span>
          </button>
        ))}
      </div>
      {showReset ? <button type="button" className={styles.secondaryBtn} onClick={onReset} disabled={disabled}>
        {t("reinitialiser_e0e2ad54")}
      </button> : null}
      {error ? <div role="alert" className={css.error}>{error}</div> : null}
    </div>
  );
}
