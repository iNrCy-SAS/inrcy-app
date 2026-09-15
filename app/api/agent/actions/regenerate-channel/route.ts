import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  asRecord,
  buildPublishMediaAdaptation,
  buildPublishMediaReadiness,
  buildPublishPreviewTextFromPosts,
  cleanBoosterPost,
  cleanPublishChannel,
  cleanPublishMedia,
  cleanText,
  isPublishAction,
  normalizePublishChannels,
  readPublishChannelValue,
  readPublishPost,
  type PublishChannelKey,
} from "../actionPublishDraft.foundations";
import {
  commitAiCredits,
  computeBoosterAiCredits,
  isAdminUserForAi,
  reserveAiCredits,
  rollbackAiCredits,
  type AiCreditReservation,
} from "@/lib/aiUsageQuota";
import { getBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import { loadBoosterCtaDefaults } from "@/lib/boosterCtaDefaultsServer";
import { applySafePreferredCta } from "@/lib/boosterCtaPreferences";
import { generateSharedBoosterPosts } from "@/lib/boosterPublishGeneration";
import type { BoosterChannels, BoosterTheme } from "@/lib/boosterPrompt";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/lib/requireUser";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { generateInrAgentMedia } from "@/lib/inrAgentMediaGeneration";
import { loadInrAgentStudioMediaPreferences } from "@/lib/inrAgentMediaPreferencesServer";
import type { InrAgentTheme } from "@/lib/inrAgentSettings";
import { buildMediaLibraryContentUrl } from "@/lib/mediaLibraryContentUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 800;

const ACTION_SELECT =
  "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";
const REVIEWABLE_STATUSES = new Set([
  "prepared",
  "pending_validation",
  "pending",
  "draft",
  "failed",
]);
const uiChannelAliases: Record<string, PublishChannelKey> = {
  siteInrcy: "inrcy_site",
  siteWeb: "site_web",
  inrSearch: "inr_search",
  youtube: "youtube_shorts",
};
const agentThemeToBoosterTheme = {
  conseils: "conseil",
  realisations: "realisation",
  offres: "promotion",
  actualites: "actualite",
  coulisses: "realisation",
  temoignages: "avis_client",
  services: "information",
  faq: "conseil",
  recrutement: "actualite",
} satisfies Partial<Record<InrAgentTheme, BoosterTheme>>;
type RegenerationAgentTheme = keyof typeof agentThemeToBoosterTheme;
const allowedAgentThemes = new Set<RegenerationAgentTheme>(
  Object.keys(agentThemeToBoosterTheme) as RegenerationAgentTheme[],
);

function normalizeRequestedChannel(value: unknown): PublishChannelKey | null {
  const raw = cleanText(value, 80);
  return uiChannelAliases[raw] || cleanPublishChannel(raw);
}

function normalizeAgentTheme(value: unknown): RegenerationAgentTheme {
  const raw = cleanText(value, 80) as RegenerationAgentTheme;
  return allowedAgentThemes.has(raw) ? raw : "conseils";
}

function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "42703" || error?.code === "PGRST205" || message.includes("inr_agent_actions");
}

function generatedItemToAgentMedia(item: {
  id: string;
  bucket_name: string | null;
  storage_path: string;
  original_file_name?: string | null;
  media_type: "image" | "video";
  mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}) {
  return cleanPublishMedia({
    id: item.id,
    bucket: item.bucket_name || "inrcy-pro-media",
    storagePath: item.storage_path,
    url: buildMediaLibraryContentUrl(item.id) || "",
    name: item.original_file_name || item.title || `${item.media_type}-iNrAgent`,
    title: item.title || item.original_file_name || `${item.media_type} iNrAgent`,
    kind: item.media_type,
    mediaType: item.media_type,
    mimeType: item.mime_type || (item.media_type === "video" ? "video/mp4" : "image/jpeg"),
    size: item.size_bytes,
    width: item.width,
    height: item.height,
    duration: item.duration_seconds,
    source: "ai_media_generation",
  });
}

function setChannelValue(source: Record<string, unknown>, channel: PublishChannelKey, value: unknown) {
  return { ...source, [channel]: value };
}

function currentChannelsForAction(action: ReturnType<typeof rowToInrAgentAction>) {
  const payload = action.payload || {};
  const nested = asRecord(payload.publishPayload) || {};
  const values = (value: unknown) => (Array.isArray(value) ? value : []);
  return normalizePublishChannels([
    ...action.targetChannels,
    ...values(payload.selectedChannels),
    ...values(payload.targetChannels),
    ...values(payload.channels),
    ...values(payload.boosterChannels),
    ...values(nested.channels),
    ...values(nested.selectedChannels),
  ]);
}

