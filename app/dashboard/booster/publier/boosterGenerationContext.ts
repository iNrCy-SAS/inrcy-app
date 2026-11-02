import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { useTranslations } from "next-intl";
import type { AiPreferredEngine } from "@/lib/aiEnginePreference";
import type { BoosterCreationMode } from "@/lib/boosterCreationMode";
import type { VideoAiContextReference } from "@/lib/videoAiContextReference";
import type usePersistentMediaWorkspace from "./usePersistentMediaWorkspace";
import type { BoosterAiImagePayload, BoosterCtaDefaults, ChannelKey, ChannelPost, DisplayKey, StyleKey, ThemeKey, VideoPayload } from "./publishModal.shared";
import type { VideoFramesForAI } from "./publishModal.foundations";

export type BoosterGenerationTranslations = ReturnType<typeof useTranslations<"booster">>;
type Setter<T> = Dispatch<SetStateAction<T>>;
type Workspace = ReturnType<typeof usePersistentMediaWorkspace>;

/** Snapshot and narrow editor/media ports for one user-triggered generation.
 * The actor/account ref stays live so a late result cannot replace another account's content.
 */
export type BoosterGenerationContext = {
  intent: {
    creationMode: BoosterCreationMode | null;
    idea: string;
    publicationInstruction: string;
    selectedForGeneration: ChannelKey[];
    selectedChannels: ChannelKey[];
    selectedAiPreferredEngine: AiPreferredEngine;
    hasWrittenChannelContent: boolean;
    theme: ThemeKey;
    contentStyle: StyleKey;
  };
  media: {
    videoFile: File | null;
    videoPreviewUrl: string;
    videoDurationSeconds: number | null;
    videoStorageContext: Pick<VideoPayload, "storagePath" | "publicUrl" | "url"> | null;
    images: File[];
    useImagesForAI: boolean;
    documentFiles: File[];
    videoAiContextRef: VideoAiContextReference | null;
    getOrPrepareAiImagePayload: (file: File) => Promise<BoosterAiImagePayload>;
    getOrPrepareVideoFramesForAI: (file: File) => Promise<VideoFramesForAI>;
  };
  workspace: {
    unifiedMediaConsumptionClientAvailable: boolean;
    mediaWorkspaceId: string | null;
    waitForPersistentWorkspaceReadiness: (purpose: "generate" | "publish" | "schedule", onProgress?: (progress: number, label: string) => void, requiredMediaTypes?: readonly ("image" | "video")[], timeoutMs?: number) => Promise<string | null>;
    persistentMediaWorkspaceEnabled: boolean;
    startPersistentAiMediaPreparation: Workspace["prepareAiMedia"];
    mediaPipelineCutoverEnabled: boolean;
    ensurePersistentMediaWorkspace: Workspace["ensureWorkspace"];
  };
  editor: {
    publicationActorScopeRef: MutableRefObject<{ actorUserId: string | null; accountId: string | null }>;
    currentPostsRef: MutableRefObject<Partial<Record<ChannelKey, ChannelPost>>>;
    getDisplayPost: (key: DisplayKey) => ChannelPost;
    getLiveInstagramHashtags: () => string[];
    xHashtagsInput: string;
    ctaDefaults: BoosterCtaDefaults | null;
    setImgError: Setter<string>;
    setDuplicateFeedback: (value: null) => void;
    setPostsByChannel: Setter<Partial<Record<ChannelKey, ChannelPost>>>;
    setIdea: Setter<string>;
    setPublicationInstruction: Setter<string>;
    setXHashtagsInput: Setter<string>;
    setContentAdjustmentSession: (value: null) => void;
    setDocumentFiles: Setter<File[]>;
    setPdfAttachmentError: Setter<string>;
    pdfInputRef: MutableRefObject<HTMLInputElement | null>;
    setContentWorkspaceOpen: Setter<boolean>;
    setSynchronizedActiveChannel: (channel: ChannelKey) => void;
    scrollToContentWorkspace: () => void;
  };
};
