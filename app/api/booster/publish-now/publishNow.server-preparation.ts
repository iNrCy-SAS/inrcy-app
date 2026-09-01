import { randomUUID } from "crypto";
import { tryDecryptToken } from "@/lib/oauthCrypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { buildAbsoluteStorageContentUrl } from "@/lib/storageContentUrl";
import {
  isGoogleBusinessMediaProviderError,
  probeGoogleBusinessMediaUrl,
} from "@/lib/googleBusinessMediaProbe";
import {
  optimizeFinalImageGeometry,
  optimizeForGoogleBusiness,
  optimizeForInstagram,
  optimizeForSiteCard,
  optimizeForSocialFeed,
} from "@/lib/imageOptimizer";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { BoosterVideoTransformedVariant } from "@/lib/boosterVideoTransforms";
import {
  BOOSTER_MAX_VIDEO_SOURCE_BYTES,
  BOOSTER_MAX_VIDEO_SOURCE_MB_LABEL,
  EMPTY_IMAGE_FORMATS,
  asRecord,
  hasFinalImageGeometryDecision,
  imageExtensionFromMime,
  type ImageOptimizationFormats,
  type ImagePayload,
  type ImageSet,
  type PersistedVideoAttachment,
} from "./publishNow.foundations";

const errMessage = (e: unknown, fallback: string) =>
  getSimpleFrenchErrorMessage(e, fallback);

export function buildInstagramPublishTokenCandidates(
  igRowLike: unknown,
  fbRowLike?: unknown,
) {
  const candidates: Array<{ source: string; accessToken: string }> = [];
  const seen = new Set<string>();

  const push = (source: string, rawEncrypted: unknown) => {
    const token = tryDecryptToken(String(rawEncrypted || "")) || "";
    if (!token || seen.has(token)) return;
    seen.add(token);
    candidates.push({ source, accessToken: token });
  };

  const ig = asRecord(igRowLike);
  const igMeta = asRecord(ig["meta"]);
  push("instagram.access_token_enc", ig["access_token_enc"]);
  push("instagram.meta.page_access_token_enc", igMeta["page_access_token_enc"]);
  push(
    "instagram.meta.standard_user_access_token_enc",
    igMeta["standard_user_access_token_enc"],
  );
  push(
    "instagram.meta.business_user_access_token_enc",
    igMeta["business_user_access_token_enc"],
  );
  push("instagram.meta.user_access_token_enc", igMeta["user_access_token_enc"]);
  push("instagram.meta.user_access_token", igMeta["user_access_token"]);

  const fb = asRecord(fbRowLike);
  const fbMeta = asRecord(fb["meta"]);
  push("facebook.access_token_enc", fb["access_token_enc"]);
  push("facebook.meta.page_access_token_enc", fbMeta["page_access_token_enc"]);
  push("facebook.meta.user_access_token_enc", fbMeta["user_access_token_enc"]);

  return candidates;
}

type ResolvedImageInput = {
  mime: string;
  buffer: Buffer;
  originalPublicUrl: string | null;
  originalPublishableUrl: string | null;
  storagePath?: string;
  bucket?: string;
};

function dataUrlToBuffer(dataUrl: string) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  const mime = match[1];
  const b64 = match[2];
  return { mime, buffer: Buffer.from(b64, "base64") };
}

async function buildUrlsFromStoragePath(
  path: string,
  bucket = "booster",
): Promise<{
  publicUrl: string | null;
  signedUrl: string | null;
  deliveryUrl: string | null;
}> {
  const nativePublicUrl =
    supabaseAdmin.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl ||
    null;
  const publicUrl = bucket === "booster" ? nativePublicUrl : null;
  const signedUrl =
    bucket === "booster"
      ? null
      : await createSafeStorageSignedUrl(bucket, path, 60 * 60);
  const deliveryUrl =
    publicUrl ||
    buildAbsoluteStorageContentUrl(bucket, path) ||
    signedUrl;
  return {
    publicUrl,
    signedUrl,
    deliveryUrl,
  };
}

