import { log } from "@/lib/observability/logger";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import { getProviderCreateFailureSafety } from "@/lib/providerMediaFallbackPolicy";

type PublishOk = {
  ok: true;
  postId: string;
  // Diagnostics (useful for UI + debugging)
  uploadedImages: number;
  failedImages: number;
  photoErrors?: Array<{ url: string; error: string }>;
};

type PublishKo = {
  ok: false;
  error: string;
  /** True only when no provider-side post creation could have succeeded. */
  safeTextFallback?: boolean;
  /** A timeout/ambiguous response happened after the create request was sent. */
  requestMayHaveSucceeded?: boolean;
  // Diagnostics (useful for UI + debugging)
  uploadedImages?: number;
  failedImages?: number;
  photoErrors?: Array<{ url: string; error: string }>;
};

type PublishResult = PublishOk | PublishKo;

export const FACEBOOK_IMAGE_UPLOAD_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      () => worker(),
    ),
  );
  return results;
}

/**
 * Upload one image to Facebook as an unpublished photo and return its media_fbid.
 * We prefer uploading via `source` (multipart) to avoid problems when the remote URL is not
 * publicly reachable from Meta's servers (e.g. blob: URLs, private storage, expiring URLs, etc.).
 */
async function uploadUnpublishedPhoto(params: {
  pageId: string;
  pageAccessToken: string;
  imageUrl: string;
}): Promise<{ ok: true; mediaFbid: string } | { ok: false; error: string }> {
  const { pageId, pageAccessToken, imageUrl } = params;

  try {
    let blob: Blob;

    // Support data URLs (base64)
    if (imageUrl.startsWith("data:")) {
      const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return { ok: false, error: "Image invalide." };
      const mime = m[1];
      const b64 = m[2];
      const buf = Buffer.from(b64, "base64");
      blob = new Blob([buf], { type: mime });
    } else {
      // Fetch the image server-side and upload bytes to Facebook
      const imgRes = await fetch(imageUrl, { cache: "no-store" });
      if (!imgRes.ok) {
        return { ok: false, error: "Impossible de récupérer l’image pour la publication." };
      }
      const contentType = imgRes.headers.get("content-type") || "application/octet-stream";
      const ab = await imgRes.arrayBuffer();
      blob = new Blob([ab], { type: contentType });
    }

    const form = new FormData();
    form.append("published", "false");
    form.append("access_token", pageAccessToken);
    // Facebook expects the binary in the field name `source`
    form.append("source", blob, "image");

    // IMPORTANT: post explicitly to the Page, not /me
    const uploadRes = await fetch(
      buildMetaGraphUrl(`${encodeURIComponent(pageId)}/photos`),
      { method: "POST", body: form }
    );

    const uploadJson: any = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      return { ok: false, error: uploadJson?.error?.message || "Impossible d'envoyer la photo pour le moment." };
    }

    const mediaFbid = uploadJson?.id;
    if (!mediaFbid) return { ok: false, error: "La photo n'a pas pu être enregistrée correctement." };

    return { ok: true, mediaFbid };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Impossible d'envoyer la photo pour le moment." };
  }
}

export async function facebookPublishToPage(params: {
  pageId: string;
  pageAccessToken: string;
  message: string;
  imageUrls?: string[];
}): Promise<PublishResult> {
  const { pageId, pageAccessToken, message, imageUrls = [] } = params;

  try {
    const attachedMedia: any[] = [];
    const photoErrors: Array<{ url: string; error: string }> = [];

    const uploads = await mapWithConcurrency(
      imageUrls,
      FACEBOOK_IMAGE_UPLOAD_CONCURRENCY,
      async (url) => ({
        url,
        result: await uploadUnpublishedPhoto({
          pageId,
          pageAccessToken,
          imageUrl: url,
        }),
      }),
    );

    for (const upload of uploads) {
      const { url, result: up } = upload;
      if (!up.ok) {
        // Continue with remaining images, but keep diagnostics
        log.warn("facebook_image_upload_failed", { error: up.error });
        photoErrors.push({ url, error: up.error });
        continue;
      }
      attachedMedia.push({ media_fbid: up.mediaFbid });
    }

    const feedForm = new FormData();
    feedForm.append("message", message);
    feedForm.append("access_token", pageAccessToken);

    // Attach uploaded photos (if any)
    attachedMedia.forEach((m, i) => {
      feedForm.append(`attached_media[${i}]`, JSON.stringify(m));
    });

    // IMPORTANT: post explicitly to the Page, not /me
    const feedRes = await fetch(
      buildMetaGraphUrl(`${encodeURIComponent(pageId)}/feed`),
      { method: "POST", body: feedForm }
    );

    const feedJson: any = await feedRes.json().catch(() => ({}));
    if (!feedRes.ok) {
      return {
        ok: false,
        error: feedJson?.error?.message || "Impossible de publier sur Facebook pour le moment.",
        uploadedImages: attachedMedia.length,
        failedImages: photoErrors.length,
        photoErrors: photoErrors.length ? photoErrors : undefined,
      };
    }

    return {
      ok: true,
      postId: feedJson.id,
      uploadedImages: attachedMedia.length,
      failedImages: photoErrors.length,
      photoErrors: photoErrors.length ? photoErrors : undefined,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Impossible de publier sur Facebook pour le moment.",
    };
  }
}

