"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useUnsavedExitGuard } from "../../../_hooks/useUnsavedExitGuard";
import {
  formatVideoDuration,
  validateVideoDurationForChannel,
} from "@/lib/videoPublicationPolicy";

export type TiktokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY"
  | string;

export type TiktokCommercialContent = "none" | "self" | "branded" | "both";

export type TiktokPublicationSettings = {
  privacyLevel: TiktokPrivacyLevel;
  allowComments: boolean;
  allowDuo: boolean;
  allowStitch: boolean;
  commercialContent: TiktokCommercialContent;
  aiContent: boolean;
  photoAutoMusic: boolean;
  musicUsageConfirmed: boolean;
};

type CreatorInfo = {
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoDurationSeconds: number | null;
};

type PublishModalStyles = Readonly<Record<string, string>>;

type Props = {
  open: boolean;
  styles: PublishModalStyles;
  isMobile: boolean;
  mediaType: "video" | "images";
  videoDurationSeconds: number | null;
  previewTitle?: string;
  previewContent?: string;
  previewHashtags?: string[];
  previewMediaUrl?: string | null;
  previewMediaName?: string;
  previewMediaCount?: number;
  onCancel: () => void;
  onValidate: (settings: TiktokPublicationSettings) => void;
  onExcludeAndContinue?: () => void;
};

const privacyLabelKeys = {
  PUBLIC_TO_EVERYONE: "tiktok_privacy_public",
  MUTUAL_FOLLOW_FRIENDS: "tiktok_privacy_friends",
  FOLLOWER_OF_CREATOR: "tiktok_privacy_followers",
  SELF_ONLY: "tiktok_privacy_self",
} as const;

const commercialLabelKeys = {
  none: "tiktok_commercial_none",
  self: "tiktok_commercial_self",
  branded: "tiktok_commercial_branded",
  both: "tiktok_commercial_both",
} as const satisfies Record<TiktokCommercialContent, string>;

const legalLinkStyle = {
  color: "#bae6fd",
  fontWeight: 800,
  textDecoration: "underline",
  textUnderlineOffset: 3,
} as const;

const tiktokLegalLinks = {
  terms: "https://www.tiktok.com/legal/page/row/terms-of-service/en",
  communityGuidelines: "https://www.tiktok.com/community-guidelines/en/",
  musicUsageConfirmation: "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en",
  brandedContentPolicy: "https://www.tiktok.com/legal/page/global/bc-policy/en",
} as const;

function LegalLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={legalLinkStyle}>
      {label}
    </a>
  );
}

function SectionIcon({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        flex: "0 0 auto",
        background: "rgba(56,189,248,0.12)",
        border: "1px solid rgba(56,189,248,0.28)",
        color: "#93c5fd",
        fontSize: 13,
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <SectionIcon>{icon}</SectionIcon>
      <strong style={{ color: "#fff", fontSize: 15, lineHeight: 1.15 }}>{title}</strong>
    </div>
  );
}

