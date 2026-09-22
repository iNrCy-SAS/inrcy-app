"use client";

import type {
  PublicationChannelImagesState,
  PublicationEditForm,
  PublicationImageAsset,
} from "./mailboxPhase1";
import type { PublicationEditVideoState } from "./mailboxPublicationVideo.foundations";

const SNAPSHOT_PREFIX = "inrcy:inrsend:studio-editor:v1:";
const CACHE_NAME = "inrcy-inrsend-studio-editor-v1";
const MAX_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1000;

type StoredFileReference = {
  cacheKey: string;
  name: string;
  type: string;
  lastModified: number;
};

type StoredPublicationImageAsset = Omit<PublicationImageAsset, "file"> & {
  file: null;
  fileReference: StoredFileReference | null;
};

type StoredPublicationEditVideoState = Omit<
  PublicationEditVideoState,
  "file"
> & {
  file: null;
  fileReference: StoredFileReference | null;
};

type StoredPublicationEditorSnapshot = {
  version: 1;
  key: string;
  createdAt: number;
  itemId: string;
  channel: string;
  form: PublicationEditForm;
  imagesByChannel: Record<string, { assets: StoredPublicationImageAsset[] }>;
  videoByChannel: Record<string, StoredPublicationEditVideoState>;
  cacheKeys: string[];
};

export type InrSendPublicationEditorSnapshot = {
  version: 1;
  key: string;
  createdAt: number;
  itemId: string;
  channel: string;
  form: PublicationEditForm;
  imagesByChannel: Record<string, PublicationChannelImagesState>;
  videoByChannel: Record<string, PublicationEditVideoState>;
};

type SavePublicationEditorSnapshotInput = {
  itemId: string;
  channel: string;
  form: PublicationEditForm;
  imagesByChannel: Record<string, PublicationChannelImagesState>;
  videoByChannel: Record<string, PublicationEditVideoState>;
};

function randomSnapshotKey() {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `editor-${suffix}`;
}

function cacheRequest(cacheKey: string) {
  return new Request(
    `https://inrcy.local/__inrsend_studio_editor__/${encodeURIComponent(cacheKey)}`,
  );
}

function isReusableUrl(value: string | null | undefined) {
  const url = String(value || "").trim();
  return url && !url.startsWith("blob:") ? url : "";
}

async function persistFile(cacheKey: string, file: File) {
  if (typeof window === "undefined" || !("caches" in window)) {
    throw new Error(
      "Ce navigateur ne peut pas conserver les fichiers avant l’ouverture d’iNrStudio.",
    );
  }
  const cache = await window.caches.open(CACHE_NAME);
  await cache.put(
    cacheRequest(cacheKey),
    new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-iNrCy-File-Name": encodeURIComponent(file.name || "media"),
        "X-iNrCy-Last-Modified": String(file.lastModified || Date.now()),
      },
    }),
  );
}

async function restoreFile(reference: StoredFileReference | null) {
  if (!reference || typeof window === "undefined" || !("caches" in window)) {
    return null;
  }
  const cache = await window.caches.open(CACHE_NAME);
  const response = await cache.match(cacheRequest(reference.cacheKey));
  if (!response) return null;
  const blob = await response.blob();
  return new File([blob], reference.name || "media", {
    type: reference.type || blob.type || "application/octet-stream",
    lastModified: reference.lastModified || Date.now(),
  });
}

async function deleteCachedFiles(cacheKeys: readonly string[]) {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const cache = await window.caches.open(CACHE_NAME);
  await Promise.all(
    cacheKeys.map((cacheKey) => cache.delete(cacheRequest(cacheKey))),
  );
}

