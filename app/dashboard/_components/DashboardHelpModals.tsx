"use client";

import { useTranslations } from "next-intl";


import HelpModal from "./HelpModal";
import type { DashboardEdition } from "@/lib/dashboardEdition";

type DashboardHelpModalsProps = {
  edition?: DashboardEdition;
  siteInrcySubscribed: boolean;
  helpGeneratorOpen: boolean;
  helpCanauxOpen: boolean;
  helpSiteInrcyOpen: boolean;
  helpSiteWebOpen: boolean;
  helpInertieOpen: boolean;
  helpInstagramOpen: boolean;
  helpFacebookOpen: boolean;
  onCloseGenerator: () => void;
  onCloseCanaux: () => void;
  onCloseSiteInrcy: () => void;
  onCloseSiteWeb: () => void;
  onCloseInertie: () => void;
  onCloseFacebook: () => void;
  onCloseInstagram: () => void;
};

type InertiaHelpRow = {
  aKey: string;
  g: string;
  f: string;
  premiumOnly?: boolean;
};

const INERTIA_ROWS: InertiaHelpRow[] = [
  { aKey: "ouverture_du_compte_6a19938f", g: "+50 UI", f: "1 fois" },
  { aKey: "completer_mon_profil_11c8cb2b", g: "+100 UI", f: "1 fois" },
  { aKey: "completer_mon_activite_5961359c", g: "+100 UI", f: "1 fois" },
  { aKey: "utiliser_booster_6138c57d", g: "+10 UI", f: "1 publication / semaine" },
  { aKey: "utiliser_propulser_c4b4b56d", g: "+10 UI", f: "1 action / semaine", premiumOnly: true },
  { aKey: "utiliser_fideliser_af919842", g: "+10 UI", f: "1 action / semaine", premiumOnly: true },
  {
    aKey: "anciennete_166e0461",
    g: "+50 UI",
    f: "1re fois au 30e jour, puis tous les 30 jours",
  },
];

