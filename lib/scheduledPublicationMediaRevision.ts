import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { applyScheduledPublicationMediaSnapshot, getScheduledPublicationMediaWorkspaceId } from "@/lib/scheduledPublicationMediaSnapshot";
import { buildAbsoluteStorageContentUrl } from "@/lib/storageContentUrl";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => String(value ?? "").trim();
const aliases: Record<string, string> = { siteWeb: "site_web", inrSearch: "inr_search", youtube: "youtube_shorts" };
const channelKey = (value: string) => aliases[value] || value;
const mediaFields = ["mediaWorkspaceId", "images", "video", "imagesByChannel", "videoByChannel", "mediaModeByChannel", "imageSettingsByChannel", "videoSettingsByChannel", "videoFormatByChannel", "videoAdaptationModeByChannel"] as const;
function mediaSignature(value: unknown) {
  const payload = record(value), publish = record(payload.publishPayload);
  return JSON.stringify(Object.fromEntries(mediaFields.map(key => {
    const field = publish[key] ?? payload[key] ?? null;
    return [key, field && typeof field === "object" && Object.keys(field).length === 0 ? null : field];
  })));
}
export function scheduledPublicationMediaChanged(previous: unknown, next: unknown) { return mediaSignature(previous) !== mediaSignature(next); }

export class ScheduledPublicationMediaRevisionError extends Error {}
function imageKey(media: RecordValue) {
  // Same stable key emitted by resolveWorkspacePublicationConsumption.
  const parts = text(media.client_media_key).split(":");
  if (parts.length < 4) return `workspace:${media.id}`;
  const lastModified = parts.pop() || "0", size = parts.pop() || "0", name = parts.pop() || "image";
  return `${name}__${size}__${lastModified}`;
}

