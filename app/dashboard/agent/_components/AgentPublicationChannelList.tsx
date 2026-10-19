import { useTranslations } from "next-intl";
import styles from "../agent.module.css";
import type { ChannelKey } from "../_lib/agent.types";

type Props = {
  channels: Array<{ key: ChannelKey; label: string; src: string; connected: boolean; prepared: boolean }>;
  selectedChannels: ChannelKey[];
  disabled: boolean;
  saving: boolean;
  onChange: (channels: ChannelKey[]) => void;
  preparingChannel: ChannelKey | null;
};

export default function AgentPublicationChannelList({ channels, selectedChannels, disabled, saving, onChange, preparingChannel }: Props) {
  const t = useTranslations("agent");
  return (
    <details className={`${styles.campaignInfoCard} ${styles.publicationChannelMenu}`}
      onKeyDown={event => { if (event.key === "Escape") event.currentTarget.open = false; }}>
      <summary aria-label={t("publication_channel_list")}>
        <span className={styles.campaignInfoIcon} aria-hidden>☑</span>
        <span><small>{t("publication_channel_list")}</small><strong>{t("publication_selected_channel_count", { selected: selectedChannels.length, total: channels.length })}</strong></span>
        <span className={styles.publicationChannelChevron} aria-hidden>⌄</span>
      </summary>
      <div className={styles.publicationChannelOptions} aria-busy={saving}>
        <div className={styles.publicationChannelBulk}>
          <button type="button" disabled={disabled || saving || !channels.some(item => item.connected)} onClick={() => onChange(channels.filter(item => item.connected).map(item => item.key))}>{t("publication_channels_select_all")}</button>
          <button type="button" disabled={disabled || saving || !channels.length} onClick={() => onChange([])}>{t("publication_channels_select_none")}</button>
        </div>
        <fieldset disabled={disabled || saving}>
          <legend className={styles.publicationChannelLegend}>{t("publication_channel_list")}</legend>
          {channels.map(item => (
            <label key={item.key} data-connected={item.connected}
              title={!item.connected ? t("publication_channel_not_connected") : undefined}>
              <input type="checkbox" checked={selectedChannels.includes(item.key)} disabled={!item.connected && !selectedChannels.includes(item.key)}
                onChange={event => onChange(event.target.checked ? [...selectedChannels, item.key] : selectedChannels.filter(key => key !== item.key))} />
              <img src={item.src} alt="" width={24} height={24} />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        {saving ? <span role="status" className={styles.publicationChannelLegend}>{preparingChannel ? t("publication_channel_preparing") : t("enregistrement_e7d5f232")}</span> : null}
      </div>
    </details>
  );
}
