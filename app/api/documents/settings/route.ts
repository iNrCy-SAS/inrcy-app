import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { mergeInrDocumentsSettings, normalizeInrDocumentsSettings } from "@/lib/inrdocumentsSettings";

function safeObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET() {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const { data, error } = await supabase
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (error) return jsonUserFacingError(error, { status: 500 });

  const rootSettings = safeObj(data?.settings);
  const settings = normalizeInrDocumentsSettings(rootSettings.inrdocuments);

  return NextResponse.json({ ok: true, settings });
}

export async function PATCH(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await req.json().catch(() => ({}));
  const patch = safeObj((body as any)?.settings ?? body);

  const { data: current, error: currentError } = await supabase
    .from("pro_tools_configs")
    .select("settings")
    .eq("user_id", activeUserId)
    .maybeSingle();

  if (currentError) return jsonUserFacingError(currentError, { status: 500 });

  const currentSettings = safeObj(current?.settings);
  const nextInrDocuments = mergeInrDocumentsSettings(currentSettings.inrdocuments, patch);
  const nextSettings = {
    ...currentSettings,
    inrdocuments: nextInrDocuments,
  };

  const { error } = await supabase
    .from("pro_tools_configs")
    .upsert({ user_id: activeUserId, settings: nextSettings }, { onConflict: "user_id" });

  if (error) return jsonUserFacingError(error, { status: 500 });

  return NextResponse.json({ ok: true, settings: nextInrDocuments });
}
