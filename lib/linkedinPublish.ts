import { getProviderCreateFailureSafety } from "@/lib/providerMediaFallbackPolicy";
import {
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
} from "@/lib/mediaRules";

const LINKEDIN_VERSION = "202603";

type LinkedInImagePublishStats = {
  requestedImageCount?: number;
  publishedImageCount?: number;
  failedImageCount?: number;
};

type PublishOk = LinkedInImagePublishStats & {
  ok: true;
  /** LinkedIn post URN (often returned in x-restli-id header). */
  postUrn?: string;
  diagnostics?: any;
};

type PublishKo = LinkedInImagePublishStats & {
  ok: false;
  error: string;
  diagnostics?: any;
  safeTextFallback?: boolean;
  requestMayHaveSucceeded?: boolean;
};

export type LinkedInPublishResult = PublishOk | PublishKo;

async function parseResponse(res: Response) {
  const raw = await res.text().catch(() => "");
  let json: any = null;
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }
  }
  return { raw, json };
}

function linkedInHeaders(accessToken: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Restli-Protocol-Version": "2.0.0",
    "Linkedin-Version": LINKEDIN_VERSION,
    ...extra,
  };
}

async function fetchImageBlob(imageUrl: string): Promise<Blob> {
  if (imageUrl.startsWith("data:")) {
    const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) throw new Error("Image LinkedIn invalide.");
    const mime = m[1] || "image/jpeg";
    const b64 = m[2] || "";
    const buf = Buffer.from(b64, "base64");
    return new Blob([buf], { type: mime });
  }

  const imgRes = await fetch(imageUrl, { cache: "no-store" });
  if (!imgRes.ok) {
    throw new Error(`Impossible de récupérer l'image LinkedIn (${imgRes.status}).`);
  }
  const ab = await imgRes.arrayBuffer();
  const mime = imgRes.headers.get("content-type") || "image/jpeg";
  return new Blob([ab], { type: mime });
}

async function createLinkedInPost(params: {
  accessToken: string;
  payload: Record<string, unknown>;
}): Promise<LinkedInPublishResult> {
  const { accessToken, payload } = params;

  let res: Response;
  try {
    res = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: linkedInHeaders(accessToken),
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (error: any) {
    return {
      ok: false,
      error: error?.message || "Réponse LinkedIn interrompue après l'envoi.",
      ...getProviderCreateFailureSafety({ requestThrew: true }),
      diagnostics: { stage: "post_request", payload },
    };
  }

  const { raw, json } = await parseResponse(res);

  if (!res.ok) {
    const errMsg = json?.message || json?.error || raw || "Impossible de publier sur LinkedIn pour le moment.";
    return {
      ok: false,
      error: errMsg,
      ...getProviderCreateFailureSafety({ httpStatus: res.status }),
      diagnostics: { status: res.status, body: json ?? raw, payload },
    };
  }

  const postUrn = res.headers.get("x-restli-id") || json?.id;
  return { ok: true, postUrn: postUrn || undefined, diagnostics: { status: res.status, body: json ?? raw } };
}

async function uploadLinkedInImage(params: {
  accessToken: string;
  ownerUrn: string;
  imageUrl: string;
}) {
  const { accessToken, ownerUrn, imageUrl } = params;

  const initRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: linkedInHeaders(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    cache: "no-store",
  });

  const { raw: initRaw, json: initJson } = await parseResponse(initRes);
  if (!initRes.ok) {
    throw new Error(initJson?.message || initJson?.error || initRaw || "Impossible d’envoyer l’image sur LinkedIn pour le moment.");
  }

  const uploadUrl = String(initJson?.value?.uploadUrl || "");
  const imageUrn = String(initJson?.value?.image || "");
  if (!uploadUrl || !imageUrn) {
    throw new Error("LinkedIn n'a pas renvoyé les informations d'upload d'image.");
  }

  const imageBlob = await fetchImageBlob(imageUrl);
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": imageBlob.type || "image/jpeg",
    },
    body: imageBlob,
    cache: "no-store",
  });

  const uploadRaw = await uploadRes.text().catch(() => "");
  if (!uploadRes.ok) {
    throw new Error(uploadRaw || "Impossible d’envoyer l’image sur LinkedIn pour le moment.");
  }

  return { imageUrn, initJson: initJson ?? initRaw, uploadRaw };
}


