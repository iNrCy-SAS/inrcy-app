import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { requireUser } from "./requireUser";
import { parseInrAssistantAdsPatch, inrAssistantAdsFieldsRequested } from "./inrAssistantAdsUiCommands.ts";

export async function prepareInrAssistantAdsUiAction(input: { command: string; instructionQuote: string; patch?: Record<string, unknown> | null; documentId?: string | null; documentKind?: string | null }, options: {
  accountId: string; currentUserMessage: string; supabase?: Pick<SupabaseClient, "from">;
  clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean;
  isRequest: (text: string, command: "configure_ads_draft" | "save_ads_draft") => boolean;
}) {
  if (input.command !== "configure_ads_draft" && input.command !== "save_ads_draft") return null;
  const screen = options.clientContext?.screen;
  if (input.documentId || input.documentKind || screen?.pathname !== "/dashboard/ads" || screen.selection?.kind !== "campaign" || !screen.revision || !screen.availableCommands?.includes(input.command)) return { ok: false, status: "needs_details", message: "Ouvrez le formulaire de la campagne exacte avant cette action." };
  const patch = input.command === "configure_ads_draft" ? parseInrAssistantAdsPatch(input.patch) : null;
  if (input.command === "configure_ads_draft" && !patch || input.command === "save_ads_draft" && Object.values(input.patch ?? {}).some(value => value != null)) return { ok: false, status: "needs_details", message: "Précisez uniquement les réglages de la campagne ouverte, ou demandez sa sauvegarde séparément." };
  if (options.canStartWork?.() === false || !input.instructionQuote?.trim() || !options.currentUserMessage.includes(input.instructionQuote) || !options.isRequest(input.instructionQuote, input.command) || !options.isRequest(options.currentUserMessage, input.command)) return { ok: false, status: "needs_instruction", message: "Demandez explicitement cette action sur la campagne ouverte." };
  if (patch && !inrAssistantAdsFieldsRequested(input.instructionQuote, patch)) return { ok: false, status: "needs_details", message: "Précisez les champs demandés, notamment les montants explicites. Aucun réglage n’a été modifié." };
  const auth = await requireUser();
  if (auth.errorResponse || auth.activeUserId !== options.accountId) return { ok: false, status: "blocked", message: "Le compte actif doit être vérifié." };
  if (patch?.mediaId) {
    if (!options.supabase) return { ok: false, status: "unavailable", message: "Le média doit être vérifié dans le compte actif." };
    const { data, error } = await options.supabase.from("pro_media_library").select("id,user_id,media_type,is_active,upload_status,source").eq("user_id", options.accountId).eq("id", patch.mediaId).maybeSingle();
    if (error || !data || data.id !== patch.mediaId || data.user_id !== options.accountId || !["image", "video"].includes(data.media_type) || data.is_active === false || data.upload_status !== "uploaded" || data.source === "ai_media_generation_draft") return { ok: false, status: "not_found", message: "Ce média n’est pas prêt ou accessible dans ce compte." };
  }
  const target = { selection: screen.selection, revision: screen.revision };
  return { ok: true, status: "ui_action_requested", uiCommand: input.command === "save_ads_draft" ? { ...target, command: "save_ads_draft" as const } : { ...target, command: "configure_ads_draft" as const, patch: patch! },
    message: input.command === "save_ads_draft" ? "Sauvegarde native du brouillon demandée. Le navigateur vérifiera la campagne enregistrée ; aucune publication ou dépense n’est lancée." : "Modification du formulaire publicitaire demandée, avec ses contrôles natifs. Aucune sauvegarde, publication ou confirmation de dépense automatique." };
}
