import type {
  InrAgentActionStatus,
  InrAgentActionType,
  InrAgentTargetTool,
} from "@/lib/inrAgentActions";
import type { AutomationKey, ChannelKey } from "./agent.types";

export type AgentTranslator = (
  key: string,
  values?: Record<string, string | number | boolean>,
) => string;

const AUTOMATION_TITLE_KEYS: Record<AutomationKey, string> = {
  publish: "publier_34e6b19e",
  grow: "propulser_2de43942",
  loyalty: "fideliser_8fa9e4f1",
  stats: "statistiques_fdce305a",
};

const AUTOMATION_SHORT_TITLE_KEYS: Record<AutomationKey, string> = {
  ...AUTOMATION_TITLE_KEYS,
  stats: "stats_be763e9a",
};

const AUTOMATION_SETTINGS_TITLE_KEYS: Record<AutomationKey, string> = {
  publish: "reglages_publier_97e7e222",
  grow: "reglages_propulser_773bdc52",
  loyalty: "reglages_fideliser_8e71b353",
  stats: "reglages_statistiques_4eba336a",
};

const AUTOMATION_STEP_KEYS: Record<AutomationKey, readonly [string, string, string]> = {
  publish: ["agent_step_publish_analyze", "agent_step_publish_prepare", "agent_step_publish_validate"],
  grow: ["agent_step_grow_identify", "agent_step_grow_prepare", "agent_step_campaign_validate"],
  loyalty: ["agent_step_loyalty_analyze", "agent_step_loyalty_prepare", "agent_step_campaign_validate"],
  stats: ["agent_step_stats_analyze", "agent_step_stats_pdf", "agent_step_stats_send"],
};

const CHANNEL_LABEL_KEYS: Partial<Record<ChannelKey, string>> = {
  siteInrcy: "site_inrcy_57016d6f",
  siteWeb: "site_web_7e78af33",
  mails: "mails_8d79d3a8",
};

const CHANNEL_BRAND_LABELS: Record<ChannelKey, string> = {
  siteInrcy: "Site iNrCy",
  siteWeb: "Site Web",
  gmb: "Google Business",
  inrSearch: "iNr'Search",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  mails: "Mails",
};

const WEEKDAY_KEYS: Record<string, string> = {
  Lundi: "weekday_monday",
  Mardi: "weekday_tuesday",
  Mercredi: "weekday_wednesday",
  Jeudi: "weekday_thursday",
  Vendredi: "weekday_friday",
  Samedi: "weekday_saturday",
  Dimanche: "weekday_sunday",
};

const FREQUENCY_KEYS: Record<string, string> = {
  "1 fois par semaine": "1_fois_par_semaine_3753e32e",
  "2 fois par semaine": "2_fois_par_semaine_d8dee617",
  "2 fois par mois": "2_fois_par_mois_a7a7c6f7",
  "1 fois par mois": "1_fois_par_mois_a9697a49",
  "Campagne ponctuelle": "campagne_ponctuelle_29abfc34",
  "Chaque semaine": "chaque_semaine_8dae7696",
  "Tous les 15 jours": "tous_les_15_jours_2348a7d4",
  "Chaque mois": "chaque_mois_f6d56095",
  "Chaque trimestre": "chaque_trimestre_03fd626e",
};

const VALIDATION_KEYS: Record<string, string> = {
  "Validation obligatoire avant publication": "validation_obligatoire_avant_publication_1f648285",
  "Validation obligatoire avant envoi": "validation_obligatoire_avant_envoi_1bab8d93",
  "Préparer en brouillon": "preparer_en_brouillon_ca2aeaca",
  "Notification avant validation": "notification_avant_validation_b7d5b991",
  "Bilan automatique sans validation": "bilan_automatique_sans_validation_a952bb38",
};

const THEME_KEYS: Record<string, string> = {
  Conseils: "theme_advice",
  Réalisations: "theme_achievements",
  Offres: "theme_offers",
  Actualités: "theme_news",
  Valoriser: "theme_promote",
  Récolter: "theme_collect",
  Offrir: "theme_offer",
  Informer: "theme_inform",
  Enquêter: "theme_survey",
  Suivre: "theme_follow_up",
  "Vue globale": "stats_overview",
};