export async function linkedinResharePost(params: {
  accessToken: string;
  authorUrn: string;
  parentPostUrn: string;
  commentary?: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
}): Promise<LinkedInPublishResult> {
  const { accessToken, authorUrn, parentPostUrn, visibility = "PUBLIC" } = params;
  const commentary = String(params.commentary || "");

  try {
    if (!accessToken) return { ok: false, error: "Connexion LinkedIn invalide." };
    if (!authorUrn) return { ok: false, error: "Compte LinkedIn invalide." };
    if (!parentPostUrn?.trim()) return { ok: false, error: "Publication LinkedIn à partager introuvable." };

    return await createLinkedInPost({
      accessToken,
      payload: {
        author: authorUrn,
        commentary,
        visibility,
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        reshareContext: {
          parent: parentPostUrn,
        },
      },
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "Impossible de partager la publication LinkedIn pour le moment." };
  }
}

export async function linkedinPublishText(params: {
  accessToken: string;
  authorUrn: string;
  text: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
}): Promise<LinkedInPublishResult> {
  const { accessToken, authorUrn, text, visibility = "PUBLIC" } = params;

  try {
    if (!accessToken) return { ok: false, error: "Connexion LinkedIn invalide." };
    if (!authorUrn) return { ok: false, error: "Compte LinkedIn invalide." };
    if (!text?.trim()) return { ok: false, error: "Le contenu de la publication est vide." };

    return await createLinkedInPost({
      accessToken,
      payload: {
        author: authorUrn,
        commentary: text,
        visibility,
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "Impossible de publier sur LinkedIn pour le moment." };
  }
}

export async function linkedinPublishImage(params: {
  accessToken: string;
  authorUrn: string;
  text: string;
  imageUrl: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
  title?: string;
}): Promise<LinkedInPublishResult> {
  const { accessToken, authorUrn, text, imageUrl, visibility = "PUBLIC", title } = params;

  try {
    if (!accessToken) return { ok: false, error: "Connexion LinkedIn invalide." };
    if (!authorUrn) return { ok: false, error: "Compte LinkedIn invalide." };
    if (!text?.trim()) return { ok: false, error: "Le contenu de la publication est vide." };
    if (!imageUrl?.trim()) return linkedinPublishText({ accessToken, authorUrn, text, visibility });

    const uploaded = await uploadLinkedInImage({ accessToken, ownerUrn: authorUrn, imageUrl });
    const postResult = await createLinkedInPost({
      accessToken,
      payload: {
        author: authorUrn,
        commentary: text,
        visibility,
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            altText: title || text.slice(0, 120),
            id: uploaded.imageUrn,
          },
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
    });

    if (!postResult.ok) {
      return {
        ...postResult,
        requestedImageCount: 1,
        publishedImageCount: 0,
        failedImageCount: 0,
        diagnostics: {
          stage: "post",
          imageUpload: uploaded,
          upstream: postResult.diagnostics,
        },
      };
    }

    return {
      ...postResult,
      requestedImageCount: 1,
      publishedImageCount: 1,
      failedImageCount: 0,
      diagnostics: {
        imageUpload: uploaded,
        upstream: postResult.diagnostics,
      },
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Impossible de publier l'image sur LinkedIn pour le moment.",
      safeTextFallback: true,
      requestedImageCount: 1,
      publishedImageCount: 0,
      failedImageCount: 1,
    };
  }
}

export async function linkedinPublishMultiImage(params: {
  accessToken: string;
  authorUrn: string;
  text: string;
  imageUrls: string[];
  visibility?: "PUBLIC" | "CONNECTIONS";
  title?: string;
}): Promise<LinkedInPublishResult> {
  const { accessToken, authorUrn, text, visibility = "PUBLIC", title } = params;
  const imageUrls = (params.imageUrls || []).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 20);

  try {
    if (!accessToken) return { ok: false, error: "Connexion LinkedIn invalide." };
    if (!authorUrn) return { ok: false, error: "Compte LinkedIn invalide." };
    if (!text?.trim()) return { ok: false, error: "Le contenu de la publication est vide." };
    if (imageUrls.length === 0) return linkedinPublishText({ accessToken, authorUrn, text, visibility });
    if (imageUrls.length === 1) return linkedinPublishImage({ accessToken, authorUrn, text, imageUrl: imageUrls[0], visibility, title });

    const uploadedImages = [] as Array<{
      imageUrn: string;
      initJson: any;
      uploadRaw: string;
      sourceIndex: number;
      sourceUrl: string;
    }>;
    const imageErrors: Array<{
      index: number;
      url: string;
      error: string;
    }> = [];
    for (const [index, imageUrl] of imageUrls.entries()) {
      try {
        uploadedImages.push({
          ...(await uploadLinkedInImage({
            accessToken,
            ownerUrn: authorUrn,
            imageUrl,
          })),
          sourceIndex: index,
          sourceUrl: imageUrl,
        });
      } catch (error) {
        imageErrors.push({
          index,
          url: imageUrl,
          error:
            error instanceof Error
              ? error.message
              : "Impossible d’envoyer cette image sur LinkedIn.",
        });
      }
    }

    if (!uploadedImages.length) {
      return {
        ok: false,
        error:
          imageErrors[0]?.error ||
          "Aucune image n’a pu être envoyée sur LinkedIn.",
        safeTextFallback: true,
        requestedImageCount: imageUrls.length,
        publishedImageCount: 0,
        failedImageCount: imageErrors.length,
        diagnostics: {
          stage: "imageUpload",
          uploadedImages,
          imageErrors,
        },
      };
    }

    const postResult = await createLinkedInPost({
      accessToken,
      payload: {
        author: authorUrn,
        commentary: text,
        visibility,
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content:
          uploadedImages.length === 1
            ? {
                media: {
                  id: uploadedImages[0].imageUrn,
                  altText: title || text.slice(0, 120),
                },
              }
            : {
                multiImage: {
                  images: uploadedImages.map((img, index) => ({
                    id: img.imageUrn,
                    altText:
                      index === 0
                        ? title || text.slice(0, 120)
                        : `${title || "Publication iNrCy"} ${index + 1}`,
                  })),
                },
              },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
    });

    if (!postResult.ok) {
      return {
        ...postResult,
        requestedImageCount: imageUrls.length,
        publishedImageCount: 0,
        failedImageCount: imageErrors.length,
        diagnostics: {
          stage:
            uploadedImages.length === 1
              ? "singleImagePostAfterPartialUpload"
              : "multiImagePost",
          uploadedImages,
          imageErrors,
          upstream: postResult.diagnostics,
        },
      };
    }

    return {
      ...postResult,
      requestedImageCount: imageUrls.length,
      publishedImageCount: uploadedImages.length,
      failedImageCount: imageErrors.length,
      diagnostics: {
        uploadedImages,
        imageErrors,
        upstream: postResult.diagnostics,
      },
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Impossible de publier les images sur LinkedIn pour le moment.",
      safeTextFallback: true,
      requestedImageCount: imageUrls.length,
      publishedImageCount: 0,
      failedImageCount: imageUrls.length,
    };
  }
}

type LinkedInVideoUploadInstruction = {
  uploadUrl: string;
  firstByte: number;
  lastByte: number;
};

type LinkedInVideoStatus =
  | "WAITING_UPLOAD"
  | "PROCESSING"
  | "PROCESSING_FAILED"
  | "AVAILABLE"
  | string;

const LINKEDIN_VIDEO_MAX_BYTES = INR_MEDIA_VIDEO_SOURCE_MAX_BYTES;

type LinkedInRemoteVideoSource = {
  size: number;
  mimeType: string;
};

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isLinkedInMp4Video(mimeType: string, sourceUrl: string) {
  const mime = String(mimeType || "").toLowerCase();
  const urlWithoutQuery = String(sourceUrl || "").split("?")[0].toLowerCase();
  return mime.includes("mp4") || urlWithoutQuery.endsWith(".mp4");
}

async function getLinkedInVideoStatus(params: {
  accessToken: string;
  videoUrn: string;
}) {
  const { accessToken, videoUrn } = params;
  const res = await fetch(
    `https://api.linkedin.com/rest/videos/${encodeURIComponent(videoUrn)}`,
    {
      method: "GET",
      headers: linkedInHeaders(accessToken),
      cache: "no-store",
    },
  );

  const { raw, json } = await parseResponse(res);
  if (!res.ok) {
    throw new Error(
      json?.message ||
        json?.error ||
        raw ||
        "Impossible de vérifier le statut de la vidéo LinkedIn.",
    );
  }

  const status = String(json?.status || "") as LinkedInVideoStatus;
  return { status, body: json ?? raw };
}

async function waitForLinkedInVideoAfterFinalize(params: {
  accessToken: string;
  videoUrn: string;
}) {
  const { accessToken, videoUrn } = params;
  const delays = [900, 1400, 2200, 3200, 4600, 6200, 8000];
  let lastStatus = "";
  let lastBody: any = null;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const checked = await getLinkedInVideoStatus({ accessToken, videoUrn });
    lastStatus = checked.status;
    lastBody = checked.body;

    if (lastStatus === "PROCESSING_FAILED") {
      const reason = String(checked.body?.processingFailureReason || "").trim();
      throw new Error(
        reason
          ? `LinkedIn a refusé le traitement vidéo : ${reason}`
          : "LinkedIn a refusé le traitement vidéo.",
      );
    }

    if (lastStatus === "AVAILABLE") {
      return { status: lastStatus, body: lastBody, readyForPost: true };
    }

    // Après finalize, LinkedIn peut rester quelques secondes en PROCESSING.
    // Le post est tenté après une courte attente, mais jamais en WAITING_UPLOAD.
    if (lastStatus === "PROCESSING" && attempt >= 2) {
      return { status: lastStatus, body: lastBody, readyForPost: true };
    }

    await wait(delays[attempt]);
  }

  if (lastStatus === "PROCESSING") {
    return { status: lastStatus, body: lastBody, readyForPost: true };
  }

  throw new Error(
    lastStatus === "WAITING_UPLOAD"
      ? "LinkedIn attend encore la finalisation de l'upload vidéo."
      : "LinkedIn n'a pas confirmé la disponibilité de la vidéo.",
  );
}


function parsePositiveContentLength(value: string | null) {
  const raw = String(value || "").trim();
  if (!/^\d+$/.test(raw)) return 0;
  const size = Number(raw);
  return Number.isSafeInteger(size) && size > 0 ? size : 0;
}

function parseExactContentRange(value: string | null) {
  const match = String(value || "").match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (!match) return null;
  const firstByte = Number(match[1]);
  const lastByte = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(firstByte) ||
    !Number.isSafeInteger(lastByte) ||
    !Number.isSafeInteger(total) ||
    firstByte < 0 ||
    lastByte < firstByte ||
    total <= lastByte
  ) {
    return null;
  }
  return { firstByte, lastByte, total };
}

async function cancelResponseBody(response: Response | null) {
  try {
    await response?.body?.cancel();
  } catch {
    // Best effort: a cancelled probe must never retain the remote video body.
  }
}

async function probeLinkedInVideoSource(
  videoUrl: string,
): Promise<LinkedInRemoteVideoSource> {
  if (videoUrl.startsWith("data:")) {
    throw new Error(
      "Les vidéos LinkedIn doivent provenir du stockage sécurisé iNrCy.",
    );
  }

  let size = 0;
  let mimeType = "video/mp4";
  let headResponse: Response | null = null;
  try {
    headResponse = await fetch(videoUrl, {
      method: "HEAD",
      headers: { "Accept-Encoding": "identity" },
      redirect: "follow",
      cache: "no-store",
    });
    if (headResponse.ok) {
      size = parsePositiveContentLength(
        headResponse.headers.get("content-length"),
      );
      mimeType =
        String(headResponse.headers.get("content-type") || mimeType)
          .split(";")[0]
          .trim() || mimeType;
    }
  } catch {
    // Some signed storage endpoints reject HEAD. The one-byte range probe
    // below remains bounded and yields the authoritative total.
  } finally {
    await cancelResponseBody(headResponse);
  }

  if (!size) {
    const probe = await fetch(videoUrl, {
      method: "GET",
      headers: {
        Range: "bytes=0-0",
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
      cache: "no-store",
    });
    const contentRange = parseExactContentRange(
      probe.headers.get("content-range"),
    );
    mimeType =
      String(probe.headers.get("content-type") || mimeType)
        .split(";")[0]
        .trim() || mimeType;
    await cancelResponseBody(probe);
    if (
      probe.status !== 206 ||
      !contentRange ||
      contentRange.firstByte !== 0 ||
      contentRange.lastByte !== 0
    ) {
      throw new Error(
        "Le stockage vidéo ne fournit pas une taille vérifiable pour LinkedIn.",
      );
    }
    size = contentRange.total;
  }

  if (size > LINKEDIN_VIDEO_MAX_BYTES) {
    throw new Error(
      `La vidéo LinkedIn dépasse la limite de ${INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL}.`,
    );
  }
  return { size, mimeType };
}

function normalizeLinkedInUploadInstructions(
  value: any,
  fallbackUploadUrl: string,
  fileSize: number,
): LinkedInVideoUploadInstruction[] {
  const rawInstructions = Array.isArray(value?.uploadInstructions)
    ? value.uploadInstructions
    : [];
  const instructions = rawInstructions
    .map((item: any): LinkedInVideoUploadInstruction | null => {
      const uploadUrl = String(item?.uploadUrl || "").trim();
      const firstByte = Number(item?.firstByte ?? 0);
      const lastByte = Number(item?.lastByte ?? fileSize - 1);
      if (
        !uploadUrl ||
        !Number.isSafeInteger(firstByte) ||
        !Number.isSafeInteger(lastByte) ||
        firstByte < 0 ||
        lastByte < firstByte ||
        lastByte >= fileSize
      ) {
        return null;
      }
      return { uploadUrl, firstByte, lastByte };
    })
    .filter(Boolean)
    .sort(
      (
        left: LinkedInVideoUploadInstruction,
        right: LinkedInVideoUploadInstruction,
      ) => left.firstByte - right.firstByte,
    ) as LinkedInVideoUploadInstruction[];

  if (instructions.length !== rawInstructions.length) {
    throw new Error("LinkedIn a renvoyÃ© un dÃ©coupage vidÃ©o invalide.");
  }

  const normalized = instructions.length
    ? instructions
    : fallbackUploadUrl
      ? [
          {
            uploadUrl: fallbackUploadUrl,
            firstByte: 0,
            lastByte: fileSize - 1,
          },
        ]
      : [];
  let expectedFirstByte = 0;
  for (const instruction of normalized) {
    if (instruction.firstByte !== expectedFirstByte) {
      throw new Error("LinkedIn a renvoyé un découpage vidéo incomplet.");
    }
    expectedFirstByte = instruction.lastByte + 1;
  }
  if (expectedFirstByte !== fileSize) {
    throw new Error("LinkedIn n'a pas couvert toute la vidéo à envoyer.");
  }
  return normalized;
}

async function fetchLinkedInVideoRange(params: {
  videoUrl: string;
  firstByte: number;
  lastByte: number;
  total: number;
}) {
  const expectedLength = params.lastByte - params.firstByte + 1;
  const response = await fetch(params.videoUrl, {
    method: "GET",
    headers: {
      Range: `bytes=${params.firstByte}-${params.lastByte}`,
      "Accept-Encoding": "identity",
    },
    redirect: "follow",
    cache: "no-store",
  });
  const contentRange = parseExactContentRange(
    response.headers.get("content-range"),
  );
  const declaredLength = parsePositiveContentLength(
    response.headers.get("content-length"),
  );
  if (
    response.status !== 206 ||
    !contentRange ||
    contentRange.firstByte !== params.firstByte ||
    contentRange.lastByte !== params.lastByte ||
    contentRange.total !== params.total ||
    (declaredLength > 0 && declaredLength !== expectedLength) ||
    !response.body
  ) {
    await cancelResponseBody(response);
    throw new Error(
      `Le stockage n'a pas confirmé le segment vidéo ${params.firstByte}-${params.lastByte}.`,
    );
  }
  return { response, expectedLength };
}

async function uploadLinkedInVideo(params: {
  accessToken: string;
  ownerUrn: string;
  videoUrl: string;
}) {
  const { accessToken, ownerUrn, videoUrl } = params;
  const source = await probeLinkedInVideoSource(videoUrl);
  if (!isLinkedInMp4Video(source.mimeType, videoUrl)) {
    throw new Error("LinkedIn accepte uniquement les vidéos MP4 pour ce type de publication.");
  }
  const fileSizeBytes = source.size;

  const initRes = await fetch("https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    headers: linkedInHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
        fileSizeBytes,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
    cache: "no-store",
  });

  const { raw: initRaw, json: initJson } = await parseResponse(initRes);
  if (!initRes.ok) {
    throw new Error(initJson?.message || initJson?.error || initRaw || "Impossible de préparer la vidéo LinkedIn.");
  }

  const value = initJson?.value || {};
  const videoUrn = String(value?.video || "");
  const uploadToken = String(value?.uploadToken || "");
  const uploadUrl = String(value?.uploadUrl || "");
  const instructions = normalizeLinkedInUploadInstructions(value, uploadUrl, fileSizeBytes);

  if (!videoUrn || !instructions.length) {
    throw new Error("LinkedIn n'a pas renvoyé les informations d'upload vidéo.");
  }

  const uploadedPartIds: string[] = [];
  const uploadResponses: any[] = [];

  for (const instruction of instructions) {
    const sourceRange = await fetchLinkedInVideoRange({
      videoUrl,
      firstByte: instruction.firstByte,
      lastByte: instruction.lastByte,
      total: fileSizeBytes,
    });
    const uploadRequest: RequestInit & { duplex?: "half" } = {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(sourceRange.expectedLength),
      },
      body: sourceRange.response.body as unknown as BodyInit,
      cache: "no-store",
      duplex: "half",
    };
    let uploadRes: Response;
    try {
      uploadRes = await fetch(instruction.uploadUrl, uploadRequest);
    } catch (error) {
      await cancelResponseBody(sourceRange.response);
      throw error;
    }

    const uploadRaw = await uploadRes.text().catch(() => "");
    const etag = String(uploadRes.headers.get("etag") || "").replace(/^\"|\"$/g, "");
    uploadResponses.push({ status: uploadRes.status, etag, raw: uploadRaw, firstByte: instruction.firstByte, lastByte: instruction.lastByte });

    if (!uploadRes.ok) {
      throw new Error(uploadRaw || "Impossible d’envoyer la vidéo sur LinkedIn.");
    }
    if (!etag) {
      throw new Error("LinkedIn n'a pas confirmé le segment vidéo envoyé.");
    }
    uploadedPartIds.push(etag);
  }

  const finalizeRes = await fetch("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers: linkedInHeaders(accessToken),
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken,
        uploadedPartIds,
      },
    }),
    cache: "no-store",
  });
  const { raw: finalizeRaw, json } = await parseResponse(finalizeRes);
  const finalizeJson = json ?? finalizeRaw;
  if (!finalizeRes.ok) {
    throw new Error(json?.message || json?.error || finalizeRaw || "Impossible de finaliser la vidéo LinkedIn.");
  }

  const videoStatus = await waitForLinkedInVideoAfterFinalize({
    accessToken,
    videoUrn,
  });

  return {
    videoUrn,
    initJson: initJson ?? initRaw,
    uploadResponses,
    finalizeJson,
    videoStatus,
  };
}

