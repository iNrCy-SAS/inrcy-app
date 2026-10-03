import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeInrAgentPublicationIdeas } from "@/lib/inrAgentSettings";
import {
  inrAgentAutomationFromEditorialRow,
  reconcileInrAgentEditorialPlan,
} from "@/lib/inrAgentEditorialPlanServer";
import { loadInrAgentPublicationIdeas } from "@/lib/inrAgentPublicationIdeaLifecycle";
import { withApi } from "@/lib/observability/withApi";

export const runtime = "nodejs";

async function currentIdeas(userId: string) {
  const { data: automation, error } = await supabaseAdmin
    .from("inr_agent_automation_settings")
    .select("enabled,frequency,day_of_week,time,validation_mode,allowed_channels,allowed_themes,use_image_bank,image_required,recipient_scope,source_strategy,last_prepared_at,last_executed_at,next_run_at,metadata")
    .eq("user_id", userId)
    .eq("automation_key", "publish")
    .maybeSingle();
  if (error) throw error;
  const metadata = automation?.metadata && typeof automation.metadata === "object"
    ? automation.metadata as Record<string, unknown> : {};
  const ideas = normalizeInrAgentPublicationIdeas(metadata.publicationIdeas);
  const states = await loadInrAgentPublicationIdeas({
    supabase: supabaseAdmin,
    userId,
    publicationIdeas: ideas,
  });
  return { automation, ideas, states };
}

async function getHandler() {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const { states } = await currentIdeas(activeUserId);
  return NextResponse.json({ states });
}

async function postHandler(request: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const body = await request.json().catch(() => null) as {
    ideaText?: unknown;
    active?: unknown;
  } | null;
  const ideaText = String(body?.ideaText || "").trim();
  if (!ideaText || typeof body?.active !== "boolean") {
    return NextResponse.json({ error: "Idée ou état invalide.", code: "INR_AGENT_IDEA_INVALID" }, { status: 400 });
  }
  const { automation, ideas } = await currentIdeas(activeUserId);
  if (!ideas.includes(ideaText)) {
    return NextResponse.json({ error: "Cette idée n’existe plus dans les réglages enregistrés.", code: "INR_AGENT_IDEA_NOT_SAVED" }, { status: 409 });
  }

  const { data, error } = await supabaseAdmin
    .from("inr_agent_publication_ideas")
    .update({
      status: body.active ? "active" : "disabled",
      reserved_action_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", activeUserId)
    .eq("idea_text", ideaText)
    .select("idea_text,status,reserved_action_id,used_action_id")
    .single();
  if (error) throw error;

  // Une désactivation retire le focus des futurs créneaux non générés.
  if (!body.active && automation) {
    const { data: globalSettings } = await supabaseAdmin
      .from("inr_agent_settings")
      .select("timezone,tone")
      .eq("user_id", activeUserId)
      .maybeSingle();
    try {
      await reconcileInrAgentEditorialPlan({
        supabase: supabaseAdmin,
        userId: activeUserId,
        automation: inrAgentAutomationFromEditorialRow(automation),
        timezone: String(globalSettings?.timezone || "Europe/Paris"),
        tone: String(globalSettings?.tone || "professional"),
      });
    } catch (reconcileError) {
      console.warn("[inr-agent] idea disabled; editorial plan will retry reconciliation", reconcileError);
    }
  }
  return NextResponse.json({ state: data });
}

export const GET = withApi(getHandler, { route: "/api/agent/publication-ideas" });
export const POST = withApi(postHandler, { route: "/api/agent/publication-ideas" });