const SOURCE_KEYS: Record<string, string> = {
  "Contenus déjà publiés + canaux Booster / Publier connectés": "agent_source_publish",
  "Publications déjà faites + rubriques Propulser": "agent_source_grow",
  "Publications déjà faites + rubriques Fidéliser": "agent_source_loyalty",
  "Rubriques iNr’Stats connectées": "agent_source_stats",
};

const SCHEDULE_TYPE_KEYS: Record<string, string> = {
  Publication: "publication_e00441c4",
  Propulsion: "propulsion_e8ec111d",
  Fidélisation: "fidelisation_e3e05198",
  Statistiques: "statistiques_fdce305a",
  Mail: "mail_92379cbb",
  Action: "action_97c89a4d",
};

const ACTION_TYPE_KEYS: Record<InrAgentActionType, string> = {
  publication: "action_type_publication",
  campaign: "action_type_campaign",
  stats_report: "action_type_stats_report",
  mailing: "action_type_mailing",
  review_request: "action_type_review_request",
  loyalty: "fidelisation_e3e05198",
  custom: "action_type_custom",
};

const TOOL_KEYS: Partial<Record<InrAgentTargetTool, string>> = {
  booster: "booster_8e4caec0",
  mails: "mails_8d79d3a8",
  propulser: "propulser_2de43942",
  fideliser: "fideliser_8fa9e4f1",
  inrstats: "inr_stats_323b32a2",
  agent: "inr_agent_88080b90",
};

const ACTION_STATUS_KEYS: Record<InrAgentActionStatus, string> = {
  prepared: "action_status_prepared",
  pending_validation: "action_status_pending_validation",
  pending: "action_status_pending_validation",
  draft: "action_status_draft",
  scheduled: "action_status_scheduled",
  validated: "action_status_validated",
  refused: "action_status_refused",
  executing: "action_status_executing",
  completed: "action_status_completed",
  failed: "erreur_ab546c23",
  cancelled: "action_status_cancelled",
};

export function agentAutomationTitle(key: AutomationKey, t: AgentTranslator, short = false) {
  return t((short ? AUTOMATION_SHORT_TITLE_KEYS : AUTOMATION_TITLE_KEYS)[key]);
}

export function agentAutomationSettingsTitle(key: AutomationKey, t: AgentTranslator) {
  return t(AUTOMATION_SETTINGS_TITLE_KEYS[key]);
}

export function agentAutomationStep(key: AutomationKey, index: number, t: AgentTranslator) {
  return t(AUTOMATION_STEP_KEYS[key][index] || AUTOMATION_STEP_KEYS[key][0]);
}

export function agentChannelLabel(channel: ChannelKey | string | null | undefined, t: AgentTranslator) {
  const key = String(channel || "") as ChannelKey;
  const messageKey = CHANNEL_LABEL_KEYS[key];
  return messageKey ? t(messageKey) : CHANNEL_BRAND_LABELS[key] || String(channel || "");
}

export function agentWeekdayLabel(day: string, t: AgentTranslator) {
  const key = WEEKDAY_KEYS[day];
  return key ? t(key) : day;
}

export function agentFrequencyLabel(frequency: string, t: AgentTranslator) {
  const key = FREQUENCY_KEYS[frequency];
  return key ? t(key) : frequency;
}

export function agentValidationLabel(validation: string, t: AgentTranslator) {
  const key = VALIDATION_KEYS[validation];
  return key ? t(key) : validation;
}

export function agentThemeLabel(theme: string, t: AgentTranslator) {
  const key = THEME_KEYS[theme];
  return key ? t(key) : theme;
}

export function agentThemeListLabel(themes: string[], t: AgentTranslator, locale: string) {
  const labels = themes.map((theme) => agentThemeLabel(theme, t)).filter(Boolean);
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(labels);
}