export async function linkedinPublishVideo(params: {
  accessToken: string;
  authorUrn: string;
  text: string;
  videoUrl: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
  title?: string;
}): Promise<LinkedInPublishResult> {
  const { accessToken, authorUrn, text, videoUrl, visibility = "PUBLIC", title } = params;

  try {
    if (!accessToken) return { ok: false, error: "Connexion LinkedIn invalide." };
    if (!authorUrn) return { ok: false, error: "Compte LinkedIn invalide." };
    if (!text?.trim()) return { ok: false, error: "Le contenu de la publication est vide." };
    if (!videoUrl?.trim()) return linkedinPublishText({ accessToken, authorUrn, text, visibility });

    const uploaded = await uploadLinkedInVideo({ accessToken, ownerUrn: authorUrn, videoUrl });
    const postResult = await createLinkedInPost({
      accessToken,
      payload: {
        author: authorUrn,
        commentary: text,
        visibility,
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            id: uploaded.videoUrn,
            title: title || undefined,
          },
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
    });

    if (!postResult.ok) {
      return {
        ...postResult,
        diagnostics: {
          stage: "videoPost",
          videoUpload: uploaded,
          upstream: postResult.diagnostics,
        },
      };
    }

    return {
      ...postResult,
      diagnostics: {
        videoUpload: uploaded,
        upstream: postResult.diagnostics,
      },
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Impossible de publier la vidéo sur LinkedIn pour le moment.",
      safeTextFallback: true,
    };
  }
}
