import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const write = process.argv.includes("--write");
const verbose = process.argv.includes("--verbose");
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const onlyLocale = process.argv.find((argument) => argument.startsWith("--locale="))?.split("=")[1];
const selectedLocales = onlyLocale ? locales.filter((locale) => locale === onlyLocale) : locales;
if (!selectedLocales.length) throw new Error(`Locale inconnue: ${onlyLocale}`);
const namespaces = fs.readdirSync(path.join(root, "messages", "fr-FR"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => path.basename(name, ".json"))
  .sort();
const leakedLanguageLabelSuffix = /\s*(?:Italiano|Español|Deutsch|Nederlands|Português|English|Français):\s*$/u;

const brandReplacements = [
  [/\binr\s*['’]\s*[cç]y\b/giu, "iNrCy"],
  [/(?<![.@-])\binrcy\b(?![.@-])/giu, "iNrCy"],
  [/\binr\s*['’]?\s*send(?:en)?\b/giu, "iNr’Send"],
  [/\binr\s*['’]?\s*stats\b/giu, "iNr’Stats"],
  [/\binr\s*['’]?\s*search\b/giu, "iNr’Search"],
  [/\binr\s*['’]?\s*agent(?:e)?\b/giu, "iNr’Agent"],
];

const englishOverrides = new Map([
  ["reputation.fiche_google_business_09b337dd", "Google Business Profile"],
  ["stats.generation_du_bilan_9b3321bd", "Generating the report…"],
  ["stats.vues_fiche_6d715930", "Business Profile views"],
  ["agent.aucune_boite_mail_connectee_connecte_une_98952f86", "No email account connected. Connect one in iNr’Send before validation."],
  ["agent.bilans_conserves_c7633c3f", "Saved reports"],
  ["agent.stockage_du_bilan_108a0fe8", "Report storage"],
  ["agent.telecharger_le_bilan_du_value_954ac90e", "Download the report for {value0}"],
  ["mails.le_message_partira_avec_sans_objet_19716814", "The message will be sent with “(no subject)” if you leave this field empty."],
  ["mails.mail_lance_maintenant_la_programmation_future_73010184", "Email sent now. The scheduled send has been removed."],
  ["mails.objet_prepare_depuis_value_vous_pouvez_43db283f", "Subject prepared from {value0}. You can review or edit it before sending."],
  ["mails.ouvrir_la_publication_tiktok_b7fdb9de", "Open TikTok post"],
  ["mails.renvoyer_le_bilan_c0b47db8", "Resend the report"],
  ["mails.publication_value_modifiee_acf7a96f", "Post {value0} updated."],
  ["mails.publication_value_supprimee_3fa97962", "Post {value0} deleted."],
  ["booster.les_canaux_rouges_seront_inscrits_en_6ff68b36", "Channels shown in red will be marked as failed in the report. They do not prevent other ready channels from being published."],
  ["booster.parametres_de_publication_tiktok_ab9e3a10", "TikTok post settings"],
  ["dashboard.hero.flowContacts", "Posts"],
  ["dashboard.standard.sendDescription", "Find all your posts."],
  ["dashboard.standard.boosterCta", "Create a post"],
  ["stats.inr_stats_analyse_les_donnees_recuperees_0a6b0cad", "iNr’Stats analyses data collected from your channels (website, Google, social networks, etc.) and turns it into actionable business insights."],
  ["stats.recapitulatif_inrstats_e18fbec8", "iNr’Stats summary"],
  ["stats.reliez_tiktok_pour_publier_photos_et_5f0d0a6a", "Connect TikTok to publish photos and videos, track profile performance, and view public videos in iNr’Stats."],
  ["stats.vue_globale_inr_stats_db5feb84", "iNr’Stats overview"],
  ["reputation.publication_aa5ddada", "Posting…"],
  ["reputation.vous_validez_chaque_reponse_avant_publication_fc19200d", "You approve each response before it is posted on {value0}."],
  ["agent.la_publication_va_etre_enregistree_en_154b5bc3", "The post will be saved as a draft in iNr’Send."],
  ["agent.les_roues_de_reglages_permettent_de_c517f1c9", "The settings controls let you choose the frequency, day, time, sections and approval mode for each automation. Posts created by an automation remain in the iNr’Send history and are labelled iNr’Agent."],
  ["agent.media_de_la_publication_82477994", "Post media"],
  ["agent.preparation_de_la_publication_inr_agent_56ab605b", "Preparing the iNr’Agent post…"],
  ["agent.programmation_6255df3b", "Scheduling"],
  ["agent.programmation_en_cours_13ae187c", "Scheduling…"],
  ["agent.programmation_mise_a_jour_ea5f575f", "Schedule updated."],
  ["agent.programmation_reussie_1307249b", "Scheduled successfully."],
  ["agent.publication_e00441c4", "Post"],
  ["agent.publication_en_cours_58f34b8e", "Publishing in progress"],
  ["agent.publication_inr_agent_62b957d7", "iNr’Agent post"],
  ["agent.publication_mise_a_jour_de5f8c83", "Post updated."],
  ["agent.publication_prete_64babf2f", "Post ready"],
  ["agent.titre_de_la_publication_ee8fb585", "Post title"],
  ["agent.validation_obligatoire_avant_publication_1f648285", "Approval required before publishing"],
  ["booster.a_verifier_publication_possible_6615733e", ": needs review; publishing is still possible."],
  ["booster.add_to_publication_source", "Add to post"],
  ["booster.apres_publication_retrouvez_cette_communication__73a845a5", "After publishing, find this communication in"],
  ["booster.canal_vide_publication_bloquee_ad7e05b8", ": channel empty; publishing blocked."],
  ["booster.confirmer_la_publication_dbfb1790", "Confirm publishing"],
  ["booster.decrivez_le_sujet_de_cette_publication_d6313015", "Describe the subject of this post and add any specific instructions. Media is optional."],
  ["booster.medias_de_la_publication_12d110a4", "Post media"],
  ["booster.mode_de_creation_de_la_publication_970ff581", "How the post was created"],
  ["booster.prioritaire_sur_votre_configuration_ia_pour_5278e325", "Applies to this post only and takes priority over your AI settings."],
  ["booster.programmation_reussie_1307249b", "Scheduled successfully."],
  ["booster.publication_en_cours_09ec4187", "Publishing in progress…"],
  ["booster.publication_en_cours_58f34b8e", "Publishing in progress"],
  ["booster.publication_et_inr_send_c17d0272", "Post and iNr’Send"],
  ["booster.publication_inrcy_27406526", "iNrCy post"],
  ["booster.publication_tiktok_a6d8d0b0", "TikTok post"],
  ["booster.schedule_title", "Schedule post"],
  ["booster.verification_avant_publication_8ff13190", "Checks before publishing"],
  ["booster.verifiez_les_contenus_generes_et_adaptez_8907d2ac", "Review the generated content and edit it if necessary before choosing the post media."],
  ["booster.video_format_selected_for_publication", "Format selected for the post"],
  ["booster.video_variant_required_before_publish", "The network variant must be ready before publishing."],
  ["mails.annuler_cette_publication_en_cours_07e623b2", "Cancel this post?"],
  ["mails.aucune_publication_pour_le_moment_466d87bd", "No posts yet."],
  ["mails.aucune_signature_ne_sera_ajoutee_a_e8dda5d5", "No signature will be added to this send."],
  ["mails.ces_durees_concernent_uniquement_l_historique_c2600148", "These periods apply only to the iNr’Send history. You remain responsible for legally retaining your accounting documents."],
  ["mails.en_traitement_016e2d20", "Processing"],
  ["mails.historique_des_publications_2bcf9ffb", "Post history"],
  ["mails.inr_send_est_le_centre_d_245bc065", "iNr’Send is the central hub for sending your communications."],
  ["mails.inrsend_arretera_immediatement_le_suivi_et_91405c80", "iNr’Send will stop tracking immediately and mark this send as cancelled. TikTok cannot remotely stop an attempt it has already accepted; if TikTok completes it, the post may still appear on the account."],
  ["mails.inrsend_garde_l_historique_et_le_49149c78", "iNr’Send retains the history and TikTok tracking. Edit or delete the actual post directly in TikTok."],
  ["mails.inrsend_garde_le_statut_et_le_1b4364e2", "iNr’Send retains the status and link of the published video. For now, edit or delete the actual video in YouTube Studio; removing the iNr’Send entry does not delete the YouTube video."],
  ["mails.le_canal_finalise_encore_la_publication_82d4c8b2", "The channel is still finalising the post"],
  ["mails.media_de_la_publication_82477994", "Post media"],
  ["mails.message_prepare_depuis_value_relisez_et_172c2523", "Message prepared from {value0}. Review and edit it if necessary before sending."],
  ["mails.programmation_en_cours_13ae187c", "Scheduling…"],
  ["mails.programmation_reussie_1307249b", "Scheduled successfully."],
  ["mails.publication_2ff2febe", "post"],
  ["mails.publication_annulee_cbe31b94", "Post cancelled"],
  ["mails.publication_annulee_dans_inrsend_b6859971", "Post cancelled in iNr’Send"],
  ["mails.publication_e00441c4", "Post"],
  ["mails.publication_echouee_3078a063", "Post failed"],
  ["mails.publication_en_attente_de_traitement_9bf8f778", "Post awaiting processing"],
  ["mails.publication_finalisee_avec_avertissement_b3f02094", "Post completed with a warning"],
  ["mails.publication_finalisee_sur_ce_canal_da11ba3f", "Post completed on this channel"],
  ["mails.publication_finalisee_sur_tiktok_033cc7f2", "Post completed on TikTok"],
  ["mails.publication_publiee_avec_avertissement_1a7dc204", "Post published with a warning"],
  ["mails.publication_publiee_avec_un_avertissement_40386024", "Post published with a warning."],
  ["mails.publication_tiktok_annulee_7f35b8c0", "TikTok post cancelled"],
  ["mails.publication_tiktok_en_attente_72538498", "TikTok post pending"],
  ["mails.publication_tiktok_en_echec_d5b61de2", "TikTok post failed"],
  ["mails.rechercher_un_envoi_5200f657", "Search sends…"],
  ["mails.retrouvez_le_resultat_de_chaque_publication_a7900687", "Find the result of each post."],
  ["mails.statut_de_publication_mis_a_jour_675f8da7", "Post status updated."],
  ["mails.tiktok_a_refuse_la_publication_ba291e69", "TikTok rejected the post."],
  ["mails.tiktok_finalise_encore_la_publication_9191f914", "TikTok is still finalising the post"],
  ["mails.tiktok_n_a_pas_pu_finaliser_6ad1a6a9", "TikTok could not complete the post."],
  ["mails.traitement_prolonge_2ab40ee2", "Extended processing"],
  ["gps.avec_standard_inr_agent_accompagne_deux_6dd4d02d", "With Standard, iNr’Agent supports two workflows: scheduling Booster posts and preparing automatic iNr’Stats reports."],
  ["gps.cliquer_sur_le_bouton_d_information_58868b62", "Click the information button next to a failure to view the rule or exact technical error."],
  ["gps.inr_send_regroupe_toutes_les_communications_6edd1586", "iNr’Send brings together all communications sent through iNrCy: emails, Booster posts, outreach, loyalty campaigns, quotes and invoices."],
  ["gps.la_publication_apparait_bien_dans_l_ff4e0cb7", "The post appears correctly in the history."],
  ["gps.les_autorisations_de_stats_et_de_46e7140b", "Statistics and publishing permissions are accepted when requested."],
  ["gps.lire_l_efficacite_globale_573d92cb", "Review overall performance"],
  ["gps.lire_le_bilan_de_publication_d2433087", "Review the publishing report"],
  ["gps.un_statut_orange_signifie_que_la_386cefa6", "An orange status means the platform is still processing the media, not that the post has failed."],
]);

const englishReplacements = [
  [/Google My Business/g, "Google Business Profile"],
  [/Google Business(?! Profile)/g, "Google Business Profile"],
  [/\bPublications\b/g, "Posts"],
  [/\bpublications\b/g, "posts"],
  [/\bAnalyzing\b/g, "Analysing"],
  [/\banalyzing\b/g, "analysing"],
  [/\bAnalyzes\b/g, "Analyses"],
  [/\banalyzes\b/g, "analyses"],
  [/\bAnalyzed\b/g, "Analysed"],
  [/\banalyzed\b/g, "analysed"],
  [/\bAnalyze\b/g, "Analyse"],
  [/\banalyze\b/g, "analyse"],
  [/\bOptimization\b/g, "Optimisation"],
  [/\boptimization\b/g, "optimisation"],
  [/\bOptimizing\b/g, "Optimising"],
  [/\boptimizing\b/g, "optimising"],
  [/\bOptimized\b/g, "Optimised"],
  [/\boptimized\b/g, "optimised"],
  [/\bFinalize\b/g, "Finalise"],
  [/\bfinalize\b/g, "finalise"],
  [/\bFinalizing\b/g, "Finalising"],
  [/\bfinalizing\b/g, "finalising"],
  [/\bCanceled\b/g, "Cancelled"],
  [/\bcanceled\b/g, "cancelled"],
  [/\bCANCELED\b/g, "CANCELLED"],
  [/\bPersonalized\b/g, "Personalised"],
  [/\bpersonalized\b/g, "personalised"],
  [/\bOrganize\b/g, "Organise"],
  [/\borganize\b/g, "organise"],
  [/\bAuthorization\b/g, "Authorisation"],
  [/\bauthorization\b/g, "authorisation"],
];

const localeTermReplacements = new Map([
  ["es-ES", [
    [/Google My Business/g, "Perfil de Empresa en Google"],
    [/Google Business/g, "Perfil de Empresa en Google"],
  ]],
  ["it-IT", [
    [/Google My Business/g, "Profilo dell’attività su Google"],
    [/Google Business/g, "Profilo dell’attività su Google"],
  ]],
  ["de-DE", [
    [/Google My Business/g, "Google Unternehmensprofil"],
    [/Google Business/g, "Google Unternehmensprofil"],
  ]],
  ["nl-NL", [
    [/Google My Business/g, "Google-bedrijfsprofiel"],
    [/Google Business/g, "Google-bedrijfsprofiel"],
  ]],
  ["pt-PT", [
    [/Google Meu Negócio/g, "Perfil de Empresa no Google"],
    [/Google My Business/g, "Perfil de Empresa no Google"],
    [/Google Business/g, "Perfil de Empresa no Google"],
  ]],
]);

// Propulser/Fidéliser are action labels, not immutable brands. Keep one
// concise, native label per locale everywhere the modules are displayed.
const moduleTerms = new Map([
  ["en-GB", {
    grow: "Grow", retain: "Retain", collect: "Collect", highlight: "Highlight", offer: "Offer",
    simpleEmails: "simple emails", helpGrow: "Grow help", helpRetain: "Retain help",
    goGrow: "Go to Grow", goRetain: "Go to Retain", missionGrow: "Grow mission",
    missionRetain: "Retain mission", moduleGrow: "Grow module", moduleRetain: "Retain module",
    navigationGrow: "Navigation between Grow themes", navigationRetain: "Navigation between Retain themes",
    useGrow: "Use Grow", useRetain: "Use Retain",
  }],
  ["es-ES", {
    grow: "Impulsar", retain: "Fidelizar", collect: "Recopilar", highlight: "Valorar", offer: "Ofrecer",
    simpleEmails: "correos simples", helpGrow: "Ayuda de Impulsar", helpRetain: "Ayuda de Fidelizar",
    goGrow: "Ir a Impulsar", goRetain: "Ir a Fidelizar", missionGrow: "Misión Impulsar",
    missionRetain: "Misión Fidelizar", moduleGrow: "Módulo Impulsar", moduleRetain: "Módulo Fidelizar",
    navigationGrow: "Navegación entre los temas de Impulsar", navigationRetain: "Navegación entre los temas de Fidelizar",
    useGrow: "Usar Impulsar", useRetain: "Usar Fidelizar",
  }],
  ["it-IT", {
    grow: "Promuovi", retain: "Fidelizza", collect: "Raccogliere", highlight: "Valorizzare", offer: "Offrire",
    simpleEmails: "email semplici", helpGrow: "Aiuto Promuovi", helpRetain: "Aiuto Fidelizza",
    goGrow: "Vai a Promuovi", goRetain: "Vai a Fidelizza", missionGrow: "Missione Promuovi",
    missionRetain: "Missione Fidelizza", moduleGrow: "Modulo Promuovi", moduleRetain: "Modulo Fidelizza",
    navigationGrow: "Navigazione tra i temi Promuovi", navigationRetain: "Navigazione tra i temi Fidelizza",
    useGrow: "Usa Promuovi", useRetain: "Usa Fidelizza",
  }],
  ["de-DE", {
    grow: "Wachstum", retain: "Kundenbindung", collect: "Sammeln", highlight: "Hervorheben", offer: "Anbieten",
    simpleEmails: "einfache E-Mails", helpGrow: "Hilfe zu Wachstum", helpRetain: "Hilfe zur Kundenbindung",
    goGrow: "Zu Wachstum", goRetain: "Zur Kundenbindung", missionGrow: "Wachstumsmission",
    missionRetain: "Kundenbindungsmission", moduleGrow: "Wachstumsmodul", moduleRetain: "Kundenbindungsmodul",
    navigationGrow: "Navigation zwischen Wachstumsthemen", navigationRetain: "Navigation zwischen Kundenbindungsthemen",
    useGrow: "Wachstum nutzen", useRetain: "Kundenbindung nutzen",
  }],
  ["nl-NL", {
    grow: "Groei", retain: "Klantenbinding", collect: "Verzamelen", highlight: "Benadrukken", offer: "Aanbieden",
    simpleEmails: "eenvoudige e-mails", helpGrow: "Hulp bij Groei", helpRetain: "Hulp bij Klantenbinding",
    goGrow: "Naar Groei", goRetain: "Naar Klantenbinding", missionGrow: "Groei-missie",
    missionRetain: "Klantenbindingsmissie", moduleGrow: "Groei-module", moduleRetain: "Klantenbindingsmodule",
    navigationGrow: "Navigatie tussen Groei-thema's", navigationRetain: "Navigatie tussen Klantenbindingsthema's",
    useGrow: "Groei gebruiken", useRetain: "Klantenbinding gebruiken",
  }],
  ["pt-PT", {
    grow: "Impulsionar", retain: "Fidelizar", collect: "Recolher", highlight: "Valorizar", offer: "Oferecer",
    simpleEmails: "e-mails simples", helpGrow: "Ajuda de Impulsionar", helpRetain: "Ajuda de Fidelizar",
    goGrow: "Ir para Impulsionar", goRetain: "Ir para Fidelizar", missionGrow: "Missão Impulsionar",
    missionRetain: "Missão Fidelizar", moduleGrow: "Módulo Impulsionar", moduleRetain: "Módulo Fidelizar",
    navigationGrow: "Navegação entre temas de Impulsionar", navigationRetain: "Navegação entre temas de Fidelizar",
    useGrow: "Usar Impulsionar", useRetain: "Usar Fidelizar",
  }],
]);

const directGrowKeys = new Set([
  "agent.propulser_2de43942", "gps.propulser_2de43942", "gps.propulser_dfe314e3",
  "growth.propulser_2de43942", "mails.workflow_propulser_name", "stats.propulser_2de43942",
]);
const directRetainKeys = new Set([
  "agent.fideliser_8fa9e4f1", "gps.fideliser_8fa9e4f1", "gps.fideliser_ccc21ec9",
  "growth.fideliser_8fa9e4f1", "mails.workflow_fideliser_name", "stats.fideliser_8fa9e4f1",
]);

function normalizeModuleTerminology(locale, namespace, key, value) {
  const terms = moduleTerms.get(locale);
  if (!terms) return value;
  const qualifiedKey = `${namespace}.${key}`;
  if (directGrowKeys.has(qualifiedKey)) return terms.grow;
  if (directRetainKeys.has(qualifiedKey)) return terms.retain;
  if (qualifiedKey === "mails.propulser_e7c8950b") return `🚀 ${terms.grow}`;
  if (qualifiedKey === "mails.fideliser_398bb02e") return `💌 ${terms.retain}`;

  const directTemplates = new Map([
    ["growth.aide_propulser_f14568d1", terms.helpGrow],
    ["growth.aide_fideliser_a1feee79", terms.helpRetain],
    ["growth.aller_vers_propulser_f020d44a", terms.goGrow],
    ["growth.aller_vers_fideliser_27c4ce6a", terms.goRetain],
    ["growth.mission_propulser_09f6fdac", terms.missionGrow],
    ["growth.mission_fideliser_4c1796f6", terms.missionRetain],
    ["growth.module_propulser_08eded54", terms.moduleGrow],
    ["growth.module_fideliser_b309c73d", terms.moduleRetain],
    ["growth.navigation_entre_les_themes_propulser_9e51e926", terms.navigationGrow],
    ["growth.navigation_entre_les_themes_fideliser_436ee375", terms.navigationRetain],
    ["settings.utiliser_propulser_c4b4b56d", terms.useGrow],
    ["settings.utiliser_fideliser_af919842", terms.useRetain],
    ["shell.utiliser_propulser_c4b4b56d", terms.useGrow],
    ["shell.utiliser_fideliser_af919842", terms.useRetain],
    ["stats.utiliser_propulser_c4b4b56d", terms.useGrow],
    ["stats.utiliser_fideliser_af919842", terms.useRetain],
  ]);
  if (directTemplates.has(qualifiedKey)) return directTemplates.get(qualifiedKey);

  const moduleContext = /(?:propul|fideli|loyalty|grow)|^(?:mail_connect_to_unlock_tools|mail_measurement_hint|connectez_au_moins_une_boite_d_|contacts_supplementaires_pouvant_etre_generes_gr_|plus_vos_canaux_de_diffusion_sont_|points_generes_par_votre_activite_et_|cette_categorie_pilote_les_modeles_proposes_)/iu.test(key)
    || /\b(?:Propulser|Propel|Propulse|Fidéliser|Fideliser|Loyalty|Retain)\b/u.test(value);
  if (!moduleContext) return value;

  return value
    .replace(/\b(?:Propulser|Propel|Propulse)\b/gu, terms.grow)
    .replace(/\bBoost\b/gu, terms.grow)
    .replace(/\b(?:Fidéliser|Fideliser|Loyalty|Retain)\b/gu, terms.retain)
    .replace(/\b(?:Reap|Harvest|Harvesting|Collect)\b/gu, terms.collect)
    .replace(/\b(?:Value|Valuing)\b/gu, terms.highlight)
    .replace(/\b(?:Offer|Offering)\b/gu, terms.offer)
    .replace(/\bSimple Emails\b/gu, terms.simpleEmails);
}

const spanishReplacements = [
  [/\bSeleccione\b/g, "Selecciona"],
  [/\bElija\b/g, "Elige"],
  [/\bHaga clic\b/g, "Haz clic"],
  [/\bhaga clic\b/g, "haz clic"],
  [/\bAbra\b/g, "Abre"],
  [/\bConfigure\b/g, "Configura"],
  [/\bConecte\b/g, "Conecta"],
  [/\bVerifique\b/g, "Comprueba"],
  [/\bCompruebe\b/g, "Comprueba"],
  [/\bAgregue\b/g, "Añade"],
  [/\bReemplace\b/g, "Sustituye"],
  [/\bPrepare\b/g, "Prepara"],
  [/\bPermita\b/g, "Permite"],
  [/\bEspere\b/g, "Espera"],
  [/\bRevise\b/g, "Revisa"],
  [/\bGuarde\b/g, "Guarda"],
  [/\bElimine\b/g, "Elimina"],
  [/\bIntroduzca\b/g, "Introduce"],
  [/\bAjuste\b/g, "Ajusta"],
  [/\bComprenda\b/g, "Comprende"],
  [/\bUtilice\b/g, "Usa"],
  [/\bCree\b/g, "Crea"],
  [/\bEdite\b/g, "Edita"],
  [/\bEvite\b/g, "Evita"],
  [/\bConsulte\b/g, "Consulta"],
  [/\bConfirme\b/g, "Confirma"],
  [/\bIndique\b/g, "Indica"],
  [/\bDeje\b/g, "Deja"],
  [/\bAsegúrese\b/g, "Asegúrate"],
  [/\bVuelva a conectar\b/g, "Vuelve a conectar"],
  [/\benvíe\b/g, "envía"],
  [/\bguarde\b/g, "guarda"],
  [/\bcongele\b/g, "congela"],
  [/\bprograme\b/g, "programa"],
  [/\bseleccione\b/g, "selecciona"],
  [/(^|[.!?]\s+)Puede\b/gu, "$1Puedes"],
];

const dutchReplacements = [
  [/\bActiveer je\b/g, "Activeer uw"],
  [/\bBreng je\b/g, "Breng uw"],
  [/\bhelpt je\b/g, "helpt u"],
  [/\bDeel je\b/g, "Deel uw"],
  [/\bAl je\b/g, "Al uw"],
  [/\btransformeert je\b/g, "transformeert uw"],
  [/\bvoordat je\b/g, "voordat u"],
  [/\bJe bericht\b/g, "Uw bericht"],
  [/\bWil je\b/g, "Wilt u"],
  [/\bJe kunt\b/g, "U kunt"],
  [/\bdat je\b/g, "dat u"],
  [/\bKies je\b/g, "Kies uw"],
  [/\bje intentie\b/g, "uw intentie"],
  [/\bjouw\b/g, "uw"],
  [/\bdie je\b/g, "die u"],
  [/\bzodat je\b/g, "zodat u"],
  [/\bneemt je\b/g, "neemt uw"],
  [/\bSla je\b/g, "Sla uw"],
  [/\bje werk\b/g, "uw werk"],
  [/\bje instellingen\b/g, "uw instellingen"],
  [/\bwaar je\b/g, "waar u"],
  [/\bnaar je\b/g, "naar uw"],
  [/\bof je telefoon\b/g, "of uw telefoon"],
  [/\bBereid je\b/g, "Bereid uw"],
];

const localeOverrides = new Map([
  ["fr-FR:gps.booster_73a103c5", "Booster"],
  ["en-GB:dashboard.moduleCards.site_inrcy.connect", "Connect Google Analytics"],
  ["en-GB:dashboard.moduleCards.site_web.connect", "Connect Google Analytics"],
  ["en-GB:booster.booster_programme_865e1b6b", "Scheduled Booster"],
  ["en-GB:gps.booster_73a103c5", "Booster"],
  ["en-GB:agent.agent_source_publish", "Content already published + connected Booster / Publish channels"],
  ["en-GB:gps.inrcy_fonctionne_mieux_avec_une_petite_eeda190e", "iNrCy works better with small, regular actions than with large, infrequent ones. Stay visible, active and reassuring."],
  ["en-GB:reputation.google_business_to_connect", "Connect Google Business Profile"],
  ["es-ES:dashboard.moduleCards.site_inrcy.connect", "Conectar Google Analytics"],
  ["es-ES:dashboard.moduleCards.site_web.connect", "Conectar Google Analytics"],
  ["es-ES:gps.booster_73a103c5", "Booster"],
  ["es-ES:stats.stats_connect_channel_to_activate", "Conecta este canal para activar las estadísticas y Booster."],
  ["es-ES:mails.mail_action_failed", "No se ha podido realizar esta acción en este momento."],
  ["es-ES:agent.agent_source_publish", "Contenido ya publicado + canales conectados de Booster / Publicar"],
  ["es-ES:agent.agent_publication_prepared", "Publicación de Booster preparada por iNr’Agent."],
  ["es-ES:gps.inr_send_regroupe_toutes_les_communications_6edd1586", "iNr’Send reúne todas las comunicaciones enviadas desde iNrCy: correos electrónicos, publicaciones de Booster, acciones de captación y fidelización, presupuestos y facturas."],
  ["es-ES:gps.avec_standard_inr_send_conserve_la_7cc5afc7", "Con Standard, iNr’Send conserva la columna «Publicaciones»: contenido de Booster, resultados por canal, enlaces públicos y detalles útiles."],
  ["es-ES:gps.inrcy_fonctionne_mieux_avec_une_petite_eeda190e", "iNrCy funciona mejor con acciones pequeñas y regulares que con acciones grandes y esporádicas. Mantén una presencia visible, activa y tranquilizadora."],
  ["es-ES:gps.ouvrir_inr_agent_depuis_le_header_57885cd0", "Abre **iNr’Agent** desde la cabecera del panel."],
  ["es-ES:gps.ouvrir_inr_agent_depuis_le_header_8b9bfb22", "Abre **iNr’Agent** desde la cabecera del panel."],
  ["es-ES:gps.ouvrir_inr_send_depuis_la_boite_3b8c7859", "Abre **iNr’Send** desde el panel de control."],
  ["es-ES:agent.si_vous_continuez_la_campagne_actuelle_b57b70a9", "Si continúas, la campaña actual se guardará automáticamente como borrador en iNr’Send y se preparará una nueva campaña en iNr’Agent."],
  ["es-ES:agent.agent_operation_source", "Funcionamiento de iNr’Agent"],
  ["es-ES:agent.aucune_boite_mail_connectee_connecte_une_98952f86", "No hay ninguna cuenta de correo conectada. Conecta una en iNr’Send antes de validar."],
  ["es-ES:booster.du_contenu_a_deja_ete_saisi_45466126", "Ya se ha introducido, generado o editado contenido. Esta acción puede eliminar tu trabajo actual."],
  ["es-ES:booster.value_n_a_pas_repondu_au_e653b7e3", "{value0} no respondió al primer intento. iNrCy completó automáticamente la generación con {value1} sin cambiar tu motor predeterminado."],
  ["es-ES:booster.video_format_active_for_publication", "Formato activo para tu publicación"],
  ["es-ES:booster.video_variant_required_before_publish", "La versión para la red debe estar lista antes de publicar."],
  ["es-ES:mails.verifiez_les_destinataires_l_objet_et_111a6b88", "Comprueba los destinatarios, el asunto y el mensaje preparado desde {value0}; después, envíalo desde tu cuenta de correo conectada."],
  ["es-ES:gps.comprendre_les_12_canaux_inrcy_qui_0734ffce", "Descubre los 12 canales de iNrCy que impulsan tu visibilidad, difusión y reputación online."],
  ["es-ES:gps.utiliser_les_contacts_du_crm_ou_677522b3", "Usa los contactos de tu **CRM** o selecciona los destinatarios adecuados."],
  ["es-ES:gps.utiliser_mon_activite_pour_le_metier_9afc1af8", "Usa **Mi actividad** para configurar tu profesión, servicios, especialidades, puntos fuertes, clientela y horarios."],
  ["es-ES:gps.utiliser_mon_profil_pour_l_identite_ad8f2074", "Usa **Mi perfil** para configurar tu identidad, datos de contacto, empresa, ciudad y logotipo."],
  ["es-ES:stats.comprenez_votre_potentiel_d_opportunites_sur_fa5e3aab", "Descubre tu potencial de oportunidades para los próximos 30 días."],
  ["es-ES:stats.inr_stats_analyse_les_donnees_recuperees_0a6b0cad", "iNr’Stats analiza los datos recopilados de tus canales (sitio web, Google, redes sociales, etc.) y los convierte en información útil para tu negocio."],
  ["es-ES:media.ce_media_sera_supprime_definitivement_de_783dea19", "Este contenido multimedia se eliminará permanentemente de tu biblioteca."],
  ["es-ES:media.supprimer_definitivement_value_media_s_de_80952de7", "¿Eliminar permanentemente {value0} elementos multimedia de tu biblioteca?"],
  ["es-ES:reputation.merci_beaucoup_value_pour_ce_tres_563e04eb", "Muchas gracias{value0} por este magnífico comentario. Tu satisfacción es una gran recompensa para nuestro equipo."],
  ["es-ES:reputation.merci_value_pour_cette_belle_note_5595bdae", "Gracias{value0} por esta excelente valoración. Tus comentarios nos animan a seguir trabajando con la misma dedicación."],
  ["es-ES:reputation.merci_value_pour_cette_tres_belle_3b6ca1d1", "Gracias{value0} por esta excelente valoración. Nos alegra mucho saber que estás satisfecho."],
  ["es-ES:reputation.fiche_google_business_09b337dd", "Perfil de Empresa en Google"],
  ["es-ES:reputation.google_business_to_connect", "Conectar Perfil de Empresa en Google"],
  ["it-IT:agent.analyse_inr_agent_503a6b60", "Analisi di iNr’Agent"],
  ["it-IT:dashboard.moduleCards.site_inrcy.connect", "Collega Google Analytics"],
  ["it-IT:dashboard.moduleCards.site_web.connect", "Collega Google Analytics"],
  ["it-IT:gps.booster_73a103c5", "Booster"],
  ["it-IT:agent.agent_operation_source", "Funzionamento di iNr’Agent"],
  ["it-IT:booster.border_box_026d2f4e", "border-box"],
  ["it-IT:gps.bilan_76a39cd2", "riepilogo"],
  ["it-IT:gps.boite_d_envoi_8f188956", "posta in uscita"],
  ["it-IT:gps.boite_mail_2c9c9bbb", "casella di posta"],
  ["it-IT:reputation.fiche_google_business_09b337dd", "Profilo dell’attività su Google"],
  ["it-IT:reputation.google_business_to_connect", "Collega il Profilo dell’attività su Google"],
  ["de-DE:agent.analyse_inr_agent_503a6b60", "iNr’Agent-Analyse"],
  ["de-DE:dashboard.userMenu.referral", "iNrCy weiterempfehlen"],
  ["de-DE:dashboard.drawer.titles.parrainage", "iNrCy weiterempfehlen"],
  ["de-DE:dashboard.moduleCards.site_inrcy.connect", "Google Analytics verbinden"],
  ["de-DE:dashboard.moduleCards.site_web.connect", "Google Analytics verbinden"],
  ["de-DE:gps.booster_73a103c5", "Booster"],
  ["de-DE:stats.stats_reconnect_expired_channel", "Die Verbindung ist abgelaufen. Verbinden Sie diesen Kanal erneut, um die Statistiken und Booster wieder zu aktivieren."],
  ["de-DE:agent.image_adapter_isolation_note", "Diese Einstellung verwendet das Tool „Bild anpassen“ von Booster und ersetzt das Medium in iNr’Agent durch die angepasste Version."],
  ["de-DE:agent.agent_operation_source", "Funktionsweise von iNr’Agent"],
  ["de-DE:gps.bilan_76a39cd2", "Bericht"],
  ["de-DE:gps.boite_d_envoi_8f188956", "Postausgang"],
  ["de-DE:gps.boite_mail_2c9c9bbb", "Postfach"],
  ["de-DE:gps.configurer_inr_badge_inclus_en_bonus_a94257d1", "Konfigurieren Sie **iNr’Badge**, das als Bonus enthalten ist, um das Unternehmensprofil und den QR-Code des Unternehmens zu teilen."],
  ["de-DE:reputation.fiche_google_business_09b337dd", "Google Unternehmensprofil"],
  ["de-DE:reputation.filtrer_a7a02ef5", "Filtern"],
  ["de-DE:reputation.google_business_to_connect", "Google Unternehmensprofil verbinden"],
  ["de-DE:reputation.details_de_l_avis_3fc3ec16", "Bewertungsdetails"],
  ["de-DE:reputation.exemple_avis_fictif_8d938cc5", "BEISPIEL — fiktive Bewertung"],
  ["de-DE:reputation.generation_839b5564", "Generierung…"],
  ["de-DE:reputation.gerer_google_5eed5e3d", "Google verwalten"],
  ["de-DE:reputation.gestion_des_avis_value_3fa4a9b6", "Bewertungsverwaltung {value0}"],
  ["de-DE:reputation.impossible_de_publier_la_reponse_value_a883eef2", "Die Antwort {value0} kann derzeit nicht veröffentlicht werden."],
  ["de-DE:reputation.impossible_de_supprimer_la_reponse_value_9114adb7", "Die Antwort {value0} kann derzeit nicht gelöscht werden."],
  ["de-DE:reputation.la_reponse_publiee_sur_value_sera_4250c131", "Die auf {value0} veröffentlichte Antwort wird für diese Bewertung endgültig gelöscht."],
  ["de-DE:reputation.les_lignes_ci_dessous_sont_fictives_a40db886", "Die folgenden Zeilen sind fiktiv. Verbinden Sie Google, um echte Unternehmensbewertungen anzuzeigen und zu verwalten."],
  ["de-DE:reputation.merci_infiniment_value_pour_votre_note_3f2a9070", "Vielen Dank{value0} für Ihre Bewertung. Wir freuen uns, dass wir Ihnen ein positives Erlebnis bieten konnten."],
  ["de-DE:reputation.merci_value_d_avoir_pris_le_03cb2ebc", "Vielen Dank{value0}, dass Sie sich die Zeit genommen haben, Ihre Erfahrung mit uns zu teilen. Es tut uns leid, dass sie nicht vollständig zufriedenstellend war, und wir stehen Ihnen gerne für ein Gespräch zur Verfügung."],
  ["de-DE:reputation.merci_value_d_avoir_pris_le_9021204e", "Vielen Dank{value0}, dass Sie sich die Zeit genommen haben, Ihre Meinung zu teilen. Ihr Feedback hilft uns, uns stetig zu verbessern."],
  ["de-DE:reputation.note_2c924e30", "Bewertung"],
  ["de-DE:reputation.note_value_e58cb214", "Bewertung: {value0}"],
  ["de-DE:reputation.ouvrir_la_configuration_ia_a4ecd6d4", "KI-Konfiguration öffnen"],
  ["de-DE:reputation.synchronisation_google_0008de4a", "Google-Synchronisierung…"],
  ["de-DE:reputation.tous_vos_avis_google_depuis_une_4c85b97a", "Alle Ihre Google-Bewertungen auf einem einzigen Gerät."],
  ["de-DE:reputation.value_etoiles_sur_5_d0131ac3", "{value0} von 5 Sternen"],
  ["de-DE:reputation.value_value_value_note_value_8e0d66cb", "{value0} · {value1} · {value2} · Bewertung: {value3}"],
  ["de-DE:mails.ajoutez_la_touche_finale_avant_l_2e3b2378", "Geben Sie Ihrer Nachricht vor dem Senden den letzten Schliff."],
  ["de-DE:mails.ajoutez_une_nouvelle_video_avant_d_803819f5", "Fügen Sie vor dem Speichern dieses Beitrags ein neues Video hinzu."],
  ["de-DE:mails.ajoutez_une_video_avant_d_appliquer_580c0ec6", "Fügen Sie ein Video hinzu, bevor Sie das Format anwenden."],
  ["de-DE:gps.ajouter_un_invite_si_une_autre_a3c54573", "Fügen Sie einen Gast hinzu, wenn eine weitere Person die Erinnerungen erhalten soll."],
  ["de-DE:booster.ajoutez_au_moins_un_titre_ou_c8f6c900", "Fügen Sie vor dem Duplizieren mindestens einen Titel oder Inhalt hinzu."],
  ["de-DE:booster.ajoutez_un_contenu_ou_un_media_b14123ad", "Fügen Sie vor dem Speichern des Entwurfs Inhalt oder Medien hinzu."],
  ["de-DE:booster.ajoutez_une_ou_plusieurs_images_ou_5e529a68", "Fügen Sie ein oder mehrere Bilder hinzu oder wählen Sie für diesen Kanal „Video / Keine Medien“."],
  ["de-DE:booster.ajoutez_une_photo_ou_une_video_a053ec3d", "Fügen Sie ein Foto oder Video hinzu, das Sie auf TikTok veröffentlichen möchten."],
  ["de-DE:booster.ajoutez_une_video_avant_de_programmer_f54a63bc", "Fügen Sie ein Video hinzu, bevor Sie diese Kanäle planen."],
  ["de-DE:booster.ajoutez_une_video_avant_de_publier_74e6e32f", "Fügen Sie vor der Veröffentlichung ein Video hinzu oder wählen Sie pro Kanal „Fotos / Keine Medien“."],
  ["de-DE:booster.ajoutez_une_video_ou_choisissez_photos_0fc6eb5c", "Fügen Sie für diesen Kanal ein Video hinzu oder wählen Sie „Fotos / Keine Medien“."],
  ["de-DE:booster.ajoutez_une_video_pour_publier_sur_25b3629b", "Fügen Sie ein Video hinzu, um es auf YouTube zu veröffentlichen."],
  ["de-DE:booster.ajoutez_une_video_valide_value_10fc4557", "Fügen Sie ein gültiges Video hinzu: {value0}."],
  ["de-DE:booster.les_choix_tiktok_en_cours_seront_431e8b40", "Ihre aktuellen TikTok-Einstellungen gehen verloren, wenn Sie zum Beitrag zurückkehren."],
  ["de-DE:booster.les_mots_apparaissent_en_direct_recliquez_cf12629c", "Der Text erscheint live. Klicken Sie erneut auf das Mikrofon, um die Spracheingabe zu korrigieren."],
  ["de-DE:booster.publication_library_hint_source", "Wählen Sie bis zu 5 Bilder und ein bereits in iNrCy gespeichertes Video aus."],
  ["de-DE:booster.redigez_directement_vos_contenus_par_canal_3c8f02e2", "Erstellen Sie Ihre Inhalte direkt für jeden Kanal und behalten Sie die Kontrolle über jeden Text."],
  ["de-DE:booster.decrivez_le_sujet_de_cette_publication_d6313015", "Beschreiben Sie den Inhalt dieses Beitrags und fügen Sie bei Bedarf eine konkrete Anweisung hinzu. Medien sind optional."],
  ["de-DE:booster.parlez_maintenant_puis_recliquez_sur_le_2a84f44e", "Sprechen Sie jetzt und klicken Sie anschließend erneut auf das Mikrofon, um die Aufnahme zu beenden."],
  ["de-DE:booster.veuillez_ajouter_au_moins_1_image_2804ca41", "Fügen Sie mindestens ein Bild hinzu, um es auf Instagram zu veröffentlichen."],
  ["de-DE:booster.veuillez_ajouter_au_moins_1_image_b3487d4c", "Fügen Sie mindestens ein Bild hinzu, um es auf Pinterest zu veröffentlichen."],
  ["de-DE:booster.veuillez_ajouter_une_video_pour_publier_392ad3f1", "Fügen Sie ein Video hinzu, um es auf Pinterest zu veröffentlichen."],
  ["nl-NL:agent.analyse_inr_agent_503a6b60", "iNr’Agent-analyse"],
  ["nl-NL:dashboard.userMenu.referral", "iNrCy aanbevelen"],
  ["nl-NL:dashboard.drawer.titles.parrainage", "iNrCy aanbevelen"],
  ["nl-NL:dashboard.moduleCards.site_inrcy.connect", "Google Analytics koppelen"],
  ["nl-NL:dashboard.moduleCards.site_web.connect", "Google Analytics koppelen"],
  ["nl-NL:gps.booster_73a103c5", "Booster"],
  ["nl-NL:stats.stats_reconnect_expired_channel", "De verbinding is verlopen. Koppel dit kanaal opnieuw om de statistieken en Booster opnieuw te activeren."],
  ["nl-NL:mails.inr_send_est_le_centre_d_245bc065", "iNr’Send is het centrale verzendpunt voor uw communicatie."],
  ["nl-NL:stats.booster_permet_de_publier_rapidement_pour_c5c61333", "Met Booster publiceert u snel en brengt u uw bedrijf weer in beweging."],
  ["nl-NL:stats.booster_vous_aide_a_prendre_la_12591d89", "Booster helpt u om uw boodschap eenvoudig op LinkedIn te verspreiden."],
  ["nl-NL:media.importez_vos_meilleurs_visuels_ici_pour_470820ca", "Upload hier uw beste beelden, zodat iNr’Agent voorrang geeft aan uw eigen media."],
  ["nl-NL:gps.bilan_76a39cd2", "rapport"],
  ["nl-NL:gps.boite_d_envoi_8f188956", "Postvak UIT"],
  ["nl-NL:gps.boite_mail_2c9c9bbb", "postvak"],
  ["nl-NL:reputation.fiche_google_business_09b337dd", "Google-bedrijfsprofiel"],
  ["nl-NL:reputation.google_business_to_connect", "Google-bedrijfsprofiel koppelen"],
  ["nl-NL:booster.resume_final_google_business_d9bf3960", "Eindoverzicht van Google-bedrijfsprofiel"],
  ["pt-PT:agent.analyse_inr_agent_503a6b60", "Análise do iNr’Agent"],
  ["pt-PT:dashboard.moduleCards.site_inrcy.connect", "Ligar o Google Analytics"],
  ["pt-PT:dashboard.moduleCards.site_web.connect", "Ligar o Google Analytics"],
  ["pt-PT:gps.booster_73a103c5", "Booster"],
  ["pt-PT:gps.bilan_76a39cd2", "relatório"],
  ["pt-PT:gps.boite_d_envoi_8f188956", "caixa de saída"],
  ["pt-PT:gps.boite_mail_2c9c9bbb", "caixa de correio"],
  ["pt-PT:reputation.fiche_google_business_09b337dd", "Perfil de Empresa no Google"],
  ["pt-PT:reputation.google_business_to_connect", "Ligar Perfil de Empresa no Google"],
  ["pt-PT:media.importez_vos_meilleurs_visuels_ici_pour_470820ca", "Carregue aqui as suas melhores imagens, para que o iNr’Agent dê prioridade aos seus conteúdos multimédia originais."],
  ["pt-PT:media.importez_vos_premieres_photos_ou_videos_7f226498", "Carregue as suas primeiras fotos ou vídeos para alimentar o iNr’Agent."],
  ["pt-PT:stats.activez_votre_visibilite_inspiration_714ee6e6", "Ative a sua visibilidade com conteúdos inspiradores."],
  ["pt-PT:stats.activez_votre_vitrine_de_marque_03db73d4", "Ative a sua montra de marca."],
  ["pt-PT:stats.mails_analyse_vos_usages_fideliser_propulser_37166dba", "O módulo E-mails analisa a utilização de Fidelizar, Propulser e dos e-mails simples para transformar os dados do CRM em ações concretas."],
  ["pt-PT:stats.relancez_votre_visibilite_locale_b7d7ba45", "Reforce a sua visibilidade local."],
  ["pt-PT:gps.les_sauvegardes_conservent_le_travail_pour_b190d8ce", "As cópias guardadas preservam o seu trabalho para que possa retomá-lo mais tarde."],
  ["pt-PT:gps.comprendre_les_12_canaux_inrcy_qui_0734ffce", "Conheça os 12 canais da iNrCy que impulsionam a sua visibilidade, divulgação e reputação online."],
  ["pt-PT:gps.propulser_regroupe_les_actions_guidees_pour_9ae39667", "Propulser reúne ações guiadas para desenvolver a atividade. O profissional escolhe entre Valorizar, Recolher ou Oferecer, consoante as necessidades atuais."],
  ["pt-PT:mails.toutes_vos_communications_depuis_une_seule_eecb4544", "Todas as suas comunicações num único dispositivo."],
  ["pt-PT:booster.images_total_too_large", "As suas imagens excedem o limite total de {limit}. Reduza o número ou o tamanho das fotografias."],
  ["pt-PT:reputation.merci_beaucoup_value_pour_ce_tres_563e04eb", "Agradecemos muito{value0} este excelente comentário. A sua satisfação é uma verdadeira recompensa para a nossa equipa."],
  ["pt-PT:reputation.merci_beaucoup_value_pour_votre_avis_ff352f28", "Agradecemos muito{value0} a sua avaliação. A sua opinião é importante para nós e motiva-nos a continuar neste caminho."],
  ["pt-PT:reputation.merci_beaucoup_value_pour_votre_excellente_a012072c", "Agradecemos muito{value0} a sua excelente classificação. A sua confiança deixa-nos muito satisfeitos e esperamos voltar a contar consigo em breve."],
  ["pt-PT:reputation.merci_beaucoup_value_pour_votre_note_a5d924e4", "Agradecemos muito{value0} a sua avaliação e confiança. Ficamos muito satisfeitos por saber que teve uma experiência positiva."],
  ["pt-PT:reputation.merci_d_avoir_partage_votre_avis_94bf4a38", "Agradecemos ter partilhado a sua opinião{value0}. Continuamos disponíveis para conversar diretamente consigo e compreender melhor o seu comentário."],
  ["pt-PT:reputation.merci_infiniment_value_pour_votre_note_3f2a9070", "Agradecemos imenso{value0} a sua avaliação. Ficamos felizes por lhe termos proporcionado uma experiência positiva."],
  ["pt-PT:reputation.merci_pour_votre_confiance_et_votre_54ca9ea1", "Agradecemos a sua confiança e o seu comentário construtivo. Continuamos inteiramente disponíveis."],
  ["pt-PT:reputation.merci_pour_votre_evaluation_value_nous_e5421e2d", "Agradecemos a sua avaliação{value0}. Continuamos disponíveis caso pretenda conversar connosco sobre a sua experiência."],
  ["pt-PT:reputation.merci_pour_votre_retour_value_nous_de42f06e", "Agradecemos o seu comentário{value0}. Levamos a sua opinião muito a sério. Entre em contacto connosco para podermos compreender melhor a situação."],
  ["pt-PT:reputation.merci_value_d_avoir_pris_le_03cb2ebc", "Agradecemos{value0} ter dedicado algum tempo a partilhar a sua experiência. Lamentamos que não tenha sido totalmente satisfatória e continuamos disponíveis para conversar consigo."],
  ["pt-PT:reputation.merci_value_d_avoir_pris_le_9021204e", "Agradecemos{value0} ter dedicado algum tempo a partilhar a sua opinião. O seu comentário ajuda-nos a continuar a melhorar."],
  ["pt-PT:reputation.merci_value_pour_cette_belle_note_5595bdae", "Agradecemos{value0} esta excelente classificação. A sua opinião incentiva-nos a continuar com o mesmo rigor."],
  ["pt-PT:reputation.merci_value_pour_cette_tres_belle_3b6ca1d1", "Agradecemos{value0} esta excelente classificação. Ficamos muito satisfeitos por saber que gostou da experiência."],
  ["pt-PT:reputation.merci_value_pour_votre_avis_nous_80996010", "Agradecemos{value0} a sua opinião. Prestamos muita atenção aos seus comentários e estamos disponíveis para conversar, se necessário."],
  ["pt-PT:reputation.merci_value_pour_votre_commentaire_et_d30ebbd5", "Agradecemos{value0} o seu comentário e a excelente classificação. Ficamos felizes por termos conseguido prestar-lhe o melhor acompanhamento possível."],
  ["pt-PT:reputation.merci_value_pour_votre_confiance_et_b5a214f5", "Agradecemos{value0} a sua confiança e o seu comentário. Ficamos muito satisfeitos com a sua experiência e teremos em conta cada detalhe para continuar a melhorar."],
  ["pt-PT:reputation.merci_value_pour_votre_message_nous_aea336d4", "Agradecemos{value0} a sua mensagem. Lamentamos que a experiência não tenha correspondido às suas expectativas e continuamos disponíveis para conversar consigo."],
  ["pt-PT:reputation.merci_value_pour_votre_retour_et_7a6b283c", "Agradecemos{value0} o seu comentário e esta excelente classificação. Ficamos felizes por termos correspondido às suas expectativas e continuaremos empenhados em fazer ainda melhor."],
  ["pt-PT:reputation.merci_value_pour_votre_retour_nous_8a13bc92", "Agradecemos{value0} o seu comentário. Teremos a sua opinião em conta e continuamos disponíveis caso pretenda dar-nos mais detalhes sobre a sua experiência."],
  ["pt-PT:reputation.merci_value_pour_votre_retour_si_f0c2ab82", "Agradecemos{value0} o seu comentário tão positivo. Ficamos muito satisfeitos por saber que o nosso acompanhamento correspondeu às suas expectativas. Esperamos voltar a contar consigo em breve!"],
  ["pt-PT:reputation.merci_value_pour_votre_retour_toute_ece727a1", "Agradecemos{value0} o seu comentário. Toda a equipa lhe agradece esta excelente classificação."],
  ["pt-PT:reputation.un_grand_merci_value_pour_vos_a4686f98", "Um enorme agradecimento{value0} pelas suas cinco estrelas. Toda a equipa agradece calorosamente a sua avaliação."],
  ["pt-PT:reputation.un_grand_merci_value_pour_votre_032c55c8", "Um enorme agradecimento{value0} pela sua avaliação. Esperamos ter o prazer de voltar a acompanhá-lo."],
  ["pt-PT:reputation.un_grand_merci_value_pour_votre_68c38539", "Um enorme agradecimento{value0} pela sua confiança e opinião. Toda a equipa fica feliz por lhe ter proporcionado uma experiência positiva."],
  ["pt-PT:reputation.un_grand_merci_value_pour_votre_af57b469", "Um enorme agradecimento{value0} pelo seu comentário positivo. Continuamos empenhados em proporcionar-lhe a melhor experiência possível."],
]);

// Deterministic fixes for translations that cannot safely be inferred from a
// short source string or that contain protected brand terms/placeholders.
// Keeping them in the post-edit pipeline makes the correction reproducible.
const validationOverrides = new Map([
  ["es-ES:agenda.value_evenement_value_ea491d64", "{value0} evento{value1}"],
  ["it-IT:agenda.vendredi_cb289d87", "Venerdì"],
  ["es-ES:crm.cette_action_supprimera_definitivement_value_con_9ecfd7cf", "Esta acci\u00f3n eliminar\u00e1 definitivamente {value0} contacto{value1}."],
  ["it-IT:crm.cette_action_supprimera_definitivement_value_con_9ecfd7cf", "Questa azione eliminer\u00e0 definitivamente {value0} contatto{value1}."],
  ["de-DE:crm.cette_action_supprimera_definitivement_value_con_9ecfd7cf", "Diese Aktion l\u00f6scht endg\u00fcltig {value0} Kontakt{value1}."],
  ["nl-NL:crm.cette_action_supprimera_definitivement_value_con_9ecfd7cf", "Deze actie verwijdert permanent {value0} contact{value1}."],
  ["pt-PT:crm.cette_action_supprimera_definitivement_value_con_9ecfd7cf", "Esta a\u00e7\u00e3o eliminar\u00e1 definitivamente {value0} contacto{value1}."],
  ["pt-PT:public.service_intent_identity", "Dá à empresa uma identidade reconhecível, com elementos visuais coerentes em todos os suportes."],
  ["pt-PT:public.service_intent_print", "Materializa a mensagem da empresa em suportes claros, úteis e prontos a divulgar."],
  ["es-ES:growth.les_actions_lancees_depuis_fideliser_y_795ea881", "Las acciones iniciadas desde Fidelizar siguen disponibles, y las publicaciones realizadas desde Booster tambi\u00e9n se encuentran en iNr\u2019Send / Publicaciones para modificarlas o eliminarlas."],
  ["it-IT:growth.inr_send_5c2a3e92", "iNr\u2019Send"],
  ["it-IT:growth.ouvrir_inr_send_d4b453c9", "Apri iNr\u2019Send"],
  ["nl-NL:growth.les_actions_lancees_depuis_fideliser_y_795ea881", "Acties die vanuit Loyaliteit zijn gestart, blijven beschikbaar en publicaties die vanuit Booster zijn gemaakt, zijn ook te vinden in iNr\u2019Send / Publicaties om ze te wijzigen of te verwijderen."],
  ["nl-NL:growth.ouvrir_inr_send_d4b453c9", "Open iNr\u2019Send"],
  ["pt-PT:growth.inr_send_5c2a3e92", "iNr\u2019Send"],
  ["pt-PT:growth.les_actions_lancees_depuis_fideliser_y_795ea881", "As a\u00e7\u00f5es iniciadas em Fidelizar continuam dispon\u00edveis, e as publica\u00e7\u00f5es realizadas no Booster tamb\u00e9m podem ser encontradas em iNr\u2019Send / Publica\u00e7\u00f5es para edi\u00e7\u00e3o ou elimina\u00e7\u00e3o."],
  ["pt-PT:growth.ouvrir_inr_send_d4b453c9", "Abrir iNr\u2019Send"],
  ["en-GB:public.inr_apos_search_6cbfd855", "iNr&apos;Search"],
  ["es-ES:public.avec_value_value_value_value_value_3356e4b9", "Con {value0}, {value1} {value2}{value3}{value4}."],
  ["it-IT:public.avec_value_value_value_value_value_3356e4b9", "Con {value0}, {value1} {value2}{value3}{value4}."],
  ["de-DE:public.avec_value_value_value_value_value_3356e4b9", "Mit {value0}, {value1} {value2}{value3}{value4}."],
  ["nl-NL:public.avec_value_value_value_value_value_3356e4b9", "Met {value0}, {value1} {value2}{value3}{value4}."],
  ["pt-PT:public.avec_value_value_value_value_value_3356e4b9", "Com {value0}, {value1} {value2}{value3}{value4}."],
  ["es-ES:public.passeport_inrbadge_14c9bcc1", "Pasaporte iNr\u2019Badge"],
  ["de-DE:public.passeport_inrbadge_14c9bcc1", "Pass iNr\u2019Badge"],
  ["pt-PT:public.passeport_inrbadge_14c9bcc1", "Passaporte iNr\u2019Badge"],
  ["es-ES:public.value_value_inr_badge_3b39f90f", "{value0} {value1} \u00b7 iNr\u2019Badge"],
  ["es-ES:public.vous_etes_a_value_presentez_votre_30978146", "\u00bfUtilizas {value0}? Env\u00eda tu solicitud a {value1} para consultar la disponibilidad y coordinar los siguientes pasos."],
  ["it-IT:public.vous_etes_a_value_presentez_votre_30978146", "Stai utilizzando {value0}? Invia la tua richiesta a {value1} per verificare la disponibilit\u00e0 e concordare i passaggi successivi."],
  ["de-DE:public.vous_etes_a_value_presentez_votre_30978146", "Sind Sie in {value0}? Senden Sie Ihre Anfrage an {value1}, um die Verf\u00fcgbarkeit zu pr\u00fcfen und die n\u00e4chsten Schritte zu organisieren."],
  ["nl-NL:public.vous_etes_a_value_presentez_votre_30978146", "Bent u in {value0}? Dien uw aanvraag in bij {value1} om de beschikbaarheid te controleren en de volgende stappen te regelen."],
  ["pt-PT:public.vous_etes_a_value_presentez_votre_30978146", "Est\u00e1 em {value0}? Envie o seu pedido para {value1} para verificar a disponibilidade e organizar os pr\u00f3ximos passos."],
  ["en-GB:settings.a_quoi_sert_inr_apos_search_c32318a6", "What is iNr&apos;Search used for?"],
  ["en-GB:settings.aucun_tableau_disponible_creez_votre_premier_36cf04bd", "No board available. Create your first Pinterest board."],
  ["en-GB:settings.booster_sur_10_canaux_inr_apos_38a43414", "Booster on 10 channels, iNr&apos;Agent Posts + Statistics, iNr&apos;Badge included, iNr&apos;Stats, iNr&apos;Send history, and Reputation."],
  ["en-GB:settings.deconnecter_votre_page_inr_apos_search_c5a16ef8", "Disconnect your iNr&apos;Search page?"],
  ["en-GB:settings.inr_apos_search_transforme_automatiquement_les_99deb0af", "iNr&apos;Search automatically transforms the information already saved in iNrCy into a public professional page designed for internet users, Google, Bing, and AI answer engines."],
  ["en-GB:settings.page_publique_inr_apos_search_31dc348f", "iNr&apos;Search public page"],
  ["es-ES:settings.booster_est_votre_mission_active_les_93914a0a", "Booster es tu misi\u00f3n activa. Las dem\u00e1s misiones se muestran como una vista previa Premium."],
  ["es-ES:settings.booster_sur_10_canaux_inr_apos_38a43414", "Booster en 10 canales, publicaciones y estad\u00edsticas de iNr&apos;Agent, iNr&apos;Badge incluido, iNr&apos;Stats, historial de iNr&apos;Send y Reputaci\u00f3n."],
  ["it-IT:settings.boosts_a_faire_cette_semaine_a0a21688", "Attivit\u00e0 da completare questa settimana"],
  ["pt-PT:settings.angle_prefere_082c1a4d", "Orienta\u00e7\u00e3o preferida"],
  ["pt-PT:settings.notifications_inrcy_d6daa4eb", "Notifica\u00e7\u00f5es iNrCy"],
  ["en-GB:booster.bericht_sturen_0a59fb02", "Send the report"],
  ["en-GB:booster.enviar_mensagem_87ae45ef", "Send a message"],
  ["en-GB:booster.enviar_mensaje_b25cabb5", "Send a message"],
  ["en-GB:booster.nachricht_senden_17ba0b59", "Send a message"],
  ["es-ES:booster.bericht_sturen_0a59fb02", "Enviar el informe"],
  ["es-ES:booster.enviar_mensaje_b25cabb5", "Enviar mensaje"],
  ["es-ES:booster.nachricht_senden_17ba0b59", "Enviar un mensaje"],
  ["es-ES:shell.wird_geladen_17fac8ea", "Cargando\u2026"],
  ["it-IT:booster.bericht_sturen_0a59fb02", "Invia il rapporto"],
  ["it-IT:booster.enviar_mensaje_b25cabb5", "Invia un messaggio"],
  ["it-IT:booster.nachricht_senden_17ba0b59", "Invia un messaggio"],
  ["it-IT:shell.a_carregar_bf007bd0", "Caricamento\u2026"],
  ["it-IT:shell.wird_geladen_17fac8ea", "Caricamento\u2026"],
  ["de-DE:booster.bericht_sturen_0a59fb02", "Bericht senden"],
  ["de-DE:booster.enviar_mensaje_b25cabb5", "Nachricht senden"],
  ["pt-PT:booster.bericht_sturen_0a59fb02", "Enviar o relat\u00f3rio"],
  ["pt-PT:booster.nachricht_senden_17ba0b59", "Enviar uma mensagem"],
  ["pt-PT:shell.a_carregar_bf007bd0", "A carregar\u2026"],
  ["pt-PT:shell.laden_0067196c", "A carregar\u2026"],
  ["pt-PT:shell.wird_geladen_17fac8ea", "A carregar\u2026"],
  ["en-GB:shell.collez_ce_code_iframe_dans_votre_b1499310", "Paste this iframe code into your iNrCy site (Elementor \u2192 HTML widget) to automatically display your latest news published via Booster."],
  ["en-GB:shell.completez_mon_profil_pour_generer_votre_7c08ad6c", "Complete My Profile to generate your QR Code iNr'Badge."],
  ["en-GB:shell.compte_facebook_personnel_aa2b9d94", "personal Facebook account"],
  ["en-GB:shell.compte_instagram_a_connecter_fe4d850a", "Instagram account to connect"],
  ["en-GB:shell.compte_instagram_cf617acf", "Instagram account"],
  ["en-GB:shell.connexion_instagram_d099afc4", "Instagram personal account"],
  ["en-GB:shell.connexion_officielle_tiktok_le_pro_autorise_1d5dce46", "Official TikTok connection: the professional authorises their account via Login Kit, then iNrCy stores encrypted tokens server-side."],
  ["en-GB:shell.contacts_supplementaires_pouvant_etre_generes_en_12d3fa24", "Additional contacts can be generated by publishing regularly with Booster and keeping your channels active. Each opportunity is a potential new request captured through your multichannel communication."],
  ["en-GB:shell.contacts_supplementaires_pouvant_etre_generes_gr_207bdb80", "Additional contacts can be generated through the actions recommended in iNrCy: publish with Booster, develop your business with Grow, or maintain relationships with Retain. Each opportunity is a potential new request captured through your communication channels."],
  ["en-GB:shell.copie_creee_l_original_a_ete_6b669e89", "Copy created. The original was kept because it is still used in iNrCy."],
  ["en-GB:shell.inr_apos_send_aaa1fcec", "iNr&apos;Send"],
  ["en-GB:shell.inr_apos_stats_e43f5622", "iNr&apos;Stats"],
  ["en-GB:shell.reconnexion_google_analytics_requise_securite_24425a0e", "Google Analytics reconnection required (security)."],
  ["en-GB:shell.value_derni_egrave_res_actus_50184f28", "{value0} latest news"],
  ["en-GB:shell.value_ko_07f2c21f", "{value0} KB"],
  ["en-GB:shell.value_mo_e0c22daa", "{value0} MB"],
  ["en-GB:shell.value_photos_cliquez_pour_ouvrir_e8f5fc98", "{value0} photos \u2022 click to open"],
  ["en-GB:shell.voir_l_image_value_71740aa0", "View image {value0}"],
  ["es-ES:shell.collez_ce_code_iframe_dans_votre_b1499310", "Pega este c\u00f3digo iframe en tu sitio iNrCy (Elementor \u2192 widget HTML) para mostrar autom\u00e1ticamente las \u00faltimas noticias publicadas por Booster."],
  ["es-ES:shell.inr_send_fd44a9fa", "iNr\u2019Send \u2192"],
  ["es-ES:shell.inr_stats_881d9239", "iNr\u2019Stats \u2192"],
  ["it-IT:shell.inr_send_fd44a9fa", "iNr\u2019Send \u2192"],
  ["it-IT:shell.inr_stats_881d9239", "iNr\u2019Stats \u2192"],
  ["it-IT:shell.sont_dans_le_meme_portefeuille_business_e9a37dbb", "siano nello stesso portafoglio Business e che il tuo account Facebook personale disponga delle autorizzazioni per entrambi."],
  ["de-DE:shell.inr_apos_send_aaa1fcec", "iNr&apos;Send"],
  ["nl-NL:shell.inr_send_fd44a9fa", "iNr\u2019Send \u2192"],
  ["nl-NL:shell.inr_stats_881d9239", "iNr\u2019Stats \u2192"],
  ["pt-PT:shell.inr_send_fd44a9fa", "iNr\u2019Send \u2192"],
  ["pt-PT:shell.inr_stats_881d9239", "iNr\u2019Stats \u2192"],
  ["fr-FR:shell.inr_apos_send_aaa1fcec", "iNr’Send"],
  ["fr-FR:shell.inr_apos_stats_e43f5622", "iNr’Stats"],
  ["en-GB:shell.inr_apos_send_aaa1fcec", "iNr’Send"],
  ["en-GB:shell.inr_apos_stats_e43f5622", "iNr’Stats"],
  ["es-ES:shell.inr_apos_send_aaa1fcec", "iNr’Send"],
  ["es-ES:shell.inr_apos_stats_e43f5622", "iNr’Stats"],
  ["it-IT:shell.inr_apos_send_aaa1fcec", "iNr’Send"],
  ["it-IT:shell.inr_apos_stats_e43f5622", "iNr’Stats"],
  ["de-DE:shell.inr_apos_send_aaa1fcec", "iNr’Send"],
  ["de-DE:shell.inr_apos_stats_e43f5622", "iNr’Stats"],
  ["nl-NL:shell.inr_apos_send_aaa1fcec", "iNr’Send"],
  ["nl-NL:shell.inr_apos_stats_e43f5622", "iNr’Stats"],
  ["pt-PT:shell.inr_apos_send_aaa1fcec", "iNr’Send"],
  ["pt-PT:shell.inr_apos_stats_e43f5622", "iNr’Stats"],
  ["fr-FR:dashboard.generatorSteps.gmb.shortLabel", "Google Business"],
  ["en-GB:dashboard.generatorSteps.gmb.shortLabel", "Google Business"],
  ["es-ES:dashboard.generatorSteps.gmb.shortLabel", "Google Business"],
  ["it-IT:dashboard.generatorSteps.gmb.shortLabel", "Google Business"],
  ["de-DE:dashboard.generatorSteps.gmb.shortLabel", "Google Business"],
  ["nl-NL:dashboard.generatorSteps.gmb.shortLabel", "Google Business"],
  ["pt-PT:dashboard.generatorSteps.gmb.shortLabel", "Google Business"],
  ["fr-FR:dashboard.moduleCards.gmb.name", "Google Business"],
  ["en-GB:dashboard.moduleCards.gmb.name", "Google Business"],
  ["es-ES:dashboard.moduleCards.gmb.name", "Google Business"],
  ["it-IT:dashboard.moduleCards.gmb.name", "Google Business"],
  ["de-DE:dashboard.moduleCards.gmb.name", "Google Business"],
  ["nl-NL:dashboard.moduleCards.gmb.name", "Google Business"],
  ["pt-PT:dashboard.moduleCards.gmb.name", "Google Business"],
  ["fr-FR:crm.nbsp_47c1f11e", "\u00a0"],
  ["en-GB:crm.nbsp_47c1f11e", "\u00a0"],
  ["es-ES:crm.nbsp_47c1f11e", "\u00a0"],
  ["it-IT:crm.nbsp_47c1f11e", "\u00a0"],
  ["de-DE:crm.nbsp_47c1f11e", "\u00a0"],
  ["nl-NL:crm.nbsp_47c1f11e", "\u00a0"],
  ["pt-PT:crm.nbsp_47c1f11e", "\u00a0"],
  ["th-TH:crm.nbsp_47c1f11e", "\u00a0"],
  ["zh-CN:crm.nbsp_47c1f11e", "\u00a0"],
  ["th-TH:dashboard.generatorSteps.site_gsc.shortLabel", "GSC"],
  ["th-TH:stats.gsc_ea8e44e6", "GSC"],
  ["th-TH:gps.facebook_cbe64890", "Facebook"],
  ["th-TH:gps.google_759730a9", "Google"],
  ["th-TH:gps.instagram_b66806f4", "Instagram"],
  ["th-TH:gps.linkedin_7728240c", "LinkedIn"],
  ["th-TH:gps.pinterest_ea273f4e", "Pinterest"],
  ["th-TH:gps.stripe_2fcb5a43", "Stripe"],
  ["th-TH:gps.tiktok_8d762497", "TikTok"],
  ["th-TH:gps.youtube_d5244a33", "YouTube"],
  ["zh-CN:gps.facebook_cbe64890", "Facebook"],
  ["zh-CN:gps.google_759730a9", "Google"],
  ["zh-CN:gps.inrbadge_f4321501", "iNr’Badge"],
  ["zh-CN:gps.linkedin_7728240c", "LinkedIn"],
  ["zh-CN:gps.pinterest_ea273f4e", "Pinterest"],
  ["zh-CN:gps.stripe_2fcb5a43", "Stripe"],
  ["zh-CN:gps.tiktok_8d762497", "TikTok"],
  ["zh-CN:gps.youtube_d5244a33", "YouTube"],
  ["th-TH:legal.confidentialite_0289_87fa5817", "Stripe เมื่อจำเป็นสำหรับการจัดการการสมัครสมาชิก;"],
  ["th-TH:legal.confidentialite_0473_f87a4f6a", "Stripe;"],
  ["zh-CN:legal.mentions_legales_0046_59385139", "Stripe Technology Europe Ltd."],
  ["zh-CN:legal.confidentialite_0289_87fa5817", "在订阅管理需要时使用 Stripe；"],
  ["zh-CN:legal.confidentialite_0473_f87a4f6a", "Stripe；"],
  ["zh-CN:settings.ttc_ou_utilisez_vos_3603baf6", "（含税）或使用您的"],
  ["zh-CN:settings.votre_email_de_connexion_est_affiche_84123fc4", "您的登录电子邮件显示如下。您可以修改密码。"],
  ["es-ES:public.inr_apos_search_6cbfd855", "iNr’Search"],
  ["it-IT:public.inr_apos_search_6cbfd855", "iNr’Search"],
  ["de-DE:public.inr_apos_search_6cbfd855", "iNr’Search"],
  ["nl-NL:public.inr_apos_search_6cbfd855", "iNr’Search"],
  ["pt-PT:public.inr_apos_search_6cbfd855", "iNr’Search"],
  ["es-ES:settings.deconnecter_votre_page_inr_apos_search_c5a16ef8", "¿Desconectar tu página de iNr’Search?"],
  ["it-IT:settings.deconnecter_votre_page_inr_apos_search_c5a16ef8", "Disconnettere la pagina iNr’Search?"],
  ["de-DE:settings.deconnecter_votre_page_inr_apos_search_c5a16ef8", "Ihre iNr’Search-Seite trennen?"],
  ["nl-NL:settings.a_quoi_sert_inr_apos_search_c32318a6", "Waarvoor wordt iNr’Search gebruikt?"],
  ["nl-NL:settings.deconnecter_votre_page_inr_apos_search_c5a16ef8", "Verbinding met uw iNr’Search-pagina verbreken?"],
  ["pt-PT:settings.deconnecter_votre_page_inr_apos_search_c5a16ef8", "Desligar a sua página iNr’Search?"],
  ["es-ES:settings.inr_apos_search_transforme_automatiquement_les_99deb0af", "iNr’Search transforma automáticamente la información ya guardada en iNrCy en una página profesional pública, diseñada para los usuarios de Internet, Google, Bing y los motores de respuesta de IA."],
  ["it-IT:settings.inr_apos_search_transforme_automatiquement_les_99deb0af", "iNr’Search trasforma automaticamente le informazioni già salvate in iNrCy in una pagina professionale pubblica, progettata per gli utenti di Internet, Google, Bing e i motori di risposta IA."],
  ["de-DE:settings.inr_apos_search_transforme_automatiquement_les_99deb0af", "iNr’Search wandelt die bereits in iNrCy gespeicherten Informationen automatisch in eine öffentliche professionelle Seite um, die für Internetnutzer, Google, Bing und KI-Antwortmaschinen konzipiert ist."],
  ["nl-NL:settings.inr_apos_search_transforme_automatiquement_les_99deb0af", "iNr’Search zet de informatie die al in iNrCy is opgeslagen automatisch om in een openbare professionele pagina voor internetgebruikers, Google, Bing en AI-antwoordmachines."],
  ["pt-PT:settings.inr_apos_search_transforme_automatiquement_les_99deb0af", "O iNr’Search transforma automaticamente a informação já guardada no iNrCy numa página profissional pública, concebida para utilizadores da internet, Google, Bing e motores de resposta com IA."],
  ["es-ES:settings.page_publique_inr_apos_search_31dc348f", "Página pública de iNr’Search"],
  ["it-IT:settings.page_publique_inr_apos_search_31dc348f", "Pagina pubblica iNr’Search"],
  ["de-DE:settings.page_publique_inr_apos_search_31dc348f", "Öffentliche iNr’Search-Seite"],
  ["nl-NL:settings.page_publique_inr_apos_search_31dc348f", "Openbare iNr’Search-pagina"],
  ["pt-PT:settings.page_publique_inr_apos_search_31dc348f", "Página pública do iNr’Search"],
  ["it-IT:settings.booster_sur_10_canaux_inr_apos_38a43414", "Booster su 10 canali, pubblicazioni e statistiche di iNr’Agent, iNr’Badge incluso, iNr’Stats, cronologia iNr’Send e Reputazione."],
  ["de-DE:settings.booster_sur_10_canaux_inr_apos_38a43414", "Booster über 10 Kanäle, iNr’Agent-Veröffentlichungen + Statistiken, iNr’Badge inklusive, iNr’Stats, iNr’Send-Verlauf und Reputation."],
  ["nl-NL:settings.booster_sur_10_canaux_inr_apos_38a43414", "Booster op 10 kanalen, iNr’Agent-publicaties + statistieken, iNr’Badge inbegrepen, iNr’Stats, iNr’Send-geschiedenis en Reputatie."],
  ["pt-PT:settings.booster_sur_10_canaux_inr_apos_38a43414", "Booster em 10 canais, publicações e estatísticas do iNr’Agent, iNr’Badge incluído, iNr’Stats, histórico do iNr’Send e Reputação."],
]);

const ptReplacements = [
  ["Google Meu Negócio", "Perfil de Empresa no Google"],
  ["Biblioteca de Mídia", "Biblioteca multimédia"],
  ["biblioteca de mídia", "biblioteca multimédia"],
  ["Nenhuma mídia", "Nenhum conteúdo multimédia"],
  ["nenhuma mídia", "nenhum conteúdo multimédia"],
  ["Esta mídia", "Este conteúdo multimédia"],
  ["esta mídia", "este conteúdo multimédia"],
  ["A mídia", "O conteúdo multimédia"],
  ["a mídia", "o conteúdo multimédia"],
  ["As mídias", "Os conteúdos multimédia"],
  ["as mídias", "os conteúdos multimédia"],
  ["Mídias", "Conteúdos multimédia"],
  ["mídias", "conteúdos multimédia"],
  ["Mídia", "Conteúdo multimédia"],
  ["mídia", "conteúdo multimédia"],
  ["Multimídia", "Multimédia"],
  ["multimídia", "multimédia"],
  ["Arquivos", "Ficheiros"],
  ["arquivos", "ficheiros"],
  ["Arquivo", "Ficheiro"],
  ["arquivo", "ficheiro"],
  ["Usuários", "Utilizadores"],
  ["usuários", "utilizadores"],
  ["Usuário", "Utilizador"],
  ["usuário", "utilizador"],
  ["Celular", "Telemóvel"],
  ["celular", "telemóvel"],
  ["Tela", "Ecrã"],
  ["tela", "ecrã"],
  ["Contatos", "Contactos"],
  ["contatos", "contactos"],
  ["Contato", "Contacto"],
  ["contato", "contacto"],
  ["Equipe", "Equipa"],
  ["equipe", "equipa"],
  ["Faturamento", "Faturação"],
  ["faturamento", "faturação"],
  ["Postagens", "Publicações"],
  ["postagens", "publicações"],
  ["Postagem", "Publicação"],
  ["postagem", "publicação"],
  ["Exclusão", "Eliminação"],
  ["exclusão", "eliminação"],
  ["Excluir", "Eliminar"],
  ["excluir", "eliminar"],
  ["Excluídos", "Eliminados"],
  ["excluídos", "eliminados"],
  ["Excluídas", "Eliminadas"],
  ["excluídas", "eliminadas"],
  ["Excluído", "Eliminado"],
  ["excluído", "eliminado"],
  ["Excluída", "Eliminada"],
  ["excluída", "eliminada"],
  ["Salvar", "Guardar"],
  ["salvar", "guardar"],
  ["Salve", "Guarde"],
  ["salve", "guarde"],
  ["Salvos", "Guardados"],
  ["salvos", "guardados"],
  ["Salvas", "Guardadas"],
  ["salvas", "guardadas"],
  ["Salvo", "Guardado"],
  ["salvo", "guardado"],
  ["Salva", "Guardada"],
  ["salva", "guardada"],
  ["Baixar", "Transferir"],
  ["baixar", "transferir"],
  ["Gerenciar", "Gerir"],
  ["gerenciar", "gerir"],
  ["Gerenciamento", "Gestão"],
  ["gerenciamento", "gestão"],
  ["Buscar", "Procurar"],
  ["buscar", "procurar"],
  ["Busca", "Pesquisa"],
  ["busca", "pesquisa"],
  ["Compartilhar", "Partilhar"],
  ["compartilhar", "partilhar"],
  ["Compartilhe", "Partilhe"],
  ["compartilhe", "partilhe"],
  ["Registro", "Registo"],
  ["registro", "registo"],
  ["Carregando", "A carregar"],
  ["carregando", "a carregar"],
  ["Atualizando", "A atualizar"],
  ["atualizando", "a atualizar"],
  ["Processando", "A processar"],
  ["processando", "a processar"],
  ["Preparando", "A preparar"],
  ["preparando", "a preparar"],
  ["Enviando", "A enviar"],
  ["enviando", "a enviar"],
  ["Gerando", "A gerar"],
  ["gerando", "a gerar"],
  ["Planejados", "Planeados"],
  ["planejados", "planeados"],
  ["Planejadas", "Planeadas"],
  ["planejadas", "planeadas"],
  ["Planejado", "Planeado"],
  ["planejado", "planeado"],
  ["Planejada", "Planeada"],
  ["planejada", "planeada"],
  ["para você", "para si"],
  ["com você", "consigo"],
  ["de você", "de si"],
  ["Conosco", "Connosco"],
  ["conosco", "connosco"],
  ["Aplicativo", "Aplicação"],
  ["aplicativo", "aplicação"],
  ["Banco de dados", "Base de dados"],
  ["banco de dados", "base de dados"],
  ["Gerencie", "Gira"],
  ["gerencie", "gira"],
  ["Gerenciam", "Gerem"],
  ["gerenciam", "gerem"],
  ["Gerencia", "Gere"],
  ["gerencia", "gere"],
  ["Colete", "Recolha"],
  ["colete", "recolha"],
  ["Agendador", "Programador"],
  ["agendador", "programador"],
  ["Agendamento", "Programação"],
  ["agendamento", "programação"],
  ["Agendados", "Programados"],
  ["agendados", "programados"],
  ["Agendadas", "Programadas"],
  ["agendadas", "programadas"],
  ["Agendado", "Programado"],
  ["agendado", "programado"],
  ["Agendada", "Programada"],
  ["agendada", "programada"],
  ["Agendar", "Programar"],
  ["agendar", "programar"],
  ["Suporte", "Apoio"],
  ["suporte", "apoio"],
  ["Atendeu", "Correspondeu"],
  ["atendeu", "correspondeu"],
  ["Melhorando", "A melhorar"],
  ["melhorando", "a melhorar"],
  ["Conecte", "Ligue"],
  ["conecte", "ligue"],
  ["Conectados", "Ligados"],
  ["conectados", "ligados"],
  ["Conectadas", "Ligadas"],
  ["conectadas", "ligadas"],
  ["Conectado", "Ligado"],
  ["conectado", "ligado"],
  ["Conectada", "Ligada"],
  ["conectada", "ligada"],
  ["Contábeis", "Contabilísticos"],
  ["contábeis", "contabilísticos"],
];

function posteditPortuguese(value) {
  let output = value;
  for (const [source, target] of ptReplacements) output = output.replaceAll(source, target);
  output = output.replace(/^Você\s+([\p{Ll}])/u, (_, letter) => letter.toLocaleUpperCase("pt-PT"));
  output = output.replace(/\bvocê\s+/giu, "");
  // Repair values produced by the former non-idempotent possessive rule.
  output = output
    .replace(/(?:à\s+)+(?:a\s+)+sua\b/giu, "a sua")
    .replace(/(?:às\s+)+(?:as\s+)+suas\b/giu, "às suas")
    .replace(/(?:ao\s+)+(?:o\s+)+seu\b/giu, "ao seu")
    .replace(/(?:aos\s+)+(?:os\s+)+seus\b/giu, "aos seus")
    .replace(/(^|[\s(])a\s+a\s+sua\b/giu, "$1a sua")
    .replace(/(^|[\s(])as\s+as\s+suas\b/giu, "$1as suas")
    .replace(/(^|[\s(])o\s+o\s+seu\b/giu, "$1o seu")
    .replace(/(^|[\s(])os\s+os\s+seus\b/giu, "$1os seus");
  const contractions = [
    [/\bde seu\b/giu, "do seu"], [/\bde sua\b/giu, "da sua"], [/\bde seus\b/giu, "dos seus"], [/\bde suas\b/giu, "das suas"],
    [/\bem seu\b/giu, "no seu"], [/\bem sua\b/giu, "na sua"], [/\bem seus\b/giu, "nos seus"], [/\bem suas\b/giu, "nas suas"],
    [/\bpor seu\b/giu, "pelo seu"], [/\bpor sua\b/giu, "pela sua"], [/\bpor seus\b/giu, "pelos seus"], [/\bpor suas\b/giu, "pelas suas"],
  ];
  for (const [pattern, replacement] of contractions) output = output.replace(pattern, replacement);
  const possessives = [["seus", "os seus"], ["suas", "as suas"], ["seu", "o seu"], ["sua", "a sua"]];
  for (const [word, replacement] of possessives) {
    output = output.replace(new RegExp(`\\b${word}\\b`, "giu"), (match, offset, input) => {
      const prefix = input.slice(0, offset).toLocaleLowerCase("pt-PT");
      if (/(?:^|[\s(])(?:o|a|os|as|do|da|dos|das|no|na|nos|nas|ao|aos|à|às|pelo|pela|pelos|pelas)\s$/u.test(prefix)) return match;
      const next = `${replacement} ${match.toLocaleLowerCase("pt-PT")}`.replace(`${replacement} ${word}`, replacement);
      return match[0] === match[0].toLocaleUpperCase("pt-PT")
        ? next[0].toLocaleUpperCase("pt-PT") + next.slice(1)
        : next;
    });
  }
  return output.replace(/ {2,}/g, " ").trim();
}

function posteditEnglish(value) {
  let output = value;
  for (const [pattern, replacement] of englishReplacements) output = output.replace(pattern, replacement);
  return output;
}

function posteditSpanish(key, value) {
  let output = value;
  for (const [pattern, replacement] of spanishReplacements) output = output.replace(pattern, replacement);
  if (/(?:vous|votre|vos)/u.test(key)) {
    output = output
      .replace(/\bcon usted\b/giu, "contigo")
      .replace(/\bpara usted\b/giu, "para ti")
      .replace(/\ba usted\b/giu, "a ti")
      .replace(/\bUsted\b/g, "Tú")
      .replace(/\busted\b/g, "tú")
      .replace(/\bSus\b/g, "Tus")
      .replace(/\bsus\b/g, "tus")
      .replace(/\bSu\b/g, "Tu")
      .replace(/\bsu\b/g, "tu");
  }
  return output;
}

function posteditDutch(value) {
  let output = value;
  for (const [pattern, replacement] of dutchReplacements) output = output.replace(pattern, replacement);
  return output;
}

function normalizeBrands(value) {
  let output = value;
  for (const [pattern, replacement] of brandReplacements) output = output.replace(pattern, replacement);
  return output.replace(/\b((?:app\.)?)iNrCy\.com\b/giu, (_match, prefix) => `${prefix}inrcy.com`);
}

// Catalog values are rendered as React text, not injected as HTML. Decode
// entities that slipped in from the legacy/Google translation pipeline so
// users see real punctuation, spacing and channel arrows (e.g. iNr’Send, <, >).
function decodeHtmlEntities(value) {
  return value
    // next-intl returns plain React text: an HTML entity would therefore be
    // displayed literally. Keep the non-breaking behaviour with U+00A0.
    .replace(/&nbsp;/giu, "\u00a0")
    .replace(/&egrave;/giu, "è")
    .replace(/&apos;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&")
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (_match, token) => {
      const codePoint = token[0].toLocaleLowerCase() === "x"
        ? Number.parseInt(token.slice(1), 16)
        : Number.parseInt(token, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    });
}

function posteditValue(locale, namespace, key, value) {
  let output = normalizeBrands(value).replace(leakedLanguageLabelSuffix, "");
  for (const [pattern, replacement] of localeTermReplacements.get(locale) ?? []) output = output.replace(pattern, replacement);
  if (locale === "pt-PT") output = posteditPortuguese(output);
  if (locale === "en-GB") output = posteditEnglish(output);
  if (locale === "es-ES") output = posteditSpanish(key, output);
  if (locale === "nl-NL") output = posteditDutch(output);
  const edited = validationOverrides.get(`${locale}:${namespace}.${key}`)
    ?? localeOverrides.get(`${locale}:${namespace}.${key}`)
    ?? (locale === "en-GB" ? englishOverrides.get(`${namespace}.${key}`) : undefined)
    ?? output;
  return normalizeBrands(decodeHtmlEntities(normalizeModuleTerminology(locale, namespace, key, edited)));
}

function restorePlaceholderWhitespace(source, translation) {
  let output = translation;
  const tokens = [...new Set(source.match(/\{value\d+\}/g) ?? [])];
  for (const token of tokens) {
    const sourceIndex = source.indexOf(token);
    let targetIndex = output.indexOf(token);
    if (sourceIndex < 0 || targetIndex < 0) continue;
    // Keep placeholders separated from words when the source requires it, but
    // never copy French punctuation into another language. Punctuation order
    // and spacing are part of the translated sentence itself.
    const sourceHasSpaceBefore = sourceIndex > 0 && /\s/u.test(source[sourceIndex - 1]);
    const sourceHasSpaceAfter = sourceIndex + token.length < source.length && /\s/u.test(source[sourceIndex + token.length]);
    if (sourceHasSpaceBefore && targetIndex > 0 && /[\p{L}\p{N}]/u.test(output[targetIndex - 1])) {
      output = `${output.slice(0, targetIndex)} ${output.slice(targetIndex)}`;
      targetIndex += 1;
    }
    if (sourceHasSpaceAfter && targetIndex + token.length < output.length && /[\p{L}\p{N}]/u.test(output[targetIndex + token.length])) {
      output = `${output.slice(0, targetIndex + token.length)} ${output.slice(targetIndex + token.length)}`;
    }
  }
  return output;
}

function transformCatalog(catalog, sourceCatalog, transform, prefix = "") {
  if (typeof catalog === "string") return transform(catalog, sourceCatalog, prefix);
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return catalog;
  return Object.fromEntries(Object.entries(catalog).map(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    const sourceValue = sourceCatalog && typeof sourceCatalog === "object" ? sourceCatalog[key] : undefined;
    return [key, transformCatalog(value, sourceValue, transform, nextPrefix)];
  }));
}

function countStringChanges(before, after) {
  if (typeof before === "string" && typeof after === "string") return before === after ? 0 : 1;
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return 0;
  return Object.keys(after).reduce((total, key) => total + countStringChanges(before[key], after[key]), 0);
}

function changedStringPaths(before, after, prefix = "", output = []) {
  if (typeof before === "string" && typeof after === "string") {
    if (before !== after) output.push(prefix);
    return output;
  }
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return output;
  for (const key of Object.keys(after)) changedStringPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key, output);
  return output;
}

const localeChanges = new Map(selectedLocales.map((locale) => [locale, 0]));
for (const namespace of namespaces) {
  const sourceFile = path.join(root, "messages", "fr-FR", `${namespace}.json`);
  const sourceBefore = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  const sourceAfter = transformCatalog(sourceBefore, sourceBefore, (value, _source, key) => posteditValue("fr-FR", namespace, key, value));
  if (selectedLocales.includes("fr-FR")) {
    const sourceChanges = countStringChanges(sourceBefore, sourceAfter);
    if (verbose && sourceChanges) console.log(`fr-FR/${namespace}: ${changedStringPaths(sourceBefore, sourceAfter).join(", ")}`);
    localeChanges.set("fr-FR", localeChanges.get("fr-FR") + sourceChanges);
    if (write && sourceChanges) fs.writeFileSync(sourceFile, `${JSON.stringify(sourceAfter, null, 2)}\n`, "utf8");
  }

  for (const locale of selectedLocales.filter((candidate) => candidate !== "fr-FR")) {
    const file = path.join(root, "messages", locale, `${namespace}.json`);
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    const after = transformCatalog(before, sourceAfter, (value, source, key) => {
      const edited = posteditValue(locale, namespace, key, value);
      const lineSafe = typeof source === "string" && !source.includes("\n")
        ? (edited === "\u00a0" ? edited : edited.replace(/\s*[\r\n]+\s*/gu, " ").trim())
        : edited;
      return typeof source === "string" ? restorePlaceholderWhitespace(source, lineSafe) : lineSafe;
    });
    const catalogChanges = countStringChanges(before, after);
    if (verbose && catalogChanges) console.log(`${locale}/${namespace}: ${changedStringPaths(before, after).join(", ")}`);
    localeChanges.set(locale, localeChanges.get(locale) + catalogChanges);
    if (write && catalogChanges) fs.writeFileSync(file, `${JSON.stringify(after, null, 2)}\n`, "utf8");
  }
}

const changes = [...localeChanges.values()].reduce((total, count) => total + count, 0);
for (const [locale, count] of localeChanges) console.log(`${locale}: ${count} retouche(s)`);
if (!write && changes) {
  console.error(`${changes} retouche(s) linguistique(s) à appliquer. Exécutez avec --write.`);
  process.exitCode = 1;
} else {
  console.log(`${changes} retouche(s) linguistique(s) ${write ? "appliquée(s)" : "en attente"}.`);
}
