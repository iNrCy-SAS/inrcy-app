import "server-only";
import { setTimeout as delay } from "node:timers/promises";

// Official new-standard API: a single API key, not the legacy AK/SK JWT.
// https://kling.ai/document-api/api/get-started/authentication
const ORIGIN = "https://api-singapore.klingai.com";
export const KLING_TEMPORARY_VOICE_PREFIX = "inrcy-k4-";
type JsonObject = Record<string, unknown>;
export type KlingVideoRequest = {
  contents: ({ type: "prompt"; text: string } | { type: "refer_image"; url: string; id: string } |
    { type: "voice"; voice_id: string; id: string })[];
  settings: { resolution: "720p" | "1080p"; aspect_ratio: "1:1" | "9:16" | "16:9"; duration: number; audio: "native" };
  options: { external_task_id: string };
};
export type KlingVideoTask = {
  id: string; status: "submitted" | "processing" | "succeeded" | "failed";
  outputs: { type: string; url: string; duration: number }[];
};

/** Never retain supplier messages, which can contain private URLs or input text. */
export class KlingApiError extends Error {
  constructor(readonly phase: string, readonly statusCode = 0, readonly upstreamCode = 0, readonly uncertain = false) {
    super(`ai_video_kling_${phase}:${statusCode}:${upstreamCode}`);
    this.name = "KlingApiError";
  }
}
function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(value)) throw new KlingApiError("response_invalid", 0, 0, true);
  return value;
}
function safeUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(String(value || "")); } catch { throw new KlingApiError("output_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new KlingApiError("output_invalid");
  return url.toString();
}

export function createKlingApiClient(options: {
  apiKey: string; fetch?: typeof fetch; sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}) {
  if (!options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) throw new Error("ai_video_kling_credentials_missing");
  const fetcher = options.fetch ?? fetch;
  const sleep = options.sleep ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
  async function request(method: "GET" | "POST", path: string, body?: JsonObject, signal?: AbortSignal): Promise<JsonObject> {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(25_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetcher(ORIGIN + path, {
        method, headers: { Authorization: `Bearer ${options.apiKey.trim()}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: requestSignal, redirect: "error", cache: "no-store",
      });
    } catch {
      signal?.throwIfAborted();
      throw new KlingApiError("network_unavailable", 0, 0, method === "POST");
    }
    let payload: JsonObject;
    try {
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error("response_too_large");
      payload = object(JSON.parse(text));
    } catch {
      signal?.throwIfAborted();
      throw new KlingApiError("response_invalid", response.status, 0, method === "POST");
    }
    const code = Number(payload.code);
    if (!response.ok || code !== 0) {
      const phase = response.status === 401 || response.status === 403 ? "credentials_rejected" : "request_rejected";
      throw new KlingApiError(phase, response.status, Number.isSafeInteger(code) ? code : 0,
        method === "POST" && (response.status >= 500 || [408, 409].includes(response.status)));
    }
    return payload;
  }
  async function poll<T>(read: () => Promise<T | null>, signal?: AbortSignal): Promise<T> {
    for (;;) {
      signal?.throwIfAborted();
      try { const value = await read(); if (value !== null) return value; }
      catch (error) {
        if (!(error instanceof KlingApiError) || (error.statusCode !== 429 && error.statusCode < 500 && error.phase !== "network_unavailable")) throw error;
      }
      await sleep(4_000, signal);
    }
  }
  function videoTask(raw: unknown, expectedId?: string): KlingVideoTask {
    const data = object(raw);
    const taskId = id(data.id);
    if (expectedId && expectedId !== taskId) throw new KlingApiError("task_scope_invalid");
    if (!["submitted", "processing", "succeeded", "failed"].includes(String(data.status))) throw new KlingApiError("response_invalid");
    return { id: taskId, status: data.status as KlingVideoTask["status"], outputs: Array.isArray(data.outputs)
      ? data.outputs.filter(raw => object(raw).type === "video").map(raw => {
        const output = object(raw);
        return { type: "video", url: safeUrl(output.url), duration: Number(output.duration) };
      }) : [] };
  }
  async function findVideo(externalTaskId: string, signal?: AbortSignal): Promise<KlingVideoTask | null> {
    const payload = await request("GET", `/tasks?external_task_ids=${encodeURIComponent(id(externalTaskId))}`, undefined, signal);
    if (!Array.isArray(payload.data) || payload.data.length > 1) throw new KlingApiError("task_scope_invalid");
    if (!payload.data.length) return null;
    const raw = object(payload.data[0]);
    if (raw.external_id !== undefined && raw.external_id !== externalTaskId) throw new KlingApiError("task_scope_invalid");
    return videoTask(raw);
  }
  return {
    findVideo,
    async createVoice(args: { url: string; externalTaskId: string; signal?: AbortSignal }): Promise<string> {
      const externalTaskId = id(args.externalTaskId);
      let taskId: string;
      try {
        const payload = await request("POST", "/v1/general/custom-voices", {
          voice_name: `iNrCy ${externalTaskId.slice(-14)}`,
          voice_url: safeUrl(args.url), external_task_id: externalTaskId,
        }, args.signal);
        taskId = id(object(payload.data).task_id);
      } catch (error) {
        if (!(error instanceof KlingApiError) || !error.uncertain) throw error;
        // Query the original submission after a lost ACK; never create a second profile.
        taskId = externalTaskId;
      }
      try { return await poll(async () => {
        const payload = await request("GET", `/v1/general/custom-voices/${encodeURIComponent(taskId)}`, undefined, args.signal);
        const data = object(payload.data);
        const taskInfo = object(data.task_info);
        if (taskInfo.external_task_id !== undefined && taskInfo.external_task_id !== externalTaskId) throw new KlingApiError("task_scope_invalid");
        if (data.task_status === "failed") throw new KlingApiError("voice_failed");
        if (data.task_status !== "succeed") {
          if (!["submitted", "processing"].includes(String(data.task_status))) throw new KlingApiError("response_invalid", 0, 0, true);
          return null;
        }
        const voices = object(data.task_result).voices;
        if (!Array.isArray(voices) || voices.length !== 1) throw new KlingApiError("voice_output_invalid", 0, 0, true);
        return id(object(voices[0]).voice_id);
      }, args.signal); }
      catch (error) {
        if (error instanceof KlingApiError && error.phase === "voice_failed") throw error;
        // Failure to query an accepted/possibly accepted creation is not a rejected POST.
        throw new KlingApiError("voice_completion_unconfirmed", error instanceof KlingApiError ? error.statusCode : 0,
          error instanceof KlingApiError ? error.upstreamCode : 0, true);
      }
    },
    async submitVideo(body: KlingVideoRequest, signal?: AbortSignal): Promise<KlingVideoTask> {
      try {
        const payload = await request("POST", "/omni-video/kling-4.0", body, signal);
        return videoTask(payload.data);
      } catch (error) {
        if (!(error instanceof KlingApiError) || !error.uncertain) throw error;
        // The supplier may already be generating. Recover by the original ID only.
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const existing = await findVideo(body.options.external_task_id, signal);
            if (existing) return existing;
          } catch {
            signal?.throwIfAborted();
            // A lookup error cannot turn the uncertain POST into a definite rejection.
          }
          await sleep(2_000, signal);
        }
        throw error;
      }
    },
    async waitVideo(task: KlingVideoTask, signal?: AbortSignal): Promise<KlingVideoTask> {
      return poll(async () => {
        if (task.status === "failed") throw new KlingApiError("task_failed");
        if (task.status === "succeeded") {
          if (task.outputs.length !== 1 || !Number.isFinite(task.outputs[0].duration) || task.outputs[0].duration <= 0) throw new KlingApiError("output_invalid");
          return task;
        }
        const payload = await request("GET", `/tasks?task_ids=${encodeURIComponent(task.id)}`, undefined, signal);
        if (!Array.isArray(payload.data) || payload.data.length !== 1) throw new KlingApiError("task_scope_invalid");
        task = videoTask(payload.data[0], task.id);
        return null;
      }, signal);
    },
    async deleteVoice(voiceId: string, signal?: AbortSignal) {
      await request("POST", "/v1/general/delete-voices", { voice_id: id(voiceId) }, signal);
    },
    async listVoiceTasks(page: number, signal?: AbortSignal): Promise<JsonObject[]> {
      const payload = await request("GET", `/v1/general/custom-voices?pageNum=${page}&pageSize=100`, undefined, signal);
      if (!Array.isArray(payload.data)) throw new KlingApiError("response_invalid");
      return payload.data.map(object);
    },
  };
}

/** Only this integration's temporary profiles can be expired by the daily cleanup. */
export function getExpiredKlingTemporaryVoiceIds(tasks: readonly JsonObject[], now = Date.now()): string[] {
  return tasks.flatMap(task => {
    const externalId = String(object(task.task_info).external_task_id || "");
    const createdAt = Number(task.created_at);
    if (!/^inrcy-k4-(?:[0-9a-f]{32}|[0-9a-f]{40})-voice-[1-5](?:-[0-9a-f]{12})?$/.test(externalId) || !Number.isSafeInteger(createdAt) ||
      createdAt <= 0 || createdAt > now - 24 * 60 * 60 * 1000 || task.task_status !== "succeed") return [];
    const voices = object(task.task_result).voices;
    return Array.isArray(voices) ? voices.flatMap(voice => {
      try { return [id(object(voice).voice_id)]; } catch { return []; }
    }) : [];
  });
}
