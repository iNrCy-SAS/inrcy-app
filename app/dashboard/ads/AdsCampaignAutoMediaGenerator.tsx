"use client";

import { useEffect, useRef } from "react";

import useMediaGeneration, {
  type MediaGenerationFormat,
  type MediaGenerationResult,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import { adsMediaKindForPlan, googleSearchImagePrompt, shouldGenerateAdsMedia } from "@/lib/adsCampaignMediaPolicy";
import type { AdsCampaignPlan } from "@/lib/adsCampaignPlan";
import type { AdsChannelId } from "@/lib/adsValidation";

type AdsCampaignAutoMediaGeneratorProps = {
  provider: AdsChannelId;
  plan: AdsCampaignPlan;
  onProgress: (progress: number) => void;
  onComplete: (result: MediaGenerationResult) => void;
  onSkip: (reason: string) => void;
  onError: (message: string) => void;
};

function mediaFormatForPlan(plan: AdsCampaignPlan, kind: "image" | "video"): MediaGenerationFormat {
  if (kind === "video") return plan.campaignType === "video" ? "landscape" : "story";
  if (plan.campaignType.startsWith("meta_")) return "portrait";
  return "square";
}

function mediaPromptForPlan(provider: AdsChannelId, plan: AdsCampaignPlan) {
  const googleSearchImage = provider === "google" && plan.campaignType === "search";
  if (googleSearchImage) {
    return googleSearchImagePrompt(plan);
  }
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
  onSkip,
  onError,
}: AdsCampaignAutoMediaGeneratorProps) {
  const startedRef = useRef(false);
  const settledRef = useRef(false);
  const callbacksRef = useRef({ onProgress, onComplete, onSkip, onError });
  const {
    generate,
    acceptDraft,
    cancelGeneration,
    progress,
  } = useMediaGeneration();

  // The parent updates its progress UI while generation runs. Keep the latest
  // callbacks without restarting (or cancelling) the paid Studio operation.
  useEffect(() => {
    callbacksRef.current = { onProgress, onComplete, onSkip, onError };
  }, [onComplete, onError, onProgress, onSkip]);

  useEffect(() => {
    if (startedRef.current) return;
    // Deferring the launch by one turn keeps React Strict Mode's development
    // effect rehearsal from spending a media credit then immediately aborting
    // the only generation attempt.
    let disposed = false;
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
      const prompt = mediaPromptForPlan(provider, plan);
      if (prompt.length < 3) {
        settledRef.current = true;
        callbacksRef.current.onError("La campagne est prête, mais il manque une consigne suffisamment précise pour générer son média.");
        return;
      }

      void (async () => {
        try {
          const generated = await generate({
            creationMode: "free",
            freePrompt: prompt,
            kind,
            subjectSource: "custom",
            idea: prompt,
            textKeywords: [],
            format: mediaFormatForPlan(plan, kind),
            imageStyle: "photo",
            peopleMode: "auto",
            useBrandColors: !googleSearchImage,
            logoMode: googleSearchImage ? "none" : "discreet",
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
            callbacksRef.current.onError(
              error instanceof Error
                ? error.message
                : "Le média iNr’Studio n’a pas pu être généré.",
            );
          }
        }
      })();
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      // Closing the campaign studio must not let a background iNr'Studio
      // generation continue and consume a credit after the professional has
      // left the assisted path. A completed result is deliberately preserved.
      if (startedRef.current && !settledRef.current) cancelGeneration();
    };
  }, [acceptDraft, cancelGeneration, generate, plan, provider]);

  useEffect(() => {
    if (startedRef.current) callbacksRef.current.onProgress(progress);
  }, [progress]);

  return null;
}