function trimText(input: unknown, max = 280) {
  const value = String(input || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

async function readJson(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error("tiktok_creator_info_load_failed");
  }
  return json;
}

function TiktokSettingsLoader() {
  const i18nT = useTranslations("booster");
  return (
    <div
      style={{
        borderRadius: 16,
        padding: 18,
        background: "rgba(76,195,255,0.07)",
        border: "1px solid rgba(76,195,255,0.18)",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 14,
        alignItems: "center",
        minHeight: 108,
      }}
    >
      <style>{`@keyframes inrcy-tiktok-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          border: "3px solid rgba(255,255,255,0.16)",
          borderTopColor: "rgba(76,195,255,0.95)",
          animation: "inrcy-tiktok-spin 0.85s linear infinite",
        }}
      />
      <div style={{ display: "grid", gap: 4 }}>
        <strong style={{ color: "#fff", fontSize: 14 }}>{i18nT("chargement_des_autorisations_tiktok_03df2757")}</strong>
        <span style={{ color: "rgba(255,255,255,0.68)", fontSize: 13, lineHeight: 1.45 }}>
          {i18nT("inrcy_recupere_les_options_reelles_du_10ca7b8b")}{" "}</span>
      </div>
    </div>
  );
}

export default function TiktokPublicationSettingsModal({
  open,
  styles,
  isMobile,
  mediaType,
  videoDurationSeconds,
  previewTitle,
  previewContent,
  previewHashtags,
  previewMediaUrl,
  previewMediaName,
  previewMediaCount,
  onCancel,
  onValidate,
  onExcludeAndContinue,
}: Props) {
  const i18nT = useTranslations("booster");
  const [creatorInfo, setCreatorInfo] = useState<CreatorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState("");
  const [allowComments, setAllowComments] = useState(false);
  const [allowDuo, setAllowDuo] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [commercialContent, setCommercialContent] = useState<TiktokCommercialContent | "">("");
  const [aiContent, setAiContent] = useState(false);
  const [photoAutoMusic, setPhotoAutoMusic] = useState(false);
  const [musicUsageConfirmed, setMusicUsageConfirmed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    setCreatorInfo(null);
    setPrivacyLevel("");
    setAllowComments(false);
    setAllowDuo(false);
    setAllowStitch(false);
    setCommercialContent("");
    setAiContent(false);
    setPhotoAutoMusic(false);
    setMusicUsageConfirmed(false);

    fetch("/api/integrations/tiktok/creator-info", { credentials: "include" }).then(readJson)
      .then((json) => {
        if (!active) return;
        setCreatorInfo(json.creatorInfo as CreatorInfo);
      })
      .catch(() => {
        if (!active) return;
        setError(i18nT("tiktok_load_failed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [i18nT, open]);

  const durationBlocker = useMemo(() => {
    if (!creatorInfo || mediaType !== "video") return "";
    const validation = validateVideoDurationForChannel({
      channel: "tiktok",
      durationSeconds: videoDurationSeconds,
      tiktokMaxDurationSeconds: creatorInfo.maxVideoDurationSeconds,
      enforceAccountCapabilities: true,
    });
    if (validation.ok) return "";

    if (validation.reason === "video_duration_too_short") {
      const min = validation.policy.minDurationSeconds;
      return i18nT("tiktok_duration_too_short", {
        min: min === null ? i18nT("tiktok_duration_unknown_short") : formatVideoDuration(min),
      });
    }

    if (validation.reason === "video_duration_too_long") {
      const accountLimit = Number(creatorInfo.maxVideoDurationSeconds);
      const policyLimit = validation.policy.maxDurationSeconds;
      const effectiveLimit =
        Number.isFinite(accountLimit) && accountLimit > 0
          ? policyLimit === null
            ? accountLimit
            : Math.min(accountLimit, policyLimit)
          : policyLimit;
      return i18nT("tiktok_duration_too_long", {
        max:
          effectiveLimit === null
            ? i18nT("tiktok_duration_unknown_short")
            : formatVideoDuration(effectiveLimit),
      });
    }

    if (validation.reason === "video_duration_account_limit_unknown") {
      return i18nT("tiktok_duration_account_limit_unknown");
    }

    return i18nT("tiktok_duration_unknown");
  }, [creatorInfo, i18nT, mediaType, videoDurationSeconds]);

  const mediaSummary = useMemo(() => {
    if (mediaType === "video") {
      const rawDuration = Number(videoDurationSeconds);
      const duration =
        Number.isFinite(rawDuration) && rawDuration > 0
          ? formatVideoDuration(rawDuration)
          : i18nT("tiktok_duration_unknown_short");
      return `${i18nT("video_304f6ca4")}${previewMediaName ? ` · ${previewMediaName}` : ""} · ${duration}`;
    }
    const count = Math.max(1, Number(previewMediaCount || 0));
    return i18nT("tiktok_photo_summary", { count });
  }, [i18nT, mediaType, previewMediaCount, previewMediaName, videoDurationSeconds]);

  const needsBrandedConsent = commercialContent === "branded" || commercialContent === "both";
  const canValidate = Boolean(
    creatorInfo &&
      privacyLevel &&
      !durationBlocker &&
      commercialContent &&
      musicUsageConfirmed,
  );
  const clearFinalConsent = () => {
    if (musicUsageConfirmed) setMusicUsageConfirmed(false);
  };
  const { confirmExit } = useUnsavedExitGuard({
    active: open,
    shouldBlock: Boolean(privacyLevel || commercialContent || aiContent || photoAutoMusic || musicUsageConfirmed || allowComments || allowDuo || allowStitch),
    onConfirmExit: onCancel,
    eyebrow: i18nT("publication_tiktok_a6d8d0b0"),
    title: i18nT("quitter_sans_enregistrer_6208bd94"),
    message: i18nT("les_choix_tiktok_en_cours_seront_431e8b40"),
    confirmLabel: i18nT("revenir_sans_enregistrer_e2839bfa"),
    cancelLabel: i18nT("continuer_129ffff9"),
    variant: "warning",
  });

  if (!open) return null;

  const accountLabel = creatorInfo
    ? creatorInfo.username || creatorInfo.displayName || i18nT("tiktok_connected_account")
    : i18nT("tiktok_connected_account");
  const hashtags = Array.isArray(previewHashtags) ? previewHashtags.filter(Boolean) : [];
  const caption = trimText(previewContent || previewTitle || i18nT("tiktok_default_publication"), 420);

  const sectionCardStyle = {
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 16,
    padding: isMobile ? 14 : 12,
    background: "linear-gradient(135deg, rgba(15,23,42,0.92), rgba(30,41,59,0.56))",
    border: "1px solid rgba(148,163,184,0.22)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
  } as const;

  const fieldStyle = {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.28)",
    background: "rgba(15,23,42,0.96)",
    color: "white",
    colorScheme: "dark",
    padding: isMobile ? "11px 12px" : "9px 12px",
    outline: "none",
  } as const;

  const helperTextStyle = {
    color: "rgba(226,232,240,0.62)",
    fontSize: 12,
    lineHeight: 1.42,
  } as const;

  return (
    <div
      className={styles.fullscreenModalOverlay}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10013,
        background: "rgba(4, 8, 18, 0.78)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: isMobile ? 10 : 18,
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div
        className={styles.blockCard}
        style={{
          width: isMobile ? "min(100%, 720px)" : "min(1110px, calc(100vw - 36px))",
          minWidth: 0,
          boxSizing: "border-box",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          marginBlock: "auto",
          padding: 0,
          borderRadius: isMobile ? 18 : 22,
          background: "#111827",
          backgroundImage: "none",
          border: "1px solid rgba(148, 163, 184, 0.34)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.035)",
          backdropFilter: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
            flexShrink: 0,
            padding: isMobile ? "14px 14px 12px" : "16px 18px 14px",
            borderBottom: "1px solid rgba(148,163,184,0.16)",
            background: "linear-gradient(180deg, rgba(30,41,59,0.78), rgba(17,24,39,0.96))",
          }}
        >
          <div style={{ fontSize: 28, lineHeight: 1, flex: "0 0 auto" }}>🎵</div>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <div className={styles.blockTitle} style={{ marginBottom: 0, lineHeight: 1.08 }}>
              {i18nT("verification_finale_tiktok_040236e6")}{" "}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.70)", lineHeight: 1.2 }}>
              {i18nT("compte_contenu_visibilite_et_declarations_avant_bddd0f36")}{" "}</div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: isMobile ? 12 : 10,
            minWidth: 0,
            padding: isMobile ? 12 : 14,
            background: "#111827",
          }}
        >
          {loading ? <TiktokSettingsLoader /> : null}

        {error ? (
          <div
            style={{
              borderRadius: 14,
              padding: 12,
              background: "rgba(248,113,113,0.10)",
              border: "1px solid rgba(248,113,113,0.24)",
              color: "#fecaca",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        ) : null}

        {creatorInfo ? (
          <>
            <section style={{ ...sectionCardStyle, display: "grid", gap: isMobile ? 12 : 10 }}>
              <SectionHeader icon="👤" title={i18nT("compte_tiktok_0099e07c")} />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: isMobile ? 12 : 14,
                  alignItems: "center",
                  paddingLeft: isMobile ? 0 : 34,
                }}
              >
                <div
                  style={{
                    width: isMobile ? 54 : 52,
                    height: isMobile ? 54 : 52,
                    borderRadius: 999,
                    overflow: "hidden",
                    display: "grid",
                    placeItems: "center",
                    background: "linear-gradient(135deg, rgba(124,58,237,0.95), rgba(217,70,239,0.78))",
                    border: "1px solid rgba(255,255,255,0.16)",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 22,
                    textTransform: "lowercase",
                  }}
                >
                  {creatorInfo.avatarUrl ? (
                    <img src={creatorInfo.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    (accountLabel.replace(/^@/, "").slice(0, 1) || "t").toLowerCase()
                  )}
                </div>
                <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
                  <strong style={{ color: "#fff", fontSize: 14 }}>{accountLabel}</strong>
                  {creatorInfo.displayName && creatorInfo.displayName !== accountLabel ? (
                    <span style={{ color: "rgba(255,255,255,0.64)", fontSize: 13 }}>{creatorInfo.displayName}</span>
                  ) : null}
                  <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 1.4 }}>
                    {i18nT("cette_publication_sera_envoyee_uniquement_sur_5132cb3f")}{" "}</span>
                </div>
              </div>
            </section>

            <section style={{ ...sectionCardStyle, display: "grid", gap: isMobile ? 12 : 10 }}>
              <SectionHeader icon="🖼️" title={i18nT("contenu_envoye_aaa62b2f")} />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "200px minmax(0, 1fr)",
                  gap: isMobile ? 14 : 14,
                  alignItems: "center",
                  paddingLeft: isMobile ? 0 : 34,
                }}
              >
                <div
                  style={{
                    minHeight: isMobile ? (mediaType === "video" ? 150 : 170) : 114,
                    height: isMobile ? undefined : 124,
                    borderRadius: 14,
                    overflow: "hidden",
                    background: "rgba(0,0,0,0.30)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {previewMediaUrl ? (
                    mediaType === "video" ? (
                      <video src={previewMediaUrl} controls muted playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#020617" }} />
                    ) : (
                        <img src={previewMediaUrl} alt={i18nT("apercu_tiktok_b66ee581")} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    )
                  ) : (
                    <span style={{ color: "rgba(255,255,255,0.52)", fontSize: 13, textAlign: "center", padding: 12 }}>
                      {i18nT("apercu_media_non_disponible_3bcc5dea")}{" "}</span>
                  )}
                </div>
                <div style={{ display: "grid", gap: isMobile ? 10 : 8, minWidth: 0 }}>
                  <div style={{ display: "grid", gap: 5 }}>
                    <strong style={{ color: "#fff", fontSize: 14 }}>{previewMediaName || (mediaType === "video" ? i18nT("video_tiktok_7b95fbc5") : i18nT("photos_tiktok_d2533f42"))}</strong>
                    <span style={{ color: "rgba(255,255,255,0.62)", fontSize: 12 }}>{mediaSummary}</span>
                  </div>
                  <div
                    style={{
                      borderRadius: 12,
                      padding: isMobile ? 12 : 12,
                      minHeight: isMobile ? 72 : 54,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      color: "rgba(255,255,255,0.84)",
                      fontSize: 13,
                      lineHeight: 1.35,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {caption || i18nT("publication_inrcy_27406526")}
                  </div>
                  {hashtags.length ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {hashtags.slice(0, 10).map((tag) => (
                        <span key={tag} style={{ borderRadius: 999, padding: "5px 8px", background: "rgba(76,195,255,0.10)", color: "rgba(191,239,255,0.92)", fontSize: 12 }}>
                          {tag.startsWith("#") ? tag : `#${tag}`}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {durationBlocker ? (
              <div
                style={{
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(248,113,113,0.10)",
                  border: "1px solid rgba(248,113,113,0.24)",
                  color: "#fecaca",
                  fontSize: 13,
                  lineHeight: isMobile ? 1.5 : 1.35,
                }}
              >
                <div>⛔ {durationBlocker}</div>
                {onExcludeAndContinue ? (
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={onExcludeAndContinue}
                    style={{ marginTop: 10, width: isMobile ? "100%" : undefined }}
                  >
                    {i18nT("retirer_tiktok_et_continuer_sur_les_5846dc26")}{" "}</button>
                ) : null}
              </div>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
                gap: isMobile ? 14 : 12,
                alignItems: "stretch",
              }}
            >
              <section style={{ ...sectionCardStyle, display: "grid", gap: isMobile ? 12 : 10 }}>
                <SectionHeader icon="⚙️" title={i18nT("parametres_de_publication_tiktok_ab9e3a10")} />
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.70)", fontWeight: 800 }}>{i18nT("visibilite_44e47704")}</span>
                  <select
                    value={privacyLevel}
                    onChange={(event) => {
                      clearFinalConsent();
                      setPrivacyLevel(event.target.value);
                    }}
                    style={fieldStyle}
                  >
                    <option value="">{i18nT("choisir_la_visibilite_665a3538")}</option>
                    {creatorInfo.privacyLevelOptions.map((option) => {
                      const labelKey =
                        option in privacyLabelKeys
                          ? privacyLabelKeys[option as keyof typeof privacyLabelKeys]
                          : null;
                      return <option key={option} value={option}>{labelKey ? i18nT(labelKey) : option}</option>;
                    })}
                  </select>
                </label>

                <div style={{ display: "grid", gap: 7 }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.70)", fontWeight: 800 }}>{i18nT("interactions_0b3583ec")}</span>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : mediaType === "video" ? "repeat(3, 1fr)" : "1fr", gap: isMobile ? 10 : 8 }}>
                    <label style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", borderRadius: 12, border: "1px solid rgba(148,163,184,0.22)", background: "rgba(15,23,42,0.52)", padding: isMobile ? "10px 12px" : "9px 10px", color: creatorInfo.commentDisabled ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.88)", fontSize: 13 }}>
                      <span>{i18nT("commentaires_ccbb190a")}</span>
                      <input type="checkbox" checked={allowComments} disabled={creatorInfo.commentDisabled} onChange={(event) => {
                        clearFinalConsent();
                        setAllowComments(event.target.checked);
                      }} />
                    </label>
                    {mediaType === "video" ? (
                      <>
                        <label style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", borderRadius: 12, border: "1px solid rgba(148,163,184,0.22)", background: "rgba(15,23,42,0.52)", padding: isMobile ? "10px 12px" : "9px 10px", color: creatorInfo.duetDisabled ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.88)", fontSize: 13 }}>
                          <span>{i18nT("duo_798e2216")}</span>
                          <input type="checkbox" checked={allowDuo} disabled={creatorInfo.duetDisabled} onChange={(event) => {
                            clearFinalConsent();
                            setAllowDuo(event.target.checked);
                          }} />
                        </label>
                        <label style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", borderRadius: 12, border: "1px solid rgba(148,163,184,0.22)", background: "rgba(15,23,42,0.52)", padding: isMobile ? "10px 12px" : "9px 10px", color: creatorInfo.stitchDisabled ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.88)", fontSize: 13 }}>
                          <span>{i18nT("stitch_7656945d")}</span>
                          <input type="checkbox" checked={allowStitch} disabled={creatorInfo.stitchDisabled} onChange={(event) => {
                            clearFinalConsent();
                            setAllowStitch(event.target.checked);
                          }} />
                        </label>
                      </>
                    ) : null}
                  </div>
                </div>

                <div style={helperTextStyle}>
                  {i18nT("choix_renvoyes_par_tiktok_les_options_fe3d7149")}{" "}{mediaType === "images" ? i18nT("pour_les_photos_tiktok_ne_demande_c47f7493") : ""}
                </div>
              </section>

              <section style={{ ...sectionCardStyle, display: "grid", gap: isMobile ? 12 : 10 }}>
                <SectionHeader icon="🛡️" title={i18nT("declarations_tiktok_1f4aea8c")} />
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.70)", fontWeight: 800 }}>{i18nT("contenu_commercial_593e3b1d")}</span>
                  <select
                    value={commercialContent}
                    onChange={(event) => {
                      clearFinalConsent();
                      setCommercialContent(event.target.value as TiktokCommercialContent | "");
                    }}
                    style={fieldStyle}
                  >
                    <option value="">{i18nT("choisir_une_declaration_edc3358e")}</option>
                    <option value="none">{i18nT(commercialLabelKeys.none)}</option>
                    <option value="self">{i18nT(commercialLabelKeys.self)}</option>
                    <option value="branded">{i18nT(commercialLabelKeys.branded)}</option>
                    <option value="both">{i18nT(commercialLabelKeys.both)}</option>
                  </select>
                </label>

                {commercialContent ? (
                  <div
                    style={{
                      borderRadius: 12,
                      padding: isMobile ? "10px 12px" : "8px 10px",
                      background: needsBrandedConsent ? "rgba(251,191,36,0.10)" : "rgba(76,195,255,0.07)",
                      border: needsBrandedConsent ? "1px solid rgba(251,191,36,0.22)" : "1px solid rgba(76,195,255,0.14)",
                      color: "rgba(255,255,255,0.72)",
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                  >
                    {i18nT("declaration_945c5d1d")}{" "}<strong style={{ color: "#fff" }}>{i18nT(commercialLabelKeys[commercialContent])}</strong>.
                    {needsBrandedConsent
                      ? i18nT("le_consentement_inclura_aussi_la_branded_d625eded")
                      : ""}
                  </div>
                ) : null}

                {mediaType === "images" ? (
                  <label
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      borderRadius: 12,
                      border: "1px solid rgba(148,163,184,0.22)",
                      background: "rgba(15,23,42,0.52)",
                      padding: "10px 12px",
                      color: "rgba(255,255,255,0.82)",
                      fontSize: 13,
                      lineHeight: 1.4,
                    }}
                  >
                    <input type="checkbox" checked={photoAutoMusic} onChange={(event) => {
                      clearFinalConsent();
                      setPhotoAutoMusic(event.target.checked);
                    }} style={{ marginTop: 3 }} />
                    <span>{i18nT("autoriser_tiktok_a_ajouter_une_musique_14d4bc98")}</span>
                  </label>
                ) : null}

                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,0.22)",
                    background: "rgba(15,23,42,0.52)",
                    padding: isMobile ? "10px 12px" : "10px 12px",
                    color: "rgba(255,255,255,0.88)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <strong style={{ color: "#fff", fontSize: 13 }}>{i18nT("contenu_genere_ou_modifie_par_ia_029d323a")}</strong>
                    <input type="checkbox" checked={aiContent} onChange={(event) => {
                        clearFinalConsent();
                        setAiContent(event.target.checked);
                      }} />
                  </span>
                  <span style={helperTextStyle}>
                    {i18nT("a_cocher_seulement_si_le_media_c04d6572")}{" "}</span>
                </label>
              </section>
            </div>

            <section
              style={{
                ...sectionCardStyle,
                display: "grid",
                gap: isMobile ? 10 : 8,
                background: "linear-gradient(135deg, rgba(14,165,233,0.12), rgba(30,41,59,0.70))",
                border: "1px solid rgba(56,189,248,0.22)",
                color: "rgba(255,255,255,0.82)",
                fontSize: 13,
                lineHeight: isMobile ? 1.5 : 1.35,
              }}
            >
              <SectionHeader icon="✓" title={i18nT("consentement_final_tiktok_a5ba437b")} />
              <label style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingLeft: isMobile ? 0 : 34 }}>
                <input type="checkbox" checked={musicUsageConfirmed} onChange={(event) => setMusicUsageConfirmed(event.target.checked)} style={{ marginTop: 3 }} />
                <span>
                  {i18nT("j_ai_verifie_le_compte_le_627a983d")}{" "}{" "}
                  <LegalLink href={tiktokLegalLinks.terms} label={i18nT("conditions_d_utilisation_tiktok_2f65dfa6")} />{i18nT("les_5821eaf7")}{" "}{" "}
                  <LegalLink href={tiktokLegalLinks.communityGuidelines} label={i18nT("regles_communautaires_tiktok_f47cd130")} /> {" "}{i18nT("et_la_34718812")}{" "}{" "}
                  <LegalLink href={tiktokLegalLinks.musicUsageConfirmation} label={i18nT("music_usage_confirmation_8f0792a9")} />
                  {needsBrandedConsent ? (
                    <>
                      {i18nT("ainsi_que_la_52d7ae11")}
                      <LegalLink href={tiktokLegalLinks.brandedContentPolicy} label={i18nT("branded_content_policy_tiktok_f9e8e677")} />
                    </>
                  ) : null}
                  .
                </span>
              </label>
            </section>
          </>
        ) : null}

        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "auto auto",
            justifyContent: isMobile ? "stretch" : "end",
            gap: isMobile ? 10 : 12,
            minWidth: 0,
            flexShrink: 0,
            padding: isMobile
              ? "12px 12px max(12px, var(--inrcy-safe-area-bottom))"
              : "12px 14px 14px",
            borderTop: "1px solid rgba(148,163,184,0.18)",
            background: "linear-gradient(180deg, rgba(17,24,39,0.98), rgba(15,23,42,1))",
            boxShadow: "0 -12px 28px rgba(2,6,23,0.18)",
          }}
        >
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void confirmExit()}
            style={{ width: isMobile ? "100%" : undefined, minHeight: 42 }}
          >
            {i18nT("retour_modifier_ee98859e")}{" "}</button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={!canValidate || loading}
            style={{
              width: isMobile ? "100%" : undefined,
              minHeight: 42,
              opacity: !canValidate || loading ? 0.58 : 1,
            }}
            onClick={() => {
              if (!canValidate || !commercialContent) return;
              onValidate({
                privacyLevel,
                allowComments: allowComments && !creatorInfo?.commentDisabled,
                allowDuo: mediaType === "video" ? allowDuo && !creatorInfo?.duetDisabled : false,
                allowStitch: mediaType === "video" ? allowStitch && !creatorInfo?.stitchDisabled : false,
                commercialContent,
                aiContent,
                photoAutoMusic: mediaType === "images" ? photoAutoMusic : false,
                musicUsageConfirmed,
              });
            }}
          >
            {i18nT("valider_et_publier_sur_tiktok_7324f0cf")}{" "}</button>
        </div>
      </div>
    </div>
  );
}
