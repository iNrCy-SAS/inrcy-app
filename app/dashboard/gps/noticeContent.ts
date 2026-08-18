import type gpsFrenchCatalog from "@/messages/fr-FR/gps.json";

export type GpsMessageKey = keyof typeof gpsFrenchCatalog;

type GpsFaqShape<Text extends string> = { q: Text; a: Text };

type GpsArticleShape<Text extends string> = {
  id: string;
  title: Text;
  keywords: Text[];
  intro: Text;
  steps: Text[];
  checks?: Text[];
  pitfalls?: Text[];
  faq?: GpsFaqShape<Text>[];
  links?: Array<{ label: Text; href: string }>;
  duration?: Text;
  goal?: Text;
};

type GpsSectionShape<Text extends string, Article> = {
  id: string;
  title: Text;
  emoji: string;
  description: Text;
  articles: Article[];
};

export type GpsFaq = GpsFaqShape<string>;
export type GpsArticle = GpsArticleShape<string>;
export type GpsSection = GpsSectionShape<string, GpsArticle>;
export type GpsArticleSource = GpsArticleShape<GpsMessageKey>;
export type GpsSectionSource = GpsSectionShape<GpsMessageKey, GpsArticleSource>;

export const GPS_SECTIONS: GpsSectionSource[] = [
  {
    id: "demarrer",
    title: "demarrer_f40d1642",
    emoji: "🚀",
    description: "la_base_renseigner_l_entreprise_pour_80d5933c",
    articles: [
      {
        id: "demarrer-express",
        title: "preparer_inrcy_correctement_d4e0d731",
        keywords: ["demarrer_89394c01", "premiere_fois_26b2be94", "mon_activite_6c9c1750", "mon_profil_d592bf4e", "configuration_ia_c88868d8", "reglages_du_generateur_52677517", "panier_moyen_5471fcdd", "taux_de_transformation_7bfc4dfa"],
        duration: "5_min_b45ebd80",
        goal: "ia_utile_13a1f789",
        intro:
          "avant_de_publier_ou_d_envoyer_622660b3",
        steps: [
          "remplir_mon_activite_metier_prestations_speciali_47667b2a",
          "completer_mon_profil_identite_coordonnees_nom_98951160",
          "personnaliser_configuration_ia_ton_style_facon_2fcb8d45",
          "ajuster_si_necessaire_le_panier_moyen_4544cbeb",
        ],
        checks: [
          "mon_activite_est_precise_et_a_08276404",
          "mon_profil_contient_les_bonnes_coordonnees_72b49b03",
          "configuration_ia_reflete_bien_le_style_b90fdac8",
          "les_reglages_du_generateur_correspondent_a_d8b3881a",
        ],
        pitfalls: [
          "donner_les_bonnes_informations_a_l_c83ea9d9",
          "une_ia_bien_configuree_produit_des_05c34800",
        ],
        links: [
          { label: "ouvrir_mon_activite_2786763e", href: "/dashboard?panel=activite&panelSource=gps" },
          { label: "ouvrir_mon_profil_15991b97", href: "/dashboard?panel=profil&panelSource=gps" },
          { label: "configuration_ia_f620c8d8", href: "/dashboard?panel=ia&panelSource=gps" },
        ],
      },
      {
        id: "demarrer-rangement",
        title: "savoir_ou_ranger_chaque_information_16fcfba5",
        keywords: ["profil_32862cce", "activite_c8ff4830", "juridique_62559fe5", "siret_af59317f", "tva_8de073d6", "capital_5d8df9b1", "panier_moyen_5471fcdd", "transformation_1b3ad029", "horaires_dc432fe1"],
        duration: "2_min_47742d68",
        goal: "reglages_clairs_4f4d2391",
        intro:
          "chaque_donnee_a_un_seul_emplacement_5b3dbeae",
        steps: [
          "utiliser_mon_profil_pour_l_identite_ad8f2074",
          "utiliser_mon_activite_pour_le_metier_9afc1af8",
          "ouvrir_reglages_du_generateur_pour_le_98a1bc70",
          "ouvrir_encaisser_reglages_pour_la_raison_f2fcfc87",
        ],
        checks: [
          "les_informations_deja_enregistrees_sont_conserve_36d726ce",
          "les_horaires_publics_de_mon_activite_b187c890",
          "les_informations_juridiques_ne_bloquent_pas_79af3d9b",
        ],
        pitfalls: [
          "ne_saisir_une_donnee_qu_a_3535e250",
          "les_valeurs_proposees_par_secteur_restent_74cbdf72",
        ],
        links: [
          { label: "mon_profil_faa6d321", href: "/dashboard?panel=profil&panelSource=gps" },
          { label: "mon_activite_7732bf80", href: "/dashboard?panel=activite&panelSource=gps" },
          { label: "reglages_encaisser_ef086133", href: "/dashboard?panel=documents&panelSource=gps" },
        ],
      },
    ],
  },
  {
    id: "canaux",
    title: "les_canaux_fdf1c4e2",
    emoji: "🧩",
    description: "comprendre_les_12_canaux_inrcy_qui_0734ffce",
    articles: [
      {
        id: "canaux-express",
        title: "connecter_les_bonnes_bulles_79848216",
        keywords: ["canaux_22467b10", "bulles_6a26011b", "connexion_5d2cc1db", "configurer_317b6b02", "connecter_7badff0e", "site_inrcy_707ea046", "site_web_c428d383", "google_759730a9", "facebook_cbe64890", "instagram_b66806f4", "linkedin_7728240c", "tiktok_8d762497", "youtube_d5244a33", "shorts_9e32d15b", "pinterest_ea273f4e", "mails_056e11b5", "inrbadge_f4321501", "statistiques_80d10cfb", "publications_1a4f2b10", "visibilite_6f1baeb8", "ereputation_af31e61c"],
        duration: "5_min_b45ebd80",
        goal: "visibilite_reliee_816e8335",
        intro:
          "les_canaux_inrcy_sont_vos_leviers_d9b47410",
        steps: [
          "ouvrir_les_canaux_choisir_la_bulle_7694d398",
          "connecter_les_canaux_utiles_inr_badge_cf0a9388",
          "configurer_chaque_canal_utile_pour_que_e30107ca",
        ],
        checks: [
          "le_canal_affiche_bien_connecte_ou_6e5c1e6d",
          "le_bon_compte_professionnel_est_relie_47d2c0b3",
          "les_autorisations_de_stats_et_de_46e7140b",
          "les_canaux_desactives_restent_visibles_mais_d37b3ada",
        ],
        pitfalls: [
          "commencer_par_les_canaux_les_plus_7b1d3d5e",
          "tous_les_canaux_n_ont_pas_60f93b2e",
        ],
        links: [{ label: "ouvrir_les_canaux_9322102a", href: "/dashboard" }],
      },
    ],
  },
  {
    id: "inragent",
    title: "inr_agent_88080b90",
    emoji: "🤖",
    description: "votre_assistant_virtuel_pour_preparer_automatise_b019fa3d",
    articles: [
      {
        id: "inragent-express",
        title: "utiliser_votre_assistant_virtuel_04165ab2",
        keywords: ["inragent_28de2536", "agent_0608c405", "assistant_27a9612b", "assistant_virtuel_4c3163d5", "automatiser_942572c5", "programmer_cfd5acd5", "communication_60c58ad2", "publication_2ff2febe", "campagne_21daf4ed", "relance_f43a23e0", "actions_326b426f"],
        duration: "3_min_26ace9dc",
        goal: "gagner_du_temps_37ddd1f6",
        intro:
          "inr_agent_est_votre_assistant_virtuel_73b3609b",
        steps: [
          "ouvrir_inr_agent_depuis_le_header_8b9bfb22",
          "choisir_une_action_claire_publier_propulser_bc62e588",
          "pour_publier_connecter_les_canaux_utiles_e745be33",
          "laisser_inr_agent_utiliser_les_outils_e34c2216",
          "relire_l_apercu_puis_valider_ou_eb8a71b3",
        ],
        checks: [
          "votre_activite_votre_profil_et_votre_cd0c8c24",
          "les_canaux_utiles_sont_connectes_ou_afa008e3",
          "rien_n_est_publie_envoye_ou_c0b1a9af",
          "inr_agent_peut_etre_active_ou_6b85de15",
        ],
        pitfalls: [
          "inr_agent_ne_remplace_pas_votre_97699244",
          "plus_vos_informations_et_vos_canaux_df8a26dc",
          "google_business_se_gere_dans_e_d7e3e702",
          "objectif_gagner_du_temps_garder_une_53f5c53d",
        ],
        links: [
          { label: "ouvrir_inr_agent_4e96049b", href: "/dashboard/agent" },
        ],
      },
    ],
  },
  {
    id: "generateur",
    title: "generateur_90469c55",
    emoji: "⚡",
    description: "la_lecture_rapide_et_globale_de_622867e2",
    articles: [
      {
        id: "generateur-express",
        title: "lire_l_efficacite_globale_573d92cb",
        keywords: ["generateur_3a1d1638", "demandes_captees_02cfe3ac", "opportunites_59fe50b0", "potentiel_3484906b", "ca_potentiel_5f09de1b", "panier_moyen_5471fcdd", "taux_de_transformation_7bfc4dfa", "unites_d_inertie_26a6a35a", "ui_636117b2"],
        duration: "2_min_47742d68",
        goal: "vision_rapide_bcf03f44",
        intro:
          "le_generateur_montre_en_un_coup_01257269",
        steps: [
          "lire_les_demandes_captees_sur_7_343d5c83",
          "regarder_les_opportunites_activables_le_potentie_a0f2d77b",
          "verifier_le_ca_potentiel_calcule_avec_78949096",
          "suivre_les_unites_d_inertie_elles_e3a0b66f",
        ],
        checks: [
          "mon_activite_est_renseignee_et_les_337741fe",
          "au_moins_un_canal_important_est_9f76daa0",
          "les_canaux_de_diffusion_sont_bien_b94e558c",
          "les_donnees_7j_30j_ont_eu_8ac22cbc",
          "les_unites_d_inertie_progressent_avec_461fce0c",
        ],
        pitfalls: [
          "le_generateur_n_est_pas_un_c1e2b8e2",
          "plus_le_pro_publie_relance_et_5cb15a4a",
          "les_unites_d_inertie_sont_aussi_6b3e941a",
        ],
        links: [
          { label: "ouvrir_generateur_b31221be", href: "/dashboard" },
          { label: "ouvrir_inr_stats_48397dcd", href: "/dashboard/stats" },
          { label: "ouvrir_la_boutique_8379f104", href: "/dashboard?panel=boutique&panelSource=gps" },
        ],
      },
    ],
  },
  {
    id: "inrstats",
    title: "inr_stats_323b32a2",
    emoji: "📊",
    description: "la_traduction_business_des_donnees_canal_46755111",
    articles: [
      {
        id: "inrstats-express",
        title: "comprendre_ce_que_disent_les_donnees_04f558ae",
        keywords: ["inrstats_c90d0449", "stats_e350d5ce", "statistiques_80d10cfb", "donnees_9c27dd57", "appels_ffdaf7a3", "clics_d024aa0a", "visites_73d8c67f", "formulaires_fc551d57", "demandes_b08e4320", "lecture_business_aa101499"],
        duration: "2_min_47742d68",
        goal: "comprendre_0ab78461",
        intro:
          "inr_stats_traduit_les_donnees_des_fc05dcff",
        steps: [
          "connecter_les_canaux_utiles_pour_laisser_2691c29f",
          "lire_les_resultats_par_canal_google_49951a57",
          "reperer_ce_qui_fonctionne_appels_clics_b994c1a9",
          "utiliser_ensuite_booster_propulser_fideliser_ou_f2cb78a6",
        ],
        checks: [
          "les_canaux_sont_bien_connectes_ea9226c0",
          "les_periodes_affichees_sont_coherentes_9474495f",
          "une_absence_de_donnees_peut_etre_d47cbeba",
          "les_dernieres_donnees_fiables_sont_conservees_85e3fc93",
        ],
        pitfalls: [
          "inr_stats_sert_a_comprendre_ce_f45600dd",
          "le_generateur_sert_a_voir_rapidement_a2cf6401",
        ],
        links: [
          { label: "ouvrir_inr_stats_48397dcd", href: "/dashboard/stats" },
          { label: "ouvrir_les_canaux_9322102a", href: "/dashboard" },
          { label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" },
          { label: "ouvrir_propulser_92d683d1", href: "/dashboard/propulser" },
          { label: "ouvrir_fideliser_14161aa8", href: "/dashboard/fideliser" },
        ],
      },
    ],
  },
  {
    id: "booster",
    title: "booster_8e4caec0",
    emoji: "📣",
    description: "activer_les_canaux_avec_une_publication_c276f120",
    articles: [
      {
        id: "booster-express",
        title: "publier_en_moins_d_une_minute_d1284248",
        keywords: ["booster_73a103c5", "publier_ff70c566", "publication_2ff2febe", "multicanal_c5c501ac", "canaux_22467b10", "visibilite_6f1baeb8", "contenu_f3fd11bf"],
        duration: "3_min_26ace9dc",
        intro:
          "booster_sert_a_publier_sur_tous_0b166610",
        steps: [
          "cliquer_sur_publier_maintenant_pour_ouvrir_20ae1cfb",
          "preparer_un_contenu_chantier_nouveaute_conseil_6b5ac3a7",
          "choisir_les_canaux_utiles_sites_google_f584f95f",
          "verifier_le_texte_l_image_le_b3e5edab",
          "pour_une_action_commerciale_guidee_passer_f86c7bb7",
        ],
        checks: [
          "configuration_ia_est_bien_remplie_3f7cf305",
          "les_canaux_de_publication_sont_connectes_c4eaa757",
          "le_contenu_correspond_au_metier_et_ce1284ee",
          "une_publication_par_semaine_valide_la_65e66b65",
        ],
        pitfalls: [
          "regularite_bf8b4c44",
          "cet_outil_est_un_element_essentiel_5ac220a5",
          "publier_regulierement_vaut_mieux_que_chercher_f6d0e517",
        ],
        links: [
          { label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" },
          { label: "configuration_ia_f620c8d8", href: "/dashboard?panel=ia&panelSource=gps" },
          { label: "ouvrir_les_canaux_9322102a", href: "/dashboard" },
        ],
      },
      {
        id: "booster-medias",
        title: "optimiser_une_image_ou_une_video_e2fb228a",
        keywords: ["media_0bcb9adf", "optimiser_c9c3b018", "compression_e4c94651", "conversion_21faa67d", "mp4_e84c77e5", "h264_58ca444e", "aac_12abf551", "webm_eefaed0d", "mkv_cd2bfc12", "avi_8f920f22", "300_mo_319e1cb6", "75_mo_f1f0c962", "50_mo_d9c013ab"],
        duration: "2_min_47742d68",
        goal: "media_compatible_7b8faee8",
        intro:
          "des_l_ajout_inrcy_detecte_si_77bc84b4",
        steps: [
          "ajouter_jusqu_a_5_images_ou_23060472",
          "si_la_pastille_a_optimiser_apparait_395f7c89",
          "lancer_l_optimisation_conversion_en_mp4_5b40364c",
          "laisser_inrcy_reinserer_la_copie_optimisee_285eca25",
        ],
        checks: [
          "booster_vise_50_mo_maximum_par_88b4f292",
          "les_formats_deja_compatibles_et_assez_5ae3897a",
          "la_preparation_des_medias_avant_envoi_68b84d6a",
          "un_fichier_source_superieur_a_300_ce7b484f",
        ],
        pitfalls: [
          "optimiser_avant_de_generer_evite_d_d5b57c78",
          "un_conteneur_mp4_ne_suffit_pas_9764efe0",
        ],
        links: [{ label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" }],
      },
      {
        id: "booster-bilan",
        title: "lire_le_bilan_de_publication_d2433087",
        keywords: ["bilan_76a39cd2", "publie_bf504032", "traitement_3d1de4ea", "echec_f2da5369", "canal_bdc7b3f6", "inrsend_73a8031f", "programmation_5bd3a8f0", "duree_video_2e707e85", "pinterest_ea273f4e", "youtube_d5244a33"],
        duration: "1_min_3eb8a908",
        goal: "resultat_compris_512da347",
        intro:
          "le_bilan_separe_les_canaux_publies_a4888545",
        steps: [
          "lire_le_compteur_vert_des_reussites_b05c0c31",
          "utiliser_voir_pour_ouvrir_le_canal_f3708287",
          "cliquer_sur_le_bouton_d_information_58868b62",
          "ouvrir_inr_send_pour_suivre_les_50e7eb25",
        ],
        checks: [
          "les_canaux_non_selectionnes_ne_figurent_d2dd4870",
          "les_limites_de_duree_sont_signalees_f68ed43b",
          "un_statut_orange_signifie_que_la_386cefa6",
          "en_cas_de_coupure_reseau_apres_79f1057c",
        ],
        pitfalls: [
          "toujours_lire_le_detail_du_canal_dc3e7a6c",
          "une_erreur_de_format_detectee_seulement_9baa120b",
        ],
        links: [
          { label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" },
          { label: "ouvrir_inr_send_dc19efcf", href: "/dashboard/mails" },
        ],
      },
    ],
  },
  {
    id: "propulser",
    title: "propulser_2de43942",
    emoji: "🚀",
    description: "developper_l_activite_avec_des_actions_d4af665e",
    articles: [
      {
        id: "propulser-express",
        title: "lancer_une_action_business_aa4c386e",
        keywords: ["propulser_dfe314e3", "valoriser_91b30d46", "recolter_f7f7fa19", "offrir_fde928f5", "avis_1a9508ca", "offre_2e141d02", "action_business_74007b9c", "developper_9555d000"],
        duration: "3_min_26ace9dc",
        goal: "developper_a91e41e7",
        intro:
          "propulser_regroupe_les_actions_guidees_pour_9ae39667",
        steps: [
          "choisir_valoriser_pour_mettre_en_avant_5743553d",
          "choisir_recolter_pour_demander_des_avis_dceea71c",
          "choisir_offrir_pour_pousser_une_offre_0aae3695",
          "lancer_une_action_par_semaine_pour_218e5f26",
        ],
        checks: [
          "le_message_est_clair_et_oriente_3285d8af",
          "les_contacts_crm_sont_prets_si_bd17a28d",
          "les_canaux_sont_connectes_si_l_ebdff580",
          "l_action_choisie_correspond_au_besoin_52aac0e3",
        ],
        pitfalls: [
          "propulser_ne_remplace_pas_booster_booster_4a784282",
          "une_seule_action_propulser_par_semaine_beb9cf53",
        ],
        links: [
          { label: "ouvrir_propulser_92d683d1", href: "/dashboard/propulser" },
          { label: "ouvrir_crm_a1816b29", href: "/dashboard/crm" },
          { label: "ouvrir_inr_send_dc19efcf", href: "/dashboard/mails" },
        ],
      },
    ],
  },
  {
    id: "fideliser",
    title: "fideliser_8fa9e4f1",
    emoji: "💌",
    description: "garder_le_lien_faire_revenir_les_841c9569",
    articles: [
      {
        id: "fideliser-express",
        title: "entretenir_la_relation_client_9e68d9d9",
        keywords: ["fideliser_ccc21ec9", "campagne_21daf4ed", "mail_1d6e1cf7", "email_a88b7dcd", "clients_93df1461", "relance_f43a23e0", "perenniser_63bf2002", "revenir_0f3ee410", "relation_client_a1e96893"],
        duration: "4_min_f36d1960",
        goal: "garder_1e7164e4",
        intro:
          "fideliser_sert_a_garder_le_lien_87acc39b",
        steps: [
          "choisir_un_objectif_informer_suivre_ou_c80e2446",
          "utiliser_les_contacts_du_crm_ou_677522b3",
          "laisser_inrcy_generer_un_message_personnalise_62b7797d",
          "envoyer_depuis_inr_send_pour_profiter_be12d2fb",
          "une_action_fideliser_par_semaine_valide_26dfa882",
        ],
        checks: [
          "les_contacts_sont_presents_dans_le_d8a3ee1c",
          "la_boite_mail_est_configuree_dans_d4e5da8e",
          "la_signature_inr_send_est_prete_f6cdb6f7",
          "le_message_correspond_bien_a_la_caa3d4d7",
        ],
        pitfalls: [
          "un_ancien_client_coute_souvent_moins_d776a420",
          "une_relance_ciblee_vaut_mieux_qu_bb5a89ee",
        ],
        links: [
          { label: "ouvrir_fideliser_14161aa8", href: "/dashboard/fideliser" },
          { label: "ouvrir_crm_a1816b29", href: "/dashboard/crm" },
          { label: "ouvrir_inr_send_dc19efcf", href: "/dashboard/mails" },
        ],
      },
    ],
  },
  {
    id: "inrsend",
    title: "inr_send_98e1b891",
    emoji: "📬",
    description: "la_banque_de_communication_du_pro_c491c4fd",
    articles: [
      {
        id: "inrsend-express",
        title: "centraliser_toutes_les_communications_000637e7",
        keywords: ["inrsend_73a8031f", "mails_056e11b5", "boite_mail_2c9c9bbb", "signature_fab5f628", "publications_1a4f2b10", "historique_1b0efe6e", "banque_de_communication_62eb4acd", "reutiliser_47058479", "modifier_4a67e721", "supprimer_92d89802", "campagnes_1a9224ec"],
        duration: "3_min_26ace9dc",
        goal: "centraliser_44161577",
        intro:
          "inr_send_regroupe_toutes_les_communications_6edd1586",
        steps: [
          "commencer_par_connecter_les_boites_mail_5706ea9d",
          "creer_une_signature_inr_send_propre_8f49b1aa",
          "consulter_l_historique_simplifie_mails_factures_ee822bce",
          "reutiliser_modifier_supprimer_ou_revoir_une_21af0177",
        ],
        checks: [
          "au_moins_une_boite_mail_est_ab21bc54",
          "la_signature_est_creee_et_correcte_7f905ff4",
          "les_envois_apparaissent_bien_dans_l_da15abe4",
          "les_details_indiquent_les_reussites_erreurs_79cdcc70",
        ],
        pitfalls: [
          "inr_send_est_la_base_avant_b7a7b570",
          "la_banque_de_communication_permet_de_b7a8c19b",
        ],
        links: [
          { label: "ouvrir_inr_send_dc19efcf", href: "/dashboard/mails" },
          { label: "configurer_boite_mail_60c182bf", href: "/dashboard?panel=mails&panelSource=gps" },
          { label: "creer_ma_signature_4b77a0a5", href: "/dashboard?panel=mails&panelSource=gps" },
        ],
      },
    ],
  },
  {
    id: "crm",
    title: "crm_2a13d05e",
    emoji: "👥",
    description: "la_base_contacts_propre_pour_retrouver_6b72a650",
    articles: [
      {
        id: "crm-express",
        title: "garder_les_bons_contacts_sous_la_d1d0b335",
        keywords: ["crm_c4f6a544", "contacts_9db49a59", "import_62fdfbd5", "export_51713409", "prospect_6442cb81", "client_d2a04d71", "campagne_21daf4ed", "inrsend_73a8031f", "reutilisable_e43db6af"],
        duration: "3_min_26ace9dc",
        goal: "contacts_propres_e9e57170",
        intro:
          "le_crm_sert_a_stocker_et_8f90e3ff",
        steps: [
          "ajouter_un_contact_a_la_main_c385eda4",
          "renseigner_au_minimum_nom_raison_sociale_66025812",
          "utiliser_la_recherche_et_les_filtres_81fc6ef8",
          "retrouver_ensuite_les_campagnes_dans_inr_feccd8c0",
        ],
        checks: [
          "mail_ou_telephone_est_present_pour_2208048f",
          "adresse_cp_et_ville_sont_propres_d38d5f59",
          "le_type_de_contact_correspond_bien_a11f1fa3",
          "le_siren_ne_doit_pas_bloquer_09e0318b",
        ],
        pitfalls: [
          "un_crm_utile_reste_simple_quelques_57fd9073",
          "le_crm_prepare_les_actions_inr_a99284e3",
        ],
        links: [
          { label: "ouvrir_crm_a1816b29", href: "/dashboard/crm" },
          { label: "ajouter_un_contact_58e74c01", href: "/dashboard/crm" },
          { label: "importer_des_contacts_a1119d02", href: "/dashboard/crm" },
          { label: "ouvrir_inr_send_dc19efcf", href: "/dashboard/mails" },
        ],
      },
    ],
  },
  {
    id: "agenda",
    title: "agenda_891e9d6d",
    emoji: "📅",
    description: "creer_des_rendez_vous_et_envoyer_38da8eee",
    articles: [
      {
        id: "agenda-express",
        title: "poser_un_rendez_vous_proprement_e5852916",
        keywords: ["agenda_dafd5013", "rendez_vous_5596f597", "rdv_b1a07b34", "rappel_5e53e61e", "invite_640c8af1", "mail_1d6e1cf7", "boite_d_envoi_8f188956", "reglages_64984af1"],
        duration: "2_min_47742d68",
        goal: "eviter_les_oublis_2859da6e",
        intro:
          "l_agenda_sert_a_creer_des_f1b3cf47",
        steps: [
          "avant_les_rappels_ouvrir_les_reglages_0ce8691c",
          "creer_l_evenement_avec_date_heure_93b5d0ce",
          "ajouter_un_invite_si_une_autre_a3c54573",
          "choisir_les_rappels_utiles_confirmation_48h_7bf49410",
        ],
        checks: [
          "la_boite_d_envoi_des_rappels_af4f7e82",
          "le_client_et_les_invites_ont_69f73f80",
          "la_date_l_heure_de_debut_a6bc7d3d",
          "les_rappels_selectionnes_correspondent_au_vrai_821f2886",
        ],
        pitfalls: [
          "les_rappels_valent_seulement_si_l_a80261a8",
          "modifier_un_rendez_vous_seulement_quand_9d010b28",
        ],
        links: [
          { label: "ouvrir_agenda_3aea4732", href: "/dashboard/agenda" },
          { label: "nouvel_evenement_4b838182", href: "/dashboard/agenda" },
          { label: "reglages_agenda_f10068d2", href: "/dashboard?panel=agenda&panelSource=gps" },
        ],
      },
    ],
  },
  {
    id: "documents",
    title: "devis_factures_0857f47f",
    emoji: "🧾",
    description: "creer_sauvegarder_figer_et_envoyer_des_07605e1a",
    articles: [
      {
        id: "documents-express",
        title: "comprendre_le_bon_workflow_a52df4d6",
        keywords: ["devis_10bb562e", "facture_55b6b113", "documents_ec96667a", "figer_9f043cbb", "envoyer_74004a08", "modele_609247da", "reglages_64984af1", "sauvegarde_1641e8cc", "inrsend_73a8031f"],
        duration: "4_min_f36d1960",
        goal: "documents_propres_e5b8b1d3",
        intro:
          "sauvegarder_permet_de_continuer_plus_tard_51843e8b",
        steps: [
          "creer_le_document_et_renseigner_client_ccfc88b2",
          "sauvegarder_tant_que_le_document_doit_f5ba9a6c",
          "figer_seulement_quand_il_est_pret_c91bc467",
          "retrouver_aussi_les_documents_envoyes_par_9c6455da",
        ],
        checks: [
          "sauvegarder_ne_veut_pas_dire_officialiser_20d22160",
          "figer_verrouille_le_document_avant_emission_85f973c7",
          "les_sauvegardes_conservent_le_travail_pour_b190d8ce",
          "le_contact_peut_etre_lie_ou_49071fad",
        ],
        pitfalls: [
          "ne_pas_figer_trop_tot_une_fa8ee990",
          "les_documents_envoyes_deviennent_aussi_une_ff4a2677",
        ],
        links: [
          { label: "creer_un_devis_426c5610", href: "/dashboard/devis/new" },
          { label: "creer_une_facture_13a9becd", href: "/dashboard/factures/new" },
          { label: "reglages_00d63297", href: "/dashboard?panel=documents&panelSource=gps" },
        ],
      },
      {
        id: "documents-legal",
        title: "renseigner_les_informations_juridiques_20d9dd98",
        keywords: ["raison_sociale_ca61ca12", "forme_juridique_9d325a6b", "adresse_6c35df8a", "siret_af59317f", "siren_dcb01c3c", "rcs_c6cfd7d7", "capital_5d8df9b1", "tva_8de073d6", "iban_e5e80ef8", "encaisser_8b70b7a6"],
        duration: "3_min_26ace9dc",
        goal: "documents_conformes_7132a49f",
        intro:
          "les_informations_juridiques_sont_regroupees_dans_39abe34d",
        steps: [
          "ouvrir_encaisser_puis_la_roue_reglages_6862a93d",
          "completer_la_premiere_rubrique_raison_sociale_6dcdd513",
          "verifier_ensuite_les_reglages_de_paiement_f4fcb550",
          "creer_un_document_test_et_controler_0f6e774d",
        ],
        checks: [
          "les_anciennes_valeurs_du_profil_sont_c7fb3fec",
          "ces_champs_ne_sont_obligatoires_que_d8dbecde",
          "l_iban_et_les_conditions_de_8c7aa4d1",
          "les_donnees_legales_ne_sont_pas_b75896a6",
        ],
        pitfalls: [
          "verifier_les_mentions_aupres_de_votre_e435d608",
          "une_facture_officielle_doit_rester_coherente_f9f786f7",
        ],
        links: [{ label: "reglages_encaisser_ef086133", href: "/dashboard?panel=documents&panelSource=gps" }],
      },
    ],
  },
  {
    id: "abonnement",
    title: "essai_abonnement_365084d7",
    emoji: "💳",
    description: "comprendre_l_essai_l_acces_et_dbef7e29",
    articles: [
      {
        id: "abonnement-express",
        title: "comprendre_l_acces_inrcy_1638f89a",
        keywords: ["abonnement_c07d9642", "essai_d2207afb", "tarif_5c2b41b5", "partenaire_58e70eba", "paiement_dc2e8fb0", "stripe_2fcb5a43", "resiliation_537d2f5f", "offre_2e141d02"],
        duration: "1_min_3eb8a908",
        goal: "acces_clair_d9a5c5ac",
        intro:
          "inrcy_peut_etre_teste_avant_engagement_78df5911",
        steps: [
          "utiliser_la_periode_d_essai_pour_bd025934",
          "consulter_l_espace_abonnement_pour_voir_688be0a0",
          "choisir_ou_valider_une_offre_quand_e04e7797",
          "contacter_l_equipe_inrcy_en_cas_ca677124",
        ],
        checks: [
          "la_periode_d_essai_est_bien_fa7f93f6",
          "l_offre_active_correspond_au_compte_7d45f95b",
          "le_moyen_de_paiement_ou_l_1862c7ea",
          "l_equipe_inrcy_reste_le_bon_b510357a",
        ],
        pitfalls: [
          "le_gps_explique_le_fonctionnement_pas_365cbc4d",
          "l_offre_reelle_du_compte_reste_1f5187fb",
        ],
        links: [
          { label: "voir_mon_abonnement_082e4980", href: "/dashboard?panel=abonnement&panelSource=gps" },
          { label: "nous_contacter_f02ffb67", href: "/dashboard?panel=contact&panelSource=gps" },
        ],
      },
    ],
  },
  {
    id: "problemes",
    title: "problemes_frequents_76cae2ba",
    emoji: "🛠️",
    description: "les_verifications_rapides_avant_de_penser_4983fdb4",
    articles: [
      {
        id: "problemes-express",
        title: "les_reflexes_simples_46adeef5",
        keywords: ["probleme_df9880c5", "bug_68858584", "stats_e350d5ce", "publication_2ff2febe", "mail_1d6e1cf7", "spam_ded982e7", "deconnecte_d291aa44", "erreur_c1f85201"],
        duration: "2_min_47742d68",
        goal: "debloquer_vite_c67c6488",
        intro:
          "la_plupart_des_blocages_viennent_d_852d17e9",
        steps: [
          "pas_de_stats_verifier_qu_au_f9ed5774",
          "publication_refusee_reconnecter_le_canal_puis_e1bb2377",
          "mail_en_spam_verifier_domaine_signature_c6f50b2a",
          "image_non_visible_reduire_le_poids_48c7b8d9",
        ],
        checks: [
          "reconnecter_un_canal_regle_beaucoup_de_f92c05d0",
          "lire_le_detail_dans_inr_send_fc885934",
          "verifier_mon_activite_mon_profil_et_c02fc29a",
          "attendre_la_remontee_des_plateformes_externes_d65e6a4d",
        ],
        pitfalls: [
          "ne_pas_forcer_dix_fois_la_f30525e6",
          "un_message_d_erreur_clair_dans_b7b278d7",
        ],
      },
      {
        id: "problemes-mobile-reseau",
        title: "reseau_instable_sur_telephone_dbeca4c6",
        keywords: ["telephone_32e4ddf3", "pixel_03dc8cb2", "android_e4bbe5b7", "iphone_851aad63", "safari_40102dbf", "chrome_b90d9457", "wifi_86a28d88", "4g_1116ef12", "5g_2bb0d130", "reseau_5325f8e8", "economiseur_aff2a48f", "connexion_serveur_9e08cbfd"],
        duration: "2_min_47742d68",
        goal: "retrouver_le_resultat_e3f671ed",
        intro:
          "sur_mobile_une_bascule_wi_fi_3d51a864",
        steps: [
          "garder_inrcy_au_premier_plan_pendant_4e722c39",
          "en_cas_d_erreur_attendre_quelques_3f92eee0",
          "actualiser_une_seule_fois_puis_verifier_aaa474d1",
          "si_le_probleme_revient_tester_sans_e5b9ae95",
        ],
        checks: [
          "utiliser_un_navigateur_recent_chrome_safari_e451059f",
          "verifier_que_le_telephone_n_a_e1d0a935",
          "controler_inr_send_pour_eviter_un_7a0d4fed",
          "contacter_inrcy_avec_l_heure_exacte_8e2635f0",
        ],
        pitfalls: [
          "une_erreur_de_connexion_affichee_sur_12d7b7cc",
          "ne_relancez_pas_immediatement_plusieurs_fois_a5eea1ec",
        ],
        links: [{ label: "ouvrir_inr_send_dc19efcf", href: "/dashboard/mails" }],
      },
      {
        id: "problemes-vocal",
        title: "utiliser_la_dictee_vocale_2df3acd4",
        keywords: ["vocal_5a293c2f", "micro_96bccd46", "enregistrement_e62420f7", "dictee_9ba2456d", "audio_a06a4929", "stop_1b480158", "autorisation_fd12e095", "mobile_83d6311e", "iphone_851aad63", "android_e4bbe5b7"],
        duration: "1_min_3eb8a908",
        goal: "idee_transformee_en_texte_c2411692",
        intro:
          "le_micro_de_booster_enregistre_votre_910ea162",
        steps: [
          "autoriser_l_acces_au_micro_lorsque_3db86af5",
          "parler_clairement_puis_toucher_stop_une_09c7ab95",
          "attendre_la_transcription_avant_de_modifier_dcc6e750",
          "si_rien_ne_remonte_verifier_l_82650345",
        ],
        checks: [
          "le_navigateur_et_le_systeme_autorisent_02903997",
          "un_enregistrement_court_permet_de_distinguer_7e6c4974",
          "le_texte_obtenu_reste_modifiable_avant_7410a3ae",
        ],
        pitfalls: [
          "eviter_de_verrouiller_l_ecran_pendant_c89ab2a7",
          "sur_un_reseau_faible_patienter_apres_84697efd",
        ],
        links: [{ label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" }],
      },
    ],
  },
  {
    id: "conseils",
    title: "conseils_inrcy_7162efcf",
    emoji: "💡",
    description: "les_habitudes_simples_qui_rendent_l_9cfb6d4a",
    articles: [
      {
        id: "conseils-express",
        title: "les_bons_reflexes_9c5dadd3",
        keywords: ["conseils_1615e5a7", "routine_012da8a9", "communication_60c58ad2", "avis_1a9508ca", "visibilite_6f1baeb8", "seo_6170ca2b", "clients_93df1461"],
        duration: "2_min_47742d68",
        goal: "progresser_regulierement_5c4510d3",
        intro:
          "inrcy_fonctionne_mieux_avec_une_petite_eeda190e",
        steps: [
          "publier_une_fois_par_semaine_une_1933b5db",
          "demander_des_avis_apres_les_clients_1d3893cc",
          "mettre_a_jour_les_infos_visibles_cc65e1fa",
          "relancer_les_anciens_clients_et_prospects_957a3c9d",
        ],
        checks: [
          "regularite_perfection_dd47f474",
          "les_contenus_locaux_precis_aident_la_fdd43188",
          "les_avis_et_les_preuves_terrain_82f1cab8",
          "les_coordonnees_doivent_rester_coherentes_partou_34958752",
        ],
        pitfalls: [
          "une_petite_action_chaque_semaine_est_0c4d80d4",
          "montrer_des_preuves_reelles_rassure_plus_87fdb439",
        ],
        links: [
          { label: "ouvrir_booster_940c06bc", href: "/dashboard?action=publish" },
          { label: "ouvrir_propulser_92d683d1", href: "/dashboard/propulser" },
          { label: "ouvrir_fideliser_14161aa8", href: "/dashboard/fideliser" },
        ],
      },
    ],
  },
];