function normalizeHostedFacebookVideoUrl(value: string) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function facebookPublishVideoToPage(params: {
  pageId: string;
  pageAccessToken: string;
  description: string;
  videoUrl: string;
  title?: string;
}): Promise<PublishResult> {
  const { pageId, pageAccessToken, description, videoUrl, title } = params;

  if (!pageId || !pageAccessToken) {
    return {
      ok: false,
      error: "Facebook à connecter. Rendez-vous dans Canaux.",
      safeTextFallback: true,
    };
  }
  if (!videoUrl?.trim()) {
    return {
      ok: false,
      error: "Ajoutez une vidéo avant de publier sur Facebook.",
      safeTextFallback: true,
    };
  }

  const hostedVideoUrl = normalizeHostedFacebookVideoUrl(videoUrl);
  if (!hostedVideoUrl) {
    return {
      ok: false,
      error:
        "La vidéo Facebook doit d'abord être enregistrée dans l'espace média.",
      safeTextFallback: true,
    };
  }

  try {
    const form = new FormData();
    form.append("access_token", pageAccessToken);
    form.append("description", description || "");
    if (title?.trim()) form.append("title", title.trim().slice(0, 120));
    // Meta ingests the accepted original directly from the signed Supabase URL.
    // It never crosses the Vercel heap or gets downloaded a second time before
    // the provider upload.
    form.append("file_url", hostedVideoUrl);

    const uploadRes = await fetch(
      buildMetaGraphUrl(`${encodeURIComponent(pageId)}/videos`),
      { method: "POST", body: form }
    );

    const uploadJson: any = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) {
      const safety = getProviderCreateFailureSafety({
        httpStatus: uploadRes.status,
      });
      return {
        ok: false,
        error: uploadJson?.error?.message || "Impossible de publier la vidéo sur Facebook pour le moment.",
        ...safety,
      };
    }

    const videoId = String(uploadJson?.id || "");
    if (!videoId) {
      return {
        ok: false,
        error: "Facebook n'a pas renvoyé l'identifiant de la vidéo.",
        ...getProviderCreateFailureSafety({ successResponseMissingId: true }),
      };
    }

    return {
      ok: true,
      postId: videoId,
      uploadedImages: 0,
      failedImages: 0,
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Impossible de publier la vidéo sur Facebook pour le moment.",
      ...getProviderCreateFailureSafety({ requestThrew: true }),
    };
  }
}

export type FacebookVerticalVideoPlacement = "reel" | "story";

/** Publie un média vertical natif sur une Page Facebook, sans texte ni CTA. */
export async function facebookPublishVerticalVideoToPage(params: {
  pageId: string;
  pageAccessToken: string;
  videoUrl: string;
  placement: FacebookVerticalVideoPlacement;
}): Promise<PublishResult> {
  const { pageId, pageAccessToken, videoUrl, placement } = params;
  if (!pageId || !pageAccessToken) {
    return {
      ok: false,
      error: "Facebook à connecter. Rendez-vous dans Canaux.",
      safeTextFallback: true,
    };
  }
  const hostedVideoUrl = normalizeHostedFacebookVideoUrl(videoUrl);
  if (!hostedVideoUrl) {
    return {
      ok: false,
      error: "Le média Facebook doit d’abord être préparé dans la médiathèque.",
      safeTextFallback: true,
    };
  }

  const resource = placement === "story" ? "video_stories" : "video_reels";
  const endpoint = buildMetaGraphUrl(
    `${encodeURIComponent(pageId)}/${resource}`,
  );

  try {
    const start = new FormData();
    start.append("access_token", pageAccessToken);
    start.append("upload_phase", "start");
    const startResponse = await fetch(endpoint, { method: "POST", body: start });
    const startJson: any = await startResponse.json().catch(() => ({}));
    if (!startResponse.ok) {
      return {
        ok: false,
        error:
          startJson?.error?.message ||
          `Impossible de préparer ${placement === "story" ? "la Story" : "le Reel"} Facebook.`,
        ...getProviderCreateFailureSafety({ httpStatus: startResponse.status }),
      };
    }

    const videoId = String(startJson?.video_id || "").trim();
    const uploadUrl = normalizeHostedFacebookVideoUrl(startJson?.upload_url || "");
    if (!videoId || !uploadUrl) {
      return {
        ok: false,
        error: "Facebook n’a pas renvoyé les informations de transfert vidéo.",
        ...getProviderCreateFailureSafety({ successResponseMissingId: true }),
      };
    }

    const transferResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        file_url: hostedVideoUrl,
      },
    });
    const transferJson: any = await transferResponse.json().catch(() => ({}));
    if (!transferResponse.ok || transferJson?.success !== true) {
      return {
        ok: false,
        error:
          transferJson?.error?.message ||
          "Facebook n’a pas pu récupérer la vidéo préparée.",
        ...getProviderCreateFailureSafety({ httpStatus: transferResponse.status }),
      };
    }

    const finish = new FormData();
    finish.append("access_token", pageAccessToken);
    finish.append("upload_phase", "finish");
    finish.append("video_id", videoId);
    if (placement === "reel") finish.append("video_state", "PUBLISHED");
    const finishResponse = await fetch(endpoint, {
      method: "POST",
      body: finish,
    });
    const finishJson: any = await finishResponse.json().catch(() => ({}));
    if (!finishResponse.ok || finishJson?.success === false) {
      return {
        ok: false,
        error:
          finishJson?.error?.message ||
          `Impossible de publier ${placement === "story" ? "la Story" : "le Reel"} Facebook.`,
        ...getProviderCreateFailureSafety({ httpStatus: finishResponse.status }),
      };
    }

    return {
      ok: true,
      postId: String(finishJson?.post_id || videoId),
      uploadedImages: 0,
      failedImages: 0,
    };
  } catch (error: any) {
    return {
      ok: false,
      error:
        error?.message ||
        `Impossible de publier ${placement === "story" ? "la Story" : "le Reel"} Facebook.`,
      ...getProviderCreateFailureSafety({ requestThrew: true }),
    };
  }
}
