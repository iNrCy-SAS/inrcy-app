import { NextResponse } from "next/server";
import {
  rowToInrAgentAction,
  sanitizeInrAgentActionStatus,
  summarizeInrAgentActions,
} from "@/lib/inrAgentActions";
import { requireUser } from "@/lib/requireUser";
import { buildMediaLibraryContentUrl } from "@/lib/mediaLibraryContentUrl";
import { buildStorageContentUrl } from "@/lib/storageContentUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { textToRichMailHtml } from "@/lib/mailRichText";
import { buildVideoSettingsByChannel } from "@/lib/boosterVideoSettings";
import { randomUUID } from "crypto";
import {
  buildVideoAiContextReference,
  normalizeVideoAiContextReference,
  videoAiContextReferenceAliases,
  type VideoAiContextReference,
} from "@/lib/videoAiContextReference";
import {
  INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
} from "@/lib/mediaRules";
import {
  getDashboardEditionForAuthUser,
  premiumRequiredApiResponse,
} from "@/lib/dashboardEditionServer";
import {
  filterStandardAgentItems,
  isStandardAgentActionDescriptor,
} from "@/lib/standardAgentPolicy";
import {
  asRecord,
  buildPublishMediaAdaptation,
  buildPublishMediaReadiness,
  buildPublishPreviewTextFromPosts,
  cleanBoosterPost,
  cleanPublishChannel,
  cleanPublishHashtags,
  cleanPublishMedia,
  cleanText,
  fileExtensionFromMimeOrPath,
  isPublishAction,
  normalizePublishChannels,
  publishCanRunWithoutMedia,
  publishChannelRequiresMedia,
  publishChannelRequiresVideo,
  readPublishChannelValue,
  readPublishPost,
  type PublishChannelKey,
  type PublishDraftMedia,
} from "./actionPublishDraft.foundations";

export const runtime = "nodejs";
export const maxDuration = 90;

function isMissingTableError(
  error: { code?: string; message?: string } | null | undefined,
) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("inr_agent_actions")
  );
}

const ACTION_SELECT =
  "id, automation_key, action_type, target_tool, title, summary, preview_text, target_channels, target_themes, recipients, image_assets, payload, validation_required, execution_policy, status, scheduled_for, prepared_at, validated_at, refused_at, completed_at, last_error, created_at, updated_at";
const IMAGE_BANK_BUCKET = "inrcy-image-bank";
const MEDIA_LIBRARY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function withFreshReportDocument(payload: Record<string, unknown>) {
  const reportRecord = asRecord(payload.reportDocument);
  if (!reportRecord) return payload;

  const storagePath = String(
    reportRecord.storagePath ||
      reportRecord.storage_path ||
      reportRecord.path ||
      "",
  ).trim();
  const bucket = String(reportRecord.bucket || "inr-agent-reports").trim();
  if (!storagePath || !bucket) return payload;

  return Promise.resolve({
    ...payload,
    reportDocument: {
      ...reportRecord,
      bucket,
      storagePath,
      downloadUrl: buildStorageContentUrl(bucket, storagePath) || "",
    },
  });
}

async function refreshImageAssetUrls(assets: unknown[]) {
  return Promise.all(assets.map((asset) => refreshPublishMediaUrl(asset)));
}

function isMediaRecord(value: unknown) {
  if (typeof value === "string") return Boolean(value.trim());
  const record = asRecord(value);
  if (!record) return false;
  return Boolean(
    record.id ||
    record.mediaId ||
    record.media_id ||
    record.storagePath ||
    record.storage_path ||
    record.path ||
    record.url ||
    record.publicUrl ||
    record.src,
  );
}

async function refreshPublishMediaUrl(media: unknown) {
  const rawString = typeof media === "string" ? media.trim() : "";
  const record = rawString
    ? MEDIA_LIBRARY_ID_PATTERN.test(rawString)
      ? { id: rawString }
      : { url: rawString }
    : asRecord(media);
  if (!record) return media;

  const idCandidate = String(
    record.id || record.mediaId || record.media_id || "",
  ).trim();
  const urlCandidate = String(
    record.url || record.publicUrl || record.src || "",
  ).trim();
  const mediaLibraryId = MEDIA_LIBRARY_ID_PATTERN.test(idCandidate)
    ? idCandidate
    : MEDIA_LIBRARY_ID_PATTERN.test(urlCandidate)
      ? urlCandidate
      : "";
  if (mediaLibraryId) {
    const contentUrl = buildMediaLibraryContentUrl(mediaLibraryId) || "";
    if (contentUrl) {
      const rawName = String(
        record.name || record.title || record.filename || "",
      ).trim();
      const safeName =
        rawName && !MEDIA_LIBRARY_ID_PATTERN.test(rawName)
          ? rawName
          : String(record.kind || record.mediaType || "")
                .toLowerCase()
                .includes("video")
            ? "Vidéo iNr’Agent"
            : "Image iNr’Agent";
      return {
        ...record,
        id: mediaLibraryId,
        name: safeName,
        title: safeName,
        url: contentUrl,
        publicUrl: contentUrl,
      };
    }
  }

  const storagePath = String(
    record.storagePath || record.storage_path || record.path || "",
  ).trim();
  const bucket = String(record.bucket || IMAGE_BANK_BUCKET).trim();
  if (!storagePath || !bucket) return record;

  const url = buildStorageContentUrl(bucket, storagePath) || "";
  return {
    ...record,
    bucket,
    storagePath,
    path: storagePath,
    url,
    publicUrl: url,
  };
}

async function refreshMediaCollection(value: unknown) {
  if (!Array.isArray(value)) return value;
  return Promise.all(
    value.map((item) =>
      isMediaRecord(item) ? refreshPublishMediaUrl(item) : item,
    ),
  );
}

async function refreshImagesByChannelMediaUrls(value: unknown) {
  const imagesByChannel = asRecord(value);
  if (!imagesByChannel) return value;
  const entries = await Promise.all(
    Object.entries(imagesByChannel).map(async ([channel, media]) => [
      channel,
      Array.isArray(media)
        ? await refreshMediaCollection(media)
        : isMediaRecord(media)
          ? await refreshPublishMediaUrl(media)
          : media,
    ] as const),
  );
  return Object.fromEntries(entries);
}

async function refreshPublishPayloadMediaUrls(
  source: Record<string, unknown>,
) {
  const next = { ...source };
  for (const key of [
    "media",
    "mediaAsset",
    "image",
    "imageAsset",
    "selectedImage",
    "visual",
    "cover",
    "video",
    "videoAsset",
  ] as const) {
    if (isMediaRecord(next[key])) {
      next[key] = await refreshPublishMediaUrl(next[key]);
    }
  }
  if (Array.isArray(next.images)) {
    next.images = await refreshMediaCollection(next.images);
  }
  if (next.imagesByChannel) {
    next.imagesByChannel = await refreshImagesByChannelMediaUrls(
      next.imagesByChannel,
    );
  }
  if (next.postByChannel) {
    next.postByChannel = await refreshPostByChannelMediaUrls(
      next.postByChannel,
    );
  }
  return next;
}

