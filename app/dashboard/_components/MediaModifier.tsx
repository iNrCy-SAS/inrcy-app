"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import useMediaGeneration, {
  MediaGenerationAccountChangedError,
  MediaGenerationCancelledError,
  type MediaGenerationFormat,
  type MediaGenerationInspirationImage,
  type MediaGenerationResult,
  type MediaGenerationSource,
} from "@/app/dashboard/_hooks/useMediaGeneration";
import {
  AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES,
  AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS,
} from "@/lib/aiMediaGenerationContracts";
import {
  INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS,
  INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  INR_MEDIA_IMAGE_FORMATS_LABEL,
  isInrMediaImageFile,
} from "@/lib/mediaRules";
import { prepareMediaGenerationImageReference } from "./MediaGenerator";
import MediaSubjectVoiceButton from "./MediaSubjectVoiceButton";
import type { MediaStudioInitialPreview } from "./MediaRetoucher";
import useMediaEnginePreference from "../_hooks/useMediaEnginePreference";
import useMediaCreditQuote from "../_hooks/useMediaCreditQuote";
import MediaEngineCreditControls, { MediaCreditQuoteSummary, MediaGenerationActions } from "./MediaEngineCreditControls";
import MediaQuotaSummary from "./MediaQuotaSummary";
import { recommendAiMediaModel } from "@/lib/aiMediaModelRecommendation";
import { isAiMediaImageModelCompatible } from "@/lib/aiMediaModelCatalog";

import MediaGenerationCreationWorkspace from "./MediaGenerationCreationWorkspace";
import styles from "./MediaModifier.module.css";

type MediaModifierProps = {
  source: MediaGenerationSource;
  initialSource?: File | null;
  initialPreview?: MediaStudioInitialPreview | null;
  initialSourceLoading?: boolean;
  acceptMode: "library" | "insert";
  onAccepted: (result: MediaGenerationResult) => void | Promise<void>;
  onResultChange?: (result: MediaGenerationResult | null) => void;
  onBusyChange?: (busy: boolean) => void;
};

type SourceImage = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  preparedReference?: MediaGenerationInspirationImage;
};

const SOURCE_ACCEPT = [
  ...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

const IMAGE_PREVIEW_LOAD_TIMEOUT_MS = 8_000;

const FORMAT_RATIOS: Array<[MediaGenerationFormat, number]> = [
  ["square", 1],
  ["portrait", 4 / 5],
  ["story", 9 / 16],
  ["landscape", 16 / 9],
];

function closestFormat(width: number, height: number): MediaGenerationFormat {
  const ratio = width > 0 && height > 0 ? width / height : 1;
  return FORMAT_RATIOS.reduce((closest, candidate) =>
    Math.abs(Math.log(ratio / candidate[1])) <
    Math.abs(Math.log(ratio / closest[1]))
      ? candidate
      : closest,
  )[0];
}

function readImageDimensions(previewUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (
      result:
        | { ok: true; width: number; height: number }
        | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      if (result.ok) {
        resolve({ width: result.width, height: result.height });
      } else {
        reject(result.error);
      }
    };
    const timeoutId = window.setTimeout(
      () =>
        finish({
          ok: false,
          error: new Error("image_preview_timeout"),
        }),
      IMAGE_PREVIEW_LOAD_TIMEOUT_MS,
    );
    image.decoding = "async";
    image.onload = () =>
      finish({
        ok: true,
        width: image.naturalWidth || 1,
        height: image.naturalHeight || 1,
      });
    image.onerror = () =>
      finish({ ok: false, error: new Error("image_source_unreadable") });
    image.src = previewUrl;
  });
}

