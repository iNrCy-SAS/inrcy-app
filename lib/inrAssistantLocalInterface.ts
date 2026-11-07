import { INR_ASSISTANT_PUBLIC_LINK_TARGETS } from "./inrAssistantNativeChannelLinks.ts";
import { inrAssistantMaskQuotedText, inrAssistantClauseIsAdvice } from './inrAssistantRequestClauses.ts';

/** Finite local UI helpers only: no selector, URL, script, account switch,
 * consent, submit, delete, provider write or arbitrary component callback. */
export const INR_ASSISTANT_LOCAL_INTERFACES = ['generator', 'help', 'help_dialog', 'contact', 'legal', 'channel_board', 'channel_formats', 'badge_actions', 'website_actions', 'channel_parameters', 'channel_header', 'engine_info', 'profession_picker', 'dna_sources', 'business_location', 'dna_schedule', 'studio_guided_form', 'studio_free_form', 'studio_media_images', 'studio_video_audio', 'studio_video_music', 'studio_voice_pool', 'studio_workspace', 'studio_result_viewer', 'studio_modal', 'badge_qr_options', 'badge_download_options', 'badge_link', 'channel_formats_facebook', 'channel_formats_instagram', 'cookie_options', 'website_ga4_details', 'website_gsc_details', 'writing_web_length_options', 'writing_social_length_options', 'language_options', 'notification_menu', 'planning_calendar', 'send_history', 'send_details', 'planning_day', 'planning_filters', 'send_preview', 'generator_settings', 'booster_stats', 'publication_media_preview', 'publication_adjustment', 'publication_review', 'publication_warning', 'channel_image_dialog', 'channel_image_viewer', 'google_review_details', 'media_import', 'writing_cta_channels', 'writing_cta_choices', 'subscription_activation_choice', 'studio_modifier', 'google_profile_draft', 'google_primary_category', 'google_additional_category', 'public_channel_link', 'channel_link_editor', 'channel_link_draft', 'publication_soundtrack_facebook', 'publication_soundtrack_instagram', 'emoji_picker', 'content_report', 'settings_drawer', 'dashboard_info', 'establishment_menu', 'mobile_menu', 'video_recharge', 'dna_text_description', 'dna_text_mission', 'dna_text_offers', 'dna_text_arguments', 'dna_text_proofs', 'dna_text_responses', 'dna_text_strategy', 'dna_text_calendar', 'publication_wizard', 'stats_channel_detail', 'studio_guided_library', 'studio_free_library', 'studio_retouch_library', 'studio_reference_information', 'studio_draft_reset', 'studio_draft_close', 'studio_draft_abandon', 'studio_recovery_guided', 'studio_recovery_free', 'publication_tiktok_settings', 'google_profile_sections', 'google_special_hours', 'google_weekly_hours', 'google_profile_reload', 'inertia_help', 'scheduled_publication_channel', 'scheduled_publication_editor', 'scheduled_publication_text_form', 'scheduled_publication_media', 'scheduled_publication_library', 'scheduled_publication_options', 'scheduled_publication_workspace', 'search_presentation', 'channel_cockpit', 'channel_cockpit_filter', 'inertia_views', 'boutique_views', 'boutique_help', 'subscription_details', 'subscription_invoices', 'planning_edit_choice', 'planning_workspace', 'planning_confirmation', 'planning_image', 'send_help', 'send_links', 'send_editor', 'pinterest_board_name', 'pinterest_boards', 'badge_identity_theme', 'planning_item'] as const;
export const INR_ASSISTANT_LOCAL_OPERATIONS = ['close', 'open', 'search', 'select', 'copy', 'previous', 'next', 'retry', 'clear', 'review', 'play', 'stop'] as const;
export type InrAssistantLocalInterface = typeof INR_ASSISTANT_LOCAL_INTERFACES[number];
export type InrAssistantLocalOperation = typeof INR_ASSISTANT_LOCAL_OPERATIONS[number];
const ALLOWED_OPERATIONS: Record<InrAssistantLocalInterface, readonly InrAssistantLocalOperation[]> = {
  generator: ['retry'], help: ['search', 'select'], help_dialog: ['close'], contact: ['copy', 'select'], legal: ['open', 'close'],
  channel_board: ['open', 'close'], channel_formats: ['open', 'close'], badge_actions: ['open', 'close'], website_actions: ['open', 'close'], channel_parameters: ['close'], channel_header: ['previous', 'next'],
  engine_info: ['open', 'close'], profession_picker: ['open', 'close', 'search', 'retry', 'clear'], dna_sources: ['retry'], business_location: ['retry'], dna_schedule: ['open', 'close', 'retry'],
  studio_guided_form: ['select', 'retry'], studio_free_form: ['select', 'retry'], studio_workspace: ['open', 'close', 'select'], studio_result_viewer: ['close', 'select'], studio_modal: ['close', 'select'],
  studio_media_images: ['open', 'close', 'select'], studio_video_audio: ['open', 'close'], studio_video_music: ['open', 'close', 'select', 'play', 'stop', 'retry'],
  studio_voice_pool: ['open', 'close', 'select'],
  badge_qr_options: ['open', 'close'], badge_download_options: ['open', 'close'], badge_link: ['copy'], channel_formats_facebook: ['open', 'close'], channel_formats_instagram: ['open', 'close'], cookie_options: ['open', 'close'],
  website_ga4_details: ['open', 'close'], website_gsc_details: ['open', 'close'],
  writing_web_length_options: ['open', 'close'], writing_social_length_options: ['open', 'close'], language_options: ['open', 'close'], notification_menu: ['open', 'close'],
  planning_calendar: ['previous', 'next', 'close'], planning_day: ['select'], planning_filters: ['open', 'close', 'select'], send_history: ['search', 'select', 'open', 'close', 'retry'], send_details: ['previous', 'next', 'select', 'close'], send_preview: ['open', 'close'],
  generator_settings: ['close'], booster_stats: ['close'], publication_media_preview: ['close'], publication_adjustment: ['close'], publication_review: ['close'], publication_warning: ['close'], channel_image_dialog: ['close', 'select'], channel_image_viewer: ['close'], google_review_details: ['close'], media_import: ['open', 'close', 'clear', 'select'], writing_cta_channels: ['previous', 'next', 'select'], writing_cta_choices: ['open', 'close'], subscription_activation_choice: ['close'], studio_modifier: ['open', 'close', 'select', 'retry', 'stop'], google_profile_draft: ['clear', 'review'], google_primary_category: ['close'], google_additional_category: ['close'], public_channel_link: ['open'], channel_link_editor: ['open', 'close'], channel_link_draft: ['clear'], publication_soundtrack_facebook: ['open', 'close', 'select', 'play', 'stop', 'retry'], publication_soundtrack_instagram: ['open', 'close', 'select', 'play', 'stop', 'retry'], emoji_picker: ['open', 'close', 'search', 'select'], content_report: ['open', 'close', 'select'], settings_drawer: ['close'], dashboard_info: ['select', 'close'], establishment_menu: ['open', 'close', 'retry', 'select'], mobile_menu: ['open', 'close', 'select'], video_recharge: ['open', 'close'], dna_text_description: ['select'], dna_text_mission: ['select'], dna_text_offers: ['select'], dna_text_arguments: ['select'], dna_text_proofs: ['select'], dna_text_responses: ['select'], dna_text_strategy: ['select'], dna_text_calendar: ['select'], publication_wizard: ['previous', 'next', 'select'], stats_channel_detail: ['select'], studio_guided_library: ['open', 'close'], studio_free_library: ['open', 'close'], studio_retouch_library: ['open', 'close'], studio_reference_information: ['open', 'close'], studio_draft_reset: ['review'], studio_draft_close: ['review'], studio_draft_abandon: ['review'], studio_recovery_guided: ['review', 'retry', 'stop'], studio_recovery_free: ['review', 'retry', 'stop'], publication_tiktok_settings: ['open', 'close'], google_profile_sections: ['select'], google_special_hours: ['previous', 'next'], google_weekly_hours: ['open', 'close', 'select', 'previous', 'next'], google_profile_reload: ['retry'], inertia_help: ['open', 'close'], scheduled_publication_channel: ['select', 'previous', 'next'], scheduled_publication_editor: ['open', 'close'], scheduled_publication_text_form: ['select'], scheduled_publication_media: ['open', 'close', 'select', 'previous', 'next'], scheduled_publication_library: ['open', 'close'], scheduled_publication_options: ['select'], scheduled_publication_workspace: ['close'], search_presentation: ['select', 'retry'], channel_cockpit: ['select', 'previous', 'next', 'close', 'play', 'stop'], channel_cockpit_filter: ['select'], inertia_views: ['select'], boutique_views: ['select', 'retry'], boutique_help: ['open', 'close'], subscription_details: ['open', 'close'], subscription_invoices: ['previous', 'next', 'retry'], planning_edit_choice: ['select', 'close'], planning_workspace: ['open', 'select', 'close'], planning_confirmation: ['close'], planning_image: ['retry'], send_help: ['open', 'close'], send_links: ['select'], send_editor: ['select', 'close'], pinterest_board_name: ['open', 'clear'], pinterest_boards: ['retry'], badge_identity_theme: ['retry'], planning_item: ['select'],
};
/** Encoded JSON bounds; each native form additionally validates its own fields. */
export function inrAssistantLocalInterfaceValueLimit(id: InrAssistantLocalInterface): number {
  if (id.startsWith('dna_text_')) return 32000;
  if (['studio_guided_form', 'studio_free_form'].includes(id)) return 25000;
  if (id === 'studio_modifier') return 8000;
  if (id === 'content_report') return 13000;
  if (id === 'scheduled_publication_text_form') return 40000;
  return 1200;
}
export type InrAssistantLocalInterfaceHint = { id: InrAssistantLocalInterface; revision: string; operations: InrAssistantLocalOperation[] };
export type InrAssistantLocalInterfaceCommand = { command: 'control_local_interface'; selection: { kind: 'account_document'; id: InrAssistantLocalInterface }; revision: string; operation: InrAssistantLocalOperation; value: string | null };
const REVISION = /^[a-zA-Z0-9_-]{1,100}$/;
export function parseInrAssistantLocalInterfaceHints(value: unknown): InrAssistantLocalInterfaceHint[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > INR_ASSISTANT_LOCAL_INTERFACES.length) return undefined;
  const result: InrAssistantLocalInterfaceHint[] = [];
  for (const input of value) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    const row = input as Record<string, unknown>;
    if (!INR_ASSISTANT_LOCAL_INTERFACES.includes(row.id as never) || typeof row.revision !== 'string' || !REVISION.test(row.revision) || result.some(item => item.id === row.id) || !Array.isArray(row.operations) || !row.operations.length || row.operations.length > 8 || new Set(row.operations).size !== row.operations.length || row.operations.some(op => !ALLOWED_OPERATIONS[row.id as InrAssistantLocalInterface].includes(op as never))) return undefined;
    result.push({ id: row.id as InrAssistantLocalInterface, revision: row.revision, operations: row.operations as InrAssistantLocalOperation[] });
  }
  return result;
}
export function parseInrAssistantLocalInterfaceCommand(value: unknown): InrAssistantLocalInterfaceCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, selection = row.selection as Record<string, unknown> | undefined;
  if (row.command !== 'control_local_interface' || selection?.kind !== 'account_document' || !INR_ASSISTANT_LOCAL_INTERFACES.includes(selection.id as never) || typeof row.revision !== 'string' || !REVISION.test(row.revision) || !ALLOWED_OPERATIONS[selection.id as InrAssistantLocalInterface].includes(row.operation as never) || row.value !== null && (typeof row.value !== 'string' || row.value.length > inrAssistantLocalInterfaceValueLimit(selection.id as InrAssistantLocalInterface))) return null;
  const channelLink = ["public_channel_link", "channel_link_editor", "channel_link_draft"].includes(String(selection.id));
  if (selection.id === "studio_media_images") {
    const valid = row.operation === "open" ? row.value === null || typeof row.value === "string" && /^role:(?:inspiration|character|environment|product)$/.test(row.value)
      : row.operation === "close" ? row.value === null : typeof row.value === "string" && /^(?:reference:[0-4]|inspiration:[0-4]:(?:true|false))$/.test(row.value);
    return valid ? { command: row.command, selection: { kind: "account_document", id: selection.id }, revision: row.revision, operation: row.operation as InrAssistantLocalOperation, value: row.value as string | null } : null;
  }
  if (selection.id === "studio_video_music") {
    const trackId = typeof row.value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.value) && row.value.length <= 100;
    const valid = row.operation === "select" ? trackId : row.operation === "play" ? row.value === null || trackId && row.value !== "auto" && row.value !== "off" : row.value === null;
    return valid ? { command: row.command, selection: { kind: "account_document", id: selection.id }, revision: row.revision, operation: row.operation as InrAssistantLocalOperation, value: row.value as string | null } : null;
  }
  if (selection.id === "studio_voice_pool") {
    const valid = row.operation === "close" || row.operation === "open" && row.value === null ? row.value === null : typeof row.value === "string" &&
      (row.operation === "open" ? /^(?:new|voice:[0-2])$/.test(row.value) : /^(?:active:[0-2]|target:[0-2]:(?:none|narration|reference:[0-4])|gender:[0-2]:(?:auto|female|male))$/.test(row.value));
    return valid ? { command: row.command, selection: { kind: "account_document", id: selection.id }, revision: row.revision, operation: row.operation as InrAssistantLocalOperation, value: row.value as string | null } : null;
  }
  if (channelLink) return INR_ASSISTANT_PUBLIC_LINK_TARGETS.includes(row.value as never) ? { command: row.command, selection: { kind: "account_document", id: selection.id as InrAssistantLocalInterface }, revision: row.revision, operation: row.operation as InrAssistantLocalOperation, value: String(row.value) } : null;
  if (selection.id === "google_weekly_hours" && ["open", "select"].includes(String(row.operation))) return ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].includes(String(row.value)) ? { command: row.command, selection: { kind: "account_document", id: selection.id }, revision: row.revision, operation: row.operation as InrAssistantLocalOperation, value: String(row.value) } : null;
  if (selection.id === "pinterest_board_name" && row.operation === "open") return typeof row.value === "string" && row.value.trim().length > 0 && row.value.length <= 300 ? { command: row.command, selection: { kind: "account_document", id: selection.id }, revision: row.revision, operation: row.operation, value: row.value } : null;
  const legalOpen = row.operation === 'open' && selection.id === 'legal';
  if (legalOpen ? !['confidentialite', 'mentions-legales', 'cga'].includes(String(row.value)) : ['search', 'select', 'copy'].includes(String(row.operation)) ? typeof row.value !== 'string' : row.value !== null) return null;
  return { command: row.command, selection: { kind: 'account_document', id: selection.id as InrAssistantLocalInterface }, revision: row.revision, operation: row.operation as InrAssistantLocalOperation, value: row.value as string | null };
}
const TARGETS: Record<InrAssistantLocalInterface, RegExp> = {
  generator: /generateur|cockpit/,
  help: /aide|guide|help|faq/, help_dialog: /aide|guide|help/, contact: /assistance|support|formulaire.{0,15}contact|message.{0,15}contact/, legal: /legal|cga|conditions|confidentialite/,
  channel_board: /tableau|pinterest/, channel_formats: /formats?|types? de publication/, badge_actions: /(?:menu|actions?|outils?).{0,25}badge|badge.{0,25}(?:menu|actions?|outils?)/, website_actions: /(?:menu|actions?|outils?).{0,25}(?:site|widget)|(?:site|widget).{0,25}(?:menu|actions?|outils?)/,
  channel_parameters: /canal|parametres?|bulle/, channel_header: /canal|bulle/, engine_info: /moteur|engine/, profession_picker: /(?:selecteur|recherche|liste).{0,30}(?:metier|profession)|(?:metier|profession).{0,30}(?:selecteur|recherche|liste)/,
  dna_sources: /adn|dna|sources?|documents?/, business_location: /localisation|adresse|siege|zone/, dna_schedule: /analyse|adn|programmation/,
  studio_guided_form: /formulaire (?:du |de |d[u'] ?)?studio guide|studio guide/, studio_free_form: /formulaire (?:du |de |d[u'] ?)?studio libre|studio libre/,
  studio_media_images: /\b(?:images?|photos?|references?|inspirations?|miniatures?|personnages?|decors?|produits?)\b.{0,35}\bstudio\b|\bstudio\b.{0,35}\b(?:images?|photos?|references?|inspirations?|miniatures?|personnages?|decors?|produits?)\b/,
  studio_video_audio: /(?:fenetre|reglages?|parametres?|options?|panneau|details?).{0,20}\b(?:audio|son|voix|vocaux)\b.{0,35}studio|studio.{0,35}(?:fenetre|reglages?|parametres?|options?|panneau|details?).{0,20}\b(?:audio|son|voix|vocaux)\b|\b(?:voix|vocaux)\b.{0,35}\bstudio\b|\bstudio\b.{0,35}\b(?:voix|vocaux)\b/,
  studio_video_music: /\b(?:musique|musiques|bande.son|catalogue musical|bibliotheque musicale|chanson)\b.{0,50}\bstudio\b|\bstudio\b.{0,50}\b(?:musique|musiques|bande.son|catalogue musical|bibliotheque musicale|chanson)\b/,
  studio_voice_pool: /\b(?:vocal|vocaux|profil vocal|echantillon vocal|reglages? (?:de |des |de la )?voix)\b.{0,60}\bstudio\b|\bstudio\b.{0,60}\b(?:vocal|vocaux|profil vocal|echantillon vocal|reglages? (?:de |des |de la )?voix)\b/,
  studio_workspace: /(?:criteres|apercu|creation).{0,35}studio|studio.{0,35}(?:criteres|apercu|creation)/, studio_result_viewer: /zoom.{0,35}(?:studio|apercu|image)|(?:studio|apercu agrandi).{0,35}zoom|image agrandie/, studio_modal: /(?:mode|type|fenetre|selecteur).{0,35}studio|studio.{0,35}(?:mode|type|fenetre|selecteur)/,
  badge_qr_options: /(?:qr|code).{0,30}badge|badge.{0,30}(?:qr|code)/, badge_download_options: /(?:telechargement|formats?).{0,30}badge|badge.{0,30}(?:telechargement|formats?)/, badge_link: /badge/,
  channel_formats_facebook: /(?:formats?|types? de publication).{0,40}facebook|facebook.{0,40}(?:formats?|types? de publication)/, channel_formats_instagram: /(?:formats?|types? de publication).{0,40}instagram|instagram.{0,40}(?:formats?|types? de publication)/,
  writing_web_length_options: /(?:longueur|taille).{0,35}(?:web|site|redaction)|(?:web|site).{0,35}(?:longueur|taille)/,
  writing_social_length_options: /(?:longueur|taille).{0,35}(?:social|reseaux)|(?:social|reseaux).{0,35}(?:longueur|taille)/,
  language_options: /(?:menu|selecteur|choix|options?).{0,25}langue|langue.{0,25}(?:menu|selecteur|choix|options?)/,
  notification_menu: /notifications?|cloche/,
  planning_calendar: /(?:calendrier|planning).{0,50}(?:mois|fenetre)|(?:mois|ferme\w*).{0,50}(?:calendrier|planning)/,
  planning_day: /(?:calendrier|planning).{0,50}(?:jour|carrousel)|(?:jour|carrousel).{0,50}(?:calendrier|planning)/,
  planning_filters: /(?:calendrier|planning).{0,50}filtre|filtre.{0,50}(?:calendrier|planning)/,
  send_history: /historique|inr.?send|liste.{0,25}publications?|recherche.{0,25}publications?/,
  send_details: /(?:detail|apercu|media|canal).{0,40}(?:historique|inr.?send)|(?:historique|inr.?send).{0,40}(?:detail|apercu|media|canal)/,
  generator_settings: /(?:reglages?|parametres?|options?).{0,30}(?:generateur|cockpit)|(?:generateur|cockpit).{0,30}(?:reglages?|parametres?|options?)/,
  booster_stats: /(?:statistiques?|stats).{0,30}booster|booster.{0,30}(?:statistiques?|stats)/,
  publication_media_preview: /(?:apercu|preview).{0,30}(?:media|publication|booster)|(?:publication|booster).{0,30}(?:apercu|preview)/,
  publication_adjustment: /(?:ajustement|adaptation).{0,30}(?:publication|booster)|(?:publication|booster).{0,30}(?:ajustement|adaptation)/,
  publication_review: /(?:validation|verification).{0,30}(?:publication|booster)|(?:publication|booster).{0,30}(?:validation|verification)/,
  publication_warning: /(?:avertissement|alerte).{0,30}(?:publication|booster)|(?:publication|booster).{0,30}(?:avertissement|alerte)/,
  channel_image_dialog: /(?:image|visuel).{0,30}(?:canal|bulle)|(?:canal|bulle).{0,30}(?:image|visuel)/,
  channel_image_viewer: /(?:visionneuse|agrandie|zoom).{0,30}(?:canal|bulle)|(?:canal|bulle).{0,30}(?:visionneuse|agrandie|zoom)/,
  google_review_details: /(?:detail|fenetre|fiche).{0,30}avis|avis.{0,30}(?:detail|fenetre|fiche)/,
  studio_draft_reset: /studio/,
  studio_draft_close: /studio/,
  studio_draft_abandon: /studio/,
  studio_recovery_guided: /studio/,
  studio_recovery_free: /studio/,
  publication_tiktok_settings: /(?:reglages?|parametres?).{0,30}tiktok.{0,30}(?:publication|booster)|(?:publication|booster).{0,30}(?:reglages?|parametres?).{0,30}tiktok|tiktok.{0,30}(?:reglages?|parametres?).{0,30}(?:publication|booster)/,
  google_profile_sections: /(?:section|onglet).{0,40}(?:fiche|profil).{0,15}google|(?:fiche|profil).{0,15}google.{0,40}(?:section|onglet)/,
  google_profile_reload: /(?:fiche|profil).{0,15}google|google.{0,15}(?:fiche|profil)/,
  inertia_help: /(?:aide|infos?|informations?).{0,25}inertie|inertie.{0,25}(?:aide|infos?|informations?)/,
  planning_edit_choice: /(?:choix|selecteur|editeur).{0,35}(?:texte|media).{0,35}(?:planning|programmee)|(?:planning|programmee).{0,35}(?:choix|selecteur|editeur).{0,35}(?:texte|media)/,
  planning_workspace: /(?:aide|calendrier).{0,35}(?:planning|publications? programmees?)|(?:planning|publications? programmees?).{0,35}(?:aide|calendrier)/,
  planning_confirmation: /confirmation.{0,35}(?:planning|publication|programmation)|(?:planning|publication|programmation).{0,35}confirmation/,
  planning_image: /(?:image|photo|apercu).{0,35}(?:planning|publication.{0,15}programmee)|(?:planning|publication.{0,15}programmee).{0,35}(?:image|photo|apercu)/,
  send_help: /aide.{0,30}(?:historique|inr.?send)|(?:historique|inr.?send).{0,30}aide/,
  send_editor: /(?:editeur|modifier|bibliotheque|studio|retouche).{0,35}(?:historique|inr.?send)|(?:historique|inr.?send).{0,35}(?:editeur|modifier|bibliotheque|studio|retouche)/,
  pinterest_board_name: /(?:nom|renommage|renommer).{0,25}tableau.{0,25}pinterest|pinterest.{0,25}tableau.{0,25}(?:nom|renommage|renommer)/,
  badge_identity_theme: /badge/,
  planning_item: /(?:element|publication|contenu|actions?|canaux).{0,35}(?:planning|calendrier)|(?:planning|calendrier).{0,35}(?:element|publication|contenu|actions?|canaux)/,
  pinterest_boards: /(?:liste|tableaux).{0,25}pinterest|pinterest.{0,25}(?:liste|tableaux)/,
  send_links: /(?:lien|publication|photo|image|video|fichier|piece jointe|compte).{0,35}(?:historique|inr.?send)|(?:historique|inr.?send).{0,35}(?:lien|publication|photo|image|video|fichier|piece jointe|compte)/,
  search_presentation: /(?:presentation|onglet|section|textes?|contact).{0,30}inr.?search|inr.?search.{0,30}(?:presentation|onglet|section|textes?|contact)/,
  channel_cockpit: /(?:cockpit|carrousel|animation).{0,30}(?:canaux|bulles?)|(?:canaux|bulles?).{0,30}(?:cockpit|carrousel|animation)/,
  channel_cockpit_filter: /filtres?.{0,30}(?:canaux|bulles?|cockpit)|(?:canaux|bulles?|cockpit).{0,30}filtres?/,
  inertia_views: /(?:vue|onglet|historique|ensemble).{0,25}inertie|inertie.{0,25}(?:vue|onglet|historique|ensemble)/,
  boutique_views: /(?:vue|onglet|produits?|commandes?|catalogue).{0,25}boutique|boutique.{0,25}(?:vue|onglet|produits?|commandes?|catalogue)/,
  boutique_help: /aide.{0,20}boutique|boutique.{0,20}aide/,
  subscription_details: /details?.{0,25}(?:abonnement|facturation)|(?:abonnement|facturation).{0,25}details?/,
  subscription_invoices: /factures?.{0,25}(?:abonnement|facturation)|(?:abonnement|facturation).{0,25}factures?/,
  scheduled_publication_workspace: /(?:session|edition|editeur).{0,35}publication.{0,15}(?:programmee|planifiee)|publication.{0,15}(?:programmee|planifiee).{0,35}(?:session|edition|editeur)/,
  scheduled_publication_channel: /(?:canal|reseau).{0,35}(?:publication.{0,15}(?:programmee|planifiee)|planning)|(?:publication.{0,15}(?:programmee|planifiee)|planning).{0,35}(?:canal|reseau)/,
  scheduled_publication_editor: /(?:editeur|edition|formulaire).{0,35}(?:publication.{0,15}(?:programmee|planifiee)|planning)|(?:publication.{0,15}(?:programmee|planifiee)|planning).{0,35}(?:editeur|edition|formulaire)/,
  scheduled_publication_text_form: /(?:texte|contenu|titre|hashtags?|cta|bouton).{0,40}(?:publication.{0,15}(?:programmee|planifiee)|planning)|(?:publication.{0,15}(?:programmee|planifiee)|planning).{0,40}(?:texte|contenu|titre|hashtags?|cta|bouton)/,
  scheduled_publication_media: /(?:media|image|video|galerie).{0,35}(?:publication.{0,15}(?:programmee|planifiee)|planning)|(?:publication.{0,15}(?:programmee|planifiee)|planning).{0,35}(?:media|image|video|galerie)/,
  scheduled_publication_library: /(?:bibliotheque|mediatheque).{0,35}(?:publication.{0,15}(?:programmee|planifiee)|planning)|(?:publication.{0,15}(?:programmee|planifiee)|planning).{0,35}(?:bibliotheque|mediatheque)/,
  scheduled_publication_options: /(?:options?|placement|threads|pinterest).{0,35}(?:publication.{0,15}(?:programmee|planifiee)|planning)|(?:publication.{0,15}(?:programmee|planifiee)|planning).{0,35}(?:options?|placement|threads|pinterest)/,
  google_weekly_hours: /(?:horaires?|creneaux?|jour).{0,45}(?:fiche|profil).{0,15}google|google.{0,45}(?:horaires?|creneaux?)/,
  google_special_hours: /(?:horaire|date|periode|exception).{0,40}google|google.{0,40}(?:horaire|date|periode|exception)/,
  publication_wizard: /(?:etapes?|assistant|wizard).{0,35}(?:booster|publication)|(?:booster|publication).{0,35}(?:etapes?|assistant|wizard)/,
  stats_channel_detail: /(?:detail|repartition|fenetre|sous.vue).{0,45}(?:canal|stats|statistiques)|(?:canal|stats|statistiques).{0,45}(?:detail|repartition|fenetre|sous.vue)/,
  studio_guided_library: /(?:bibliotheque|mediatheque).{0,40}studio guide|studio guide.{0,40}(?:bibliotheque|mediatheque)/,
  studio_free_library: /(?:bibliotheque|mediatheque).{0,40}studio libre|studio libre.{0,40}(?:bibliotheque|mediatheque)/,
  studio_retouch_library: /(?:bibliotheque|mediatheque).{0,40}studio (?:modifier|retouche)|studio (?:modifier|retouche).{0,40}(?:bibliotheque|mediatheque)/,
  studio_reference_information: /(?:infos?|informations?|details?).{0,30}references?.{0,30}studio|studio.{0,30}references?.{0,30}(?:infos?|informations?|details?)/,
  dna_text_description: /adn|dna/,
  dna_text_mission: /adn|dna/,
  dna_text_offers: /adn|dna/,
  dna_text_arguments: /adn|dna/,
  dna_text_proofs: /adn|dna/,
  dna_text_responses: /adn|dna/,
  dna_text_strategy: /adn|dna/,
  dna_text_calendar: /adn|dna/,
  emoji_picker: /emoji|emoticone|selecteur.{0,25}pictogrammes?/,
  content_report: /signalement|signaler.{0,25}contenu|contenu.{0,25}signaler/,
  settings_drawer: /(?:tiroir|panneau|fenetre).{0,20}(?:reglages?|parametres?)|(?:reglages?|parametres?).{0,20}(?:tiroir|panneau|fenetre)/,
  dashboard_info: /(?:infos?|informations?).{0,20}(?:adn|canaux|cockpit|generateur)|(?:adn|canaux|cockpit|generateur).{0,20}(?:infos?|informations?)/,
  establishment_menu: /(?:menu|selecteur).{0,20}(?:etablissements?|comptes?)|(?:etablissements?|comptes?).{0,20}(?:menu|selecteur)/,
  mobile_menu: /menu.{0,20}(?:mobile|navigation|principal)|(?:mobile|navigation).{0,20}menu/,
  video_recharge: /(?:dialogue|fenetre|choix).{0,20}recharge.{0,20}video|recharge.{0,20}video.{0,20}(?:dialogue|fenetre|choix)/,
  publication_soundtrack_facebook: /(?:musique|bande.son|soundtrack).{0,35}facebook|facebook.{0,35}(?:musique|bande.son|soundtrack)/,
  publication_soundtrack_instagram: /(?:musique|bande.son|soundtrack).{0,35}(?:instagram|insta)|(?:instagram|insta).{0,35}(?:musique|bande.son|soundtrack)/,
  public_channel_link: /(?:lien|profil|page|fiche).{0,15}publi(?:c|que)|site (?:web|internet|inrcy)|badge|page facebook|profil instagram|compte (?:tiktok|pinterest|threads)|chaine youtube/,
  channel_link_editor: /(?:editeur|edition|formulaire|reglages?).{0,30}liens?|liens?.{0,30}(?:editeur|edition|formulaire|reglages?)/,
  channel_link_draft: /(?:brouillon|saisie|changements?|modifications?).{0,30}(?:lien|url|adresse publique)|(?:lien|url|adresse publique).{0,30}(?:brouillon|saisie|changements?|modifications?)/,
  studio_modifier: /(?:formulaire|consigne|instruction|source|selecteur|mediatheque).{0,40}studio modifier|studio modifier.{0,40}(?:formulaire|consigne|instruction|source|selecteur|mediatheque)/,
  google_profile_draft: /(?:brouillon|modifications?|saisies?|changements?).{0,40}(?:fiche|profil).{0,15}google|(?:fiche|profil).{0,15}google.{0,40}(?:brouillon|modifications?|saisies?|changements?)/,
  google_primary_category: /categor(?:ie)?.{0,15}principale.{0,25}google|google.{0,25}categor(?:ie)?.{0,15}principale/,
  google_additional_category: /categor(?:ie|ies)?.{0,15}(?:secondaire|additionnelle).{0,25}google|google.{0,25}categor(?:ie|ies)?.{0,15}(?:secondaire|additionnelle)/,
  writing_cta_channels: /canal.{0,30}cta|cta.{0,30}canal|canal.{0,30}appels?.{0,8}action|appels?.{0,8}action.{0,30}canal/,
  writing_cta_choices: /(?:menu|choix|actions?).{0,25}cta|cta.{0,25}(?:menu|choix|actions?)/,
  subscription_activation_choice: /(?:choix|activation).{0,30}(?:abonnement|premium)|(?:abonnement|premium).{0,30}(?:choix|activation)/,
  media_import: /(?:import|ajout).{0,30}(?:media|image|video)|(?:media|image|video).{0,30}(?:import|ajout)/,
  send_preview: /(?:apercu|media|image|video).{0,40}(?:historique|inr.?send)|(?:historique|inr.?send).{0,40}(?:apercu|media|image|video)/,
  cookie_options: /reglages?.{0,25}cookies?|preferences?.{0,25}cookies?|cookies?.{0,25}(?:reglages?|preferences?)/,
  website_ga4_details: /(?:details?|informations?|infos?|panneau).{0,30}(?:ga4|analytics)|(?:ga4|analytics).{0,30}(?:details?|informations?|infos?|panneau)/,
  website_gsc_details: /(?:details?|informations?|infos?|panneau).{0,30}(?:gsc|search console)|(?:gsc|search console).{0,30}(?:details?|informations?|infos?|panneau)/,
};
const OPERATIONS: Record<InrAssistantLocalOperation, RegExp> = { play: /ecoute|joue|demarre.{0,15}lecture|play/, stop: /arrete.{0,15}(?:lecture|musique)|pause|stop/, review: /presente|prepare|validation|verifi|review/, clear: /\b(?:annule\w*|efface\w*|vide\w*|reinitialise\w*|clear)\b/, close: /\b(?:ferme\w*|referme\w*|masque\w*|close|hide)\b/, open: /\b(?:ouvre\w*|ouvrir|affiche\w*|montre\w*|agrandis\w*|open|show|expand)\b/, search: /\b(?:cherche\w*|recherch\w*|search)\b/, select: /\b(?:selectionne\w*|choisis|choisir|affiche\w*|modifie\w*|change\w*|regle\w*|mets|select|choose)\b/, copy: /\b(?:copie\w*|copy)\b/, previous: /precedent|previous/, next: /suivant|next/, retry: /reessaie|retente|recharge|actualise|retry|reload|refresh/ };
export function isInrAssistantLocalInterfaceRequest(message: string, target?: InrAssistantLocalInterface, operation?: InrAssistantLocalOperation): boolean {
  const text = inrAssistantMaskQuotedText(message).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (inrAssistantClauseIsAdvice(text) || /\b(?:si|if|quand|when|apres|avant|demain|plus tard|sans|never|not)\b|\bne\b.{0,50}\bpas\b|\bn['’]/.test(text) || /^(?:le client|le message|la page|le document)\b/.test(text)) return false;
  if (target === "badge_identity_theme") return false; // Dedicated tool verifies the native persistent logo extraction.
  if (target?.startsWith("dna_text_")) return false; // Dedicated formatting tool binds exact literal text and field.
  if (operation === "review") return false; // Dedicated tool preserves the pending human confirmation, never a generic success.
  if (target === "studio_media_images" && operation === "select") return TARGETS[target].test(text) && (OPERATIONS.select.test(text) || OPERATIONS.open.test(text));
  if ((target === "studio_recovery_guided" || target === "studio_recovery_free" || target === "studio_modifier") && (operation === "retry" || operation === "stop")) {
    // These controls only read the same job or pause its local verification.
    // A request to cancel/restart generation must retain its separate native review.
    if (/\b(?:annul\w*|abandon\w*|supprim\w*|reinitialis\w*|regenere\w*|relance\w*)\b/.test(text)) return false;
    if (target === "studio_recovery_guided" && /\blibre\b/.test(text) || target === "studio_recovery_free" && /\bguide\b/.test(text)) return false;
    if (target === "studio_modifier" ? /\b(?:libre|guide)\b/.test(text) : /\bmodifier\b/.test(text)) return false;
    const direct = text.replace(/^(?:(?:peux|pourrais)[ -]tu|(?:pouvez|pourriez)[ -]vous)\s+/, "");
    if (operation === "retry" && /^verifi(?:e|ez|er)\s+mon\s+media(?:\s+(?:du\s+|dans\s+le\s+)?studio(?:\s+(?:libre|guide))?)?\s*[.!?]*$/.test(direct)) return true;
    if (!/\bstudio\b/.test(text) || !/\b(?:attente|verification|recuperation)\b/.test(text)) return false;
    if (/\bgeneration\b/.test(direct)) return false;
    if (operation === "stop") return /^(?:mets?\s+en\s+pause|pause\w*|suspends?\w*|arrete\w*|stop\w*)\b.{0,45}\b(?:attente|verification|recuperation)\b/.test(direct);
    return OPERATIONS.retry.test(direct);
  }
  const localScheduledForm = /formulaire|editeur|saisie|brouillon.{0,15}ouvert|temporaire/.test(text);
  const scheduledField = Boolean(target) && ['scheduled_publication_text_form', 'scheduled_publication_media', 'scheduled_publication_options'].includes(target ?? '');
  if (scheduledField && operation === 'select' && /modifie|change|mets|regle|applique|enregistre/.test(text) && !localScheduledForm) return false;
  const directReadChoice = /^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:ouvre\w*|ouvrir|affiche\w*|montre\w*|choisis|choisir|selectionne\w*|selectionner|consulte\w*|telecharg\w*)\b/.test(text);
  if (operation === 'select' && ['send_links', 'send_editor', 'search_presentation', 'planning_edit_choice', 'planning_item'].includes(target ?? '') && !directReadChoice) return false;
  if (target === 'send_editor' && operation === 'close' && !/bibliotheque|mediatheque/.test(text)) return false;
  if (target === 'studio_result_viewer' && operation === 'select' && /modifie|change|regle|mets|applique/.test(text) && !/apercu|agrandi|visualiseur|visionneuse/.test(text)) return false;
  if (target === 'planning_workspace') {
    if (operation === 'open' && !/calendrier/.test(text)) return false;
    if (['select', 'close'].includes(operation ?? '') && !/aide/.test(text)) return false;
    if (operation === 'select' && !directReadChoice) return false;
  }
  if (target === "notification_menu" && operation && !/^(?:(?:peux|pourrais)[ -]tu\s+|(?:pouvez|pourriez)[ -]vous\s+)?(?:ouvre\w*|affiche\w*|montre\w*|ferme\w*|referme\w*|masque\w*|open|close|show|hide)\s+(?:(?:le|la|les|mon|ma|mes)\s+)?(?:notifications?|cloche|menu\s+(?:des?\s+)?notifications?)\b/.test(text)) return false;
  if (target && operation === "select") {
    if (target === "studio_free_form" && /\b(?:coche\w*|decoche\w*)\b/.test(text) && /\bsous.titres?\b/.test(text)) return TARGETS[target].test(text);
    if (target === "studio_voice_pool") return TARGETS[target].test(text) && (OPERATIONS.select.test(text) || /\b(?:associe\w*|affecte\w*|attribue\w*|relie\w*|definis\w*|active\w*|desaffecte\w*|dissocie\w*|detache\w*)\b|\bretire\w*\b.{0,20}\b(?:affectation|association|rattachement)\b/.test(text));
    if (target === "send_history" && !/vue|page|ligne|element|selection|choisi|brouillon|envoy/.test(text)) return false;
    if (target === "send_details" && !/canal|selection|choisi/.test(text)) return false;
  }
  if (!target) return INR_ASSISTANT_LOCAL_INTERFACES.some(id => ALLOWED_OPERATIONS[id].some(op => isInrAssistantLocalInterfaceRequest(message, id, op)));
  if (target) return TARGETS[target].test(text) && (operation ? ALLOWED_OPERATIONS[target].includes(operation) && (OPERATIONS[operation].test(text) || operation === "select" && directReadChoice && ["send_links", "send_editor", "planning_workspace", "planning_edit_choice", "planning_item", "search_presentation"].includes(target) || operation === "play" && target === "channel_cockpit" && /reprends|reprenez|relance/.test(text) && /animation/.test(text) || operation === 'select' && scheduledField && localScheduledForm && /applique|enregistre/.test(text)) : ALLOWED_OPERATIONS[target].some(op => OPERATIONS[op].test(text)));
  return INR_ASSISTANT_LOCAL_INTERFACES.some(id => TARGETS[id].test(text) && ALLOWED_OPERATIONS[id].some(op => OPERATIONS[op].test(text)));
}
export function isInrAssistantLocalInterfaceValueRequested(message: string, target: InrAssistantLocalInterface, operation: InrAssistantLocalOperation, value: string | null): boolean {
  const text = message.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (target === "studio_voice_pool") {
    const unquoted = inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (/\b(?:pas|jamais|ne|non|si|ou|soit|comment|pourquoi)\b|\bn['’]|\?/.test(unquoted.replace(/\bnon affecte\b/g, "libre"))) return false;
    if (operation === "close") return value === null;
    const voices = [...unquoted.matchAll(/\b(?:vocal|echantillon(?: vocal)?|profil vocal)\s*(?:n[°o]?\.?\s*)?([1-3])\b/g)].map(match => Number(match[1]) - 1);
    const photos = [...unquoted.matchAll(/\b(?:photo|image|reference|miniature)\s*(?:n[°o]?\.?\s*)?([1-5])\b/g)].map(match => Number(match[1]) - 1);
    if (operation === "open") {
      if (value === null) return voices.length === 0 && photos.length === 0 && /\breglages?\b/.test(unquoted) && /\b(?:voix|vocaux)\b/.test(unquoted);
      if (value === "new") return voices.length === 0 && /\b(?:nouveau|nouvel|ajout)\b/.test(unquoted) && /\bvocal\b/.test(unquoted);
      const voice = typeof value === "string" && /^voice:([0-2])$/.exec(value);
      return !!voice && voices.length === 1 && voices[0] === Number(voice[1]) && photos.length === 0;
    }
    if (operation !== "select" || !value) return false;
    const choice = /^(active|target|gender):([0-2])(?::(.+))?$/.exec(value);
    if (!choice || voices.length !== 1 || voices[0] !== Number(choice[2])) return false;
    if (choice[1] === "active") return choice[3] === undefined && photos.length === 0 && /\b(?:voix\s*off|narration|narrateur|actif)\b/.test(unquoted);
    if (choice[1] === "target") {
      if (choice[3] === "none") return photos.length === 0 && /\bnon affecte\b|\baucune (?:affectation|association)\b|\b(?:desaffecte\w*|dissocie\w*|detache\w*)\b|\bretire\w*\b.{0,20}\b(?:affectation|association|rattachement)\b/.test(unquoted);
      if (choice[3] === "narration") return photos.length === 0 && /\b(?:voix\s*off|narration|narrateur)\b/.test(unquoted);
      const photo = /^reference:([0-4])$/.exec(choice[3]);
      return !!photo && photos.length === 1 && photos[0] === Number(photo[1]) && /\b(?:associe\w*|affecte\w*|attribue\w*|relie\w*|mets|selectionne\w*|choisis)\b/.test(unquoted);
    }
    const genders: Record<string, RegExp> = { auto: /\bauto(?:matique)?\b/, female: /\bfeminin(?:e)?\b|\bfemme\b/, male: /\bmasculin(?:e)?\b|\bhomme\b/ };
    const matches = Object.keys(genders).filter(gender => genders[gender].test(unquoted));
    return photos.length === 0 && matches.length === 1 && matches[0] === choice[3];
  }
  if (target === "studio_video_music") {
    if (operation !== "select" && operation !== "play") return value === null;
    if (operation === "play" && value === null) return true;
    if (!value || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return false;
    const unquoted = inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const off = /\bsans musique\b|\baucune musique\b|\b(?:desactive|coupe|enleve)\b.{0,20}\bmusique\b/.test(unquoted);
    const automatic = /\bauto(?:matique)?\b/.test(unquoted);
    if (value === "off") return operation === "select" && off && !automatic;
    if (value === "auto") return operation === "select" && automatic && !off;
    return !off && !automatic && (` ${text.replace(/[^a-z0-9]+/g, " ").trim()} `).includes(` ${value.replaceAll("-", " ")} `);
  }
  if (target === "studio_media_images") {
    const unquoted = inrAssistantMaskQuotedText(message).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (value === null) return operation === "open" || operation === "close";
    const role = /^role:(inspiration|character|environment|product)$/.exec(value);
    if (role) {
      if (operation !== "open") return false;
      if (/\b(?:photo|image|reference|miniature|personnage|decor|produit)\s*(?:n[°o]?\.?\s*)?\d+\b/.test(unquoted)) return false;
      const roles: Record<string, RegExp> = { inspiration: /\b(?:role|bouton|icone)\s+(?:image|inspiration)\b|\bimage generique\b/, character: /\b(?:personnage|personne|portrait)\b/, environment: /\b(?:decor|environnement)\b/, product: /\bproduit\b/ };
      const mentioned = Object.keys(roles).filter(key => roles[key].test(unquoted));
      return mentioned.length === 1 && mentioned[0] === role[1];
    }
    const reference = /^(reference|inspiration):([0-4])(?::(true|false))?$/.exec(value);
    if (operation !== "select" || !reference || reference[1] === "inspiration" && !reference[3] || reference[1] === "reference" && reference[3]) return false;
    const indices = [...unquoted.matchAll(/\b(?:photo|image|reference|miniature)\s*(?:n[°o]?\.?\s*)?([1-5])\b/g)].map(match => Number(match[1]) - 1);
    if (indices.length !== 1 || indices[0] !== Number(reference[2])) return false;
    if (reference[1] === "reference") return /\b(?:ouvre\w*|affiche\w*|montre\w*|selectionne\w*|choisis)\b/.test(unquoted);
    const optional = /\b(?:inspiration|optionnell?e?)\b/.test(unquoted), required = /\b(?:obligatoire|requise?)\b/.test(unquoted);
    return optional !== required && (reference[3] === "true" ? optional : required) && /\b(?:mets|passe|rends?|active\w*|selectionne\w*|choisis)\b/.test(unquoted);
  }
  if (value === null) return true;
  if (target === "pinterest_board_name" && operation === "open") return message.toLowerCase().includes(value.toLowerCase());
  if (['public_channel_link', 'channel_link_editor', 'channel_link_draft', 'channel_cockpit'].includes(target)) {
    const choices: Record<string, RegExp> = { inrbadge: /badge/, inr_directory: /annuaire|directory/, mails: /mails?|courriels?/, site_web: /site (?:web|internet|externe)/, site_inrcy: /site inr.?cy/, inr_search: /inr.?search/, inr_badge: /badge/, gmb: /google|gmb/, facebook: /facebook/, instagram: /instagram|insta/, threads: /threads/, linkedin: /linkedin/, linkedin_profile: /linkedin.{0,20}(?:personnel|profil)|(?:personnel|profil).{0,20}linkedin/, linkedin_organization: /linkedin.{0,20}(?:organisation|entreprise|societe)|(?:organisation|entreprise|societe).{0,20}linkedin/, x: /\bx\b|twitter/, pinterest: /pinterest/, tiktok: /tiktok/, youtube_shorts: /youtube/ };
    if (value === 'linkedin' && /personnel|organisation|entreprise|societe/.test(text)) return false;
    return Boolean(choices[value]?.test(text));
  }
  if (target === 'planning_edit_choice' && operation === 'select') return value === 'text' ? /texte|contenu/.test(text) && !/media|image|video/.test(text) : value === 'media' && /media|image|video/.test(text);
  if (target === 'planning_workspace' && operation === 'select') return value === 'help' && /aide/.test(text);
  if (operation === "select" && ["search_presentation", "inertia_views", "boutique_views", "channel_cockpit_filter"].includes(target)) {
    const choices: Record<string, Record<string, RegExp>> = { search_presentation: { contact: /contact|coordonnees?/, sections: /sections?|blocs?/, texts: /textes?|text/ }, inertia_views: { overview: /ensemble|apercu|resume|overview/, history: /historique|history/ }, boutique_views: { products: /produits?|catalogue|products/, orders: /commandes?|orders/ }, channel_cockpit_filter: { all: /tous|toutes|all/, connected: /connecte|connected/, configure: /configurer|configuration|configure/ } };
    if (target === "channel_cockpit_filter" && value === "all" && /connecte|configurer|configuration/.test(text)) return false;
    return Boolean(choices[target]?.[value]?.test(text));
  }
  if (target === "google_profile_sections" && operation === "select") {
    const sections: Record<string, RegExp> = { information: /informations?|infos?|generales?/, address: /adresse|address/, hours: /horaires?|heures?|semaine|habituels?/, exceptions: /exception|speciau|special/ };
    return !(value === "hours" && /exception|speciau|special/.test(text)) && Boolean(sections[value]?.test(text));
  }
  if (target === "google_weekly_hours" && ["open", "select"].includes(operation)) {
    const days: Record<string, RegExp> = { MONDAY: /\blundi\b|\bmonday\b/, TUESDAY: /\bmardi\b|\btuesday\b/, WEDNESDAY: /\bmercredi\b|\bwednesday\b/, THURSDAY: /\bjeudi\b|\bthursday\b/, FRIDAY: /\bvendredi\b|\bfriday\b/, SATURDAY: /\bsamedi\b|\bsaturday\b/, SUNDAY: /\bdimanche\b|\bsunday\b/ };
    return Boolean(days[value]?.test(text));
  }
  if (target === 'legal' && operation === 'open') {
    const choices: Record<string, RegExp> = { cga: /\bcga\b|conditions? (?:d['’ ]utilisation|generales?|de vente)/, 'mentions-legales': /mentions? legales?/, confidentialite: /confidentialite|vie privee|privacy/ };
    return Boolean(choices[value]?.test(text));
  }
  if (target === 'contact' && operation === 'copy') {
    const choices: Record<string, RegExp> = { email: /e-?mail|courriel/, phone: /telephone|numero|phone/, message: /message|resume|brouillon/ };
    return Boolean(choices[value]?.test(text));
  }
  if (target === 'badge_link') return value === 'link' && /lien|adresse|url|link/.test(text);
  if (target === 'help' && operation === 'select') {
    const choices: Record<string, RegExp> = { start: /demarrer|debut|start/, channels: /canaux|connexion|channels/, personalization: /personnalisation|personnaliser|adn/, publish: /publier|publication|booster/, media: /media|image|video|studio/, grow: /developper|croissance|propulser|fideliser/, reviews: /avis|reputation/, contacts: /contacts?|clients?/, stats: /statistique|stats/, landmarks: /repere|generateur|cockpit/ };
    return Boolean(choices[value]?.test(text));
  }
  return true; // Native per-surface field/enum validation remains mandatory.
}

type LocalScope = { actorUserId: string; accountId: string; pathname: string };
export type InrAssistantLocalHandler = { invoke(value: string | null, stillCurrent: () => boolean): void | Promise<void>; matches(snapshot: unknown, value: string | null): boolean; allowUnmount?: boolean; immediate?: boolean };
export type InrAssistantLocalInterfaceRegistration = LocalScope & { id: InrAssistantLocalInterface; revision: string; snapshot: unknown; handlers: Partial<Record<InrAssistantLocalOperation, InrAssistantLocalHandler>>; busy?: boolean; /** Native open popup outranks its closed launchers; never model input. */ priority?: 0 | 1 };
const registrations = new Map<string, InrAssistantLocalInterfaceRegistration>();
const observers = new Set<() => void>();
const inFlight = new Set<string>();
export function registerInrAssistantLocalInterface(key: string, value: InrAssistantLocalInterfaceRegistration | null) {
  if (value) registrations.set(key, value); else registrations.delete(key);
  observers.forEach(notify => notify());
}
const sameScope = (entry: LocalScope, scope: LocalScope) => entry.actorUserId === scope.actorUserId && entry.accountId === scope.accountId && entry.pathname === scope.pathname;
function activeEntries(scope: LocalScope) {
  const entries = [...registrations.entries()].filter(([, entry]) => sameScope(entry, scope));
  return entries.filter(([, entry]) => entry.priority === 1 || !entries.some(([, other]) => other.id === entry.id && other.priority === 1));
}
export function getInrAssistantLocalInterfaceHints(scope: LocalScope): InrAssistantLocalInterfaceHint[] | undefined {
  const entries = activeEntries(scope);
  const duplicate = new Set(entries.filter(([, entry]) => entries.filter(([, other]) => other.id === entry.id).length !== 1).map(([, entry]) => entry.id));
  return parseInrAssistantLocalInterfaceHints(entries.filter(([key, entry]) => !duplicate.has(entry.id) && !entry.busy && !inFlight.has(key) && Object.keys(entry.handlers).length > 0).map(([, entry]) => ({ id: entry.id, revision: entry.revision, operations: Object.keys(entry.handlers) })));
}
/** Native commit observation, not a delay taken as success. A manual revision
 * change before invocation, duplicate target, late account/path change or timeout
 * fails. Closing can acknowledge the actual unmount, never a later unrelated UI. */
export async function runInrAssistantLocalInterface(command: InrAssistantLocalInterfaceCommand, scope: LocalScope, stillCurrent: () => boolean): Promise<boolean> {
  if (!parseInrAssistantLocalInterfaceCommand(command) || !stillCurrent()) return false;
  const found = activeEntries(scope).filter(([, entry]) => entry.id === command.selection.id);
  if (found.length !== 1) return false;
  const [key, entry] = found[0], handler = entry.handlers[command.operation];
  if (!handler || entry.busy || inFlight.has(key) || entry.revision !== command.revision) return false;
  // One in-flight local helper for this mount/revision, even if transport retries.
  const claimed = { ...entry, busy: true }; registrations.set(key, claimed);
  inFlight.add(key);
  let releaseOnExit = true;
  const release = () => { inFlight.delete(key); if (registrations.get(key) === claimed) registrations.set(key, entry); };
  try {
    if (!stillCurrent()) return false;
    const invocation = Promise.resolve(handler.invoke(command.value, stillCurrent));
    let invocationSettled = false;
    const invoked = await new Promise<boolean>((resolve, reject) => {
      let finished = false;
      const finish = (ok: boolean, error?: unknown) => { if (finished) return; finished = true; clearTimeout(timer); clearInterval(scopeTimer); if (error !== undefined) reject(error); else resolve(ok); };
      const invocationTimeout = command.selection.id === "badge_identity_theme" ? 30000 : 5000;
      const timer = setTimeout(() => finish(false), invocationTimeout), scopeTimer = setInterval(() => { if (!stillCurrent()) finish(false); }, 50);
      invocation.then(() => { invocationSettled = true; finish(true); }, error => { invocationSettled = true; finish(false, error); });
    });
    if (!invoked) {
      // A native unsaved-draft confirmation may still be open. Do not unlock
      // the same mount and open a second confirmation while it is unresolved.
      if (!invocationSettled) { releaseOnExit = false; void invocation.then(release, release); }
      return false;
    }
    if (!stillCurrent()) return false;
    if (handler.immediate) return handler.matches(registrations.get(key)?.snapshot, command.value);
    return await new Promise<boolean>(resolve => {
      let finished = false;
      const finish = (ok: boolean) => { if (finished) return; finished = true; clearTimeout(timer); clearInterval(scopeTimer); observers.delete(check); resolve(ok); };
      const check = () => {
        if (!stillCurrent()) return finish(false);
        const current = registrations.get(key);
        if (!current) return finish(handler.allowUnmount === true && command.operation === 'close');
        if (!sameScope(current, scope) || current.id !== entry.id) return finish(false);
        if (handler.matches(current.snapshot, command.value)) finish(true);
      };
      const timer = setTimeout(() => finish(false), 5000), scopeTimer = setInterval(check, 50);
      observers.add(check); check();
    });
  } catch { return false; }
  finally { if (releaseOnExit) release(); }
}