async function refreshPostByChannelMediaUrls(postByChannel: unknown) {
  const posts = asRecord(postByChannel);
  if (!posts) return postByChannel;

  const nextEntries = await Promise.all(
    Object.entries(posts).map(async ([channel, value]) => {
      const post = asRecord(value);
      if (!post) return [channel, value] as const;
      const nextPost = { ...post };
      for (const key of [
        "media",
        "mediaAsset",
        "image",
        "imageAsset",
        "video",
        "videoAsset",
        "file",
        "attachment",
      ] as const) {
        if (isMediaRecord(nextPost[key]))
          nextPost[key] = await refreshPublishMediaUrl(nextPost[key]);
      }
      return [channel, nextPost] as const;
    }),
  );

  return Object.fromEntries(nextEntries);
}

async function refreshActionImageUrls(
  action: ReturnType<typeof rowToInrAgentAction>,
) {
  const imageAssets = await refreshImageAssetUrls(action.imageAssets);
  let payload = await refreshPublishPayloadMediaUrls({ ...action.payload });
  const nestedPublishPayload = asRecord(payload.publishPayload);
  if (nestedPublishPayload) {
    payload.publishPayload = await refreshPublishPayloadMediaUrls(
      nestedPublishPayload,
    );
  }
  const mediaRecord = asRecord(
    payload.media ||
      payload.mediaAsset ||
      payload.image ||
      payload.imageAsset ||
      payload.video ||
      payload.videoAsset,
  );
  if (mediaRecord) {
    const freshMedia = await refreshPublishMediaUrl(mediaRecord);
    const freshRecord = asRecord(freshMedia) || mediaRecord;
    payload.media = freshRecord;
    payload.mediaAsset = freshRecord;
    const kind = String(
      freshRecord.kind ||
        freshRecord.mediaType ||
        freshRecord.media_type ||
        freshRecord.mimeType ||
        freshRecord.type ||
        "",
    )
      .toLowerCase()
      .includes("video")
      ? "video"
      : "image";
    if (kind === "video") {
      payload.video = freshRecord;
      payload.videoAsset = freshRecord;
    } else {
      payload.image = freshRecord;
      payload.imageAsset = freshRecord;
    }
  }
  payload = await withFreshReportDocument(payload);
  return { ...action, imageAssets, payload };
}

function cleanEmail(value: unknown) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email) ? email : "";
}

function isMissingDraftMetadataColumn(
  error:
    | { code?: string; message?: string; details?: string; hint?: string }
    | null
    | undefined,
) {
  const msg = String(
    error?.message || error?.details || error?.hint || "",
  ).toLowerCase();
  return (
    error?.code === "PGRST204" ||
    msg.includes("folder") ||
    msg.includes("track_kind") ||
    msg.includes("track_type") ||
    msg.includes("template_key") ||
    msg.includes("attachments")
  );
}

function cleanDraftAttachment(item: unknown) {
  const record = asRecord(item);
  if (!record) return null;

  const bucket = cleanText(record.bucket, 120);
  const path = cleanText(
    record.path || record.storagePath || record.storage_path,
    500,
  );
  if (!bucket || !path) return null;

  return {
    bucket,
    path,
    name:
      cleanText(record.name || record.filename || record.fileName, 240) ||
      path.split("/").pop() ||
      "piece-jointe",
    type:
      cleanText(record.type || record.mimeType || record.mime_type, 140) ||
      "application/octet-stream",
    size:
      typeof record.size === "number" && Number.isFinite(record.size)
        ? record.size
        : null,
  };
}

function cleanDraftAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanDraftAttachment).filter(Boolean).slice(0, 10);
}

function recipientsToEmails(value: unknown) {
  const recipients = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const emails: string[] = [];

  for (const item of recipients) {
    const record = asRecord(item);
    const email = cleanEmail(record?.email || item);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  return emails;
}

type CampaignRecipientInput = {
  contact_id: string | null;
  display_name: string | null;
  email: string;
  phone?: string | null;
  contact_type?: string | null;
  category?: string | null;
  company_name?: string | null;
  city?: string | null;
  postal_code?: string | null;
};

function normalizeCampaignRecipientInputs(
  value: unknown,
): CampaignRecipientInput[] {
  const recipients = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: CampaignRecipientInput[] = [];

  for (const item of recipients) {
    const record = asRecord(item);
    const email = cleanEmail(record?.email || item);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      contact_id:
        cleanText(record?.contact_id || record?.contactId || record?.id, 140) ||
        null,
      display_name:
        cleanText(
          record?.display_name ||
            record?.displayName ||
            record?.name ||
            record?.company_name ||
            record?.companyName,
          220,
        ) || null,
      email,
      phone: cleanText(record?.phone, 80) || null,
      contact_type:
        cleanText(record?.contact_type || record?.contactType, 80) || null,
      category: cleanText(record?.category, 80) || null,
      company_name:
        cleanText(record?.company_name || record?.companyName, 180) || null,
      city: cleanText(record?.city, 120) || null,
      postal_code:
        cleanText(record?.postal_code || record?.postalCode, 20) || null,
    });
  }

  return out.slice(0, 1000);
}

function isCampaignAction(action: ReturnType<typeof rowToInrAgentAction>) {
  return (
    (action.automationKey === "grow" || action.automationKey === "loyalty") &&
    (action.targetTool === "propulser" ||
      action.targetTool === "fideliser" ||
      action.targetTool === "mails")
  );
}

function buildCampaignPreviewText(
  subject: string,
  bodyText: string,
  recipients: CampaignRecipientInput[],
) {
  return [
    `Objet : ${subject}`,
    bodyText,
    `Destinataires proposés : ${recipients.length} contact${recipients.length > 1 ? "s" : ""} CRM`,
  ].join("\n\n");
}

async function readAgentMediaBuffer(media: NonNullable<PublishDraftMedia>) {
  const bucket = cleanText(media.bucket || "inrcy-pro-media", 120);
  const storagePath = cleanText(media.storagePath || media.path, 900);
  if (bucket && storagePath) {
    const downloaded = await supabaseAdmin.storage
      .from(bucket)
      .download(storagePath);
    if (downloaded.error || !downloaded.data) {
      throw new Error("Média iNrAgent supprimé ou indisponible dans le stockage.");
    }
    return {
      buffer: Buffer.from(await downloaded.data.arrayBuffer()),
      mimeType:
        downloaded.data.type ||
        cleanText(media.mimeType || media.type, 140) ||
        "application/octet-stream",
      sourceBucket: bucket,
      sourceStoragePath: storagePath,
    };
  }

  const url = cleanText(media.url || media.publicUrl, 2000);
  if (!url) throw new Error("Média iNrAgent indisponible.");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Média iNrAgent indisponible.");
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType:
      response.headers.get("content-type") ||
      cleanText(media.mimeType || media.type, 140) ||
      "application/octet-stream",
    sourceBucket: bucket || null,
    sourceStoragePath: storagePath || null,
  };
}

function safeDraftFileName(value: string, fallback: string) {
  const raw = String(value || fallback || "media")
    .split(/[\\/]/)
    .pop() || fallback || "media";
  const clean = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .toLowerCase();
  return clean || fallback || "media";
}

