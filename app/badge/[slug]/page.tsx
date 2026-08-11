/* eslint-disable @next/next/no-img-element */
import { headers } from "next/headers";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractInrBadgeUserIdFromSlug } from "@/lib/inrBadge";
import { getProfileLogoVersion } from "@/lib/profileLogo";
import { normalizeInrBadgeShareSettings } from "@/lib/inrBadgeSettings";
import { getInrBadgeTexts, normalizeInrBadgeLanguage } from "@/lib/inrBadgeLanguage";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { getInrSearchPublicStatus } from "@/lib/inrSearchPublic";
import { fetchPinterestUserAccount, getPinterestAccessToken } from "@/lib/pinterestOAuth";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import {
  canUseInrBadgeAppointments,
  effectiveInrBadgeShareSettings,
  resolveInrBadgePublicEmail,
} from "@/lib/inrBadgeEditionPolicy";
import inrBadgeIcon from "@/public/icons/inrbadge-dashboard.png";
import inrcyIcon from "@/public/icons/inrcy.png";
import inrSearchIcon from "@/public/icons/inr-search-logo.png";
import siteWebIcon from "@/public/icons/site-web.jpg";
import googleBusinessIcon from "@/public/icons/google.jpg";
import linkedinIcon from "@/public/icons/linkedin.png";
import pinterestIcon from "@/public/icons/pinterest-logo-128.png";
import instagramIcon from "@/public/icons/instagram.jpg";
import facebookIcon from "@/public/icons/facebook.png";
import tiktokIcon from "@/public/icons/tiktok.png";
import youtubeShortsIcon from "@/public/icons/youtube-shorts.png";
import inrCalendarLogo from "@/public/inrcalendar-logo.png";

import styles from "./badge.module.css";
import BadgeShareButton from "./BadgeShareButton";
import BadgeLeadButton from "./BadgeLeadButton";
import BadgeAnalyticsClient from "./BadgeAnalyticsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const DEFAULT_INRBADGE_LOGO_SRC = inrBadgeIcon.src;

function getBadgeManifestUrl(slug: string) {
  return `/badge/${encodeURIComponent(slug)}/manifest.webmanifest`;
}

function getBadgeIconUrl(slug: string, version = "") {
  const baseUrl = `/badge/${encodeURIComponent(slug)}/icon.png`;
  return version ? `${baseUrl}?v=${encodeURIComponent(version)}` : baseUrl;
}

