import { normalizeThreadsPublicationPreferences } from "@/lib/threadsPublicationPreferences";
import { MEDIA_FIRST_PUBLICATION_IDEA, type AiMediaSubjectSource } from "@/lib/aiMediaSubject";
import { isMetaChannelPilotEnabledForAccount, isMetaChannelPilotEnabledForActorAndAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { NextResponse } from "next/server";
import { resolveInrAgentActionRequest } from "@/lib/inrAgentRequest";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { enforceRateLimit } from "@/lib/rateLimit";
import { commitAiCredits, computeBoosterAiCredits, reserveAiCredits, reserveInrAgentEditorialCredits, rollbackAiCredits, isAdminUserForAi, type AiCreditReservation } from "@/lib/aiUsageQuota";
import { type BoosterChannels } from "@/lib/boosterPrompt";
import { getBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import { INR_AGENT_VIDEO_AI_PREPARATION_VERSION } from "@/lib/inrAgentVideoPreparation";
import { isValidJobForSector } from "@/lib/activityCatalog";
import { normalizeInrAgentPublicationMediaTypes, type InrAgentTheme } from "@/lib/inrAgentSettings";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { videoAiContextReferenceAliases } from "@/lib/videoAiContextReference";
import { generateInrAgentMedia } from "@/lib/inrAgentMediaGeneration";
import { getAiMediaGenerationPublicError } from "@/lib/aiMediaGenerationPublicErrors";
import { getAiMediaQuotaSnapshot } from "@/lib/aiMediaGenerationQuota";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { inrAgentManualCreditAvailability, inrAgentManualPublishCreditBudget } from "@/lib/inrAgentManualCreditPolicy";
import { buildInrAgentMediaFormatPlan, bindInrAgentMediaFormatVariants, type InrAgentMediaFormatPlan } from "@/lib/inrAgentMediaFormats";
import { loadInrAgentStudioMediaPreferences } from "@/lib/inrAgentMediaPreferencesServer";
import { blocksInrAgentReferenceFallback } from "@/lib/inrAgentMediaReferences";
import { normalizeAiMediaGeneratorPreferences } from "@/lib/aiMediaGenerationPreferences";
import { applySafePreferredCta } from "@/lib/boosterCtaPreferences";
import { loadBoosterCtaDefaults } from "@/lib/boosterCtaDefaultsServer";
import { releaseInrAgentPublicationIdea } from "@/lib/inrAgentPublicationIdeaLifecycle";
import { loadInstantMediaMixState } from "@/lib/inrAgentInstantMediaState";
import { createHash, randomUUID } from "node:crypto";
import { inrAgentChannelToBoosterPublishChannel } from "@/lib/inrAgentPublishChannels";
import { type EditorialPreparationTarget, type ImageBankAsset, type InrAgentPublicationPreparationContext } from "@/lib/inrAgentPublicationPreparationTypes";
import { boosterToAgentChannel, themeLabels, channelMediaReadiness, asRecord, getExecutionPolicy, getInitialStatus, requiresManualValidation, hasUsefulContent, buildPreviewText, buildSummary, channelMediaAdaptation } from "@/lib/inrAgentPublicationPreparationPolicy";
import { loadEditorialPreparationTarget, selectConnectedChannels, loadPublishAutomationSettings, loadInrAgentTone, loadEarlierEditorialAngles, resolveMediaGenerationActorAuthUserId } from "@/lib/inrAgentPublicationPreparationRepository";
import { generatedPickerItemToAgentMedia, IMAGE_BANK_DIVERSIFICATION_RATE, isRecentlyUsedMediaRow, getRecentMediaTrace, selectInrAgentPublicationMedia } from "@/lib/inrAgentPublicationMediaSelection";
import { prepareInrAgentSelectedMediaAnalysis } from "@/lib/inrAgentPublicationMediaAnalysis";
import { generateBoosterPosts, prepareInrAgentEditorialIdea } from "@/lib/inrAgentPublicationEditorialService";

export const maxDuration = 800;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const routeStartedAt = Date.now();
  let mediaSelectionMs = 0;
  let imagePreparationMs = 0;
  let videoPreparationMs = 0;
  let aiGenerationMs = 0;
  let persistenceMs = 0;
  let generationContextMs = 0;
  let professionalContextSource:
    | "hit"
    | "database"
    | "disabled"
    | "not_loaded" = "not_loaded";
  let publicationsContextSource:
    | "hit"
    | "database"
    | "disabled"
    | "not_loaded" = "not_loaded";
  const context = await resolveInrAgentActionRequest(request);
  if (context.errorResponse) return context.errorResponse;

  const { supabase, userId, authUserId, isCron, body } = context;
  let editorialTarget: EditorialPreparationTarget | null = null;
  try {
    editorialTarget = await loadEditorialPreparationTarget({
      userId,
      isCron,
      body,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          "Le créneau éditorial à préparer est invalide ou n’est plus disponible.",
        code:
          error instanceof Error ? error.message : "editorial_target_invalid",
      },
      { status: 409 }
    );
  }
  const actorUserId = await resolveMediaGenerationActorAuthUserId({
    accountId: userId,
    requestAuthUserId: authUserId,
    isCron,
  });
  const preparationContext: InrAgentPublicationPreparationContext = Object.freeze({ accountId: userId, actorAuthUserId: actorUserId, isCron });
  const quotaAccountId = userId;
  const isAdmin = await isAdminUserForAi(supabase, actorUserId);

  if (!isAdmin) {
    const rl = await enforceRateLimit({
      name: "inr_agent_prepare_publish",
      identifier: actorUserId,
      limit: 4,
      window: "1 m",
    });
    if (rl) return rl;
  }

  const [automation, storedAgentTone] = await Promise.all([
    loadPublishAutomationSettings(userId),
    loadInrAgentTone(userId),
  ]);
  if (!automation.enabled) {
    return NextResponse.json(
      { error: "L’automatisation Publier est désactivée." },
      { status: 400 }
    );
  }

  const generationContextStartedAt = Date.now();
  const generationContextPromise = getBoosterGenerationContext({
    supabase,
    userId,
  }).then((generationContext) => {
    generationContextMs = Date.now() - generationContextStartedAt;
    professionalContextSource = generationContext.cacheSource.professional;
    publicationsContextSource = generationContext.cacheSource.publications;
    return generationContext;
  });
  const earlierEditorialAnglesPromise = editorialTarget
    ? loadEarlierEditorialAngles({
        userId,
        actionId: editorialTarget.id,
        scheduledFor: editorialTarget.plan.scheduledFor,
      })
    : Promise.resolve([] as string[]);
  const studioMediaPreferencesPromise =
    automation.preferredMediaSource === "ai_generation" &&
    automation.studioMediaPreferencePercent > 0
      ? loadInrAgentStudioMediaPreferences({
          supabase: supabaseAdmin,
          accountId: userId,
        })
      : Promise.resolve(null);
  const instantMediaMixPromise = editorialTarget
    ? Promise.resolve(null)
    : loadInstantMediaMixState(supabaseAdmin, userId, automation.publicationMediaTypes);

  const [
    availableChannels,
    generationContext,
    earlierEditorialAngles,
    ctaDefaults,
    studioMediaPreferences,
    instantMediaMix,
    threadsConfig,
  ] = await Promise.all([
    selectConnectedChannels({
      supabase,
      userId,
      automation,
    }),
    generationContextPromise,
    earlierEditorialAnglesPromise,
    loadBoosterCtaDefaults({ supabase, userId }),
    studioMediaPreferencesPromise,
    instantMediaMixPromise,
    supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle(),
  ]);
  if (availableChannels.includes("threads") && threadsConfig.error) return NextResponse.json({ error: "Impossible de vérifier le format Threads." }, { status: 503 });
  if (availableChannels.includes("threads") && !(await (isCron ? isMetaChannelPilotEnabledForAccount(supabaseAdmin, userId) : isMetaChannelPilotEnabledForActorAndAccount(supabaseAdmin, userId)))) return metaChannelPilotDeniedResponse();
  const threadsPreferences = normalizeThreadsPublicationPreferences(asRecord(asRecord(threadsConfig.data?.settings).threads).publicationPreferences);
  const threadsPublicationSettings = availableChannels.includes("threads") ? { mode: threadsPreferences.defaultMode } : null;
  const ghostOnlyPublication = availableChannels.length === 1 && availableChannels[0] === "threads" && threadsPublicationSettings?.mode === "ghost";
  const plannedMediaKind = editorialTarget?.plan.mediaKind;
  const publicationMediaTypes = normalizeInrAgentPublicationMediaTypes(automation.publicationMediaTypes);
  const automaticMediaKind =
    plannedMediaKind === "video"
      ? (publicationMediaTypes.video ? "video" : "image")
      : plannedMediaKind === "image" ? "image"
      : instantMediaMix?.mediaKind || "image";
  const requestedImageCount = !ghostOnlyPublication && automaticMediaKind === "image"
    ? (publicationMediaTypes.carousel && (editorialTarget?.plan.imageCount === 3 || instantMediaMix?.imageCount === 3) ? 3 : 1)
    : 0;
  const videoDurationSeconds = automaticMediaKind === "video"
    ? (editorialTarget ? editorialTarget.plan.videoDurationSeconds : 8)
    : undefined;
  // Les canaux actifs sauvegardés au moment de la préparation sont la source
  // de vérité. Le plan éditorial fige la date, le thème et le type de média,
  // mais ne doit jamais réappliquer une ancienne liste de canaux.
  const youtubeDisabledForImage = Boolean(
    automaticMediaKind === "image" &&
      availableChannels.includes("youtube_shorts")
  );
  let autoDisabledChannels: BoosterChannels[] = youtubeDisabledForImage
    ? ["youtube_shorts"]
    : [];
  let channels = availableChannels.filter(
    (channel) =>
      // YouTube exige une vidéo. Une publication choisie en image conserve
      // tous ses autres canaux et retire YouTube pour cette action seulement.
      !(automaticMediaKind === "image" && channel === "youtube_shorts")
  );
  if (!channels.length) {
    return NextResponse.json(
      {
        error: youtubeDisabledForImage
          ? "YouTube a été désactivé automatiquement : une vidéo est obligatoire pour publier sur ce canal. Activez un autre canal compatible avec les images."
          : "Aucun canal Booster / Publier connecté et autorisé pour iNr’Agent.",
        ...(youtubeDisabledForImage
          ? {
              code: "INR_AGENT_IMAGE_NO_COMPATIBLE_CHANNEL",
              autoDisabledChannels,
            }
          : {}),
      },
      { status: 400 }
    );
  }

  // A manual flash needs the complete media budget before any paid text or
  // image/video generation. Automatic claimed calendar slots may borrow.
  if (!isCron) {
    const edition = await getDashboardEditionForAccountId(userId);
    const wallet = await getAiMediaQuotaSnapshot({accountId:userId,actorAuthUserId:actorUserId,edition});
    const required = inrAgentManualPublishCreditBudget({kind:automaticMediaKind,imageCount:requestedImageCount,channels});
    const availability = inrAgentManualCreditAvailability({ready:wallet.creditsReady,unlimited:isAdmin,remaining:wallet.credits.remaining,required});
    if (!availability.allowed) return NextResponse.json({
      code: "INR_AGENT_MANUAL_CREDITS_INSUFFICIENT",
      error: "Cette génération ponctuelle nécessite des crédits IA disponibles. Le planning automatique d’iNr’Agent continue normalement.",
      manualPublishCredits: availability,
    },{status:wallet.creditsReady ? 429 : 503});
  }

  const { profile, business, recentPublications } = generationContext;
  const editorialIdea = await prepareInrAgentEditorialIdea({ context: preparationContext, editorialTarget, automation, storedAgentTone, business, profile, recentPublications, earlierEditorialAngles });
  if (!editorialIdea.ok) {
    return NextResponse.json(
      { error: "Cette idée n’est plus disponible pour ce créneau. Le planning va la remplacer.", code: editorialIdea.code },
      { status: 409 },
    );
  }
  const { agentTone, businessProfession, agentTheme, boosterTheme, instantActionId, runtimeFocus, idea } = editorialIdea;
  let { reservedInstantIdea } = editorialIdea;
  let quotaReservation: AiCreditReservation | null = null;
  const actionCredits = computeBoosterAiCredits({
    mediaType: automaticMediaKind === "video" ? "video" : "images",
    imagesForAI: !ghostOnlyPublication && automaticMediaKind === "image" ? [{}] : [],
    videoForAI: !ghostOnlyPublication && automaticMediaKind === "video" ? {} : undefined,
  });
  if (!isAdmin) {
    const quota = editorialTarget
      ? await reserveInrAgentEditorialCredits({
          supabase, userId: quotaAccountId, credits: actionCredits,
          horizonDays: automation.planningHorizonDays, idempotencyKey: editorialTarget.id,
        })
      : await reserveAiCredits({ supabase, userId: quotaAccountId, action: "booster", credits: actionCredits });
    if (quota.errorResponse) {
      if (reservedInstantIdea && instantActionId) {
        await releaseInrAgentPublicationIdea({ supabase: supabaseAdmin, userId, actionId: instantActionId });
      }
      return quota.errorResponse;
    }
    quotaReservation = quota.reservation;
  }
  try {
  const mediaSelectionStartedAt = Date.now();
  const { recentMediaUsage, diversifiedMediaSelection, fallbackAssets } = await selectInrAgentPublicationMedia({ context: preparationContext, business, automation, agentTheme, ghostOnlyPublication, automaticMediaKind, requestedImageCount, videoDurationSeconds });
  const generatedKind = automaticMediaKind;
  const desiredMediaCount = ghostOnlyPublication ? 0 : requestedImageCount || 1;
  let existingMediaAssets = automation.preferredMediaSource === "ai_generation" ? [] : fallbackAssets;
  const mediaSnapshotSignature = createHash("sha256").update(JSON.stringify([
    editorialTarget?.plan.criteriaSignature, automaticMediaKind, desiredMediaCount,
    automation.preferredMediaSource, automation.studioMediaPreferencePercent,
  ])).digest("hex");
  const savedMediaSnapshot = asRecord(editorialTarget?.metadata.editorialMediaGeneration);
  const reuseMediaSnapshot = savedMediaSnapshot.signature === mediaSnapshotSignature && typeof savedMediaSnapshot.idea === "string";
  const generationIdea = reuseMediaSnapshot ? String(savedMediaSnapshot.idea) : idea;
  const generationTheme = reuseMediaSnapshot && typeof savedMediaSnapshot.theme === "string"
    ? savedMediaSnapshot.theme as InrAgentTheme : agentTheme;
  const generationStudioPreferences = reuseMediaSnapshot
    ? (savedMediaSnapshot.studioPreferences ? normalizeAiMediaGeneratorPreferences(savedMediaSnapshot.studioPreferences) : null)
    : studioMediaPreferences;
  if (!ghostOnlyPublication && reuseMediaSnapshot && Array.isArray(savedMediaSnapshot.existingAssets)) {
    existingMediaAssets = savedMediaSnapshot.existingAssets as ImageBankAsset[];
  }
  // A retry of a historical snapshot keeps its historical requests. New
  // preparations freeze the format plan before the first billable call.
  const generationFormatPlan: InrAgentMediaFormatPlan | null = reuseMediaSnapshot
    ? asRecord(savedMediaSnapshot.formatPlan).version === 1
      ? savedMediaSnapshot.formatPlan as InrAgentMediaFormatPlan : null
    : desiredMediaCount > existingMediaAssets.length
      ? buildInrAgentMediaFormatPlan({ kind: generatedKind, channels: channels.filter((channel) => channel !== "threads" || threadsPublicationSettings?.mode !== "ghost") })
      : null;
  if (editorialTarget && !reuseMediaSnapshot) {
    // Figer les entrées avant le premier débit assure un retry identique, même
    // si le profil, l’historique ou les réglages Studio évoluent entre-temps.
    editorialTarget.metadata = {
      ...editorialTarget.metadata,
      editorialMediaGeneration: {
        signature: mediaSnapshotSignature, idea, theme: agentTheme,
        studioPreferences: studioMediaPreferences,
        existingAssets: existingMediaAssets,
        formatPlan: generationFormatPlan,
      },
    };
    const saved = await supabaseAdmin.from("inr_agent_actions")
      .update({ metadata: editorialTarget.metadata })
      .eq("id", editorialTarget.id).eq("user_id", userId).eq("status", "executing")
      .select("id").maybeSingle();
    if (saved.error || !saved.data) throw new Error("editorial_media_snapshot_unavailable");
  }
  const formatGroups = generationFormatPlan?.formats || [undefined];
  const requestedGenerationCount = formatGroups.reduce((count, format) => count + Math.max(0,
    desiredMediaCount - (!generationFormatPlan || format === generationFormatPlan.defaultFormat ? existingMediaAssets.length : 0)), 0);
  const shouldGenerateMedia = requestedGenerationCount > 0;
  const generatedMediaResults: Array<
    Awaited<ReturnType<typeof generateInrAgentMedia>>
  > = [];
  const mediaRequestScope = editorialTarget
    ? `${editorialTarget.id}:${mediaSnapshotSignature.slice(0, 16)}`
    : randomUUID();
  const generatedAssetsByFormat: Record<string, ImageBankAsset[]> = {};
  // At most the feed and fullscreen groups run together. Each group keeps its
  // own stable, sequential carousel parts and atomic credit reservations.
  const formatAttempts = await Promise.allSettled(formatGroups.map(async (outputFormat) => {
    const formatExisting = !generationFormatPlan || outputFormat === generationFormatPlan.defaultFormat ? existingMediaAssets : [];
    const formatAssets = [...formatExisting];
    for (let index = formatExisting.length; index < desiredMediaCount; index += 1) {
      const result = await generateInrAgentMedia({
        supabase: supabaseAdmin,
        accountId: userId,
        actorAuthUserId: actorUserId,
        idea: requestedImageCount === 3
          ? `${generationIdea}\n\nCARROUSEL COHÉRENT DE 3 IMAGES — visuel ${index + 1}/3. Même sujet et identité visuelle, cadrage et détail complémentaires aux autres visuels. Aucun fait, résultat client ou chantier inventé.`
          : generationIdea,
        theme: generationTheme,
        kind: generatedKind,
        adminUnlimited: isAdmin,
        studioMediaPreferencePercent: automation.studioMediaPreferencePercent,
        studioPreferences: generationStudioPreferences,
        variantSeed: `${mediaRequestScope}:${index}`,
        generationRequestId: `${mediaRequestScope}${outputFormat ? `:format:${outputFormat}` : ""}:part:${index}`,
        videoDurationSeconds,
        outputFormat,
        automaticEditorialActionId: isCron ? editorialTarget?.id : undefined,
      });
      generatedMediaResults.push(result);
      if (result.item) formatAssets.push(generatedPickerItemToAgentMedia({ item: result.item, business }));
      if (result.outcome === "content_rejected") break;
    }
    generatedAssetsByFormat[outputFormat || "legacy"] = formatAssets;
  }));
  const rejectedFormat = formatAttempts.find((attempt) => attempt.status === "rejected");
  if (rejectedFormat?.status === "rejected") throw rejectedFormat.reason;
  const generatedMediaResult =
    generatedMediaResults.find((result) => Boolean(result.item)) ||
    generatedMediaResults[0] ||
    null;
  // A configured reference must never disappear behind an image-bank fallback.
  // This also covers failed settings reads and withdrawn authorizations.
  if (generatedMediaResults.some(blocksInrAgentReferenceFallback)) {
    const quotaReached = generatedMediaResults.some((result) => result.outcome === "quota_reached");
    return NextResponse.json({ error: quotaReached
      ? "Les crédits sont insuffisants pour générer le média avec vos références obligatoires. Aucun autre visuel ne les remplacera."
      : "Le média avec vos références obligatoires n’a pas pu être préparé. Vérifiez Réglages — Publier, puis reprenez la génération.",
      code: quotaReached ? "editorial_media_required_unavailable" : "inr_agent_reference_unavailable" }, { status: quotaReached ? 429 : 409 });
  }
  const generatedMediaAssets = (generatedAssetsByFormat[generationFormatPlan?.defaultFormat || "legacy"] || []).slice(existingMediaAssets.length);
  const selectedMediaAssets = [...existingMediaAssets, ...generatedMediaAssets];
  const mediaAssets: ImageBankAsset[] = selectedMediaAssets.length === desiredMediaCount
    ? selectedMediaAssets
    : fallbackAssets.length === desiredMediaCount && generatedMediaAssets.length === 0 ? fallbackAssets : selectedMediaAssets;
  const media = mediaAssets[0] || null;
  if (
    mediaAssets.length !== desiredMediaCount || Object.values(generatedAssetsByFormat).some((assets) => assets.length !== desiredMediaCount)
  ) {
    const outcomes = generatedMediaResults.map((result) => result.outcome);
    if (outcomes.includes("content_rejected")) {
      const refusal = getAiMediaGenerationPublicError("AI_MEDIA_CONTENT_POLICY_REJECTED");
      return NextResponse.json({ error: refusal.message, code: refusal.code, outcomes }, { status: refusal.status });
    }
    const primaryOutcome = outcomes.includes("quota_reached") ? "quota_reached"
      : outcomes.find((outcome) => outcome !== "generated") || "generation_failed";
    return NextResponse.json(
      {
        error: primaryOutcome === "quota_reached"
          ? "Le quota de médias est insuffisant pour terminer cette publication. Les médias déjà préparés sont conservés pour la reprise."
          : desiredMediaCount === 3
          ? "Le carrousel doit contenir ses trois images avant validation. La préparation sera reprise sans regénérer les images déjà obtenues."
          : "Le média de cette publication n’a pas pu être préparé. Réessayez dans quelques instants.",
        code: "editorial_media_required_unavailable",
        outcomes,
      },
      { status: primaryOutcome === "quota_reached" ? 429 : 503 }
    );
  }
  mediaSelectionMs = Date.now() - mediaSelectionStartedAt;
  // Classify the files actually selected, including a fallback or a reused
  // Studio creation: only media generated for this preparation is idea-led.
  const mediaSubjectSource: AiMediaSubjectSource = mediaAssets.some(
    (asset) => asset.source !== "ai_media_generation",
  ) ? "media" : "idea";
  const publicationIdea = mediaSubjectSource === "media" ? MEDIA_FIRST_PUBLICATION_IDEA : idea;
  const publicationFocus = mediaSubjectSource === "media" ? null : runtimeFocus;
  if (mediaSubjectSource === "media" && runtimeFocus?.source === "professional_idea") {
    const reservedActionId = editorialTarget?.id || instantActionId;
    if (reservedActionId) {
      // The file supplies a different subject: this saved idea remains available.
      await releaseInrAgentPublicationIdea({ supabase: supabaseAdmin, userId, actionId: reservedActionId });
      reservedInstantIdea = false;
    }
  }
  const failedGeneratedMediaResult = generatedMediaResults.find(
    (result) => result.outcome !== "generated"
  );
  const generationWarning = failedGeneratedMediaResult
    ? failedGeneratedMediaResult.outcome === "quota_reached"
      ? "ai_generation_quota_reached_existing_media_fallback_used"
      : failedGeneratedMediaResult.outcome !== "generated"
      ? `ai_generation_${failedGeneratedMediaResult.outcome}_existing_media_fallback_used`
      : ""
    : "";
  const mediaSelectionTrace = {
    policyVersion: "media_selection_v8_shared_editorial_instant_mix",
    editorialPlan: editorialTarget?.plan || null,
    editorialFocus: publicationFocus,
    mediaSubjectSource,
    instantMediaMix: instantMediaMix
      ? {
          preparedPublications: instantMediaMix.preparedPublications,
          videoPublications: instantMediaMix.videoPublications,
          selectedKind: instantMediaMix.mediaKind,
          historyAvailable: instantMediaMix.historyAvailable,
        }
      : null,
    triedSources: [
      ...(shouldGenerateMedia ? ["ai_media_generation"] : []),
      ...(automation.useImageBank
        ? ["pro_media_library", "inrcy_image_bank"]
        : []),
    ],
    sourcePolicy: {
      proMediaLibrary: "owned_media_allowed_with_recent_reuse_exclusion",
      imageBank: "job_exact_then_generic_sector_only",
      imageBankGlobalFallbackAllowed: false,
      imageBankDiversificationRate: IMAGE_BANK_DIVERSIFICATION_RATE,
    },
    classification: {
      sector: businessProfession.sector,
      profession: businessProfession.profession,
      professionLabel: businessProfession.professionLabel,
      rawProfession: businessProfession.rawProfession,
      professionValidForSector: Boolean(
        businessProfession.sector &&
          businessProfession.profession &&
          isValidJobForSector(
            businessProfession.sector,
            businessProfession.profession
          )
      ),
    },
    diversification: diversifiedMediaSelection.diversificationTrace,
    proMediaLibraryCandidate: diversifiedMediaSelection.proCandidate,
    imageBankCandidate: diversifiedMediaSelection.imageBankCandidate,
    businessSector: businessProfession.sector,
    businessProfession: businessProfession.profession,
    businessProfessionLabel: businessProfession.professionLabel,
    rawProfession: businessProfession.rawProfession,
    aiGeneration: generatedMediaResult
      ? {
          attempted: true,
          kind: generatedMediaResult.kind,
          outcome: generatedMediaResult.outcome,
          errorCode: generatedMediaResult.errorCode || null,
          requestedCount: requestedGenerationCount,
          generatedCount: generatedMediaResults.filter((result) => Boolean(result.item)).length,
          outcomes: generatedMediaResults.map((result) => result.outcome),
          consumedSharedStudioQuota: generatedMediaResults.some(
            (result) => result.outcome === "generated"
          ),
        }
      : {
          attempted: false,
          kind: null,
          outcome: "not_requested",
          errorCode: null,
          consumedSharedStudioQuota: false,
        },
    selectedSource: media
      ? media.source === "ai_media_generation"
        ? "ai_media_generation"
        : media.librarySource ||
          (media.source === "pro_media_library"
            ? "pro_media_library"
            : "inrcy_image_bank")
      : "none",
    selectedSector: media?.sector || "",
    selectedJob: media?.job || "",
    selectedMediaType: media?.mediaType || media?.kind || "none",
    matchLevel: media?.matchLevel || "none",
    unsafeGlobalImageBankFallbackAllowed: false,
    recentMediaPolicy: getRecentMediaTrace(recentMediaUsage),
    selectedWasRecentlyUsed:
      media && media.source !== "ai_media_generation"
        ? isRecentlyUsedMediaRow(
            {
              id: media.id,
              storage_path: media.storagePath,
            },
            media.librarySource === "pro_media_library"
              ? "pro_media_library"
              : "inrcy_image_bank",
            recentMediaUsage
          )
        : false,
    warnings: [
      generationWarning,
      youtubeDisabledForImage
        ? "youtube_shorts_disabled_image_publication"
        : "",
      media?.librarySource === "pro_media_library" &&
      media.source !== "ai_media_generation" &&
      media.matchLevel === "pro_library_owned_fallback"
        ? "pro_library_owned_fallback_without_business_match"
        : "",
      media?.librarySource === "inrcy_image_bank" &&
      media.matchLevel === "image_bank_sector_generic"
        ? "image_bank_generic_sector_fallback_used"
        : "",
    ].filter(Boolean),
  };
  const mediaKind = media?.mediaType || media?.kind || "image";
  const youtubeDisabledForFinalImage =
    mediaKind !== "video" && channels.includes("youtube_shorts");
  if (youtubeDisabledForFinalImage) {
    channels = channels.filter((channel) => channel !== "youtube_shorts");
    autoDisabledChannels = Array.from(
      new Set<BoosterChannels>([...autoDisabledChannels, "youtube_shorts"])
    );
    if (
      !mediaSelectionTrace.warnings.includes(
        "youtube_shorts_disabled_image_publication"
      )
    ) {
      mediaSelectionTrace.warnings.push(
        "youtube_shorts_disabled_image_publication"
      );
    }
  }
  if (!channels.length) {
    return NextResponse.json(
      {
        error:
          "YouTube a été désactivé automatiquement : une vidéo est obligatoire pour publier sur ce canal. Activez un autre canal compatible avec les images.",
        code: "INR_AGENT_IMAGE_NO_COMPATIBLE_CHANNEL",
        autoDisabledChannels,
      },
      { status: 400 }
    );
  }
  const images = mediaAssets.filter(
    (asset) => (asset.mediaType || asset.kind || "image") === "image"
  );
  const image = images[0] || null;
  const video =
    mediaAssets.find(
      (asset) => (asset.mediaType || asset.kind || "image") === "video"
    ) || null;

  const mediaAnalysis = await prepareInrAgentSelectedMediaAnalysis({ context: preparationContext, media, images, video, mediaSubjectSource });
  const { videoPreparation, imagesForAI, selectedMediaContext, videoGenerationContextMode, videoAiContextRef } = mediaAnalysis;
  ({ videoPreparationMs, imagePreparationMs } = mediaAnalysis);

  console.info("[inr-agent] selected media AI routing", {
    userId,
    mediaId: media?.id || undefined,
    mediaType: media ? mediaKind : "none",
    mediaSource: media?.librarySource || media?.source || undefined,
    mediaSubjectSource,
    imagesSentToGeneration: imagesForAI.length,
    videoPreparationStatus: videoPreparation?.status,
    videoTranscriptAvailable: Boolean(videoPreparation?.transcript),
    videoPreparationWarnings: videoPreparation?.warnings.length || 0,
    videoContextCacheSource: videoPreparation?.cache.source,
    videoContextPersisted: videoPreparation?.cache.persisted,
    videoGenerationContextMode,
  });

  // Même logique que Booster / Publier : l'absence de média ne bloque jamais
  // la préparation du texte. Les canaux compatibles restent prêts en texte seul,
  // les canaux qui exigent un média sont marqués comme incomplets canal par canal.
  const mediaFormatBindings = generationFormatPlan ? bindInrAgentMediaFormatVariants<ImageBankAsset>({
    variants: { version: 1, kind: generatedKind, defaultFormat: generationFormatPlan.defaultFormat, byFormat: generatedAssetsByFormat }, channels,
  }) : null;
  const channelSelectedMedia = (channel: string) => channel === "threads" && threadsPublicationSettings?.mode === "ghost" ? null
    : mediaFormatBindings ? mediaFormatBindings.imagesByChannel[channel]?.[0] || mediaFormatBindings.videoByChannel[channel] || null : media;
  const mediaReadinessByChannel = Object.fromEntries(
    channels.map((channel) => [channel, channelMediaReadiness(channel, channelSelectedMedia(channel))])
  );
  const mediaAdaptationByChannel = Object.fromEntries(
    channels.map((channel) => [channel, channelMediaAdaptation(channel, channelSelectedMedia(channel))])
  );

  try {
    let versions: Awaited<ReturnType<typeof generateBoosterPosts>>["versions"] =
      {};
    let recoveredChannels: Awaited<
      ReturnType<typeof generateBoosterPosts>
    >["recoveredChannels"] = [];
    const aiGenerationStartedAt = Date.now();
    try {
      ({ versions, recoveredChannels } = await generateBoosterPosts({
        idea: publicationIdea,
        mediaSubjectSource,
        mediaTranscriptAvailable: Boolean(videoPreparation?.transcript?.trim()),
        theme: boosterTheme,
        channels,
        ctaDefaults,
        profile,
        business,
        recentPublications,
        mediaType: mediaKind === "video" ? "video" : "images",
        imagesForAI,
        mediaContext: selectedMediaContext,
        accountId: userId,
        agentTone,
        earlierEditorialAngles,
        skipMediaVisionAnalysis: false,
      }));
      for (const channel of channels) {
        const post = versions[channel];
        if (!post) continue;
        versions[channel] = applySafePreferredCta({
          channel,
          post,
          defaults: ctaDefaults,
          preserveExplicit: false,
        });
      }
      if (!channels.some((channel) => hasUsefulContent(versions[channel]))) {
        throw new Error("inr_agent_publication_generation_empty");
      }
    } finally {
      aiGenerationMs = Date.now() - aiGenerationStartedAt;
    }

    const persistenceStartedAt = Date.now();
    const now = new Date().toISOString();
    const targetChannels = channels.map(
      (channel) => boosterToAgentChannel[channel]
    );
    const targetBoosterChannelSet = new Set(channels);
    const editorialSkippedChannels = editorialTarget
      ? editorialTarget.plan.channels.filter((channel) => {
          const boosterChannel =
            inrAgentChannelToBoosterPublishChannel(channel);
          return Boolean(
            boosterChannel && !targetBoosterChannelSet.has(boosterChannel)
          );
        })
      : [];
    const previewText = buildPreviewText(versions);
    const resolvedIdea = mediaSubjectSource === "media"
      ? Object.values(versions).find((post) => post?.title?.trim())?.title || publicationIdea
      : idea;
    const title = `Publication ${themeLabels[agentTheme] || "iNr’Agent"} prête`;
    const readyEditorialPlan = editorialTarget
      ? {
          ...editorialTarget.plan,
          focus: publicationFocus,
          state: "ready",
          generatedAt: now,
          generatedMediaCount: mediaAssets.length,
        }
      : null;
    const payload = {
      version: 1,
      source: "inr_agent_publish_preparer",
      idea: resolvedIdea,
      theme: agentTheme,
      boosterTheme,
      editorialFocus: publicationFocus,
      mediaSubjectSource,
      postByChannel: versions,
      ...(threadsPublicationSettings ? { threadsPublicationSettings } : {}),
      ctaPolicy: {
        version: 1,
        source: "channel_configuration",
        configuredChannels: Object.keys(ctaDefaults.channelCtas || {}),
      },
      selectedChannels: channels,
      targetChannels,
      autoDisabledChannels,
      media,
      mediaAsset: media,
      mediaAssets,
      ...(mediaFormatBindings || {}),
      mediaSelectionTrace,
      mediaType: media ? mediaKind : "none",
      ...videoAiContextReferenceAliases(videoAiContextRef),
      videoAiPreparation: videoPreparation
        ? {
            version: INR_AGENT_VIDEO_AI_PREPARATION_VERSION,
            status: videoPreparation.status,
            frameCount: videoPreparation.frames.length,
            transcriptAvailable: Boolean(videoPreparation.transcript),
            warningCodes: videoPreparation.warnings.map(
              (warning) => warning.split(":", 1)[0]
            ),
            cacheSource: videoPreparation.cache.source,
            persisted: videoPreparation.cache.persisted,
            sourceFingerprint: videoPreparation.cache.fingerprint,
            framePaths: videoPreparation.cache.framePaths,
            timings: videoPreparation.timings,
            generationContextMode: videoGenerationContextMode,
          }
        : null,
      image,
      imageAsset: image,
      images,
      video,
      videoAsset: video,
      mediaReadinessByChannel,
      mediaAdaptationByChannel,
      mediaPolicy: "booster_publish_rules",
      imageRequiredRequested: automation.imageRequired,
      executionTarget: "booster_publish",
      ...(readyEditorialPlan ? { editorialPlan: readyEditorialPlan } : {}),
    };

    const actionValues = {
      user_id: userId,
      automation_key: "publish",
      action_type: "publication",
      target_tool: "booster",
      title,
      summary: buildSummary(
        channels,
        media,
        mediaAssets.length,
        autoDisabledChannels
      ),
      preview_text: previewText,
      target_channels: targetChannels,
      target_themes: [agentTheme],
      recipients: [],
      image_assets: mediaAssets,
      payload,
      validation_required: requiresManualValidation(automation.validationMode),
      execution_policy: getExecutionPolicy(automation.validationMode),
      status: getInitialStatus(automation.validationMode),
      scheduled_for: editorialTarget?.plan.scheduledFor || null,
      prepared_at: now,
      metadata: {
        ...(editorialTarget?.metadata || {}),
        automationFrequency: automation.frequency,
        preparedManually: !isCron,
        preparedByCron: isCron,
        editorialPlan: Boolean(editorialTarget),
        editorialPlanVersion: editorialTarget ? 1 : undefined,
        editorialState: editorialTarget ? "ready" : undefined,
        editorialGeneratedAt: editorialTarget ? now : undefined,
        editorialPreviouslyGeneratedIdea: editorialTarget && publicationFocus?.source === "professional_idea"
          ? publicationFocus.subject : undefined,
        editorialNextRetryAt: editorialTarget ? null : undefined,
        editorialLastError: editorialTarget ? null : undefined,
        editorialPreparedChannels: editorialTarget ? targetChannels : undefined,
        editorialSkippedChannels: editorialTarget
          ? editorialSkippedChannels
          : undefined,
        editorialQuota: editorialTarget
          ? {
              scope: "inr_agent_editorial",
              horizonDays: automation.planningHorizonDays,
              credits: actionCredits,
              sharedMonthlyQuota: true,
              weeklyQuotaAffected: false,
              idempotencyKey: editorialTarget.id,
            }
          : undefined,
        // Les canaux récupérés le sont désormais exclusivement par une nouvelle passe IA.
        // Aucun texte éditorial générique local n'est injecté.
        aiRecoveredChannels: recoveredChannels.map(
          (channel) => boosterToAgentChannel[channel]
        ),
        fallbackAppliedChannels: [],
        mediaSelectionTrace,
      },
      updated_at: now,
    };
    const actionSelect =
      "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";
    let inserted: unknown = null;
    let insertError: { message?: string } | null = null;
    if (editorialTarget) {
      const result = await supabaseAdmin
        .from("inr_agent_actions")
        .update(actionValues)
        .eq("id", editorialTarget.id)
        .eq("user_id", userId)
        .eq("status", "executing")
        .select(actionSelect)
        .single();
      inserted = result.data;
      insertError = result.error;
    } else {
      const result = await supabaseAdmin
        .from("inr_agent_actions")
        .insert({ ...actionValues, id: instantActionId, created_at: now })
        .select(actionSelect)
        .single();
      inserted = result.data;
      insertError = result.error;
    }

    if (insertError) {
      persistenceMs = Date.now() - persistenceStartedAt;
      await rollbackAiCredits(quotaReservation);
      quotaReservation = null;
      console.warn("[inr-agent] prepare-publish timing", {
        userId,
        isCron,
        selectedChannels: channels.length,
        mediaType: media ? mediaKind : "none",
        mediaSource: media?.librarySource || media?.source || undefined,
        mediaSubjectSource,
        generationContextMs,
        professionalContextSource,
        publicationsContextSource,
        mediaSelectionMs,
        imagePreparationMs,
        videoPreparationMs,
        videoPreparationStatus: videoPreparation?.status,
        videoFramesSentToGeneration: videoPreparation?.frames.length || 0,
        videoTranscriptAvailable: Boolean(videoPreparation?.transcript),
        videoContextCacheSource: videoPreparation?.cache.source,
        videoContextPersisted: videoPreparation?.cache.persisted,
        aiGenerationMs,
        persistenceMs,
        totalMs: Date.now() - routeStartedAt,
        success: false,
        stage: "persist-action",
        message: insertError.message,
      });
      return NextResponse.json(
        {
          error: "Impossible d’enregistrer l’action préparée iNr’Agent.",
        },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("inr_agent_automation_settings")
      .update({ last_prepared_at: now, updated_at: now })
      .eq("user_id", userId)
      .eq("automation_key", "publish");

    for (const usedMedia of mediaAssets) {
      if (!usedMedia.id) continue;
      try {
        const imageTable =
          usedMedia.librarySource === "pro_media_library" ||
          usedMedia.source === "pro_media_library" ||
          usedMedia.source === "ai_media_generation"
            ? "pro_media_library"
            : "inrcy_image_bank";
        const { data: usageRow } = await supabaseAdmin
          .from(imageTable)
          .select("usage_count")
          .eq("id", usedMedia.id)
          .maybeSingle();
        const nextUsageCount =
          Number(
            (usageRow as { usage_count?: unknown } | null)?.usage_count || 0
          ) + 1;
        const usagePatch =
          imageTable === "pro_media_library"
            ? {
                usage_count: nextUsageCount,
                last_used_at: now,
                updated_at: now,
              }
            : { usage_count: nextUsageCount, updated_at: now };
        await supabaseAdmin
          .from(imageTable)
          .update(usagePatch)
          .eq("id", usedMedia.id);
      } catch {
        // Non bloquant : la publication préparée reste valide même si le compteur image n'est pas mis à jour.
      }
    }
    persistenceMs = Date.now() - persistenceStartedAt;

    await commitAiCredits(quotaReservation);
    quotaReservation = null;
    console.info("[inr-agent] prepare-publish timing", {
      userId,
      isCron,
      selectedChannels: channels.length,
      targetChannels,
      mediaType: media ? mediaKind : "none",
      mediaSource: media?.librarySource || media?.source || undefined,
      mediaSubjectSource,
      imagesSentToGeneration: imagesForAI.length,
      validationRequired: requiresManualValidation(automation.validationMode),
      generationContextMs,
      professionalContextSource,
      publicationsContextSource,
      mediaSelectionMs,
      imagePreparationMs,
      videoPreparationMs,
      videoPreparationStatus: videoPreparation?.status,
      videoFramesSentToGeneration: videoPreparation?.frames.length || 0,
      videoTranscriptAvailable: Boolean(videoPreparation?.transcript),
      videoContextCacheSource: videoPreparation?.cache.source,
      videoContextPersisted: videoPreparation?.cache.persisted,
      aiGenerationMs,
      persistenceMs,
      totalMs: Date.now() - routeStartedAt,
      recoveredChannels: recoveredChannels.length,
      success: true,
    });
    return NextResponse.json({
      action: rowToInrAgentAction(inserted as any),
      prepared: true,
    });
  } catch (error) {
    await rollbackAiCredits(quotaReservation);
    quotaReservation = null;
    console.warn("[inr-agent] prepare-publish timing", {
      userId,
      isCron,
      selectedChannels: channels.length,
      mediaType: media ? mediaKind : "none",
      mediaSource: media?.librarySource || media?.source || undefined,
      mediaSubjectSource,
      imagesSentToGeneration: imagesForAI.length,
      generationContextMs,
      professionalContextSource,
      publicationsContextSource,
      mediaSelectionMs,
      imagePreparationMs,
      videoPreparationMs,
      videoPreparationStatus: videoPreparation?.status,
      videoFramesSentToGeneration: videoPreparation?.frames.length || 0,
      videoTranscriptAvailable: Boolean(videoPreparation?.transcript),
      videoContextCacheSource: videoPreparation?.cache.source,
      videoContextPersisted: videoPreparation?.cache.persisted,
      aiGenerationMs,
      persistenceMs,
      totalMs: Date.now() - routeStartedAt,
      success: false,
      stage: "generate-or-persist",
      message:
        error instanceof Error
          ? error.message
          : String(error || "Erreur inconnue"),
    });
    throw error;
  }
  } finally {
    // Toute sortie avant la génération du texte restitue sa réservation.
    if (quotaReservation) await rollbackAiCredits(quotaReservation);
    if (reservedInstantIdea && instantActionId) {
      await releaseInrAgentPublicationIdea({ supabase: supabaseAdmin, userId, actionId: instantActionId });
    }
  }
}