/** Build a new private graph before the schedule's CAS. Never mutate its old snapshot. */
export async function createScheduledPublicationMediaRevision(params: {
  accountId: string; actorAuthUserId: string; scheduledActionId: string; scheduledAt: string;
  previousPayload: unknown; payload: unknown; channels: string[]; requestUrl: string;
}) {
  const payload = record(params.payload), publish = record(payload.publishPayload);
  const previousWorkspaceId = getScheduledPublicationMediaWorkspaceId(params.previousPayload);
  let previousLinks: RecordValue[] = [];
  if (previousWorkspaceId) {
    const owner = await supabaseAdmin.from("publication_workspaces").select("id").eq("id", previousWorkspaceId).eq("account_id", params.accountId).maybeSingle();
    if (owner.error) throw owner.error;
    if (!owner.data) throw new ScheduledPublicationMediaRevisionError("L’espace média de cette programmation est introuvable.");
    const links = await supabaseAdmin.from("publication_workspace_media").select("media_id,selected_channels,position,pro_media_library!inner(id,user_id,media_type,upload_status,bucket_name,storage_path,client_media_key,original_file_name,mime_type,size_bytes,media_metadata)")
      .eq("workspace_id", previousWorkspaceId).eq("pro_media_library.user_id", params.accountId).order("position", { ascending: true });
    if (links.error) throw links.error;
    previousLinks = links.data || [];
  }
  const channels = Array.from(new Set(params.channels.map(channelKey)));
  const byImages = record(publish.imagesByChannel ?? payload.imagesByChannel), byVideos = record(publish.videoByChannel ?? payload.videoByChannel);
  const modes = record(publish.mediaModeByChannel ?? payload.mediaModeByChannel);
  const requestedImageSettings = record(publish.imageSettingsByChannel ?? payload.imageSettingsByChannel);
  const previousMediaFor = (channel: string, kind: "image" | "video") => {
    let candidates = previousLinks.flatMap(link => {
      const row = record(Array.isArray(link.pro_media_library) ? link.pro_media_library[0] : link.pro_media_library);
      const selected = Array.isArray(link.selected_channels) ? link.selected_channels.map(value => channelKey(text(value))) : [];
      return row.user_id === params.accountId && row.media_type === kind && (!selected.length || selected.includes(channel)) ? [row] : [];
    });
    const keys = record(requestedImageSettings[channel]).imageKeys;
    if (kind === "image" && Array.isArray(keys)) {
      candidates = keys.map(key => {
        const found = candidates.find(row => imageKey(row) === text(key));
        if (!found) throw new ScheduledPublicationMediaRevisionError("Une image sélectionnée n’est plus disponible dans cette programmation.");
        return found;
      });
    }
    return candidates.map(row => ({ id: row.id, storagePath: row.storage_path, type: row.mime_type }));
  };
  const selections = channels.map(channel => {
    const mode = text(modes[channel]);
    const images = mode === "video" || mode === "none" ? [] : Array.isArray(byImages[channel]) ? byImages[channel] as unknown[] : Array.isArray(publish.images) && publish.images.length ? publish.images : previousMediaFor(channel, "image");
    const video = mode === "images" || mode === "none" ? {} : record(Object.hasOwn(byVideos, channel) ? byVideos[channel] : publish.video || previousMediaFor(channel, "video")[0]);
    return { channel, images: images.map(record), video };
  });
  const references = selections.flatMap(item => [...item.images, ...(Object.keys(item.video).length ? [item.video] : [])]);
  if (references.length > 150) throw new ScheduledPublicationMediaRevisionError("Trop de médias dans cette programmation.");
  const ids = [...new Set(references.map(item => text(item.mediaId || item.media_id || item.id)).filter(value => /^[0-9a-f-]{36}$/i.test(value)))];
  const paths = [...new Set(references.map(item => text(item.storagePath || item.storage_path || item.path)).filter(Boolean))];
  const columns = "id,user_id,media_type,upload_status,bucket_name,storage_path,client_media_key,original_file_name,mime_type,size_bytes,media_metadata";
  const media: RecordValue[] = [];
  if (ids.length) {
    const result = await supabaseAdmin.from("pro_media_library").select(columns).eq("user_id", params.accountId).in("id", ids);
    if (result.error) throw result.error;
    media.push(...result.data || []);
  }
  if (paths.length) {
    const result = await supabaseAdmin.from("pro_media_library").select(columns).eq("user_id", params.accountId).in("storage_path", paths);
    if (result.error) throw result.error;
    media.push(...result.data || []);
  }
  const assets = new Map<string, { row: RecordValue; channels: Set<string>; settings: RecordValue }>();
  const resolve = (reference: RecordValue, channel: string, kind: "image" | "video") => {
    const id = text(reference.mediaId || reference.media_id || reference.id), path = text(reference.storagePath || reference.storage_path || reference.path);
    const row = media.find(item => item.user_id === params.accountId && text(item.id) === id)
      || media.find(item => item.user_id === params.accountId && path && text(item.storage_path) === path);
    if (!row || row.media_type !== kind || row.upload_status !== "uploaded" || !text(row.storage_path)) {
      throw new ScheduledPublicationMediaRevisionError("Un média n’a pas de source durable disponible pour cet établissement. Réimportez-le avant d’enregistrer.");
    }
    const key = text(row.id);
    const link = assets.get(key) || { row, channels: new Set<string>(), settings: {} };
    link.channels.add(channel); assets.set(key, link);
    const url = buildAbsoluteStorageContentUrl(text(row.bucket_name), text(row.storage_path), params.requestUrl);
    return { ...reference, id: key, mediaId: key, imageKey: imageKey(row), bucket: row.bucket_name, bucketName: row.bucket_name,
      storagePath: row.storage_path, storage_path: row.storage_path, path: row.storage_path, publicUrl: url, url, signed_url: url };
  };
  const imagesByChannel: Record<string, unknown[]> = {}, videoByChannel: Record<string, unknown> = {};
  const settings = { ...requestedImageSettings };
  for (const selection of selections) {
    const images = selection.images.map(item => resolve(item, selection.channel, "image"));
    imagesByChannel[selection.channel] = images;
    settings[selection.channel] = { ...record(settings[selection.channel]), imageKeys: images.map(item => item.imageKey) };
    videoByChannel[selection.channel] = Object.keys(selection.video).length ? resolve(selection.video, selection.channel, "video") : null;
  }
  if ([...assets.values()].filter(item => item.row.media_type === "video").length > 1) {
    throw new ScheduledPublicationMediaRevisionError("Cette programmation utilise une seule source vidéo. Pour une autre vidéo sur un canal, créez une programmation séparée.");
  }
  const images = [...new Map(Object.values(imagesByChannel).flat().map(item => [text(record(item).id), item])).values()];
  if (images.length > 5) throw new ScheduledPublicationMediaRevisionError("Une programmation peut contenir au maximum cinq images différentes. Utilisez une autre programmation pour les images supplémentaires.");
  const video = Object.values(videoByChannel).find(Boolean) || null;
  const normalized = { ...payload, scheduledMediaRevisionRequested: false, images, video, imagesByChannel, videoByChannel, imageSettingsByChannel: settings,
    publishPayload: { ...publish, images, video, imagesByChannel, videoByChannel, imageSettingsByChannel: settings } };
  const created = await supabaseAdmin.from("publication_workspaces").insert({ account_id: params.accountId, created_by_auth_user_id: params.actorAuthUserId,
    client_workspace_key: `scheduled-publication:${params.scheduledActionId}:revision:${randomUUID()}`, source_module: "booster_scheduled_snapshot", status: "scheduled",
    selected_channels: channels, generated_content: record(publish.postByChannel), generation_options: {}, revision: 1, scheduled_for: params.scheduledAt,
    workspace_metadata: { scheduled_media_snapshot: true, scheduled_action_id: params.scheduledActionId, previous_workspace_id: previousWorkspaceId, snapshot_version: 2 },
  }).select("id").single();
  if (created.error) throw created.error;
  const workspaceId = text(created.data?.id);
  if (!workspaceId) throw new ScheduledPublicationMediaRevisionError("La nouvelle version des médias n’a pas pu être créée.");
  const discard = async () => {
    const result = await supabaseAdmin.from("publication_workspaces").delete().eq("id", workspaceId).eq("account_id", params.accountId);
    if (result.error) console.warn("[scheduled-media-revision] private workspace cleanup failed", { workspaceId });
  };
  try {
    const links = [...assets.values()].map((item, index) => ({ workspace_id: workspaceId, media_id: item.row.id, position: index,
      media_role: index ? "secondary" : "primary", selected_channels: [...item.channels], media_settings: item.settings, channel_settings: {}, added_by_auth_user_id: params.actorAuthUserId }));
    if (links.length) { const result = await supabaseAdmin.from("publication_workspace_media").insert(links); if (result.error) throw result.error; }
  } catch (error) { await discard(); throw error; }
  return { workspaceId, payload: applyScheduledPublicationMediaSnapshot(normalized, workspaceId, previousWorkspaceId || workspaceId), discard };
}
