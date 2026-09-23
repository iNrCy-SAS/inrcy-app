export type InrStudioTab = "generate" | "modify" | "retouch";

export type InrStudioMediaType = "image" | "video";

export type InrStudioSource = {
  mediaType: InrStudioMediaType;
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  url: string | null;
  cacheKey: string | null;
  ownsObjectUrl?: boolean;
};

export type InrStudioHandoff = {
  version: 1;
  key: string;
  tab: InrStudioTab;
  origin: string;
  createdAt: number;
  returnHref: string;
  returnKey: string;
  publicationBrief: string | null;
  source: InrStudioSource | null;
  context: Record<string, string | number | boolean | null>;
  payload: Record<string, unknown> | null;
};

export type InrStudioReturnedMedia = {
  version: 1;
  returnKey: string;
  handoffKey: string;
  action: InrStudioTab;
  createdAt: number;
  context: Record<string, string | number | boolean | null>;
  item: Record<string, unknown>;
};

type CreateInrStudioHandoffInput = {
  tab: InrStudioTab;
  origin: string;
  returnHref?: string | null;
  publicationBrief?: string | null;
  source?: {
    mediaType?: InrStudioMediaType;
    file?: File | null;
    url?: string | null;
    name?: string | null;
    mimeType?: string | null;
  } | null;
  context?: Record<string, string | number | boolean | null>;
  payload?: Record<string, unknown> | null;
};

const HANDOFF_PREFIX = "inrcy:studio:handoff:v1:";
const RETURN_PREFIX = "inrcy:studio:return:v1:";
const CACHE_NAME = "inrcy-studio-handoff-v1";
const MAX_HANDOFF_AGE_MS = 6 * 60 * 60 * 1000;

