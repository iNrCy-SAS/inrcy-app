"use client";

import { useTranslations } from "next-intl";
import { useDashboardViewerAccess } from "./DashboardViewerAccessProvider";
import type { useThreadsChannel } from "../_hooks/channels/useThreadsChannel";
import StatusMessage from "./StatusMessage";
import ChannelSettingsStep from "../settings/_components/ChannelSettingsStep";
import guideStyles from "../settings/_components/ChannelSettingsSteps.module.css";
import styles from "../dashboard.module.css";
import socialStyles from "./SocialSettingsSteps.module.css";
import type { ThreadsPublicationMode } from "@/lib/threadsPublicationPreferences";

export default function ThreadsPublicationSettings({ channel }: { channel: ReturnType<typeof useThreadsChannel> }) {
  const t = useTranslations("shell");
  const { metaPilotEnabled } = useDashboardViewerAccess();
  if (!metaPilotEnabled) return null;
  const { publicationPreferences, preferencesLoading, preferencesSaving, preferencesNotice, preferencesError, updatePublicationPreferences, savePublicationPreferences, loadPublicationPreferences } = channel;
  const preferencesDisabled = preferencesLoading || preferencesSaving || Boolean(preferencesError);
  return (
    <div className={guideStyles.steps}>
      <ChannelSettingsStep accent="x" title={t("threads_publication_modes_title")} description={t("threads_publication_modes_help")}>
        <div className={socialStyles.choiceGrid}>
          <label className={socialStyles.choiceCard}>
            <span className={socialStyles.choiceCopy}><strong>{t("threads_classic_mode")}</strong><span>{t("threads_classic_mode_help")}</span></span>
            <input className={socialStyles.choiceInput} type="checkbox" checked disabled />
            <span className={socialStyles.choiceIndicator} aria-hidden="true">✓</span>
          </label>
          <label className={socialStyles.choiceCard}>
            <span className={socialStyles.choiceCopy}><strong>{t("threads_ghost_mode")}</strong><span>{t("threads_ghost_mode_help")}</span></span>
            <input className={socialStyles.choiceInput} type="checkbox" checked={publicationPreferences.ghostEnabled} disabled={preferencesDisabled} onChange={event => updatePublicationPreferences({ ghostEnabled: event.target.checked, ...(!event.target.checked && publicationPreferences.defaultMode === "ghost" ? { defaultMode: "classic" } : {}) })} />
            <span className={socialStyles.choiceIndicator} aria-hidden="true">✓</span>
          </label>
        </div>
        <div className={guideStyles.actionRow}>
          <label style={{ display: "grid", gap: 6 }}>
            <strong>{t("threads_default_publication_mode")}</strong>
            <select value={publicationPreferences.defaultMode} disabled={preferencesDisabled} onChange={event => updatePublicationPreferences({ defaultMode: event.target.value as ThreadsPublicationMode })} style={{ minHeight: 40, padding: "8px 12px", borderRadius: 12, background: "#101726", color: "#fff", border: "1px solid rgba(255,255,255,0.18)" }}>
              <option value="classic">{t("threads_classic_mode")}</option>
              {publicationPreferences.ghostEnabled ? <option value="ghost">{t("threads_ghost_mode")}</option> : null}
            </select>
          </label>
          <button type="button" className={styles.actionBtn + " " + styles.connectBtn} disabled={preferencesDisabled} onClick={() => void savePublicationPreferences()} style={{ alignSelf: "end" }}>{t(preferencesSaving ? "threads_publication_modes_saving" : "threads_publication_modes_save")}</button>
        </div>
        {preferencesNotice ? <StatusMessage variant="success">{preferencesNotice}</StatusMessage> : null}
        {preferencesError ? <><StatusMessage variant="error">{preferencesError}</StatusMessage><button type="button" className={styles.actionBtn + " " + styles.secondaryBtn} disabled={preferencesLoading || preferencesSaving} onClick={() => void loadPublicationPreferences()}>{t("threads_publication_modes_retry")}</button></> : null}
      </ChannelSettingsStep>
    </div>
  );
}
