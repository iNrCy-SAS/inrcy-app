import { useTranslations } from "next-intl";
import HelpModal from "../../../_components/HelpModal";

type PublishHelpModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function PublishHelpModal({ open, onClose }: PublishHelpModalProps) {
  const i18nT = useTranslations("booster");
  return (
    <HelpModal
      open={open}
      title={i18nT("publication_et_inr_send_c17d0272")}
      onClose={onClose}
    >
      <div style={{ display: "grid", gap: 12, lineHeight: 1.6 }}>
        <p style={{ margin: 0 }}>
          {i18nT("apres_publication_retrouvez_cette_communication__73a845a5")}{" "}
          <strong>{i18nT("inr_send_publications_7f6fad49")}</strong>.
        </p>
        <p style={{ margin: 0 }}>
          {i18nT("vous_pourrez_la_consulter_la_modifier_843e6f8c")}{" "}</p>
        <div
          style={{
            display: "grid",
            gap: 8,
            borderTop: "1px solid rgba(255,255,255,0.12)",
            paddingTop: 10,
          }}
        >
          <strong>{i18nT("etats_des_canaux_5de3d550")}</strong>
          <div style={{ display: "grid", gap: 6 }}>
            <div>
              <span style={{ color: "#5ee28a", fontWeight: 900 }}>{i18nT("vert_3c5c52d3")}</span>{" "}
              {i18nT("pret_complet_421a7bec")}{" "}</div>
            <div>
              <span style={{ color: "#f2c94c", fontWeight: 900 }}>{i18nT("jaune_c5638e23")}</span>{" "}
              {i18nT("a_verifier_publication_possible_6615733e")}{" "}</div>
            <div>
              <span style={{ color: "#ff8a8a", fontWeight: 900 }}>{i18nT("rouge_612cfdba")}</span>{" "}
              {i18nT("canal_vide_publication_bloquee_ad7e05b8")}{" "}</div>
          </div>
          <p style={{ margin: 0 }}>
            {i18nT("texte_seul_ou_image_seule_autorise_19d639c4")}{" "}</p>
        </div>
      </div>
    </HelpModal>
  );
}