function trim(value: unknown) {
  return String(value || "").trim();
}

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeUrl(value: unknown) {
  const raw = trim(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function phoneHref(value: string) {
  const cleaned = value.replace(/[^+0-9]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

function createMailto(email: string, subject?: string) {
  const clean = trim(email);
  if (!clean) return "";
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return `mailto:${clean}${query}`;
}

function escapeVCard(value: string) {
  return trim(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function createVCardDataUri(input: {
  firstName: string;
  lastName: string;
  displayName: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  city: string;
  zip: string;
  country: string;
}) {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(input.lastName)};${escapeVCard(input.firstName)};;;`,
    `FN:${escapeVCard(input.displayName || input.company)}`,
    input.company ? `ORG:${escapeVCard(input.company)}` : "",
    input.phone ? `TEL;TYPE=WORK,VOICE:${escapeVCard(input.phone)}` : "",
    input.email ? `EMAIL;TYPE=WORK:${escapeVCard(input.email)}` : "",
    input.website ? `URL:${escapeVCard(input.website)}` : "",
    input.address || input.city || input.zip || input.country
      ? `ADR;TYPE=WORK:;;${escapeVCard(input.address)};${escapeVCard(input.city)};;${escapeVCard(input.zip)};${escapeVCard(input.country)}`
      : "",
    "END:VCARD",
  ].filter(Boolean);
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(lines.join("\n"))}`;
}

function safeFilename(value: string) {
  return trim(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "contact";
}

async function getBadgeBaseUrl() {
  const explicitBase = String(process.env.NEXT_PUBLIC_INRBADGE_BASE_URL || "").trim();
  if (explicitBase) return explicitBase.replace(/\/+$/, "");

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host") || "";
  const proto = headerStore.get("x-forwarded-proto") || (host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https");
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");

  return String(
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://app.inrcy.com"
  ).replace(/\/+$/, "");
}

type ActionTone = "phone" | "mail" | "contact" | "site" | "google" | "linkedin" | "instagram" | "facebook" | "tiktok" | "youtube" | "neutral" | "inrsearch" | "appointment";

type ActionLinkProps = {
  href: string;
  label: string;
  detail?: string;
  download?: string;
  icon?: string;
  iconSrc?: string;
  tone?: ActionTone;
  compact?: boolean;
  iconOnly?: boolean;
  trackingAction?: string;
  trackingTarget?: string;
};

function FutureActionGlyph({ tone }: { tone: ActionTone }) {
  const stroke = tone === "phone" ? "#ff78d2" : tone === "mail" ? "#75bcff" : "#5cf0c9";

  if (tone === "phone") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path d="M21 12c1.7 0 3.2 1 4 2.6l3.1 6.8c.7 1.5.3 3.3-.9 4.4l-3.5 3.1c4.5 7.3 10.8 13.2 18.2 17.3l3-3.5c1.1-1.2 2.9-1.6 4.4-1l7 3c1.7.8 2.8 2.4 2.8 4.2v6c0 2.3-1.8 4.1-4.1 4.1h-1.5C29.5 59 5 34.5 5 5.4V3.9C5 1.6 6.8-.2 9.1-.2h11.9Z" fill="none" stroke={stroke} strokeWidth="4.25" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  if (tone === "mail") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect x="10" y="16" width="44" height="32" rx="9" fill="none" stroke={stroke} strokeWidth="4"/>
        <path d="m14 22 18 15 18-15" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="m15 43 12-12M49 43 37 31" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round"/>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="29" cy="20" r="9" fill="none" stroke={stroke} strokeWidth="4"/>
      <path d="M14 47c0-8.3 6.7-15 15-15s15 6.7 15 15" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round"/>
      <path d="M49 25v18M40 34h18" fill="none" stroke={stroke} strokeWidth="4.25" strokeLinecap="round"/>
    </svg>
  );
}

function ActionLink({ href, label, detail, download, icon, iconSrc, tone = "neutral", compact = false, iconOnly = false, trackingAction, trackingTarget }: ActionLinkProps) {
  const isFeaturedPrimary = compact && (tone === "phone" || tone === "mail" || tone === "contact");
  const className = [
    styles.action,
    iconOnly ? styles.actionIconOnly : compact ? styles.actionCompact : styles.actionWide,
    styles[`tone_${tone}`],
    detail && !iconOnly ? styles.actionWithDetail : styles.actionWithoutDetail,
    isFeaturedPrimary ? styles.featuredPrimaryAction : "",
  ].filter(Boolean).join(" ");

  const iconClassName = [
    styles.actionIcon,
    isFeaturedPrimary ? styles.featuredPrimaryIcon : "",
  ].filter(Boolean).join(" ");

  return (
    <a
      className={className}
      href={href}
      target={download ? undefined : href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
      download={download}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      data-inrbadge-action={trackingAction}
      data-inrbadge-target={trackingTarget || href}
    >
      <span className={iconClassName} aria-hidden="true">
        {iconSrc ? (
          <img className={styles.iconImage} src={iconSrc} alt="" width={28} height={28} loading="eager" decoding="async" fetchPriority={tone === "appointment" ? "high" : undefined} />
        ) : isFeaturedPrimary ? (
          <FutureActionGlyph tone={tone} />
        ) : (
          <span>{icon}</span>
        )}
      </span>
      {iconOnly ? (
        <span className={styles.srOnly}>{label}</span>
      ) : (
        <span className={styles.actionBody}>
          {compact ? (
            <span className={styles.compactLabelRow}>
              <strong>{label}</strong>
              <span className={styles.arrowInline}>›</span>
            </span>
          ) : (
            <strong>{label}</strong>
          )}
          {detail ? <small>{detail}</small> : null}
        </span>
      )}
      {!compact && !iconOnly ? <span className={styles.arrow}>›</span> : null}
    </a>
  );
}

function getBalancedChannelRows(actions: ActionLinkProps[]) {
  const rowCount = Math.max(1, Math.ceil(actions.length / 4));
  const baseSize = Math.floor(actions.length / rowCount);
  const remainder = actions.length % rowCount;
  const rowSizes = Array.from(
    { length: rowCount },
    (_, index) => baseSize + (index < remainder ? 1 : 0),
  );

  let cursor = 0;
  return rowSizes
    .map((size) => {
      const row = actions.slice(cursor, cursor + size);
      cursor += size;
      return row;
    })
    .filter((row) => row.length > 0);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> | { slug: string } }): Promise<Metadata> {
  const resolvedParams = await params;
  const slug = trim(resolvedParams.slug);
  const iconUrl = getBadgeIconUrl(slug);
  return {
    title: "iNr'Badge",
    manifest: getBadgeManifestUrl(slug),
    icons: {
      icon: iconUrl,
      shortcut: iconUrl,
      apple: iconUrl,
    },
  };
}

export default async function BadgePage({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const resolvedParams = await params;
  const slug = trim(resolvedParams.slug);
  const userId = extractInrBadgeUserIdFromSlug(slug);
  if (!userId) notFound();

  const [profileRes, businessRes, badgeLanguageRes, toolsRes, siteInrcyRes, integrationsRes, dashboardEdition] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("user_id,inrcy_site_ownership,logo_url,logo_path,company_legal_name,first_name,last_name,phone,contact_email,hq_address,hq_zip,hq_city,hq_country")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_profiles")
      .select("business_description")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("business_profiles")
      .select("client_language,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("pro_tools_configs")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("inrcy_site_configs")
      .select("site_url,settings")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("integrations")
      .select("provider,source,product,category,account_email,settings,status,resource_id,resource_label,display_name,email_address,expires_at,access_token_enc,refresh_token_enc,meta,updated_at,created_at")
      .eq("user_id", userId),
    getDashboardEditionForAccountId(userId),
  ]);

  if (profileRes.error || !profileRes.data) notFound();

  const profile = profileRes.data as Record<string, unknown>;
  const business = (businessRes.data ?? {}) as Record<string, unknown>;
  const badgeLanguageRow = (badgeLanguageRes.data ?? {}) as Record<string, unknown>;
  const toolSettings = safeObj((toolsRes.data as { settings?: unknown } | null)?.settings);
  const storedShareSettings = normalizeInrBadgeShareSettings(toolSettings.inrBadgeShareSettings);
  const shareSettings = effectiveInrBadgeShareSettings(storedShareSettings, dashboardEdition);
  // La langue publique du badge vient des Préférences générales.
  // Elle est lue dans une requête séparée pour éviter qu'un souci sur les champs métier
  // ne fasse retomber l'écran principal du badge sur l'ancien réglage inrBadgeLanguage.
  const badgeLanguage = normalizeInrBadgeLanguage(badgeLanguageRow.client_language || toolSettings.inrBadgeLanguage);
  const badgeText = getInrBadgeTexts(badgeLanguage);
  const channelStates = await getChannelConnectionStates(supabaseAdmin, userId, {
    profile,
    inrcySiteConfig: siteInrcyRes.data,
    proToolsConfig: toolsRes.data,
    integrations: Array.isArray(integrationsRes.data) ? integrationsRes.data : [],
  });

  const firstName = trim(profile.first_name);
  const lastName = trim(profile.last_name);
  const displayName = [firstName, lastName].filter(Boolean).join(" ");
  const company = trim(profile.company_legal_name) || "Entreprise iNrCy";
  const phone = trim(profile.phone);
  const email = trim(profile.contact_email);
  const address = trim(profile.hq_address);
  const zip = trim(profile.hq_zip);
  const city = trim(profile.hq_city);
  const country = trim(profile.hq_country) || "France";
  const description = trim(business.business_description);

  const siteWebSettings = safeObj(toolSettings.site_web);
  const gmbSettings = safeObj(toolSettings.gmb);
  const facebookSettings = safeObj(toolSettings.facebook);
  const instagramSettings = safeObj(toolSettings.instagram);
  const linkedinSettings = safeObj(toolSettings.linkedin);
  const pinterestSettings = safeObj(toolSettings.pinterest);
  const tiktokSettings = safeObj(toolSettings.tiktok);
  const youtubeShortsSettings = safeObj(toolSettings.youtube_shorts);
  const inrSearchSettings = safeObj(toolSettings.inrSearch);

  const siteInrcyUrl = normalizeUrl(channelStates.site_inrcy.url || (siteInrcyRes.data as { site_url?: string | null } | null)?.site_url);
  const siteWebUrl = normalizeUrl(channelStates.site_web.url || siteWebSettings.url);
  const gmbUrl = normalizeUrl(channelStates.gmb.url || gmbSettings.url);
  const facebookUrl = normalizeUrl(channelStates.facebook.page_url || facebookSettings.url);
  const instagramUsername = trim(
    instagramSettings.username ||
    instagramSettings.resource_label ||
    instagramSettings.resourceLabel ||
    instagramSettings.handle,
  ).replace(/^@+/, "");
  const instagramUrl = normalizeUrl(
    channelStates.instagram.profile_url ||
    instagramSettings.url ||
    instagramSettings.profile_url ||
    instagramSettings.profileUrl ||
    instagramSettings.profile ||
    (instagramUsername ? `https://www.instagram.com/${instagramUsername}/` : ""),
  );
  const linkedinUrl = normalizeUrl(channelStates.linkedin.organization_url || channelStates.linkedin.profile_url || linkedinSettings.orgUrl || linkedinSettings.profileUrl || linkedinSettings.url);
  let pinterestUrl = normalizeUrl(channelStates.pinterest.profile_url || pinterestSettings.publicProfileUrl || pinterestSettings.profileUrl || pinterestSettings.url);
  if (shareSettings.pinterest && channelStates.pinterest.connected && !pinterestUrl) {
    const pinterestAccessToken = await getPinterestAccessToken(userId).catch(() => "");
    if (pinterestAccessToken) {
      const pinterestAccount = await fetchPinterestUserAccount(pinterestAccessToken).catch(() => null);
      pinterestUrl = normalizeUrl(pinterestAccount?.profileUrl);
    }
  }
  const tiktokUrl = normalizeUrl(channelStates.tiktok.profile_url || tiktokSettings.url);
  const youtubeShortsUrl = normalizeUrl(channelStates.youtube_shorts.channel_url || youtubeShortsSettings.channelUrl || youtubeShortsSettings.url);
  const inrSearchSlug = trim(inrSearchSettings.slug);
  const inrSearchStatus = shareSettings.inrSearch && inrSearchSlug
    ? await getInrSearchPublicStatus(inrSearchSlug).catch(() => null)
    : null;
  const inrSearchUrl = inrSearchStatus?.published ? inrSearchStatus.publicUrl : "";
  const inrSearchNewsUrl = inrSearchUrl ? `${inrSearchUrl}#actualites` : "";
  const primaryWebsite = siteWebUrl || siteInrcyUrl;

  const publicChannelCanShare = {
    inrSearch: Boolean(inrSearchUrl),
    siteInrcy: Boolean(channelStates.site_inrcy.connected && siteInrcyUrl),
    siteWeb: Boolean(channelStates.site_web.connected && siteWebUrl),
    googleBusiness: Boolean(channelStates.gmb.connected && gmbUrl),
    facebook: Boolean(channelStates.facebook.connected && facebookUrl),
    instagram: Boolean(channelStates.instagram.connected && instagramUrl),
    linkedin: Boolean(channelStates.linkedin.connected && linkedinUrl),
    pinterest: Boolean(channelStates.pinterest.connected && pinterestUrl),
    tiktok: Boolean(channelStates.tiktok.connected && tiktokUrl),
    youtubeShorts: Boolean(channelStates.youtube_shorts.connected && youtubeShortsUrl),
  };
  const selectedMailAccountId = trim(toolSettings.inrBadgeMailAccountId);
  let selectedMailAccountEmail = "";

  if (dashboardEdition !== "standard" && selectedMailAccountId) {
    const selectedMailRes = await supabaseAdmin
      .from("integrations")
      .select("account_email,status,settings")
      .eq("user_id", userId)
      .eq("id", selectedMailAccountId)
      .eq("category", "mail")
      .maybeSingle();
    const selectedMailRow = (selectedMailRes.data ?? {}) as Record<string, unknown>;
    if (trim(selectedMailRow.status).toLowerCase() === "connected") {
      selectedMailAccountEmail = trim(selectedMailRow.account_email);
    }
  }

  const badgeEmail = resolveInrBadgePublicEmail({
    edition: dashboardEdition,
    profileEmail: email,
    selectedMailAccountEmail,
  });

  const publicUrl = `${await getBadgeBaseUrl()}/badge/${slug}`;

  const vCardUri = createVCardDataUri({
    firstName,
    lastName,
    displayName,
    company,
    phone: shareSettings.phone ? phone : "",
    email: shareSettings.email ? badgeEmail : "",
    website: primaryWebsite,
    address,
    city,
    zip,
    country,
  });
  const vCardFilename = `${safeFilename(company || displayName)}.vcf`;

  const primaryActions = [
    shareSettings.phone && phone && phoneHref(phone) ? { href: phoneHref(phone), label: badgeText.call, iconSrc: "/icons/inrbadge-action-tel.png", tone: "phone" as ActionTone, trackingAction: "phone" } : null,
    shareSettings.email && badgeEmail ? { href: createMailto(badgeEmail), label: badgeText.mail, iconSrc: "/icons/inrbadge-action-mail.png", tone: "mail" as ActionTone, trackingAction: "mail" } : null,
    shareSettings.saveContact ? { href: vCardUri, label: badgeText.saveContact, download: vCardFilename, iconSrc: "/icons/inrbadge-action-save.png", tone: "contact" as ActionTone, trackingAction: "save_contact" } : null,
  ].filter(Boolean) as ActionLinkProps[];

  const channelActions = [
    shareSettings.inrSearch && publicChannelCanShare.inrSearch ? { href: inrSearchUrl, label: "iNr'Search", iconSrc: inrSearchIcon.src, tone: "inrsearch" as ActionTone, trackingAction: "inr_search" } : null,
    shareSettings.siteInrcy && publicChannelCanShare.siteInrcy ? { href: siteInrcyUrl, label: "Site iNrCy", iconSrc: inrcyIcon.src, tone: "site" as ActionTone, trackingAction: "site_inrcy" } : null,
    shareSettings.siteWeb && publicChannelCanShare.siteWeb ? { href: siteWebUrl, label: "Site web", iconSrc: siteWebIcon.src, tone: "site" as ActionTone, trackingAction: "site_web" } : null,
    shareSettings.googleBusiness && publicChannelCanShare.googleBusiness ? { href: gmbUrl, label: "Google Business", iconSrc: googleBusinessIcon.src, tone: "google" as ActionTone, trackingAction: "google_business" } : null,
    shareSettings.linkedin && publicChannelCanShare.linkedin ? { href: linkedinUrl, label: "LinkedIn", iconSrc: linkedinIcon.src, tone: "linkedin" as ActionTone, trackingAction: "linkedin" } : null,
    shareSettings.pinterest && publicChannelCanShare.pinterest ? { href: pinterestUrl, label: "Pinterest", iconSrc: pinterestIcon.src, tone: "neutral" as ActionTone, trackingAction: "pinterest" } : null,
    shareSettings.instagram && publicChannelCanShare.instagram ? { href: instagramUrl, label: "Instagram", iconSrc: instagramIcon.src, tone: "instagram" as ActionTone, trackingAction: "instagram" } : null,
    shareSettings.facebook && publicChannelCanShare.facebook ? { href: facebookUrl, label: "Facebook", iconSrc: facebookIcon.src, tone: "facebook" as ActionTone, trackingAction: "facebook" } : null,
    shareSettings.tiktok && publicChannelCanShare.tiktok ? { href: tiktokUrl, label: "TikTok", iconSrc: tiktokIcon.src, tone: "tiktok" as ActionTone, trackingAction: "tiktok" } : null,
    shareSettings.youtubeShorts && publicChannelCanShare.youtubeShorts ? { href: youtubeShortsUrl, label: "YouTube", iconSrc: youtubeShortsIcon.src, tone: "youtube" as ActionTone, trackingAction: "youtube_shorts" } : null,
  ].filter(Boolean) as ActionLinkProps[];

  const inrSearchNewsAction = shareSettings.inrSearch && inrSearchNewsUrl
    ? { href: inrSearchNewsUrl, label: "Voir nos actualités", iconSrc: inrSearchIcon.src, tone: "inrsearch" as ActionTone, trackingAction: "inr_search_news" }
    : null;

  const appointmentAction = canUseInrBadgeAppointments(dashboardEdition, shareSettings)
    ? { href: `/badge/${slug}/rdv`, label: badgeText.appointment, iconSrc: inrCalendarLogo.src, tone: "appointment" as ActionTone, trackingAction: "appointment" }
    : null;

  const channelRows = getBalancedChannelRows(channelActions);

  const headerInfoLine = [
    shareSettings.company ? company : "",
    shareSettings.name ? displayName : "",
  ].filter(Boolean).join(" / ");
  const hasCustomLogo = Boolean(trim(profile.logo_path) || trim(profile.logo_url));
  const logoVersion = getProfileLogoVersion(trim(profile.logo_url));
  const headerLogoSrc = hasCustomLogo ? getBadgeIconUrl(slug, logoVersion) : DEFAULT_INRBADGE_LOGO_SRC;
  const iconPreloads = Array.from(new Set([
    headerLogoSrc,
    ...(inrSearchNewsAction ? [inrSearchIcon.src] : []),
    ...(appointmentAction ? [inrCalendarLogo.src] : []),
    ...primaryActions.map((action) => action.iconSrc).filter((src): src is string => Boolean(src)),
    ...channelActions.map((action) => action.iconSrc).filter((src): src is string => Boolean(src)),
  ]));

  return (
    <main className={styles.page}>
      <BadgeAnalyticsClient slug={slug} />
      {iconPreloads.map((src) => <link key={src} rel="preload" as="image" href={src} />)}
      <section className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.cardGlowA} />
          <div className={styles.cardGlowB} />

          <div className={styles.headerRow}>
            <div className={styles.headerTopBar}>
              <BadgeShareButton publicUrl={publicUrl} company={company} language={badgeLanguage} />
              <div className={styles.headerIdentity}>
                <div className={styles.logo} aria-hidden="true">
                  {shareSettings.logo ? (
                    <img src={headerLogoSrc} alt="" loading="eager" decoding="sync" fetchPriority="high" />
                  ) : <span>iNr</span>}
                </div>
              </div>
            </div>

            {headerInfoLine ? <p className={styles.headerInfoLine}>{headerInfoLine}</p> : null}
          </div>

          {description ? <p className={styles.description}>{description}</p> : null}

          {primaryActions.length > 0 ? (
            <div className={styles.primaryGrid} data-count={primaryActions.length}>
              {primaryActions.map((action) => (
                <ActionLink key={`${action.label}-${action.href}`} {...action} compact />
              ))}
            </div>
          ) : null}

          <BadgeLeadButton slug={slug} language={badgeLanguage} />

          {channelActions.length > 0 ? (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionMark} />
                <h2>{badgeText.findUs}</h2>
              </div>
              <div className={styles.channelsGrid} data-count={channelActions.length}>
                {channelRows.map((row, rowIndex) => (
                  <div className={styles.channelsRow} key={`channel-row-${rowIndex}`}>
                    {row.map((action) => (
                      <ActionLink key={`${action.label}-${action.href}`} {...action} iconOnly />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {inrSearchNewsAction ? (
            <div className={styles.ctaWrap}>
              <ActionLink {...inrSearchNewsAction} />
            </div>
          ) : null}

          {appointmentAction ? (
            <div className={styles.ctaWrap}>
              <ActionLink {...appointmentAction} />
            </div>
          ) : null}

        </div>

        <div className={styles.footer}>
          <span>iNr&apos;Badge</span>
          <span className={styles.footerDot}>·</span>
          <span>{badgeText.poweredBy} <strong>iNrCy</strong></span>
        </div>
      </section>
    </main>
  );
}