function randomKey(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function normalizeInternalHref(value: string | null | undefined) {
  const fallback = "/dashboard";
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw.slice(0, 2_000);
}

function currentInternalHref() {
  if (typeof window === "undefined") return "/dashboard";
  return normalizeInternalHref(
    `${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}

function cacheRequest(cacheKey: string) {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new Request(
    `${origin}/__inrcy_studio_handoff__/${encodeURIComponent(cacheKey)}`
  );
}

async function persistSourceFile(cacheKey: string, file: File) {
  if (typeof window === "undefined" || !("caches" in window)) return false;
  try {
    const cache = await window.caches.open(CACHE_NAME);
    await cache.put(
      cacheRequest(cacheKey),
      new Response(file, {
        headers: { "content-type": file.type || "application/octet-stream" },
      })
    );
    return true;
  } catch {
    return false;
  }
}

async function readPersistedSourceFile(source: InrStudioSource) {
  if (
    !source.cacheKey ||
    typeof window === "undefined" ||
    !("caches" in window)
  ) {
    return null;
  }
  try {
    const cache = await window.caches.open(CACHE_NAME);
    const response = await cache.match(cacheRequest(source.cacheKey));
    if (!response) return null;
    const blob = await response.blob();
    return new File(
      [blob],
      source.name || (source.mediaType === "video" ? "video.mp4" : "image"),
      {
        type:
          source.mimeType ||
          blob.type ||
          (source.mediaType === "video" ? "video/mp4" : "image/jpeg"),
        lastModified: source.lastModified || Date.now(),
      }
    );
  } catch {
    return null;
  }
}

function isFresh(createdAt: number) {
  return (
    Number.isFinite(createdAt) &&
    createdAt > 0 &&
    Date.now() - createdAt <= MAX_HANDOFF_AGE_MS
  );
}

export async function createInrStudioHandoff(
  input: CreateInrStudioHandoffInput
) {
  if (typeof window === "undefined") {
    throw new Error("iNrStudio doit être ouvert depuis le navigateur.");
  }

  const key = randomKey("handoff");
  const returnKey = randomKey("return");
  const sourceFile = input.source?.file || null;
  const cacheKey = sourceFile ? key : null;
  const cached = sourceFile
    ? await persistSourceFile(cacheKey as string, sourceFile)
    : false;
  const fallbackUrl = String(input.source?.url || "").trim() || null;
  const mediaType: InrStudioMediaType =
    input.source?.mediaType === "video" ? "video" : "image";
  // Conserver aussi une URL locale quand le fichier a bien été placé dans le
  // Cache API. iNrStudio peut ainsi afficher l'aperçu immédiatement pendant
  // que la copie binaire durable est relue en arrière-plan.
  const sourceUrl =
    fallbackUrl || (sourceFile ? URL.createObjectURL(sourceFile) : null);
  const source: InrStudioSource | null = input.source
    ? {
        mediaType,
        name: String(
          input.source.name ||
            sourceFile?.name ||
            (mediaType === "video" ? "video-inrstudio.mp4" : "image-inrstudio")
        ).slice(0, 240),
        mimeType: String(
          input.source.mimeType ||
            sourceFile?.type ||
            (mediaType === "video" ? "video/mp4" : "image/jpeg")
        ).slice(0, 120),
        size: Number(sourceFile?.size || 0),
        lastModified: Number(sourceFile?.lastModified || Date.now()),
        url: sourceUrl,
        cacheKey: cached ? cacheKey : null,
        ownsObjectUrl: !fallbackUrl && Boolean(sourceFile),
      }
    : null;

  const handoff: InrStudioHandoff = {
    version: 1,
    key,
    tab: input.tab,
    origin: String(input.origin || "dashboard").slice(0, 80),
    createdAt: Date.now(),
    returnHref: normalizeInternalHref(
      input.returnHref || currentInternalHref()
    ),
    returnKey,
    publicationBrief:
      String(input.publicationBrief || "")
        .trim()
        .slice(0, 1_600) || null,
    source,
    context: input.context || {},
    payload: input.payload || null,
  };

  try {
    window.sessionStorage.setItem(
      `${HANDOFF_PREFIX}${key}`,
      JSON.stringify(handoff)
    );
  } catch (error) {
    if (source?.ownsObjectUrl && source.url) URL.revokeObjectURL(source.url);
    if (cached && cacheKey) {
      try {
        const cache = await window.caches.open(CACHE_NAME);
        await cache.delete(cacheRequest(cacheKey));
      } catch {}
    }
    throw error;
  }

  const query = new URLSearchParams({
    studio_tab: input.tab,
    studio_handoff: key,
  });
  return {
    handoff,
    href: `/dashboard/generer-media?${query.toString()}`,
  };
}

export function readInrStudioHandoff(
  key: string | null | undefined
): InrStudioHandoff | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${HANDOFF_PREFIX}${key}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as InrStudioHandoff;
    if (
      value?.version !== 1 ||
      value.key !== key ||
      !["generate", "modify", "retouch"].includes(value.tab) ||
      (value.source && !["image", "video"].includes(value.source.mediaType)) ||
      !isFresh(Number(value.createdAt))
    ) {
      window.sessionStorage.removeItem(`${HANDOFF_PREFIX}${key}`);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export async function loadInrStudioHandoffSourceFile(
  handoff: InrStudioHandoff
) {
  const source = handoff.source;
  if (!source) return null;
  const persisted = await readPersistedSourceFile(source);
  if (persisted) return persisted;
  if (!source.url) return null;
  // Une vidéo distante peut peser plusieurs centaines de Mo. Son URL suffit
  // au lecteur et au moteur de retouche ; inutile de la retélécharger en File
  // au chargement du Studio. Les vidéos locales passent, elles, par Cache API.
  if (source.mediaType === "video") return null;
  // L'URL peut déjà être en cours d'affichage dans un <img>. Laisser le cache
  // HTTP du navigateur mutualiser les octets évite un second téléchargement
  // forcé de la même URL signée.
  const response = await fetch(source.url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error("L’image source n’est plus disponible.");
  }
  const blob = await response.blob();
  return new File(
    [blob],
    source.name || "image-inrstudio",
    {
      // Pour une source distante, l'en-tête réellement reçu est plus fiable
      // qu'un MIME de secours fourni par l'outil d'origine.
      type: blob.type || source.mimeType || "image/jpeg",
      lastModified: source.lastModified || Date.now(),
    }
  );
}

export async function clearInrStudioHandoff(key: string | null | undefined) {
  if (!key || typeof window === "undefined") return;
  const handoff = readInrStudioHandoff(key);
  window.sessionStorage.removeItem(`${HANDOFF_PREFIX}${key}`);
  if (handoff?.source?.ownsObjectUrl && handoff.source.url?.startsWith("blob:")) {
    URL.revokeObjectURL(handoff.source.url);
  }
  if (handoff?.source?.cacheKey && "caches" in window) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      await cache.delete(cacheRequest(handoff.source.cacheKey));
    } catch {}
  }
}

export function saveInrStudioReturn(result: InrStudioReturnedMedia) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    `${RETURN_PREFIX}${result.returnKey}`,
    JSON.stringify(result)
  );
}

export function consumeInrStudioReturn(
  returnKey: string | null | undefined
): InrStudioReturnedMedia | null {
  if (!returnKey || typeof window === "undefined") return null;
  try {
    const storageKey = `${RETURN_PREFIX}${returnKey}`;
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    window.sessionStorage.removeItem(storageKey);
    const value = JSON.parse(raw) as InrStudioReturnedMedia;
    if (
      value?.version !== 1 ||
      value.returnKey !== returnKey ||
      !isFresh(Number(value.createdAt))
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function buildInrStudioReturnHref(handoff: InrStudioHandoff) {
  const [withoutHash, hash = ""] = handoff.returnHref.split("#", 2);
  const [pathname, query = ""] = withoutHash.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("studio_return", handoff.returnKey);
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ""}${
    hash ? `#${hash}` : ""
  }`;
}

export function getInrStudioOriginLabel(origin: string | null | undefined) {
  const normalized = String(origin || "").trim().toLowerCase();
  if (["booster", "publier", "booster-publish"].includes(normalized)) {
    return "Booster";
  }
  if (normalized === "inr-agent") return "iNrAgent";
  if (["inrsend", "mails", "inrsend-publish"].includes(normalized)) {
    return "iNrSend";
  }
  return "";
}

/**
 * Abandonner ferme le parcours actif sans supprimer le brouillon durable.
 * L'utilisateur retrouve donc l'outil d'origine, mais pas sa fenêtre d'édition
 * en cours. Le retour normal, lui, conserve l'URL exacte et son brouillon.
 */
export function buildInrStudioAbandonHref(handoff: InrStudioHandoff) {
  const normalized = String(handoff.origin || "").trim().toLowerCase();
  if (normalized === "inr-agent") return "/dashboard/agent";
  if (["inrsend", "mails", "inrsend-publish"].includes(normalized)) {
    return "/dashboard/mails?folder=publications";
  }
  return "/dashboard";
}
