import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { normalizeThreadsPublicationPreferences, parseThreadsPublicationPreferencesPatch } from "@/lib/threadsPublicationPreferences";
import { isMetaChannelPilotEnabledForActorAndAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { META_DIRECT_CHANNELS_PUBLIC_ENABLED } from "@/lib/metaChannelRollout";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/requireUser";
import { withApi } from "@/lib/observability/withApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}
const json = (body: unknown, status = 200) => noStore(NextResponse.json(body, { status }));
async function access() {
  const auth = await requireUser();
  if (auth.errorResponse) return { response: noStore(auth.errorResponse) };
  if (!await isMetaChannelPilotEnabledForActorAndAccount(supabaseAdmin, auth.activeUserId)) return { response: noStore(metaChannelPilotDeniedResponse()) };
  const { data, error } = await supabaseAdmin.from("integrations").select("status,resource_id")
    .eq("user_id", auth.activeUserId).eq("provider", "threads").eq("source", "threads").eq("product", "threads").maybeSingle();
  if (error) return { response: noStore(jsonUserFacingError(error, { status: 500 })) };
  if (data?.status !== "connected" || !String(data?.resource_id || "").trim()) return { response: json({
    ok: false, code: "threads_connection_required", error: "Connectez votre compte Threads avant de régler ses formats de publication.",
  }, 409) };
  return { auth };
}
async function getPreferences() {
  const checked = await access();
  if (checked.response) return checked.response;
  const { data, error } = await checked.auth!.supabase.from("pro_tools_configs").select("settings").eq("user_id", checked.auth!.activeUserId).maybeSingle();
  if (error) return noStore(jsonUserFacingError(error, { status: 500 }));
  return json({ ok: true, preferences: normalizeThreadsPublicationPreferences(data?.settings?.threads?.publicationPreferences) });
}
async function patchPreferences(req: Request) {
  const checked = await access();
  if (checked.response) return checked.response;
  let preferences;
  try { preferences = parseThreadsPublicationPreferencesPatch(await req.json().catch(() => null)); }
  catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Les formats Threads envoyés sont invalides." }, 400); }
  const { data, error } = await supabaseAdmin.rpc("inrcy_set_threads_publication_preferences", {
    p_account_id: checked.auth!.activeUserId, p_preferences: preferences,
    p_admin_pilot: !META_DIRECT_CHANNELS_PUBLIC_ENABLED,
  });
  if (!error) return json({ ok: true, preferences: normalizeThreadsPublicationPreferences(data) });
  if (error.code !== "PGRST202") return noStore(jsonUserFacingError(error, { status: 500 }));
  return json({ ok: false, code: "THREADS_PUBLICATION_PREFERENCES_MIGRATION_REQUIRED",
    error: "La mise à jour sécurisée des préférences Threads doit être appliquée avant d’enregistrer ces réglages. Aucun réglage n’a été modifié.",
  }, 503);
}
export const GET = withApi(getPreferences, { route: "/api/integrations/threads/publication-preferences" });
export const PATCH = withApi(patchPreferences, { route: "/api/integrations/threads/publication-preferences" });
