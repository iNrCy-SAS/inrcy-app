import "server-only";

import { normalizeInrAgentPublicationIdeas } from "@/lib/inrAgentSettings";
import { isTerminalInrAgentEditorialFailure } from "@/lib/inrAgentEditorialRetryPolicy";

type SupabaseLike = any;

export type InrAgentPublicationIdeaRow = {
  idea_text: string;
  status: "active" | "disabled" | "used";
  reserved_action_id: string | null;
  used_action_id: string | null;
};

export async function loadInrAgentPublicationIdeas(args: {
  supabase: SupabaseLike;
  userId: string;
  publicationIdeas: unknown;
}): Promise<InrAgentPublicationIdeaRow[]> {
  const ideas = Array.from(new Set(normalizeInrAgentPublicationIdeas(args.publicationIdeas).filter(Boolean)));
  if (!ideas.length) return [];

  const { error: insertError } = await args.supabase
    .from("inr_agent_publication_ideas")
    .upsert(
      ideas.map((ideaText) => ({ user_id: args.userId, idea_text: ideaText })),
      { onConflict: "user_id,idea_text", ignoreDuplicates: true },
    );
  if (insertError) throw insertError;

  const { data, error } = await args.supabase
    .from("inr_agent_publication_ideas")
    .select("idea_text,status,reserved_action_id,used_action_id")
    .eq("user_id", args.userId)
    .in("idea_text", ideas);
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as InrAgentPublicationIdeaRow[];
}

export async function claimInrAgentPublicationIdea(args: {
  supabase: SupabaseLike;
  userId: string;
  ideaText: string;
  actionId: string;
}) {
  const { data, error } = await args.supabase
    .from("inr_agent_publication_ideas")
    .update({ reserved_action_id: args.actionId, updated_at: new Date().toISOString() })
    .eq("user_id", args.userId)
    .eq("idea_text", args.ideaText)
    .eq("status", "active")
    .is("reserved_action_id", null)
    .select("idea_text")
    .maybeSingle();
  // Un même créneau ne peut réserver qu'une idée, même si deux planificateurs
  // concurrents ont calculé des candidats différents.
  if (error?.code === "23505") return false;
  if (error) throw error;
  if (data) return true;
  const { data: sameReservation, error: lookupError } = await args.supabase
    .from("inr_agent_publication_ideas")
    .select("idea_text")
    .eq("user_id", args.userId)
    .eq("idea_text", args.ideaText)
    .eq("status", "active")
    .eq("reserved_action_id", args.actionId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  return Boolean(sameReservation);
}

export async function releaseInrAgentPublicationIdea(args: {
  supabase: SupabaseLike;
  userId: string;
  actionId: string;
  ideaText?: string;
}) {
  let query = args.supabase
    .from("inr_agent_publication_ideas")
    .update({ reserved_action_id: null, updated_at: new Date().toISOString() })
    .eq("user_id", args.userId)
    .eq("status", "active")
    .eq("reserved_action_id", args.actionId);
  if (args.ideaText) query = query.eq("idea_text", args.ideaText);
  const { error } = await query;
  if (error) throw error;
}

/** Répare les générations instantanées interrompues et les échecs terminaux.
 * Une action en cours ou encore retentable conserve sa réservation. */
export async function releaseAbandonedInrAgentPublicationIdeas(args: {
  supabase: SupabaseLike;
  userId: string;
}) {
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data, error } = await args.supabase
    .from("inr_agent_publication_ideas")
    .select("idea_text,reserved_action_id")
    .eq("user_id", args.userId)
    .eq("status", "active")
    .not("reserved_action_id", "is", null)
    .lt("updated_at", cutoff);
  if (error) throw error;
  for (const row of Array.isArray(data) ? data : []) {
    const actionId = String(row.reserved_action_id || "");
    if (!actionId) continue;
    const { data: action, error: actionError } = await args.supabase
      .from("inr_agent_actions")
      .select("id,status,payload,metadata,last_error")
      .eq("id", actionId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (actionError) throw actionError;
    const payload = action?.payload && typeof action.payload === "object"
      ? action.payload as Record<string, any> : {};
    const metadata = action?.metadata && typeof action.metadata === "object"
      ? action.metadata as Record<string, any> : {};
    const focus = payload.editorialPlan?.focus || payload.editorialFocus;
    const terminalFailure = action?.status === "failed" &&
      metadata.editorialState === "failed" &&
      (metadata.editorialIdeaReservationTerminal === true ||
        isTerminalInrAgentEditorialFailure({
          status: action.status,
          editorialState: metadata.editorialState,
          attempts: Number(metadata.editorialAttempts) || 0,
          error: metadata.editorialLastError || action.last_error,
          retryReason: metadata.editorialRetryReason,
        }));
    if (!action || action.status === "cancelled" || terminalFailure || focus?.subject !== row.idea_text) {
      await releaseInrAgentPublicationIdea({ ...args, actionId, ideaText: row.idea_text });
    }
  }
}
