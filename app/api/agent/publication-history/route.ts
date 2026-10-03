import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  agentPublicationHistoryWindow,
  isMissingAgentHistoryTable,
  mergeAgentPublicationHistory,
  type AgentHistoryActionRow,
  type AgentHistoryEventRow,
  type AgentHistoryScheduledRow,
} from "@/lib/inrAgentPublicationHistory";

export const runtime = "nodejs";

const PAGE_SIZE = 500;
const ACTION_SELECT = "id,title,target_channels,target_themes,payload,status,scheduled_for,completed_at,refused_at,created_at,updated_at";
const SCHEDULED_SELECT = "id,title,channels,payload,status,scheduled_at,executed_at,created_at,updated_at";

type ReadError = { code?: string; message?: string };

async function readAllRows<T>(readPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null;
  error: ReadError | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await readPage(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function readOptionalRows<T>(
  readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: ReadError | null }>,
): Promise<T[]> {
  try {
    return await readAllRows(readPage);
  } catch (error) {
    if (isMissingAgentHistoryTable(error as ReadError)) return [];
    throw error;
  }
}

function requestedWindow(request: Request) {
  const fallback = agentPublicationHistoryWindow();
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) return fallback;
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) ||
      toTime <= fromTime || toTime - fromTime > 100 * 86_400_000) return fallback;
  return { from: new Date(fromTime).toISOString(), to: new Date(toTime).toISOString() };
}

export async function GET(request: Request) {
  const { errorResponse, activeUserId } = await requireUser();
  if (errorResponse) return errorResponse;
  const { from, to } = requestedWindow(request);

  try {
    const [publishedEvents, processingEvents, scheduledActionsByDate, scheduledActionsByUpdate,
      actionsByDate, actionsByUpdate] = await Promise.all([
      readAllRows<AgentHistoryEventRow>((start, end) =>
        supabaseAdmin.from("app_events")
          .select("id,type,payload,created_at")
          .eq("user_id", activeUserId)
          .in("type", ["publish", "valorize"])
          .or("payload->>source.eq.inr_agent,payload->origin->>source.eq.inr_agent")
          .gte("created_at", from).lt("created_at", to)
          .order("created_at", { ascending: false }).range(start, end)),
      readAllRows<AgentHistoryEventRow>((start, end) =>
        supabaseAdmin.from("app_events")
          .select("id,type,payload,created_at")
          .eq("user_id", activeUserId)
          .eq("type", "publish_async_job")
          .eq("payload->finalPayloadBase->>source", "inr_agent")
          .gte("created_at", from).lt("created_at", to)
          .order("created_at", { ascending: false }).range(start, end)),
      readOptionalRows<AgentHistoryScheduledRow>((start, end) =>
        supabaseAdmin.from("inr_agent_scheduled_actions")
          .select(SCHEDULED_SELECT)
          .eq("user_id", activeUserId)
          .eq("automation_key", "publish")
          .eq("action_type", "publication")
          .in("status", ["done", "failed", "cancelled"])
          .gte("scheduled_at", from).lt("scheduled_at", to)
          .order("scheduled_at", { ascending: false }).range(start, end)),
      readOptionalRows<AgentHistoryScheduledRow>((start, end) =>
        supabaseAdmin.from("inr_agent_scheduled_actions")
          .select(SCHEDULED_SELECT)
          .eq("user_id", activeUserId)
          .eq("automation_key", "publish")
          .eq("action_type", "publication")
          .in("status", ["done", "failed", "cancelled"])
          .gte("updated_at", from).lt("updated_at", to)
          .order("updated_at", { ascending: false }).range(start, end)),
      readOptionalRows<AgentHistoryActionRow>((start, end) =>
        supabaseAdmin.from("inr_agent_actions")
          .select(ACTION_SELECT)
          .eq("user_id", activeUserId)
          .eq("automation_key", "publish")
          .eq("action_type", "publication")
          .in("status", ["completed", "failed", "refused", "cancelled"])
          .gte("scheduled_for", from).lt("scheduled_for", to)
          .order("scheduled_for", { ascending: false }).range(start, end)),
      readOptionalRows<AgentHistoryActionRow>((start, end) =>
        supabaseAdmin.from("inr_agent_actions")
          .select(ACTION_SELECT)
          .eq("user_id", activeUserId)
          .eq("automation_key", "publish")
          .eq("action_type", "publication")
          .in("status", ["completed", "failed", "refused", "cancelled"])
          .gte("updated_at", from).lt("updated_at", to)
          .order("updated_at", { ascending: false }).range(start, end)),
    ]);

    const historyPublications = mergeAgentPublicationHistory({
      events: [...publishedEvents, ...processingEvents],
      actions: [...actionsByDate, ...actionsByUpdate],
      scheduledActions: [...scheduledActionsByDate, ...scheduledActionsByUpdate],
      from,
      to,
    });
    return NextResponse.json({ historyPublications, from, to }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.warn("[inr-agent-publication-history] read failed", error);
    return NextResponse.json({ error: "Lecture de l’historique des publications impossible." }, { status: 500 });
  }
}
