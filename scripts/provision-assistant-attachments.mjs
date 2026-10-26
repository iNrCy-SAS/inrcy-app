import { createClient } from "@supabase/supabase-js";

// Run with server environment variables (locally: node --env-file=.env.local ...).
// This bucket has no public or browser-authenticated access policy. Only signed
// one-object uploads and authenticated server handlers can access its contents.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Server Storage configuration is missing.");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const id = "inrcy-assistant-attachments";
const current = await client.storage.getBucket(id);
if (current.data) {
  if (current.data.public || Number(current.data.file_size_limit) !== 20 * 1024 * 1024) throw new Error("Existing assistant bucket has unexpected settings; review it before changing anything.");
} else {
  if (Number(current.error?.statusCode) !== 404) throw new Error("Unable to check the private assistant bucket.");
  const created = await client.storage.createBucket(id, { public: false, fileSizeLimit: 20 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "application/pdf", "application/json", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "text/plain", "text/markdown", "video/mp4", "video/quicktime", "video/webm"] });
  if (created.error) throw new Error("Unable to create the private assistant bucket.");
}
console.log(JSON.stringify({ bucket: id, public: false, maxFileBytes: 20 * 1024 * 1024, ready: true }));
