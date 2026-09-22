"use client";

import { createClient } from "@/lib/supabaseClient";

type UploadOptions = {
  title?: string;
  source?: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

type PreparedItem = {
  client_id: string;
  original_name: string;
  bucket: string;
  storage_path: string;
  token: string;
  content_type: string;
};

async function responseJson(response: Response) {
  return (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
}

export async function uploadFileToMediaLibrary(
  file: File,
  options: UploadOptions = {}
) {
  const clientId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const prepareResponse = await fetch("/api/media-library/upload", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "prepare",
      files: [
        {
          client_id: clientId,
          name: file.name,
          type: file.type,
          size: file.size,
          last_modified: file.lastModified,
        },
      ],
    }),
  });
  const preparePayload = await responseJson(prepareResponse);
  if (!prepareResponse.ok) {
    throw new Error(
      String(preparePayload?.error || "Impossible de préparer la sauvegarde.")
    );
  }
  const prepared = Array.isArray(preparePayload?.items)
    ? (preparePayload.items[0] as PreparedItem | undefined)
    : undefined;
  if (!prepared?.token || !prepared.storage_path || !prepared.bucket) {
    throw new Error("La destination de sauvegarde est indisponible.");
  }

  const supabase = createClient();
  const uploaded = await supabase.storage
    .from(prepared.bucket)
    .uploadToSignedUrl(prepared.storage_path, prepared.token, file, {
      contentType: prepared.content_type || file.type,
    });
  if (uploaded.error) throw uploaded.error;

  const finalizeResponse = await fetch("/api/media-library/upload", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "finalize",
      title: options.title || file.name.replace(/\.[^.]+$/, ""),
      tags: options.tags || [],
      source: options.source || "studio",
      uploads: [
        {
          client_id: clientId,
          original_name: prepared.original_name || file.name,
          storage_path: prepared.storage_path,
          mime_type: prepared.content_type || file.type,
          size_bytes: file.size,
          width: options.width || null,
          height: options.height || null,
          duration_seconds: options.durationSeconds || null,
          upload_protocol: "signed",
          media_metadata: options.metadata || {},
        },
      ],
    }),
  });
  const finalizePayload = await responseJson(finalizeResponse);
  if (!finalizeResponse.ok) {
    throw new Error(
      String(finalizePayload?.error || "Impossible de finaliser la sauvegarde.")
    );
  }
  const result = Array.isArray(finalizePayload?.results)
    ? (finalizePayload.results[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!result || result.ok !== true) {
    throw new Error(
      String(
        result?.error || "La retouche n’a pas été ajoutée à la médiathèque."
      )
    );
  }
  return result;
}
