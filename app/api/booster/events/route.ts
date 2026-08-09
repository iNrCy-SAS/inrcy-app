import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { cleanupReplacedBoosterVideoStorage } from "@/lib/boosterVideoStorageCleanup";
import { preserveVideoAiContextReferenceOnDraftUpdate } from "@/lib/videoAiContextReference";

type BoosterEventType = "publish" | "publish_draft" | "review_mail" | "promo_mail";

export async function GET(req: Request) {
  try {
    const { supabase, user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const url = new URL(req.url);
    const draftId = String(url.searchParams.get("draftId") || "").trim();
    if (!draftId) {
      return NextResponse.json({ error: "Brouillon introuvable." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("app_events")
      .select("id,module,type,payload,created_at")
      .eq("user_id", activeUserId)
      .eq("id", draftId)
      .eq("module", "booster")
      .eq("type", "publish_draft")
      .maybeSingle();

    if (error) return jsonUserFacingError(error, { status: 500 });
    if (!data) return NextResponse.json({ error: "Brouillon introuvable." }, { status: 404 });

    return NextResponse.json({ ok: true, event: data, payload: (data as any).payload || {} });
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;
    const userId = activeUserId;
    const body = await req.json().catch(() => ({}));
    const type = body?.type as BoosterEventType;
    const payload = (body?.payload ?? {}) as Record<string, unknown>;
    const draftId = String(body?.draftId || "").trim();

    if (!type || !["publish", "publish_draft", "review_mail", "promo_mail"].includes(type)) {
      return NextResponse.json({ error: "Type d'action invalide." }, { status: 400 });
    }

    if (type === "publish_draft" && draftId) {
      const { data: previousDraft } = await supabase
        .from("app_events")
        .select("payload")
        .eq("id", draftId)
        .eq("user_id", userId)
        .eq("module", "booster")
        .eq("type", "publish_draft")
        .maybeSingle();

      const nextPayload = preserveVideoAiContextReferenceOnDraftUpdate({
        previousPayload: previousDraft?.payload,
        nextPayload: payload,
      });

      const { data: updatedRows, error } = await supabase
        .from("app_events")
        .update({ payload: nextPayload })
        .eq("id", draftId)
        .eq("user_id", userId)
        .eq("module", "booster")
        .eq("type", "publish_draft")
        .select("id");
      const data = updatedRows?.[0] ?? null;

      if (error) return jsonUserFacingError(error, { status: 500 });
      if (!data) return NextResponse.json({ error: "Brouillon introuvable." }, { status: 404 });

      cleanupReplacedBoosterVideoStorage(userId, previousDraft?.payload, nextPayload).catch((cleanupError) => {
        console.warn("[Booster] draft video cleanup skipped", cleanupError);
      });

      return NextResponse.json({ ok: true, id: data.id });
    }

    const { data, error } = await supabase
      .from("app_events")
      .insert({
        user_id: userId,
        module: "booster",
        type,
        payload,
      })
      .select("id")
      .single();

    if (error) {
      return jsonUserFacingError(error, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data?.id || null });
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
}
