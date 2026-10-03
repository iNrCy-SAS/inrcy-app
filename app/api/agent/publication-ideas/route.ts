import { NextResponse } from "next/server";

import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  automationSettingsToDbRow,
  INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS,
  INR_AGENT_PUBLICATION_IDEA_MAX_LENGTH,
  normalizeInrAgentPublicationIdeas,
  sanitizeInrAgentSettings,
} from "@/lib/inrAgentSettings";
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
    .select("enabled,frequency,day_of_week,time,validation_mode,allowed_channels,allowed_themes,use_image_bank,image_required,recipient_scope,source_strategy,last_prepared_at,last_executed_at,next_run_at,metadata,updated_at")
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

async function patchHandler(request: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const body = await request.json().catch(() => null) as { publicationIdeas?: unknown } | null;
  const submitted = body?.publicationIdeas;
  if (!Array.isArray(submitted) ||
    submitted.length > INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS ||
    submitted.some((idea) => typeof idea !== "string" || idea.length > INR_AGENT_PUBLICATION_IDEA_MAX_LENGTH)) {
    return NextResponse.json({ error: "Liste d’idées invalide.", code: "INR_AGENT_IDEAS_INVALID" }, { status: 400 });
  }
  const publicationIdeas = normalizeInrAgentPublicationIdeas(submitted);
  const filledIdeas = publicationIdeas.filter(Boolean);
  if (new Set(filledIdeas).size !== filledIdeas.length) {
    return NextResponse.json({ error: "Une idée est présente plusieurs fois.", code: "INR_AGENT_IDEAS_DUPLICATED" }, { status: 400 });
  }

  const { automation } = await currentIdeas(activeUserId);
  const previousMetadata = automation?.metadata && typeof automation.metadata === "object"
    ? automation.metadata as Record<string, unknown> : {};
  const metadata = { ...previousMetadata, publicationIdeas };
  if (automation) {
    const { data, error } = await supabaseAdmin
      .from("inr_agent_automation_settings")
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq("user_id", activeUserId)
      .eq("automation_key", "publish")
      .eq("updated_at", automation.updated_at)
      .select("metadata")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({
        error: "Les réglages ont changé entre-temps. Rouvrez les idées avant d’enregistrer.",
        code: "INR_AGENT_IDEAS_STALE",
      }, { status: 409 });
    }
  } else {
    const defaults = sanitizeInrAgentSettings(null).automations.publish;
    const { error } = await supabaseAdmin
      .from("inr_agent_automation_settings")
      .insert({
        ...automationSettingsToDbRow(activeUserId, "publish", defaults),
        metadata: { ...defaults.metadata, publicationIdeas },
      });
    if (error) throw error;
  }

  const { automation: savedAutomation, states } = await currentIdeas(activeUserId);
  if (savedAutomation) {
    const { data: globalSettings } = await supabaseAdmin
      .from("inr_agent_settings")
      .select("timezone,tone")
      .eq("user_id", activeUserId)
      .maybeSingle();
    try {
      await reconcileInrAgentEditorialPlan({
        supabase: supabaseAdmin,
        userId: activeUserId,
        automation: inrAgentAutomationFromEditorialRow(savedAutomation),
        timezone: String(globalSettings?.timezone || "Europe/Paris"),
        tone: String(globalSettings?.tone || "professional"),
      });
    } catch (reconcileError) {
      console.warn("[inr-agent] ideas saved; editorial plan will retry reconciliation", reconcileError);
    }
  }
  return NextResponse.json({ publicationIdeas, states });
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
    .select("idea_text,status,reserved_action_id,used_action_id,order_key")
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

async function putHandler(request: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const body = await request.json().catch(() => null) as { ideaTexts?: unknown } | null;
  const ideaTexts = body?.ideaTexts;
  if (!Array.isArray(ideaTexts) ||
    ideaTexts.length > 12 ||
    ideaTexts.some((idea) => typeof idea !== "string" || !idea.trim() || idea !== idea.trim()) ||
    new Set(ideaTexts).size !== ideaTexts.length) {
    return NextResponse.json({ error: "Ordre des idées invalide.", code: "INR_AGENT_IDEA_ORDER_INVALID" }, { status: 400 });
  }

  const { ideas } = await currentIdeas(activeUserId);
  const saved = Array.from(new Set(ideas.filter(Boolean)));
  if (saved.length !== ideaTexts.length || saved.some((idea) => !ideaTexts.includes(idea))) {
    return NextResponse.json({ error: "La liste des idées a changé. Rechargez les réglages.", code: "INR_AGENT_IDEA_ORDER_STALE" }, { status: 409 });
  }
  const { error } = await supabaseAdmin.rpc("inrcy_reorder_inr_agent_publication_ideas", {
    p_user_id: activeUserId,
    p_idea_texts: ideaTexts,
  });
  if (error?.message?.includes("INR_AGENT_IDEA_ORDER_STALE")) {
    return NextResponse.json({ error: "La liste des idées a changé. Rechargez les réglages.", code: "INR_AGENT_IDEA_ORDER_STALE" }, { status: 409 });
  }
  if (error) throw error;
  const { states } = await currentIdeas(activeUserId);
  return NextResponse.json({ states });
}

export const GET = withApi(getHandler, { route: "/api/agent/publication-ideas" });
export const PATCH = withApi(patchHandler, { route: "/api/agent/publication-ideas" });
export const POST = withApi(postHandler, { route: "/api/agent/publication-ideas" });
export const PUT = withApi(putHandler, { route: "/api/agent/publication-ideas" });