async function copyAgentMediaToBoosterDraft(args: {
  userId: string;
  media: NonNullable<PublishDraftMedia>;
  folder: "booster-drafts";
}) {
  const { media } = args;
  const read = await readAgentMediaBuffer(media);
  const extension = fileExtensionFromMimeOrPath(
    read.mimeType,
    cleanText(media.storagePath || media.path, 900),
  );
  const baseName = safeDraftFileName(
    cleanText(media.name || media.title, 180),
    media.kind === "video" ? "video-inragent" : "image-inragent",
  ).replace(/\.[^.]+$/, "");
  const storagePath = `${args.userId}/${args.folder}/${randomUUID()}-${baseName}.${extension}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from("booster")
    .upload(storagePath, toExactStorageArrayBuffer(read.buffer), {
      contentType: read.mimeType,
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadError) {
    throw new Error(
      uploadError.message || "Impossible de créer le brouillon média.",
    );
  }
  const publicUrl = String(
    supabaseAdmin.storage.from("booster").getPublicUrl(storagePath)?.data
      ?.publicUrl || "",
  ).trim();
  if (!publicUrl) throw new Error("URL du brouillon média introuvable.");
  return {
    storagePath,
    publicUrl,
    mimeType: read.mimeType,
    size: read.buffer.byteLength,
    sourceBucket: read.sourceBucket,
    sourceStoragePath: read.sourceStoragePath,
  };
}

async function buildPublishDraftMediaPayload(args: {
  userId: string;
  actionId: string;
  media: PublishDraftMedia;
  videoAiContextRef: VideoAiContextReference | null;
}) {
  const { media } = args;
  if (!media) return { imageDrafts: [] as Record<string, unknown>[], videoDraft: null as Record<string, unknown> | null };

  const copied = await copyAgentMediaToBoosterDraft({
    userId: args.userId,
    media,
    folder: "booster-drafts",
  });

  if (media.kind === "video") {
    const transformedVariants = Array.isArray(media.transformedVariants)
      ? media.transformedVariants.filter(Boolean).slice(0, 12)
      : [];
    const sourceMetadata = {
      width: media.width || null,
      height: media.height || null,
      duration: media.duration_seconds || media.duration || null,
      size: copied.size || media.size || 0,
      type: copied.mimeType || media.mimeType || media.type || "video/mp4",
      ratio:
        media.width && media.height
          ? Number(media.width) / Number(media.height)
          : null,
      ratioLabel: "",
      orientation:
        media.width && media.height
          ? Number(media.width) > Number(media.height)
            ? "horizontal"
            : Number(media.width) < Number(media.height)
              ? "vertical"
              : "square"
          : "unknown",
      orientationLabel: "",
    };
    return {
      imageDrafts: [] as Record<string, unknown>[],
      videoDraft: {
        name: media.name || media.title || `video-iNrAgent-${args.actionId}.mp4`,
        type: copied.mimeType || media.mimeType || media.type || "video/mp4",
        size: copied.size || media.size || 0,
        lastModified: Date.now(),
        duration: media.duration_seconds || media.duration || null,
        sourceMetadata,
        storagePath: copied.storagePath,
        publicUrl: copied.publicUrl,
        url: copied.publicUrl,
        transformedVariants,
        ...videoAiContextReferenceAliases(args.videoAiContextRef),
      },
    };
  }

  return {
    imageDrafts: [
      {
        name: media.name || media.title || `image-iNrAgent-${args.actionId}.jpg`,
        type: copied.mimeType || media.mimeType || media.type || "image/jpeg",
        size: copied.size || media.size || 0,
        lastModified: Date.now(),
        storagePath: copied.storagePath,
        publicUrl: copied.publicUrl,
        url: copied.publicUrl,
        originalPublicUrl: media.publicUrl || media.url || null,
        originalStoragePath: media.storagePath || media.path || null,
        imageKey: media.id || args.actionId,
      },
    ],
    videoDraft: null as Record<string, unknown> | null,
  };
}

async function readCampaignAction(actionId: string, userId: string) {
  const { data: currentRow, error: readError } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("id", actionId)
    .eq("user_id", userId)
    .single();

  if (readError || !currentRow) {
    return {
      action: null,
      response: isMissingTableError(readError)
        ? NextResponse.json(
            {
              error:
                "La table inr_agent_actions doit être créée dans Supabase.",
              tableMissing: true,
            },
            { status: 500 },
          )
        : NextResponse.json(
            { error: "Action iNr’Agent introuvable." },
            { status: 404 },
          ),
    };
  }

  const action = rowToInrAgentAction(currentRow as any);
  if (!isCampaignAction(action)) {
    return {
      action: null,
      response: NextResponse.json(
        {
          error:
            "Cette modification est réservée aux campagnes Propulser/Fidéliser préparées par iNr’Agent.",
        },
        { status: 400 },
      ),
    };
  }

  return { action, response: null };
}

async function updateCampaignAction(args: {
  actionId: string;
  userId: string;
  patch: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .update({
      ...args.patch,
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", args.actionId)
    .eq("user_id", args.userId)
    .select(ACTION_SELECT)
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return {
        response: NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        ),
      };
    }
    return {
      response: NextResponse.json(
        {
          error:
            error.message || "Modification de l’action iNr’Agent impossible.",
        },
        { status: 500 },
      ),
    };
  }

  const action = await refreshActionImageUrls(rowToInrAgentAction(data));
  return { action };
}

async function fetchConnectedMailAccount(userId: string, accountId: string) {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select(
      "id,provider,account_email,email_address,display_name,resource_label,status,settings",
    )
    .eq("id", accountId)
    .eq("user_id", userId)
    .eq("category", "mail")
    .eq("status", "connected")
    .maybeSingle();

  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const settings = asRecord(row.settings) || {};
  const accountEmail = cleanText(
    row.account_email ||
      row.email_address ||
      settings.email ||
      settings.account_email,
    180,
  );
  const displayName = cleanText(row.display_name || settings.display_name, 180);
  return {
    id: cleanText(row.id, 140),
    provider: cleanText(row.provider, 80),
    email_address: accountEmail || null,
    account_email: accountEmail || null,
    email: accountEmail || null,
    display_name: displayName || null,
    label:
      accountEmail ||
      cleanText(row.resource_label || row.provider || "Boîte mail", 180),
  };
}

function buildDraftPayloadFromAgentAction(args: {
  action: ReturnType<typeof rowToInrAgentAction>;
  userId: string;
}) {
  const { action } = args;
  const payload = action.payload || {};
  const mailAccount = asRecord(payload.mailAccount) || {};
  const automationKey = action.automationKey === "loyalty" ? "loyalty" : "grow";
  const recipients = recipientsToEmails(
    payload.recipients || action.recipients,
  );
  const subject = normalizeMailSubject(
    cleanText(
      payload.campaignSubject || payload.subject || action.title,
      220,
    ) || "(sans objet)",
  );
  const bodyText = cleanText(
    payload.campaignBody ||
      payload.bodyText ||
      payload.text ||
      action.previewText,
    6000,
  );
  const bodyHtml =
    cleanText(payload.bodyHtml || payload.html, 10000) ||
    textToRichMailHtml(bodyText);
  const folder =
    cleanText(payload.folder, 80) ||
    (automationKey === "loyalty" ? "fidelisations" : "propulsions");
  const trackKind =
    cleanText(payload.trackKind, 80) ||
    (automationKey === "loyalty" ? "fideliser" : "propulser");
  const trackType = cleanText(
    payload.trackType || payload.theme || action.targetThemes[0],
    80,
  );
  const templateKey = cleanText(payload.templateKey, 160);
  const accountId = cleanText(
    payload.accountId || payload.mailAccountId || mailAccount.id,
    120,
  );
  const provider = cleanText(
    mailAccount.provider || payload.provider || payload.mailProvider,
    80,
  );

  const draftPayload = {
    user_id: args.userId,
    integration_id: accountId || null,
    type: "mail",
    status: "draft",
    to_emails: recipients.join("; "),
    subject,
    body_text: bodyText || null,
    body_html: bodyHtml || null,
    provider: provider || null,
    source_doc_save_id: null,
    source_doc_type: null,
    source_doc_number: null,
    folder,
    track_kind: trackKind,
    track_type: trackType || null,
    template_key: templateKey || null,
    attachments: cleanDraftAttachments(payload.attachments),
  };

  const legacyPayload = {
    user_id: draftPayload.user_id,
    integration_id: draftPayload.integration_id,
    type: draftPayload.type,
    status: draftPayload.status,
    to_emails: draftPayload.to_emails,
    subject: draftPayload.subject,
    body_text: draftPayload.body_text,
    body_html: draftPayload.body_html,
    provider: draftPayload.provider,
    source_doc_save_id: draftPayload.source_doc_save_id,
    source_doc_type: draftPayload.source_doc_type,
    source_doc_number: draftPayload.source_doc_number,
  };

  return { payload, draftPayload, legacyPayload };
}


async function savePublishActionAsBoosterDraft(args: {
  actionId: string;
  userId: string;
}) {
  const { data: currentRow, error: readError } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("id", args.actionId)
    .eq("user_id", args.userId)
    .single();

  if (readError || !currentRow) {
    if (isMissingTableError(readError)) {
      return {
        response: NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        ),
      };
    }
    return {
      response: NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      ),
    };
  }

  const action = rowToInrAgentAction(currentRow as any);
  if (!isPublishAction(action)) {
    return {
      response: NextResponse.json(
        {
          error:
            "Seules les publications Booster peuvent être enregistrées en brouillon iNrSend.",
        },
        { status: 400 },
      ),
    };
  }

  const payload = action.payload || {};
  const rawChannels = normalizePublishChannels(
    payload.selectedChannels || payload.channels || action.targetChannels,
  );
  const media = cleanPublishMedia(
    payload.media ||
      payload.mediaAsset ||
      payload.video ||
      payload.videoAsset ||
      payload.image ||
      payload.imageAsset,
  );
  const activeMediaMode = media?.kind === "video" ? "video" : media?.kind === "image" ? "images" : "none";
  const channels = rawChannels.filter((channel) => {
    if (activeMediaMode === "video") return true;
    if (publishChannelRequiresVideo(channel)) return false;
    if (publishChannelRequiresMedia(channel)) return Boolean(media);
    return publishCanRunWithoutMedia(channel) || Boolean(media);
  });

  if (!channels.length) {
    return {
      response: NextResponse.json(
        {
          error:
            "Aucun canal prêt à enregistrer en brouillon. Les canaux sélectionnés nécessitent un média ou une vidéo.",
        },
        { status: 400 },
      ),
    };
  }

  const rawPostByChannel = asRecord(payload.postByChannel) || {};
  const fallbackText = cleanText(
    action.summary || payload.idea || action.title || "Publication préparée par iNr’Agent.",
    1200,
  );
  const postByChannel = Object.fromEntries(
    channels.map((channel) => [
      channel,
      cleanBoosterPost(readPublishPost(rawPostByChannel, channel), fallbackText),
    ]),
  );
  const firstPost =
    channels.map((channel) => asRecord(postByChannel[channel])).find((post) => cleanText(post?.content || post?.title, 1200)) ||
    asRecord(Object.values(postByChannel)[0]) ||
    {};
  const firstTitle = cleanText(firstPost.title || firstPost.subject, 180);
  const firstContent = cleanText(firstPost.content || firstPost.text || firstPost.body, 1200);
  const channelMediaModes = Object.fromEntries(
    channels.map((channel) => [channel, activeMediaMode]),
  );

  const videoPreparation = asRecord(payload.videoAiPreparation) || {};
  const videoAiContextRef =
    normalizeVideoAiContextReference(payload.videoAiContextRef) ||
    buildVideoAiContextReference({
      mediaAssetId: payload.mediaAssetId || media?.id,
      mediaSource: media?.source,
      preparationVersion:
        payload.videoAiContextVersion || videoPreparation.version,
      sourceFingerprint:
        payload.videoFingerprint || videoPreparation.sourceFingerprint,
      persisted: videoPreparation.persisted,
    });

  const { imageDrafts, videoDraft } = await buildPublishDraftMediaPayload({
    userId: args.userId,
    actionId: action.id,
    media,
    videoAiContextRef,
  });

  const videoSettingsSource =
    media?.kind === "video"
      ? asRecord(media.videoSettingsByChannel) ||
        asRecord(payload.videoSettingsByChannel) ||
        (asRecord(media.videoSettings)
          ? Object.fromEntries(channels.map((channel) => [channel, media.videoSettings]))
          : null)
      : null;
  const videoSettingsByChannel =
    media?.kind === "video"
      ? buildVideoSettingsByChannel({
          channels: channels as any,
          videoSettingsByChannel: videoSettingsSource,
          sourceMetadata: asRecord(videoDraft?.sourceMetadata) || null,
        })
      : {};
  const videoFormatByChannel = Object.fromEntries(
    Object.entries(videoSettingsByChannel).map(([channel, settings]) => [
      channel,
      settings?.format || null,
    ]),
  );
  const videoAdaptationModeByChannel = Object.fromEntries(
    Object.entries(videoSettingsByChannel).map(([channel, settings]) => [
      channel,
      settings?.adaptationMode || null,
    ]),
  );
  const channelLabels = channels
    .map((channel) => channel)
    .join(" / ");
  const instagramPost = asRecord(postByChannel.instagram);
  const instagramHashtagsInput = Array.isArray(instagramPost?.hashtags)
    ? instagramPost.hashtags.map((tag) => `#${String(tag).replace(/^#+/, "")}`).join(" ")
    : "";
  const now = new Date().toISOString();
  const draftPayload = {
    status: "draft",
    title: firstTitle || action.title || "Brouillon publication",
    preview: firstContent || fallbackText || channelLabels,
    content: firstContent || "",
    idea: cleanText(payload.idea || action.summary, 1000),
    theme: cleanText(payload.boosterTheme || payload.theme, 80) || "",
    contentStyle: cleanText(payload.contentStyle, 40) || "equilibre",
    channel: channelLabels,
    channels,
    postByChannel,
    mediaType: media?.kind === "video" ? "video" : "images",
    channelMediaModes,
    mediaModeByChannel: channelMediaModes,
    videoFormatByChannel,
    videoAdaptationModeByChannel,
    videoSettingsByChannel,
    imageNames: imageDrafts.map((image) => ({
      name: image.name,
      type: image.type,
      size: image.size,
    })),
    videoName: videoDraft
      ? {
          name: videoDraft.name,
          type: videoDraft.type,
          size: videoDraft.size,
          duration: videoDraft.duration,
        }
      : null,
    videoSourceMetadata: videoDraft?.sourceMetadata || null,
    imageDrafts,
    videoDraft,
    ...videoAiContextReferenceAliases(videoAiContextRef),
    useImagesForAI: true,
    imageSettingsByChannel: asRecord(payload.imageSettingsByChannel) || {},
    instagramHashtagsInput,
    saved_at: now,
    origin: {
      source: "inr_agent",
      label: "iNr’Agent",
      icon: "🤖",
      actionId: action.id,
      automationKey: action.automationKey,
    },
    source: "inr_agent",
    workflowTool: "booster",
    workflowAction: "publier",
    inrAgentActionId: action.id,
  };

  const { data: draft, error: draftError } = await supabaseAdmin
    .from("app_events")
    .insert({
      user_id: args.userId,
      module: "booster",
      type: "publish_draft",
      payload: draftPayload,
    })
    .select("id")
    .single();

  if (draftError) {
    return {
      response: NextResponse.json(
        {
          error:
            draftError.message ||
            "Impossible d’enregistrer la publication en brouillon iNrSend.",
        },
        { status: 500 },
      ),
    };
  }

  const draftId = cleanText((draft as Record<string, unknown> | null)?.id, 120) || null;
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .update({
      status: "cancelled",
      completed_at: now,
      last_error: null,
      summary: `${action.summary} Publication conservée en brouillon dans iNrSend.`,
      payload: {
        ...payload,
        movedToInrSendDraft: {
          ok: true,
          draftId,
          movedAt: now,
          reason: "user_saved_publish_from_inr_agent",
          type: "publish_draft",
        },
      },
      updated_at: now,
    })
    .eq("id", args.actionId)
    .eq("user_id", args.userId)
    .select(ACTION_SELECT)
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return {
        response: NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        ),
      };
    }
    return {
      response: NextResponse.json(
        {
          error:
            error.message ||
            "Impossible de fermer l’action iNr’Agent après enregistrement du brouillon.",
        },
        { status: 500 },
      ),
    };
  }

  const updatedAction = await refreshActionImageUrls(rowToInrAgentAction(data));
  return { action: updatedAction, draftId };
}

