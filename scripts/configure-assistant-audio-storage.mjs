import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const BUCKET = "inrcy-assistant-attachments";
const AUDIO = ["audio/mpeg", "audio/wav"];
const MAX_BYTES = 20 * 1024 * 1024;

/** Read-only by default. Preserve the private access policy, size and every
 * existing allowed MIME type; add only the two natively validated formats. */
export async function configureAssistantAudioStorage(client, apply = false) {
  const { data: before, error } = await client.storage.getBucket(BUCKET);
  if (error || !before || before.public !== false || Number(before.file_size_limit) !== MAX_BYTES
    || before.allowed_mime_types !== null && (!Array.isArray(before.allowed_mime_types) || before.allowed_mime_types.some(value => typeof value !== "string"))) throw new Error("Assistant bucket settings must be reviewed before enabling audio.");
  const missing = before.allowed_mime_types === null ? [] : AUDIO.filter(value => !before.allowed_mime_types.includes(value));
  if (!apply || !missing.length) return { bucket: BUCKET, public: false, maxFileBytes: MAX_BYTES, missingMimeTypes: missing, applied: false, ready: missing.length === 0 };
  const allowedMimeTypes = [...before.allowed_mime_types, ...missing];
  const { error: updated } = await client.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes });
  if (updated) throw new Error("Unable to add the two assistant audio MIME types.");
  const { data: after, error: failedRead } = await client.storage.getBucket(BUCKET);
  if (failedRead || !after || after.public !== false || Number(after.file_size_limit) !== MAX_BYTES
    || !Array.isArray(after.allowed_mime_types) || after.allowed_mime_types.length !== allowedMimeTypes.length
    || !allowedMimeTypes.every(value => after.allowed_mime_types.includes(value))) throw new Error("Assistant audio settings could not be verified after update.");
  return { bucket: BUCKET, public: false, maxFileBytes: MAX_BYTES, missingMimeTypes: [], applied: true, ready: true, existingMimeTypesPreserved: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server Storage configuration is missing.");
  if (process.argv.slice(2).some(value => value !== "--apply")) throw new Error("Use no argument for a read-only check, or --apply to enable the two formats.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(JSON.stringify(await configureAssistantAudioStorage(client, process.argv.includes("--apply"))));
}
