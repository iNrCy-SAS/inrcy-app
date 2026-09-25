"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import useMediaGeneration, {
  MediaGenerationAccountChangedError,
  MediaGenerationCancelledError,
  type MediaGenerationFormat,
  type MediaGenerationInspirationImage,
  type MediaGenerationKind,
  type MediaGenerationNarrationVoice,
  type MediaGenerationNarrationVoiceVariant,
  type MediaGenerationReferenceRole,
  type MediaGenerationReferenceUsage,
  type MediaGenerationResult,
  type MediaGenerationSource,
  type MediaGenerationTeamVideoSpeechMode,
  type MediaGenerationVideoDuration,
  type MediaGenerationVideoSceneMode,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import {
  AI_MEDIA_FREE_PROMPT_MAX_CHARS,
  AI_MEDIA_INSPIRATION_MAX_COUNT,
} from "@/lib/aiMediaGenerationContracts";
import {
  AI_MEDIA_NARRATION_VOICE_VARIANTS,
  defaultAiMediaNarrationVoiceVariant,
} from "@/lib/aiMediaNarrationVoices";
import {
  INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS,
  INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS,
  INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES,
  isInrMediaVideoFile,
} from "@/lib/mediaRules";
import {
  prepareMediaGenerationImageReference,
  prepareVideoReferenceFrame,
} from "@/lib/mediaGenerationReferenceClient";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "./MediaLibraryPickerModal";
import MediaSubjectVoiceButton from "./MediaSubjectVoiceButton";
import MediaGenerationCreationWorkspace from "./MediaGenerationCreationWorkspace";
import styles from "./MediaFreeGenerator.module.css";

type Props = {
  source: MediaGenerationSource;
  acceptMode: "library" | "insert";
  mediaType?: MediaGenerationKind;
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onResultChange?: (result: MediaGenerationResult | null) => void;
  onBusyChange?: (busy: boolean) => void;
};

type Reference = Omit<
  MediaGenerationInspirationImage,
  "role" | "usage"
> & {
  id: string;
  /** Chosen explicitly by the professional before the request is sent. */
  role?: MediaGenerationReferenceRole;
  /** A reference can be authoritative or only steer the creative direction. */
  usage?: MediaGenerationReferenceUsage;
  fromVideo: boolean;
};