function regeneratedIdea(args: {
  payload: Record<string, unknown>;
  actionSummary: string;
  channel: PublishChannelKey;
  currentPost: Record<string, unknown>;
}) {
  const currentTitle = cleanText(args.currentPost.title || args.currentPost.subject, 180);
  const currentContent = cleanText(
    args.currentPost.content || args.currentPost.text || args.currentPost.body || args.currentPost.caption,
    1_200,
  );
  const currentCta = cleanText(
    args.currentPost.cta || args.currentPost.callToAction,
    180,
  );
  const currentHashtags = Array.isArray(args.currentPost.hashtags)
    ? args.currentPost.hashtags
        .map((hashtag) => cleanText(hashtag, 40))
        .filter(Boolean)
        .join(" ")
    : cleanText(args.currentPost.hashtags, 280);
  return [
    cleanText(args.payload.idea || args.actionSummary, 1_500),
    `RÉGÉNÉRATION DEMANDÉE POUR LE CANAL ${args.channel}.`,
    "Crée une proposition vraiment différente, fidèle aux informations vérifiées de l'entreprise. Ne reprends pas mot pour mot la version précédente. Le titre, le texte, le CTA et les hashtags doivent former un ensemble cohérent.",
    currentTitle ? `Ancien titre à renouveler : ${currentTitle}` : "",
    currentContent ? `Ancien contenu à renouveler : ${currentContent}` : "",
    currentCta ? `Ancien CTA à renouveler si nécessaire : ${currentCta}` : "",
    currentHashtags ? `Anciens hashtags à renouveler si nécessaire : ${currentHashtags}` : "",
  ].filter(Boolean).join("\n\n");
}

async function persistAction(args: {
  actionId: string;
  accountId: string;
  payload: Record<string, unknown>;
  previewText: string;
  editType: string;
  channel: PublishChannelKey;
}) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .update({
      payload: {
        ...args.payload,
        lastManualEdit: {
          channel: args.channel,
          editedAt: now,
          editType: args.editType,
          source: "inrcy_ai_regeneration",
        },
      },
      preview_text: args.previewText,
      updated_at: now,
      last_error: null,
    })
    .eq("id", args.actionId)
    .eq("user_id", args.accountId)
    .select(ACTION_SELECT)
    .single();
  if (error) throw error;
  return rowToInrAgentAction(data);
}

