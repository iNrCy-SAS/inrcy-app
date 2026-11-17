import "server-only";
import { setTimeout as delay } from "node:timers/promises";

const ORIGIN = "https://api.heygen.com";
const ID = /^[a-zA-Z0-9_-]{1,180}$/;
const MAX_JSON_BYTES = 1024 * 1024;
export type HeygenAsset = { type: "asset_id"; asset_id: string };
export type HeygenStudioScene =
  | { type: "avatar_video"; input: { type: "avatar"; avatar_id: string; script: string; voice_id: string; motion_prompt?: string; expressiveness?: "low" } }
  | { type: "image"; source: HeygenAsset; script?: string; voice_id?: string; duration?: number };
export type HeygenVideoState = { id: string; status: "pending" | "processing" | "completed" | "failed"; videoUrl?: string; durationSeconds?: number; failureCode?: string };

export class HeygenApiError extends Error {
  constructor(readonly statusCode: number, readonly upstreamCode: string, readonly uncertain = false) {
    super(`ai_video_heygen_${upstreamCode}:${statusCode}`);
    this.name = "HeygenApiError";
  }
}

export function heygenIdentifier(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new HeygenApiError(0, "response_invalid");
  return value;
}
function code(value: unknown) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/i.test(value) ? value.toLowerCase() : "request_failed";
}
export function isHeygenMediaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["heygen.ai", "heygen.com", "heygenusercontent.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
async function bounded(response: Response, maximum: number): Promise<Buffer> {
  if (!response.body || Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel(); throw new HeygenApiError(0, "response_size_invalid");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) throw new HeygenApiError(0, "response_size_invalid");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks, bytes);
}

