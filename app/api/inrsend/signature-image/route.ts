import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { asRecord, asString } from "@/lib/tsSafe";
import type { SupabaseLike } from "@/lib/inrsendSignature";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";

const BUCKET = "booster";
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

function sanitizeFilename(name: string): string {
  const trimmed = String(name || "signature").trim().toLowerCase();
  const safe = trimmed.replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || "signature";
}

export async function POST(req: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Aucune image reçue." }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Format d’image non pris en charge." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Image trop lourde. Choisissez un fichier inférieur à 5 Mo." }, { status: 400 });
  }

  const ext = sanitizeFilename(file.name).split(".").pop() || (file.type === "image/svg+xml" ? "svg" : "png");
  const path = `signatures/${activeUserId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const upload = await supabaseAdmin.storage.from(BUCKET).upload(path, toExactStorageArrayBuffer(buffer), {
    contentType: file.type,
    upsert: false,
    cacheControl: "3600",
  });

  if (upload.error) {
    return jsonUserFacingError(upload.error, { status: 500, fallback: "Impossible d’envoyer l’image pour le moment." });
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ ok: true, imagePath: path, imageUrl: data.publicUrl || "" });
}

export async function DELETE(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await req.json().catch(() => ({}));
  const imagePath = asString(asRecord(body).imagePath)?.trim() || "";
  if (!imagePath) return NextResponse.json({ ok: true });
  if (!imagePath.startsWith(`signatures/${activeUserId}/`)) {
    return NextResponse.json({ error: "Chemin d’image invalide." }, { status: 400 });
  }

  await supabaseAdmin.storage.from(BUCKET).remove([imagePath]);

  const { data: cfgRow } = await (supabase as SupabaseLike).from("pro_tools_configs").select("settings").eq("user_id", activeUserId).maybeSingle();
  const currentSettings = asRecord(asRecord(cfgRow).settings);
  const nextSettings = {
    ...currentSettings,
    inrsend: {
      ...asRecord(currentSettings.inrsend),
      signature_image_path: "",
      signature_image_url: "",
    },
  };

  await (supabase as SupabaseLike).from("pro_tools_configs").upsert({ user_id: activeUserId, settings: nextSettings }, { onConflict: "user_id" });
  return NextResponse.json({ ok: true });
}