const MAX_PROMPT = AI_MEDIA_FREE_PROMPT_MAX_CHARS;
const FORMATS: { id: MediaGenerationFormat; ratio: string }[] = [
  { id: "square", ratio: "1:1" },
  { id: "portrait", ratio: "4:5" },
  { id: "story", ratio: "9:16" },
  { id: "landscape", ratio: "16:9" },
];
const DURATIONS = [8, 16, 24] as const;
const ROLES = ["character", "environment", "product", "inspiration"] as const;
const IMAGE_ACCEPT = [
  ...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");
const VIDEO_ACCEPT = [
  IMAGE_ACCEPT,
  ...INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

function referencesForRequest(references: Reference[]) {
  let characterIndex = 0;
  return references.map(({ id: _id, fromVideo: _fromVideo, ...reference }) => {
    if (reference.role !== "character" || reference.usage !== "required") {
      return reference;
    }
    characterIndex += 1;
    return { ...reference, characterIndex: characterIndex as 1 | 2 | 3 };
  });
}

/** Free creation owns its state and never reads the guided generator's defaults. */
export default function MediaFreeGenerator({
  source,
  acceptMode,
  mediaType = "image",
  onAccepted,
  onResultChange,
  onBusyChange,
}: Props) {
  const t = useTranslations("media");
  const locale = useLocale();
  const instanceId = useId();
  const kind = mediaType;
  const {
    quota,
    quotaLoading,
    busy,
    progress,
    error,
    result,
    originChangedNotice,
    cancellable,
    loadQuota,
    generate,
    cancelGeneration,
    acceptDraft,
    discardDraft,
    reset,
  } = useMediaGeneration();
  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<MediaGenerationFormat>(
    kind === "video" ? "story" : "square"
  );
  const [duration, setDuration] = useState<MediaGenerationVideoDuration>(8);
  const [sceneMode, setSceneMode] = useState<MediaGenerationVideoSceneMode>("single");
  const [references, setReferences] = useState<Reference[]>([]);
  const [withMusic, setWithMusic] = useState(true);
  const [withNarration, setWithNarration] = useState(true);
  const [speechMode, setSpeechMode] =
    useState<MediaGenerationTeamVideoSpeechMode>("voiceover");
  const [voice, setVoice] = useState<MediaGenerationNarrationVoice>("female");
  const [voiceVariant, setVoiceVariant] =
    useState<MediaGenerationNarrationVoiceVariant>("Kore");
  const [identityConsent, setIdentityConsent] = useState(false);
  const [teamConsent, setTeamConsent] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [referencesBusy, setReferencesBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [creationScreen, setCreationScreen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const sequence = useRef(0);
  const operationInFlight = useRef(false);
  const referenceSetId = useRef("");
  const operationLocked = busy || finishing || voiceBusy || referencesBusy;
  const locked = operationLocked || Boolean(result);
  const counter = quota?.[kind];
  const maxDuration = quota?.videoMaxDurationSeconds ?? 8;
  const remainingSeconds = quota?.unlimited
    ? null
    : quota?.video.remaining ?? null;
  const durationUnavailable = kind === "video" && duration > maxDuration;
  const creditInsufficient =
    kind === "video" &&
    remainingSeconds !== null &&
    duration > remainingSeconds;
  const exhausted = !quota?.unlimited && counter?.remaining === 0;
  const personReferences = references.filter(
    (reference) =>
      reference.role === "character" && reference.usage === "required"
  );
  const identityRequired = personReferences.length > 0;
  const teamConsentRequired = kind === "video" && personReferences.length > 1;
  const effectiveWithNarration =
    kind === "video" && speechMode === "voiceover" && withNarration;
  const referenceCriteriaIncomplete = references.some(
    (reference) => !reference.role || !reference.usage
  );
  // Exact identity preservation is limited to three people. Inspiration-only
  // images and all other roles can freely share the five available slots.
  const roleLimitExceeded = personReferences.length > 3;
  const promptReady = prompt.trim().length >= 3 && prompt.length <= MAX_PROMPT;
  const canGenerate =
    !operationLocked &&
    promptReady &&
    Boolean(quota) &&
    !quotaLoading &&
    quota?.studioEnabled !== false &&
    !exhausted &&
    !durationUnavailable &&
    !creditInsufficient &&
    !referenceCriteriaIncomplete &&
    !roleLimitExceeded &&
    (!identityRequired || identityConsent) &&
    (!teamConsentRequired || teamConsent);
  const resetDate =
    quota?.resetAt && !Number.isNaN(Date.parse(quota.resetAt))
      ? new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "long",
        }).format(new Date(quota.resetAt))
      : "";

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  useLayoutEffect(() => {
    onBusyChange?.(operationLocked);
    return () => onBusyChange?.(false);
  }, [onBusyChange, operationLocked]);

  useLayoutEffect(() => {
    onResultChange?.(result);
  }, [onResultChange, result]);

  useEffect(() => {
    if (!quota) return;
    const affordable = DURATIONS.filter(
      (value) =>
        value <= quota.videoMaxDurationSeconds &&
        (quota.unlimited ||
          quota.video.remaining === null ||
          value <= quota.video.remaining)
    );
    setDuration((current) =>
      affordable.includes(current)
        ? current
        : affordable.at(-1) ??
          (Math.min(
            current,
            quota.videoMaxDurationSeconds
          ) as MediaGenerationVideoDuration)
    );
  }, [quota]);

  useEffect(() => {
    if (kind !== "video" || duration <= 8) setSceneMode("single");
  }, [kind, duration]);

  useEffect(() => {
    const clearAccountState = () => {
      sequence.current += 1;
      setPrompt("");
      setReferences([]);
      setFormat(kind === "video" ? "story" : "square");
      setDuration(8);
      setSceneMode("single");
      setWithMusic(true);
      setWithNarration(true);
      setSpeechMode("voiceover");
      setVoice("female");
      setVoiceVariant("Kore");
      setIdentityConsent(false);
      setTeamConsent(false);
      setLibraryOpen(false);
      setStopConfirmOpen(false);
      setActionError("");
      setReferencesBusy(false);
      setFinishing(false);
      setCreationScreen(false);
      operationInFlight.current = false;
      referenceSetId.current = "";
    };
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, clearAccountState);
    return () => {
      sequence.current += 1;
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, clearAccountState);
    };
  }, [kind]);

  const resetConsent = () => {
    setIdentityConsent(false);
    setTeamConsent(false);
    referenceSetId.current = globalThis.crypto.randomUUID();
  };

  const addFiles = async (files: File[], lockOwned = false) => {
    if (!lockOwned && (locked || operationInFlight.current)) return;
    const currentSequence = sequence.current;
    operationInFlight.current = true;
    setReferencesBusy(true);
    setActionError("");
    try {
      const prepared: Reference[] = [];
      for (const file of files.slice(
        0,
        AI_MEDIA_INSPIRATION_MAX_COUNT - references.length
      )) {
        const fromVideo = kind === "video" && isInrMediaVideoFile(file);
        const image = fromVideo
          ? await prepareVideoReferenceFrame(file)
          : await prepareMediaGenerationImageReference(file);
        if (sequence.current !== currentSequence) return;
        prepared.push({
          ...image,
          id: globalThis.crypto.randomUUID(),
          role: undefined,
          usage: undefined,
          fromVideo,
        });
      }
      setReferences((current) =>
        [...current, ...prepared].slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT)
      );
      resetConsent();
    } catch (caught) {
      if (sequence.current === currentSequence)
        setActionError(
          caught instanceof Error
            ? caught.message
            : t("ai_generator_free_refs_error")
        );
    } finally {
      if (sequence.current === currentSequence) {
        setReferencesBusy(false);
        operationInFlight.current = false;
      }
    }
  };

  const addLibraryFiles = async (items: MediaLibraryPickerItem[]) => {
    if (locked || operationInFlight.current) return;
    const currentSequence = sequence.current;
    operationInFlight.current = true;
    setReferencesBusy(true);
    setActionError("");
    try {
      const files = await Promise.all(
        items
          .slice(0, AI_MEDIA_INSPIRATION_MAX_COUNT - references.length)
          .map(async (item) => {
            if (!item.signed_url)
              throw new Error(
                t("ai_generator_inspiration_library_unavailable")
              );
            const response = await fetch(item.signed_url, {
              cache: "no-store",
            });
            if (!response.ok)
              throw new Error(
                t("ai_generator_inspiration_library_unavailable")
              );
            const blob = await response.blob();
            return new File(
              [blob],
              item.original_file_name ||
                item.title ||
                (item.media_type === "video"
                  ? "reference.mp4"
                  : "reference.jpg"),
              {
                type:
                  blob.type ||
                  item.mime_type ||
                  (item.media_type === "video" ? "video/mp4" : "image/jpeg"),
              }
            );
          })
      );
      if (sequence.current !== currentSequence) return;
      await addFiles(files, true);
      if (sequence.current !== currentSequence) return;
      setLibraryOpen(false);
    } catch (caught) {
      if (sequence.current === currentSequence)
        setActionError(
          caught instanceof Error
            ? caught.message
            : t("ai_generator_free_refs_error")
        );
    } finally {
      if (sequence.current === currentSequence) {
        setReferencesBusy(false);
        operationInFlight.current = false;
      }
    }
  };

  const updateReference = (
    id: string,
    patch: Partial<Pick<Reference, "role" | "usage">>
  ) => {
    setReferences((current) =>
      current.map((reference) =>
        reference.id !== id
          ? reference
          : {
              ...reference,
              ...patch,
              // A usage belongs to a role. Clearing it avoids carrying an
              // authoritative choice from a product or person onto another role.
              ...(Object.hasOwn(patch, "role") && patch.role !== reference.role
                ? { usage: undefined }
                : {}),
            }
      )
    );
    resetConsent();
  };

  const handleGenerate = async () => {
    if (!canGenerate || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentSequence = sequence.current;
    let retryableFailure = false;
    setActionError("");
    setFinishing(true);
    setCreationScreen(true);
    try {
      if (result?.draft) await discardDraft(result);
      if (sequence.current !== currentSequence) return;
      setStopConfirmOpen(false);
      await generate({
        operation: "generate",
        creationMode: "free",
        freePrompt: prompt.trim(),
        inputMode: "essential",
        source,
        kind,
        subjectSource: "custom",
        idea: prompt.trim(),
        format,
        durationSeconds: kind === "video" ? duration : undefined,
        sceneMode: kind === "video" ? sceneMode : undefined,
        withMusic: kind === "video" && withMusic,
        withNarration: effectiveWithNarration,
        narrationVoice: effectiveWithNarration ? voice : undefined,
        narrationVoiceVariant:
          effectiveWithNarration ? voiceVariant : undefined,
        videoEngine: "omni",
        teamVideoSpeechMode: kind === "video" ? speechMode : undefined,
        teamVideoMode: "cinematic",
        inspirationImages: referencesForRequest(references),
        identityMode:
          personReferences.length > 1
            ? "reference_team"
            : identityRequired
            ? "professional"
            : "auto",
        identityConsent: identityRequired && identityConsent,
        teamVideoVeoConsent: teamConsentRequired && teamConsent,
        identityReferenceSetId: references.length
          ? referenceSetId.current || undefined
          : undefined,
        // Compatibility-only values: the free server branch builds its own creative plan.
        textKeywords: [],
        imageStyle: "photo",
        peopleMode: "auto",
        useBrandColors: false,
        logoMode: "none",
      });
    } catch (caught) {
      if (sequence.current !== currentSequence) return;
      if (
        !(caught instanceof MediaGenerationAccountChangedError) &&
        !(caught instanceof MediaGenerationCancelledError)
      ) {
        retryableFailure = true;
        setActionError(
          caught instanceof Error ? caught.message : t("ai_generator_error")
        );
      }
    } finally {
      if (sequence.current === currentSequence) {
        setFinishing(false);
        // A failed attempt keeps the same references and request on screen.
        // Reuse its explicit authorization for Retry; a successful new
        // creation (or a cancellation) still requires fresh authorization.
        if (!retryableFailure) {
          setIdentityConsent(false);
          setTeamConsent(false);
        }
        operationInFlight.current = false;
      }
    }
  };

  const handleEdit = async () => {
    if (operationLocked || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentSequence = sequence.current;
    setFinishing(true);
    setActionError("");
    try {
      if (result?.draft) await discardDraft(result);
      if (sequence.current !== currentSequence) return;
      reset();
      setCreationScreen(false);
    } catch (caught) {
      if (sequence.current !== currentSequence) return;
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error")
      );
    } finally {
      if (sequence.current === currentSequence) {
        setFinishing(false);
        operationInFlight.current = false;
      }
    }
  };

  const handleAccept = async () => {
    if (!result || operationLocked || operationInFlight.current) return;
    operationInFlight.current = true;
    const currentSequence = sequence.current;
    setFinishing(true);
    setActionError("");
    try {
      const accepted = await acceptDraft(result);
      if (sequence.current !== currentSequence) return;
      onResultChange?.(accepted);
      await onAccepted(accepted);
    } catch (caught) {
      if (sequence.current !== currentSequence) return;
      if (!(caught instanceof MediaGenerationAccountChangedError))
        setActionError(
          caught instanceof Error ? caught.message : t("ai_generator_error")
        );
    } finally {
      if (sequence.current === currentSequence) {
        operationInFlight.current = false;
        setFinishing(false);
      }
    }
  };

  const handleConfirmGenerationStop = () => {
    setStopConfirmOpen(false);
    if (cancelGeneration()) {
      setActionError("");
      setCreationScreen(false);
    }
  };

  if (creationScreen) {
    return (
      <MediaGenerationCreationWorkspace
        kind={kind}
        format={format}
        durationSeconds={duration}
        origin={source}
        creationMode="free"
        progress={progress}
        operationLocked={operationLocked}
        finishing={finishing}
        generationResult={result}
        generationCancellable={cancellable}
        cancelConfirmationOpen={stopConfirmOpen}
        setCancelConfirmationOpen={setStopConfirmOpen}
        handleRequestGenerationStop={() => setStopConfirmOpen(true)}
        handleConfirmGenerationStop={handleConfirmGenerationStop}
        handleConfirm={handleAccept}
        handleGenerate={handleGenerate}
        handleEditCriteria={handleEdit}
        disabled={!canGenerate}
        acceptMode={acceptMode}
        actionError={actionError}
        error={error}
        originChangedNotice={originChangedNotice}
        identityTeam={personReferences.length > 1}
        referenceCinematicRequested={kind === "video" && references.length > 0}
        editLabel={t("ai_generator_free_edit_prompt")}
        regenerationConsents={
          identityRequired
            ? [
                {
                  id: "identity",
                  label: t(
                    personReferences.length > 1
                      ? "ai_generator_reference_team_consent_label"
                      : "ai_generator_video_character_consent_label"
                  ),
                  checked: identityConsent,
                  onChange: (checked) => {
                    setIdentityConsent(checked);
                    setTeamConsent(false);
                  },
                },
                ...(teamConsentRequired
                  ? [{
                      id: "team",
                      label: t("ai_generator_free_team_consent"),
                      checked: teamConsent,
                      onChange: setTeamConsent,
                    }]
                  : []),
              ]
            : undefined
        }
      />
    );
  }

  return (
    <div
      className={styles.workspace}
      data-creation-mode="free"
      data-media-kind={kind}
      data-scenes-available={kind === "video" && duration > 8}
      data-view="form"
    >
      <div className={styles.creationGrid}>
        <section
          className={styles.parameters}
          aria-labelledby={`${instanceId}-parameters`}
        >
          <div className={styles.panelHeading}>
            <span className={styles.panelIcon} aria-hidden="true">
              ◈
            </span>
            <div>
              <h2 id={`${instanceId}-parameters`}>
                {t("ai_generator_free_parameters_title")}
              </h2>
              <p>{t("ai_generator_free_parameters_hint")}</p>
            </div>
          </div>
          <fieldset className={`${styles.fieldset} ${styles.formatFieldset}`} disabled={locked}>
            <legend>{t("ai_generator_free_format_label")}</legend>
            <div className={styles.formatOptions}>
              {FORMATS.map((option) => (
                <label
                  className={styles.formatOption}
                  data-selected={format === option.id}
                  key={option.id}
                >
                  <input
                    type="radio"
                    name={`${instanceId}-format`}
                    value={option.id}
                    checked={format === option.id}
                    onChange={() => setFormat(option.id)}
                  />
                  <span
                    className={styles.formatIcon}
                    data-format={option.id}
                    aria-hidden="true"
                  />
                  <strong>{t(`ai_generator_format_${option.id}`)}</strong>
                  <small>{option.ratio}</small>
                </label>
              ))}
            </div>
          </fieldset>
          {kind === "video" ? (
            <fieldset className={`${styles.fieldset} ${styles.durationFieldset}`} disabled={locked}>
              <legend>{t("ai_generator_free_duration_label")}</legend>
              <div className={styles.durationOptions}>
                {DURATIONS.map((value) => {
                  const unavailable =
                    value > maxDuration ||
                    (remainingSeconds !== null && value > remainingSeconds);
                  return (
                    <label
                      className={styles.durationOption}
                      data-selected={duration === value}
                      data-disabled={unavailable}
                      key={value}
                    >
                      <input
                        type="radio"
                        name={`${instanceId}-duration`}
                        value={value}
                        checked={duration === value}
                        disabled={unavailable}
                        onChange={() => setDuration(value)}
                      />
                      <strong>{value} s</strong>
                      <small>{t(`ai_generator_duration_${value}`)}</small>
                    </label>
                  );
                })}
              </div>
              {duration > 8 ? (
                <div className={styles.sceneOptions} role="group" aria-label={t("ai_generator_free_scene_label")}>
                  {(["single", "multi"] as const).map((mode) => (
                    <label
                      className={styles.sceneOption}
                      data-selected={sceneMode === mode}
                      key={mode}
                    >
                      <input
                        type="radio"
                        name={`${instanceId}-scene-mode`}
                        value={mode}
                        checked={sceneMode === mode}
                        onChange={() => setSceneMode(mode)}
                      />
                      <strong>{t(`ai_generator_free_scene_${mode}`)}</strong>
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>
          ) : null}
          <div className={styles.referencesSection}>
            <div className={styles.sectionHeading}>
              <h3>{t("ai_generator_free_references_title")}</h3>
              <span>{t("ai_generator_free_optional")}</span>
            </div>
            <p className={styles.muted}>
              {t("ai_generator_free_references_hint", {
                count: AI_MEDIA_INSPIRATION_MAX_COUNT,
              })}
            </p>
            <div className={styles.referenceActions}>
              <label
                className={styles.importButton}
                data-disabled={
                  locked ||
                  references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                }
              >
                <span aria-hidden="true">＋</span>
                {t("ai_generator_free_import")}
                <input
                  type="file"
                  multiple
                  accept={kind === "video" ? VIDEO_ACCEPT : IMAGE_ACCEPT}
                  disabled={
                    locked ||
                    references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                  }
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.currentTarget.value = "";
                    if (files.length) void addFiles(files);
                  }}
                />
              </label>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={
                  locked ||
                  references.length >= AI_MEDIA_INSPIRATION_MAX_COUNT
                }
                onClick={() => setLibraryOpen(true)}
              >
                {t("ai_generator_free_library")}
              </button>
            </div>
            {referencesBusy ? (
              <p className={styles.muted} role="status">
                {t("ai_generator_free_refs_loading")}
              </p>
            ) : null}
            {references.length ? (
              <div className={styles.references}>
                {references.map((reference, index) => (
                  <div className={styles.reference} key={reference.id}>
                    <div className={styles.referenceImage}>
                      <img
                        src={`data:${reference.mimeType};base64,${reference.data}`}
                        alt={t("ai_generator_free_reference", {
                          index: index + 1,
                        })}
                      />
                      <span>{index + 1}</span>
                      <button
                        type="button"
                        aria-label={t(
                          "ai_generator_free_reference_remove",
                          { index: index + 1 }
                        )}
                        disabled={locked}
                        onClick={() => {
                          setReferences((current) =>
                            current.filter(
                              (entry) => entry.id !== reference.id
                            )
                          );
                          resetConsent();
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <small
                      className={styles.fileName}
                      title={reference.name}
                    >
                      {reference.name}
                    </small>
                    <select
                      aria-label={t("ai_generator_free_reference_role", {
                        index: index + 1,
                      })}
                      aria-invalid={!reference.role || undefined}
                      data-incomplete={!reference.role || undefined}
                      value={reference.role ?? ""}
                      disabled={locked}
                      onChange={(event) =>
                        updateReference(reference.id, {
                          role: event.target.value
                            ? (event.target.value as MediaGenerationReferenceRole)
                            : undefined,
                        })
                      }
                    >
                      <option value="" disabled>
                        {t("ai_generator_free_reference_role_placeholder")}
                      </option>
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {t(`ai_generator_free_role_${role}`)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t("ai_generator_free_reference_usage", {
                        index: index + 1,
                      })}
                      aria-invalid={!reference.usage || undefined}
                      data-incomplete={!reference.usage || undefined}
                      value={reference.usage ?? ""}
                      disabled={locked}
                      onChange={(event) =>
                        updateReference(reference.id, {
                          usage: event.target.value
                            ? (event.target.value as MediaGenerationReferenceUsage)
                            : undefined,
                        })
                      }
                    >
                      <option value="" disabled>
                        {t("ai_generator_free_reference_usage_placeholder")}
                      </option>
                      {reference.role !== "inspiration" ? (
                        <option value="required">
                          {t("ai_generator_free_usage_required")}
                        </option>
                      ) : null}
                      <option value="inspiration">
                        {t("ai_generator_free_usage_inspiration")}
                      </option>
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
            {references.some((reference) => reference.fromVideo) ? (
              <p className={styles.muted}>
                {t("ai_generator_free_references_video_hint")}
              </p>
            ) : null}
            {referenceCriteriaIncomplete ? (
              <p className={styles.referenceCriteriaHint} role="status">
                {t("ai_generator_free_reference_criteria_required")}
              </p>
            ) : null}
            {roleLimitExceeded ? (
              <p className={styles.error} role="alert">
                {t("ai_generator_free_role_limit")}
              </p>
            ) : null}
          </div>
          {kind === "video" ? (
            <div className={styles.audioSection}>
              <h3>{t("ai_generator_essential_sound_title")}</h3>
              <fieldset className={styles.soundChoices} disabled={locked}>
                <legend className={styles.srOnly}>
                  {t("ai_generator_essential_sound_title")}
                </legend>
                {(["voiceover", "characters"] as const).map((mode) => (
                  <label
                    className={styles.soundChoice}
                    data-selected={speechMode === mode}
                    key={mode}
                  >
                    <input
                      type="radio"
                      name={`${instanceId}-speech-mode`}
                      value={mode}
                      checked={speechMode === mode}
                      onChange={() => {
                        setSpeechMode(mode);
                        setTeamConsent(false);
                      }}
                    />
                    <span>
                      <strong>
                        {t(`ai_generator_essential_sound_${mode}`)}
                      </strong>
                      <small>
                        {t(`ai_generator_team_speech_${mode}_hint`)}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {speechMode === "voiceover" ? (
                <label className={styles.toggle}>
                  <span>{t("ai_generator_free_narration")}</span>
                  <input
                    type="checkbox"
                    checked={withNarration}
                    disabled={locked}
                    onChange={(event) =>
                      setWithNarration(event.target.checked)
                    }
                  />
                </label>
              ) : (
                <p className={styles.muted} role="note">
                  {t("ai_generator_essential_character_speech_notice")}
                </p>
              )}
              {effectiveWithNarration ? (
                <div className={styles.voiceOptions}>
                  <label>
                    <span>{t("ai_generator_narration_voice_label")}</span>
                    <select
                      value={voice}
                      disabled={locked}
                      onChange={(event) => {
                        const next = event.target
                          .value as MediaGenerationNarrationVoice;
                        setVoice(next);
                        setVoiceVariant(
                          defaultAiMediaNarrationVoiceVariant(next)
                        );
                      }}
                    >
                      {(["female", "male"] as const).map((gender) => (
                        <option key={gender} value={gender}>
                          {t(`ai_generator_narration_voice_${gender}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>
                      {t("ai_generator_narration_voice_variant_label")}
                    </span>
                    <select
                      value={voiceVariant}
                      disabled={locked}
                      onChange={(event) =>
                        setVoiceVariant(
                          event.target
                            .value as MediaGenerationNarrationVoiceVariant
                        )
                      }
                    >
                      {AI_MEDIA_NARRATION_VOICE_VARIANTS[voice].map(
                        (variant) => (
                          <option key={variant} value={variant}>
                            {t(
                              `ai_generator_narration_voice_variant_${variant.toLowerCase()}`
                            )}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                </div>
              ) : null}
              <label className={styles.toggle}>
                <span>{t("ai_generator_free_music")}</span>
                <input
                  type="checkbox"
                  checked={withMusic}
                  disabled={locked}
                  onChange={(event) => setWithMusic(event.target.checked)}
                />
              </label>
            </div>
          ) : null}
        </section>
        <section
          className={styles.promptPanel}
          aria-labelledby={`${instanceId}-prompt-title`}
        >
          <div className={styles.panelHeading}>
            <span className={styles.promptIcon} aria-hidden="true">
              ✦
            </span>
            <div>
              <h2 id={`${instanceId}-prompt-title`}>
                {t("ai_generator_free_prompt_title")}
              </h2>
              <p>{t("ai_generator_free_prompt_hint")}</p>
            </div>
          </div>
          <div className={styles.promptContainer}>
            <label
              className={styles.srOnly}
              htmlFor={`${instanceId}-prompt`}
            >
              {t("ai_generator_free_prompt_label")}
            </label>
            <textarea
              id={`${instanceId}-prompt`}
              value={prompt}
              maxLength={MAX_PROMPT}
              disabled={busy || finishing || referencesBusy}
              readOnly={voiceBusy}
              aria-describedby={`${instanceId}-prompt-help`}
              placeholder={t(
                kind === "video"
                  ? "ai_generator_free_prompt_placeholder_video"
                  : "ai_generator_free_prompt_placeholder_image"
              )}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className={styles.promptToolbar}>
              <span>
                {prompt.length.toLocaleString(locale)} /{" "}
                {MAX_PROMPT.toLocaleString(locale)}
              </span>
              <MediaSubjectVoiceButton
                value={prompt}
                onChange={setPrompt}
                onBusyChange={setVoiceBusy}
                disabled={busy || finishing || referencesBusy}
                maxLength={MAX_PROMPT}
                purpose="instruction"
                contextLabel={t("ai_generator_free_prompt_label")}
                placement="inline"
              />
            </div>
          </div>
          <p id={`${instanceId}-prompt-help`} className={styles.promptHelp}>
            {t("ai_generator_free_prompt_help")}
          </p>
          {identityRequired ? (
            <label className={styles.consent}>
              <input
                type="checkbox"
                checked={identityConsent}
                disabled={locked}
                onChange={(event) => {
                  setIdentityConsent(event.target.checked);
                  setTeamConsent(false);
                }}
              />
              <span>
                {t(
                  personReferences.length > 1
                    ? "ai_generator_reference_team_consent_label"
                    : "ai_generator_video_character_consent_label"
                )}
              </span>
            </label>
          ) : null}
          {teamConsentRequired ? (
            <label className={styles.consent}>
              <input
                type="checkbox"
                checked={teamConsent}
                disabled={locked}
                onChange={(event) => setTeamConsent(event.target.checked)}
              />
              <span>{t("ai_generator_free_team_consent")}</span>
            </label>
          ) : null}
        </section>
      </div>
      <div className={styles.footer}>
        <div className={styles.quota}>
          <span className={styles.quotaIcon} aria-hidden="true">
            ◴
          </span>
          <div>
            <span>
              {t(
                kind === "video"
                  ? "ai_generator_video_quota"
                  : "ai_generator_image_quota"
              )}
            </span>
            <strong>
              {quota?.unlimited
                ? t("ai_generator_unlimited")
                : counter
                ? `${counter.used} / ${counter.limit ?? "—"}${
                    kind === "video" ? " s" : ""
                  }`
                : "…"}
            </strong>
            <small>
              {t("ai_generator_free_shared_quota")}
              {resetDate
                ? ` · ${t("ai_generator_reset", { date: resetDate })}`
                : ""}
            </small>
          </div>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!canGenerate}
          onClick={() => void handleGenerate()}
        >
          <span aria-hidden="true">✦</span>
          {t(
            kind === "video"
              ? "ai_generator_generate_video"
              : "ai_generator_generate_image"
          )}
        </button>
      </div>
      {exhausted || creditInsufficient || durationUnavailable ? (
        <p className={styles.error} role="status">
          {t(
            exhausted
              ? "ai_generator_quota_reached"
              : creditInsufficient
              ? "ai_generator_video_credit_insufficient"
              : "ai_generator_video_premium_required"
          )}
        </p>
      ) : null}
      {!quota && !quotaLoading ? (
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => void loadQuota({ force: true })}
        >
          {t("ai_generator_free_retry_quota")}
        </button>
      ) : null}
      {actionError || error ? (
        <p className={styles.error} role="alert">
          {actionError || error}
        </p>
      ) : null}
      {originChangedNotice ? (
        <p className={styles.muted} role="status">
          {t("ai_generator_origin_changed")}
        </p>
      ) : null}
      <MediaLibraryPickerModal
        open={libraryOpen}
        title={t("ai_generator_inspiration_library_title")}
        subtitle={t("ai_generator_inspiration_library_subtitle")}
        accept={kind === "video" ? "all" : "image"}
        multiple
        maxSelection={Math.max(
          1,
          AI_MEDIA_INSPIRATION_MAX_COUNT - references.length
        )}
        confirmLabel={t("ai_generator_inspiration_library_confirm")}
        onClose={() => setLibraryOpen(false)}
        onConfirm={addLibraryFiles}
      />
    </div>
  );
}
