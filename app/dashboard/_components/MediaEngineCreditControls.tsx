"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AI_MEDIA_IMAGE_MODELS, AI_MEDIA_VIDEO_MODELS, getAiMediaImageBaseCredits, getAiMediaImageModel, getAiMediaVideoDurations, getAiMediaVideoModel, isAiMediaImageModelCompatible, normalizeAiMediaImageEngine, type AiMediaImageEngine, type AiMediaVideoEngine, type AiMediaVideoResolution, type AiMediaVideoSceneMode } from "@/lib/aiMediaModelCatalog";
import { getAiMediaVideoDurationSceneOptions, type AiMediaVideoDurationSceneOption } from "@/lib/aiMediaVideoTimeline";
import { getMediaVideoEngineQualityChoices, isMediaVideoBriefCompatible } from "@/lib/aiMediaVideoClientOptions";
import type { AiMediaModelRecommendation } from "@/lib/aiMediaModelRecommendation";
import type { MediaGenerationFormat, MediaGenerationQuota } from "../_hooks/useMediaGeneration";
import type useMediaCreditQuote from "../_hooks/useMediaCreditQuote";
import styles from "./MediaEngineCreditControls.module.css";

type Props = {
  kind: "image" | "video";
  videoEngine: AiMediaVideoEngine;
  imageEngine: AiMediaImageEngine;
  format?: MediaGenerationFormat;
  operation?: "generate" | "modify";
  resolution: AiMediaVideoResolution;
  referenceCount: number;
  durationSeconds?: number;
  sceneMode?: AiMediaVideoSceneMode;
  videoMaxDurationSeconds?: number;
  onDurationSceneChange?: (seconds: number, mode: AiMediaVideoSceneMode) => void;
  recommendation?: AiMediaModelRecommendation | null;
  brief?: string;
  disabled: boolean;
  onVideoEngineChange: (engine: AiMediaVideoEngine, resolution?: AiMediaVideoResolution) => void;
  onImageEngineChange: (engine: AiMediaImageEngine) => void;
  onResolutionChange: (resolution: AiMediaVideoResolution) => void;
};

function closestDurationSceneOption(options: readonly AiMediaVideoDurationSceneOption[], duration: number, mode: AiMediaVideoSceneMode) {
  return [...options].sort((first, second) => Math.abs(first.durationSeconds - duration) - Math.abs(second.durationSeconds - duration)
    || Number(first.sceneMode !== mode) - Number(second.sceneMode !== mode)
    || first.durationSeconds - second.durationSeconds || first.sceneCount - second.sceneCount)[0];
}

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