export function agentSourceLabel(source: string, t: AgentTranslator) {
  const key = SOURCE_KEYS[source];
  return key ? t(key) : source;
}

export function agentConnectedChannelMessage(key: AutomationKey, t: AgentTranslator) {
  if (key === "grow") return t("aucune_boite_mail_connectee_connecte_une_89c1392a");
  if (key === "loyalty") return t("aucune_boite_mail_connectee_connecte_une_e8166a23");
  if (key === "publish") return t("aucun_canal_de_publication_connecte_connecte_dfc465aa");
  return t("aucun_canal_connecte_pour_cette_automatisation_50eccca5");
}

export function agentScheduleTypeLabel(label: string, t: AgentTranslator) {
  const key = SCHEDULE_TYPE_KEYS[label];
  return key ? t(key) : label;
}

export function agentScheduleChannelLabel(label: string, t: AgentTranslator) {
  if (label === "Bilan") return t("bilan_a80c4623");
  if (label === "Publication") return t("publication_e00441c4");
  if (label === "Mails") return t("mails_8d79d3a8");
  const channel = (Object.keys(CHANNEL_BRAND_LABELS) as ChannelKey[]).find(
    (candidate) => CHANNEL_BRAND_LABELS[candidate] === label,
  );
  return channel ? agentChannelLabel(channel, t) : label;
}

export function agentScheduledStatusLabel(status: string, t: AgentTranslator) {
  if (status === "running") return t("en_cours_bc9b533a");
  if (status === "done") return t("execute_4822acc6");
  if (status === "failed") return t("echec_0ff45fa6");
  if (status === "cancelled") return t("annule_34cd87cc");
  return t("programme_bab7d71e");
}

export function agentActionTypeLabel(type: InrAgentActionType, t: AgentTranslator) {
  return t(ACTION_TYPE_KEYS[type]);
}

export function agentToolLabel(tool: InrAgentTargetTool, t: AgentTranslator) {
  const key = TOOL_KEYS[tool];
  return key ? t(key) : tool;
}

export function agentActionStatusLabel(status: InrAgentActionStatus, t: AgentTranslator) {
  return t(ACTION_STATUS_KEYS[status]);
}

export function agentContentKindLabel(kind: "video" | "image" | "file" | "none", hasText: boolean, t: AgentTranslator) {
  if (kind === "video") return t(hasText ? "texte_video_99d71f4f" : "video_seule_537a0a69");
  if (kind === "image") return t(hasText ? "texte_photo_s_8e199672" : "photo_s_seule_s_683e318c");
  if (kind === "file") return t(hasText ? "texte_media_c1574573" : "media_seul_7577b2da");
  return hasText ? t("texte_seul_24210789") : "—";
}

export function agentMediaStatusLabel(status: string, t: AgentTranslator) {
  if (status === "Bloquant") return t("bloquant_c05c5176");
  if (status === "Prêt") return t("pret_c5e3c29f");
  if (status === "À vérifier") return t("a_verifier_8f5f7255");
  return status;
}

export function agentProgressLabel(label: string, t: AgentTranslator) {
  const keys: Record<string, string> = {
    "Bilan envoyé": "bilan_envoye_ad83545d",
    "Finalisation + envoi mail": "finalisation_envoi_mail_313cdc6f",
    "Stockage du bilan": "stockage_du_bilan_108a0fe8",
    "Création du PDF": "creation_du_pdf_413be5b6",
    "Analyse iNr’Agent": "analyse_inr_agent_503a6b60",
    Stats: "stats_be763e9a",
    "Publication prête": "publication_prete_64babf2f",
    "Enregistrement dans iNr’Agent": "enregistrement_dans_inr_agent_826c3ef4",
    "Adaptation par canal": "adaptation_par_canal_e632a77a",
    "Préparation de la campagne": "preparation_de_la_campagne_8219678c",
    "Génération IA": "generation_ia_9dd2b7e5",
    "Analyse de l’activité": "analyse_de_l_activite_9b3b620a",
    Initialisation: "initialisation_f1679691",
  };
  const key = keys[label];
  return key ? t(key) : label;
}
