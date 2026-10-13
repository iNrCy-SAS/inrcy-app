"use client";

import { useId, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AI_MEDIA_IMAGE_MODELS, AI_MEDIA_VIDEO_MODELS, getAiMediaVideoModel, type AiMediaVideoEngine, type AiMediaVideoResolution, type AiMediaVideoSceneMode } from "@/lib/aiMediaModelCatalog";
import { canGenerateAiMediaVideoDuration } from "@/lib/aiMediaVideoTimeline";
import { getCompatibleMediaVideoResolution, getMediaVideoEngineQualityChoices, isMediaVideoBriefCompatible } from "@/lib/aiMediaVideoClientOptions";
import type { AiMediaModelRecommendation } from "@/lib/aiMediaModelRecommendation";
import type { MediaGenerationQuota } from "../_hooks/useMediaGeneration";
import type useMediaCreditQuote from "../_hooks/useMediaCreditQuote";
import styles from "./MediaEngineCreditControls.module.css";

type Props = {
  kind: "image" | "video";
  videoEngine: AiMediaVideoEngine;
  imageEngine: "openai" | "gemini";
  resolution: AiMediaVideoResolution;
  referenceCount: number;
  durationSeconds?: number;
  sceneMode?: AiMediaVideoSceneMode;
  recommendation?: AiMediaModelRecommendation | null;
  brief?: string;
  disabled: boolean;
  onVideoEngineChange: (engine: AiMediaVideoEngine, resolution?: AiMediaVideoResolution) => void;
  onImageEngineChange: (engine: "openai" | "gemini") => void;
  onResolutionChange: (resolution: AiMediaVideoResolution) => void;
};

export function isMediaVideoReferenceCompatible(engine: AiMediaVideoEngine, referenceCount: number) {
  const model = getAiMediaVideoModel(engine);
  // Studio composes all supplied references into one source frame before animation.
  return referenceCount === 0 ? model.supportsTextToVideo : model.supportsImageToVideo;
}

export function MediaVideoDurationSelect({ value, durations, disabled, onChange, hideLabel }: { value: number; durations: readonly number[]; disabled: boolean; onChange: (value: number) => void; hideLabel?: boolean }) {
  const t = useTranslations("media");
  const id = useId();
  return <div className={styles.duration}>
    <label htmlFor={id} className={hideLabel ? styles.visuallyHidden : undefined}>{t("ai_generator_free_duration_label")}</label>
    <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
      {durations.map((duration) => <option key={duration} value={duration}>{t("ai_generator_duration_seconds", { seconds: duration })}</option>)}
    </select>
  </div>;
}