async function saveCampaignActionAsInrSendDraft(args: {
  actionId: string;
  userId: string;
}) {
  const { data: currentRow, error: readError } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("id", args.actionId)
    .eq("user_id", args.userId)
    .single();

  if (readError || !currentRow) {
    if (isMissingTableError(readError)) {
      return {
        response: NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        ),
      };
    }
    return {
      response: NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      ),
    };
  }

  const action = rowToInrAgentAction(currentRow as any);
  const isCampaignAction =
    (action.automationKey === "grow" || action.automationKey === "loyalty") &&
    (action.targetTool === "propulser" ||
      action.targetTool === "fideliser" ||
      action.targetTool === "mails");

  if (!isCampaignAction) {
    return {
      response: NextResponse.json(
        {
          error:
            "Seules les campagnes Propulser/Fidéliser peuvent être enregistrées en brouillon iNrSend.",
        },
        { status: 400 },
      ),
    };
  }

  const { payload, draftPayload, legacyPayload } =
    buildDraftPayloadFromAgentAction({
      action,
      userId: args.userId,
    });

  let { data: draft, error: draftError } = await supabaseAdmin
    .from("send_items")
    .insert(draftPayload as any)
    .select("id")
    .single();

  if (draftError && isMissingDraftMetadataColumn(draftError)) {
    const legacyInsert = await supabaseAdmin
      .from("send_items")
      .insert(legacyPayload)
      .select("id")
      .single();
    draft = legacyInsert.data;
    draftError = legacyInsert.error;
  }

  if (draftError) {
    return {
      response: NextResponse.json(
        {
          error:
            draftError.message ||
            "Impossible d’enregistrer la campagne en brouillon iNrSend.",
        },
        { status: 500 },
      ),
    };
  }

  const now = new Date().toISOString();
  const draftId =
    cleanText((draft as Record<string, unknown> | null)?.id, 120) || null;
  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .update({
      status: "cancelled",
      completed_at: now,
      last_error: null,
      summary: `${action.summary} Campagne conservée en brouillon dans iNrSend.`,
      payload: {
        ...payload,
        movedToInrSendDraft: {
          ok: true,
          draftId,
          movedAt: now,
          reason: "user_saved_from_inr_agent",
        },
      },
      updated_at: now,
    })
    .eq("id", args.actionId)
    .eq("user_id", args.userId)
    .select(ACTION_SELECT)
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return {
        response: NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        ),
      };
    }
    return {
      response: NextResponse.json(
        {
          error:
            error.message ||
            "Impossible de fermer l’action iNr’Agent après enregistrement du brouillon.",
        },
        { status: 500 },
      ),
    };
  }

  const updatedAction = await refreshActionImageUrls(rowToInrAgentAction(data));
  return { action: updatedAction, draftId };
}

