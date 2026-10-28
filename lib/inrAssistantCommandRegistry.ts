/** Server-owned catalogue shared by routing, progress and continuation.
 * A catalogue entry is never permission: each native executor still checks
 * the effective instruction, account, edition and selected object itself. */
export type InrAssistantCommandFamily = "media" | "publication" | "business" | "management" | "workspace" | "commercial" | "advertising" | "settings";
type Command = {
  family: InrAssistantCommandFamily; label: string;
  /** A reader may update a submitted action, never submit that action again. */
  statusReader?: string;
  /** Only field-only answers to these questions may extend a server task. */
  clarification?: RegExp;
  batchObject?: string;
};
export const INR_ASSISTANT_COMMANDS: Record<string, Command> = {
  generateMedia: { family:"media",label:"créer le média",statusReader:"getMediaGeneration" },
  modifyMedia: { family:"media",label:"retoucher l’image",statusReader:"getMediaGeneration" },
  cancelMediaGeneration: { family:"media",label:"arrêter la génération en attente" },
  updateMediaMetadata: { family:"workspace",label:"modifier les informations du média",clarification:/titre|tag|nom|archive/,batchObject:"medias?|images?|photos?" },
  preparePublication: { family:"publication",label:"préparer la publication",clarification:/texte|contenu|sujet|canal|media/,batchObject:"publications?|posts?" },
  executePublication: { family:"publication",label:"publier ou programmer la publication",statusReader:"getPublicationStatus",batchObject:"publications?|posts?" },
  editPublication: { family:"publication",label:"corriger la publication",clarification:/texte|contenu|publication|canal/,batchObject:"publications?|posts?" },
  updateScheduledPublication: { family:"publication",label:"reprogrammer la publication",clarification:/date|heure|jour|quand|fuseau/ },
  cancelScheduledPublication: { family:"publication",label:"annuler la programmation" },
  retryScheduledPublication: { family:"publication",label:"reprendre la programmation",statusReader:"readScheduledPublications" },
  updateBusinessDna: { family:"business",label:"compléter l’ADN",clarification:/mission|description|service|prestation|valeur|horaire/ },
  updateAiConfiguration: { family:"business",label:"appliquer les réglages IA",clarification:/ton|style|langue|emoji|consigne/ },
  configureBusinessCta: { family:"business",label:"configurer les appels à l’action" },
  startBusinessDnaAnalysis: { family:"business",label:"analyser l’ADN",statusReader:"getBusinessDnaAnalysis" },
  configureAgentAutomation: { family:"management",label:"configurer l’agent",clarification:/agent|horaire|jour|frequence|planning/ },
  prepareSubscriptionAction: { family:"management",label:"préparer le parcours d’abonnement" },
  prepareCampaignEmail: { family:"workspace",label:"préparer la campagne mail",clarification:/objet|sujet|contenu|texte|expediteur|campagne/,batchObject:"campagnes?|newsletters?" },
  updateCampaignDraft: { family:"workspace",label:"corriger le brouillon de campagne",clarification:/objet|sujet|contenu|texte|brouillon/ },
  dispatchCampaignDraft: { family:"workspace",label:"envoyer ou programmer la campagne",statusReader:"readCampaignDeliveryStatus" },
  selectCampaignMailbox: { family:"workspace",label:"sélectionner l’expéditeur de la campagne" },
  dispatchCampaignAudience: { family:"workspace",label:"envoyer la campagne à l’audience vérifiée",statusReader:"readCampaignDeliveryStatus" },
  prepareCalendarAppointment: { family:"workspace",label:"préparer le rendez-vous",clarification:/date|heure|jour|quand|duree|client|contact|objet|titre/,batchObject:"rendez.vous|rdv" },
  updateCalendarAppointment: { family:"workspace",label:"modifier le rendez-vous",clarification:/date|heure|jour|quand|duree|client|contact|objet|titre/,batchObject:"rendez.vous|rdv" },
  cancelCalendarAppointment: { family:"workspace",label:"annuler le rendez-vous",batchObject:"rendez.vous|rdv" },
  replyToGoogleReview: { family:"workspace",label:"répondre à l’avis Google",clarification:/reponse|texte|contenu|avis/,batchObject:"avis|reviews?" },
  manageCrmContact: { family:"commercial",label:"modifier la fiche CRM",clarification:/nom|prenom|email|e-mail|telephone|societe|entreprise|adresse|contact|client|prospect/,batchObject:"contacts?|clients?|prospects?" },
  mergeCrmContacts: { family:"commercial",label:"fusionner les contacts" },
  prepareCommercialDocument: { family:"commercial",label:"préparer le devis ou la facture",clarification:/client|contact|prestation|ligne|produit|prix|quantite|tva|taxe|echeance|date|devis|facture/,batchObject:"devis|factures?" },
  finalizeCommercialDocument: { family:"commercial",label:"finaliser le devis ou la facture" },
  updateCommercialDocument: { family:"commercial",label:"compléter le devis ou la facture",clarification:/client|contact|prestation|ligne|produit|prix|quantite|tva|taxe|echeance|date|devis|facture/ },
  confirmCalendarAppointment: { family:"workspace",label:"confirmer le rendez-vous" },
  prepareAdvertisingCampaign: { family:"advertising",label:"préparer la campagne publicitaire",clarification:/budget|date|canal|objectif|cible|zone|contenu|campagne/,batchObject:"campagnes?" },
  manageAdvertisingCampaign: { family:"advertising",label:"modifier la campagne publicitaire",clarification:/budget|campagne|date/ },
  updateToolSettings: { family:"settings",label:"appliquer les réglages demandés",clarification:/reglage|notification|alerte|format|critere|valeur|frequence|studio|badge|agenda|calendar|document|tiktok/ },
};

