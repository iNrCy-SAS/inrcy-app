import { type PublishContentAdjustmentInput } from "./components/PublishContentAdjustmentModal";
import { mergeBoosterContentAdjustment, normalizeBoosterContentAdjustment } from "@/lib/boosterContentAdjustment";
import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId, resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { createClient } from "@/lib/supabaseClient";
import { buildBoosterGenerationRequest } from "@/lib/boosterGenerationTransportClient";
import { getBoosterDocumentMimeType, validateBoosterDocumentSelection, type BoosterDocumentAttachmentRef } from "@/lib/boosterDocumentAttachmentPolicy";
import { BOOSTER_PDF_STORAGE_BUCKET, BOOSTER_PDF_STORAGE_FOLDER, type BoosterPdfAttachmentRef } from "@/lib/boosterPdfAttachmentPolicy";
import { createBoosterGenerationRequestId, isBoosterGenerationTransportLoss, recoverBoosterGenerationResult, reportBoosterGenerationResponseLoss } from "@/lib/boosterGenerationRecoveryClient";
import { getBoosterGenerationSpecialErrorMessage, isAutomaticBoosterGenerationRetryEligible } from "@/lib/boosterGenerationErrorPolicy";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { GENERATION_PROGRESS_PHASES, getProgressPhase, getProgressPhaseIndex, mapProgressRange, type GenerationProgressPhaseKey } from "@/lib/boosterProgressPhases";
import { getAiEngineOption, getAutomaticAiRetryEngine, type AiPreferredEngine } from "@/lib/aiEnginePreference";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { buildBoosterVideoGenerationContext, parseInstagramHashtagsInput } from "./publishModal.shared";
import { sanitizePostsForEditor, type VideoFramesForAI } from "./publishModal.foundations";
import { settleOptionalMediaEnrichment } from "./publishModal.clientResilience";
import { shouldPrepareBoosterMediaForAi } from "@/lib/boosterCreationMode";
import type { BoosterGenerationContext, BoosterGenerationTranslations } from "./boosterGenerationContext";

const BOOSTER_GENERATION_SAFETY_BUDGET_MS = 105_000;
// Le préchauffage démarre dès l'insertion. Au clic, cette courte fenêtre absorbe
// la fin éventuelle des captures sans rogner le budget de l'IA.
const BOOSTER_VIDEO_AI_PREPARATION_GRACE_MS = 12_000;
// Le fallback navigateur reste un bonus court : aucun FileReader, canvas ou
// décodeur vidéo ne peut retenir la rédaction IA au-delà.
const BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS = 2_500;
const GENERATION_PHASE_MESSAGE_KEYS: Record<GenerationProgressPhaseKey, string> = {
  initialization: "generation_phase_initialization",
  media_security: "generation_phase_media_security",
  media_analysis: "generation_phase_media_analysis",
  request_understanding: "generation_phase_request_understanding",
  ai_writing: "generation_phase_ai_writing",
  channel_adaptation: "generation_phase_channel_adaptation",
  quality_control: "generation_phase_quality_control",
  editor_preparation: "generation_phase_editor_preparation",
  final_wait: "generation_phase_final_wait",
  complete: "generation_phase_complete",
};

/** Own one generation attempt and its progress/recovery state. Media controllers stay
 * with the editor; readContext captures the invoking render only when the user acts.
 */
