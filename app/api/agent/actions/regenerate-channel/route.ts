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
import { INR_AGENT_IMAGES_PER_PUBLICATION } from "@/lib/inrAgentEditorialPlanning";
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

function setChannelsValue(
  source: Record<string, unknown>,
  channels: PublishChannelKey[],
  value: unknown,
) {
  const next = { ...source };
  for (const channel of channels) next[channel] = value;
  return next;
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

function regeneratedMediaIdea(args: {
  payload: Record<string, unknown>;
  actionSummary: string;
}) {
  return [
    cleanText(args.payload.idea || args.actionSummary, 1_500),
    "RÉGÉNÉRATION GLOBALE DU MÉDIA DEMANDÉE POUR TOUTE LA PUBLICATION.",
    "Crée un média vraiment différent, fidèle aux informations vérifiées de l’entreprise et utilisable comme source commune sur tous les canaux. Le texte, la date et les contenus éditoriaux existants ne doivent pas être modifiés.",
  ].filter(Boolean).join("\n\n");
}

async function persistAction(args: {
  actionId: string;
  accountId: string;
  payload: Record<string, unknown>;
  previewText: string;
  editType: string;
  channel: PublishChannelKey;
  appliedToChannels?: PublishChannelKey[];
  imageAssets?: unknown[];
}) {
  const now = new Date().toISOString();
  const updateValues: Record<string, unknown> = {
    payload: {
      ...args.payload,
      lastManualEdit: {
        channel: args.channel,
        ...(args.appliedToChannels?.length
          ? { appliedToChannels: args.appliedToChannels }
          : {}),
        editedAt: now,
        editType: args.editType,
        source: "inrcy_ai_regeneration",
      },
    },
    preview_text: args.previewText,
    updated_at: now,
    last_error: null,
    ...(Array.isArray(args.imageAssets)
      ? { image_assets: args.imageAssets }
      : {}),
  };
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .update(updateValues)
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
  const requestedScope =
    body?.scope === "publication" ? "publication" : "channel";
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
  const actionChannels = currentChannelsForAction(action);
  if (!actionChannels.includes(channel)) {
    return NextResponse.json({ error: "Ce canal ne fait plus partie de cette publication." }, { status: 409 });
  }

  const payload = { ...(action.payload || {}) };
  const nested = asRecord(payload.publishPayload) || {};
  const postByChannel = { ...(asRecord(payload.postByChannel) || asRecord(nested.postByChannel) || {}) };
  const currentPost = readPublishPost(postByChannel, channel);
  const theme = normalizeAgentTheme(payload.theme || action.targetThemes[0] || "conseils");
  const idea = regeneratedIdea({ payload, actionSummary: action.summary, channel, currentPost });

  if (kind === "content") {
    const contentTargetChannels =
      requestedScope === "publication" ? actionChannels : [channel];
    const contentIdea =
      requestedScope === "publication"
        ? [
            cleanText(payload.idea || action.summary, 1_500),
            "RÉGÉNÉRATION DU CONTENU DEMANDÉE POUR TOUS LES CANAUX DE LA PUBLICATION.",
            "Crée pour chaque canal une proposition vraiment différente de l’ancienne, adaptée à ses usages et à ses limites techniques. Le titre, le texte, le CTA et les hashtags doivent former un ensemble cohérent. Ne modifie ni la date ni le média.",
          ]
            .filter(Boolean)
            .join("\n\n")
        : idea;
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
        idea: contentIdea,
        theme: agentThemeToBoosterTheme[theme],
        style: "equilibre",
        channels: contentTargetChannels as BoosterChannels[],
        ctaDefaults,
        profile,
        business,
        recentPublications,
        forceNonBlocking: true,
        aiFeature: "agent.publish",
        accountId: activeUserId,
        extraInstructions:
          requestedScope === "publication"
            ? "Régénère le contenu éditorial de chacun des canaux demandés : titre, texte, CTA et hashtags. Chaque version doit être cohérente, complète, publiable, non tronquée et adaptée aux limites techniques de son canal. Conserve les coordonnées structurées des CTA pour que les boutons restent fonctionnels. Ne modifie ni la date ni le média."
            : "Régénère uniquement le contenu éditorial de ce canal : titre, texte, CTA et hashtags. Les quatre éléments doivent être cohérents entre eux, complets, publiables, non tronqués et adaptés aux limites techniques du canal. Conserve les coordonnées structurées du CTA (mode, URL et téléphone) pour que le bouton reste fonctionnel. Ne modifie ni la date, ni le média, ni les autres canaux.",
      });
      const nextPostByChannel = { ...postByChannel };
      for (const targetChannel of contentTargetChannels) {
        const rawPost = generated.versions[targetChannel as BoosterChannels];
        if (!rawPost) {
          throw new Error(
            "Le moteur n’a pas produit toutes les versions demandées. Aucun contenu n’a été remplacé.",
          );
        }
        const regeneratedPost = cleanBoosterPost(rawPost, action.summary);
        const targetCurrentPost = readPublishPost(
          postByChannel,
          targetChannel,
        );
        const preserveCurrentCta = Boolean(
          String(targetCurrentPost.ctaMode || "").trim(),
        );
        const editorialPost = {
          ...targetCurrentPost,
          title: regeneratedPost.title,
          subject: regeneratedPost.subject,
          content: regeneratedPost.content,
          text: regeneratedPost.text,
          body: regeneratedPost.body,
          cta: preserveCurrentCta
            ? String(targetCurrentPost.cta || "")
            : regeneratedPost.cta,
          callToAction: preserveCurrentCta
            ? String(targetCurrentPost.callToAction || "")
            : regeneratedPost.callToAction,
          hashtags: regeneratedPost.hashtags,
        };
        nextPostByChannel[targetChannel] = applySafePreferredCta({
          channel: targetChannel as BoosterChannels,
          post: editorialPost,
          defaults: ctaDefaults,
          preserveExplicit: true,
        });
      }
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
        editType:
          requestedScope === "publication"
            ? "regenerate_publish_global_content"
            : "regenerate_publish_channel_content",
        channel,
        appliedToChannels: contentTargetChannels,
      });
      await commitAiCredits(reservation);
      return NextResponse.json({
        ok: true,
        regenerated: "content",
        scope: requestedScope,
        channel,
        channels: contentTargetChannels,
        action: nextAction,
      });
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
  const currentMode = cleanText(
    readPublishChannelValue(mediaModeByChannel, channel),
    20,
  ).toLowerCase();
  const currentVideo = cleanPublishMedia(readPublishChannelValue(videoByChannel, channel));
  const globalMediaType = cleanText(
    payload.mediaType || nested.mediaType,
    20,
  ).toLowerCase();
  const globalMedia = cleanPublishMedia(
    payload.video ||
      payload.videoAsset ||
      payload.media ||
      payload.mediaAsset ||
      nested.video ||
      nested.videoAsset ||
      nested.media ||
      nested.mediaAsset,
  );
  const hasVideoMode = actionChannels.some(
    (targetChannel) =>
      cleanText(
        readPublishChannelValue(mediaModeByChannel, targetChannel),
        20,
      ).toLowerCase() === "video",
  );
  const hasChannelVideo = actionChannels.some(
    (targetChannel) =>
      cleanPublishMedia(readPublishChannelValue(videoByChannel, targetChannel))?.kind === "video",
  );
  const mediaKind: "image" | "video" =
    actionChannels.includes("youtube_shorts") ||
    currentMode === "video" ||
    currentVideo?.kind === "video" ||
    globalMediaType === "video" ||
    globalMedia?.kind === "video" ||
    hasVideoMode ||
    hasChannelVideo
      ? "video"
      : "image";
  const expectedCount =
    mediaKind === "image" ? INR_AGENT_IMAGES_PER_PUBLICATION : 1;
  const mediaIdea = regeneratedMediaIdea({
    payload,
    actionSummary: action.summary,
  });

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
        idea: mediaIdea,
        theme,
        kind: mediaKind,
        adminUnlimited: isAdmin,
        studioMediaPreferencePercent: 100,
        studioPreferences,
        variantSeed: `${actionId}:global:${mediaKind}:${index}:${randomUUID()}`,
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
            ? "Quota média insuffisant pour régénérer cette publication. Aucun média n’a été remplacé."
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
    const nextImagesByChannel = setChannelsValue(imagesByChannel, actionChannels, nextImages);
    const nextVideoByChannel = setChannelsValue(videoByChannel, actionChannels, nextVideo);
    const nextMediaModeByChannel = setChannelsValue(mediaModeByChannel, actionChannels, nextMode);
    const nextReadiness = { ...readinessByChannel };
    const nextAdaptation = { ...adaptationByChannel };
    const nextPostByChannel = { ...postByChannel };
    for (const targetChannel of actionChannels) {
      nextReadiness[targetChannel] = buildPublishMediaReadiness(
        targetChannel,
        effectiveMedia,
      );
      nextAdaptation[targetChannel] = buildPublishMediaAdaptation(
        targetChannel,
        effectiveMedia,
      );
      const targetPost = readPublishPost(postByChannel, targetChannel);
      nextPostByChannel[targetChannel] = {
        ...targetPost,
        media: effectiveMedia,
        mediaAsset: effectiveMedia,
        mediaMode: nextMode,
        image: mediaKind === "image" ? effectiveMedia : null,
        imageAsset: mediaKind === "image" ? effectiveMedia : null,
        imageUrl: mediaKind === "image" ? effectiveMedia.url : "",
        video: mediaKind === "video" ? effectiveMedia : null,
        videoAsset: mediaKind === "video" ? effectiveMedia : null,
      };
    }
    const globalMediaPatch = {
      media: effectiveMedia,
      mediaAsset: effectiveMedia,
      mediaAssets: generatedMedia,
      mediaType: mediaKind,
      image: mediaKind === "image" ? effectiveMedia : null,
      imageAsset: mediaKind === "image" ? effectiveMedia : null,
      images: nextImages,
      video: mediaKind === "video" ? effectiveMedia : null,
      videoAsset: mediaKind === "video" ? effectiveMedia : null,
      image_assets: generatedMedia,
    };
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
      ...globalMediaPatch,
      ...mapPatch,
      ...(Object.keys(nested).length
        ? {
            publishPayload: {
              ...nested,
              ...globalMediaPatch,
              ...mapPatch,
            },
          }
        : {}),
    };
    const nextAction = await persistAction({
      actionId,
      accountId: activeUserId,
      payload: nextPayload,
      previewText: action.previewText,
      editType: "regenerate_publish_global_media",
      channel,
      appliedToChannels: actionChannels,
      imageAssets: generatedMedia,
    });
    return NextResponse.json({
      ok: true,
      regenerated: "media",
      scope: "publication",
      mediaKind,
      mediaCount: expectedCount,
      channel,
      channels: actionChannels,
      action: nextAction,
    });
  } catch (error) {
    console.error("[inr-agent] global media regeneration failed", {
      actionId,
      channels: actionChannels,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Régénération du média impossible. Réessayez dans un instant." },
      { status: 503 },
    );
  }
}
