import { useTranslations } from "next-intl";
import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  BOOSTER_CHANNEL_ORDER,
  getLocalizedChannelLabel,
  type ChannelKey,
} from "../publishModal.shared";
import {
  channelBtn,
  channelBtnDisabled,
} from "../publishModal.styles";
import PublishStepTitle from "./PublishStepTitle";

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

type PublishChannelSelectorProps = {
  styles: PublishModalStyles;
  isMobile: boolean;
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
  inrcy_site: "/icons/inrcy.png",
  site_web: "/icons/site-web.jpg",
  inr_search: "/icons/inr-search-bubble-128.png",
  gmb: "/icons/google.jpg",
  facebook: "/icons/facebook.png",
  instagram: "/icons/instagram.jpg",
  linkedin: "/icons/linkedin.png",
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
  styles,
  isMobile,
  connected,
  channels,
  channelInfoOpen,
  setChannelInfoOpen,
  toggle,
  setAllChannelsSelected,
  getChannelDetailInfo,
}: PublishChannelSelectorProps) {
  const i18nT = useTranslations("booster");
  const channelKeys = BOOSTER_CHANNEL_ORDER;
  const connectedChannelKeys = channelKeys.filter((key) => connected[key]);
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

  return (
    <div
      className={styles.blockCard}
      style={{ minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <PublishStepTitle styles={styles} step={1}>
          {i18nT("canaux_27cb4473")}{" "}</PublishStepTitle>
        <button
          type="button"
          aria-label={bulkLabel}
          title={bulkLabel}
          disabled={!hasConnectedChannels}
          onClick={() => setAllChannelsSelected(!allConnectedSelected)}
          style={{
            minWidth: isMobile ? 34 : undefined,
            width: isMobile ? 34 : undefined,
            height: isMobile ? 34 : 32,
            padding: isMobile ? 0 : "0 13px",
            borderRadius: isMobile ? 11 : 999,
            border: "1px solid rgba(255,255,255,0.18)",
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.045))",
            color: "rgba(255,255,255,0.88)",
            fontSize: 12.5,
            fontWeight: 900,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            whiteSpace: "nowrap",
            cursor: hasConnectedChannels ? "pointer" : "not-allowed",
            opacity: hasConnectedChannels ? 1 : 0.45,
          }}
        >
          {isMobile ? (
            <span
              aria-hidden="true"
              style={{
                width: 15,
                height: 15,
                borderRadius: 4,
                border: "2px solid currentColor",
                display: "inline-grid",
                placeItems: "center",
                fontSize: 10,
                fontWeight: 950,
                lineHeight: 1,
              }}
            >
              {allConnectedSelected ? "✓" : ""}
            </span>
          ) : (
            bulkLabel
          )}
        </button>
      </div>
      <div className={styles.subtitle} style={{ marginBottom: isMobile ? 10 : 8 }}>
        {i18nT("inrcy_publie_une_version_adaptee_sur_ede47961")}{" "}</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "repeat(2, minmax(0, 1fr))"
            : `repeat(${channelKeys.length}, minmax(0, 1fr))`,
          gap: isMobile ? 8 : 6,
          alignItems: "stretch",
        }}
      >
        {channelKeys.map((key, index) => {
          const info = getChannelDetailInfo(key);
          const isConnected = connected[key];
          const requiresReconnect = Boolean(info?.requiresReconnect);
          const isSelected = channels[key] && isConnected;
          const isInfoVisible = channelInfoOpen === key && !!info;
          const isLastOddMobileItem = isMobile && index === channelKeys.length - 1 && channelKeys.length % 2 === 1;
          const channelLabel = getLocalizedChannelLabel(key, (messageKey) => i18nT(messageKey as never));

          if (isMobile) {
            return (
              <div
                key={key}
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
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontWeight: 850,
                    fontSize: 12.4,
                    lineHeight: 1.1,
                    letterSpacing: "-0.025em",
                    color: isConnected
                      ? "rgba(255,255,255,0.97)"
                      : requiresReconnect
                        ? "rgba(255,255,255,0.78)"
                        : "rgba(255,255,255,0.48)",
                  }}
                >
                  {channelLabel}
                </span>
                <button
                  type="button"
                  aria-label={
                    requiresReconnect
                      ? i18nT("channel_reconnect_aria", { channel: channelLabel })
                      : info
                        ? i18nT("channel_details_aria", { channel: channelLabel })
                        : isConnected
                          ? i18nT("channel_connected_aria", { channel: channelLabel })
                          : i18nT("channel_disconnected_aria", { channel: channelLabel })
                  }
                  title={
                    requiresReconnect
                      ? i18nT("reconnect_in_channels")
                      : info
                        ? i18nT("channel_details_aria", { channel: channelLabel })
                        : isConnected
                          ? i18nT("channel_connected")
                          : i18nT("channel_disconnected")
                  }
                  disabled={!info}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!info) return;
                    setChannelInfoOpen((prev) =>
                      prev === key ? null : key,
                    );
                  }}
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
                    cursor: info ? "pointer" : "default",
                    opacity: requiresReconnect ? 1 : isConnected ? 1 : 0.6,
                    boxShadow: requiresReconnect
                      ? "0 0 14px rgba(251,146,60,0.18)"
                      : isConnected
                        ? "0 0 0 1px rgba(255,255,255,0.10) inset, 0 8px 18px rgba(34,197,94,0.34)"
                        : "none",
                  }}
                >
                  {requiresReconnect ? <WarningTriangle size={17} /> : <LinkIcon />}
                </button>
                {isInfoVisible && info ? (
                  <div
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    style={{
                      position: "absolute",
                      top: "50%",
                      right: 36,
                      transform: "translateY(-50%)",
                      zIndex: 20,
                      maxWidth: "min(200px, calc(100% - 54px))",
                      borderRadius: 999,
                      padding: "8px 12px",
                      background: "rgba(9,16,31,0.96)",
                      border: "1px solid rgba(148,163,184,0.22)",
                      boxShadow: "0 18px 40px rgba(0,0,0,0.34)",
                      textAlign: "left",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        lineHeight: 1.35,
                        color: "rgba(255,255,255,0.92)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {info.mobileLabel}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <div
              key={key}
              onClick={() => toggle(key)}
              role="button"
              tabIndex={isConnected ? 0 : -1}
              aria-disabled={!isConnected}
              aria-pressed={isSelected}
              title={requiresReconnect
                ? i18nT("channel_reconnect_title", { channel: channelLabel })
                : info?.fullLabel || (isConnected
                  ? i18nT("channel_connected_aria", { channel: channelLabel })
                  : i18nT("channel_disconnected_aria", { channel: channelLabel }))}
              onMouseEnter={() => {
                if (info) setChannelInfoOpen(key);
              }}
              onMouseLeave={() => {
                if (info) setChannelInfoOpen((prev) => (prev === key ? null : prev));
              }}
              onFocus={() => {
                if (info) setChannelInfoOpen(key);
              }}
              onBlur={() => {
                if (info) setChannelInfoOpen((prev) => (prev === key ? null : prev));
              }}
              onKeyDown={(event) => {
                if (!isConnected) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle(key);
                }
              }}
              style={{
                ...(!isConnected ? channelBtnDisabled : {}),
                minHeight: 45,
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
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: isConnected ? "#43d17d" : "#ff6b7d",
                    boxShadow: isConnected
                      ? "0 0 12px rgba(67,209,125,0.45)"
                      : "0 0 12px rgba(255,107,125,0.25)",
                  }}
                />
              )}
              {isSelected ? (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 7,
                    left: 7,
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    display: "inline-grid",
                    placeItems: "center",
                    background: "rgba(76,195,255,0.92)",
                    color: "#07111f",
                    fontSize: 12,
                    fontWeight: 950,
                    lineHeight: 1,
                  }}
                >
                  ✓
                </span>
              ) : null}
              <img
                src={CHANNEL_ICON_SRC[key]}
                alt=""
                aria-hidden="true"
                loading="eager"
                decoding="sync"
                fetchPriority="high"
                style={{
                  width: key === "site_web" ? 25 : 27,
                  height: key === "site_web" ? 25 : 27,
                  borderRadius: 999,
                  objectFit: "cover",
                  opacity: isConnected ? 1 : requiresReconnect ? 0.72 : 0.48,
                  filter: isConnected ? undefined : requiresReconnect ? "grayscale(0.35)" : "grayscale(0.7)",
                  boxShadow: isSelected ? "0 0 18px rgba(76,195,255,0.24)" : undefined,
                }}
              />
              {isInfoVisible && info ? (
                <div
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 40,
                    width: 230,
                    maxWidth: "min(230px, 80vw)",
                    borderRadius: 14,
                    padding: "9px 11px",
                    background: "rgba(9,16,31,0.98)",
                    border: "1px solid rgba(148,163,184,0.24)",
                    boxShadow: "0 18px 44px rgba(0,0,0,0.40)",
                    textAlign: "center",
                    pointerEvents: "none",
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 950, color: "rgba(255,255,255,0.96)", marginBottom: 2 }}>
                    {channelLabel}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.35,
                      color: "rgba(255,255,255,0.76)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {info.desktopLabel}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