export async function normalizeVideoPayload(
  input: unknown,
): Promise<{ video: PersistedVideoAttachment | null; error?: string }> {
  const raw = asRecord(input);
  if (!Object.keys(raw).length) return { video: null };

  const storagePath = String(
    raw["storagePath"] || raw["storage_path"] || raw["path"] || "",
  ).trim();
  const bucket =
    String(
      raw["bucket"] || raw["bucketName"] || raw["bucket_name"] || "booster",
    ).trim() || "booster";
  const directPublicUrl = String(raw["publicUrl"] || raw["url"] || "").trim();
  let publicUrl = directPublicUrl;
  const thumbnailStoragePath = String(
    raw["thumbnailStoragePath"] ||
      raw["thumbnail_storage_path"] ||
      raw["video_thumbnail_storage_path"] ||
      "",
  ).trim();
  const thumbnailBucket =
    String(
      raw["thumbnailBucket"] ||
        raw["thumbnail_bucket"] ||
        raw["video_thumbnail_bucket"] ||
        bucket,
    ).trim() || bucket;
  let thumbnailUrl = String(
    raw["thumbnailUrl"] || raw["thumbnail_url"] || raw["video_thumbnail_url"] || "",
  ).trim();

  if (storagePath) {
    const urls = await buildUrlsFromStoragePath(storagePath, bucket);
    publicUrl =
      bucket === "booster"
        ? urls.deliveryUrl || urls.publicUrl || publicUrl || ""
        : urls.deliveryUrl || publicUrl || urls.signedUrl || "";
  }

  if (thumbnailStoragePath) {
    const thumbnailUrls = await buildUrlsFromStoragePath(
      thumbnailStoragePath,
      thumbnailBucket,
    );
    thumbnailUrl =
      thumbnailBucket === "booster"
        ? thumbnailUrls.deliveryUrl ||
          thumbnailUrls.publicUrl ||
          thumbnailUrl ||
          ""
        : thumbnailUrls.deliveryUrl ||
          thumbnailUrl ||
          thumbnailUrls.signedUrl ||
          "";
  }

  if (!publicUrl)
    return { video: null, error: "Vidéo introuvable. Merci de la renvoyer." };

  const size = Number(raw["size"] || 0);
  if (Number.isFinite(size) && size > BOOSTER_MAX_VIDEO_SOURCE_BYTES) {
    return {
      video: null,
      error: `Vidéo trop lourde. Taille maximale : ${BOOSTER_MAX_VIDEO_SOURCE_MB_LABEL}.`,
    };
  }

  const durationRaw = Number(raw["duration"] || 0);
  const duration =
    Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null;
  const sourceMetadataRaw = asRecord(
    raw["sourceMetadata"] || raw["source_metadata"],
  );
  const sourceMetadata = {
    ...sourceMetadataRaw,
    width: Number(sourceMetadataRaw["width"] || 0) || null,
    height: Number(sourceMetadataRaw["height"] || 0) || null,
    duration:
      Number(sourceMetadataRaw["duration"] || duration || 0) || null,
  };
  const transformedVariants = Array.isArray(raw["transformedVariants"])
    ? (raw["transformedVariants"] as BoosterVideoTransformedVariant[]).filter(
        (variant: any) =>
          variant &&
          typeof variant === "object" &&
          typeof variant.publicUrl === "string" &&
          typeof variant.storagePath === "string" &&
          typeof variant.signature === "string",
      )
    : [];

  return {
    video: {
      mediaId: String(raw["mediaId"] || raw["media_id"] || "").trim() || null,
      name: String(raw["name"] || "video-inrcy.mp4"),
      type: String(raw["type"] || "video/mp4"),
      size: Number.isFinite(size) && size > 0 ? size : 0,
      duration,
      url: publicUrl,
      publicUrl,
      storagePath: storagePath || null,
      bucket,
      thumbnailUrl: thumbnailUrl || null,
      thumbnailStoragePath: thumbnailStoragePath || null,
      thumbnailBucket: thumbnailBucket || null,
      sourceMetadata,
      transformedVariants,
    },
  };
}

