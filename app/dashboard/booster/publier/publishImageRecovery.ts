import type { MediaWorkspaceMediaSummary } from "@/lib/mediaWorkspaceClient";
import type { PersistentWorkspaceMediaState } from "./usePersistentMediaWorkspace";
import type { ChannelImageEditorState, ChannelKey } from "./publishModal.shared";

export type PublishImagePreparationItem = {
  imageKey: string;
  position: number;
  status: "pending" | "ready" | "failed";
  recovered: boolean;
  previewUrl: string;
  canonicalUrl: string;
};

export function resolvePublishImagePreparation(params: {
  imageKeys: readonly string[];
  clientMediaKeys: readonly string[];
  mediaStates: Readonly<Record<string, PersistentWorkspaceMediaState>>;
  preparedMedia: readonly MediaWorkspaceMediaSummary[];
}): PublishImagePreparationItem[] {
  const imageStates = Object.values(params.mediaStates).filter(
    (state) => state.mediaType === "image",
  );
  const imageMedia = params.preparedMedia.filter(
    (media) => media.mediaType === "image",
  );

  return params.imageKeys.map((imageKey, position) => {
    const clientMediaKey = params.clientMediaKeys[position] || "";
    const state = imageStates.find(
      (candidate) =>
        candidate.position === position && candidate.localKey === clientMediaKey,
    );
    const media = imageMedia.find(
      (candidate) =>
        candidate.position === position &&
        (state?.mediaId
          ? candidate.mediaId === state.mediaId
          : !imageStates.length &&
            Boolean(clientMediaKey) &&
            candidate.clientMediaKey === clientMediaKey),
    );
    const recovered = media?.imageRecovery?.kind === "truncated_jpeg" &&
      media.imageRecovery.version === 1 &&
      media.imageRecovery.requiresReview === true;
    const base = {
      imageKey,
      position,
      recovered: Boolean(recovered),
      previewUrl: String(media?.previewUrl || media?.canonicalUrl || ""),
      canonicalUrl: String(media?.canonicalUrl || ""),
    };

    if (state?.status === "failed" ||
        media?.uploadStatus === "failed" ||
        media?.processingStatus === "failed_terminal" ||
        media?.publicationStatus === "failed") {
      return { ...base, status: "failed" as const };
    }
    if (!media || media.processingStatus !== "ready") {
      return { ...base, status: "pending" as const };
    }
    if (media.requiresCanonical === true || recovered) {
      if (media.canonicalUrl === undefined || media.previewUrl === undefined) {
        return { ...base, status: "pending" as const };
      }
      if (!base.canonicalUrl || !base.previewUrl) {
        return { ...base, status: "failed" as const };
      }
    }
    return { ...base, status: "ready" as const };
  });
}

export function isCompleteMediaLibraryDownload(params: {
  status: number;
  contentRange: string | null;
  downloadedBytes: number;
  expectedBytes: number | null | undefined;
}) {
  if (params.status !== 200 || params.contentRange) return false;
  if (!Number.isFinite(params.downloadedBytes) || params.downloadedBytes <= 0) {
    return false;
  }
  const expectedBytes = Number(params.expectedBytes);
  return !Number.isFinite(expectedBytes) || expectedBytes <= 0 ||
    params.downloadedBytes === expectedBytes;
}

export function remapRestoredChannelImageEditors(
  editors: Partial<Record<ChannelKey, ChannelImageEditorState>>,
  imageKeyRemap: Readonly<Record<string, string>>,
): Partial<Record<ChannelKey, ChannelImageEditorState>> {
  if (!Object.keys(imageKeyRemap).length) return editors;
  const remap = (key: string) => imageKeyRemap[key] || key;
  const restored: Partial<Record<ChannelKey, ChannelImageEditorState>> = {};
  for (const [channel, editor] of Object.entries(editors) as [
    ChannelKey,
    ChannelImageEditorState,
  ][]) {
    if (!editor) continue;
    restored[channel] = {
      ...editor,
      imageKeys: editor.imageKeys.map(remap),
      transforms: Object.fromEntries(
        Object.entries(editor.transforms || {}).map(([key, transform]) => [
          remap(key),
          transform,
        ]),
      ),
      customizedImageKeys: editor.customizedImageKeys?.map(remap),
      synchronizedImageKeys: editor.synchronizedImageKeys?.map(remap),
    };
  }
  return restored;
}
