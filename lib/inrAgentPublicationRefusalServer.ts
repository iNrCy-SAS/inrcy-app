import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { canRestoreRefusedPublication } from "@/app/dashboard/agent/_lib/agent.publication-visibility";

export class PublicationRefusalRestoreError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Restore only the owned, unchanged future action. This never creates or restarts a publication job. */
export async function restoreRefusedInrAgentPublication({ accountId, actionId, expectedUpdatedAt, select }: {
  accountId: string; actionId: string; expectedUpdatedAt: unknown; select: string;
}) {
  if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt) throw new PublicationRefusalRestoreError("Rechargez la publication avant d’annuler son refus.", 409);
  const { data: row, error } = await supabaseAdmin.from("inr_agent_actions").select(select).eq("id", actionId).eq("user_id", accountId).maybeSingle();
  if (error) throw new PublicationRefusalRestoreError("Vérification de la publication impossible.", 503);
  if (!row) throw new PublicationRefusalRestoreError("Publication introuvable.", 404);
  const action = rowToInrAgentAction(row as unknown as Parameters<typeof rowToInrAgentAction>[0]);
  if (action.updatedAt !== expectedUpdatedAt || !canRestoreRefusedPublication(action, Date.now())) throw new PublicationRefusalRestoreError("Le refus ne peut plus être annulé : la publication a changé ou son échéance est dépassée.", 409);
  const now = new Date().toISOString();
  const { data: restored, error: updateError } = await supabaseAdmin.from("inr_agent_actions").update({
    status: "pending_validation", validated_at: null, refused_at: null, updated_at: now,
    validation_required: true, execution_policy: "manual_validation",
  }).eq("id", actionId).eq("user_id", accountId).eq("status", "refused").eq("updated_at", expectedUpdatedAt)
    .eq("scheduled_for", action.scheduledFor).gt("scheduled_for", now).is("completed_at", null).select(select).maybeSingle();
  if (updateError) throw new PublicationRefusalRestoreError("Annulation du refus impossible.", 503);
  if (!restored) throw new PublicationRefusalRestoreError("La publication a changé ou son échéance est dépassée. Rechargez-la.", 409);
  return rowToInrAgentAction(restored as unknown as Parameters<typeof rowToInrAgentAction>[0]);
}
