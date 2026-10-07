"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoosterCreationMode } from "@/lib/boosterCreationMode";
import {
  buildBoosterSourceMediaMetadata,
  requiresBoosterServerImagePreview,
  type BoosterMediaPipelineMission,
} from "@/lib/boosterMediaPipelineMissions";
import {
  archiveMediaPublicationWorkspace,
  buildWorkspaceMediaClientKey,
  clearBoosterWorkspaceClientKey,
  clearMediaPublicationWorkspace,
  ensureMediaPublicationWorkspace,
  getOrCreateBoosterWorkspaceClientKey,
  isUniversalMediaWorkspaceEnabled,
  linkMediaPublicationWorkspaceDraft,
  loadMediaPublicationWorkspace,
  prepareMediaPublicationWorkspace,
  prepareMediaWorkspaceSourcePreviews,
  prewarmMediaPublicationWorkspace,
  type MediaWorkspaceMediaSummary,
  type MediaWorkspacePreparationResult,
  type MediaWorkspaceReference,
} from "@/lib/mediaWorkspaceClient";
import { isMediaWorkspacePollingRetryableError } from "@/lib/mediaWorkspaceTimeout";
import { uploadUniversalMediaFile } from "@/lib/universalMediaUploadClient";
import {
  beginWorkspaceFamilyMutation,
  beginWorkspaceGlobalClear,
  createWorkspaceMediaMutationClock,
  getWorkspaceMediaFamilyFailure,
  getWorkspaceSourcePosition,
  isWorkspaceMediaMutationCurrent,
  replaceWorkspaceMediaFamilyStates,
  type WorkspaceMediaFamily,
} from "./persistentMediaWorkspaceMutations";

export type PersistentWorkspaceMediaState = {
  localKey: string;
  mediaId: string | null;
  mediaType: "image" | "video";
  position: number;
  status: "queued" | "uploading" | "ready" | "failed";
  progress: number;
  storagePath: string;
  error: string;
};

type UsePersistentMediaWorkspaceParams = {
  draftId?: string | null;
  creationMode: BoosterCreationMode | null;
  eagerImagePreparation?: boolean;
  selectedChannels: readonly string[];
  imageSettingsByChannel?: Record<string, unknown>;
  onError?: (message: string) => void;
  onPreparedMedia?: (media: readonly MediaWorkspaceMediaSummary[]) => void;
};

type PublicationPreparationSettings = {
  imageSettingsByChannel?: Record<string, unknown>;
  videoSettingsByChannel?: Record<string, unknown>;
  selectedChannels?: readonly string[];
  requestedMediaType?: "images" | "video";
  deferUntilReady?: boolean;
  generateMissingVideoVariants?: boolean;
  mediaPipelineCutoverV1?: boolean;
  allowOriginalVideoFallback?: boolean;
};

export type PersistentWorkspaceSourceExpectation = {
  mediaType: "image" | "video";
  count: number;
};

const MEDIA_PREPARATION_POLL_INTERVAL_MS = 6_000;
const MEDIA_PREPARATION_MAX_WAIT_MS = 30 * 60 * 1_000;