export const INR_ASSISTANT_PENDING_STATUSES = new Set(["queued","processing","running","ready_to_save","navigation_requested","ui_action_requested"]);
export const INR_ASSISTANT_UNCERTAIN_STATUSES = new Set(["executing_unconfirmed","unknown","saved_unconfirmed"]);
const REJECTED_STATUSES = new Set(["failed","unknown","partial","executing_unconfirmed","preview_ready","stale_preview","paused","needs_instruction","needs_details","needs_clarification","needs_confirmation","needs_input","blocked","unavailable","saved_unconfirmed","confirmation_required","admin_required","support_required","not_included"]);
export function isInrAssistantAcceptedReceipt(receipt: {ok:boolean;status:string}): boolean {
  return receipt.ok && !REJECTED_STATUSES.has(receipt.status);
}
export function inrAssistantCommandLabel(name: string): string {
  return INR_ASSISTANT_COMMANDS[name]?.label ?? "terminer l’action demandée";
}

export const normalizeInrAssistantIntent = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export function unquotedInrAssistantIntent(value: string): string {
  return normalizeInrAssistantIntent(value.replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm," ")).trim();
}
const SETTING_TARGETS = {
  notifications: /notification|preferences|\balertes?\b|\balerts?\b/,
  studio: /(?:inr.?studio|studio|generateur|generation).{0,90}(?:reglage|parametr|format|portrait|paysage|vertical|horizontal|defaut|critere|couleur)|(?:reglage|parametr|format|portrait|paysage|vertical|horizontal|defaut|critere|couleur).{0,90}(?:inr.?studio|studio|generateur|generation)/,
  calendar: /(?:reglag|parametr|configur|rappel|confirmation).{0,65}(?:calendar|agenda|rendez.vous)|(?:calendar|agenda|rendez.vous).{0,65}(?:reglag|parametr|configur|rappel|confirmation)/,
  documents: /(?:reglag|parametr|defaut|validite|echeance).{0,65}(?:devis|facture|document)|(?:devis|facture|document).{0,65}(?:reglag|parametr|defaut|validite|echeance)/,
  badge: /inr.?badge|\bbadge\b|qr.code/,
  tiktok: /tiktok/,
} as const;
export type InrAssistantSettingTarget = keyof typeof SETTING_TARGETS;
export function inrAssistantSettingTargets(message: string): InrAssistantSettingTarget[] {
  const text=unquotedInrAssistantIntent(message);
  return (Object.keys(SETTING_TARGETS) as InrAssistantSettingTarget[]).filter(target=>SETTING_TARGETS[target].test(text));
}
/** A bounded settings intent shared by the router and the executor. A negative
 * preference ("ne veux plus recevoir") is not a denial of the change itself. */
export function requestsInrAssistantSettingsChange(message: string, target?: InrAssistantSettingTarget): boolean {
  const text=unquotedInrAssistantIntent(message);
  if (/^(?:comment|pourquoi|explique|how|why|what|est.ce que (?:je|on|nous)\b|(?:je|on|nous) (?:peux|peut|pouvons|pourrais|pourrait|pourrions)\b|est.il possible\b|si\b|imagine\b|suppose\b|souviens.toi\b|rappelle.toi\b)/.test(text) || /\b(?:comment|how).{0,40}(?:modifi|chang|regl|configur)/.test(text)) return false;
  if (/\b(?:ne |n['’]|sans |do not |don't ).{0,35}(?:modif|chang|regl|configur|activ|enregistr|coup)/.test(text)) return false;
  const targets=inrAssistantSettingTargets(message);
  if (!targets.length || target && !targets.includes(target)) return false;
  return /\b(?:modifi\w*|chang\w*|regl\w*|configur\w*|mets|mettez|active\w*|desactive\w*|enregistr\w*|remplac\w*|defini\w*|coupe\w*|update|set|disable|enable|turn off|turn on)\b/.test(text)
    || /\b(?:je (?:veux|souhaite|voudrais)|j.aimerais)\b.{0,90}\b(?:desormais|format|portrait|paysage|vertical|horizontal|defaut)\b/.test(text)
    || targets.includes("notifications") && /\bje ne (?:veux|souhaite) plus recevoir\b/.test(text);
}