export function useBoosterGeneration({ i18nT, runtimeT, readContext }: {
  i18nT: BoosterGenerationTranslations;
  runtimeT: (key: string, values?: Record<string, string | number>) => string;
  readContext: () => BoosterGenerationContext;
}) {
  const generationInFlightRef = useRef(false);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationPhaseIndex, setGenerationPhaseIndex] = useState(0);
  const [generationPhaseLabel, setGenerationPhaseLabel] = useState("");
  const [generationStage, setGenerationStage] = useState("");
  const generationProgressTargetRef = useRef(0);
  const generationPhaseIndexRef = useRef(0);
  const generationRequestPhaseTimerRef = useRef<number | null>(null);
  const [genError, setGenError] = useState("");
  const [generationNotice, setGenerationNotice] = useState("");
  const [generationMediaWarning, setGenerationMediaWarning] = useState("");

  const clearGenerationTimers = () => {
    if (generationRequestPhaseTimerRef.current) {
      window.clearInterval(generationRequestPhaseTimerRef.current);
      generationRequestPhaseTimerRef.current = null;
    }
  };

  const resetGenerationProgress = useCallback(() => {
    clearGenerationTimers();
    generationProgressTargetRef.current = 0;
    generationPhaseIndexRef.current = 0;
    setGenerationProgress(0);
    setGenerationPhaseIndex(0);
    setGenerationPhaseLabel("");
    setGenerationStage("");
  }, []);

  const setGenerationProgressPhase = useCallback(
    (
      key: GenerationProgressPhaseKey,
      detail: string,
      target?: number,
    ) => {
      const phase = getProgressPhase(GENERATION_PROGRESS_PHASES, key);
      const phaseLabel = runtimeT(GENERATION_PHASE_MESSAGE_KEYS[key]);
      const phaseIndex = getProgressPhaseIndex(
        GENERATION_PROGRESS_PHASES,
        key,
      );
      if (phaseIndex < generationPhaseIndexRef.current) return;

      if (phaseIndex > generationPhaseIndexRef.current) {
        generationPhaseIndexRef.current = phaseIndex;
        setGenerationPhaseIndex(phaseIndex);
        setGenerationPhaseLabel(phaseLabel);
        setGenerationProgress((current) => Math.max(current, phase.start));
      }

      const nextTarget = Math.min(
        phase.cap,
        Math.max(phase.start, target ?? Math.max(phase.start, phase.cap - 1)),
      );
      generationProgressTargetRef.current = Math.max(
        generationProgressTargetRef.current,
        nextTarget,
      );
      setGenerationStage(detail || phaseLabel);
    },
    [runtimeT],
  );

  const completeGenerationProgress = useCallback((detail: string) => {
    const phaseLabel = runtimeT(GENERATION_PHASE_MESSAGE_KEYS.complete);
    const phaseIndex = getProgressPhaseIndex(
      GENERATION_PROGRESS_PHASES,
      "complete",
    );
    generationPhaseIndexRef.current = phaseIndex;
    generationProgressTargetRef.current = 100;
    setGenerationPhaseIndex(phaseIndex);
    setGenerationPhaseLabel(phaseLabel);
    setGenerationStage(detail || phaseLabel);
    setGenerationProgress(100);
  }, [runtimeT]);

  useEffect(() => {
    if (!generating) return;
    const timerId = window.setInterval(() => {
      setGenerationProgress((current) => {
        const target = generationProgressTargetRef.current;
        if (current >= target) return current;
        const distance = target - current;
        const step = distance > 18 ? 2 : 1;
        return Math.min(target, current + step);
      });
    }, 180);
    return () => window.clearInterval(timerId);
  }, [generating]);

  useEffect(() => {
    return () => {
      clearGenerationTimers();
    };
  }, []);

  const onGenerate = async (adjustmentInput?: PublishContentAdjustmentInput & { previousIdea: string; previousInstruction: string }) => {
    const context = readContext();
    const { creationMode, idea, publicationInstruction, selectedForGeneration, selectedChannels, selectedAiPreferredEngine, hasWrittenChannelContent, theme, contentStyle } = context.intent;
    const { videoFile, videoPreviewUrl, videoDurationSeconds, videoStorageContext, images, useImagesForAI, documentFiles, videoAiContextRef, getOrPrepareAiImagePayload, getOrPrepareVideoFramesForAI } = context.media;
    const { unifiedMediaConsumptionClientAvailable, mediaWorkspaceId, waitForPersistentWorkspaceReadiness, persistentMediaWorkspaceEnabled, startPersistentAiMediaPreparation, mediaPipelineCutoverEnabled, ensurePersistentMediaWorkspace } = context.workspace;
    const { publicationActorScopeRef, currentPostsRef, getDisplayPost, getLiveInstagramHashtags, xHashtagsInput, ctaDefaults, setImgError, setDuplicateFeedback, setPostsByChannel, setIdea, setPublicationInstruction, setXHashtagsInput, setContentAdjustmentSession, setDocumentFiles, setPdfAttachmentError, pdfInputRef, setContentWorkspaceOpen, setSynchronizedActiveChannel, scrollToContentWorkspace } = context.editor;
    if (generating || generationInFlightRef.current) return;
    setGenError("");
    setImgError("");
    setGenerationNotice("");
    setGenerationMediaWarning("");

    if (creationMode !== "ai") {
      setGenError(
        i18nT("selectionnez_creer_avec_inrcy_avant_de_c810a640"),
      );
      return;
    }

    const trimmed = (adjustmentInput?.idea ?? idea).trim();
    const generationInstruction = (adjustmentInput?.instruction ?? publicationInstruction).trim();
    const generationChannels = adjustmentInput ? selectedForGeneration.filter(channel => adjustmentInput.channels.includes(channel)) : selectedForGeneration;
    if (!generationChannels.length) {
      setGenError(i18nT("veuillez_selectionner_au_moins_1_canal_0e52243b"));
      return;
    }
    const generationScope = { ...publicationActorScopeRef.current };
    const generationIsCurrent = () => publicationActorScopeRef.current.actorUserId === generationScope.actorUserId && publicationActorScopeRef.current.accountId === generationScope.accountId && (!getActiveBrowserUserId() || getActiveBrowserUserId() === generationScope.accountId);
    const baselinePosts = currentPostsRef.current;
    let contentAdjustment;
    if (adjustmentInput) {
      try {
        contentAdjustment = normalizeBoosterContentAdjustment({ previousIdea: adjustmentInput.previousIdea, previousInstruction: adjustmentInput.previousInstruction,
          versions: Object.fromEntries(generationChannels.map(channel => [channel, { ...getDisplayPost(channel), ...(channel === "instagram" ? { hashtags: getLiveInstagramHashtags() } : channel === "x" ? { hashtags: parseInstagramHashtagsInput(xHashtagsInput) } : {}) }])) }, generationChannels);
      } catch (error) { setGenError(getSimpleFrenchErrorMessage(error, i18nT("generation_failed_retry"))); return; }
    }
    if (!selectedChannels.length) {
      setGenError(i18nT("veuillez_selectionner_au_moins_1_canal_0e52243b"));
      return;
    }
    if (!trimmed) {
      setGenError(i18nT("ecrivez_une_phrase_ex_chantier_termine_b7125e40"));
      return;
    }

    const selectedAiEngineOption = getAiEngineOption(selectedAiPreferredEngine);
    if (hasWrittenChannelContent && !contentAdjustment) {
      const confirmed = await confirmInrcy({
        eyebrow: i18nT("contenus_deja_presents_37541640"),
        title: i18nT("generer_de_nouveaux_contenus_8a601a4e"),
        message:
          i18nT("les_textes_deja_saisis_ou_generes_b4ecf4a5"),
        cancelLabel: i18nT("conserver_mes_textes_60ea7d68"),
        confirmLabel: i18nT("generer_et_remplacer_808c9d9f"),
        variant: "warning",
      });
      if (!confirmed) return;
    }

    const videoGenerationContext = buildBoosterVideoGenerationContext({
      mediaType: videoFile || videoPreviewUrl ? "video" : "images",
      videoFile,
      duration: videoDurationSeconds,
      storage: videoStorageContext,
    });
    const hasVideoForGeneration = !!videoGenerationContext?.enabled;
    const shouldUseImagesForAI =
      images.length > 0 && useImagesForAI;
    const shouldPrepareMediaForAi = shouldPrepareBoosterMediaForAi({
      mode: creationMode,
      mediaType: hasVideoForGeneration ? "video" : "images",
      hasImages: images.length > 0,
      hasVideo: hasVideoForGeneration,
      useImagesForAI,
    });
    const shouldUsePersistentMediaWorkspaceForAi =
      shouldPrepareMediaForAi && unifiedMediaConsumptionClientAvailable;
    let temporaryPdfReference: BoosterPdfAttachmentRef | null = null;
    const temporaryDocumentReferences: BoosterDocumentAttachmentRef[] = [];
    resetGenerationProgress();
    generationInFlightRef.current = true;
    setGenerating(true);
    setGenerationProgressPhase(
      "initialization",
      i18nT("generation_preparing_with_engine", { value0: selectedAiEngineOption.shortLabel }),
      6,
    );
    setDuplicateFeedback(null);

    try {
      if (documentFiles.length) {
        const selectionError = validateBoosterDocumentSelection(documentFiles);
        if (selectionError) throw new Error(selectionError);
        setGenerationProgressPhase("media_security", i18nT("progress_media_preparation"), 10);
        const pdfSupabase = createClient();
        const { data: authData, error: authError } = await pdfSupabase.auth.getUser();
        const storageUserId = authData?.user?.id ? resolveActiveBrowserUserId(authData.user.id) : "";
        if (authError || !storageUserId) throw new Error("Reconnectez-vous pour préparer les documents.");
        for (const file of documentFiles) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
          const uniqueId = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2, 10);
          const storagePath = storageUserId + "/" + BOOSTER_PDF_STORAGE_FOLDER + "/" + uniqueId + "-" + safeName;
          const type = getBoosterDocumentMimeType(file.name);
          const { error: uploadError } = await pdfSupabase.storage.from(BOOSTER_PDF_STORAGE_BUCKET).upload(storagePath, file, { cacheControl: "3600", upsert: false, contentType: type });
          if (uploadError) throw new Error("Impossible de préparer le document « " + file.name + " » pour l’IA.");
          temporaryDocumentReferences.push({ bucket: BOOSTER_PDF_STORAGE_BUCKET, path: storagePath, name: file.name, type, size: file.size });
        }
        temporaryPdfReference = temporaryDocumentReferences[0] || null;
      }

      // Les documents explicitement demandés sont déjà sécurisés ci-dessus. Les médias
      // visuels restent des enrichissements optionnels : une seule enveloppe de
      // 12 s couvre la dernière course upload + captures, puis la rédaction part
      // sans attendre davantage leur préparation.
      const mediaPreparationDeadlineAt =
        Date.now() + BOOSTER_VIDEO_AI_PREPARATION_GRACE_MS;
      let mediaFallbackNotice = "";
      let readyMediaWorkspaceId = shouldUsePersistentMediaWorkspaceForAi
        ? null
        : mediaWorkspaceId;

      if (shouldUsePersistentMediaWorkspaceForAi) {
        try {
          readyMediaWorkspaceId = await waitForPersistentWorkspaceReadiness(
            "generate",
            (progress) => {
              if (progress <= 24) {
                setGenerationProgressPhase(
                  "media_security",
                  progress < 12 ? i18nT("media_workspace_opening") : i18nT("media_secure_upload_progress"),
                  mapProgressRange(progress, 6, 24, 8, 21),
                );
                return;
              }
              setGenerationProgressPhase(
                "media_analysis",
                i18nT("progress_media_preparation"),
                mapProgressRange(progress, 25, 42, 23, 39),
              );
            },
            [...(shouldUseImagesForAI ? ["image" as const] : []), ...(hasVideoForGeneration ? ["video" as const] : [])],
            Math.max(1_000, mediaPreparationDeadlineAt - Date.now()),
          );
        } catch (workspaceError) {
          console.warn(
            "[booster-generate] media workspace unavailable, text fallback",
            workspaceError,
          );
          mediaFallbackNotice =
            "Analyse du média indisponible : contenus générés à partir de votre phrase et de votre profil.";
          setImgError("");
          setGenerationMediaWarning(mediaFallbackNotice);
          readyMediaWorkspaceId = null;
        }
        if (!readyMediaWorkspaceId && !mediaFallbackNotice) {
          mediaFallbackNotice =
            "Analyse du média indisponible : contenus générés à partir de votre phrase et de votre profil.";
          setImgError("");
          setGenerationMediaWarning(mediaFallbackNotice);
        }
      }

      let videoAiPreparationReady = false;
      if (
        hasVideoForGeneration &&
        readyMediaWorkspaceId &&
        persistentMediaWorkspaceEnabled
      ) {
        setGenerationProgressPhase(
          "media_analysis",
          i18nT("progress_media_preparation"),
          34,
        );
        // La mission est dédupliquée par le hook et travaille directement
        // depuis la source Supabase : aucun second upload ni transcodage. On lui
        // laisse une courte avance, puis on continue
        // avec les captures déjà prêtes ou le contexte métadonnées/phrase.
        let graceTimeoutId: number | null = null;
        const preparation = startPersistentAiMediaPreparation()
          .then(async (result) => {
            if (result.status === "ready") return true;
            if (result.status === "failed") return false;
            // Si l'ACK indique qu'un worker possède déjà le job, on ne le
            // ré-enfile pas en boucle. On lui laisse simplement le reste de la
            // fenêtre ; le resolver relira ensuite les variantes une seule fois.
            const remainingMs = mediaPreparationDeadlineAt - Date.now();
            if (remainingMs > 0) {
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, remainingMs),
              );
            }
            return false;
          })
          .catch((error) => {
            console.warn(
              "[booster-generate] video AI preparation deferred",
              error,
            );
            return false;
          });
        videoAiPreparationReady = await Promise.race([
          preparation,
          new Promise<boolean>((resolve) => {
            graceTimeoutId = window.setTimeout(
              () => resolve(false),
              Math.max(0, mediaPreparationDeadlineAt - Date.now()),
            );
          }),
        ]);
        if (graceTimeoutId !== null) window.clearTimeout(graceTimeoutId);
      }

      if (shouldPrepareMediaForAi) {
        setGenerationProgressPhase(
          "media_analysis",
          hasVideoForGeneration ? videoAiPreparationReady ? i18nT("generation_video_captures_ready") : i18nT("generation_video_ready_captures_background") : shouldUseImagesForAI ? i18nT("generation_visuals_ready_analysis") : i18nT("generation_media_ready_analysis"),
          39,
        );
      }

      if (shouldUseImagesForAI && !mediaPipelineCutoverEnabled) {
        setGenerationProgressPhase(
          "media_analysis",
          images.length > 1 ? i18nT("generation_images_preparing_visual_analysis") : i18nT("generation_image_preparing_visual_analysis"),
          39,
        );
      }
      const imagePreparationResults =
        shouldUseImagesForAI && !mediaPipelineCutoverEnabled
          ? await Promise.all(
              images.map((file) =>
                settleOptionalMediaEnrichment(
                  () => getOrPrepareAiImagePayload(file),
                  BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS,
                ),
              ),
            )
          : [];
      const imagesForAI = imagePreparationResults.flatMap((result) =>
        result.ok ? [result.value] : [],
      );
      if (
        shouldUseImagesForAI &&
        !mediaPipelineCutoverEnabled &&
        imagesForAI.length < images.length
      ) {
        const imagePreparationTimedOut = imagePreparationResults.some(
          (result) => !result.ok && result.reason === "timeout",
        );
        mediaFallbackNotice =
          imagePreparationTimedOut
            ? "Analyse visuelle non terminée à temps : contenus générés à partir de votre phrase, de votre profil et des visuels déjà exploitables."
            : "Analyse visuelle partiellement indisponible : contenus générés à partir de votre phrase, de votre profil et des visuels exploitables.";
      }
      let videoFramesForAI: VideoFramesForAI = [];
      const videoAudioTranscript = "";
      const videoRawAudioTranscript = "";
      let videoAudioTranscriptStatus: "pending" | "ready" | "unavailable" =
        "pending";
      if (
        hasVideoForGeneration &&
        videoFile &&
        !videoAiContextRef
      ) {
        setGenerationProgressPhase(
          "media_analysis",
          i18nT("generation_video_audio_visual_analysis"),
          39,
        );

        // La transcription audio est un bonus et ne doit jamais retenir le clic
        // Générer. Les trois captures locales partent immédiatement ; le serveur
        // peut encore exploiter une piste audio déjà prête dans le workspace,
        // avec son propre budget court et partagé.
        const framesResult = await settleOptionalMediaEnrichment(
          () => getOrPrepareVideoFramesForAI(videoFile),
          BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS,
        );
        videoFramesForAI = framesResult.ok ? framesResult.value : [];
        videoAudioTranscriptStatus = "unavailable";
        if (!videoFramesForAI.length) {
          mediaFallbackNotice =
            !framesResult.ok && framesResult.reason === "timeout"
              ? "Captures vidéo non terminées à temps : contenus générés à partir de votre phrase et de votre profil."
              : "Analyse visuelle indisponible : contenus générés à partir de votre phrase et de votre profil.";
        }

        setGenerationProgressPhase(
          "media_analysis",
          videoFramesForAI.length > 0 && videoAudioTranscript ? i18nT("generation_video_audio_images_analysis") : videoFramesForAI.length > 0 ? i18nT("generation_video_images_analysis") : videoAudioTranscript ? i18nT("generation_video_audio_analysis") : i18nT("generation_video_analysis_limited"),
          39,
        );
      } else if (
        hasVideoForGeneration &&
        videoAiContextRef
      ) {
        setGenerationProgressPhase(
          "media_analysis",
          i18nT("generation_video_analysis_reused"),
          39,
        );
      }

      setGenerationProgressPhase(
        "request_understanding",
        publicationInstruction.trim() ? i18nT("generation_intent_instructions_analysis") : i18nT("generation_intent_analysis"),
        47,
      );

      // Un workspace vide sert aussi de reçu durable pour une génération sans
      // média. Sa création reste un filet de sécurité best effort : si elle
      // échoue, le moteur IA normal continue exactement comme auparavant.
      let generationWorkspaceId = unifiedMediaConsumptionClientAvailable
        ? readyMediaWorkspaceId || mediaWorkspaceId || undefined
        : undefined;
      if (unifiedMediaConsumptionClientAvailable && !generationWorkspaceId) {
        try {
          const recoveryWorkspace = await ensurePersistentMediaWorkspace();
          generationWorkspaceId = recoveryWorkspace?.workspaceId || undefined;
        } catch (workspaceError) {
          console.warn(
            "[booster-generate] recovery receipt workspace unavailable",
            workspaceError,
          );
        }
      }

      // Uploading and verifying the workspace is media preparation, not AI
      // generation. Start the generation safety window only once the request is
      // ready to leave; otherwise a slow batch of images can consume the whole
      // deadline before the AI is even called.
      const generationDeadlineAt =
        Date.now() + BOOSTER_GENERATION_SAFETY_BUDGET_MS;
      const generationRequestId = createBoosterGenerationRequestId();
      const generationPayload = {
        creationMode: "ai" as const,
        generationRequestId,
        generationDeadlineAt,
        mediaWorkspaceId: generationWorkspaceId,
        mediaPipelineCutoverV1: mediaPipelineCutoverEnabled,
        useWorkspaceMediaForAI:
          unifiedMediaConsumptionClientAvailable &&
          Boolean(readyMediaWorkspaceId) &&
          shouldUsePersistentMediaWorkspaceForAi,
        mediaWorkspaceExpected:
          shouldUsePersistentMediaWorkspaceForAi &&
          Boolean(readyMediaWorkspaceId),
        idea: trimmed,
        publicationInstruction: generationInstruction,
        ...(contentAdjustment ? { contentAdjustment } : {}),
        documentForAI: temporaryPdfReference,
        documentsForAI: temporaryDocumentReferences,
        theme,
        style: contentStyle,
        aiPreferredEngine: selectedAiPreferredEngine,
        channels: generationChannels,
        mediaType: hasVideoForGeneration ? "video" : "images",
        useImagesForAI: shouldUseImagesForAI,
        imageCount: mediaPipelineCutoverEnabled ? 0 : imagesForAI.length,
        imagesForAI: mediaPipelineCutoverEnabled ? [] : imagesForAI,
        videoForAI:
          hasVideoForGeneration &&
          videoGenerationContext
            ? {
                ...videoGenerationContext,
                contextRef: videoAiContextRef,
                visualFrames: videoFramesForAI,
                audioTranscript: videoAudioTranscript,
                rawAudioTranscript: videoRawAudioTranscript,
                analysisPlan: {
                  ...videoGenerationContext.analysisPlan,
                  visualFrames:
                    videoFramesForAI.length > 0 ? "ready" : "pending",
                  audioTranscript: videoAudioTranscriptStatus,
                },
              }
            : null,
      };
      const executeGenerationRequest = async (engine: AiPreferredEngine) => {
        const request = buildBoosterGenerationRequest({
          ...generationPayload,
          aiPreferredEngine: engine,
        });
        const remainingMs = generationDeadlineAt - Date.now();
        if (remainingMs <= 1_000) {
          throw new Error(
            "La génération a dépassé le délai de sécurité. Merci de relancer.",
          );
        }
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          remainingMs,
        );
        try {
          const response = await fetch("/api/booster/generate", {
            method: "POST",
            ...(request.headers ? { headers: request.headers } : {}),
            body: request.body,
            signal: controller.signal,
          });
          const responseJson = await response.json().catch(() => ({}));
          return { response, responseJson };
        } catch (error) {
          if (controller.signal.aborted) {
            throw new Error(
              "La génération a dépassé le délai de sécurité. Merci de relancer.",
            );
          }
          throw error;
        } finally {
          window.clearTimeout(timeoutId);
        }
      };
      let generationRecoveredAfterTransportLoss = false;
      const executeGenerationRequestWithRecovery = async (
        engine: AiPreferredEngine,
      ) => {
        try {
          return await executeGenerationRequest(engine);
        } catch (requestError) {
          if (
            !generationWorkspaceId ||
            !isBoosterGenerationTransportLoss(requestError)
          ) {
            throw requestError;
          }

          clearGenerationTimers();
          setGenerationProgressPhase(
            "final_wait",
            i18nT("generation_connection_recovering"),
            99,
          );
          const recovery = await recoverBoosterGenerationResult({
            workspaceId: generationWorkspaceId,
            requestId: generationRequestId,
            maxWaitMs: Math.max(
              20_000,
              Math.min(70_000, generationDeadlineAt - Date.now() + 8_000),
            ),
          });
          const recovered = recovery.status === "ready";
          reportBoosterGenerationResponseLoss({
            error: requestError,
            recovered,
            attempts: recovery.attempts,
            elapsedMs: recovery.elapsedMs,
            channelCount: generationChannels.length,
            mediaType: hasVideoForGeneration ? "video" : "images",
            engine,
          });

          if (!recovered) {
            throw new Error(
              "La connexion a été interrompue avant la réception du résultat. Aucun nouvel appel IA n’a été lancé. Vérifiez votre connexion puis réessayez.",
            );
          }

          generationRecoveredAfterTransportLoss = true;
          return {
            response: null,
            responseJson: recovery.payload,
          };
        }
      };

      setGenerationProgressPhase(
        "ai_writing",
        hasVideoForGeneration ? i18nT("generation_writing_from_video", { value0: selectedAiEngineOption.shortLabel }) : i18nT("generation_writing", { value0: selectedAiEngineOption.shortLabel }),
        67,
      );
      let generationRequestVisualPhase:
        | "ai_writing"
        | "channel_adaptation"
        | "quality_control"
        | "final_wait" = "ai_writing";
      let lastGenerationRequestVisualChangeAt = Date.now();
      clearGenerationTimers();
      generationRequestPhaseTimerRef.current = window.setInterval(() => {
        if (Date.now() - lastGenerationRequestVisualChangeAt < 2_800) return;
        lastGenerationRequestVisualChangeAt = Date.now();
        if (generationRequestVisualPhase === "ai_writing") {
          generationRequestVisualPhase = "channel_adaptation";
          setGenerationProgressPhase(
            "channel_adaptation",
            i18nT("generation_channel_adaptation_progress", { value0: generationChannels.length, value1: generationChannels.length > 1 ? "canaux" : "canal" }),
            81,
          );
          return;
        }
        if (generationRequestVisualPhase === "channel_adaptation") {
          generationRequestVisualPhase = "quality_control";
          setGenerationProgressPhase(
            "quality_control",
            i18nT("generation_quality_check"),
            91,
          );
          return;
        }
        if (generationRequestVisualPhase === "quality_control") {
          generationRequestVisualPhase = "final_wait";
          setGenerationProgressPhase(
            "final_wait",
            i18nT("generation_finalizing_content"),
            99,
          );
          clearGenerationTimers();
        }
      }, 500);

      let { response: res, responseJson: json } =
        await executeGenerationRequestWithRecovery(selectedAiPreferredEngine);
      clearGenerationTimers();
      let automaticRetry:
        | { primaryEngine: AiPreferredEngine; finalEngine: AiPreferredEngine }
        | null = null;

      if (
        res &&
        !res.ok &&
        isAutomaticBoosterGenerationRetryEligible(res.status, json)
      ) {
        const retryEngine = getAutomaticAiRetryEngine(
          selectedAiPreferredEngine,
        );
        const primaryLabel = getAiEngineOption(
          selectedAiPreferredEngine,
        ).shortLabel;
        const retryLabel = getAiEngineOption(retryEngine).shortLabel;

        automaticRetry = {
          primaryEngine: selectedAiPreferredEngine,
          finalEngine: retryEngine,
        };
        setGenerationProgressPhase(
          "quality_control",
          i18nT("generation_engine_retry", { value0: primaryLabel, value1: retryLabel }),
          91,
        );

        ({ response: res, responseJson: json } =
          await executeGenerationRequestWithRecovery(retryEngine));
      }

      if (res && !res.ok) {
        const specialMessage = getBoosterGenerationSpecialErrorMessage({
          status: res.status,
          payload: json,
          retryAfterHeader: res.headers.get("Retry-After"),
        });
        setGenError(
          getSimpleFrenchErrorMessage({ ...json, user_message: specialMessage || json?.user_message, status: res.status }, i18nT("generation_failed_retry")),
        );
        return;
      }

      if (generationPhaseIndexRef.current < 9) {
        setGenerationProgressPhase(
          "editor_preparation",
          i18nT("generation_installing_editor"),
          95,
        );
      }
      const versions = json?.versions || {};
      if (!generationIsCurrent()) return;
      const sanitizedVersions = sanitizePostsForEditor(versions, ctaDefaults);
      if (generationChannels.includes("instagram") && sanitizedVersions.instagram) {
        const fitInstagram = readContext().editor.fitGeneratedInstagramCopy;
        if (fitInstagram) sanitizedVersions.instagram = fitInstagram(sanitizedVersions.instagram);
      }
      if (contentAdjustment) {
        if (generationChannels.some(channel => JSON.stringify(currentPostsRef.current[channel]) !== JSON.stringify(baselinePosts[channel]))) throw new Error(i18nT("adjust_conflict"));
        const revised = mergeBoosterContentAdjustment(currentPostsRef.current, sanitizedVersions, generationChannels);
        setPostsByChannel(revised);
        setIdea(trimmed);
        setPublicationInstruction(generationInstruction);
        if (generationChannels.includes("x")) setXHashtagsInput((revised.x?.hashtags || []).join(" "));
        setContentAdjustmentSession(null);
      } else {
        setPostsByChannel(sanitizedVersions);
      }
      // Le document source a été consommé par cette génération. On libère le
      // File local pour qu'un brouillon enregistré ensuite soit réellement net.
      setDocumentFiles([]);
      setPdfAttachmentError("");
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      setContentWorkspaceOpen(true);
      if (generationChannels.length) {
        setSynchronizedActiveChannel(generationChannels[0]);
      }
      scrollToContentWorkspace();
      const mediaAnalysisFallback = json?.mediaAnalysisFallback;
      const serverMediaFallbackNotice = String(
        mediaAnalysisFallback?.message || "",
      )
        .trim()
        .slice(0, 320);
      setGenerationMediaWarning(
        serverMediaFallbackNotice || mediaFallbackNotice,
      );
      const aiFallback = json?.aiFallback;
      if (generationRecoveredAfterTransportLoss) {
        setGenerationNotice(
          i18nT("la_connexion_a_ete_interrompue_mais_a4f2c2e4"),
        );
      } else if (aiFallback?.used) {
        const primaryLabel = String(
          aiFallback.primaryEngineLabel || "Le moteur sélectionné",
        ).trim();
        const finalLabel = String(
          aiFallback.finalEngineLabel || "ChatGPT",
        ).trim();
        const transportLabel =
          aiFallback.transport === "openai_direct"
            ? "via la connexion OpenAI de secours"
            : "via le moteur de secours";
        setGenerationNotice(
          i18nT("value_etait_temporairement_indisponible_le_conte_e64e687d", { value0: primaryLabel, value1: finalLabel, value2: transportLabel }),
        );
      } else if (automaticRetry) {
        const primaryLabel = getAiEngineOption(
          automaticRetry.primaryEngine,
        ).shortLabel;
        const finalLabel = getAiEngineOption(
          automaticRetry.finalEngine,
        ).shortLabel;
        setGenerationNotice(
          i18nT("value_n_a_pas_repondu_au_e653b7e3", { value0: primaryLabel, value1: finalLabel }),
        );
      }
      setGenerationProgressPhase(
        "final_wait",
        i18nT("generation_finalizing_content"),
        99,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 540));
      completeGenerationProgress(i18nT("generation_content_ready_review"));
      await new Promise((resolve) => window.setTimeout(resolve, 320));
    } catch (error) {
      // Toute analyse média optionnelle a déjà été isolée ci-dessus. Une
      // erreur rouge correspond donc uniquement à l'échec de la génération.
      setGenError(getSimpleFrenchErrorMessage(error, i18nT("generation_failed_retry"), { allowUnknownMessage: false }));
    } finally {
      if (temporaryDocumentReferences.length) {
        try {
          const cleanupSupabase = createClient();
          const { error: cleanupError } = await cleanupSupabase.storage
            .from(BOOSTER_PDF_STORAGE_BUCKET)
            .remove(temporaryDocumentReferences.map(reference => reference.path));
          if (cleanupError) {
            console.warn(
              "[booster-generate] temporary PDF cleanup skipped",
              cleanupError,
            );
          }
        } catch (cleanupError) {
          console.warn(
            "[booster-generate] temporary PDF cleanup failed",
            cleanupError,
          );
        }
      }
      clearGenerationTimers();
      generationInFlightRef.current = false;
      setGenerating(false);
      resetGenerationProgress();
    }
  };

  return { onGenerate, generating, generationInFlightRef, generationProgress,
    generationPhaseIndex, generationPhaseLabel, generationStage, genError,
    generationNotice, generationMediaWarning, setGenError, setGenerationNotice,
    setGenerationMediaWarning, resetGenerationProgress, setGenerationProgressPhase };
}