function preparedReferencePreviewFile(
  reference: MediaGenerationInspirationImage,
  sourceName: string,
) {
  const binary = window.atob(reference.data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const extension =
    reference.mimeType === "image/png"
      ? "png"
      : reference.mimeType === "image/webp"
        ? "webp"
        : "jpg";
  return new File(
    [bytes],
    `${sourceName.replace(/\.[^.]+$/, "") || "image-source"}.${extension}`,
    { type: reference.mimeType, lastModified: Date.now() },
  );
}

function libraryItemName(item: MediaLibraryPickerItem) {
  return (
    item.original_file_name ||
    item.title ||
    item.storage_path.split("/").pop() ||
    "image-source.jpg"
  );
}

export default function MediaModifier({
  source,
  initialSource = null,
  initialPreview = null,
  initialSourceLoading = false,
  acceptMode,
  onAccepted,
  onResultChange,
  onBusyChange,
}: MediaModifierProps) {
  const t = useTranslations("media");
  const locale = useLocale();
  const fileInputId = useId();
  const instructionId = useId();
  const recoveryInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef("");
  const initializedSourceRef = useRef<File | null>(null);
  const acceptInFlightRef = useRef(false);
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [instruction, setInstruction] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const {
    quota,
    status,
    progress,
    error,
    result,
    busy: generationBusy,
    cancellable: generationCancellable,
    cancellationPending,
    canRecover,
    cancelGeneration,
    retryRecovery,
    cancelRecovery,
    quotaLoading,
    loadQuota,
    generate,
    acceptDraft,
    discardDraft,
    reset,
  } = useMediaGeneration();
  const baseOperationLocked =
    sourceBusy ||
    Boolean(initialSourceLoading && !sourceImage && initialPreview?.url) ||
    generationBusy ||
    finishing ||
    recovering;
  const operationLocked = baseOperationLocked || voiceBusy;
  const enginePreference = useMediaEnginePreference(quota?.accountId);
  const sourceFormat = sourceImage ? closestFormat(sourceImage.width, sourceImage.height) : "square";
  const imageEngineCompatible = isAiMediaImageModelCompatible({ engine: enginePreference.imageEngine, operation: "modify", inspirationImagesCount: sourceImage ? 1 : 0 });
  const creditQuote = useMediaCreditQuote({ kind: "image", format: sourceFormat, operation: "modify", creationMode: "guided",
    inputMode: "essential", identityMode: "auto",
    imageEngine: enginePreference.imageEngine, inspirationImagesCount: sourceImage ? 1 : 0,
  }, quota, imageEngineCompatible);
  const imageCounter = quota?.credits || null;
  const imageQuotaExhausted = quota?.unlimited
    ? false
    : imageCounter?.remaining === 0;

  const resetDate = useMemo(() => {
    if (!quota?.resetAt) return "";
    const parsed = new Date(quota.resetAt);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
    }).format(parsed);
  }, [locale, quota?.resetAt]);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    onBusyChange?.(operationLocked);
    return () => onBusyChange?.(false);
  }, [onBusyChange, operationLocked]);

  useLayoutEffect(() => {
    onResultChange?.(result);
  }, [onResultChange, result]);

  const selectSourceFile = useCallback(async (file: File | undefined) => {
    if (!file || operationLocked || result) return;
    setActionError("");
    if (!isInrMediaImageFile(file)) {
      setActionError(
        t("ai_modifier_invalid_format", { formats: INR_MEDIA_IMAGE_FORMATS_LABEL }),
      );
      return;
    }
    if (!file.size || file.size > AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES) {
      setActionError(t("ai_modifier_source_too_large"));
      return;
    }

    setSourceBusy(true);
    let previewUrl = URL.createObjectURL(file);
    try {
      let dimensions: { width: number; height: number };
      let preparedReference: MediaGenerationInspirationImage | undefined;
      try {
        dimensions = await readImageDimensions(previewUrl);
      } catch {
        URL.revokeObjectURL(previewUrl);
        preparedReference = await prepareMediaGenerationImageReference(file);
        const previewFile = preparedReferencePreviewFile(
          preparedReference,
          file.name,
        );
        previewUrl = URL.createObjectURL(previewFile);
        dimensions = await readImageDimensions(previewUrl);
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = previewUrl;
      setSourceImage({
        file,
        previewUrl,
        ...dimensions,
        preparedReference,
      });
    } catch {
      URL.revokeObjectURL(previewUrl);
      setActionError(t("ai_modifier_source_unreadable"));
    } finally {
      setSourceBusy(false);
    }
  }, [operationLocked, result, t]);

  useEffect(() => {
    if (
      !initialSource ||
      initialSourceLoading ||
      initializedSourceRef.current === initialSource
    ) {
      return;
    }
    initializedSourceRef.current = initialSource;
    void selectSourceFile(initialSource);
  }, [initialSource, initialSourceLoading, selectSourceFile]);

  const removeSource = () => {
    if (operationLocked || result) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setSourceImage(null);
    setActionError("");
    reset();
  };

  const importLibraryImage = async (item: MediaLibraryPickerItem) => {
    if (!item.signed_url) {
      throw new Error(t("ai_generator_inspiration_library_unavailable"));
    }
    const response = await fetch(item.signed_url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(t("ai_generator_inspiration_library_unavailable"));
    }
    const blob = await response.blob();
    const file = new File([blob], libraryItemName(item), {
      type: blob.type || item.mime_type || "image/jpeg",
    });
    await selectSourceFile(file);
  };

  const handleGenerate = async () => {
    if (operationLocked || canRecover || !creditQuote.ready || creditQuote.insufficient) return;
    setActionError("");
    if (!sourceImage) {
      setActionError(t("ai_modifier_missing_source"));
      return;
    }
    const normalizedInstruction = instruction.trim();
    if (normalizedInstruction.length < 3) {
      setActionError(t("ai_modifier_missing_instruction"));
      return;
    }

    setSourceBusy(true);
    try {
      // Only an explicit new generation discards the previous temporary result.
      if (result) {
        if (result.draft) await discardDraft(result);
        reset();
        onResultChange?.(null);
      }
      const prepared =
        sourceImage.preparedReference ||
        (await prepareMediaGenerationImageReference(sourceImage.file));
      await generate({
        ...creditQuote.authorization,
        imageEngine: enginePreference.imageEngine,
        operation: "modify",
        inputMode: "essential",
        source,
        kind: "image",
        subjectSource: "custom",
        idea: normalizedInstruction,
        aiInstruction: normalizedInstruction,
        withText: false,
        textKeywords: [],
        // Le format énuméré ne sert qu'à choisir le preset fournisseur le
        // plus proche. Le chemin Modifier transporte aussi le canvas source
        // exact afin que le prompt et la normalisation ne le convertissent
        // jamais implicitement en 16:9.
        format: sourceFormat,
        modificationSourceWidth: sourceImage.width,
        modificationSourceHeight: sourceImage.height,
        imageStyle: "photo",
        peopleMode: "auto",
        identityMode: "auto",
        useBrandColors: false,
        logoMode: "none",
        inspirationImages: [{ ...prepared, role: "inspiration" }],
      });
    } catch (caught) {
      if (
        caught instanceof MediaGenerationCancelledError ||
        caught instanceof MediaGenerationAccountChangedError
      ) {
        return;
      }
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error"),
      );
    } finally {
      setSourceBusy(false);
    }
  };

  const handleEditInstruction = () => {
    if (operationLocked) return;
    setActionError("");
    if (!result && !canRecover) reset();
    document.getElementById(instructionId)?.focus();
  };

  const handleRecovery = async (abandon = false) => {
    if (!canRecover || operationLocked || recoveryInFlightRef.current) return;
    recoveryInFlightRef.current = true;
    setRecovering(true);
    setActionError("");
    try {
      if (abandon) await cancelRecovery();
      else await retryRecovery();
    } catch (caught) {
      if (!(caught instanceof MediaGenerationAccountChangedError)) {
        setActionError(caught instanceof Error ? caught.message : t("ai_generator_error"));
      }
    } finally {
      recoveryInFlightRef.current = false;
      setRecovering(false);
    }
  };

  const handleRequestGenerationStop = () => {
    if (generationCancellable || (canRecover && !operationLocked)) setCancelConfirmationOpen(true);
  };

  const handleConfirmGenerationStop = () => {
    setCancelConfirmationOpen(false);
    if (canRecover && !generationBusy) void handleRecovery(true);
    else if (cancelGeneration()) setActionError("");
  };

  useEffect(() => {
    if (!generationCancellable && !(canRecover && !operationLocked)) setCancelConfirmationOpen(false);
  }, [generationCancellable, canRecover, operationLocked]);

  const handleConfirm = async () => {
    if (!result || operationLocked || acceptInFlightRef.current) return;
    acceptInFlightRef.current = true;
    setActionError("");
    setFinishing(true);
    try {
      const accepted = await acceptDraft(result);
      onResultChange?.(accepted);
      await onAccepted(accepted);
    } catch (caught) {
      if (caught instanceof MediaGenerationAccountChangedError) return;
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error"),
      );
    } finally {
      acceptInFlightRef.current = false;
      setFinishing(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (
      !result ||
      !result.draft ||
      operationLocked ||
      acceptInFlightRef.current
    ) {
      return;
    }
    acceptInFlightRef.current = true;
    setActionError("");
    setFinishing(true);
    setSavingToLibrary(true);
    try {
      const accepted = await acceptDraft(result);
      onResultChange?.(accepted);
    } catch (caught) {
      if (caught instanceof MediaGenerationAccountChangedError) return;
      setActionError(
        caught instanceof Error ? caught.message : t("ai_generator_error"),
      );
    } finally {
      acceptInFlightRef.current = false;
      setSavingToLibrary(false);
      setFinishing(false);
    }
  };

  const engineControls = (
    <MediaEngineCreditControls kind="image" format={sourceFormat} operation="modify" videoEngine={enginePreference.videoEngine}
            recommendation={recommendAiMediaModel({ kind: "image", format: sourceFormat, operation: "modify", brief: instruction, language: locale, inspirationImagesCount: sourceImage ? 1 : 0, inputMode: "essential", identityMode: "auto" })}
            imageEngine={enginePreference.imageEngine} resolution={enginePreference.videoResolution}
            referenceCount={sourceImage ? 1 : 0} disabled={operationLocked}
            onVideoEngineChange={() => {}}
            onImageEngineChange={(imageEngine) => enginePreference.update({ imageEngine })}
            onResolutionChange={() => {}} />
  );

  return (
    <div className={styles.workspace} data-state={status}>
      <main className={styles.formContent}>
        <section className={styles.panel} aria-labelledby="modifier-instruction-title">
          <header className={styles.panelHeader}>
            <span aria-hidden="true">1</span>
            <div>
              <h2 id="modifier-instruction-title">
                {t("ai_modifier_instruction_title")}
              </h2>
              <p>{t("ai_modifier_instruction_hint")}</p>
            </div>
          </header>
          <label className={styles.instructionField} htmlFor={instructionId}>
            <span className={styles.srOnly}>{t("ai_modifier_instruction_title")}</span>
            <textarea
              id={instructionId}
              value={instruction}
              maxLength={AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS}
              disabled={baseOperationLocked}
              readOnly={voiceBusy}
              placeholder={t("ai_modifier_instruction_placeholder")}
              onChange={(event) => {
                setInstruction(event.currentTarget.value);
                if (actionError) setActionError("");
              }}
            />
            <span className={styles.counter}>
              {instruction.length}/{AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS}
            </span>
            <div className={styles.voiceControl}>
              <MediaSubjectVoiceButton
                purpose="instruction"
                placement="inline"
                mergeMode="paragraph"
                maxLength={AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS}
                disabled={baseOperationLocked}
                value={instruction}
                onBusyChange={setVoiceBusy}
                onChange={(nextValue) => {
                  setInstruction(nextValue);
                  if (actionError) setActionError("");
                }}
              />
            </div>
          </label>
          <div className={styles.contractNote}>
            <span aria-hidden="true">◎</span>
            <p>{t("ai_modifier_preservation_contract")}</p>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.mediaPanel}`} aria-labelledby="modifier-source-title" data-media-state={result ? "result" : generationBusy || sourceBusy ? "progress" : "source"}>
          <header className={styles.panelHeader}>
            <span aria-hidden="true">2</span>
            <div>
              <h2 id="modifier-source-title">{t("ai_modifier_source_title")}</h2>
              <p>{t("ai_modifier_source_hint")}</p>
            </div>
          </header>

          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept={SOURCE_ACCEPT}
            hidden
            disabled={operationLocked}
            onChange={(event) => {
              void selectSourceFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />

          {sourceBusy && !generationBusy && !result ? (
            <div className={styles.mediaStage} data-modifier-preview>
              <div className={styles.preparingSource} role="status" aria-live="polite">
                <span className={styles.spinner} aria-hidden="true">✦</span>
                <strong>{t("ai_modifier_preparing")}</strong>
              </div>
            </div>
          ) : result || generationBusy || cancellationPending || canRecover || actionError || error ? (
            <div className={styles.mediaStage} data-modifier-preview>
              <MediaGenerationCreationWorkspace
                variant="embedded"
                creationStarted
                generationInProgress={sourceBusy || generationBusy || recovering}
                cancellationPending={cancellationPending}
                kind="image"
                format={sourceFormat}
                durationSeconds={0}
                progress={progress}
                operationLocked={operationLocked}
                finishing={finishing}
                generationResult={result}
                generationCancellable={generationCancellable || (canRecover && !operationLocked)}
                cancelConfirmationOpen={cancelConfirmationOpen}
                setCancelConfirmationOpen={setCancelConfirmationOpen}
                handleRequestGenerationStop={handleRequestGenerationStop}
                handleConfirmGenerationStop={handleConfirmGenerationStop}
                handleConfirm={handleConfirm}
                handleSaveToLibrary={handleSaveToLibrary}
                handleGenerate={handleGenerate}
                handleEditCriteria={handleEditInstruction}
                editLabel={t("ai_modifier_edit_instruction")}
                disabled={operationLocked || !sourceImage || !creditQuote.ready || creditQuote.insufficient}
                acceptMode={acceptMode}
                savingToLibrary={savingToLibrary}
                actionError={actionError}
                error={error}
              />
            </div>
          ) : sourceImage ? (
            <div className={styles.sourcePreview}>
              <img src={sourceImage.previewUrl} alt={t("ai_modifier_source_alt")} />
              <div className={styles.sourceMeta}>
                <strong>{sourceImage.file.name}</strong>
                <span>
                  {sourceImage.width} × {sourceImage.height}
                </span>
              </div>
              <div className={styles.sourceActions}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={operationLocked}
                >
                  {t("ai_generator_essential_replace")}
                </button>
                <button
                  type="button"
                  onClick={removeSource}
                  disabled={operationLocked}
                >
                  {t("ai_generator_inspiration_remove")}
                </button>
              </div>
            </div>
          ) : initialPreview?.url ? (
            <div className={styles.sourcePreview} data-preparing="true">
              <img
                src={initialPreview.url}
                alt={t("ai_modifier_source_alt")}
                draggable={false}
              />
              <div className={styles.sourceMeta}>
                <strong>{initialPreview.name}</strong>
                <span>{t("ai_modifier_preparing")}</span>
              </div>
            </div>
          ) : (
            <label
              htmlFor={fileInputId}
              className={styles.dropZone}
              data-dragging={dragging ? "true" : "false"}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void selectSourceFile(event.dataTransfer.files?.[0]);
              }}
            >
              <span className={styles.dropIcon} aria-hidden="true">＋</span>
              <strong>{t("ai_modifier_drop_title")}</strong>
              <small>{INR_MEDIA_IMAGE_FORMATS_LABEL}</small>
            </label>
          )}

          {!result && !generationBusy && !canRecover ? <div className={styles.importActions}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={operationLocked}
            >
              {t("ai_modifier_from_device")}
            </button>
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              disabled={operationLocked}
            >
              {t("ai_generator_inspiration_from_library")}
            </button>
          </div> : null}
        </section>

      </main>

      <footer className={styles.actionBar} data-media-footer>
        <MediaQuotaSummary kind="image" counter={imageCounter} unlimited={quota?.unlimited}
          creditsReady={quota?.creditsReady} resetDate={resetDate} locked={operationLocked}
          onRefresh={() => { void loadQuota({ force: true }); }} />
        <MediaGenerationActions>
          {engineControls}
          <MediaCreditQuoteSummary status={creditQuote} quota={quota} />
          {canRecover && !generationBusy ? <button type="button" className={styles.secondaryButton} onClick={handleRequestGenerationStop} disabled={operationLocked}>{t("ai_generator_editor_stop")}</button> : null}
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              if (generationBusy) handleRequestGenerationStop();
              else if (canRecover) void handleRecovery();
              else void handleGenerate();
            }}
            title={generationBusy && !generationCancellable ? t("ai_generator_editor_stop_locked") : undefined}
            disabled={generationBusy ? !generationCancellable : canRecover ? operationLocked :
              operationLocked ||
              !sourceImage ||
              instruction.trim().length < 3 ||
              quotaLoading || !creditQuote.ready || creditQuote.insufficient ||
              imageQuotaExhausted
            }
          >
            <span aria-hidden="true">{generationBusy ? "■" : result ? "↻" : "✦"}</span>
            {t(generationBusy ? "ai_generator_editor_stop" : canRecover ? "ai_generator_editor_recover" : result ? "ai_generator_regenerate" : "ai_modifier_action")}
          </button>
        </MediaGenerationActions>
      </footer>

      <MediaLibraryPickerModal
        open={libraryOpen}
        title={t("ai_modifier_library_title")}
        subtitle={t("ai_modifier_library_subtitle")}
        accept="image"
        multiple={false}
        maxSelection={1}
        maxImageBytes={AI_MEDIA_INSPIRATION_SOURCE_MAX_BYTES}
        confirmLabel={t("ai_modifier_library_confirm")}
        onClose={() => setLibraryOpen(false)}
        onConfirm={async (items) => {
          const item = items[0];
          if (item) await importLibraryImage(item);
        }}
      />
    </div>
  );
}