function parseStoredSnapshot(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPublicationEditorSnapshot;
    if (
      parsed?.version !== 1 ||
      !parsed.key ||
      !parsed.itemId ||
      !parsed.createdAt ||
      Date.now() - parsed.createdAt > MAX_SNAPSHOT_AGE_MS
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function purgeExpiredSnapshots() {
  if (typeof window === "undefined") return;
  const expired: Array<{ storageKey: string; cacheKeys: string[] }> = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const storageKey = window.sessionStorage.key(index);
    if (!storageKey?.startsWith(SNAPSHOT_PREFIX)) continue;
    const raw = window.sessionStorage.getItem(storageKey);
    let parsed: StoredPublicationEditorSnapshot | null = null;
    try {
      parsed = raw ? (JSON.parse(raw) as StoredPublicationEditorSnapshot) : null;
    } catch {
      parsed = null;
    }
    if (
      !parsed ||
      parsed.version !== 1 ||
      Date.now() - Number(parsed.createdAt || 0) > MAX_SNAPSHOT_AGE_MS
    ) {
      expired.push({
        storageKey,
        cacheKeys: Array.isArray(parsed?.cacheKeys) ? parsed.cacheKeys : [],
      });
    }
  }
  for (const entry of expired) {
    window.sessionStorage.removeItem(entry.storageKey);
    await deleteCachedFiles(entry.cacheKeys).catch(() => undefined);
  }
}

export async function saveInrSendPublicationEditorSnapshot(
  input: SavePublicationEditorSnapshotInput,
) {
  if (typeof window === "undefined") {
    throw new Error("Le brouillon iNrSend doit être conservé depuis le navigateur.");
  }

  await purgeExpiredSnapshots();
  const key = randomSnapshotKey();
  const cacheKeys: string[] = [];
  const fileReferences = new Map<File, StoredFileReference>();

  const storeFile = async (file: File | null, label: string) => {
    if (!(file instanceof File)) return null;
    const existing = fileReferences.get(file);
    if (existing) return existing;
    const cacheKey = `${key}:${label}:${cacheKeys.length}`;
    await persistFile(cacheKey, file);
    const reference: StoredFileReference = {
      cacheKey,
      name: file.name || "media",
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified || Date.now(),
    };
    cacheKeys.push(cacheKey);
    fileReferences.set(file, reference);
    return reference;
  };

  try {
    const imagesByChannel: StoredPublicationEditorSnapshot["imagesByChannel"] = {};
    for (const [channel, state] of Object.entries(input.imagesByChannel)) {
      const assets: StoredPublicationImageAsset[] = [];
      for (const [assetIndex, asset] of state.assets.entries()) {
        const fileReference = await storeFile(
          asset.file,
          `image:${channel}:${assetIndex}`,
        );
        const previewUrl =
          isReusableUrl(asset.previewUrl) ||
          isReusableUrl(asset.originalUrl) ||
          isReusableUrl(asset.sourceUrl) ||
          isReusableUrl(asset.renderedUrl);
        if (!fileReference && !previewUrl) {
          throw new Error(
            `L’image ${asset.name || assetIndex + 1} ne peut pas être conservée avant iNrStudio.`,
          );
        }
        assets.push({
          ...asset,
          previewUrl,
          file: null,
          fileReference,
        });
      }
      imagesByChannel[channel] = { assets };
    }

    const videoByChannel: StoredPublicationEditorSnapshot["videoByChannel"] = {};
    for (const [channel, state] of Object.entries(input.videoByChannel)) {
      const fileReference = await storeFile(state.file, `video:${channel}`);
      const previewUrl = isReusableUrl(state.previewUrl);
      if (!fileReference && !previewUrl && !state.removed) {
        throw new Error(
          `La vidéo ${state.name || channel} ne peut pas être conservée avant iNrStudio.`,
        );
      }
      videoByChannel[channel] = {
        ...state,
        previewUrl,
        file: null,
        fileReference,
      };
    }

    const snapshot: StoredPublicationEditorSnapshot = {
      version: 1,
      key,
      createdAt: Date.now(),
      itemId: String(input.itemId || "").trim(),
      channel: String(input.channel || "").trim(),
      form: { ...input.form },
      imagesByChannel,
      videoByChannel,
      cacheKeys,
    };
    if (!snapshot.itemId || !snapshot.channel) {
      throw new Error("La publication iNrSend à restaurer est incomplète.");
    }
    window.sessionStorage.setItem(
      `${SNAPSHOT_PREFIX}${key}`,
      JSON.stringify(snapshot),
    );
    return key;
  } catch (error) {
    await deleteCachedFiles(cacheKeys).catch(() => undefined);
    throw error;
  }
}

export async function consumeInrSendPublicationEditorSnapshot(key: string) {
  if (typeof window === "undefined") return null;
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return null;
  const storageKey = `${SNAPSHOT_PREFIX}${normalizedKey}`;
  const raw = window.sessionStorage.getItem(storageKey);
  const snapshot = parseStoredSnapshot(raw);
  if (!snapshot || snapshot.key !== normalizedKey) {
    window.sessionStorage.removeItem(storageKey);
    try {
      const invalid = raw
        ? (JSON.parse(raw) as Partial<StoredPublicationEditorSnapshot>)
        : null;
      await deleteCachedFiles(
        Array.isArray(invalid?.cacheKeys) ? invalid.cacheKeys : [],
      );
    } catch {
      // Une entrée illisible ne contient aucune référence exploitable à nettoyer.
    }
    return null;
  }

  try {
    const restoredFiles = new Map<string, File>();
    const loadFile = async (reference: StoredFileReference | null) => {
      if (!reference) return null;
      const cached = restoredFiles.get(reference.cacheKey);
      if (cached) return cached;
      const file = await restoreFile(reference);
      if (!file) {
        throw new Error(
          "Un fichier local du brouillon iNrSend n’est plus disponible.",
        );
      }
      restoredFiles.set(reference.cacheKey, file);
      return file;
    };

    const imagesByChannel: Record<string, PublicationChannelImagesState> = {};
    for (const [channel, state] of Object.entries(snapshot.imagesByChannel)) {
      const assets: PublicationImageAsset[] = [];
      for (const asset of state.assets) {
        const file = await loadFile(asset.fileReference);
        const { fileReference: _fileReference, ...storedAsset } = asset;
        assets.push({
          ...storedAsset,
          file,
          previewUrl:
            (file ? URL.createObjectURL(file) : "") ||
            isReusableUrl(storedAsset.previewUrl) ||
            isReusableUrl(storedAsset.originalUrl) ||
            isReusableUrl(storedAsset.sourceUrl),
        });
      }
      imagesByChannel[channel] = { assets };
    }

    const videoByChannel: Record<string, PublicationEditVideoState> = {};
    for (const [channel, state] of Object.entries(snapshot.videoByChannel)) {
      const file = await loadFile(state.fileReference);
      const { fileReference: _fileReference, ...storedState } = state;
      videoByChannel[channel] = {
        ...storedState,
        file,
        previewUrl:
          (file ? URL.createObjectURL(file) : "") ||
          isReusableUrl(storedState.previewUrl),
      };
    }

    const restored: InrSendPublicationEditorSnapshot = {
      version: 1,
      key: snapshot.key,
      createdAt: snapshot.createdAt,
      itemId: snapshot.itemId,
      channel: snapshot.channel,
      form: { ...snapshot.form },
      imagesByChannel,
      videoByChannel,
    };
    return restored;
  } finally {
    window.sessionStorage.removeItem(storageKey);
    await deleteCachedFiles(snapshot.cacheKeys).catch(() => undefined);
  }
}

export async function clearInrSendPublicationEditorSnapshot(key: string) {
  if (typeof window === "undefined") return;
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  const storageKey = `${SNAPSHOT_PREFIX}${normalizedKey}`;
  const raw = window.sessionStorage.getItem(storageKey);
  let cacheKeys: string[] = [];
  try {
    const parsed = raw
      ? (JSON.parse(raw) as StoredPublicationEditorSnapshot)
      : null;
    cacheKeys = Array.isArray(parsed?.cacheKeys) ? parsed.cacheKeys : [];
  } catch {
    cacheKeys = [];
  }
  window.sessionStorage.removeItem(storageKey);
  await deleteCachedFiles(cacheKeys).catch(() => undefined);
}
