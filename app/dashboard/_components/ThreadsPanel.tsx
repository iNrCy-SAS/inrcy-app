"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useDashboardViewerAccess } from "./DashboardViewerAccessProvider";
import type { useThreadsChannel } from "../_hooks/channels/useThreadsChannel";
import ConnectionPill from "./ConnectionPill";
import StatusMessage from "./StatusMessage";
import ChannelSettingsStep from "../settings/_components/ChannelSettingsStep";
import guideStyles from "../settings/_components/ChannelSettingsSteps.module.css";
import styles from "../dashboard.module.css";

export default function ThreadsPanel({ channel }: { channel: ReturnType<typeof useThreadsChannel> }) {
  const t = useTranslations("shell");
  const { metaPilotEnabled } = useDashboardViewerAccess();
  if (!metaPilotEnabled) return null;
  const { connection, loading, busy, notice, error, connectThreads, disconnectThreads } = channel;
  return (
    <div className={guideStyles.steps}>
      <ChannelSettingsStep step={1} accent="x" title={t("threads_connect_title")} description={t("threads_connect_help")}
        status={<ConnectionPill connected={connection.connected} status={connection.connectionStatus} label={loading ? t("threads_checking") : undefined} />}>
        <div className={guideStyles.compactActionLine}>
          <div className={guideStyles.accountSurface}>
            <Image className={guideStyles.channelIcon} src="/icons/threads.svg" width={46} height={46} alt="" aria-hidden="true" />
            <div className={guideStyles.accountCopy}>
              <strong>{connection.username ? "@" + connection.username : t("account_not_connected")}</strong>
              <span>{connection.requiresUpdate ? t("threads_reconnect_help") : t("threads_identity_help")}</span>
            </div>
          </div>
          <div className={guideStyles.actionRow}>
            {!connection.connected || connection.requiresUpdate ? (
              <button type="button" className={styles.actionBtn + " " + styles.connectBtn} onClick={connectThreads} disabled={loading || busy}>{connection.requiresUpdate ? t("threads_reconnect") : t("threads_connect")}</button>
            ) : <button type="button" className={styles.actionBtn + " " + styles.disconnectBtn} onClick={() => void disconnectThreads()} disabled={busy}>{busy ? t("deconnexion_f5a5666d") : t("deconnexion_903dca17")}</button>}
          </div>
        </div>
        {connection.profileUrl ? <a className={styles.actionBtn + " " + styles.secondaryBtn} href={connection.profileUrl} target="_blank" rel="noopener noreferrer">{t("threads_view_profile")}</a> : null}
        {notice ? <StatusMessage variant="success">{notice}</StatusMessage> : null}
        {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
      </ChannelSettingsStep>
    </div>
  );
}
