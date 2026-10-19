import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as voices from "../../lib/aiMediaCharacterVoices.ts";

const nativeRequire = createRequire(import.meta.url);
export const NOW = Date.UTC(2026, 9, 19, 12);
export const ACCOUNT = "account-test";

/** Actual PCM data and a canonical RIFF header, without executing a decoder. */
export function wav(seconds = 2, sampleRate = 16_000, channels = 1) {
  const samples = Math.round(seconds * sampleRate);
  const dataBytes = samples * channels * 2;
  const result = Buffer.alloc(44 + dataBytes);
  result.write("RIFF", 0); result.writeUInt32LE(result.length - 8, 4); result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(channels, 22);
  result.writeUInt32LE(sampleRate, 24); result.writeUInt32LE(sampleRate * channels * 2, 28);
  result.writeUInt16LE(channels * 2, 32); result.writeUInt16LE(16, 34);
  result.write("data", 36); result.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index++) for (let channel = 0; channel < channels; channel++) {
    result.writeInt16LE(Math.round(Math.sin(index * 440 * Math.PI * 2 / sampleRate) * 4_000), 44 + (index * channels + channel) * 2);
  }
  return result;
}

export function voicePath(accountId = ACCOUNT, createdAt = NOW, serial = "000000000001") {
  return `${voices.AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT}/${new Date(createdAt).toISOString().slice(0, 10)}/${accountId}__${createdAt}__00000000-0000-4000-8000-${serial}.wav`;
}

export function sample(path = voicePath()) {
  return { path, name: "vocal.wav", mimeType: "audio/wav" as const, durationSeconds: 2, sizeBytes: 64_044 };
}

export function load<T>(filename: string, dependencies: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../../${filename}`, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { fileName: filename, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", javascript)(record, record.exports, (id: string) => {
    if (id in dependencies) return dependencies[id];
    if (id === "server-only") return {};
    if (id === "./aiMediaCharacterVoices.ts" || id === "@/lib/aiMediaCharacterVoices") return voices;
    if (id.startsWith("node:")) return nativeRequire(id);
    throw new Error(`unexpected_test_dependency:${id}`);
  });
  return record.exports as T;
}

export const ffmpegPath = nativeRequire("ffmpeg-static") as string;
export const audio = load<typeof import("../../lib/aiMediaCharacterVoiceAudio.ts")>("lib/aiMediaCharacterVoiceAudio.ts", {
  "@/lib/mediaVideoNormalizer": { resolveVideoNormalizationFfmpegPath: async () => ffmpegPath },
});

export function storageRuntime() {
  return load<typeof import("../../lib/aiMediaCharacterVoiceStorage.ts")>("lib/aiMediaCharacterVoiceStorage.ts", {
    "@/lib/supabaseAdmin": { supabaseAdmin: { get storage() { throw new Error("real_storage_forbidden_in_test"); } } },
    "./aiMediaCharacterVoiceAudio.ts": audio,
  });
}

type Operation = "getBucket" | "upload" | "download" | "createSignedUrl" | "remove" | "list";
export function fakeStorage(options: { public?: boolean; fail?: Operation; throws?: Operation; signedUrl?: string; body?: Buffer;
  listings?: (path: string, offset: number) => { name: string; id?: string | null }[] } = {}) {
  const calls: { operation: Operation; args: unknown[] }[] = [];
  function invoked(operation: Operation, ...args: unknown[]) {
    calls.push({ operation, args });
    if (options.throws === operation) throw new Error("https://storage.invalid/private?token=secret");
    return options.fail === operation ? new Error("private storage diagnostic token=secret") : null;
  }
  const bucket = {
    async upload(path: string, body: Uint8Array, config: { contentType: string; cacheControl: string; upsert: boolean }) {
      return { error: invoked("upload", path, body, config) };
    },
    async download(path: string) { return { data: new Blob([new Uint8Array(options.body ?? wav())]), error: invoked("download", path) }; },
    async createSignedUrl(path: string, seconds: number) { return { data: { signedUrl: options.signedUrl ?? `https://storage.invalid/${path}?token=test` }, error: invoked("createSignedUrl", path, seconds) }; },
    async remove(paths: string[]) { return { error: invoked("remove", [...paths]) }; },
    async list(path: string, config: { limit: number; offset: number; sortBy: { column: string; order: "asc" } }) {
      return { data: options.listings?.(path, config.offset) ?? [], error: invoked("list", path, config) };
    },
  };
  const storage = {
    async getBucket(name: string) { return { data: { public: options.public ?? false }, error: invoked("getBucket", name) }; },
    from(name: string) { assert.equal(name, "inrcy-pro-media"); return bucket; },
  };
  return { storage, calls };
}
