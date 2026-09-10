import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { cleanupReplacedBoosterVideoStorage } from "@/lib/boosterVideoStorageCleanup";
import { preserveVideoAiContextReferenceOnDraftUpdate } from "@/lib/videoAiContextReference";

type BoosterEventType = "publish" | "publish_draft" | "review_mail" | "promo_mail";

type PublishDraftEventRow = {
  id: string | null;
  payload: unknown;
  created_at: string | null;
};

type PublishDraftMenuItem = {
  id: string;
  title: string;
  preview: string;
  channels: string[];
  savedAt: string;
};

const MAX_DRAFT_MENU_ITEMS = 30;
const DRAFT_MENU_SCAN_LIMIT = 100;

function cleanDraftText(value: unknown, fallback = "") {
  const text = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function parseDraftMenuLimit(value: string | null) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, MAX_DRAFT_MENU_ITEMS);
}

function getDraftSavedAt(payload: Record<string, unknown>, createdAt: unknown) {
  const savedAt = String(payload.saved_at || "").trim();
  return Number.isFinite(Date.parse(savedAt)) ? savedAt : String(createdAt || "");
}

export async function GET(req: Request) {
  try {
    const { supabase, user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const url = new URL(req.url);
    const draftId = String(url.searchParams.get("draftId") || "").trim();
    const draftListRequested = url.searchParams.get("view") === "drafts";

    if (draftListRequested && !draftId) {
      const requestedLimit = parseDraftMenuLimit(url.searchParams.get("limit"));
      const { data, error } = await supabase
        .from("app_events")
        .select("id,payload,created_at")
        .eq("user_id", activeUserId)
        .eq("module", "booster")
        .eq("type", "publish_draft")
        .order("created_at", { ascending: false })
        .limit(DRAFT_MENU_SCAN_LIMIT);

      if (error) return jsonUserFacingError(error, { status: 500 });

      const drafts = ((data || []) as PublishDraftEventRow[])
        .map((row) => {
          const payload =
            row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
              ? (row.payload as Record<string, unknown>)
              : {};
          const channels = Array.isArray(payload.channels)
            ? Array.from(
                new Set(
                  payload.channels
                    .map((channel) => cleanDraftText(channel))
                    .filter(Boolean),
                ),
              )
            : [];
          return {
            id: String(row.id || ""),
            title: cleanDraftText(payload.title),
            preview: cleanDraftText(payload.preview || payload.content || payload.idea).slice(0, 180),
            channels,
            savedAt: getDraftSavedAt(payload, row.created_at),
          };
        })
        .filter((draft): draft is PublishDraftMenuItem => Boolean(draft.id))
        .sort((left: PublishDraftMenuItem, right: PublishDraftMenuItem) =>
          Date.parse(right.savedAt) - Date.parse(left.savedAt),
        )
        .slice(0, requestedLimit);

      return NextResponse.json(
        { ok: true, drafts },
        { headers: { "Cache-Control": "private, no-store, max-age=0" } },
      );
    }

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