/** V3 only: legacy HeyGen video endpoints were retired in October 2026. */
export function createHeygenApiClient(options: { apiKey: string; fetch?: typeof fetch; sleep?: typeof delay }) {
  const token = options.apiKey.trim();
  if (!token || /\s/.test(token)) throw new HeygenApiError(401, "credentials_missing");
  const send = options.fetch ?? fetch;
  const sleep = options.sleep ?? delay;
  async function request<T>(path: string, input: { method?: "GET" | "POST" | "DELETE"; json?: unknown; form?: FormData; idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<T> {
    if (!path.startsWith("/v3/") || path.includes("..") || path.includes("#")) throw new HeygenApiError(0, "path_invalid");
    const method = input.method ?? "GET";
    const signal = AbortSignal.any([...(input.signal ? [input.signal] : []), AbortSignal.timeout(30_000)]);
    let response: Response;
    try {
      response = await send(ORIGIN + path, {
        method, signal, redirect: "error", cache: "no-store",
        headers: { "X-Api-Key": token, ...(input.json ? { "Content-Type": "application/json" } : {}),
          ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
        ...(input.json ? { body: JSON.stringify(input.json) } : input.form ? { body: input.form } : {}),
      });
    } catch { throw new HeygenApiError(0, "transport_failed", method === "POST"); }
    let body: { data?: T; error?: { code?: unknown } };
    if (response.status === 204 && method === "DELETE") return undefined as T;
    try { body = JSON.parse((await bounded(response, MAX_JSON_BYTES)).toString("utf8")); }
    catch { throw new HeygenApiError(response.status, "response_invalid", method === "POST"); }
    if (!response.ok) {
      const publicCode = ({ 401: "credentials_rejected", 403: "permission_denied", 402: "insufficient_balance", 429: "rate_limited" } as Record<number,string>)[response.status];
      throw new HeygenApiError(response.status, publicCode || code(body.error?.code), method === "POST" && response.status >= 500);
    }
    if (body.data === undefined) throw new HeygenApiError(response.status, "response_invalid", method === "POST");
    return body.data;
  }
  return {
    async uploadImage(buffer: Buffer, signal?: AbortSignal): Promise<HeygenAsset> {
      if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new HeygenApiError(0, "image_size_invalid");
      const form = new FormData(); form.append("file", new Blob([new Uint8Array(buffer)], { type: "image/png" }), "person.png");
      const result = await request<{ asset_id: unknown }>("/v3/assets", { method: "POST", form, signal });
      return { type: "asset_id", asset_id: heygenIdentifier(result.asset_id) };
    },
    async createPhotoAvatar(asset: HeygenAsset, name: string, idempotencyKey: string, signal?: AbortSignal) {
      const result = await request<{ avatar_item?: { id?: unknown }; avatar_group?: { id?: unknown } }>("/v3/avatars", {
        method: "POST", json: { type: "photo", name: name.slice(0,64), file: asset }, idempotencyKey, signal,
      });
      return { id: heygenIdentifier(result.avatar_item?.id), groupId: heygenIdentifier(result.avatar_group?.id) };
    },
    async createVoice(url: string, name: string, language: string, idempotencyKey: string, signal?: AbortSignal, onCreated?: (id: string) => void) {
      const result = await request<{ voice_id?: unknown }>("/v3/models/audio/voices", { method: "POST", idempotencyKey, signal,
        json: { mode: "instant", name: name.slice(0,64), language, audio: [{ type: "url", url }], similarity: "max" } });
      const id = heygenIdentifier(result.voice_id);
      onCreated?.(id);
      for (let attempt = 0; attempt < 45; attempt++) {
        signal?.throwIfAborted();
        const voice = await request<{ status?: string; failure_reason?: unknown }>(`/v3/models/audio/voices/${id}`, { signal });
        if (voice.status === "ACTIVE") return id;
        if (voice.status === "FAILED") throw new HeygenApiError(422, "voice_clone_failed");
        await sleep(1000, undefined, { signal });
      }
      throw new HeygenApiError(0, "voice_pending", true);
    },
    async publicVoices(language: string, signal?: AbortSignal) {
      const result = await request<Array<{ voice_id?: unknown }>>(`/v3/models/audio/voices?type=public&language=${encodeURIComponent(language)}&limit=20`, { signal });
      if (!Array.isArray(result)) throw new HeygenApiError(0, "voice_response_invalid");
      const voices = result.flatMap(item => typeof item.voice_id === "string" && ID.test(item.voice_id) ? [item.voice_id] : []);
      if (!voices.length) throw new HeygenApiError(0, "voice_unavailable");
      return voices;
    },
    async publicAvatar(signal?: AbortSignal) {
      const result = await request<Array<{ id?: unknown; default_voice_id?: unknown; supported_api_engines?: string[] }>>("/v3/avatars/looks?ownership=public&limit=20", { signal });
      if (!Array.isArray(result)) throw new HeygenApiError(0, "avatar_response_invalid");
      const avatar = result.find(item => typeof item.id === "string" && ID.test(item.id) &&
        (!item.supported_api_engines?.length || item.supported_api_engines.includes("avatar_iv")));
      if (!avatar) throw new HeygenApiError(0, "avatar_unavailable");
      return heygenIdentifier(avatar.id);
    },
    async submitVideo(input: { title: string; aspect_ratio: string; resolution: string; scenes: HeygenStudioScene[] }, idempotencyKey: string, signal?: AbortSignal) {
      const result = await request<{ video_id?: unknown }>("/v3/videos", { method: "POST", idempotencyKey, signal, json: { type: "studio", ...input } });
      try { return heygenIdentifier(result.video_id); }
      catch { throw new HeygenApiError(200, "submission_unconfirmed", true); }
    },
    async getVideo(videoId: string, signal?: AbortSignal): Promise<HeygenVideoState> {
      const id = heygenIdentifier(videoId);
      const result = await request<{ id?: unknown; status?: unknown; video_url?: unknown; duration?: unknown; failure_code?: unknown }>(`/v3/videos/${id}`, { signal });
      if (result.id !== id || !["waiting", "pending", "processing", "completed", "failed"].includes(String(result.status))) throw new HeygenApiError(0, "video_response_invalid");
      if (result.status === "completed" && (!isHeygenMediaUrl(result.video_url) || typeof result.duration !== "number" || result.duration <= 0 || result.duration > 180)) throw new HeygenApiError(0, "video_output_invalid");
      return { id, status: result.status === "waiting" ? "pending" : result.status as HeygenVideoState["status"],
        ...(isHeygenMediaUrl(result.video_url) ? { videoUrl: result.video_url } : {}),
        ...(typeof result.duration === "number" ? { durationSeconds: result.duration } : {}),
        ...(result.status === "failed" ? { failureCode: code(result.failure_code) } : {}) };
    },
    async downloadVideo(url: string, signal?: AbortSignal): Promise<Buffer> {
      if (!isHeygenMediaUrl(url)) throw new HeygenApiError(0, "video_url_invalid");
      // The API key must never be forwarded to a CDN or a redirect target.
      const response = await send(url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60_000)]), redirect: "error" });
      if (!response.ok) throw new HeygenApiError(response.status, "download_failed");
      const buffer = await bounded(response, 128 * 1024 * 1024);
      if (buffer.length < 12 || buffer.subarray(4,8).toString("ascii") !== "ftyp") throw new HeygenApiError(0, "video_output_invalid");
      return buffer;
    },
    async deleteVoice(voiceId: string, signal?: AbortSignal) {
      await request(`/v3/models/audio/voices/${heygenIdentifier(voiceId)}`, { method: "DELETE", signal });
    },
    async deleteAvatarGroup(groupId: string, signal?: AbortSignal) {
      await request(`/v3/avatars/${heygenIdentifier(groupId)}`, { method: "DELETE", signal });
    },
    async deleteAsset(assetId: string, signal?: AbortSignal) {
      await request(`/v3/assets/${heygenIdentifier(assetId)}`, { method: "DELETE", signal });
    },
  };
}
