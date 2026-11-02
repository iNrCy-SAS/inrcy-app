import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { isPublishAction } from "@/app/api/agent/actions/actionPublishDraft.foundations";

export class UnvalidatedPublicationRefusalError extends Error {
  constructor(message: string, public status: number, public code = "INR_AGENT_PUBLICATION_CHANGED") { super(message); }
}
/** Reject only the owned, still-unvalidated draft that the caller actually read.
 * The SQL predicates close the race with validation/scheduling/dispatch. */
export async function refuseUnvalidatedInrAgentPublication(args: { accountId: string; actionId: string; expectedUpdatedAt: unknown; select: string }) {
  if (typeof args.expectedUpdatedAt !== "string" || !args.expectedUpdatedAt || args.expectedUpdatedAt.length > 100) throw new UnvalidatedPublicationRefusalError("Actualisez la publication avant de la refuser.", 409);
  const { data: before, error } = await supabaseAdmin.from("inr_agent_actions").select(args.select).eq("id", args.actionId).eq("user_id", args.accountId).maybeSingle();
  if (error) throw new UnvalidatedPublicationRefusalError("Vérification de la publication indisponible.", 503);
  if (!before) throw new UnvalidatedPublicationRefusalError("Publication introuvable.", 404);
  const current = before as unknown as Parameters<typeof rowToInrAgentAction>[0];
  const action = rowToInrAgentAction(current);
  if (!isPublishAction(action) || !["prepared", "pending_validation", "pending", "draft"].includes(String(current.status)) || current.validated_at || current.completed_at || current.scheduled_for || current.updated_at !== args.expectedUpdatedAt) throw new UnvalidatedPublicationRefusalError("La publication a changé ou n’attend plus de validation. Actualisez avant de poursuivre.", 409);
  const now = new Date().toISOString();
  const { data, error: updateError } = await supabaseAdmin.from("inr_agent_actions")
    .update({ status: "refused", refused_at: now, updated_at: now })
    .eq("id", args.actionId).eq("user_id", args.accountId).eq("updated_at", args.expectedUpdatedAt).eq("status", current.status)
    .is("validated_at", null).is("completed_at", null).is("scheduled_for", null).select(args.select).maybeSingle();
  if (updateError) throw new UnvalidatedPublicationRefusalError("Refus de la publication indisponible.", 503);
  if (!data) throw new UnvalidatedPublicationRefusalError("La publication a changé pendant la demande. Aucun refus appliqué.", 409);
  return rowToInrAgentAction(data as unknown as Parameters<typeof rowToInrAgentAction>[0]);
}