export async function POST(request: Request) {
  const { supabase, authUserId, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const actionId = cleanText(body?.actionId, 160);
  const channel = normalizeRequestedChannel(body?.channel);
  const kind = cleanText(body?.kind, 20);
  if (!actionId || !channel || !["content", "media"].includes(kind)) {
    return NextResponse.json({ error: "Demande de régénération invalide." }, { status: 400 });
  }

  const rateLimit = await enforceRateLimit({
    name: `inr_agent_regenerate_${kind}`,
    identifier: authUserId || activeUserId,
    limit: kind === "media" ? 3 : 8,
    window: "1 m",
  });
  if (rateLimit) return rateLimit;

  const { data: actionRow, error: readError } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("id", actionId)
    .eq("user_id", activeUserId)
    .maybeSingle();
  if (readError || !actionRow) {
    return NextResponse.json(
      { error: "Publication iNrAgent introuvable." },
      { status: readError && isMissingTableError(readError) ? 503 : 404 },
    );
  }

  const action = rowToInrAgentAction(actionRow);
  if (!isPublishAction(action)) {
    return NextResponse.json({ error: "Cette action n’est pas une publication iNrAgent." }, { status: 400 });
  }
  if (!REVIEWABLE_STATUSES.has(action.status)) {
    return NextResponse.json(
      { error: "Cette publication est déjà validée ou programmée. Elle ne peut plus être régénérée ici." },
      { status: 409 },
    );
  }
  if (!currentChannelsForAction(action).includes(channel)) {
    return NextResponse.json({ error: "Ce canal ne fait plus partie de cette publication." }, { status: 409 });
  }

  const payload = { ...(action.payload || {}) };
  const nested = asRecord(payload.publishPayload) || {};
  const postByChannel = { ...(asRecord(payload.postByChannel) || asRecord(nested.postByChannel) || {}) };
  const currentPost = readPublishPost(postByChannel, channel);
  const theme = normalizeAgentTheme(payload.theme || action.targetThemes[0] || "conseils");
  const idea = regeneratedIdea({ payload, actionSummary: action.summary, channel, currentPost });

  if (kind === "content") {
    let reservation: AiCreditReservation | null = null;
    try {
      const quota = await reserveAiCredits({
        supabase,
        userId: activeUserId,
        action: "booster",
        credits: computeBoosterAiCredits({ mediaType: "images" }),
      });
      if (quota.errorResponse) return quota.errorResponse;
      reservation = quota.reservation;

      const [{ profile, business, recentPublications }, ctaDefaults] =
        await Promise.all([
          getBoosterGenerationContext({
            supabase: supabaseAdmin,
            userId: activeUserId,
          }),
          loadBoosterCtaDefaults({
            supabase: supabaseAdmin,
            userId: activeUserId,
          }),
        ]);
      const generated = await generateSharedBoosterPosts({
        idea,
        theme: agentThemeToBoosterTheme[theme],
        style: "equilibre",
        channels: [channel as BoosterChannels],
        profile,
        business,
        recentPublications,
        forceNonBlocking: true,
        aiFeature: "agent.publish",
        accountId: activeUserId,
        extraInstructions:
          "Régénère uniquement le contenu éditorial de ce canal : titre, texte, CTA et hashtags. Les quatre éléments doivent être cohérents entre eux, complets, publiables, non tronqués et adaptés aux limites techniques du canal. Conserve les coordonnées structurées du CTA (mode, URL et téléphone) pour que le bouton reste fonctionnel. Ne modifie ni la date, ni le média, ni les autres canaux.",
      });
      const rawPost = generated.versions[channel as BoosterChannels];
      if (!rawPost) throw new Error("Le moteur n’a pas produit de nouveau contenu.");
      const regeneratedPost = cleanBoosterPost(rawPost, action.summary);
      const editorialPost = {
        ...currentPost,
        title: regeneratedPost.title,
        subject: regeneratedPost.subject,
        content: regeneratedPost.content,
        text: regeneratedPost.text,
        body: regeneratedPost.body,
        cta: regeneratedPost.cta,
        callToAction: regeneratedPost.callToAction,
        hashtags: regeneratedPost.hashtags,
      };
      const nextContentPost = applySafePreferredCta({
        channel: channel as BoosterChannels,
        post: editorialPost,
        defaults: ctaDefaults,
        preserveExplicit: true,
      });
      const nextPostByChannel = setChannelValue(postByChannel, channel, nextContentPost);
      const nextNested = { ...nested, postByChannel: nextPostByChannel };
      const nextPayload = {
        ...payload,
        postByChannel: nextPostByChannel,
        ...(Object.keys(nested).length ? { publishPayload: nextNested } : {}),
      };
      const nextAction = await persistAction({
        actionId,
        accountId: activeUserId,
        payload: nextPayload,
        previewText: buildPublishPreviewTextFromPosts(nextPostByChannel, action.previewText),
        editType: "regenerate_publish_channel_content",
        channel,
      });
      await commitAiCredits(reservation);
      return NextResponse.json({ ok: true, regenerated: "content", channel, action: nextAction });
    } catch (error) {
      await rollbackAiCredits(reservation);
      console.error("[inr-agent] channel content regeneration failed", {
        actionId,
        channel,
        message: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Régénération du contenu impossible." },
        { status: 503 },
      );
    }
  }

  const mediaModeByChannel = { ...(asRecord(payload.mediaModeByChannel) || asRecord(nested.mediaModeByChannel) || {}) };
  const videoByChannel = { ...(asRecord(payload.videoByChannel) || asRecord(nested.videoByChannel) || {}) };
  const currentMode = cleanText(readPublishChannelValue(mediaModeByChannel, channel), 20);
  const currentVideo = cleanPublishMedia(readPublishChannelValue(videoByChannel, channel));
  const mediaKind: "image" | "video" =
    channel === "youtube_shorts" || currentMode === "video" || currentVideo?.kind === "video"
      ? "video"
      : "image";
  const expectedCount = mediaKind === "video" ? 1 : 2;

  try {
    const [isAdmin, studioPreferences] = await Promise.all([
      isAdminUserForAi(supabase, authUserId || activeUserId),
      loadInrAgentStudioMediaPreferences({ supabase: supabaseAdmin, accountId: activeUserId }),
    ]);
    const results = [];
    for (let index = 0; index < expectedCount; index += 1) {
      results.push(await generateInrAgentMedia({
        supabase: supabaseAdmin,
        accountId: activeUserId,
        actorAuthUserId: authUserId || activeUserId,
        idea: index === 0
          ? idea
          : `${idea}\n\nCrée une seconde image complémentaire : autre scène ou autre cadrage, même sujet et même identité, sans dupliquer la première.`,
        theme,
        kind: mediaKind,
        adminUnlimited: isAdmin,
        studioMediaPreferencePercent: 100,
        studioPreferences,
        variantSeed: `${actionId}:${channel}:${mediaKind}:${index}:${randomUUID()}`,
      }));
    }
    const generatedMedia = results
      .map((result) => result.item ? generatedItemToAgentMedia(result.item) : null)
      .filter((item): item is NonNullable<ReturnType<typeof cleanPublishMedia>> => Boolean(item));
    if (generatedMedia.length !== expectedCount) {
      const quotaReached = results.some((result) => result.outcome === "quota_reached");
      return NextResponse.json(
        {
          error: quotaReached
            ? "Quota média insuffisant pour régénérer ce canal. Aucun média de la publication n’a été remplacé."
            : "La nouvelle série média n’a pas pu être créée entièrement. Aucun média de la publication n’a été remplacé.",
          code: quotaReached ? "inr_agent_media_quota_reached" : "inr_agent_media_regeneration_incomplete",
          expectedCount,
          generatedCount: generatedMedia.length,
        },
        { status: quotaReached ? 429 : 503 },
      );
    }

    const imagesByChannel = { ...(asRecord(payload.imagesByChannel) || asRecord(nested.imagesByChannel) || {}) };
    const readinessByChannel = { ...(asRecord(payload.mediaReadinessByChannel) || asRecord(nested.mediaReadinessByChannel) || {}) };
    const adaptationByChannel = { ...(asRecord(payload.mediaAdaptationByChannel) || asRecord(nested.mediaAdaptationByChannel) || {}) };
    const nextMode = mediaKind === "video" ? "video" : "images";
    const nextImages = mediaKind === "image" ? generatedMedia : [];
    const nextVideo = mediaKind === "video" ? generatedMedia[0] : null;
    const effectiveMedia = generatedMedia[0];
    const nextImagesByChannel = setChannelValue(imagesByChannel, channel, nextImages);
    const nextVideoByChannel = setChannelValue(videoByChannel, channel, nextVideo);
    const nextMediaModeByChannel = setChannelValue(mediaModeByChannel, channel, nextMode);
    const nextReadiness = setChannelValue(readinessByChannel, channel, buildPublishMediaReadiness(channel, effectiveMedia));
    const nextAdaptation = setChannelValue(adaptationByChannel, channel, buildPublishMediaAdaptation(channel, effectiveMedia));
    const nextPostByChannel = setChannelValue(postByChannel, channel, {
      ...currentPost,
      media: effectiveMedia,
      mediaAsset: effectiveMedia,
      image: mediaKind === "image" ? effectiveMedia : null,
      imageAsset: mediaKind === "image" ? effectiveMedia : null,
      video: mediaKind === "video" ? effectiveMedia : null,
      videoAsset: mediaKind === "video" ? effectiveMedia : null,
    });
    const mapPatch = {
      postByChannel: nextPostByChannel,
      imagesByChannel: nextImagesByChannel,
      videoByChannel: nextVideoByChannel,
      mediaModeByChannel: nextMediaModeByChannel,
      mediaReadinessByChannel: nextReadiness,
      mediaAdaptationByChannel: nextAdaptation,
    };
    const nextPayload = {
      ...payload,
      ...mapPatch,
      ...(Object.keys(nested).length ? { publishPayload: { ...nested, ...mapPatch } } : {}),
    };
    const nextAction = await persistAction({
      actionId,
      accountId: activeUserId,
      payload: nextPayload,
      previewText: action.previewText,
      editType: "regenerate_publish_channel_media",
      channel,
    });
    return NextResponse.json({
      ok: true,
      regenerated: "media",
      mediaKind,
      mediaCount: expectedCount,
      channel,
      action: nextAction,
    });
  } catch (error) {
    console.error("[inr-agent] channel media regeneration failed", {
      actionId,
      channel,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Régénération du média impossible. Réessayez dans un instant." },
      { status: 503 },
    );
  }
}
