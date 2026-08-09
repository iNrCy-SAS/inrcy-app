import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { getAppBubbleAccessMapForUser } from "@/lib/appBubbleAccessServer";
import { isBubbleEnabled } from "@/lib/bubbleAccess";
import { ensureSystemManagedInrSearch } from "@/lib/inrSearchProvisioning";
import { buildInrSearchPublicUrl, getInrSearchPublicStatus } from "@/lib/inrSearchPublic";
import {
  isOfficialPublicationChannelConnected,
  publicationChannelRequiresReconnect,
} from "@/lib/publicationChannelAvailability";


function decodeDisplayText(value: unknown) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/\+/g, " ");
  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9a-f]{2}/i.test(text)) break;
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

function titleCaseDisplayName(value: string) {
  const text = decodeDisplayText(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (/[A-ZÀ-ÖØ-Þ]/.test(text)) return text;
  return text
    .split(" ")
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

function normalizeUrl(input: unknown) {
  const raw = decodeDisplayText(input);
  if (!raw) return null;
  const candidate = /^(https?:)?\/\//i.test(raw)
    ? raw.startsWith("//")
      ? `https:${raw}`
      : raw
    : /^www\./i.test(raw) || /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw)
      ? `https://${raw}`
      : "";
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function displayDomain(input: unknown) {
  const url = normalizeUrl(input);
  if (!url) return titleCaseDisplayName(decodeDisplayText(input));
  const host = url.hostname.replace(/^www\./i, "");
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return host;
  return `${host}/${decodeDisplayText(path)}`;
}

function firstMeaningfulPathPart(url: URL, ignored: string[] = []) {
  const ignoredSet = new Set(ignored.map((part) => part.toLowerCase()));
  const parts = url.pathname
    .split("/")
    .map((part) => decodeDisplayText(part))
    .filter(Boolean)
    .filter((part) => !ignoredSet.has(part.toLowerCase()));
  return parts[parts.length - 1] || "";
}

function looksTechnical(value: string) {
  const text = decodeDisplayText(value).trim();
  if (!text) return true;
  if (/^urn:/i.test(text)) return true;
  if (/^(accounts\/[^/]+\/)?locations\/\d+$/i.test(text)) return true;
  if (/^\d{6,}$/.test(text)) return true;
  if (/^[a-z]{1,8}_[a-z0-9_-]{18,}$/i.test(text)) return true;
  return false;
}

function cleanBusinessName(input: unknown) {
  let text = decodeDisplayText(input);
  if (!text) return "";

  const url = normalizeUrl(text);
  if (url) {
    const host = url.hostname.replace(/^www\./i, "");
    if (/google\./i.test(host)) {
      text = decodeDisplayText(
        url.searchParams.get("query") || url.searchParams.get("q") || firstMeaningfulPathPart(url),
      );
    } else if (/facebook\.com$/i.test(host)) {
      text = firstMeaningfulPathPart(url, ["pages", "profile.php", "people"]);
    } else if (/linkedin\.com$/i.test(host)) {
      text = firstMeaningfulPathPart(url, ["company", "in", "showcase", "school"]);
    } else if (/youtube\.com$/i.test(host) || /youtu\.be$/i.test(host)) {
      text = firstMeaningfulPathPart(url, ["channel", "c", "user"]);
    } else {
      return displayDomain(url.toString());
    }
  }

  text = decodeDisplayText(text)
    .replace(/^accounts\/[^/]+\/locations\//i, "")
    .replace(/^locations\//i, "")
    .replace(/^pages\//i, "")
    .replace(/^company\//i, "")
    .replace(/^in\//i, "")
    .replace(/^@+/, "")
    .trim();

  if (looksTechnical(text)) return "";
  if (/^https?:\/\//i.test(text)) return "";
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) return text.replace(/^www\./i, "");

  return titleCaseDisplayName(text);
}

function cleanSocialHandle(input: unknown) {
  let text = decodeDisplayText(input);
  if (!text) return "";
  const url = normalizeUrl(text);
  if (url) {
    const host = url.hostname.replace(/^www\./i, "");
    if (/(^|\.)tiktok\.com$/i.test(host) && !/^\/@/i.test(url.pathname)) {
      return "";
    }
    text = firstMeaningfulPathPart(url, ["@"]);
  }
  text = decodeDisplayText(text).replace(/^@+/, "").replace(/^\/+|\/+$/g, "").trim();
  if (!text || looksTechnical(text) || /\s/.test(text)) return "";
  return `@${text}`;
}

function firstCleanLabel(candidates: unknown[], fallback: string, formatter: (value: unknown) => string) {
  for (const candidate of candidates) {
    const label = formatter(candidate);
    if (label) return label;
  }
  return fallback;
}

export async function GET() {
  try {
    const { supabase, user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const [states, bubbleAccess, provisioned] = await Promise.all([
      getChannelConnectionStates(supabase, activeUserId),
      getAppBubbleAccessMapForUser(supabase, activeUserId),
      ensureSystemManagedInrSearch(supabase, activeUserId),
    ]);
    const pinterestEnabled = isBubbleEnabled(bubbleAccess, "pinterest");
    const inrSearchEnabled = isBubbleEnabled(bubbleAccess, "inr_search");
    const inrSearchStatus = inrSearchEnabled
      ? await getInrSearchPublicStatus(provisioned.inrSearch.slug)
      : null;
    const inrSearchPublished = Boolean(inrSearchStatus?.published);
    const inrSearchUrl = provisioned.inrSearch.slug
      ? buildInrSearchPublicUrl(provisioned.inrSearch.slug)
      : null;
    return NextResponse.json({
      channels: {
        inrcy_site: states.site_inrcy.connected,
        site_web: states.site_web.connected,
        inr_search: inrSearchPublished,
        gmb: isOfficialPublicationChannelConnected(states.gmb),
        facebook: isOfficialPublicationChannelConnected(states.facebook),
        instagram: isOfficialPublicationChannelConnected(states.instagram),
        linkedin: isOfficialPublicationChannelConnected(states.linkedin),
        tiktok: isOfficialPublicationChannelConnected(states.tiktok),
        youtube_shorts: isOfficialPublicationChannelConnected(states.youtube_shorts),
        pinterest: pinterestEnabled && isOfficialPublicationChannelConnected(states.pinterest),
      },
      channelDetails: {
        inrcy_site: {
          type: "url",
          label: firstCleanLabel([states.site_inrcy.url], "Site iNrCy connecté", displayDomain),
          href: states.site_inrcy.url,
        },
        site_web: {
          type: "url",
          label: firstCleanLabel([states.site_web.url], "Site web connecté", displayDomain),
          href: states.site_web.url,
        },
        inr_search: {
          type: "page",
          label: inrSearchPublished ? "Page iNr'Search publiée" : "Page iNr'Search indisponible",
          href: inrSearchPublished ? inrSearchUrl : null,
        },
        gmb: {
          type: "location",
          label: firstCleanLabel(
            [states.gmb.resource_label, states.gmb.url, states.gmb.resource_id],
            "Fiche Google connectée",
            cleanBusinessName,
          ),
          href: states.gmb.url,
          connectionStatus: states.gmb.connection_status,
          requiresReconnect: publicationChannelRequiresReconnect(states.gmb),
        },
        facebook: {
          type: "page",
          label: firstCleanLabel(
            [states.facebook.resource_label, states.facebook.page_url, states.facebook.resource_id],
            "Page Facebook connectée",
            cleanBusinessName,
          ),
          href: states.facebook.page_url,
          connectionStatus: states.facebook.connection_status,
          requiresReconnect: publicationChannelRequiresReconnect(states.facebook),
        },
        instagram: {
          type: "account",
          label: firstCleanLabel(
            [states.instagram.username, states.instagram.profile_url],
            "Compte Instagram connecté",
            cleanSocialHandle,
          ),
          href: states.instagram.profile_url,
          connectionStatus: states.instagram.connection_status,
          requiresReconnect: publicationChannelRequiresReconnect(states.instagram),
        },
        linkedin: {
          type: states.linkedin.organization_id ? "page" : "profile",
          label: firstCleanLabel(
            states.linkedin.organization_id
              ? [states.linkedin.organization_name, states.linkedin.organization_url, states.linkedin.display_name]
              : [states.linkedin.display_name, states.linkedin.profile_url, states.linkedin.organization_name],
            states.linkedin.organization_id ? "Page LinkedIn connectée" : "Compte LinkedIn connecté",
            cleanBusinessName,
          ),
          href: states.linkedin.organization_id
            ? states.linkedin.organization_url
            : states.linkedin.profile_url,
          connectionStatus: states.linkedin.connection_status,
          requiresReconnect: publicationChannelRequiresReconnect(states.linkedin),
        },
        tiktok: {
          type: "account",
          label: firstCleanLabel(
            [states.tiktok.username, states.tiktok.profile_url],
            "Compte TikTok connecté",
            cleanSocialHandle,
          ),
          href: states.tiktok.profile_url,
          connectionStatus: states.tiktok.connection_status,
          requiresReconnect: publicationChannelRequiresReconnect(states.tiktok),
        },
        youtube_shorts: {
          type: "channel",
          label: firstCleanLabel(
            [states.youtube_shorts.channel_name, states.youtube_shorts.channel_url],
            "Chaîne YouTube connectée",
            cleanBusinessName,
          ),
          href: states.youtube_shorts.channel_url,
          connectionStatus: states.youtube_shorts.connection_status,
          requiresReconnect: publicationChannelRequiresReconnect(states.youtube_shorts),
        },
        pinterest: {
          type: "account",
          label: firstCleanLabel(
            [states.pinterest.username, states.pinterest.default_board_name, states.pinterest.profile_url],
            "Compte Pinterest connecté",
            cleanBusinessName,
          ),
          href: states.pinterest.profile_url,
          connectionStatus: states.pinterest.connection_status,
          requiresReconnect: publicationChannelRequiresReconnect(states.pinterest),
        },
      },
    });
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
}
