import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { prepareAiMediaIdentityReferences } from "@/lib/aiMediaIdentityReferences";
import { AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS, AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES } from "@/lib/aiMediaGenerationContracts";
import { INR_AGENT_REFERENCE_BUCKET, INR_AGENT_REFERENCE_ID, inrAgentReferenceStoragePath } from "@/lib/inrAgentMediaReferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: PRIVATE_HEADERS });

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const limited = await enforceRateLimit({ name: "inr_agent_reference_upload", identifier: auth.activeUserId,
    limit: 24, fallbackLimit: 12, window: "10 m", failClosed: true, code: "inr_agent_reference_upload_burst" });
  if (limited) return limited;
  try {
    const raw = await request.text();
    if (raw.length > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS + 2_000) return fail("Cette référence est trop volumineuse.", 413);
    const body = JSON.parse(raw);
    if (body?.accountId !== auth.activeUserId) return fail("L’établissement actif a changé. Recommencez l’ajout.", 409);
    const image = body?.image;
    if (!image || !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType) || typeof image.data !== "string" ||
      image.data.length < 64 || image.data.length > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
      return fail("Ajoutez une image JPG, PNG ou WebP valide.");
    }
    // Reuse Studio's real-byte validation, orientation and metadata stripping.
    const normalized = await prepareAiMediaIdentityReferences([{ mimeType: image.mimeType, data: image.data }]);
    let buffer: Buffer | null = null;
    for (const [size, quality] of [[1280, 82], [1024, 72], [768, 60]] as const) {
      const candidate = await sharp(normalized.buffers[0]).resize(size, size, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#fff" }).jpeg({ quality }).toBuffer();
      if (candidate.byteLength <= AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES) { buffer = candidate; break; }
    }
    if (!buffer) return fail("Cette image n’a pas pu être préparée.");
    const id = randomUUID();
    const { error } = await supabaseAdmin.storage.from(INR_AGENT_REFERENCE_BUCKET)
      .upload(inrAgentReferenceStoragePath(auth.activeUserId, id), buffer, { contentType: "image/jpeg", upsert: false });
    if (error) return fail("La référence n’a pas pu être enregistrée. Réessayez.", 503);
    return NextResponse.json({ id, name: typeof image.name === "string" ? image.name.slice(0, 120) : "Référence" }, { headers: PRIVATE_HEADERS });
  } catch {
    return fail("Cette image de référence n’est pas exploitable.");
  }
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!INR_AGENT_REFERENCE_ID.test(id)) return fail("Référence introuvable.", 404);
  // The account comes exclusively from the authenticated scope. Even an ID
  // copied from another establishment cannot reveal its image.
  const { data, error } = await supabaseAdmin.storage.from(INR_AGENT_REFERENCE_BUCKET)
    .download(inrAgentReferenceStoragePath(auth.activeUserId, id));
  if (error || !data) return fail("Référence introuvable.", 404);
  return new Response(data, { headers: { ...PRIVATE_HEADERS, "Content-Type": "image/jpeg" } });
}
