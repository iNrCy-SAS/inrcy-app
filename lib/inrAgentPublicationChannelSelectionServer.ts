import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { rowToInrAgentAction } from "@/lib/inrAgentActions";
import { rowToInrAgentScheduledAction } from "@/lib/inrAgentScheduledActions";
import { normalizeTiktokPublicationSettings } from "@/app/api/booster/publish-now/publishNow.foundations";

export async function saveAgentPublicationChannels(args: {
  userId: string; actionId?: string | null; scheduledActionId?: string | null;
  channels: unknown; expectedUpdatedAt: unknown;
  tiktokPublicationSettings?: unknown;
  confirmPending?: boolean;
}) {
  if (!Array.isArray(args.channels) || args.channels.length > 20 || args.channels.some(value => typeof value !== "string")
    || typeof args.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(args.expectedUpdatedAt))) {
    return NextResponse.json({ error: "Sélection de canaux invalide." }, { status: 400 });
  }
  const tiktokSettings = args.tiktokPublicationSettings ? normalizeTiktokPublicationSettings(args.tiktokPublicationSettings) : null;
  if (args.tiktokPublicationSettings && !tiktokSettings) return NextResponse.json({ error: "Paramètres TikTok invalides." }, { status: 400 });
  const { data, error } = await supabaseAdmin.rpc("inrcy_set_agent_publication_channels", {
    p_user_id: args.userId, p_action_id: args.actionId || null,
    p_scheduled_action_id: args.scheduledActionId || null,
    p_channels: args.channels, p_expected_updated_at: args.expectedUpdatedAt,
    p_tiktok_settings: tiktokSettings,
    p_confirm_pending: args.confirmPending === true,
  });
  if (error) {
    console.error("[inr-agent] channel selection failed", { code: error.code });
    return NextResponse.json({ error: "Enregistrement des canaux indisponible. Réessayez dans un instant." }, { status: 503 });
  }
  const result = data as { outcome?: string; action?: Record<string, unknown>; scheduledActions?: Record<string, unknown>[] } | null;
  if (result?.outcome !== "saved") {
    const messages: Record<string, string> = {
      not_found: "Publication introuvable.",
      stale: "La publication a changé. Actualisez puis réessayez.",
      publication_started: "La diffusion a commencé : les canaux ne peuvent plus être modifiés.",
      schedule_due: "L’heure de diffusion est atteinte. Vérifiez le statut de la publication.",
      schedule_cancelled: "Cette programmation a été annulée.",
      schedule_missing: "La programmation doit être vérifiée avant de modifier les canaux.",
      tiktok_settings_required: "Validez les paramètres TikTok avant de réactiver ce canal.",
      channel_empty: "Canal vide : générez son contenu dans le bloc Contenu avant de valider.",
    };
    return NextResponse.json({ error: messages[result?.outcome || ""] || "Sélection de canaux invalide.", code: result?.outcome }, { status: result?.outcome === "not_found" ? 404 : 409 });
  }
  return NextResponse.json({
    saved: true,
    action: result.action ? rowToInrAgentAction(result.action) : null,
    scheduledActions: (result.scheduledActions || []).map(row => rowToInrAgentScheduledAction(row)),
  });
}