function waitForPreparationPoll(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    String((error as { name?: unknown })?.name || "") === "AbortError"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default function usePersistentMediaWorkspace({
  draftId,
  creationMode,
  eagerImagePreparation = false,
  selectedChannels,
  imageSettingsByChannel,
  onError,
  onPreparedMedia,
}: UsePersistentMediaWorkspaceParams) {
  const enabled = isUniversalMediaWorkspaceEnabled();
  const [reference, setReference] = useState<MediaWorkspaceReference | null>(
    null,
  );
  const [mediaStates, setMediaStates] = useState<
    Record<string, PersistentWorkspaceMediaState>
  >({});
  const [synchronizing, setSynchronizing] = useState(false);
  const [imagePreparationError, setImagePreparationError] = useState("");
  const [clientWorkspaceKey, setClientWorkspaceKey] = useState("");
  const mediaStatesRef = useRef<Record<string, PersistentWorkspaceMediaState>>({});
  const referenceRef = useRef<MediaWorkspaceReference | null>(null);
  const ensurePromiseRef = useRef<Promise<MediaWorkspaceReference> | null>(null);
  const clientWorkspaceKeyRef = useRef("");
  const operationClockRef = useRef(createWorkspaceMediaMutationClock());
  const operationVersionRef = useRef(0);
  const operationAbortRef = useRef<
    Partial<Record<WorkspaceMediaFamily, AbortController>>
  >({});
  const globalClearAbortRef = useRef<AbortController | null>(null);
  const activeTaskRef = useRef<Promise<void>>(Promise.resolve());
  const activeFamilyTaskRef = useRef<
    Partial<Record<WorkspaceMediaFamily, Promise<void>>>
  >({});
  const activePreparationRef = useRef<
    Partial<
      Record<
        Exclude<BoosterMediaPipelineMission, "source_metadata">,
        Promise<MediaWorkspacePreparationResult>
      >
    >
  >({});
  const missionReadyRef = useRef({
    ai_preparation: false,
    publication_preparation: false,
  });
  const activeUploadFailureRef = useRef<Record<WorkspaceMediaFamily, string>>({
    image: "",
    video: "",
  });
  const selectedChannelsRef = useRef(selectedChannels);
  const imageSettingsByChannelRef = useRef(imageSettingsByChannel);
  const videoSettingsByChannelRef = useRef<
    Record<string, unknown> | undefined
  >(undefined);
  const creationModeRef = useRef(creationMode);
  const onPreparedMediaRef = useRef(onPreparedMedia);

  const resetMissionReadiness = useCallback(() => {
    missionReadyRef.current.ai_preparation = false;
    missionReadyRef.current.publication_preparation = false;
    activePreparationRef.current = {};
    setImagePreparationError("");
  }, []);

  const refreshActiveTaskAggregate = useCallback(() => {
    const tasks = Array.from(
      new Set(Object.values(activeFamilyTaskRef.current)),
    );
    activeTaskRef.current = tasks.length
      ? Promise.all(tasks).then(() => undefined)
      : Promise.resolve();
  }, []);

  const resolveClientWorkspaceKey = useCallback(() => {
    if (clientWorkspaceKeyRef.current) {
      return clientWorkspaceKeyRef.current;
    }

    const nextClientWorkspaceKey = getOrCreateBoosterWorkspaceClientKey(draftId);
    clientWorkspaceKeyRef.current = nextClientWorkspaceKey;
    setClientWorkspaceKey(nextClientWorkspaceKey);
    return nextClientWorkspaceKey;
  }, [draftId]);

  const ensureWorkspace = useCallback(async () => {
    if (!enabled) return null;
    if (referenceRef.current) return referenceRef.current;
    if (ensurePromiseRef.current) return await ensurePromiseRef.current;

    const clientWorkspaceKey = resolveClientWorkspaceKey();
    const promise = ensureMediaPublicationWorkspace({
      clientWorkspaceKey,
      draftId,
      selectedChannels: selectedChannelsRef.current,
    })
      .then((next) => {
        referenceRef.current = next;
        setReference(next);
        return next;
      })
      .finally(() => {
        ensurePromiseRef.current = null;
      });
    ensurePromiseRef.current = promise;
    return await promise;
  }, [draftId, enabled, resolveClientWorkspaceKey]);

  const adoptWorkspace = useCallback(
    (workspaceId: unknown, clientWorkspaceKey?: unknown) => {
      const cleanWorkspaceId = String(workspaceId || "").trim();
      if (!cleanWorkspaceId) return;
      const cleanClientKey = String(clientWorkspaceKey || "").trim();
      const next: MediaWorkspaceReference = {
        workspaceId: cleanWorkspaceId,
        clientWorkspaceKey: cleanClientKey || resolveClientWorkspaceKey(),
      };
      const invalidation = beginWorkspaceGlobalClear(operationClockRef.current);
      operationClockRef.current = invalidation.clock;
      operationVersionRef.current = invalidation.clock.revision;
      resetMissionReadiness();
      Object.values(operationAbortRef.current).forEach((controller) =>
        controller?.abort(),
      );
      operationAbortRef.current = {};
      globalClearAbortRef.current?.abort();
      globalClearAbortRef.current = null;
      ensurePromiseRef.current = null;
      activeFamilyTaskRef.current = {};
      activeTaskRef.current = Promise.resolve();
      activeUploadFailureRef.current = { image: "", video: "" };
      mediaStatesRef.current = {};
      setMediaStates({});
      setSynchronizing(false);
      clientWorkspaceKeyRef.current = next.clientWorkspaceKey;
      setClientWorkspaceKey(next.clientWorkspaceKey);
      referenceRef.current = next;
      setReference(next);
    },
    [resetMissionReadiness, resolveClientWorkspaceKey],
  );

  const refreshPreparedMedia = useCallback(
    async (
      workspaceId: string,
      operationVersion = operationVersionRef.current,
    ) => {
      const snapshot = await loadMediaPublicationWorkspace({
        workspaceId,
        includeUrls: true,
      });
      // Une lecture lancée pour l'ancien lot peut terminer après un nouvel
      // ajout, une restauration de brouillon ou un archivage. Elle ne doit
      // jamais réinjecter ces anciens médias dans l'interface courante.
      if (
        operationVersion === operationVersionRef.current &&
        referenceRef.current?.workspaceId === workspaceId
      ) {
        onPreparedMediaRef.current?.(snapshot.media);
      }
      return snapshot;
    },
    [],
  );

  const scheduleSync = useCallback(
    async (
      files: readonly File[],
      mediaType: "image" | "video",
      metadataByIndex?: readonly Record<string, unknown>[],
    ) => {
      if (!enabled) return;

      const transition = beginWorkspaceFamilyMutation(
        operationClockRef.current,
        mediaType,
      );
      operationClockRef.current = transition.clock;
      const operationVersion = transition.token.revision;
      operationVersionRef.current = operationVersion;
      const isCurrentOperation = () =>
        isWorkspaceMediaMutationCurrent(
          operationClockRef.current,
          transition.token,
        );
      setSynchronizing(true);
      resetMissionReadiness();
      activeUploadFailureRef.current[mediaType] = "";
      operationAbortRef.current[mediaType]?.abort();
      const controller = new AbortController();
      operationAbortRef.current[mediaType] = controller;
      const previousTask =
        activeFamilyTaskRef.current[mediaType] || Promise.resolve();

      const task = (async () => {
        await previousTask.catch(() => undefined);
        if (!isCurrentOperation()) return;

        const workspace = await ensureWorkspace();
        if (!workspace || !isCurrentOperation()) return;

        await clearMediaPublicationWorkspace({
          workspaceId: workspace.workspaceId,
          mediaType,
          reason: files.length
            ? `activate_${mediaType}_media`
            : `remove_${mediaType}_media`,
          signal: controller.signal,
        });
        if (!isCurrentOperation()) return;

        const entries = files.map((file, metadataIndex) => ({
          file,
          metadataIndex,
          // Positions 0..4 are reserved for images; the optional video lives
          // at 5 so both families can coexist durably in one workspace.
          position: getWorkspaceSourcePosition(mediaType, metadataIndex),
          localKey: buildWorkspaceMediaClientKey(
            workspace.clientWorkspaceKey,
            file,
          ),
        }));
        const queuedStates = Object.fromEntries(
          entries.map(({ localKey, position }) => [
            localKey,
            {
              localKey,
              mediaId: null,
              mediaType,
              position,
              status: "queued" as const,
              progress: 0,
              storagePath: "",
              error: "",
            },
          ]),
        ) as Record<string, PersistentWorkspaceMediaState>;
        setMediaStates((current) => {
          if (!isCurrentOperation()) return current;
          const next = replaceWorkspaceMediaFamilyStates(
            current,
            mediaType,
            queuedStates,
          );
          mediaStatesRef.current = next;
          return next;
        });
        if (!files.length) return;

        let nextPosition = 0;
        const uploadNext = async () => {
          while (nextPosition < entries.length) {
            const entryIndex = nextPosition;
            nextPosition += 1;
            if (!isCurrentOperation()) return;
            const { file, position, metadataIndex, localKey } =
              entries[entryIndex];
            const rawSettings = asRecord(metadataByIndex?.[metadataIndex]);
            const nestedSource = asRecord(rawSettings.source_metadata);
            const sourceMetadata = buildBoosterSourceMediaMetadata({
              file,
              mediaType,
              creationMode: creationModeRef.current,
              source: Object.keys(nestedSource).length
                ? nestedSource
                : rawSettings,
              mediaSettings: rawSettings,
            });

            try {
              const result = await uploadUniversalMediaFile(file, {
                target: "workspace_source",
                workspaceId: workspace.workspaceId,
                workspacePosition: position,
                clientMediaKey: localKey,
                source: "booster_workspace",
                // L'interface possède déjà la progression XHR locale. Écrire
                // chaque palier en base surchargeait Supabase et déclenchait
                // inutilement les abonnements temps réel du profil.
                persistProgress: false,
                signal: controller.signal,
                metadata: {
                  ...sourceMetadata,
                  selected_channels: selectedChannelsRef.current,
                  media_settings: rawSettings,
                  source_metadata: sourceMetadata,
                  inserted_from: "booster",
                  inserted_at: new Date().toISOString(),
                },
                onProgress: (progress) => {
                  if (!isCurrentOperation()) return;
                  setMediaStates((current) => {
                    if (!isCurrentOperation()) return current;
                    const next = {
                      ...current,
                      [localKey]: {
                        ...(current[localKey] || {
                          localKey,
                          mediaId: null,
                          mediaType,
                          position,
                          storagePath: "",
                          error: "",
                        }),
                        status: "uploading" as const,
                        progress: progress.percent,
                      },
                    };
                    mediaStatesRef.current = next;
                    return next;
                  });
                },
              });
              if (!isCurrentOperation()) return;
              setMediaStates((current) => {
                if (!isCurrentOperation()) return current;
                const next = {
                  ...current,
                  [localKey]: {
                    localKey,
                    mediaId: result.mediaId,
                    mediaType,
                    position,
                    status: "ready" as const,
                    progress: 100,
                    storagePath: result.storagePath,
                    error: "",
                  },
                };
                mediaStatesRef.current = next;
                return next;
              });
            } catch (error) {
              if (
                isAbortError(error) ||
                !isCurrentOperation()
              ) {
                return;
              }
              const message =
                error instanceof Error
                  ? error.message
                  : "L’envoi immédiat du média a échoué.";
              activeUploadFailureRef.current[mediaType] = message;
              setMediaStates((current) => {
                if (!isCurrentOperation()) return current;
                const next = {
                  ...current,
                  [localKey]: {
                    ...(current[localKey] || {
                      localKey,
                      mediaId: null,
                      mediaType,
                      position,
                      storagePath: "",
                    }),
                    status: "failed" as const,
                    progress: 0,
                    error: message,
                  },
                };
                mediaStatesRef.current = next;
                return next;
              });
              onError?.(message);
            }
          }
        };

        const uploadConcurrency = Math.min(
          mediaType === "video" ? 1 : 3,
          entries.length,
        );
        await Promise.all(
          Array.from({ length: uploadConcurrency }, () => uploadNext()),
        );

        if (
          isCurrentOperation() &&
          !activeUploadFailureRef.current[mediaType]
        ) {
          if (
            mediaType === "image" &&
            entries.some(({ file }) => requiresBoosterServerImagePreview(file))
          ) {
            // Une vignette serveur ne doit pas retenir le bouton Générer ou
            // Publier : la source est déjà stockée et l'aperçu local existe.
            void prepareMediaWorkspaceSourcePreviews({
              workspaceId: workspace.workspaceId,
              signal: controller.signal,
            }).catch((error) => {
              if (!isAbortError(error)) {
                console.warn(
                  "[media-pipeline] interface thumbnail deferred",
                  error,
                );
              }
            });
          }
          // Le snapshot enrichi sert au confort de l'interface, pas à la
          // validité de l'upload. On le rafraîchit sans allonger le chemin
          // critique utilisateur.
          void refreshPreparedMedia(
            workspace.workspaceId,
            operationVersion,
          ).catch((error) => {
            if (!isAbortError(error)) {
              console.warn("[media-pipeline] source snapshot deferred", error);
            }
          });
        }
      })()
        .catch((error) => {
          if (!isAbortError(error)) {
            onError?.(
              error instanceof Error
                ? error.message
                : "Impossible de synchroniser l’espace média.",
            );
          }
        })
        .finally(() => {
          if (operationAbortRef.current[mediaType] === controller) {
            delete operationAbortRef.current[mediaType];
          }
          if (activeFamilyTaskRef.current[mediaType] === task) {
            delete activeFamilyTaskRef.current[mediaType];
            refreshActiveTaskAggregate();
          }
          if (
            !Object.keys(operationAbortRef.current).length &&
            !globalClearAbortRef.current
          ) {
            setSynchronizing(false);
          }
        });

      activeFamilyTaskRef.current[mediaType] = task;
      refreshActiveTaskAggregate();
      await task;
    },
    [
      enabled,
      ensureWorkspace,
      onError,
      refreshActiveTaskAggregate,
      refreshPreparedMedia,
      resetMissionReadiness,
    ],
  );

  const syncImages = useCallback(
    async (
      files: readonly File[],
      metadataByIndex?: readonly Record<string, unknown>[],
    ) => await scheduleSync(files, "image", metadataByIndex),
    [scheduleSync],
  );

  const syncVideo = useCallback(
    async (file: File | null, metadata?: Record<string, unknown>) =>
      await scheduleSync(file ? [file] : [], "video", metadata ? [metadata] : []),
    [scheduleSync],
  );

  const runPreparationMission = useCallback(
    async (
      mission: "ai_preparation" | "publication_preparation",
    ): Promise<MediaWorkspacePreparationResult> => {
      if (!enabled) {
        throw new Error("Le workspace média persistant n’est pas activé.");
      }
      await activeTaskRef.current;
      const uploadFailure = getWorkspaceMediaFamilyFailure(
        activeUploadFailureRef.current,
      );
      if (uploadFailure) {
        throw new Error(uploadFailure);
      }
      const workspace = await ensureWorkspace();
      if (!workspace) {
        throw new Error("Impossible de préparer l’espace média.");
      }

      const existing = activePreparationRef.current[mission];
      if (existing) return await existing;

      const operationVersion = operationVersionRef.current;
      const task: Promise<MediaWorkspacePreparationResult> = (async () => {
        const refreshedReadyImageIds = new Set<string>();
        const refreshReadyImagePreviews = async (
          media: readonly MediaWorkspaceMediaSummary[],
        ) => {
          const newReadyImages = media.filter(
            (item) =>
              item.mediaType === "image" &&
              item.processingStatus === "ready" &&
              !refreshedReadyImageIds.has(item.mediaId),
          );
          if (!newReadyImages.length) return;
          try {
            const snapshot = await refreshPreparedMedia(
              workspace.workspaceId,
              operationVersion,
            );
            for (const item of snapshot.media) {
              if (
                item.mediaType === "image" &&
                item.processingStatus === "ready" &&
                (item.previewUrl || item.canonicalUrl)
              ) {
                refreshedReadyImageIds.add(item.mediaId);
              }
            }
          } catch {
            // La prochaine lecture de mission retentera l'aperçu signé.
          }
        };
        let result = await prepareMediaPublicationWorkspace({
          workspaceId: workspace.workspaceId,
          mission,
          dispatchWorker: true,
        });
        onPreparedMediaRef.current?.(result.media);
        if (result.status !== "ready") {
          await refreshReadyImagePreviews(result.media);
        }
        const deadlineAt = Date.now() + MEDIA_PREPARATION_MAX_WAIT_MS;

        // The first request only commits and kicks durable work. Keep one
        // deduplicated client promise alive so a later Generate click reuses it
        // instead of creating a second job or requiring a second click.
        while (
          (result.status === "processing" || result.status === "uploading") &&
          operationVersion === operationVersionRef.current &&
          Date.now() < deadlineAt
        ) {
          await waitForPreparationPoll(MEDIA_PREPARATION_POLL_INTERVAL_MS);
          if (operationVersion !== operationVersionRef.current) break;
          try {
            result = await prepareMediaPublicationWorkspace({
              workspaceId: workspace.workspaceId,
              mission,
              dispatchWorker: false,
            });
            onPreparedMediaRef.current?.(result.media);
            if (result.status !== "ready") {
              await refreshReadyImagePreviews(result.media);
            }
          } catch (error) {
            if (!isMediaWorkspacePollingRetryableError(error)) throw error;
            // A transient status read never cancels the already durable worker.
            console.warn("[media-pipeline] preparation status retry", {
              workspaceId: workspace.workspaceId,
              mission,
              error,
            });
          }
        }

        if (result.status === "ready") {
          missionReadyRef.current[mission] = true;
        }
        if (operationVersion === operationVersionRef.current) {
          await refreshPreparedMedia(
            workspace.workspaceId,
            operationVersion,
          ).catch(() => undefined);
        }
        return result;
      })()
        .finally(() => {
          if (activePreparationRef.current[mission] === task) {
            delete activePreparationRef.current[mission];
          }
        });
      activePreparationRef.current[mission] = task;
      return await task;
    },
    [enabled, ensureWorkspace, refreshPreparedMedia],
  );

  const prepareAiMedia = useCallback(async () => {
    if (creationModeRef.current !== "ai") {
      throw new Error(
        "La préparation IA est disponible uniquement dans le mode Créer avec iNrCy.",
      );
    }
    return await runPreparationMission("ai_preparation");
  }, [runPreparationMission]);

  useEffect(() => {
    if (!enabled || creationMode !== "ai") return;
    const videoStates = Object.values(mediaStates).filter(
      (item) => item.mediaType === "video",
    );
    if (
      !videoStates.length ||
      videoStates.some((item) => item.status !== "ready") ||
      missionReadyRef.current.ai_preparation ||
      activePreparationRef.current.ai_preparation
    ) {
      return;
    }

    // Dès que la source est entièrement stockée, les captures IA chauffent
    // depuis Supabase pendant que le pro rédige/relit. `runPreparationMission`
    // déduplique l'appel : le clic Générer réutilise exactement la même
    // promesse au lieu de créer un second job ou de ré-uploader la vidéo.
    void prepareAiMedia().catch((error) => {
      console.warn("[media-pipeline] video AI prewarm deferred", error);
    });
  }, [creationMode, enabled, mediaStates, prepareAiMedia]);

  const preparePublicationMedia = useCallback(
    async () => await runPreparationMission("publication_preparation"),
    [runPreparationMission],
  );

  useEffect(() => {
    if (!enabled || !eagerImagePreparation) return;
    const imageStates = Object.values(mediaStates).filter(
      (item) => item.mediaType === "image",
    );
    if (!imageStates.length ||
        imageStates.some((item) => item.status !== "ready") ||
        missionReadyRef.current.publication_preparation ||
        activePreparationRef.current.publication_preparation) {
      return;
    }

    // La normalisation et le premier contrôle serveur commencent dès la fin
    // de l'upload, pendant que le pro prépare son texte et sa prévisualisation.
    // Cette mission ne génère aucun contenu IA et ne publie rien.
    void preparePublicationMedia()
      .then((result) => {
        const failedImage = result.media.find(
          (item) =>
            item.mediaType === "image" &&
            (item.processingStatus === "failed_terminal" ||
              item.uploadStatus === "failed"),
        );
        if (failedImage) {
          setImagePreparationError(
            "Une image n’a pas pu être préparée. Ouvrez « Modifier Média » pour créer une nouvelle version ou remplacez-la.",
          );
        }
      })
      .catch((error) => {
        console.warn("[media-pipeline] early image preparation failed", error);
        setImagePreparationError(
          "La préparation de l’image a échoué. Réessayez en remplaçant l’image ou utilisez « Modifier Média ».",
        );
      });
  }, [eagerImagePreparation, enabled, mediaStates, preparePublicationMedia]);

  const preparePublicationVariants = useCallback(
    async (settings?: PublicationPreparationSettings) => {
      if (settings?.imageSettingsByChannel) {
        imageSettingsByChannelRef.current = settings.imageSettingsByChannel;
      }
      if (settings?.videoSettingsByChannel) {
        videoSettingsByChannelRef.current = settings.videoSettingsByChannel;
      }
      const workspaceId = referenceRef.current?.workspaceId;
      if (!enabled || !workspaceId) return;
      if (
        settings?.deferUntilReady &&
        !missionReadyRef.current.publication_preparation
      ) {
        return;
      }
      return await prewarmMediaPublicationWorkspace({
        workspaceId,
        selectedChannels:
          settings?.selectedChannels || selectedChannelsRef.current,
        requestedMediaType: settings?.requestedMediaType,
        imageSettingsByChannel: imageSettingsByChannelRef.current,
        videoSettingsByChannel: videoSettingsByChannelRef.current,
        generateMissingVideoVariants:
          settings?.generateMissingVideoVariants,
        mediaPipelineCutoverV1: settings?.mediaPipelineCutoverV1,
        allowOriginalVideoFallback: settings?.allowOriginalVideoFallback,
      });
    },
    [enabled],
  );

  const clearWorkspaceMedia = useCallback(async () => {
    if (!enabled) return;

    const transition = beginWorkspaceGlobalClear(operationClockRef.current);
    operationClockRef.current = transition.clock;
    operationVersionRef.current = transition.token.revision;
    const isCurrentOperation = () =>
      isWorkspaceMediaMutationCurrent(
        operationClockRef.current,
        transition.token,
      );

    setSynchronizing(true);
    resetMissionReadiness();
    activeUploadFailureRef.current = { image: "", video: "" };
    Object.values(operationAbortRef.current).forEach((controller) =>
      controller?.abort(),
    );
    operationAbortRef.current = {};
    globalClearAbortRef.current?.abort();
    mediaStatesRef.current = {};
    setMediaStates({});
    const controller = new AbortController();
    globalClearAbortRef.current = controller;
    const previousTasks = Array.from(
      new Set(Object.values(activeFamilyTaskRef.current)),
    );

    const task = (async () => {
      await Promise.all(
        previousTasks.map((previous) => previous.catch(() => undefined)),
      );
      if (!isCurrentOperation()) return;

      const workspace = await ensureWorkspace();
      if (!workspace || !isCurrentOperation()) return;

      await clearMediaPublicationWorkspace({
        workspaceId: workspace.workspaceId,
        mediaType: undefined,
        reason: "remove_all_media",
        signal: controller.signal,
      });
      if (!isCurrentOperation()) return;
    })()
      .catch((error) => {
        if (!isAbortError(error)) {
          onError?.(
            error instanceof Error
              ? error.message
              : "Impossible de vider l'espace média.",
          );
        }
      })
      .finally(() => {
        if (globalClearAbortRef.current === controller) {
          globalClearAbortRef.current = null;
        }
        for (const mediaType of ["image", "video"] as const) {
          if (activeFamilyTaskRef.current[mediaType] === task) {
            delete activeFamilyTaskRef.current[mediaType];
          }
        }
        refreshActiveTaskAggregate();
        if (
          !Object.keys(operationAbortRef.current).length &&
          !globalClearAbortRef.current
        ) {
          setSynchronizing(false);
        }
      });

    activeFamilyTaskRef.current = { image: task, video: task };
    refreshActiveTaskAggregate();
    await task;
  }, [
    enabled,
    ensureWorkspace,
    onError,
    refreshActiveTaskAggregate,
    resetMissionReadiness,
  ]);

  const linkDraft = useCallback(
    async (nextDraftId: string) => {
      if (!enabled || !nextDraftId) return;
      const workspace = await ensureWorkspace();
      if (!workspace) return;
      await linkMediaPublicationWorkspaceDraft({
        workspaceId: workspace.workspaceId,
        draftId: nextDraftId,
      });
    },
    [enabled, ensureWorkspace],
  );

  const waitForIdle = useCallback(
    async (
      onProgress?: (progress: number, label: string) => void,
      options?: {
        mediaTypes?: readonly WorkspaceMediaFamily[];
        tolerateFailures?: boolean;
        signal?: AbortSignal;
      },
    ) => {
      const includesFamily = (mediaType: WorkspaceMediaFamily) =>
        !options?.mediaTypes || options.mediaTypes.includes(mediaType);
      const getRelevantTask = () => {
        const tasks = options?.mediaTypes
          ? options.mediaTypes.map(
              (mediaType) => activeFamilyTaskRef.current[mediaType],
            )
          : Object.values(activeFamilyTaskRef.current);
        const activeTasks = Array.from(
          new Set(tasks.filter((task): task is Promise<void> => Boolean(task))),
        );
        return activeTasks.length
          ? Promise.all(activeTasks).then(() => undefined)
          : Promise.resolve();
      };
      while (true) {
        if (options?.signal?.aborted) throw options.signal.reason;
        const uploadFailure = getWorkspaceMediaFamilyFailure(
          activeUploadFailureRef.current,
          options?.mediaTypes,
        );
        if (uploadFailure && !options?.tolerateFailures) {
          throw new Error(uploadFailure);
        }
        const states = Object.values(mediaStatesRef.current)
          .filter((state) => includesFamily(state.mediaType))
          .sort((a, b) => a.position - b.position);
        const total = states.length;
        const averageProgress = total
          ? Math.round(
              states.reduce(
                (sum, item) =>
                  sum +
                  (item.status === "ready"
                    ? 100
                    : Math.max(0, Math.min(100, item.progress || 0))),
                0,
              ) / total,
            )
          : 0;
        const queuedCount = states.filter(
          (item) => item.status === "queued",
        ).length;
        const uploadingCount = states.filter(
          (item) => item.status === "uploading",
        ).length;
        const failedCount = states.filter((item) => item.status === "failed")
          .length;

        if (onProgress) {
          if (failedCount > 0) {
            onProgress(
              averageProgress,
              "Échec de préparation d’un média.",
            );
          } else if (queuedCount > 0 && uploadingCount === 0) {
            onProgress(
              averageProgress,
              total > 1
                ? "Initialisation des médias…"
                : "Initialisation du média…",
            );
          } else if (uploadingCount > 0 || queuedCount > 0) {
            onProgress(
              averageProgress,
              total > 1
                ? `Envoi des médias ${averageProgress}%`
                : `Envoi du média ${averageProgress}%`,
            );
          } else if (total > 0) {
            onProgress(
              100,
              total > 1 ? "Médias envoyés" : "Média envoyé",
            );
          }
        }

        const settled = await Promise.race<"done" | "tick">([
          getRelevantTask()
            .then(() => "done" as const)
            .catch(() => "done" as const),
          new Promise<"tick">((resolve) =>
            window.setTimeout(() => resolve("tick"), 220),
          ),
        ]);
        if (settled === "done") break;
      }

      await getRelevantTask().catch(() => undefined);
      const uploadFailure = getWorkspaceMediaFamilyFailure(
        activeUploadFailureRef.current,
        options?.mediaTypes,
      );
      if (uploadFailure && !options?.tolerateFailures) {
        throw new Error(uploadFailure);
      }
      const settledStates = Object.values(mediaStatesRef.current);
      const failedMedia = settledStates.find(
        (item) =>
          includesFamily(item.mediaType) && item.status === "failed",
      );
      if (failedMedia && !options?.tolerateFailures) {
        throw new Error(failedMedia.error || "L’envoi du média a échoué.");
      }
      return settledStates;
    },
    [],
  );

  const verifyReadySources = useCallback(
    async (
      expectationOrExpectations:
        | PersistentWorkspaceSourceExpectation
        | readonly PersistentWorkspaceSourceExpectation[],
      options?: { signal?: AbortSignal },
    ) => {
      if (!enabled) return null;
      const expectations = (
        Array.isArray(expectationOrExpectations)
          ? expectationOrExpectations
          : [expectationOrExpectations]
      )
        .map((expectation) => ({
          mediaType: expectation.mediaType,
          count: Math.max(0, Math.floor(expectation.count || 0)),
        }))
        .filter((expectation) => expectation.count > 0);
      if (!expectations.length) return null;

      const operationVersion = operationVersionRef.current;
      const workspace = await ensureWorkspace();
      if (!workspace) {
        throw new Error("Impossible de vérifier l'espace média.");
      }

      // Une seule lecture serveur après waitForIdle : l'état local de l'XHR
      // ne suffit pas pour garantir qu'un worker retrouvera bien les sources.
      const snapshot = await loadMediaPublicationWorkspace({
        workspaceId: workspace.workspaceId,
        includeUrls: false,
        signal: options?.signal,
      });
      if (
        operationVersion !== operationVersionRef.current ||
        referenceRef.current?.workspaceId !== workspace.workspaceId
      ) {
        throw new Error(
          "Les médias ont changé pendant leur vérification. Merci de relancer.",
        );
      }

      for (const expectation of expectations) {
        const sources = snapshot.media.filter(
          (media) => media.mediaType === expectation.mediaType,
        );
        const failedSource = sources.find(
          (media) => media.uploadStatus === "failed",
        );
        if (failedSource) {
          throw new Error(
            failedSource.processingErrorMessage ||
              "L'envoi d'un média a échoué.",
          );
        }

        const readyPositions = new Set(
          sources
            .filter(
              (media) =>
                media.uploadStatus === "uploaded" &&
                Boolean(String(media.storagePath || "").trim()),
            )
            .map((media) => media.position),
        );
        const everyExpectedSourceIsReady = Array.from(
          { length: expectation.count },
          (_, familyPosition) =>
            getWorkspaceSourcePosition(
              expectation.mediaType,
              familyPosition,
            ),
        ).every((position) => readyPositions.has(position));

        if (!everyExpectedSourceIsReady) {
          throw new Error(
            expectation.count > 1
              ? "Les médias ne sont pas encore tous disponibles sur le serveur."
              : "Le média n'est pas encore disponible sur le serveur.",
          );
        }
      }

      return snapshot;
    },
    [enabled, ensureWorkspace],
  );

  const archiveWorkspace = useCallback(async () => {
    if (!enabled) return;
    const workspace = referenceRef.current;
    const taskToStop = activeTaskRef.current;
    const invalidation = beginWorkspaceGlobalClear(operationClockRef.current);
    operationClockRef.current = invalidation.clock;
    operationVersionRef.current = invalidation.clock.revision;
    resetMissionReadiness();
    Object.values(operationAbortRef.current).forEach((controller) =>
      controller?.abort(),
    );
    operationAbortRef.current = {};
    globalClearAbortRef.current?.abort();
    globalClearAbortRef.current = null;
    activeFamilyTaskRef.current = {};
    activeTaskRef.current = Promise.resolve();
    activeUploadFailureRef.current = { image: "", video: "" };
    mediaStatesRef.current = {};
    setMediaStates({});
    setSynchronizing(false);
    await taskToStop.catch(() => undefined);
    if (!workspace) return;
    await archiveMediaPublicationWorkspace({
      workspaceId: workspace.workspaceId,
    });
    referenceRef.current = null;
    setReference(null);
    ensurePromiseRef.current = null;
    clientWorkspaceKeyRef.current = "";
    setClientWorkspaceKey("");
    clearBoosterWorkspaceClientKey();
  }, [enabled, resetMissionReadiness]);

  useEffect(() => {
    mediaStatesRef.current = mediaStates;
  }, [mediaStates]);

  useEffect(() => {
    selectedChannelsRef.current = selectedChannels;
  }, [selectedChannels]);

  useEffect(() => {
    imageSettingsByChannelRef.current = imageSettingsByChannel;
  }, [imageSettingsByChannel]);

  useEffect(() => {
    creationModeRef.current = creationMode;
  }, [creationMode]);

  useEffect(() => {
    onPreparedMediaRef.current = onPreparedMedia;
  }, [onPreparedMedia]);

  useEffect(() => {
    resolveClientWorkspaceKey();
  }, [resolveClientWorkspaceKey]);

  useEffect(() => {
    return () => {
      const invalidation = beginWorkspaceGlobalClear(operationClockRef.current);
      operationClockRef.current = invalidation.clock;
      operationVersionRef.current = invalidation.clock.revision;
      Object.values(operationAbortRef.current).forEach((controller) =>
        controller?.abort(),
      );
      operationAbortRef.current = {};
      globalClearAbortRef.current?.abort();
      globalClearAbortRef.current = null;
    };
  }, []);

  return {
    enabled,
    workspaceId: reference?.workspaceId || null,
    clientWorkspaceKey:
      reference?.clientWorkspaceKey || clientWorkspaceKey || null,
    mediaStates,
    synchronizing,
    imagePreparationError,
    ensureWorkspace,
    adoptWorkspace,
    syncImages,
    syncVideo,
    prepareAiMedia,
    preparePublicationMedia,
    preparePublicationVariants,
    // Alias conservé pendant la transition : il représente désormais
    // explicitement la mission 3 et n'est jamais déclenché à l'ajout.
    prewarmWorkspace: preparePublicationVariants,
    clearWorkspaceMedia,
    linkDraft,
    waitForIdle,
    verifyReadySources,
    archiveWorkspace,
  };
}
