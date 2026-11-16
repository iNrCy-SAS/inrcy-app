import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withApi } from "@/lib/observability/withApi";
import { readStudioReferenceMedia, StudioReferenceMediaUnavailableError } from "@/lib/studioReferencesServer";
import { normalizeStudioReferenceMemory, STUDIO_REFERENCES_ACCOUNT_HEADER, STUDIO_REFERENCES_MAX_BODY_BYTES,
  StudioReferencesValidationError, StudioReferencesVersionError, type StudioReferenceMemory, type StudioReferencesResponse } from "@/lib/studioReferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });
function accountChanged() {
  return json({ ok: false, code: "studio_references_account_changed", error: "Le compte actif a changé. Rechargez vos médias avant de continuer." }, 409);
}
function failed(error: unknown) {
  const code = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  if (error instanceof StudioReferencesVersionError || /STUDIO_REFERENCES_VERSION_UNSUPPORTED/i.test(code))
    return json({ ok: false, code: "studio_references_version_unsupported", error: "Cette mémoire a été créée par une version plus récente. Rechargez la page." }, 409);
  if (error instanceof StudioReferencesValidationError || /STUDIO_REFERENCES_INVALID/i.test(code))
    return json({ ok: false, code: "studio_references_invalid", error: "Les médias à mémoriser sont invalides. Vérifiez les photos et les voix associées." }, 400);
  if (error instanceof StudioReferenceMediaUnavailableError || /STUDIO_REFERENCES_MEDIA_UNAVAILABLE/i.test(code))
    return json({ ok: false, code: "studio_references_media_unavailable", error: "Un média n’est plus disponible dans ce compte. Sélectionnez-le à nouveau." }, 409);
  if (/STUDIO_REFERENCES_SETTINGS_INVALID/i.test(code))
    return json({ ok: false, code: "studio_references_settings_invalid", error: "La mémoire enregistrée doit être vérifiée. Aucune donnée n’a été écrasée." }, 409);
  return json({ ok: false, code: "studio_references_unavailable", error: "La mémoire des médias est momentanément indisponible. Réessayez." }, 503);
}
async function boundedJson(request: Request) {
  if (request.headers.get("content-type")?.toLowerCase().split(";")[0].trim() !== "application/json" || !request.body
    || Number(request.headers.get("content-length") ?? 0) > STUDIO_REFERENCES_MAX_BODY_BYTES) throw new StudioReferencesValidationError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > STUDIO_REFERENCES_MAX_BODY_BYTES) { await reader.cancel(); throw new StudioReferencesValidationError(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new StudioReferencesValidationError(); }
}
async function references(request: Request, method: "GET" | "PUT" | "DELETE") {
  const auth = await requireUser();
  if (auth.errorResponse) {
    for (const [key, value] of Object.entries(HEADERS)) auth.errorResponse.headers.set(key, value);
    return auth.errorResponse;
  }
  const expectedAccountId = request.headers.get(STUDIO_REFERENCES_ACCOUNT_HEADER);
  if ((method !== "GET" || expectedAccountId !== null) && expectedAccountId?.toLowerCase() !== auth.activeUserId.toLowerCase()) return accountChanged();
  try {
    let memory: StudioReferenceMemory | null;
    if (method === "GET") {
      const { data, error } = await supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", auth.activeUserId).maybeSingle();
      if (error) throw error;
      const settings = data?.settings;
      if (data && (!settings || typeof settings !== "object" || Array.isArray(settings))) throw new Error("STUDIO_REFERENCES_SETTINGS_INVALID");
      memory = settings?.studio_references === undefined ? null : normalizeStudioReferenceMemory(settings.studio_references);
    } else {
      memory = method === "DELETE" ? null : normalizeStudioReferenceMemory(await boundedJson(request));
      if (memory) await readStudioReferenceMedia(auth.activeUserId, memory, { strict: true });
      const { data, error } = await supabaseAdmin.rpc("inrcy_set_studio_references", {
        p_account_id: auth.activeUserId, p_actor_auth_user_id: auth.authUserId, p_memory: memory,
      });
      if (error) throw error;
      memory = data === null ? null : normalizeStudioReferenceMemory(data);
    }
    const assets = memory ? await readStudioReferenceMedia(auth.activeUserId, memory) : { media: [], unavailableMediaIds: [] };
    return json({ ok: true, accountId: auth.activeUserId, memory, ...assets } satisfies StudioReferencesResponse);
  } catch (error) { return failed(error); }
}
export const GET = withApi((request: Request) => references(request, "GET"), { route: "/api/media-generation/references" });
export const PUT = withApi((request: Request) => references(request, "PUT"), { route: "/api/media-generation/references" });
export const DELETE = withApi((request: Request) => references(request, "DELETE"), { route: "/api/media-generation/references" });
