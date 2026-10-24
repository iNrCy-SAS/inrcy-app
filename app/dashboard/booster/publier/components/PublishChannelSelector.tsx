import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { useEffect, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import {
  BOOSTER_CHANNEL_ORDER,
  getLocalizedChannelLabel,
  type ChannelKey,
} from "../publishModal.shared";
import {
  channelBtn,
  channelBtnDisabled,
} from "../publishModal.styles";
import { useDashboardViewerAccess } from "../../../_components/DashboardViewerAccessProvider";
import css from "./PublishChannelSelector.module.css";
import { PUBLISH_CHANNEL_IDENTITY } from "./publishChannelIdentity";

type PublishModalStyles = Readonly<Record<string, string>>;

type ChannelReadiness = {
  tone: "ready" | "warning" | "blocked";
  message: string;
  blockers: string[];
  warnings: string[];
};

type ChannelDetailInfo = {
  href: string | null;
  desktopLabel: string;
  mobileLabel: string;
  fullLabel: string;
  requiresReconnect?: boolean;
  connectionStatus?: string | null;
};

function getChannelAccountName(info: ChannelDetailInfo | null, isConnected: boolean, channelLabel: string, companyName?: string) {
  if (!isConnected || info?.requiresReconnect) return "";
  const companyLabel = String(companyName || "").trim();
  if (companyLabel) return companyLabel;
  const label = String(info?.fullLabel || "").trim();
  if (!label || label.toLocaleLowerCase() === channelLabel.toLocaleLowerCase()) return "";
  // Connection fallbacks describe a state, not the destination account.
  if (/^(?:compte|page|fiche|cha[iî]ne|site web)\b.*\b(?:connect[eé]e?|publi[eé]e?|indisponible)$/i.test(label)) return "";
  return label;
}

type PublishChannelSelectorProps = {
  actionsContainer?: HTMLElement | null;
  connectionsPending?: boolean;
  styles: PublishModalStyles;
  isMobile: boolean;
  companyName?: string;
  connected: Record<ChannelKey, boolean>;
  channels: Record<ChannelKey, boolean>;
  channelReadiness?: Partial<Record<ChannelKey, ChannelReadiness>>;
  channelInfoOpen: ChannelKey | null;
  setChannelInfoOpen: Dispatch<SetStateAction<ChannelKey | null>>;
  toggle: (key: ChannelKey) => void;
  setAllChannelsSelected: (selected: boolean) => void;
  getChannelDetailInfo: (key: ChannelKey) => ChannelDetailInfo | null;
};

const CHANNEL_ICON_SRC: Record<ChannelKey, string> = {

  site_web: "/icons/site-web.jpg",
  inr_search: "/icons/inr-search-bubble-128.png",
  gmb: "/icons/google.jpg",
  facebook: "/icons/facebook.png",
  instagram: "/icons/instagram.jpg",
  threads: "/icons/threads.svg",
  linkedin: "/icons/linkedin.png",
  x: "/icons/x.svg",
  tiktok: "/icons/tiktok.png",
  youtube_shorts: "/icons/youtube-shorts.png",
  pinterest: "/icons/pinterest-logo-128.png",
};

function WarningTriangle({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", color: "#fb923c", filter: "drop-shadow(0 0 6px rgba(251,146,60,0.55))" }}
    >
      <path d="M12 3.5 21 20H3L12 3.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 8.5v5.7" stroke="#241204" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12" cy="17.2" r="1.15" fill="#241204" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <path
        d="M10.6 13.4a3 3 0 0 0 4.24 0l3.18-3.18a3 3 0 1 0-4.24-4.24l-1.41 1.41M13.4 10.6a3 3 0 0 0-4.24 0l-3.18 3.18a3 3 0 1 0 4.24 4.24l1.41-1.41"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PublishChannelSelector({
  actionsContainer,
  connectionsPending = false,
  styles,
  isMobile,
  companyName,
  connected,
  channels,
  toggle,
  setAllChannelsSelected,
  getChannelDetailInfo,
}: PublishChannelSelectorProps) {
  const { metaPilotEnabled } = useDashboardViewerAccess();
  const i18nT = useTranslations("booster");
  const channelKeys = BOOSTER_CHANNEL_ORDER;
  // Pinterest cannot publish without a real destination board. Contrary to
  // the other channels, showing it disabled would suggest that the OAuth
  // account alone is enough, so keep it out of Booster until the board-ready
  // connection state has been confirmed by the server.
  const visibleChannelKeys = channelKeys.filter(
    (key) => (key !== "threads" || metaPilotEnabled) && (key !== "pinterest" || connected.pinterest),
  );
  const connectedChannelKeys = visibleChannelKeys.filter(
    (key) => connected[key],
  );
  const selectedConnectedCount = connectedChannelKeys.filter((key) => channels[key]).length;
  const hasConnectedChannels = connectedChannelKeys.length > 0;
  const allConnectedSelected = hasConnectedChannels && selectedConnectedCount === connectedChannelKeys.length;
  const bulkLabel = allConnectedSelected
    ? i18nT("deselect_all_channels")
    : i18nT("select_all_channels");

  useEffect(() => {
    // Warm every icon as soon as Booster opens so the channel row never
    // appears with late or missing logos. Reusing the same URLs keeps this
    // operation in the browser cache.
    Object.values(CHANNEL_ICON_SRC).forEach((src) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
    });
  }, []);

  const bulkControl = (
    <label className={css.bulkControl} title={bulkLabel}>
      <input type="checkbox" checked={allConnectedSelected}
        ref={(input) => { if (input) input.indeterminate = selectedConnectedCount > 0 && !allConnectedSelected; }}
        disabled={!hasConnectedChannels} aria-label={bulkLabel}
        onChange={(event) => setAllChannelsSelected(event.target.checked)} />
      <span>{bulkLabel}</span>
    </label>
  );

  if (connectionsPending) {
    return (
      <div className={css.selector} aria-busy="true">
        <p className={css.connectionLoading} role="status">{i18nT("connections_loading")}</p>
        <div className={css.channelGrid} style={{ display: isMobile ? "grid" : "flex", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", flexWrap: "wrap" }}>
          {channelKeys.filter(key => key !== "threads" || metaPilotEnabled).map(key => (
            <div key={key} className={`${css.channelCard} ${css.pendingCard} ${isMobile ? css.mobileCard : ""}`} aria-hidden="true">
              <img className={isMobile ? css.mobileLogo : css.channelLogo} src={CHANNEL_ICON_SRC[key]} alt="" />
              <span className={css.channelCopy}>
                <span className={css.channelName}>{getLocalizedChannelLabel(key, messageKey => i18nT(messageKey as never))}</span>
                <span className={css.accountPlaceholder} />
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={css.selector}
      style={{
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        overflow: "visible",
      }}
    >
      {actionsContainer ? createPortal(bulkControl, actionsContainer) : bulkControl}
      <div
        className={css.channelGrid}
        style={{
          display: isMobile ? "grid" : "flex",
          gridTemplateColumns: isMobile
            ? "repeat(2, minmax(0, 1fr))"
            : "repeat(auto-fit, minmax(160px, 1fr))",
          gap: isMobile ? 8 : 14,
          alignItems: "stretch",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {visibleChannelKeys.map((key, index) => {
          const identity = PUBLISH_CHANNEL_IDENTITY[key];
          const channelStyle = {
            "--channel-accent": identity.color,
            "--channel-rgb": identity.rgb,
          } as CSSProperties;
          const info = getChannelDetailInfo(key);
          const isConnected = connected[key];
          const requiresReconnect = Boolean(info?.requiresReconnect);
          const isSelected = channels[key] && isConnected;
          const isLastOddMobileItem = isMobile && index === visibleChannelKeys.length - 1 && visibleChannelKeys.length % 2 === 1;
          const channelLabel = getLocalizedChannelLabel(key, (messageKey) => i18nT(messageKey as never));
          const accountName = getChannelAccountName(info, isConnected, channelLabel, key === "inr_search" ? companyName : undefined);

          if (isMobile) {
            return (
              <div
                key={key}
                className={`${css.channelCard} ${css.mobileCard}`}
                data-reconnect={requiresReconnect}
                onClick={() => toggle(key)}
                role="button"
                tabIndex={isConnected ? 0 : -1}
                aria-disabled={!isConnected}
                aria-pressed={isSelected}
                onKeyDown={(event) => {
                  if (!isConnected) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle(key);
                  }
                }}
                style={{
                  ...channelStyle,
                  ...channelBtn,
                  ...(!isConnected ? channelBtnDisabled : {}),
                  minHeight: 43,
                  padding: "8px 8px",
                  position: "relative",
                  overflow: "visible",
                  border: isSelected
                    ? "1px solid rgba(56,189,248,0.82)"
                    : requiresReconnect
                      ? "1px solid rgba(251,146,60,0.52)"
                      : "1px solid rgba(255,255,255,0.12)",
                  boxShadow: isSelected
                    ? "0 0 0 1px rgba(56,189,248,0.26) inset, 0 10px 24px rgba(14,165,233,0.12)"
                    : requiresReconnect
                      ? "0 0 18px rgba(251,146,60,0.10)"
                      : "none",
                  background: isSelected
                    ? "linear-gradient(135deg, rgba(56,189,248,0.22), rgba(14,116,144,0.20))"
                    : requiresReconnect
                      ? "linear-gradient(135deg, rgba(251,146,60,0.12), rgba(234,88,12,0.05))"
                      : "rgba(255,255,255,0.04)",
                  cursor: isConnected ? "pointer" : "not-allowed",
                  opacity: requiresReconnect ? 0.86 : undefined,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 7,
                  ...(isLastOddMobileItem
                    ? {
                        gridColumn: "1 / -1",
                        width: "calc(50% - 4px)",
                        justifySelf: "center",
                      }
                    : {}),
                }}
              >
                <span className={css.mobileIdentity} aria-hidden="true">
                  <img className={css.mobileLogo} src={CHANNEL_ICON_SRC[key]} alt="" loading="eager" />
                </span>
                <span className={css.channelCopy}>
                  <span className={css.mobileName}>{channelLabel}</span>
                  {accountName ? <span className={css.accountName} title={accountName}>{accountName}</span> : null}
                </span>
                <span
                  role="img"
                  className={css.connectionButton}
                  data-connected={isConnected}
                  title={accountName || undefined}
                  aria-label={
                    requiresReconnect
                      ? i18nT("channel_reconnect_aria", { channel: channelLabel })
                      : isConnected
                          ? i18nT("channel_connected_aria", { channel: channelLabel })
                          : i18nT("channel_disconnected_aria", { channel: channelLabel })
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: requiresReconnect
                      ? "1px solid rgba(251,146,60,0.62)"
                      : isConnected
                        ? "1px solid rgba(134,239,172,0.58)"
                        : "1px solid rgba(255,255,255,0.12)",
                    background: requiresReconnect
                      ? "rgba(251,146,60,0.12)"
                      : isConnected
                        ? "linear-gradient(180deg, rgba(34,197,94,0.96), rgba(22,163,74,0.96))"
                        : "rgba(255,255,255,0.08)",
                    color: requiresReconnect ? "#fb923c" : isConnected ? "#ffffff" : "rgba(255,255,255,0.46)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    cursor: "default",
                    opacity: requiresReconnect ? 1 : isConnected ? 1 : 0.6,
                    boxShadow: requiresReconnect
                      ? "0 0 14px rgba(251,146,60,0.18)"
                      : isConnected
                        ? "0 0 0 1px rgba(255,255,255,0.10) inset, 0 8px 18px rgba(34,197,94,0.34)"
                        : "none",
                  }}
                >
                  {requiresReconnect ? <WarningTriangle size={17} /> : <LinkIcon />}
                </span>
                <span className={css.selectionMark} aria-hidden="true">{isSelected ? "✓" : ""}</span>
              </div>
            );
          }

          return (
            <div
              key={key}
              className={css.channelCard}
              data-reconnect={requiresReconnect}
              onClick={() => toggle(key)}
              role="button"
              tabIndex={isConnected ? 0 : -1}
              aria-disabled={!isConnected}
              aria-pressed={isSelected}
              aria-label={requiresReconnect
                ? i18nT("channel_reconnect_title", { channel: channelLabel })
                : accountName
                  ? `${channelLabel} — ${accountName}`
                  : isConnected
                    ? i18nT("channel_connected_aria", { channel: channelLabel })
                    : i18nT("channel_disconnected_aria", { channel: channelLabel })}
              onKeyDown={(event) => {
                if (!isConnected) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle(key);
                }
              }}
              style={{
                ...channelStyle,
                ...(!isConnected ? channelBtnDisabled : {}),
                minHeight: 130,
                minWidth: 0,
                padding: "5px 4px",
                position: "relative",
                overflow: "visible",
                borderRadius: 16,
                border: isSelected
                  ? "2px solid rgba(76,195,255,0.88)"
                  : requiresReconnect
                    ? "1px solid rgba(251,146,60,0.52)"
                    : "1px solid rgba(255,255,255,0.10)",
                boxShadow: isSelected
                  ? "0 0 0 1px rgba(76,195,255,0.28) inset, 0 0 18px rgba(76,195,255,0.18), 0 10px 24px rgba(8,18,34,0.16)"
                  : requiresReconnect
                    ? "0 0 18px rgba(251,146,60,0.10)"
                    : "none",
                background: isSelected
                  ? "linear-gradient(135deg, rgba(76,195,255,0.16), rgba(34,211,238,0.08))"
                  : requiresReconnect
                    ? "linear-gradient(135deg, rgba(251,146,60,0.11), rgba(234,88,12,0.04))"
                    : "rgba(255,255,255,0.03)",
                cursor: isConnected ? "pointer" : "not-allowed",
                opacity: requiresReconnect ? 0.86 : undefined,
                display: "grid",
                placeItems: "center",
              }}
            >
              {requiresReconnect ? (
                <span
                  aria-hidden
                  style={{ position: "absolute", top: 6, right: 6, display: "inline-flex" }}
                >
                  <WarningTriangle size={18} />
                </span>
              ) : (
                <span
                  aria-hidden
                  className={css.desktopConnection}
                  data-connected={isConnected}
                  title={accountName || undefined}
                ><LinkIcon /></span>
              )}
              <span aria-hidden className={css.selectionMark}>
                {isSelected ? "✓" : ""}
              </span>
              <img
                className={css.channelLogo}
                src={CHANNEL_ICON_SRC[key]}
                alt=""
                aria-hidden="true"
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  objectFit: "cover",
                  opacity: isConnected ? 1 : requiresReconnect ? 0.72 : 0.48,
                  filter: isConnected ? undefined : requiresReconnect ? "grayscale(0.35)" : "grayscale(0.7)",
                  boxShadow: isSelected ? "0 0 18px rgba(76,195,255,0.24)" : undefined,
                }}
              />
              <span className={`${css.channelCopy} ${css.desktopCopy}`}>
                <span className={css.channelName}>{channelLabel}</span>
                {accountName ? <span className={css.accountName} title={accountName}>{accountName}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