export default function MediaEngineCreditControls(props: Props) {
  const t = useTranslations("media");
  const locale = useLocale();
  const id = useId();
  const model = getAiMediaVideoModel(props.videoEngine);
  const selectedResolution = model.resolutions.includes(props.resolution) ? props.resolution : model.defaultResolution;
  const compatible = props.kind !== "video" || isMediaVideoReferenceCompatible(props.videoEngine, props.referenceCount);
  const duration = props.durationSeconds ?? 8;
  const sceneMode = props.sceneMode ?? "single";
  const choices = getMediaVideoEngineQualityChoices();
  const pairSelectable = (engine: AiMediaVideoEngine, resolution: AiMediaVideoResolution) =>
    isMediaVideoReferenceCompatible(engine, props.referenceCount) && isMediaVideoBriefCompatible(engine, props.brief ?? "") && canGenerateAiMediaVideoDuration(engine, duration, resolution, sceneMode);
  const availableResolution = (engine: AiMediaVideoEngine) => getCompatibleMediaVideoResolution(engine, duration, selectedResolution, sceneMode);
  const selectable = (engine: AiMediaVideoEngine) => isMediaVideoReferenceCompatible(engine, props.referenceCount) && isMediaVideoBriefCompatible(engine, props.brief ?? "") && availableResolution(engine) !== null;
  const durationCompatible = canGenerateAiMediaVideoDuration(props.videoEngine, duration, selectedResolution, sceneMode);
  const suggestedModel = AI_MEDIA_VIDEO_MODELS.find((option) => selectable(option.id));
  const recommended = (props.kind === "video" ? AI_MEDIA_VIDEO_MODELS : AI_MEDIA_IMAGE_MODELS).find((option) => option.id === props.recommendation?.engine);
  const recommendedPairs = choices.filter((choice) => choice.engine === props.recommendation?.engine && pairSelectable(choice.engine, choice.resolution));
  const recommendedPair = recommendedPairs.find((choice) => choice.resolution === getAiMediaVideoModel(choice.engine).defaultResolution) ??
    recommendedPairs.sort((first, second) => first.creditsPerSecond - second.creditsPerSecond)[0];
  const selectDescription = [
    !durationCompatible ? t("ai_generator_model_duration_unavailable", { seconds: duration }) : "",
    !isMediaVideoBriefCompatible(props.videoEngine, props.brief ?? "") ? t("ai_generator_engine_brief_too_long") : "",
    recommended && props.recommendation ? t("ai_generator_model_recommendation", { model: recommended.label, reason: t(`ai_generator_model_recommendation_${props.recommendation.reason}`) }) : "",
  ].filter(Boolean).join(" ");
  const selectVideoPair = (engine: AiMediaVideoEngine, resolution: AiMediaVideoResolution) => {
    if (!pairSelectable(engine, resolution)) return;
    // The preference update is atomic; a second update based on stale state would restore the old engine.
    if (engine === props.videoEngine) props.onResolutionChange(resolution);
    else props.onVideoEngineChange(engine, resolution);
  };
  const selectVideoEngine = (engine: AiMediaVideoEngine) => {
    const resolution = availableResolution(engine);
    if (resolution && selectable(engine)) selectVideoPair(engine, resolution);
  };
  return <fieldset className={styles.controls} disabled={props.disabled} data-media-engine-controls>
    <legend className={styles.visuallyHidden}>{t("ai_generator_media_engine")}</legend>
    <div className={styles.engineField}>
    <label htmlFor={`${id}-engine`}>{t(props.kind === "video" ? "ai_generator_engine_quality_label" : "ai_generator_media_engine_choice")}</label>
    {props.kind === "video" ? <select id={`${id}-engine`} value={`${props.videoEngine}:${selectedResolution}`} title={selectDescription || undefined} onChange={(event) => {
      const choice = choices.find((option) => option.value === event.target.value);
      if (choice) selectVideoPair(choice.engine, choice.resolution);
    }}>
      {(["Google", "MiniMax", "Alibaba", "Grok"] as const).map((family) => <optgroup key={family} label={family}>
        {choices.filter((option) => option.family === family).map((option) => <option key={option.value} value={option.value} disabled={!pairSelectable(option.engine, option.resolution)}>
          {option.label} · {option.resolution} · {t("ai_generator_model_credit_rate_short", { credits: new Intl.NumberFormat(locale).format(option.creditsPerSecond) })}
          {!pairSelectable(option.engine, option.resolution) ? ` · ${t(isMediaVideoBriefCompatible(option.engine, props.brief ?? "") ? "ai_generator_model_unavailable_short" : "ai_generator_engine_brief_too_long")}` : ""}
          {recommendedPair?.value === option.value ? ` · ${t("ai_generator_model_recommended_short")}` : ""}
        </option>)}
      </optgroup>)}
    </select> : <select id={`${id}-engine`} value={props.imageEngine} onChange={(event) => props.onImageEngineChange(event.target.value as "openai" | "gemini")}>
      {AI_MEDIA_IMAGE_MODELS.map((option) => <option key={option.id} value={option.id}>{option.label}{props.recommendation?.engine === option.id ? ` · ${t("ai_generator_model_recommended_short")}` : ""}</option>)}
    </select>}
    </div>
    {props.kind === "video" ? <>
      {!compatible ? <p className={styles.notice} role="status">{t(props.referenceCount === 0 && !model.supportsTextToVideo ? "ai_generator_model_photo_required" : !model.supportsImageToVideo ? "ai_generator_model_text_only" : "ai_generator_model_reference_limit", { count: model.maxReferenceImages })}</p> : null}
      {!isMediaVideoBriefCompatible(props.videoEngine, props.brief ?? "") ? <p className={styles.notice} role="status">{t("ai_generator_engine_brief_too_long")}</p> : null}
      {!durationCompatible ? <div className={styles.compatibilityNotice} role="status">
        <small>{t("ai_generator_model_duration_unavailable", { seconds: duration })}</small>
        {suggestedModel ? <button type="button" onClick={() => selectVideoEngine(suggestedModel.id)}>{t("ai_generator_model_choose_compatible", { model: suggestedModel.label })}</button> : null}
      </div> : null}
    </> : null}
    {recommended && props.recommendation && (props.kind === "image" || selectable(recommended.id as AiMediaVideoEngine)) ? <small className={styles.recommendation} title={t("ai_generator_model_recommendation", { model: recommended.label, reason: t(`ai_generator_model_recommendation_${props.recommendation.reason}`) })}>{t("ai_generator_model_recommendation", { model: recommended.label, reason: t(`ai_generator_model_recommendation_${props.recommendation.reason}`) })}</small> : null}
  </fieldset>;
}

/** Model, confirmed price and action stay together in every Studio path. */
export function MediaGenerationActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions} data-media-generation-actions>{children}</div>;
}

export function MediaCreditQuoteSummary({ status, quota }: { status: ReturnType<typeof useMediaCreditQuote>; quota: MediaGenerationQuota | null }) {
  const t = useTranslations("media");
  const locale = useLocale();
  const credits = status.quote?.totalCredits ?? status.estimate?.totalCredits;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const price = typeof credits === "number" ? t("ai_generator_credit_quantity", { credits: number(credits) }) : "—";
  const label = t(status.ready ? "ai_generator_credit_cost" : "ai_generator_credit_estimate");
  return <details className={styles.quote} data-media-credit-details data-confirmed={status.ready}>
    <summary aria-label={`${label} : ${price}`}>
      <span className={styles.priceLabel}>{label}</span>
      <span className={styles.priceValue} role="status" aria-live="polite" aria-busy={status.loading}>
        {price} <span aria-hidden="true">ⓘ</span>
      </span>
    </summary>
    <div className={styles.quoteDetails}>
    {(status.quote?.breakdown ?? status.estimate?.breakdown)?.map((line) => <div key={line.key} className={styles.breakdown}>
      <small>{t(`ai_generator_credit_line_${line.key}`)}</small><small>{t("ai_generator_credit_quantity", { credits: number(line.credits) })}</small>
    </div>)}
    {quota?.creditsReady === false ? <small>{t("ai_generator_credits_unavailable")}</small> : status.loading ? <small>{t("ai_generator_credit_quote_loading")}</small> : !status.ready ? <div><small>{status.error || t("ai_generator_credit_quote_error")}</small><button type="button" onClick={status.retry}>{t("ai_generator_credit_quote_retry")}</button></div> : <>
      {typeof status.remainingAfter === "number" ? <small>{t("ai_generator_credit_after", { credits: number(status.remainingAfter) })}</small> : null}
      <small>{t("ai_generator_credit_charge_hint")}</small>
    </>}
    {status.insufficient ? <p className={styles.notice}>{t("ai_generator_credit_insufficient")}</p> : null}
    </div>
  </details>;
}
