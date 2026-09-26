"use client";

import { useEffect, useRef } from "react";

import useMediaGeneration, {
  type MediaGenerationFormat,
  type MediaGenerationKind,
  type MediaGenerationResult,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import type { AdsCampaignPlan } from "@/lib/adsCampaignPlan";

type AdsCampaignAutoMediaGeneratorProps = {
  plan: AdsCampaignPlan;
  onProgress: (progress: number) => void;
  onComplete: (result: MediaGenerationResult) => void;
  onSkip: (reason: string) => void;
  onError: (message: string) => void;
};

function shouldGenerateMedia(plan: AdsCampaignPlan) {
  return plan.mediaStrategy !== "search_text" && plan.mediaStrategy !== "product_feed";
}

function mediaKindForPlan(plan: AdsCampaignPlan): MediaGenerationKind {
  return plan.mediaStrategy === "video" || plan.creativeType === "video"
    ? "video"
    : "image";
}

function mediaFormatForPlan(plan: AdsCampaignPlan, kind: MediaGenerationKind): MediaGenerationFormat {
  if (kind === "video") return plan.campaignType === "video" ? "landscape" : "story";
  if (plan.campaignType.startsWith("meta_")) return "portrait";
  return "square";
}

function mediaPromptForPlan(plan: AdsCampaignPlan) {
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

      if (!shouldGenerateMedia(plan)) {
        settledRef.current = true;
        callbacksRef.current.onSkip(
          plan.mediaStrategy === "search_text"
            ? "Ce format repose sur des annonces textuelles : iNrCy n’utilise pas de crédit média inutilement."
            : "Ce format attend un flux produits : iNrCy conserve le brief média, sans générer un visuel qui ne serait pas utilisé.",
        );
        return;
      }

      const kind = mediaKindForPlan(plan);
      const prompt = mediaPromptForPlan(plan);
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
            useBrandColors: true,
            logoMode: "discreet",
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
  }, [acceptDraft, cancelGeneration, generate, plan]);

  useEffect(() => {
    if (startedRef.current) callbacksRef.current.onProgress(progress);
  }, [progress]);

  return null;
}
