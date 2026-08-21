import { useTranslations } from "next-intl";

import EReputationHeader from "./EReputationHeader";
import EReputationReviewsClient, {
  type EReputationReviewItem,
  type EReputationReviewsPlatform,
} from "./EReputationReviewsClient";
import styles from "./eReputation.module.css";

export default function EReputationPage() {
  const i18nT = useTranslations("reputation");
  const askReviewsHref = "/dashboard/propulser?action=recolter";
  const previewGoogleReviews: EReputationReviewItem[] = [
    {
      id: "google:preview-1",
      platform: "google",
      reviewName: null,
      name: "Sophie M.",
      rating: 5,
      date: i18nT("aujourd_hui_ba0603b4"),
      status: "À répondre",
      comment: i18nT("tres_bonne_experience_equipe_reactive_et_16bf7d36"),
    },
    {
      id: "google:preview-2",
      platform: "google",
      reviewName: null,
      name: "Marc D.",
      rating: 4,
      date: i18nT("hier_e6faf8c2"),
      status: "Répondu",
      comment: i18nT("prestation_serieuse_petit_retard_au_demarrage_19ce55cf"),
      reply: i18nT("merci_pour_votre_confiance_et_votre_54ca9ea1"),
    },
    {
      id: "google:preview-3",
      platform: "google",
      reviewName: null,
      name: i18nT("client_google"),
      rating: 2,
      date: i18nT("il_y_a_3_jours_bf5d32c6"),
      status: "À traiter",
      comment: i18nT("je_n_ai_pas_reussi_a_155f1a2e"),
    },
  ];
  const platforms: EReputationReviewsPlatform[] = [
    {
      id: "google",
      label: i18nT("google_2b681c0a"),
      shortLabel: i18nT("google_2b681c0a"),
      iconSrc: "/icons/google.jpg",
      modalKicker: i18nT("avis_google_7cf4e619"),
      replyLabel: i18nT("reponse_google_447ce1c4"),
      reviews: previewGoogleReviews,
      reviewsReady: false,
      reviewsError: null,
      initialNextPageToken: null,
      totalReviewCount: 0,
      averageRatingLabel: "—",
      locationLabel: i18nT("fiche_google_business_09b337dd"),
      statusLabel: i18nT("synchronisation_google_0008de4a"),
      connected: false,
      canReply: false,
      reportUrl: null,
      profileUrl: null,
      inviteUrl: askReviewsHref,
    },
  ];

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <EReputationHeader
          title={i18nT("e_reputation_6f346fbb")}
          tagline={i18nT("tous_vos_avis_google_depuis_une_4c85b97a")}
          sublineDesktop={i18nT("pilotez_vos_avis_preparez_une_reponse_d8961bbf")}
          sublineMobile={i18nT("repondez_a_vos_avis_avec_inrcy_49a4a027")}
          manageLabel={i18nT("gerer_google_5eed5e3d")}
          askReviewsLabel={i18nT("reclamez_des_avis_78f79b2f")}
          closeLabel={i18nT("fermer_5ab4ec64")}
          askReviewsHref={askReviewsHref}
        />

        <EReputationReviewsClient
          reviews={previewGoogleReviews}
          reviewsReady={false}
          reviewsError={null}
          initialNextPageToken={null}
          totalReviewCount={0}
          locationLabel={i18nT("fiche_google_business_09b337dd")}
          statusLabel={i18nT("synchronisation_google_0008de4a")}
          gmbReady={false}
          averageRatingLabel="—"
          reportGoogleUrl={null}
          platforms={platforms}
        />
      </div>
    </main>
  );
}