export async function GET() {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .select(ACTION_SELECT)
    .eq("user_id", activeUserId)
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json({
        actions: [],
        stats: summarizeInrAgentActions([]),
        tableMissing: true,
      });
    }
    console.warn("[inr-agent-actions] read failed", error);
    return NextResponse.json(
      { error: "Lecture des actions iNr'Agent impossible" },
      { status: 500 },
    );
  }

  const visibleRows = Array.isArray(data)
    ? standardMode
      ? filterStandardAgentItems(data)
      : data
    : [];
  const rawActions = visibleRows.length
    ? visibleRows.map((row) => rowToInrAgentAction(row))
    : [];
  const actions = await Promise.all(rawActions.map(refreshActionImageUrls));
  return NextResponse.json({
    actions,
    stats: summarizeInrAgentActions(actions),
    tableMissing: false,
  });
}

export async function PATCH(request: Request) {
  const { user, errorResponse, authUserId, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const standardMode =
    (await getDashboardEditionForAuthUser(authUserId)) === "standard";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }

  const requestBody = body as {
    actionId?: unknown;
    status?: unknown;
    editType?: unknown;
    subject?: unknown;
    bodyText?: unknown;
    recipients?: unknown;
    accountId?: unknown;
    attachments?: unknown;
    channel?: unknown;
    title?: unknown;
    content?: unknown;
    cta?: unknown;
    ctaMode?: unknown;
    ctaUrl?: unknown;
    ctaPhone?: unknown;
    hashtags?: unknown;
    media?: unknown;
    removeMedia?: unknown;
    mediaOperation?: unknown;
    mediaIndex?: unknown;
  } | null;
  const actionId =
    typeof requestBody?.actionId === "string" ? requestBody.actionId : "";
  const status = sanitizeInrAgentActionStatus(requestBody?.status);
  const editType = cleanText(requestBody?.editType, 80);

  if (standardMode && actionId) {
    const { data: descriptorRow, error: descriptorError } = await supabaseAdmin
      .from("inr_agent_actions")
      .select("automation_key, action_type, target_tool")
      .eq("id", actionId)
      .eq("user_id", activeUserId)
      .maybeSingle();
    if (descriptorError) {
      return NextResponse.json(
        { error: "Vérification de l’action iNr’Agent impossible." },
        { status: 500 },
      );
    }
    if (!descriptorRow) {
      return NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      );
    }
    if (!isStandardAgentActionDescriptor(descriptorRow)) {
      return premiumRequiredApiResponse();
    }
  }

  if (editType === "save_campaign_draft" || editType === "save_publish_draft") {
    if (!actionId) {
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
    }

    const result =
      editType === "save_publish_draft"
        ? await savePublishActionAsBoosterDraft({
            actionId,
            userId: activeUserId,
          })
        : await saveCampaignActionAsInrSendDraft({
            actionId,
            userId: activeUserId,
          });

    if ("response" in result) return result.response;
    return NextResponse.json({
      action: result.action,
      draftId: result.draftId,
      savedAsDraft: true,
    });
  }

  if (editType === "publish_channel_text") {
    if (!actionId) {
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
    }

    const channel = cleanPublishChannel(requestBody?.channel);
    if (!channel) {
      return NextResponse.json(
        { error: "Canal de publication invalide." },
        { status: 400 },
      );
    }

    const title = cleanText(requestBody?.title, 180);
    const content = cleanText(requestBody?.content, 6000);
    const cta = cleanText(requestBody?.cta, 180);
    const rawCtaMode = cleanText(requestBody?.ctaMode, 24);
    const ctaMode = ["none", "website", "call", "message", "custom"].includes(
      rawCtaMode,
    )
      ? rawCtaMode
      : "none";
    const ctaUrl = cleanText(requestBody?.ctaUrl, 320);
    const ctaPhone = cleanText(requestBody?.ctaPhone, 60);
    const hashtags = cleanPublishHashtags(requestBody?.hashtags);

    if (!content) {
      return NextResponse.json(
        { error: "Le contenu de la publication est obligatoire." },
        { status: 400 },
      );
    }

    const { data: currentRow, error: readError } = await supabaseAdmin
      .from("inr_agent_actions")
      .select(ACTION_SELECT)
      .eq("id", actionId)
      .eq("user_id", activeUserId)
      .single();

    if (readError || !currentRow) {
      if (isMissingTableError(readError)) {
        return NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      );
    }

    const currentAction = rowToInrAgentAction(currentRow as any);
    if (!isPublishAction(currentAction)) {
      return NextResponse.json(
        {
          error:
            "Cette modification est réservée aux publications Booster préparées par iNr’Agent.",
        },
        { status: 400 },
      );
    }

    const currentPayload = currentAction.payload || {};
    const currentPostByChannel = asRecord(currentPayload.postByChannel) || {};
    const currentPost = readPublishPost(currentPostByChannel, channel);
    const nextPost = {
      ...currentPost,
      title,
      subject: title,
      content,
      text: content,
      body: content,
      cta,
      callToAction: cta,
      ctaMode,
      ctaUrl,
      ctaPhone,
      hashtags,
      editedByUser: true,
      editedAt: new Date().toISOString(),
    };
    const nextPostByChannel = {
      ...currentPostByChannel,
      [channel]: nextPost,
    };
    const nextPayload = {
      ...currentPayload,
      postByChannel: nextPostByChannel,
      lastManualEdit: {
        channel,
        editedAt: nextPost.editedAt,
        editType: "publish_channel_text",
      },
    };
    const nextPreviewText = buildPublishPreviewTextFromPosts(
      nextPostByChannel,
      cleanText(
        currentAction.previewText ||
          currentAction.summary ||
          currentAction.title,
        1200,
      ),
    );

    const { data, error } = await supabaseAdmin
      .from("inr_agent_actions")
      .update({
        payload: nextPayload,
        preview_text: nextPreviewText,
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", actionId)
      .eq("user_id", activeUserId)
      .select(ACTION_SELECT)
      .single();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        );
      }
      console.warn("[inr-agent-actions] publish text update failed", error);
      return NextResponse.json(
        { error: "Modification de la publication impossible." },
        { status: 500 },
      );
    }

    const action = await refreshActionImageUrls(rowToInrAgentAction(data));
    return NextResponse.json({ action, saved: true });
  }

  if (editType === "publish_channel_media") {
    if (!actionId) {
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
    }

    const channel = cleanPublishChannel(requestBody?.channel);
    if (!channel) {
      return NextResponse.json(
        { error: "Canal de publication invalide." },
        { status: 400 },
      );
    }

    const removeMedia = requestBody?.removeMedia === true;
    const media = removeMedia ? null : cleanPublishMedia(requestBody?.media);
    if (!removeMedia && !media) {
      return NextResponse.json({ error: "Média invalide." }, { status: 400 });
    }
    const requestedOperation = cleanText(requestBody?.mediaOperation, 20);
    const mediaOperation: "append" | "replace" | "remove" = removeMedia
      ? "remove"
      : requestedOperation === "append"
        ? "append"
        : "replace";
    const mediaIndex = Math.max(
      0,
      Math.floor(Number(requestBody?.mediaIndex) || 0),
    );

    const { data: currentRow, error: readError } = await supabaseAdmin
      .from("inr_agent_actions")
      .select(ACTION_SELECT)
      .eq("id", actionId)
      .eq("user_id", activeUserId)
      .single();

    if (readError || !currentRow) {
      if (isMissingTableError(readError)) {
        return NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      );
    }

    const currentAction = rowToInrAgentAction(currentRow as any);
    if (!isPublishAction(currentAction)) {
      return NextResponse.json(
        {
          error:
            "Cette modification est réservée aux publications Booster préparées par iNr’Agent.",
        },
        { status: 400 },
      );
    }

    const currentPayload = currentAction.payload || {};
    const currentPublishPayload = asRecord(currentPayload.publishPayload) || {};
    const currentPostByChannel =
      asRecord(currentPayload.postByChannel) ||
      asRecord(currentPublishPayload.postByChannel) ||
      {};
    const currentImagesByChannel =
      asRecord(currentPayload.imagesByChannel) ||
      asRecord(currentPublishPayload.imagesByChannel) ||
      {};
    const currentMediaModeByChannel =
      asRecord(currentPayload.mediaModeByChannel) ||
      asRecord(currentPublishPayload.mediaModeByChannel) ||
      {};
    const editedAt = new Date().toISOString();
    const selectedChannelsSource = Array.isArray(currentPayload.selectedChannels)
      ? currentPayload.selectedChannels
      : Array.isArray(currentPublishPayload.selectedChannels)
        ? currentPublishPayload.selectedChannels
        : [];
    const selectedChannels = selectedChannelsSource
      .map((item) => cleanPublishChannel(item))
      .filter((item): item is PublishChannelKey => Boolean(item));
    const targetChannels = selectedChannels.length
      ? selectedChannels
      : [channel];

    const fallbackPayloadMedia = cleanPublishMedia(
      currentPayload.media ||
        currentPayload.mediaAsset ||
        currentPayload.image ||
        currentPayload.imageAsset ||
        currentPublishPayload.media ||
        currentPublishPayload.mediaAsset ||
        currentPublishPayload.image ||
        currentPublishPayload.imageAsset,
    );
    const fallbackActionImage = currentAction.imageAssets
      .map((item) => cleanPublishMedia(item))
      .find((item) => item?.kind === "image");

    const readCurrentChannelImages = (targetChannel: PublishChannelKey) => {
      const raw = readPublishChannelValue(
        currentImagesByChannel,
        targetChannel,
      );
      const images = Array.isArray(raw)
        ? raw
            .map((item) => cleanPublishMedia(item))
            .filter(
              (item): item is NonNullable<ReturnType<typeof cleanPublishMedia>> =>
                Boolean(item && item.kind === "image"),
            )
        : [];
      if (images.length) return images;

      const post = readPublishPost(currentPostByChannel, targetChannel);
      const postMedia = cleanPublishMedia(
        post.media ||
          post.mediaAsset ||
          post.image ||
          post.imageAsset ||
          post.imageUrl,
      );
      if (postMedia?.kind === "image") return [postMedia];
      if (fallbackPayloadMedia?.kind === "image") return [fallbackPayloadMedia];
      if (fallbackActionImage?.kind === "image") return [fallbackActionImage];
      return [];
    };

    if (media?.kind === "image" && mediaOperation === "append") {
      const fullChannel = targetChannels.find(
        (targetChannel) =>
          readCurrentChannelImages(targetChannel).length >=
          INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
      );
      if (fullChannel) {
        return NextResponse.json(
          {
            error: `Maximum de ${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} images atteint pour ce canal.`,
          },
          { status: 409 },
        );
      }
    }

    const nextPostByChannel = { ...currentPostByChannel };
    const nextImagesByChannel = { ...currentImagesByChannel };
    const nextMediaModeByChannel = { ...currentMediaModeByChannel };
    const effectiveMediaByChannel = new Map<
      PublishChannelKey,
      ReturnType<typeof cleanPublishMedia>
    >();

    const buildNextPost = (
      rawPost: unknown,
      effectiveMedia: ReturnType<typeof cleanPublishMedia>,
      mediaMode: "images" | "video" | "none",
    ) => {
      const currentPostRecord = asRecord(rawPost) || {};
      if (effectiveMedia && mediaMode === "images") {
        return {
          ...currentPostRecord,
          media: effectiveMedia,
          mediaAsset: effectiveMedia,
          image: effectiveMedia,
          imageAsset: effectiveMedia,
          imageUrl: effectiveMedia.url,
          video: null,
          videoAsset: null,
          mediaMode: "images",
          editedByUser: true,
          editedAt,
        };
      }
      if (effectiveMedia && mediaMode === "video") {
        return {
          ...currentPostRecord,
          media: effectiveMedia,
          mediaAsset: effectiveMedia,
          image: null,
          imageAsset: null,
          imageUrl: "",
          video: effectiveMedia,
          videoAsset: effectiveMedia,
          mediaMode: "video",
          editedByUser: true,
          editedAt,
        };
      }
      return {
        ...currentPostRecord,
        media: null,
        mediaAsset: null,
        image: null,
        imageAsset: null,
        imageUrl: "",
        visual: null,
        cover: null,
        video: null,
        videoAsset: null,
        file: null,
        attachment: null,
        attachments: [],
        mediaMode: "none",
        editedByUser: true,
        editedAt,
      };
    };

    for (const targetChannel of targetChannels) {
      const currentImages = readCurrentChannelImages(targetChannel);
      const rawMode = String(
        readPublishChannelValue(currentMediaModeByChannel, targetChannel) ||
          readPublishPost(currentPostByChannel, targetChannel).mediaMode ||
          "",
      )
        .trim()
        .toLowerCase();
      let nextImages = currentImages;
      let nextMode: "images" | "video" | "none" =
        rawMode === "video"
          ? "video"
          : currentImages.length || rawMode === "images"
            ? "images"
            : "none";
      let effectiveMedia: ReturnType<typeof cleanPublishMedia> = null;

      if (media?.kind === "image") {
        const sourceImages = nextMode === "images" ? currentImages : [];
        if (mediaOperation === "append") {
          nextImages = [...sourceImages, media].slice(
            0,
            INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
          );
        } else {
          const replaceIndex = sourceImages.length
            ? Math.min(mediaIndex, sourceImages.length - 1)
            : 0;
          nextImages = sourceImages.length ? [...sourceImages] : [];
          if (nextImages.length) nextImages[replaceIndex] = media;
          else nextImages.push(media);
        }
        nextMode = "images";
        effectiveMedia = nextImages[0] || null;
      } else if (media?.kind === "video") {
        nextImages = [];
        nextMode = "video";
        effectiveMedia = media;
      } else if (mediaOperation === "remove") {
        if (nextMode === "images" && currentImages.length) {
          const removeIndex = Math.min(mediaIndex, currentImages.length - 1);
          nextImages = currentImages.filter((_, index) => index !== removeIndex);
          nextMode = nextImages.length ? "images" : "none";
          effectiveMedia = nextImages[0] || null;
        } else {
          nextImages = [];
          nextMode = "none";
          effectiveMedia = null;
        }
      }

      nextImagesByChannel[targetChannel] = nextImages;
      nextMediaModeByChannel[targetChannel] = nextMode;
      effectiveMediaByChannel.set(targetChannel, effectiveMedia);
      const currentPost = readPublishPost(currentPostByChannel, targetChannel);
      nextPostByChannel[targetChannel] = buildNextPost(
        currentPost,
        effectiveMedia,
        nextMode,
      );
    }

    const currentReadiness =
      asRecord(currentPayload.mediaReadinessByChannel) || {};
    const nextReadiness = { ...currentReadiness };
    const currentAdaptation =
      asRecord(currentPayload.mediaAdaptationByChannel) || {};
    const nextAdaptation = { ...currentAdaptation };
    for (const targetChannel of targetChannels) {
      const effectiveMedia = effectiveMediaByChannel.get(targetChannel) || null;
      nextReadiness[targetChannel] = buildPublishMediaReadiness(
        targetChannel,
        effectiveMedia,
      );
      nextAdaptation[targetChannel] = buildPublishMediaAdaptation(
        targetChannel,
        effectiveMedia,
      );
    }

    const primaryChannel = targetChannels[0];
    const primaryMode = String(
      nextMediaModeByChannel[primaryChannel] || "none",
    );
    const primaryImages = Array.isArray(nextImagesByChannel[primaryChannel])
      ? (nextImagesByChannel[primaryChannel] as unknown[])
          .map((item) => cleanPublishMedia(item))
          .filter(
            (item): item is NonNullable<ReturnType<typeof cleanPublishMedia>> =>
              Boolean(item && item.kind === "image"),
          )
      : [];
    const primaryMedia =
      primaryMode === "images"
        ? primaryImages[0] || null
        : effectiveMediaByChannel.get(primaryChannel) || null;
    const actionImageAssets =
      primaryMode === "images"
        ? primaryImages
        : primaryMode === "video" && primaryMedia
          ? [primaryMedia]
          : [];

    const nextPublishPayload = {
      ...currentPublishPayload,
      postByChannel: nextPostByChannel,
      imagesByChannel: nextImagesByChannel,
      mediaModeByChannel: nextMediaModeByChannel,
      media: primaryMedia,
      mediaAsset: primaryMedia,
      image: primaryMode === "images" ? primaryMedia : null,
      imageAsset: primaryMode === "images" ? primaryMedia : null,
      video: primaryMode === "video" ? primaryMedia : null,
      videoAsset: primaryMode === "video" ? primaryMedia : null,
    };

    const nextPayload = {
      ...currentPayload,
      media: primaryMedia,
      mediaAsset: primaryMedia,
      mediaType: primaryMode === "images" ? "image" : primaryMode,
      image: primaryMode === "images" ? primaryMedia : null,
      imageAsset: primaryMode === "images" ? primaryMedia : null,
      video: primaryMode === "video" ? primaryMedia : null,
      videoAsset: primaryMode === "video" ? primaryMedia : null,
      postByChannel: nextPostByChannel,
      imagesByChannel: nextImagesByChannel,
      mediaModeByChannel: nextMediaModeByChannel,
      image_assets: actionImageAssets,
      mediaReadinessByChannel: nextReadiness,
      mediaAdaptationByChannel: nextAdaptation,
      ...(Object.keys(currentPublishPayload).length
        ? { publishPayload: nextPublishPayload }
        : {}),
      lastManualEdit: {
        channel,
        appliedToChannels: targetChannels,
        editedAt,
        editType: "publish_channel_media",
        mediaOperation,
        mediaIndex,
      },
    };

    const { data, error } = await supabaseAdmin
      .from("inr_agent_actions")
      .update({
        payload: nextPayload,
        image_assets: actionImageAssets,
        updated_at: editedAt,
        last_error: null,
      })
      .eq("id", actionId)
      .eq("user_id", activeUserId)
      .select(ACTION_SELECT)
      .single();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        );
      }
      console.warn("[inr-agent-actions] publish media update failed", error);
      return NextResponse.json(
        { error: "Modification du média impossible." },
        { status: 500 },
      );
    }

    const action = await refreshActionImageUrls(rowToInrAgentAction(data));
    return NextResponse.json({ action, saved: true });
  }

  if (editType === "campaign_recipients") {
    if (!actionId) {
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
    }

    const recipients = normalizeCampaignRecipientInputs(
      requestBody?.recipients,
    );
    if (!recipients.length) {
      return NextResponse.json(
        { error: "Sélectionne au moins un destinataire valide." },
        { status: 400 },
      );
    }

    const { action, response } = await readCampaignAction(actionId, activeUserId);
    if (response) return response;
    if (!action)
      return NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      );

    const payload = action.payload || {};
    const subject =
      cleanText(
        payload.campaignSubject || payload.subject || action.title,
        220,
      ) || "(sans objet)";
    const bodyText = cleanText(
      payload.campaignBody ||
        payload.bodyText ||
        payload.text ||
        action.previewText,
      6000,
    );
    const result = await updateCampaignAction({
      actionId,
      userId: activeUserId,
      patch: {
        recipients,
        payload: {
          ...payload,
          recipients,
          recipientCount: recipients.length,
          recipientScope: "manual_selection",
        },
        preview_text: buildCampaignPreviewText(subject, bodyText, recipients),
      },
    });
    if ("response" in result) return result.response;
    return NextResponse.json({ action: result.action, saved: true });
  }

  if (editType === "campaign_mail_account") {
    if (!actionId) {
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
    }

    const accountId = cleanText(requestBody?.accountId, 140);
    if (!accountId) {
      return NextResponse.json(
        { error: "Boîte d’envoi invalide." },
        { status: 400 },
      );
    }

    const { action, response } = await readCampaignAction(actionId, activeUserId);
    if (response) return response;
    if (!action)
      return NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      );

    const mailAccount = await fetchConnectedMailAccount(activeUserId, accountId);
    if (!mailAccount?.id) {
      return NextResponse.json(
        {
          error:
            "La boîte d’envoi sélectionnée est introuvable ou non connectée.",
        },
        { status: 404 },
      );
    }

    const payload = action.payload || {};
    const result = await updateCampaignAction({
      actionId,
      userId: activeUserId,
      patch: {
        payload: {
          ...payload,
          accountId: mailAccount.id,
          mailAccountId: mailAccount.id,
          mailProvider: mailAccount.provider,
          mailAccount,
        },
      },
    });
    if ("response" in result) return result.response;
    return NextResponse.json({ action: result.action, saved: true });
  }

  if (editType === "campaign_attachments") {
    if (!actionId) {
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
    }

    const attachments = cleanDraftAttachments(requestBody?.attachments);
    const { action, response } = await readCampaignAction(actionId, activeUserId);
    if (response) return response;
    if (!action)
      return NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      );

    const payload = action.payload || {};
    const result = await updateCampaignAction({
      actionId,
      userId: activeUserId,
      patch: {
        payload: {
          ...payload,
          attachments,
        },
      },
    });
    if ("response" in result) return result.response;
    return NextResponse.json({ action: result.action, saved: true });
  }

  if (editType === "campaign_text") {
    if (!actionId) {
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
    }

    const subject = normalizeMailSubject(cleanText(requestBody?.subject, 220));
    const bodyText = cleanText(requestBody?.bodyText, 6000);

    if (!subject || !bodyText) {
      return NextResponse.json(
        { error: "L’objet et le corps du mail sont obligatoires." },
        { status: 400 },
      );
    }

    const { data: currentRow, error: readError } = await supabaseAdmin
      .from("inr_agent_actions")
      .select(ACTION_SELECT)
      .eq("id", actionId)
      .eq("user_id", activeUserId)
      .single();

    if (readError || !currentRow) {
      if (isMissingTableError(readError)) {
        return NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: "Action iNr’Agent introuvable." },
        { status: 404 },
      );
    }

    const currentAction = rowToInrAgentAction(currentRow as any);
    const currentPayload = currentAction.payload || {};
    const bodyHtml = textToRichMailHtml(bodyText);
    const nextPayload = {
      ...currentPayload,
      subject,
      campaignSubject: subject,
      bodyText,
      campaignBody: bodyText,
      bodyHtml,
    };
    const nextPreviewText = [
      `Objet : ${subject}`,
      bodyText,
      `Destinataires proposés : ${Array.isArray(currentAction.recipients) ? currentAction.recipients.length : 0} contact${Array.isArray(currentAction.recipients) && currentAction.recipients.length > 1 ? "s" : ""} CRM`,
    ].join("\n\n");

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("inr_agent_actions")
      .update({
        payload: nextPayload,
        preview_text: nextPreviewText,
        updated_at: now,
      })
      .eq("id", actionId)
      .eq("user_id", activeUserId)
      .select(ACTION_SELECT)
      .single();

    if (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json(
          {
            error: "La table inr_agent_actions doit être créée dans Supabase.",
            tableMissing: true,
          },
          { status: 500 },
        );
      }
      console.warn("[inr-agent-actions] campaign text update failed", error);
      return NextResponse.json(
        { error: "Modification du mail impossible." },
        { status: 500 },
      );
    }

    const action = await refreshActionImageUrls(rowToInrAgentAction(data));
    return NextResponse.json({ action, saved: true });
  }

  if (
    !actionId ||
    !status ||
    ![
      "validated",
      "refused",
      "scheduled",
      "pending",
      "pending_validation",
      "cancelled",
    ].includes(status)
  ) {
    return NextResponse.json(
      { error: "Action ou statut invalide" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status,
    updated_at: now,
  };

  if (status === "validated") {
    updatePayload.validated_at = now;
    updatePayload.refused_at = null;
  }

  if (status === "refused") {
    updatePayload.refused_at = now;
  }

  if (status === "completed") {
    updatePayload.completed_at = now;
  }

  const { data, error } = await supabaseAdmin
    .from("inr_agent_actions")
    .update(updatePayload)
    .eq("id", actionId)
    .eq("user_id", activeUserId)
    .select(ACTION_SELECT)
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error: "La table inr_agent_actions doit être créée dans Supabase.",
          tableMissing: true,
        },
        { status: 500 },
      );
    }
    console.warn("[inr-agent-actions] update failed", error);
    return NextResponse.json(
      { error: "Mise à jour de l'action iNr'Agent impossible" },
      { status: 500 },
    );
  }

  const action = await refreshActionImageUrls(rowToInrAgentAction(data));
  return NextResponse.json({ action, saved: true });
}
