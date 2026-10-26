import type { DashboardEdition } from "./dashboardEdition.ts";

/** One public contract for the assistant's real actions and native confirmations. */
export const INR_ASSISTANT_CAPABILITIES = [
  { area:"ADN, ton et CTA", editions:["standard","premium","founder"], actions:"Analyser les sources, compléter les informations fournies, modifier les réglages et les futurs CTA compatibles.", validation:"Aucune modification des profils sociaux ou contenus déjà publiés." },
  { area:"Studio", editions:["standard","premium","founder"], actions:"Créer une image ou vidéo, retoucher une image existante et retrouver son résultat.", validation:"Crédits et moteurs de l’offre ; une création en cours ne doit pas être relancée." },
  { area:"Publications", editions:["standard","premium","founder"], actions:"Préparer, modifier, publier ou programmer avec les canaux, médias et horaires demandés.", validation:"Mise en file distincte d’une publication confirmée ; statut vérifiable ensuite." },
  { area:"Agents", editions:["standard","premium","founder"], actions:"Configurer les agents et plannings inclus dans l’offre.", validation:"Les automatismes Premium restent Premium." },
  { area:"CRM", editions:["premium","founder"], actions:"Rechercher, créer, modifier et supprimer une fiche explicitement demandée.", validation:"La fusion automatique de fiches n’est pas disponible. Comparer les fiches et guider dans le CRM ; ne jamais annoncer une fusion." },
  { area:"Campagnes mail", editions:["premium","founder"], actions:"Préparer et corriger un brouillon, puis envoyer ou programmer sur ordre explicite avec destinataires exacts.", validation:"Une préparation n’autorise pas une diffusion ; queued ne prouve pas livraison." },
  { area:"Agenda", editions:["premium","founder"], actions:"Préparer un rendez-vous et modifier ou annuler un brouillon natif.", validation:"Un rendez-vous confirmé, une demande client ou une copie Google doit être vérifié dans l’agenda natif." },
  { area:"Publicité", editions:["premium","founder"], actions:"Lire les campagnes, préparer un brouillon et gérer les actions admises par les validations natives.", validation:"Le lancement d’une dépense reste soumis à la validation native." },
  { area:"Devis et factures", editions:["founder"], actions:"Enregistrer un brouillon à partir des données client, prix et TVA explicitement fournis.", validation:"Aucun numéro officiel, paiement, finalisation ou envoi par cet outil." },
] as const;

export function inrAssistantCapabilityGuide(): string {
  return "Basique : accompagnement personnalisé et lectures autorisées, sans réalisation. Les essais vérifiés restent Standard pendant 21 jours.\n" + INR_ASSISTANT_CAPABILITIES.map(c=>`${c.area} (${c.editions.join(" / ")}) : ${c.actions} ${c.validation}`).join("\n") + "\nConnexion OAuth et validation d’abonnement : parcours natif du professionnel. Une tâche complexe affiche ses étapes terminées, restantes et bloquées ; elle ne donne aucun droit supplémentaire.";
}
export function verifiedInrAssistantCapabilityLimit(message: string, edition: DashboardEdition): string | null {
  const value=message.normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
  if (/\b(?:fusionn\w*|merge)\b/.test(value) && /\b(?:crm|contacts?|doublons?)\b/.test(value)) return edition === "basic" || edition === "standard"
    ? "Le CRM est inclus dans Premium. Je peux vous expliquer son fonctionnement dans [Mon abonnement](/dashboard?panel=abonnement). La fusion automatique de fiches n’est pas disponible actuellement."
    : "La fusion automatique de fiches n’est pas disponible actuellement. Je peux vous aider à comparer les contacts et à conserver les bonnes informations dans [iNr’CRM](/dashboard/crm). Aucune fiche n’a été fusionnée ni supprimée.";
  return null;
}
