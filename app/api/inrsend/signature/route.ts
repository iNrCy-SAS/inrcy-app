import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { asRecord, asString } from "@/lib/tsSafe";
import { DEFAULT_INRSEND_SIGNATURE_TEMPLATE, buildInrSendSignature, getInrSendSignatureSettings, type SupabaseLike } from "@/lib/inrsendSignature";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";

export async function GET(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const settings = await getInrSendSignatureSettings(supabase as SupabaseLike, activeUserId);

  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId")?.trim() || "";
  let account: unknown = undefined;
  if (accountId) {
    const { data: accountRow } = await (supabase as any)
      .from("integrations")
      .select("id,provider,account_email,settings,status")
      .eq("user_id", activeUserId)
      .eq("category", "mail")
      .eq("id", accountId)
      .maybeSingle();
    account = accountRow || undefined;
  }

  const rendered = await buildInrSendSignature({ supabase: supabase as SupabaseLike, userId: activeUserId, account });

  return NextResponse.json({
    enabled: settings.enabled,
    template: settings.template,
    preview: rendered.signatureText,
    imagePath: settings.imagePath,
    imageUrl: settings.imageUrl,
    imageWidth: settings.imageWidth,
    defaults: {
      template: DEFAULT_INRSEND_SIGNATURE_TEMPLATE,
      variables: [
        "{{prenom}}",
        "{{nom}}",
        "{{nom_complet}}",
        "{{nom_entreprise}}",
        "{{telephone}}",
        "{{email}}",
        "{{adresse}}",
        "{{code_postal}}",
        "{{ville}}",
        "{{boite_mail}}",
        "{{nom_expediteur}}",
      ],
    },
  });
}

export async function POST(req: Request) {
  const { supabase, errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await req.json().catch(() => ({}));
  const enabled = asRecord(body).enabled !== false;
  const template = asString(asRecord(body).template)?.trim() || DEFAULT_INRSEND_SIGNATURE_TEMPLATE;
  const imagePath = asString(asRecord(body).imagePath)?.trim() || "";
  const imageUrl = asString(asRecord(body).imageUrl)?.trim() || "";
  const imageWidthRaw = Number(asString(asRecord(body).imageWidth) || 400);
  const imageWidth = Number.isFinite(imageWidthRaw) ? Math.max(180, Math.min(600, imageWidthRaw)) : 400;

  const { data: cfgRow } = await (supabase as SupabaseLike).from("pro_tools_configs").select("settings").eq("user_id", activeUserId).maybeSingle();
  const currentSettings = asRecord(asRecord(cfgRow).settings);
  const nextSettings = {
    ...currentSettings,
    inrsend: {
      ...asRecord(currentSettings.inrsend),
      signature_enabled: enabled,
      signature_template: template,
      signature_image_path: imagePath,
      signature_image_url: imageUrl,
      signature_image_width: imageWidth,
    },
  };

  const { error } = await (supabase as SupabaseLike)
    .from("pro_tools_configs")
    .upsert({ user_id: activeUserId, settings: nextSettings }, { onConflict: "user_id" });

  if (error) {
    return jsonUserFacingError(error, { status: 500, fallback: "Impossible d’enregistrer la signature." });
  }

  const rendered = await buildInrSendSignature({ supabase: supabase as SupabaseLike, userId: activeUserId });
  return NextResponse.json({ ok: true, enabled, template, imagePath, imageUrl: rendered.imageUrl, imageWidth, preview: rendered.signatureText });
}