function MediaEngineInfoModal({ kind, activeEngine, format, onClose }: { kind: "image" | "video"; activeEngine: string; format?: MediaGenerationFormat; onClose: () => void }) {
  const t = useTranslations("media");
  const locale = useLocale();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialogRef} className={styles.engineInfoDialog} aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
    onKeyDown={(event) => {
      event.stopPropagation();
      // This read-only guide has one focusable control; keep Tab inside it.
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    }}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClick={(event) => {
      event.stopPropagation();
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className={styles.engineInfoHeader}>
      <h2 id={titleId}>{t(kind === "video" ? "ai_generator_engine_info_video_title" : "ai_generator_engine_info_image_title")}</h2>
      <button ref={closeRef} type="button" className={styles.engineInfoClose} onClick={onClose} aria-label={t("ai_generator_engine_info_close")}>×</button>
    </header>
    <div className={styles.engineInfoBody}>
      <p id={descriptionId} className={styles.engineInfoIntro}>{t("ai_generator_engine_info_intro")}</p>
      <div className={styles.engineInfoGrid}>
        {kind === "video" ? AI_MEDIA_VIDEO_MODELS.map((option) => <section key={option.id} className={styles.engineInfoCard} data-active={option.id === activeEngine}>
          <div className={styles.engineInfoCardHeading}><h3>{option.label}</h3>{option.id === activeEngine ? <span>{t("ai_generator_engine_info_selected")}</span> : null}</div>
          <p>{t(`ai_generator_model_description_${option.id}`)}</p>
          <ul className={styles.engineInfoRates}>{option.resolutions.map((resolution) => {
            const durations = getAiMediaVideoDurations(option.id, resolution);
            return <li key={resolution}><strong>{resolution}</strong><span>{t("ai_generator_model_credit_rate_short", { credits: number(option.creditsByResolution[resolution] ?? option.creditsPerSecond) })}</span><span>{t("ai_generator_engine_info_max_duration", { seconds: number(Math.max(...durations)) })}</span></li>;
          })}</ul>
          <div className={styles.engineInfoCapabilities}>
            <span>{t(option.supportsTextToVideo ? "ai_generator_engine_info_text_photo" : "ai_generator_engine_info_photo_required")}</span>
            {option.nativeAudio ? <span>{t("ai_generator_engine_info_audio")}</span> : null}
          </div>
        </section>) : AI_MEDIA_IMAGE_MODELS.map((option) => <section key={option.id} className={styles.engineInfoCard} data-active={option.id === activeEngine}>
          <div className={styles.engineInfoCardHeading}><h3>{option.label}</h3>{option.id === activeEngine ? <span>{t("ai_generator_engine_info_selected")}</span> : null}</div>
          <p>{t(`ai_generator_engine_info_image_${option.id}`)}</p>
          <strong className={styles.engineInfoImageRate}>{t("ai_generator_model_image_credits", { credits: number(getAiMediaImageBaseCredits(option.id, format)) })}</strong>
          <div className={styles.engineInfoCapabilities}>
            <span>{t(option.supportsModify ? "ai_generator_image_creation_editing" : "ai_generator_image_generation_only")}</span>
            <span>{option.supportsReferences ? t("ai_generator_model_reference_limit", { count: option.maxReferenceImages }) : t("ai_generator_image_references_unavailable")}</span>
          </div>
          {option.transport === "gateway-image" ? <p>{t("ai_generator_engine_info_logo_overlay")}</p> : null}
        </section>)}
      </div>
      <p className={styles.engineInfoNote}>{t(kind === "video" ? "ai_generator_engine_info_cost_note" : "ai_generator_image_model_hint")}</p>
      {kind === "video" ? <p className={styles.engineInfoNote}>{t("ai_generator_engine_info_settings_note")}</p> : null}
    </div>
  </dialog>;
}

export default function MediaEngineCreditControls(props: Props) {
  const t = useTranslations("media");
  const locale = useLocale();
  const id = useId();
  const [infoOpen, setInfoOpen] = useState(false);
  const [durationNotice, setDurationNotice] = useState("");
  const imageSelectable = (engine: AiMediaImageEngine) => isAiMediaImageModelCompatible({ engine, operation: props.operation ?? "generate", inspirationImagesCount: props.referenceCount });
  const imageCompatibilityReason = (engine: AiMediaImageEngine) => {
    const option = getAiMediaImageModel(engine);
    if (props.operation === "modify" && !option.supportsModify) return t("ai_generator_image_generation_only");
    if (props.referenceCount && !option.supportsReferences) return t("ai_generator_image_references_unavailable");
    if (props.referenceCount > option.maxReferenceImages) return t("ai_generator_model_reference_limit", { count: option.maxReferenceImages });
    return "";
  };
  const model = getAiMediaVideoModel(props.videoEngine);
  const selectedResolution = model.resolutions.includes(props.resolution) ? props.resolution : model.defaultResolution;
  const compatible = props.kind !== "video" || isMediaVideoReferenceCompatible(props.videoEngine, props.referenceCount);
  const duration = props.durationSeconds ?? 8;
  const sceneMode = props.sceneMode ?? "single";
  const maximumDuration = props.videoMaxDurationSeconds ?? 30;
  const durationSceneOptions = getAiMediaVideoDurationSceneOptions(props.videoEngine, selectedResolution).filter((option) => option.durationSeconds <= maximumDuration);
  const changeDurationScene = props.onDurationSceneChange;
  useEffect(() => {
    if (props.kind !== "video" || !changeDurationScene) return;
    const options = getAiMediaVideoDurationSceneOptions(props.videoEngine, selectedResolution).filter((option) => option.durationSeconds <= maximumDuration);
    if (options.some((option) => option.durationSeconds === duration && option.sceneMode === sceneMode)) return;
    const next = closestDurationSceneOption(options, duration, sceneMode);
    if (next) changeDurationScene(next.durationSeconds, next.sceneMode);
  }, [props.kind, props.videoEngine, selectedResolution, maximumDuration, duration, sceneMode, changeDurationScene]);
  const choices = getMediaVideoEngineQualityChoices();
  const pairSelectable = (engine: AiMediaVideoEngine, resolution: AiMediaVideoResolution) =>
    getAiMediaVideoModel(engine).resolutions.includes(resolution) && isMediaVideoReferenceCompatible(engine, props.referenceCount) && isMediaVideoBriefCompatible(engine, props.brief ?? "");
  const selectable = (engine: AiMediaVideoEngine) => isMediaVideoReferenceCompatible(engine, props.referenceCount) && isMediaVideoBriefCompatible(engine, props.brief ?? "");
  const recommended = (props.kind === "video" ? AI_MEDIA_VIDEO_MODELS : AI_MEDIA_IMAGE_MODELS).find((option) => option.id === props.recommendation?.engine);
  const recommendedPairs = choices.filter((choice) => choice.engine === props.recommendation?.engine && pairSelectable(choice.engine, choice.resolution));
  const recommendedPair = recommendedPairs.find((choice) => choice.resolution === getAiMediaVideoModel(choice.engine).defaultResolution) ??
    recommendedPairs.sort((first, second) => first.creditsPerSecond - second.creditsPerSecond)[0];
  const selectDescription = [
    !isMediaVideoBriefCompatible(props.videoEngine, props.brief ?? "") ? t("ai_generator_engine_brief_too_long") : "",
    recommended && props.recommendation ? t("ai_generator_model_recommendation", { model: recommended.label, reason: t(`ai_generator_model_recommendation_${props.recommendation.reason}`) }) : "",
  ].filter(Boolean).join(" ");
  const selectVideoPair = (engine: AiMediaVideoEngine, resolution: AiMediaVideoResolution) => {
    if (!pairSelectable(engine, resolution)) return;
    const options = getAiMediaVideoDurationSceneOptions(engine, resolution).filter((option) => option.durationSeconds <= maximumDuration);
    const next = closestDurationSceneOption(options, duration, sceneMode);
    if (next && (next.durationSeconds !== duration || next.sceneMode !== sceneMode)) {
      changeDurationScene?.(next.durationSeconds, next.sceneMode);
      setDurationNotice(t("ai_generator_duration_adjusted", { model: getAiMediaVideoModel(engine).label, seconds: next.durationSeconds, scenes: t(`ai_generator_free_scene_${next.sceneMode}`) }));
    } else setDurationNotice("");
    // The preference update is atomic; a second update based on stale state would restore the old engine.
    if (engine === props.videoEngine) props.onResolutionChange(resolution);
    else props.onVideoEngineChange(engine, resolution);
  };
  return <><fieldset className={styles.controls} disabled={props.disabled} data-media-engine-controls data-kind={props.kind}>
    <legend className={styles.visuallyHidden}>{t("ai_generator_media_engine")}</legend>
    <div className={styles.engineField}>
    <div className={styles.engineLabel}><label htmlFor={`${id}-engine`}>{t(props.kind === "video" ? "ai_generator_engine_quality_label" : "ai_generator_media_engine_choice")}</label><button type="button" className={styles.engineInfoTrigger} aria-label={t("ai_generator_engine_info_open")} title={t("ai_generator_engine_info_open")} aria-haspopup="dialog" aria-expanded={infoOpen} onClick={() => setInfoOpen(true)}><span aria-hidden="true">i</span></button></div>
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
    </select> : <select id={`${id}-engine`} value={props.imageEngine} title={imageCompatibilityReason(props.imageEngine) || undefined} onChange={(event) => { const engine = normalizeAiMediaImageEngine(event.target.value); if (engine && imageSelectable(engine)) props.onImageEngineChange(engine); }}>
      {AI_MEDIA_IMAGE_MODELS.map((option) => <option key={option.id} value={option.id} disabled={!imageSelectable(option.id)}>{option.label} · {t("ai_generator_model_image_credits", { credits: new Intl.NumberFormat(locale).format(getAiMediaImageBaseCredits(option.id, props.format)) })}{!imageSelectable(option.id) ? ` · ${imageCompatibilityReason(option.id)}` : ""}{props.recommendation?.engine === option.id ? ` · ${t("ai_generator_model_recommended_short")}` : ""}</option>)}
    </select>}
    </div>
    {props.kind === "video" ? <div className={styles.durationField}>
      <label htmlFor={`${id}-duration`}>{t("ai_generator_free_duration_label")}</label>
      <select id={`${id}-duration`} value={`${duration}:${sceneMode}`} onChange={(event) => {
        const option = durationSceneOptions.find((candidate) => `${candidate.durationSeconds}:${candidate.sceneMode}` === event.target.value);
        if (option) { changeDurationScene?.(option.durationSeconds, option.sceneMode); setDurationNotice(""); }
      }}>
        {durationSceneOptions.map((option) => <option key={`${option.durationSeconds}:${option.sceneMode}`} value={`${option.durationSeconds}:${option.sceneMode}`}>{t(option.sceneMode === "single" ? "ai_generator_duration_scene_single" : "ai_generator_duration_scene_multi", { seconds: option.durationSeconds })}</option>)}
      </select>
      <span className={styles.visuallyHidden} role="status" aria-live="polite">{durationNotice}</span>
    </div> : null}
    {props.kind === "video" ? <>
      {!compatible ? <p className={styles.notice} role="status">{t(props.referenceCount === 0 && !model.supportsTextToVideo ? "ai_generator_model_photo_required" : !model.supportsImageToVideo ? "ai_generator_model_text_only" : "ai_generator_model_reference_limit", { count: model.maxReferenceImages })}</p> : null}
      {!isMediaVideoBriefCompatible(props.videoEngine, props.brief ?? "") ? <p className={styles.notice} role="status">{t("ai_generator_engine_brief_too_long")}</p> : null}
    </> : null}
    {recommended && props.recommendation && (props.kind === "image" || selectable(recommended.id as AiMediaVideoEngine)) ? <small className={styles.recommendation} title={t("ai_generator_model_recommendation", { model: recommended.label, reason: t(`ai_generator_model_recommendation_${props.recommendation.reason}`) })}>{t("ai_generator_model_recommendation", { model: recommended.label, reason: t(`ai_generator_model_recommendation_${props.recommendation.reason}`) })}</small> : null}
  </fieldset>{infoOpen ? <MediaEngineInfoModal kind={props.kind} activeEngine={props.kind === "video" ? props.videoEngine : props.imageEngine} format={props.format} onClose={() => setInfoOpen(false)} /> : null}</>;
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