async function getGoogleBusinessPublishableUrl(
  path: string,
): Promise<string | null> {
  const urls = await buildUrlsFromStoragePath(path);
  for (const candidate of [
    urls.deliveryUrl,
    urls.publicUrl,
    urls.signedUrl,
  ]) {
    if (!candidate) continue;
    const probe = await probeGoogleBusinessMediaUrl({
      url: candidate,
      kind: "image",
      attempts: 3,
    });
    if (probe.ok) return candidate;
  }
  return null;
}

export function isGoogleBusinessImageError(error: unknown) {
  return isGoogleBusinessMediaProviderError(error);
}

async function resolveImageInput(
  img: ImagePayload,
): Promise<ResolvedImageInput | null> {
  if (img?.storagePath) {
    const bucket = String(img.bucket || "booster").trim() || "booster";
    const download = await supabaseAdmin.storage
      .from(bucket)
      .download(img.storagePath);
    if (download.error || !download.data) {
      throw new Error(
        download.error?.message || "Impossible de relire l'image préparée.",
      );
    }

    const arrayBuffer = await download.data.arrayBuffer();
    const mime = download.data.type || img.type || "application/octet-stream";
    const urls = await buildUrlsFromStoragePath(img.storagePath, bucket);
    const privateBucket = bucket !== "booster";
    return {
      mime,
      buffer: Buffer.from(arrayBuffer),
      originalPublicUrl: privateBucket
        ? urls.deliveryUrl || img.publicUrl || urls.signedUrl
        : urls.publicUrl || img.publicUrl || null,
      originalPublishableUrl:
        urls.deliveryUrl || img.publicUrl || urls.signedUrl,
      storagePath: img.storagePath,
      bucket,
    };
  }

  if (img?.dataUrl) {
    const parsed = dataUrlToBuffer(img.dataUrl);
    if (!parsed) return null;
    return {
      mime: parsed.mime || img.type || "application/octet-stream",
      buffer: parsed.buffer,
      originalPublicUrl: null,
      originalPublishableUrl: null,
    };
  }

  if (img?.publicUrl) {
    const res = await fetch(img.publicUrl);
    if (!res.ok) {
      throw new Error(`Impossible de télécharger l'image (${res.status}).`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      mime:
        res.headers.get("content-type") ||
        img.type ||
        "application/octet-stream",
      buffer: Buffer.from(arrayBuffer),
      originalPublicUrl: img.publicUrl,
      originalPublishableUrl: img.publicUrl,
    };
  }

  return null;
}

export async function uploadImageSet(
  userId: string,
  images: ImagePayload[],
  formats: ImageOptimizationFormats = EMPTY_IMAGE_FORMATS,
): Promise<{
  imageSet: ImageSet;
  uploadErrors: Array<{ name: string; reason: string; stage: string }>;
}> {
  const uploadedUrls: string[] = [];
  const publishableUrls: string[] = [];
  const instagramPublishableUrls: string[] = [];
  const socialFeedPublishableUrls: string[] = [];
  const siteCardPublishableUrls: string[] = [];
  const gmbPublishableUrls: string[] = [];
  const storagePaths: string[] = [];
  const publishableStoragePaths: string[] = [];
  const socialFeedStoragePaths: string[] = [];
  const imageKeys: string[] = [];
  const uploadErrors: Array<{ name: string; reason: string; stage: string }> =
    [];

  for (const img of images.slice(0, 5)) {
    const preparedStoragePath = String(img.storagePath || "").trim();
    const preparedPublicUrl = String(
      img.publicUrl || img.renderedUrl || "",
    ).trim();
    if (
      img.publicationReady === true &&
      String(img.bucket || "") === "booster" &&
      preparedStoragePath &&
      preparedPublicUrl &&
      // A generic Booster-ready file is not necessarily a Google Business
      // image. Google only accepts a narrow set of formats/sizes and fetches
      // the file itself from sourceUrl. Always read and reconvert the source
      // when a dedicated GMB derivative is requested.
      !formats.gmb
    ) {
      uploadedUrls.push(preparedPublicUrl);
      publishableUrls.push(preparedPublicUrl);
      storagePaths.push(preparedStoragePath);
      publishableStoragePaths.push(preparedStoragePath);
      imageKeys.push(String(img.imageKey || "").trim());
      if (formats.instagram) {
        instagramPublishableUrls.push(preparedPublicUrl);
      }
      if (formats.socialFeed) {
        socialFeedPublishableUrls.push(preparedPublicUrl);
        socialFeedStoragePaths.push(preparedStoragePath);
      }
      if (formats.siteCard) {
        siteCardPublishableUrls.push(preparedPublicUrl);
      }
      if (formats.gmb) {
        gmbPublishableUrls.push(preparedPublicUrl);
      }
      continue;
    }

    let source: ResolvedImageInput | null = null;
    try {
      source = await resolveImageInput(img);
    } catch (e) {
      uploadErrors.push({
        name: img?.name || "image",
        reason: errMessage(e, "Impossible de préparer l'image."),
        stage: "resolve",
      });
      continue;
    }

    if (!source) {
      uploadErrors.push({
        name: img?.name || "image",
        reason:
          "Invalid image payload (expected dataUrl, storagePath or publicUrl)",
        stage: "parse",
      });
      continue;
    }

    const parsed = { mime: source.mime, buffer: source.buffer };
    const finalGeometryLocked = hasFinalImageGeometryDecision(img);
    let originalPublicUrl = source.originalPublicUrl;
    let originalPublishableUrl = source.originalPublishableUrl;
    let sourceStoragePath = source.storagePath || "";

    const needsPublicationCopy =
      !source.storagePath || source.bucket !== "booster";
    if (needsPublicationCopy) {
      const ext = imageExtensionFromMime(parsed.mime || img.type, img.name);
      const path = `${userId}/${randomUUID()}.${ext}`;

      const up = await supabaseAdmin.storage
        .from("booster")
        .upload(path, toExactStorageArrayBuffer(parsed.buffer), {
          contentType: parsed.mime || img.type || "application/octet-stream",
          upsert: false,
        });

      if (up.error) {
        console.error("[Booster] Storage upload error:", up.error.message, {
          path,
          name: img.name,
        });
        uploadErrors.push({
          name: img?.name || "image",
          reason: up.error.message,
          stage: "upload",
        });
        continue;
      }

      const urls = await buildUrlsFromStoragePath(path);
      originalPublicUrl = urls.publicUrl;
      originalPublishableUrl = urls.deliveryUrl;
      sourceStoragePath = path;
    }

    if (originalPublicUrl) {
      uploadedUrls.push(originalPublicUrl);
      imageKeys.push(String(img.imageKey || "").trim());
    } else {
      uploadErrors.push({
        name: img?.name || "image",
        reason: "Original image public URL unavailable",
        stage: "publicUrl",
      });
    }

    if (sourceStoragePath) {
      storagePaths.push(sourceStoragePath);
      publishableStoragePaths.push(sourceStoragePath);
    }

    if (originalPublishableUrl) {
      publishableUrls.push(originalPublishableUrl);
    } else if (originalPublicUrl) {
      publishableUrls.push(originalPublicUrl);
      uploadErrors.push({
        name: img?.name || "image",
        reason: "Delivery URL unavailable, fell back to publicUrl",
        stage: "deliveryUrl",
      });
    } else {
      uploadErrors.push({
        name: img?.name || "image",
        reason: "Original image publishable URL unavailable",
        stage: "deliveryUrl",
      });
    }

    if (formats.instagram) {
      try {
        const optimized = finalGeometryLocked
          ? await optimizeFinalImageGeometry(parsed.buffer, "instagram")
          : await optimizeForInstagram(parsed.buffer);
        const igPath = `${userId}/instagram/${randomUUID()}.${optimized.extension}`;
        const igUpload = await supabaseAdmin.storage
          .from("booster")
          .upload(igPath, toExactStorageArrayBuffer(optimized.buffer), {
            contentType: optimized.mime,
            upsert: false,
          });

        if (igUpload.error) {
          uploadErrors.push({
            name: img?.name || "image",
            reason: igUpload.error.message,
            stage: "instagramUpload",
          });
        } else {
          const igUrl = (await buildUrlsFromStoragePath(igPath)).deliveryUrl;
          if (igUrl) {
            instagramPublishableUrls.push(igUrl);
          } else {
            uploadErrors.push({
              name: img?.name || "image",
              reason: "Instagram optimized image URL unavailable",
              stage: "instagramUpload",
            });
          }
        }
      } catch (optErr) {
        if (
          finalGeometryLocked &&
          (originalPublishableUrl || originalPublicUrl)
        ) {
          instagramPublishableUrls.push(
            originalPublishableUrl || originalPublicUrl || "",
          );
          uploadErrors.push({
            name: img?.name || "image",
            reason:
              "Final geometry optimizer unavailable; preserved the Booster-prepared image without fallback recrop",
            stage: "instagramGeometryPreserveFallback",
          });
        } else {
          uploadErrors.push({
            name: img?.name || "image",
            reason: errMessage(optErr, "Instagram image optimization failed"),
            stage: "instagramOptimize",
          });
        }
      }
    }

    if (formats.socialFeed) {
      try {
        const optimized = finalGeometryLocked
          ? await optimizeFinalImageGeometry(parsed.buffer, "social-feed")
          : await optimizeForSocialFeed(parsed.buffer, {
              nativeFirst: Boolean(formats.socialFeedNativeFirst),
            });
        const socialPath = `${userId}/social-feed/${randomUUID()}.${optimized.extension}`;
        const socialUpload = await supabaseAdmin.storage
          .from("booster")
          .upload(socialPath, toExactStorageArrayBuffer(optimized.buffer), {
            contentType: optimized.mime,
            upsert: false,
          });

        if (socialUpload.error) {
          uploadErrors.push({
            name: img?.name || "image",
            reason: socialUpload.error.message,
            stage: "socialFeedUpload",
          });
        } else {
          const socialUrl = (await buildUrlsFromStoragePath(socialPath))
            .deliveryUrl;
          if (socialUrl) {
            socialFeedPublishableUrls.push(socialUrl);
            socialFeedStoragePaths.push(socialPath);
          } else {
            uploadErrors.push({
              name: img?.name || "image",
              reason: "Social feed optimized image URL unavailable",
              stage: "socialFeedUpload",
            });
          }
        }
      } catch (optErr) {
        if (
          finalGeometryLocked &&
          (originalPublishableUrl || originalPublicUrl)
        ) {
          socialFeedPublishableUrls.push(
            originalPublishableUrl || originalPublicUrl || "",
          );
          if (sourceStoragePath) socialFeedStoragePaths.push(sourceStoragePath);
          uploadErrors.push({
            name: img?.name || "image",
            reason:
              "Final geometry optimizer unavailable; preserved the Booster-prepared image without fallback recrop",
            stage: "socialFeedGeometryPreserveFallback",
          });
        } else {
          uploadErrors.push({
            name: img?.name || "image",
            reason: errMessage(optErr, "Social feed image optimization failed"),
            stage: "socialFeedOptimize",
          });
        }
      }
    }

    if (formats.siteCard) {
      try {
        const optimized = await optimizeForSiteCard(parsed.buffer);
        const sitePath = `${userId}/site-card/${randomUUID()}.${optimized.extension}`;
        const siteUpload = await supabaseAdmin.storage
          .from("booster")
          .upload(sitePath, toExactStorageArrayBuffer(optimized.buffer), {
            contentType: optimized.mime,
            upsert: false,
          });

        if (siteUpload.error) {
          uploadErrors.push({
            name: img?.name || "image",
            reason: siteUpload.error.message,
            stage: "siteCardUpload",
          });
        } else {
          const siteUrl = (await buildUrlsFromStoragePath(sitePath))
            .deliveryUrl;
          if (siteUrl) {
            siteCardPublishableUrls.push(siteUrl);
          } else {
            uploadErrors.push({
              name: img?.name || "image",
              reason: "Site card optimized image URL unavailable",
              stage: "siteCardUpload",
            });
          }
        }
      } catch (optErr) {
        uploadErrors.push({
          name: img?.name || "image",
          reason: errMessage(optErr, "Site card image optimization failed"),
          stage: "siteCardOptimize",
        });
      }
    }

    if (formats.gmb) {
      try {
        const optimized = finalGeometryLocked
          ? await optimizeFinalImageGeometry(parsed.buffer, "gmb")
          : await optimizeForGoogleBusiness(parsed.buffer);
        const gmbPath = `${userId}/gmb/${randomUUID()}.${optimized.extension}`;
        const gmbUpload = await supabaseAdmin.storage
          .from("booster")
          .upload(gmbPath, toExactStorageArrayBuffer(optimized.buffer), {
            contentType: optimized.mime,
            upsert: false,
          });

        if (gmbUpload.error) {
          uploadErrors.push({
            name: img?.name || "image",
            reason: gmbUpload.error.message,
            stage: "gmbUpload",
          });
        } else {
          const gmbUrl = await getGoogleBusinessPublishableUrl(gmbPath);
          if (gmbUrl) {
            gmbPublishableUrls.push(gmbUrl);
          } else {
            uploadErrors.push({
              name: img?.name || "image",
              reason: "Google Business optimized image URL unavailable",
              stage: "gmbUpload",
            });
          }
        }
      } catch (optErr) {
        if (finalGeometryLocked) {
          const preservedUrl = sourceStoragePath
            ? await getGoogleBusinessPublishableUrl(sourceStoragePath).catch(
                () => null,
              )
            : originalPublishableUrl || originalPublicUrl;
          if (preservedUrl) {
            gmbPublishableUrls.push(preservedUrl);
            uploadErrors.push({
              name: img?.name || "image",
              reason:
                "Final geometry optimizer unavailable; preserved the Booster-prepared image without fallback recrop",
              stage: "gmbGeometryPreserveFallback",
            });
          } else {
            uploadErrors.push({
              name: img?.name || "image",
              reason: errMessage(
                optErr,
                "Google Business image optimization failed",
              ),
              stage: "gmbOptimize",
            });
          }
        } else {
          uploadErrors.push({
            name: img?.name || "image",
            reason: errMessage(
              optErr,
              "Google Business image optimization failed",
            ),
            stage: "gmbOptimize",
          });
        }
      }
    }
  }

  return {
    imageSet: {
      images: uploadedUrls,
      publishableUrls,
      instagramPublishableUrls,
      socialFeedPublishableUrls,
      siteCardPublishableUrls,
      gmbPublishableUrls,
      storagePaths,
      publishableStoragePaths,
      socialFeedStoragePaths,
      imageKeys,
    },
    uploadErrors,
  };
}

export async function getLatestIntegrationRow(
  userId: string,
  provider: string,
  source: string,
  product: string,
  columns: string,
) {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select(columns)
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("source", source)
    .eq("product", product)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : null;
}