export default function DashboardHelpModals({
  edition = "premium",
  siteInrcySubscribed,
  helpGeneratorOpen,
  helpCanauxOpen,
  helpSiteInrcyOpen,
  helpSiteWebOpen,
  helpInertieOpen,
  helpInstagramOpen,
  helpFacebookOpen,
  onCloseGenerator,
  onCloseCanaux,
  onCloseSiteInrcy,
  onCloseSiteWeb,
  onCloseInertie,
  onCloseFacebook,
  onCloseInstagram,
}: DashboardHelpModalsProps) {
  const i18nT = useTranslations("shell");
  const standardMode = edition === "standard";

  return (
    <>
      <HelpModal
        open={helpGeneratorOpen}
        title={i18nT("generateur_inrcy_3882fff4")}
        onClose={onCloseGenerator}
      >
        <div
          style={{
            marginTop: 0,
            borderRadius: 18,
            padding: "clamp(16px, 4vw, 24px)",
            boxSizing: "border-box",
            maxWidth: "100%",
            overflow: "hidden",
            background:
              "linear-gradient(135deg, rgba(0,180,255,0.14), rgba(167,72,255,0.14), rgba(255,92,138,0.10))",
            border: "1px solid rgba(110,180,255,0.18)",
            boxShadow: "0 0 40px rgba(87,117,255,0.12)",
          }}
        >
          <p style={{ marginTop: 0, fontSize: 15.5, lineHeight: 1.8 }}>
            {i18nT("le_generateur_inrcy_centralise_vos_canaux_7e8b377d")}{" "}</p>

          <div style={{ display: "grid", gap: 22 }}>
            <div>
              <div
                style={{ fontWeight: 700, color: "#66d9ff", marginBottom: 10 }}
              >
                {i18nT("unites_d_inertie_4d7ed5c6")}{" "}</div>
              <div style={{ opacity: 0.96, lineHeight: 1.75, fontSize: 14.5 }}>
                {standardMode ? (
                  <>
                    {i18nT("points_generes_par_votre_activite_et_93e1c500")}{" "}</>
                ) : (
                  <>
                    {i18nT("points_generes_par_votre_activite_et_a4e9014c")}{" "}</>
                )}
              </div>
            </div>

            <div>
              <div
                style={{ fontWeight: 700, color: "#ff9ad5", marginBottom: 10 }}
              >
                {i18nT("ca_potentiel_30_jours_7325dfe0")}{" "}</div>
              <div style={{ opacity: 0.96, lineHeight: 1.75, fontSize: 14.5 }}>
                {i18nT("estimation_du_chiffre_d_affaires_pouvant_cb2212ef")}{" "}</div>
            </div>

            <div>
              <div
                style={{ fontWeight: 700, color: "#7df7c4", marginBottom: 10 }}
              >
                {i18nT("demandes_captees_369d1ff6")}{" "}</div>
              <div style={{ opacity: 0.96, lineHeight: 1.75, fontSize: 14.5 }}>
                {i18nT("analyse_business_des_statistiques_reelles_de_a51ff55a")}{" "}</div>
            </div>

            <div>
              <div
                style={{ fontWeight: 700, color: "#ffd36f", marginBottom: 10 }}
              >
                {i18nT("opportunites_activables_253f4140")}{" "}</div>
              <div style={{ opacity: 0.96, lineHeight: 1.75, fontSize: 14.5 }}>
                {standardMode ? (
                  <>
                    {i18nT("contacts_supplementaires_pouvant_etre_generes_en_12d3fa24")}{" "}</>
                ) : (
                  <>
                    {i18nT("contacts_supplementaires_pouvant_etre_generes_gr_207bdb80")}{" "}</>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "12px 14px",
              borderRadius: 14,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 13,
              lineHeight: 1.5,
              opacity: 0.95,
            }}
          >
            {i18nT("les_donnees_affichees_sont_calculees_automatique_ee4f1d05")}{" "}</div>
        </div>
      </HelpModal>

      <HelpModal
        open={helpCanauxOpen}
        title={i18nT("canaux_inrcy_527346d9")}
        onClose={onCloseCanaux}
      >
        <div
          style={{
            marginTop: 0,
            borderRadius: 18,
            padding: "clamp(16px, 4vw, 24px)",
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
            overflow: "hidden",
            background:
              "linear-gradient(135deg, rgba(0,180,255,0.14), rgba(167,72,255,0.14), rgba(255,92,138,0.10))",
            border: "1px solid rgba(110,180,255,0.18)",
            boxShadow: "0 0 40px rgba(87,117,255,0.12)",
          }}
        >
          <p
            style={{
              marginTop: 0,
              marginBottom: 18,
              fontSize: 15.5,
              lineHeight: 1.8,
              overflowWrap: "anywhere",
            }}
          >
            {i18nT("les_canaux_inrcy_representent_vos_differents_dcda7bb8")}{" "}</p>

          <div style={{ display: "grid", gap: 20, maxWidth: "100%", minWidth: 0 }}>
            <section
              style={{
                borderRadius: 16,
                padding: 16,
                maxWidth: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
                background: "rgba(255,255,255,0.045)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                style={{ fontWeight: 800, color: "#66d9ff", marginBottom: 6 }}
              >
                {i18nT("tous_vos_canaux_de_diffusion_cd4e685a")}{" "}</div>
              <p
                style={{
                  margin: "0 0 14px",
                  opacity: 0.92,
                  lineHeight: 1.65,
                  fontSize: 14,
                }}
              >
                {standardMode
                  ? i18nT("ils_diffusent_votre_presence_vos_publications_f90cfdd8")
                  : i18nT("ils_diffusent_votre_presence_vos_publications_3e703a66")}
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
                  gap: 14,
                }}
              >
                {[
                  {
                    icon: "🪪",
                    name: "iNr'Badge",
                    color: "#b7ff8a",
                    text: standardMode
                      ? "Diffuse votre carte de visite digitale en QR Code. Il donne accès à vos coordonnées, vos liens et vos demandes de contact."
                      : "Diffuse votre carte de visite digitale en QR Code. Il donne accès à vos coordonnées, vos liens, vos demandes de contact et vos prises de rendez-vous.",
                  },
                  {
                    icon: "🌐",
                    name: "Site iNrCy",
                    color: "#66d9ff",
                    text: i18nT("votre_machine_a_leads_intelligente_disponible_2e4e9670"),
                    requiresSiteSubscription: true,
                  },
                  {
                    icon: "🖥️",
                    name: "Site web",
                    color: "#ff9ad5",
                    text: i18nT("relie_votre_site_actuel_a_inrcy_19e0b1ac"),
                  },
                  {
                    icon: "📍",
                    name: "Google Business",
                    color: "#7df7c4",
                    text: i18nT("developpe_votre_visibilite_locale_avec_les_a4382f02"),
                  },
                  {
                    icon: "📘",
                    name: "Facebook",
                    color: "#ffd36f",
                    text: i18nT("diffuse_votre_activite_developpe_l_engagement_e2d135e3"),
                  },
                  {
                    icon: "📸",
                    name: "Instagram",
                    color: "#d6a4ff",
                    text: i18nT("renforce_votre_image_de_marque_avec_3a9094b4"),
                  },
                  {
                    icon: "💼",
                    name: "LinkedIn",
                    color: "#89c6ff",
                    text: i18nT("developpe_votre_visibilite_professionnelle_et_vo_03493360"),
                  },
                  {
                    icon: "🎵",
                    name: "TikTok",
                    color: "#ff8bbd",
                    text: i18nT("diffuse_vos_contenus_courts_et_videos_e7119e4a"),
                  },
                  {
                    icon: "▶️",
                    name: "YouTube",
                    color: "#ff6b6b",
                    text: i18nT("diffuse_vos_videos_courtes_ou_longues_0795ce8f"),
                  },
                  {
                    icon: "✉️",
                    name: "Mails",
                    color: "#9ee7ff",
                    text: i18nT("diffuse_vos_campagnes_fidelisations_et_communica_30ef2d48"),
                    premiumOnly: true,
                  },
                ].map((channel) => {
                  const premiumLocked = standardMode && channel.premiumOnly;
                  const siteNotSubscribed = Boolean(channel.requiresSiteSubscription && !siteInrcySubscribed);
                  const channelDisabled = Boolean(premiumLocked || siteNotSubscribed);

                  return (
                    <div
                      key={channel.name}
                      aria-disabled={channelDisabled || undefined}
                      style={{
                        minWidth: 0,
                        boxSizing: "border-box",
                        opacity: channelDisabled ? 0.52 : 1,
                        filter: channelDisabled ? "grayscale(0.75)" : undefined,
                      }}
                    >
                    <div
                      style={{
                        fontWeight: 800,
                        color: channel.color,
                        marginBottom: 6,
                      }}
                    >
                      {channel.icon} {channel.name}
                      {premiumLocked || siteNotSubscribed ? (
                        <span
                          style={{
                            marginLeft: 8,
                            padding: "2px 7px",
                            borderRadius: 999,
                            border: "1px solid rgba(255,255,255,0.2)",
                            fontSize: 10,
                            color: "#fff",
                          }}
                        >
                          {premiumLocked ? i18nT("pack_premium_282f98ef") : i18nT("non_souscrit_fb632cc2")}
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{ opacity: 0.96, lineHeight: 1.62, fontSize: 14 }}
                    >
                      {channel.text}
                    </div>
                    </div>
                  );
                })}
              </div>
            </section>

          <div
            style={{
              marginTop: 22,
              padding: "14px 16px",
              maxWidth: "100%",
              boxSizing: "border-box",
              borderRadius: 14,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 13,
              lineHeight: 1.6,
              opacity: 0.95,
            }}
          >
            {standardMode
              ? i18nT("plus_vos_canaux_de_diffusion_sont_a947930b")
              : i18nT("plus_vos_canaux_de_diffusion_sont_a95a7824")}
          </div>
        </div>
        </div>
      </HelpModal>

      <HelpModal
        open={helpFacebookOpen}
        title={i18nT("connexion_facebook_9d2d340c")}
        onClose={onCloseFacebook}
      >
        <div
          style={{
            marginTop: 0,
            borderRadius: 18,
            padding: 24,
            background:
              "linear-gradient(135deg, rgba(0,180,255,0.14), rgba(167,72,255,0.14), rgba(255,92,138,0.10))",
            border: "1px solid rgba(110,180,255,0.18)",
            boxShadow: "0 0 40px rgba(87,117,255,0.12)",
          }}
        >
          <p
            style={{
              marginTop: 0,
              marginBottom: 18,
              fontSize: 15.5,
              lineHeight: 1.75,
            }}
          >
            {i18nT("pour_connecter_facebook_a_inrcy_utilisez_930a6ffc")}{" "}
            <strong>{i18nT("compte_facebook_personnel_aa2b9d94")}</strong> {" "}{i18nT("qui_possede_les_droits_sur_votre_dae928a0")}{" "}<strong>{i18nT("page_facebook_professionnelle_bc97c28e")}</strong>{i18nT("inrcy_ne_publie_pas_sur_votre_418c9a4e")}{" "}</p>

          <div style={{ display: "grid", gap: 16 }}>
            <div
              style={{
                borderRadius: 16,
                padding: 16,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.09)",
              }}
            >
              <div
                style={{ fontWeight: 800, color: "#66d9ff", marginBottom: 10 }}
              >
                {i18nT("configuration_correcte_22f525e3")}{" "}</div>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  lineHeight: 1.7,
                  fontSize: 14.5,
                }}
              >
                <li>
                  {i18nT("vous_avez_un_69258d0a")}{" "}<strong>{i18nT("compte_facebook_personnel_aa2b9d94")}</strong>.
                </li>
                <li>
                  {i18nT("ce_compte_gere_une_58e15d90")}{" "}
                  <strong>{i18nT("page_facebook_professionnelle_bc97c28e")}</strong>.
                </li>
                <li>{i18nT("vous_connectez_ce_compte_facebook_a_ef8626a5")}</li>
                <li>
                  {i18nT("vous_selectionnez_ensuite_la_bonne_14661ff2")}{" "}
                  <strong>{i18nT("page_professionnelle_9a3b53ce")}</strong>.
                </li>
              </ol>
            </div>

            <div
              style={{
                borderRadius: 16,
                padding: 16,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.09)",
              }}
            >
              <div
                style={{ fontWeight: 800, color: "#ff9ad5", marginBottom: 10 }}
              >
                {i18nT("creer_une_page_professionnelle_dbfc09f4")}{" "}</div>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  lineHeight: 1.7,
                  fontSize: 14.5,
                }}
              >
                <li>
                  {i18nT("ouvrez_facebook_avec_votre_d2e26aa2")}{" "}<strong>{i18nT("compte_personnel_a017c87e")}</strong>.
                </li>
                <li>
                  {i18nT("allez_dans_7695bb57")}{" "}<strong>{i18nT("pages_600584c2")}</strong>.
                </li>
                <li>
                  {i18nT("cliquez_sur_487bfa49")}{" "}<strong>{i18nT("creer_une_page_e1c32b3b")}</strong>.
                </li>
                <li>
                  {i18nT("ajoutez_le_nom_de_l_entreprise_9eb80590")}{" "}</li>
                <li>
                  {i18nT("verifiez_qu_il_s_agit_bien_2b02e668")}{" "}<strong>{i18nT("page_fb06270f")}</strong>{i18nT("pas_d_un_profil_personnel_6a68ad03")}{" "}</li>
              </ol>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "13px 15px",
              borderRadius: 14,
              background: "rgba(245,158,11,0.10)",
              border: "1px solid rgba(245,158,11,0.20)",
              fontSize: 13.5,
              lineHeight: 1.6,
              opacity: 0.98,
            }}
          >
            {i18nT("attention_si_votre_page_entreprise_a_46904e09")}{" "}</div>
        </div>
      </HelpModal>

      <HelpModal
        open={helpInstagramOpen}
        title={i18nT("connexion_instagram_d099afc4")}
        onClose={onCloseInstagram}
      >
        <div
          style={{
            marginTop: 0,
            borderRadius: 18,
            padding: 24,
            background:
              "linear-gradient(135deg, rgba(0,180,255,0.14), rgba(167,72,255,0.14), rgba(255,92,138,0.10))",
            border: "1px solid rgba(110,180,255,0.18)",
            boxShadow: "0 0 40px rgba(87,117,255,0.12)",
          }}
        >
          <p
            style={{
              marginTop: 0,
              marginBottom: 18,
              fontSize: 15.5,
              lineHeight: 1.75,
            }}
          >
            {i18nT("pour_connecter_instagram_a_inrcy_votre_27670a2a")}{" "}
            <strong>professionnel</strong> {" "}{i18nT("business_ou_creator_il_doit_ensuite_4a6daae0")}{" "}
            <strong>{i18nT("page_facebook_professionnelle_bc97c28e")}</strong> {" "}{i18nT("accessible_par_votre_compte_facebook_ou_1bd82c63")}{" "}</p>

          <div style={{ display: "grid", gap: 16 }}>
            <div
              style={{
                borderRadius: 16,
                padding: 16,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.09)",
              }}
            >
              <div
                style={{ fontWeight: 800, color: "#66d9ff", marginBottom: 10 }}
              >
                {i18nT("passer_instagram_en_compte_professionnel_1f09cd23")}{" "}</div>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  lineHeight: 1.7,
                  fontSize: 14.5,
                }}
              >
                <li>
                  {i18nT("ouvrez_instagram_puis_allez_sur_votre_bf9f7ed4")}{" "}<strong>profil</strong>
                  .
                </li>
                <li>
                  {i18nT("ouvrez_le_menu_8b3c2847")}{" "}<strong>☰</strong>{i18nT("puis_177b56f0")}{" "}
                  <strong>{i18nT("parametres_et_activite_f117985c")}</strong>.
                </li>
                <li>
                  {i18nT("cherchez_c01086b1")}{" "}<strong>{i18nT("type_de_compte_et_outils_3d938170")}</strong> ou{" "}
                  <strong>{i18nT("outils_professionnels_e062d9d5")}</strong>.
                </li>
                <li>
                  {i18nT("cliquez_sur_487bfa49")}{" "}<strong>{i18nT("passer_a_un_compte_professionnel_bc02e3cd")}</strong>.
                </li>
                <li>
                  {i18nT("choisissez_ebefc7d8")}{" "}<strong>{i18nT("business_d6663dda")}</strong> ou{" "}
                  <strong>{i18nT("creator_817b79b0")}</strong>.
                </li>
              </ol>
            </div>

            <div
              style={{
                borderRadius: 16,
                padding: 16,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.09)",
              }}
            >
              <div
                style={{ fontWeight: 800, color: "#ff9ad5", marginBottom: 10 }}
              >
                {i18nT("relier_instagram_a_facebook_6331689b")}{" "}</div>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  lineHeight: 1.7,
                  fontSize: 14.5,
                }}
              >
                <li>
                  <strong>{i18nT("depuis_instagram_322d9eab")}</strong> {" "}{i18nT("profil_modifier_le_profil_page_selectionnez_c7fd52e4")}{" "}</li>
                <li>
                  <strong>{i18nT("depuis_facebook_a42f715c")}</strong> {" "}{i18nT("ouvrez_la_page_professionnelle_parametres_compte_bcabea63")}{" "}</li>
                <li>
                  {i18nT("si_la_page_n_apparait_pas_08e773a9")}{" "}</li>
              </ol>
            </div>

            <div
              style={{
                borderRadius: 16,
                padding: 16,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.09)",
              }}
            >
              <div
                style={{ fontWeight: 800, color: "#7df7c4", marginBottom: 10 }}
              >
                {i18nT("cas_meta_business_e1576b83")}{" "}</div>
              <div style={{ lineHeight: 1.7, fontSize: 14.5 }}>
                {i18nT("si_vous_utilisez_meta_business_suite_ea5c6b40")}{" "}
                <strong>{i18nT("page_facebook_5017637f")}</strong> {" "}{i18nT("et_le_60d2ac7f")}{" "}
                <strong>{i18nT("compte_instagram_cf617acf")}</strong> {" "}{i18nT("sont_dans_le_meme_portefeuille_business_e9a37dbb")}{" "}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "13px 15px",
              borderRadius: 14,
              background: "rgba(34,197,94,0.10)",
              border: "1px solid rgba(34,197,94,0.20)",
              fontSize: 13.5,
              lineHeight: 1.6,
              opacity: 0.98,
            }}
          >
            {i18nT("si_le_compte_instagram_ou_la_d9ecd233")}{" "}</div>
        </div>
      </HelpModal>

      <HelpModal
        open={helpSiteInrcyOpen}
        title={i18nT("site_inrcy_57016d6f")}
        onClose={onCloseSiteInrcy}
      >
        <p style={{ marginTop: 0 }}>
          {i18nT("la_bulle_cb4937bb")}{" "}<strong>{i18nT("site_inrcy_57016d6f")}</strong> {" "}{i18nT("est_accessible_uniquement_si_vous_etes_604521af")}{" "}</p>
        <p>
          {i18nT("si_c_apos_est_le_cas_2c0bc7a9")}{" "}</p>
      </HelpModal>

      <HelpModal
        open={helpSiteWebOpen}
        title={i18nT("site_web_7e78af33")}
        onClose={onCloseSiteWeb}
      >
        <p style={{ marginTop: 0 }}>
          {i18nT("la_bulle_cb4937bb")}{" "}<strong>{i18nT("site_web_7e78af33")}</strong> {" "}{i18nT("correspond_a_votre_site_existant_une_d16778c0")}{" "}</p>
        <p>
          {i18nT("cette_connexion_permet_de_centraliser_vos_12496710")}{" "}</p>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>{i18nT("ajoutez_l_apos_url_de_votre_c8902776")}</li>
          <li>
            {i18nT("cliquez_sur_les_boutons_de_connexion_9ec2513b")}{" "}</li>
          <li>
            {i18nT("ajouter_le_code_du_quot_widget_880867b7")}{" "}</li>
        </ol>
      </HelpModal>

      <HelpModal
        open={helpInertieOpen}
        title={i18nT("mon_inertie_tableau_des_gains_ui_dbbbbd9a")}
        onClose={onCloseInertie}
      >
        <p style={{ marginTop: 0 }}>
          {i18nT("voici_les_actions_qui_rapportent_des_9bee48b5")}{" "}<strong>UI</strong> {" "}{i18nT("unites_d_inertie_489e60cb")}{" "}</p>

        {edition === "standard" ? (
          <p style={{ marginTop: -4, color: "rgba(255,255,255,0.66)", fontSize: 13 }}>
            {i18nT("les_actions_grisees_sont_disponibles_avec_92d9fcc5")}{" "}</p>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 10px",
                    borderBottom: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  {i18nT("action_97c89a4d")}{" "}</th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 10px",
                    borderBottom: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  {i18nT("gain_96dd91cd")}{" "}</th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "10px 10px",
                    borderBottom: "1px solid rgba(255,255,255,0.10)",
                  }}
                >
                  {i18nT("frequence_bafbfba7")}{" "}</th>
              </tr>
            </thead>
            <tbody>
              {INERTIA_ROWS.map((row) => {
                const premiumLocked = edition === "standard" && row.premiumOnly;
                return (
                  <tr
                    key={row.aKey}
                    aria-disabled={premiumLocked || undefined}
                    style={{
                      opacity: premiumLocked ? 0.48 : 1,
                      filter: premiumLocked ? "grayscale(0.75)" : undefined,
                      background: premiumLocked ? "rgba(255,255,255,0.018)" : undefined,
                    }}
                  >
                  <td
                    style={{
                      padding: "10px 10px",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span>{i18nT(row.aKey)}</span>
                      {premiumLocked ? (
                        <span
                          style={{
                            padding: "3px 7px",
                            borderRadius: 999,
                            border: "1px solid rgba(192,132,252,0.34)",
                            background: "rgba(126,34,206,0.18)",
                            color: "rgba(233,213,255,0.92)",
                            fontSize: 10,
                            fontWeight: 850,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {i18nT("forfait_premium_65aaf9d2")}{" "}</span>
                      ) : null}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "10px 10px",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {row.g}
                  </td>
                  <td
                    style={{
                      padding: "10px 10px",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {row.f}
                  </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p style={{ marginBottom: 0, marginTop: 12, opacity: 0.9 }}>
          {i18nT("le_turbo_ui_multiplie_certaines_actions_2134fd76")}{" "}</p>
      </HelpModal>
    </>
  );
}
