"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import useMediaGeneration, {
  MediaGenerationAccountChangedError,
  type MediaGenerationKind,
  type MediaGenerationResult,
  type MediaGenerationSource,
  type MediaGenerationSubjectSource,
} from "@/app/dashboard/_hooks/useMediaGeneration";

import styles from "./MediaGenerator.module.css";

export type MediaGeneratorOrigin = "menu" | "booster" | "inrsend";
export type MediaGeneratorAcceptMode = "library" | "insert";

type MediaGeneratorProps = {
  source: MediaGenerationSource;
  origin: MediaGeneratorOrigin;
  publicationBrief?: string;
  acceptMode: MediaGeneratorAcceptMode;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onResultChange?: (result: MediaGenerationResult | null) => void;
  onBusyChange?: (busy: boolean) => void;
};

export default function MediaGenerator({
  source,
  origin,
  publicationBrief = "",
  acceptMode,
  onAccepted,
  onResultChange,
  onBusyChange,
}: MediaGeneratorProps) {
  const t = useTranslations("media");
  const locale = useLocale();
  const {
    quota,
    progress,
    error,
    result: generationResult,
    originChangedNotice,
    busy: generationBusy,
    quotaLoading,
    loadQuota,
    generate,
    acceptDraft,
    discardDraft,
    reset,
  } = useMediaGeneration();
  const normalizedPublicationBrief = String(publicationBrief || "").trim();
  const publicationAvailable = normalizedPublicationBrief.length >= 3;
  const [subjectSource, setSubjectSource] =
    useState<MediaGenerationSubjectSource | null>(null);
  const [customIdea, setCustomIdea] = useState("");
  const [kind, setKind] = useState<MediaGenerationKind | null>(null);
  const [withText, setWithText] = useState(true);
  const [withMusic, setWithMusic] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [actionError, setActionError] = useState("");
  const generationSequenceRef = useRef(0);
  const acceptInFlightRef = useRef(false);
  const busy = generationBusy || discarding;
  const operationLocked = busy || finishing;

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  useLayoutEffect(() => {
    onBusyChange?.(operationLocked);
    return () => onBusyChange?.(false);
  }, [onBusyChange, operationLocked]);

  useLayoutEffect(() => {
    onResultChange?.(generationResult);
  }, [generationResult, onResultChange]);

  const resolvedIdea =
    subjectSource === "publication"
      ? normalizedPublicationBrief
      : subjectSource === "custom"
        ? customIdea.trim()
        : "";
  const subjectReady = Boolean(
    subjectSource === "profile" ||
      (subjectSource === "publication" && publicationAvailable) ||
      (subjectSource === "custom" && resolvedIdea.length >= 3),
  );
  const counter = kind ? quota?.[kind] || null : null;
  const exhausted = counter?.remaining === 0;
  const disabled =
    operationLocked || !subjectReady || !kind || Boolean(exhausted);
  const reviewingResult = Boolean(generationResult);

  const resetDate = useMemo(() => {
    if (!quota?.resetAt) return "";
    const parsed = new Date(quota.resetAt);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
    }).format(parsed);
  }, [locale, quota?.resetAt]);

  const progressLabel =
    progress >= 99
      ? t("ai_generator_stage_patience")
      : progress < 20
        ? t("ai_generator_stage_brief")
        : progress < 55
          ? t(
              kind === "video"
                ? "ai_generator_stage_video"
                : "ai_generator_stage_image",
            )
          : t("ai_generator_stage_finish");

  const clearTransientState = () => {
    reset();
    setActionError("");
  };

  const chooseSubject = (next: MediaGenerationSubjectSource) => {
    if (operationLocked || next === subjectSource) return;
    clearTransientState();
    setSubjectSource(next);
  };

  const chooseKind = (next: MediaGenerationKind) => {
    if (operationLocked || next === kind) return;
    clearTransientState();
    setKind(next);
  };

  const handleGenerate = async () => {
    if (!kind || !subjectSource || !subjectReady) return;
    const sequence = generationSequenceRef.current + 1;
    generationSequenceRef.current = sequence;
    setActionError("");

    if (generationResult?.draft) {
      setDiscarding(true);
      try {
        await discardDraft(generationResult);
        onResultChange?.(null);
      } catch (caught) {
        if (sequence !== generationSequenceRef.current) return;
        setActionError(
          caught instanceof Error ? caught.message : t("ai_generator_error"),
        );
        return;
      } finally {
        setDiscarding(false);
      }
    }

    try {
      await generate({
        source,
        kind,
        subjectSource,
        idea: resolvedIdea,
        withText: kind === "image" ? withText : undefined,
        withMusic: kind === "video" ? withMusic : undefined,
      });
    } catch (caught) {
      if (sequence !== generationSequenceRef.current) return;
      if (caught instanceof MediaGenerationAccountChangedError) {
        setActionError("");
        return;
      }
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error"),
      );
    }
  };

  const handleConfirm = async () => {
    if (!generationResult || operationLocked || acceptInFlightRef.current) return;
    acceptInFlightRef.current = true;
    setActionError("");
    setFinishing(true);
    try {
      // Promotion is server-idempotent. Only the promoted library item is
      // handed to Booster/iNrSend (or used to open the library from Menu).
      const result = await acceptDraft(generationResult);
      onResultChange?.(result);
      await onAccepted(result);
    } catch (caught) {
      if (caught instanceof MediaGenerationAccountChangedError) {
        setActionError("");
        return;
      }
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error"),
      );
    } finally {
      acceptInFlightRef.current = false;
      setFinishing(false);
    }
  };

  const quotaValue =
    quotaLoading && !counter
      ? t("chargement_01cba1df")
      : counter?.limit === null || !counter
        ? "—"
        : `${counter.used + counter.reserved} / ${counter.limit}`;

  const subjectChoices: Array<{
    id: MediaGenerationSubjectSource;
    title: string;
    description: string;
    disabled?: boolean;
  }> = [
    {
      id: "publication",
      title: t("ai_generator_subject_publication"),
      description: t(
        publicationAvailable
          ? "ai_generator_subject_publication_hint"
          : "ai_generator_subject_publication_unavailable",
      ),
      disabled: !publicationAvailable,
    },
    {
      id: "profile",
      title: t("ai_generator_subject_profile"),
      description: t("ai_generator_subject_profile_hint"),
    },
    {
      id: "custom",
      title: t("ai_generator_subject_custom"),
      description: t("ai_generator_subject_custom_hint"),
    },
  ];

  return (
    <div className={styles.generator} data-origin={origin}>
      {!reviewingResult ? (
        <div className={styles.steps}>
          <section className={styles.stepCard}>
            <div className={styles.stepHeading}>
              <span>1</span>
              <div>
                <strong>{t("ai_generator_step_subject")}</strong>
                <small>{t("ai_generator_step_subject_hint")}</small>
              </div>
            </div>
            <div
              className={styles.subjectChoices}
              role="radiogroup"
              aria-label={t("ai_generator_step_subject")}
            >
              {subjectChoices.map((choice) => {
                const selected = subjectSource === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`${styles.choiceCard} ${selected ? styles.choiceCardActive : ""}`}
                    disabled={busy || finishing || choice.disabled}
                    onClick={() => chooseSubject(choice.id)}
                  >
                    <span className={styles.choiceCheck} aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                    <strong>{choice.title}</strong>
                    <small>{choice.description}</small>
                  </button>
                );
              })}
            </div>
            {subjectSource === "custom" ? (
              <label className={styles.customField}>
                <span>{t("ai_generator_custom_label")}</span>
                <textarea
                  autoFocus
                  value={customIdea}
                  onChange={(event) => {
                    setCustomIdea(event.target.value);
                    if (actionError || error) clearTransientState();
                  }}
                  placeholder={t("ai_generator_custom_placeholder")}
                  maxLength={1_600}
                  disabled={operationLocked}
                  rows={3}
                />
                {customIdea.trim().length > 0 &&
                customIdea.trim().length < 3 ? (
                  <small>{t("ai_generator_custom_too_short")}</small>
                ) : null}
              </label>
            ) : null}
          </section>

          <section
            className={`${styles.stepCard} ${!subjectReady ? styles.stepCardDisabled : ""}`}
            data-disabled={!subjectReady || undefined}
          >
            <div className={styles.stepHeading}>
              <span>2</span>
              <div>
                <strong>{t("ai_generator_step_kind")}</strong>
                <small>{t("ai_generator_step_kind_hint")}</small>
              </div>
            </div>
            <div
              className={styles.kindChoices}
              role="radiogroup"
              aria-label={t("ai_generator_kind_label")}
            >
              {(["image", "video"] as const).map((option) => {
                const selected = kind === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`${styles.kindChoice} ${selected ? styles.kindChoiceActive : ""}`}
                    disabled={!subjectReady || operationLocked}
                    onClick={() => chooseKind(option)}
                  >
                    <span aria-hidden="true">
                      {option === "image" ? "✦" : "▶"}
                    </span>
                    {t(
                      option === "image"
                        ? "image_50e19fda"
                        : "video_304f6ca4",
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className={`${styles.stepCard} ${!kind ? styles.stepCardDisabled : ""}`}
            data-disabled={!kind || undefined}
          >
            <div className={styles.stepHeading}>
              <span>3</span>
              <div>
                <strong>{t("ai_generator_step_option")}</strong>
                <small>
                  {kind
                    ? t(
                        kind === "image"
                          ? "ai_generator_image_format"
                          : "ai_generator_video_format",
                      )
                    : t("ai_generator_step_option_hint")}
                </small>
              </div>
            </div>
            {kind ? (
              <div
                className={styles.optionChoices}
                role="radiogroup"
                aria-label={t(
                  kind === "image"
                    ? "ai_generator_text_option"
                    : "ai_generator_music_option",
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={kind === "image" ? withText : withMusic}
                  className={
                    (kind === "image" ? withText : withMusic)
                      ? styles.optionChoiceActive
                      : ""
                  }
                  disabled={operationLocked}
                  onClick={() =>
                    kind === "image" ? setWithText(true) : setWithMusic(true)
                  }
                >
                  {t(
                    kind === "image"
                      ? "ai_generator_with_text"
                      : "ai_generator_with_music",
                  )}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={kind === "image" ? !withText : !withMusic}
                  className={
                    (kind === "image" ? !withText : !withMusic)
                      ? styles.optionChoiceActive
                      : ""
                  }
                  disabled={operationLocked}
                  onClick={() =>
                    kind === "image"
                      ? setWithText(false)
                      : setWithMusic(false)
                  }
                >
                  {t(
                    kind === "image"
                      ? "ai_generator_without_text"
                      : "ai_generator_without_music",
                  )}
                </button>
              </div>
            ) : (
              <div className={styles.optionPlaceholder} aria-hidden="true" />
            )}
          </section>
        </div>
      ) : null}

      {kind ? (
        <div className={styles.quotaCard}>
          <div>
            <span className={styles.quotaLabel}>
              {t(
                kind === "image"
                  ? "ai_generator_image_quota"
                  : "ai_generator_video_quota",
              )}
            </span>
            <strong>{quotaValue}</strong>
          </div>
          <div className={styles.quotaMeta}>
            {counter?.remaining !== null && counter
              ? t("ai_generator_remaining", { count: counter.remaining })
              : t("ai_generator_monthly_quota")}
            {resetDate ? (
              <small>{t("ai_generator_reset", { date: resetDate })}</small>
            ) : null}
          </div>
        </div>
      ) : null}

      {kind && !reviewingResult ? (
        <div className={styles.timingNotice} role="note">
          <span aria-hidden="true">◷</span>
          {t(
            kind === "video"
              ? "ai_generator_video_timing_hint"
              : "ai_generator_image_timing_hint",
          )}
        </div>
      ) : null}

      {busy || finishing ? (
        <div className={styles.progressCard} role="status" aria-live="polite">
          <div className={styles.progressHeading}>
            <span>
              {finishing
                ? t(
                    acceptMode === "insert"
                      ? "ai_generator_inserting"
                      : "ai_generator_finishing_library",
                  )
                : progressLabel}
            </span>
            <strong>{finishing ? "100 %" : `${progress} %`}</strong>
          </div>
          <div className={styles.progressTrack} aria-hidden="true">
            <span style={{ width: `${finishing ? 100 : progress}%` }} />
          </div>
          <small>{t("ai_generator_keep_open")}</small>
        </div>
      ) : null}

      {actionError || error ? (
        <div className={styles.error} role="alert">
          {actionError || error}
        </div>
      ) : null}

      {exhausted ? (
        <div className={styles.warning} role="status">
          {t("ai_generator_quota_reached")}
        </div>
      ) : null}

      {originChangedNotice ? (
        <div className={styles.warning} role="status">
          {t("ai_generator_origin_changed")}
        </div>
      ) : null}

      {generationResult ? (
        <div className={styles.resultCard}>
          <div className={styles.savedStatus} role="status">
            <span aria-hidden="true">◷</span>
            {t("ai_generator_saved_automatically")}
          </div>
          <div className={styles.previewFrame}>
            {generationResult.item.signed_url ? (
              generationResult.item.media_type === "video" ? (
                <video
                  src={generationResult.item.signed_url}
                  controls
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img
                  src={generationResult.item.signed_url}
                  alt={generationResult.item.title || t("ai_generator_preview_alt")}
                />
              )
            ) : (
              <span>{t("apercu_indisponible_d0ce704a")}</span>
            )}
          </div>
          <div className={styles.resultActions}>
            <button
              type="button"
              className={styles.confirmButton}
              onClick={() => void handleConfirm()}
              disabled={operationLocked}
            >
              {finishing
                ? t(
                    acceptMode === "insert"
                      ? "ai_generator_inserting"
                      : "ai_generator_finishing_library",
                  )
                : t(
                    acceptMode === "insert"
                      ? "ai_generator_confirm_insert"
                      : "ai_generator_open_library",
                  )}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleGenerate()}
              disabled={disabled}
            >
              {t("ai_generator_regenerate")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.generateButton}
          disabled={disabled}
          onClick={() => void handleGenerate()}
        >
          <span aria-hidden="true">✦</span>
          {busy
            ? t("ai_generator_generating")
            : kind === "video"
              ? t("ai_generator_generate_video")
              : kind === "image"
                ? t("ai_generator_generate_image")
                : t("ai_generator_generate_media")}
        </button>
      )}
    </div>
  );
}
