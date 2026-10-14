"use client";

import { useEffect, useRef } from "react";

import useMediaGeneration, {
  type MediaGenerationRequest,
  type MediaGenerationResult,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import {
  adsMediaKindForPlan,
  adsMediaFormatForPlan,
  chatgptAdsImagePrompt,
  googleSearchImagePrompt,
  metaFeedImagePrompt,
  metaStoryReelImagePrompt,
  pinterestAdsImagePrompt,
  shouldGenerateAdsMedia,
} from "@/lib/adsCampaignMediaPolicy";
import type { AdsCampaignPlan } from "@/lib/adsCampaignPlan";
import type { AdsChannelId } from "@/lib/adsValidation";

type AdsCampaignAutoMediaGeneratorProps = {
  provider: AdsChannelId;
  plan: AdsCampaignPlan;
  onProgress: (progress: number) => void;
  onComplete: (result: MediaGenerationResult) => void;
  onMetaPackComplete: (results: MetaPackResults, error?: string) => void;
  onSkip: (reason: string) => void;
  onError: (message: string) => void;
};

type MetaPackResults = {
  feed?: MediaGenerationResult;
  storyReel?: MediaGenerationResult;
};

function mediaPromptForPlan(provider: AdsChannelId, plan: AdsCampaignPlan, kind: "image" | "video") {
  const googleSearchImage = provider === "google" && plan.campaignType === "search";
  if (googleSearchImage) {
    return googleSearchImagePrompt(plan);
  }
  if (provider === "pinterest" && kind === "image") return pinterestAdsImagePrompt(plan);
  if (provider === "openai" && kind === "image") return chatgptAdsImagePrompt(plan);
  return [
    plan.mediaBrief,
    plan.offer && `Offre ou service : ${plan.offer}`,
    plan.primaryText && `Message : ${plan.primaryText}`,
    plan.callToAction && `Action attendue : ${plan.callToAction}`,
  ]
    .filter(Boolean)
    .join(". ")
    .slice(0, 1_800);
}

/**
 * Executes the iNr'Studio generation requested by the assisted campaign path.
 * This deliberately shares the established Studio quota, persistence and draft
 * acceptance flow instead of inventing a second media pipeline for Ads.
 */
export default function AdsCampaignAutoMediaGenerator({
  provider,
  plan,
  onProgress,
  onComplete,
  onMetaPackComplete,
  onSkip,
  onError,
}: AdsCampaignAutoMediaGeneratorProps) {
  const startedRef = useRef(false);
  const settledRef = useRef(false);
  const callbacksRef = useRef({ onProgress, onComplete, onMetaPackComplete, onSkip, onError });
  const batchProgressRef = useRef({ index: 0, total: 1 });
  const {
    generate,
    acceptDraft,
    cancelGeneration,
    progress,
  } = useMediaGeneration();

  // The parent updates its progress UI while generation runs. Keep the latest
  // callbacks without restarting (or cancelling) the paid Studio operation.
  useEffect(() => {
    callbacksRef.current = { onProgress, onComplete, onMetaPackComplete, onSkip, onError };
  }, [onComplete, onError, onMetaPackComplete, onProgress, onSkip]);

  useEffect(() => {
    if (startedRef.current) return;
    // Deferring the launch by one turn keeps React Strict Mode's development
    // effect rehearsal from spending a media credit then immediately aborting
    // the only generation attempt.
    let disposed = false;
    const quoteController = new AbortController();
    const generateConfirmedMedia = async (request: MediaGenerationRequest) => {
      // Keep one set of parameters for the quote and the generation. Studio's
      // legacy automatic video path used 16 seconds, whereas quotes default to 8.
      const mediaRequest: MediaGenerationRequest = {
        ...request,
        operation: "generate",
        inputMode: "essential",
        imageEngine: request.kind === "image" ? request.imageEngine || "openai" : undefined,
        videoEngine: request.kind === "video" ? request.videoEngine || "omni" : undefined,
        videoResolution: request.kind === "video" ? request.videoResolution || "720p" : undefined,
        durationSeconds: request.kind === "video" ? request.durationSeconds || 16 : undefined,
        sceneMode: request.kind === "video" ? request.sceneMode || "single" : undefined,
      };
      const response = await fetch("/api/media-generation/quote", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: quoteController.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: mediaRequest.kind,
          operation: mediaRequest.operation,
          creationMode: mediaRequest.creationMode,
          inputMode: mediaRequest.inputMode,
          imageEngine: mediaRequest.imageEngine,
          format: mediaRequest.format,
          videoEngine: mediaRequest.videoEngine,
          videoResolution: mediaRequest.videoResolution,
          durationSeconds: mediaRequest.durationSeconds,
          sceneMode: mediaRequest.sceneMode,
          inspirationImagesCount: mediaRequest.inspirationImages?.length || 0,
          identityMode: mediaRequest.identityMode || "auto",
          withNarration: Boolean(mediaRequest.withNarration),
          teamVideoSpeechMode: mediaRequest.teamVideoSpeechMode || "voiceover",
        }),
      });
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        quote?: { totalCredits?: unknown; tariffVersion?: unknown; quoteId?: unknown };
      } | null;
      if (disposed || quoteController.signal.aborted) throw new Error("Création du média annulée.");
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || "Le devis du média est momentanément indisponible.");
      }
      const quote = payload.quote;
      if (!quote || typeof quote.totalCredits !== "number" || !Number.isSafeInteger(quote.totalCredits) || quote.totalCredits < 0
        || typeof quote.tariffVersion !== "string" || !quote.tariffVersion.trim()
        || typeof quote.quoteId !== "string" || !/^[a-f0-9]{64}$/.test(quote.quoteId)) {
        throw new Error("Le devis du média est incomplet. Réessayez l’analyse.");
      }
      return generate({
        ...mediaRequest,
        expectedCredits: quote.totalCredits,
        creditTariffVersion: quote.tariffVersion,
        creditQuoteId: quote.quoteId,
      });
    };
    const timer = window.setTimeout(() => {
      if (disposed || startedRef.current) return;
      startedRef.current = true;

      if (!shouldGenerateAdsMedia({ provider, campaignType: plan.campaignType, mediaStrategy: plan.mediaStrategy })) {
        settledRef.current = true;
        callbacksRef.current.onSkip(
          plan.mediaStrategy === "search_text"
            ? "Ce format est textuel dans iNr’ADS : aucun média n’a été généré."
            : "Ce format utilise un flux produits : aucun visuel supplémentaire n’a été généré.",
        );
        return;
      }

      const kind = adsMediaKindForPlan({ provider, campaignType: plan.campaignType, mediaStrategy: plan.mediaStrategy, creativeType: plan.creativeType });
      const googleSearchImage = provider === "google" && plan.campaignType === "search";
      const prompt = mediaPromptForPlan(provider, plan, kind);
      if (prompt.length < 3) {
        settledRef.current = true;
        callbacksRef.current.onError("La campagne est prête, mais il manque une consigne suffisamment précise pour générer son média.");
        return;
      }

      void (async () => {
        const metaResults: MetaPackResults = {};
        try {
          if (provider === "meta") {
            const slots: ("feed" | "story_reel")[] = [];
            if (plan.metaPlacements.some((placement) => placement === "facebook_feed" || placement === "instagram_feed")) slots.push("feed");
            if (plan.metaPlacements.some((placement) => placement === "stories" || placement === "reels")) slots.push("story_reel");
            if (!slots.length) {
              throw new Error("Sélectionnez au moins un placement Meta Feed, Story ou Reel avant de générer les visuels.");
            }

            batchProgressRef.current = { index: 0, total: slots.length };
            for (let index = 0; index < slots.length; index += 1) {
              if (disposed) return;
              const slot = slots[index];
              batchProgressRef.current = { index, total: slots.length };
              const metaPrompt = slot === "feed" ? metaFeedImagePrompt(plan) : metaStoryReelImagePrompt(plan);
              const generated = await generateConfirmedMedia({
                creationMode: "free",
                freePrompt: metaPrompt,
                kind: "image",
                subjectSource: "custom",
                idea: metaPrompt,
                textKeywords: [],
                format: slot === "feed" ? "portrait" : "story",
                imageStyle: "photo",
                peopleMode: "auto",
                useBrandColors: false,
                logoMode: "none",
                withMusic: false,
                withNarration: false,
                source: "studio",
              });
              const accepted = await acceptDraft(generated);
              if (slot === "feed") metaResults.feed = accepted;
              else metaResults.storyReel = accepted;
            }
            settledRef.current = true;
            if (!disposed) callbacksRef.current.onMetaPackComplete(metaResults);
            return;
          }

          const generated = await generateConfirmedMedia({
            creationMode: "free",
            freePrompt: prompt,
            kind,
            subjectSource: "custom",
            idea: prompt,
            textKeywords: [],
            format: adsMediaFormatForPlan({ provider, campaignType: plan.campaignType }, kind),
            imageStyle: "photo",
            peopleMode: "auto",
            useBrandColors: !googleSearchImage,
            logoMode: googleSearchImage || provider === "pinterest" ? "none" : "discreet",
            withMusic: kind === "video",
            withNarration: false,
            source: "studio",
          });
          const accepted = await acceptDraft(generated);
          settledRef.current = true;
          if (!disposed) callbacksRef.current.onComplete(accepted);
        } catch (error) {
          if (!disposed) {
            settledRef.current = true;
            const message = error instanceof Error
              ? error.message
              : "Le média iNr’Studio n’a pas pu être généré.";
            // A first Meta asset may already have been accepted (and billed)
            // when generation of the second one fails. Keep it in the draft.
            if (provider === "meta" && (metaResults.feed || metaResults.storyReel)) {
              callbacksRef.current.onMetaPackComplete(metaResults, message);
            } else {
              callbacksRef.current.onError(message);
            }
          }
        }
      })();
    }, 0);

    return () => {
      disposed = true;
      quoteController.abort();
      window.clearTimeout(timer);
      // Closing the campaign studio must not let a background iNr'Studio
      // generation continue and consume a credit after the professional has
      // left the assisted path. A completed result is deliberately preserved.
      if (startedRef.current && !settledRef.current) cancelGeneration();
    };
  }, [acceptDraft, cancelGeneration, generate, plan, provider]);

  useEffect(() => {
    if (!startedRef.current) return;
    const { index, total } = batchProgressRef.current;
    callbacksRef.current.onProgress(provider === "meta"
      ? Math.min(100, Math.round(((index * 100) + progress) / Math.max(1, total)))
      : progress);
  }, [progress, provider]);

  return null;
}
