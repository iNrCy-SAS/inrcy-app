import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { canReopenPublicationValidation, hasPublicationSchedulePassed } from "@/app/dashboard/agent/_lib/agent.publication-visibility";
import { saveInrAgentPublicationRevision, InrAgentPublicationRevisionConflict } from "@/lib/inrAgentPublicationRevisionServer";

export class PublicationRefusalRestoreError extends Error {
  constructor(message: string, public status: number, public code = "INR_AGENT_PUBLICATION_REVIEW_DENIED") { super(message); }
}

type RestoreReviewArgs = {
  accountId: string; actionId: string; expectedUpdatedAt: unknown; select: string;
  decision: "refused" | "validated";
};

/** Reopen the owned, unchanged future action without starting or resuming a dispatch. */
export async function restoreInrAgentPublicationReview({ accountId, actionId, expectedUpdatedAt, select, decision }: RestoreReviewArgs) {
  if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt) throw new PublicationRefusalRestoreError("Rechargez la publication avant de la remettre en attente.", 409);
  const { data: row, error } = await supabaseAdmin.from("inr_agent_actions").select(select).eq("id", actionId).eq("user_id", accountId).maybeSingle();
  if (error) {
    console.error("[inr-agent] publication review read failed", { code: error.code });
    throw new PublicationRefusalRestoreError("Vérification de la publication indisponible. Réessayez dans un instant.", 503);
  }
  if (!row) throw new PublicationRefusalRestoreError("Publication introuvable.", 404);
  const action = rowToInrAgentAction(row as unknown as Parameters<typeof rowToInrAgentAction>[0]);
  if (action.updatedAt !== expectedUpdatedAt) throw new PublicationRefusalRestoreError("La publication a changé. Actualisez puis réessayez.", 409);
  if (hasPublicationSchedulePassed(action, Date.now())) throw new PublicationRefusalRestoreError("L’heure de diffusion est atteinte. Vérifiez le statut de la publication.", 409);
  const expectedDecision = decision === "refused" ? action.status === "refused" : ["validated", "scheduled"].includes(action.status);
  if (!expectedDecision || !canReopenPublicationValidation(action, Date.now())) throw new PublicationRefusalRestoreError("Cette publication ne peut plus être remise en attente de validation.", 409);
  if (decision === "validated") {
    try {
      // The existing revision workflow locks and retires every future child job,
      // preserves per-channel dates and requires a new approval of the same content.
      return await saveInrAgentPublicationRevision({ accountId, action, payload: action.payload, requireFutureSchedule: true });
    } catch (revisionError) {
      if (revisionError instanceof InrAgentPublicationRevisionConflict) throw new PublicationRefusalRestoreError(revisionError.message, 409);
      throw revisionError;
    }
  }
  const now = new Date().toISOString();
  const { data: restored, error: updateError } = await supabaseAdmin.from("inr_agent_actions").update({
    status: "pending_validation", validated_at: null, refused_at: null, updated_at: now, last_error: null,
    validation_required: true, execution_policy: "manual_validation",
  }).eq("id", actionId).eq("user_id", accountId).eq("status", "refused").eq("updated_at", expectedUpdatedAt)
    .eq("scheduled_for", action.scheduledFor).gt("scheduled_for", now).is("completed_at", null).select(select).maybeSingle();
  if (updateError) {
    console.error("[inr-agent] publication refusal restore failed", { code: updateError.code });
    throw new PublicationRefusalRestoreError("Remise en attente indisponible. Réessayez dans un instant.", 503);
  }
  if (!restored) throw new PublicationRefusalRestoreError("La publication a changé ou son échéance est atteinte. Actualisez puis réessayez.", 409);
  return rowToInrAgentAction(restored as unknown as Parameters<typeof rowToInrAgentAction>[0]);
}

export async function restoreRefusedInrAgentPublication(args: Omit<RestoreReviewArgs, "decision">) {
  return restoreInrAgentPublicationReview({ ...args, decision: "refused" });
}
