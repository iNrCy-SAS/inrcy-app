import type { DashboardEdition } from "@/lib/dashboardEdition";

import {
  GPS_SECTIONS,
  type GpsArticleSource,
  type GpsMessageKey,
  type GpsSectionSource,
} from "./noticeContent";

const PREMIUM_ONLY_SECTION_IDS = new Set([
  "propulser",
  "fideliser",
  "crm",
  "agenda",
]);

const FOUNDER_ONLY_SECTION_IDS = new Set(["documents"]);

type GpsArticleOverride = Partial<Omit<GpsArticleSource, "id">>;

const STANDARD_SECTION_DESCRIPTIONS: Record<string, GpsMessageKey> = {
  canaux: "relier_les_10_destinations_de_publication_e63b94e4",
  inragent: "programmer_les_publications_booster_et_recevoir_2e05ae9b",
  inrsend: "retrouver_l_historique_et_le_resultat_06733a8a",
};

const STANDARD_ARTICLE_OVERRIDES: Record<string, GpsArticleOverride> = {
  "demarrer-express": {
    intro:
      "avant_de_publier_ou_d_analyser_d71524fb",
    pitfalls: [
      "donner_les_bonnes_informations_a_l_ba44340c",
      "une_ia_bien_configuree_produit_des_05c34800",
    ],
  },
  "demarrer-rangement": {
    intro:
      "chaque_donnee_a_un_seul_emplacement_357d476c",
    steps: [
      "utiliser_mon_profil_pour_l_identite_ad8f2074",
      "utiliser_mon_activite_pour_le_metier_9afc1af8",
      "ouvrir_reglages_du_generateur_pour_le_98a1bc70",
    ],
    checks: [
      "les_informations_deja_enregistrees_sont_conserve_20d11de3",
      "les_horaires_publics_de_mon_activite_33aa1e9a",
      "les_informations_indispensables_a_booster_et_25d1d45d",
    ],
    links: [
      { label: "mon_profil_faa6d321", href: "/dashboard?panel=profil&panelSource=gps" },
      { label: "mon_activite_7732bf80", href: "/dashboard?panel=profil&profileSection=activity&panelSource=gps" },
    ],
  },
  "canaux-express": {
    intro:
      "l_edition_standard_reunit_10_destinations_fc40dfbd",
    steps: [
      "ouvrir_les_canaux_choisir_la_bulle_7694d398",
      "relier_les_destinations_utiles_site_inrcy_483ab0d6",
      "configurer_inr_badge_inclus_en_bonus_a94257d1",
      "verifier_l_etat_de_chaque_bulle_e1a5ba41",
    ],
    pitfalls: [
      "commencer_par_les_canaux_sur_lesquels_1684463c",
      "un_canal_expire_doit_etre_reconnecte_f7cbb41a",
    ],
  },
  "inragent-express": {
    intro:
      "avec_standard_inr_agent_accompagne_deux_d447518e",
    steps: [
      "ouvrir_inr_agent_depuis_le_header_8b9bfb22",
      "choisir_publications_pour_preparer_ou_programmer_c835edba",
      "choisir_statistiques_pour_preparer_un_bilan_895231ef",
      "relire_l_apercu_puis_valider_ou_f3f66889",
    ],
    checks: [
      "votre_activite_votre_profil_et_votre_cd0c8c24",
      "les_canaux_utiles_a_booster_sont_0da9b7bc",
      "rien_n_est_publie_ou_envoye_ecbfb256",
      "les_rubriques_propulser_et_fideliser_necessitent_8d77ba5d",
    ],
    pitfalls: [
      "inr_agent_ne_remplace_pas_votre_97699244",
      "plus_vos_informations_et_vos_canaux_df8a26dc",
      "objectif_garder_une_publication_reguliere_et_ad6a6ba1",
    ],
  },
  "generateur-express": {
    pitfalls: [
      "le_generateur_n_est_pas_un_c1e2b8e2",
      "plus_le_pro_publie_et_utilise_09617c8c",
      "les_unites_d_inertie_sont_aussi_6b3e941a",
    ],
  },
  "inrstats-express": {
    intro:
      "inr_stats_traduit_les_donnees_des_5eb14794",
    steps: [
      "connecter_les_canaux_utiles_pour_laisser_2691c29f",
      "lire_les_resultats_par_canal_google_2f5773a6",
      "reperer_ce_qui_fonctionne_appels_clics_74268975",
      "utiliser_ensuite_booster_ou_demander_un_69aff869",
    ],
    links: [
      { label: "ouvrir_inr_stats_48397dcd", href: "/dashboard/stats" },
      { label: "ouvrir_les_canaux_9322102a", href: "/dashboard" },
      { label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" },
    ],
  },
  "booster-express": {
    steps: [
      "cliquer_sur_publier_maintenant_pour_ouvrir_20ae1cfb",
      "preparer_un_contenu_chantier_nouveaute_conseil_6b5ac3a7",
      "choisir_parmi_les_10_destinations_standard_b90526d3",
      "verifier_le_texte_le_media_le_652d37d4",
      "consulter_ensuite_le_bilan_booster_pour_7610c5d7",
    ],
  },
  "booster-bilan": {
    links: [
      { label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" },
      { label: "voir_les_publications_5eb7850c", href: "/dashboard/mails?folder=publications&boxView=sent" },
    ],
  },
  "inrsend-express": {
    title: "retrouver_toutes_les_publications_cb35879c",
    keywords: ["inrsend_73a8031f", "publications_1a4f2b10", "historique_1b0efe6e", "booster_73a103c5", "resultat_b3995030", "canaux_22467b10", "reutiliser_47058479"],
    goal: "publications_retrouvees_a72c78fa",
    intro:
      "avec_standard_inr_send_conserve_la_7cc5afc7",
    steps: [
      "ouvrir_inr_send_depuis_la_boite_3b8c7859",
      "consulter_la_colonne_publications_pour_retrouver_d691e14d",
      "ouvrir_le_detail_pour_distinguer_les_8f114225",
      "reutiliser_une_publication_existante_lorsque_son_c3746128",
    ],
    checks: [
      "la_publication_apparait_bien_dans_l_ff4e0cb7",
      "les_details_indiquent_les_reussites_erreurs_09f1a4b2",
      "les_liens_publics_sont_proposes_lorsque_e7777671",
    ],
    pitfalls: [
      "en_standard_inr_send_est_volontairement_898cfcb3",
      "les_campagnes_mails_et_leurs_autres_c3b0a6fc",
    ],
    links: [
      { label: "voir_les_publications_5eb7850c", href: "/dashboard/mails?folder=publications&boxView=sent" },
    ],
  },
  "abonnement-express": {
    intro:
      "la_periode_d_essai_et_les_890d06b9",
    steps: [
      "utiliser_la_periode_d_essai_pour_ce37df76",
      "consulter_mon_abonnement_pour_verifier_l_61e64e4b",
      "continuer_avec_standard_ou_contacter_l_7cf3af68",
      "aucun_passage_a_premium_ne_se_5dc34e13",
    ],
  },
  "problemes-express": {
    steps: [
      "pas_de_donnees_verifier_qu_au_eb93c267",
      "publication_refusee_ouvrir_le_detail_du_05e539b1",
      "canal_indisponible_reconnecter_le_compte_avant_8cc2c7bf",
      "image_non_visible_reduire_le_poids_48c7b8d9",
    ],
  },
  "problemes-mobile-reseau": {
    links: [
      { label: "voir_les_publications_5eb7850c", href: "/dashboard/mails?folder=publications&boxView=sent" },
    ],
  },
  "conseils-express": {
    steps: [
      "publier_une_fois_par_semaine_une_bd2cc453",
      "piloter_les_avis_depuis_reputation_et_b8fd5cd0",
      "mettre_a_jour_les_informations_visibles_090d3b33",
      "lire_regulierement_inr_stats_et_le_e2cdcacb",
    ],
    links: [
      { label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" },
      { label: "gerer_les_avis_0b0df366", href: "/dashboard/e-reputation" },
      { label: "ouvrir_inr_stats_48397dcd", href: "/dashboard/stats" },
    ],
  },
};

const NON_FOUNDER_ARTICLE_OVERRIDES: Record<string, GpsArticleOverride> = {
  "demarrer-rangement": STANDARD_ARTICLE_OVERRIDES["demarrer-rangement"],
  "inrsend-express": {
    intro: "inr_send_non_founder_intro_2026",
    steps: [
      "commencer_par_connecter_les_boites_mail_5706ea9d",
      "creer_une_signature_inr_send_propre_8f49b1aa",
      "inr_send_non_founder_history_2026",
      "reutiliser_modifier_supprimer_ou_revoir_une_21af0177",
    ],
    pitfalls: [
      "inr_send_non_founder_base_2026",
      "la_banque_de_communication_permet_de_b7a8c19b",
    ],
  },
};

export function isGpsSectionPremiumOnly(sectionId: string): boolean {
  return PREMIUM_ONLY_SECTION_IDS.has(sectionId);
}

function applyStandardArticleOverride(article: GpsArticleSource): GpsArticleSource {
  const override = STANDARD_ARTICLE_OVERRIDES[article.id];
  return override ? { ...article, ...override } : article;
}

function applyNonFounderArticleOverride(article: GpsArticleSource): GpsArticleSource {
  const override = NON_FOUNDER_ARTICLE_OVERRIDES[article.id];
  return override ? { ...article, ...override } : article;
}

export function getGpsSectionsForEdition(edition: DashboardEdition): GpsSectionSource[] {
  if (edition === "founder") return GPS_SECTIONS;

  return GPS_SECTIONS
    .filter((section) => !FOUNDER_ONLY_SECTION_IDS.has(section.id))
    .map((section) => ({
      ...section,
      description:
        edition === "standard"
          ? STANDARD_SECTION_DESCRIPTIONS[section.id] ?? section.description
          : section.description,
      articles: section.articles
        .map(applyNonFounderArticleOverride)
        .map((article) => edition === "standard" ? applyStandardArticleOverride(article) : article),
    }));
}
