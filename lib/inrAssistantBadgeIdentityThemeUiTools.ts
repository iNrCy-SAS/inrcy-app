import "server-only";
import { jsonSchema, tool } from "ai";
import { requireUser } from "./requireUser";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { isInrAssistantBadgeLogoThemeRequest } from "./inrAssistantBadgeIdentityTheme.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";

export function createInrAssistantBadgeIdentityThemeUiTools(options: { accountId: string; actorUserId: string; currentUserMessage: string; clientContext?: InrAssistantClientContext | null; canStartWork?: () => boolean }) {
  return { refreshBadgeThemeFromLogo: tool({ strict: true, description: "Actualiser les couleurs du thème iNr’Badge à partir du logo réellement enregistré, sur demande actuelle explicite. Révision du hint badge_identity_theme/retry. L’extraction Canvas native fournit seule la palette ; aucun logo, URL ou couleur modèle. Le navigateur vérifie compte/acteur/version avant PATCH natif et relit exactement le thème avant acquittement. Outil préparatoire : ne pas annoncer enregistré avant ce résultat.",
    inputSchema: jsonSchema<{ revision: string; instructionQuote: string }>({ type: "object", additionalProperties: false, required: ["revision", "instructionQuote"], properties: { revision: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,100}$" }, instructionQuote: { type: "string", minLength: 1, maxLength: 1200 } } }),
    execute: async input => {
      const fail = (status: string, message: string) => ({ ok: false, status, message });
      if (!matchesInrAssistantActionClause(options.currentUserMessage, input.instructionQuote, (current, quote) => isInrAssistantBadgeLogoThemeRequest(current) && isInrAssistantBadgeLogoThemeRequest(quote))) return fail("needs_instruction", "Demandez explicitement d’appliquer au Badge les couleurs du logo enregistré.");
      const hint = options.clientContext?.interfaces?.find(item => item.id === "badge_identity_theme" && item.revision === input.revision && item.operations.includes("retry"));
      if (!hint) return fail("navigation_required", "Ouvrez les paramètres du Badge et attendez le chargement de son logo et de son thème.");
      if (options.canStartWork?.() === false) return fail("blocked", "La demande doit être reprise.");
      const auth = await requireUser();
      if (auth.errorResponse || auth.activeUserId !== options.accountId || auth.authUserId !== options.actorUserId || options.canStartWork?.() === false) return fail("blocked", "La session ou l’établissement actif a changé.");
      return { ok: true, status: "ui_action_requested", uiCommand: { command: "refresh_badge_theme_from_logo", selection: { kind: "channel", id: "inrbadge" }, revision: hint.revision }, message: "Analyse native du logo et application de ses couleurs au Badge demandées. Un enregistrement ne sera confirmé qu’après la réponse native et la relecture exacte du thème ; aucune couleur n’est inventée." };
    },
  }) };
}
