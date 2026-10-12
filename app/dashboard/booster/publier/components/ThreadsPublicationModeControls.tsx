import { useTranslations } from "next-intl";
import type { ThreadsPublicationMode, ThreadsPublicationPreferences } from "@/lib/threadsPublicationPreferences";
import { getThreadsPublicationModeIssue } from "../threadsPublicationUi";
import { pillBtn, pillBtnActive } from "../publishModal.styles";

export type ThreadsPublicationModeControlsProps = {
  mode: ThreadsPublicationMode;
  preferences: ThreadsPublicationPreferences;
  loading: boolean;
  failed: boolean;
  disabled?: boolean;
  onChange: (mode: ThreadsPublicationMode) => void;
};

export default function ThreadsPublicationModeControls({ mode, preferences, loading, failed, disabled = false, onChange }: ThreadsPublicationModeControlsProps) {
  const t = useTranslations("booster");
  const issue = getThreadsPublicationModeIssue(mode, preferences, loading, failed);
  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div role="group" aria-label={t("threads_publication_format")} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 12 }}>{t("threads_publication_format")}</strong>
        {(["classic", "ghost"] as const).map((choice) => (
          <button key={choice} type="button" aria-pressed={mode === choice} disabled={disabled || (choice === "ghost" && (loading || failed || !preferences.ghostEnabled))} onClick={() => onChange(choice)} style={{ ...pillBtn, ...(mode === choice ? pillBtnActive : {}) }}>
            {t(choice === "ghost" ? "threads_ghost" : "threads_classic")}
          </button>
        ))}
      </div>
      {mode === "ghost" ? <span role="note" style={{ color: "#fde68a", fontSize: 12 }}>{t("threads_ghost_help")}</span> : null}
      {issue ? <span role="alert" style={{ color: "#fecaca", fontSize: 12 }}>{t(issue)}</span> : null}
    </div>
  );
}
