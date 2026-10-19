#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const BUCKET = "inrcy-pro-media";
const WAV = "audio/wav";
const TIMEOUT_MS = 12_000;

async function readPrivateBucket(storage) {
  const result = await storage.getBucket(BUCKET).catch(() => null);
  if (!result || result.error || !result.data) throw new Error("voice_storage_bucket_read_failed");
  const bucket = result.data;
  if (bucket.public !== false) throw new Error("voice_storage_private_bucket_required");
  const mimeTypes = bucket.allowed_mime_types;
  if (mimeTypes != null && (!Array.isArray(mimeTypes) || mimeTypes.some((type) => typeof type !== "string" || !type))) {
    throw new Error("voice_storage_bucket_metadata_invalid");
  }
  return bucket;
}

function allowsWav(bucket) {
  const types = bucket.allowed_mime_types;
  return !types?.length || types.some((type) => [WAV, "audio/*", "*/*"].includes(type.toLowerCase()));
}

/** No file upload, object deletion, bucket creation or privacy change is performed. */
export async function configureCharacterVoiceStorage({ storage, apply = false }) {
  const before = await readPrivateBucket(storage);
  if (allowsWav(before)) return { ready: true, changed: false, bucket: BUCKET, private: true, wavAllowed: true };
  if (!apply) return { ready: false, changed: false, bucket: BUCKET, private: true, wavAllowed: false, action: "run_with_apply" };

  const allowedMimeTypes = [...before.allowed_mime_types, WAV];
  const result = await storage.updateBucket(BUCKET, {
    public: false,
    fileSizeLimit: before.file_size_limit,
    allowedMimeTypes,
  }).catch(() => null);
  if (!result || result.error) throw new Error("voice_storage_bucket_update_failed");

  const after = await readPrivateBucket(storage);
  const sameFileSizeLimit = String(after.file_size_limit ?? "") === String(before.file_size_limit ?? "");
  const sameMimeTypes = Array.isArray(after.allowed_mime_types) &&
    after.allowed_mime_types.length === allowedMimeTypes.length &&
    allowedMimeTypes.every((type, index) => after.allowed_mime_types[index] === type);
  if (!allowsWav(after) || !sameFileSizeLimit || !sameMimeTypes) throw new Error("voice_storage_bucket_verification_failed");
  return { ready: true, changed: true, bucket: BUCKET, private: true, wavAllowed: true };
}

export function parseCharacterVoiceStorageArguments(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) return { apply: false };
  if (args.length === 1 && args[0] === "--apply") return { apply: true };
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { help: true };
  throw new Error("voice_storage_arguments_invalid");
}

async function main() {
  const mode = parseCharacterVoiceStorageArguments(process.argv.slice(2));
  if (mode.help) {
    process.stdout.write("Usage: node --use-system-ca --env-file=.env.local scripts/configure-character-voice-storage.mjs [--check|--apply]\nDefault: read-only check. --apply adds audio/wav only when the private bucket's MIME allowlist requires it.\nExit codes: 0 ready; 2 configuration needed; 1 error.\n");
    return;
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("voice_storage_server_configuration_missing");
  const { createClient } = await import("@supabase/supabase-js");
  let client;
  try {
    client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: (input, init = {}) => globalThis.fetch(input, {
        ...init,
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      }) },
    });
  } catch { throw new Error("voice_storage_server_configuration_invalid"); }
  const result = await configureCharacterVoiceStorage({ storage: client.storage, apply: mode.apply });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ready) process.exitCode = 2;
}

const ERROR_CODES = new Set([
  "voice_storage_bucket_read_failed", "voice_storage_private_bucket_required", "voice_storage_bucket_metadata_invalid",
  "voice_storage_bucket_update_failed", "voice_storage_bucket_verification_failed", "voice_storage_arguments_invalid",
  "voice_storage_server_configuration_missing", "voice_storage_server_configuration_invalid",
]);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = error instanceof Error && ERROR_CODES.has(error.message) ? error.message : "voice_storage_configuration_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
