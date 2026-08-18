import { useTranslations } from "next-intl";
import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import SettingsDrawer from "../../SettingsDrawer";
import HelpButton from "../../_components/HelpButton";
import HelpModal from "../../_components/HelpModal";
import MailsSettingsContent from "../../settings/_components/MailsSettingsContent";
import { useUnsavedExitGuard } from "../../_hooks/useUnsavedExitGuard";
import ResponsiveActionButton from "../../_components/ResponsiveActionButton";
import { getInrSendRetentionLabel } from "@/lib/inrsendRetention";
import styles from "../mails.module.css";

type Props = {
  helpOpen: boolean;
  settingsOpen: boolean;
  onOpenHelp: () => void;
  onCloseHelp: () => void;
  onOpenFolders: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  standardMode?: boolean;
};

export default function MailboxHeader({
  helpOpen,
  settingsOpen,
  onOpenHelp,
  onCloseHelp,
  onOpenFolders,
  onOpenSettings,
  onCloseSettings,
  standardMode = false,
}: Props) {
  const i18nT = useTranslations("mails");
  const [settingsHasUnsavedChanges, setSettingsHasUnsavedChanges] = useState(false);
  useEffect(() => {
    if (!settingsOpen) setSettingsHasUnsavedChanges(false);
  }, [settingsOpen]);

  const { confirmExit: confirmSettingsExit } = useUnsavedExitGuard({
    active: settingsOpen,
    shouldBlock: settingsHasUnsavedChanges,
    onConfirmExit: onCloseSettings,
    eyebrow: i18nT("reglages_mails_a1957d12"),
    title: i18nT("quitter_sans_enregistrer_6208bd94"),
    message: i18nT("ces_reglages_contiennent_des_modifications_non_a3c8a17d"),
    confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });
  const requestCloseSettings = useCallback(() => {
    void confirmSettingsExit();
  }, [confirmSettingsExit]);

  return (
    <>
      <div className={styles.header}>
        <div className={styles.brand}>
          <Image
            src="/inrsend-logo.png"
            alt={i18nT("inr_send_98e1b891")}
            width={154}
            height={64}
            priority
            className={styles.brandIcon}
          />

          <div className={styles.brandText}>
            <div className={styles.brandRow}>
              <span className={styles.tagline}>
                {standardMode
                  ? i18nT("l_historique_de_toutes_vos_publications_c942d840")
                  : i18nT("toutes_vos_communications_depuis_une_seule_eecb4544")}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <HelpButton onClick={onOpenHelp} title={i18nT("aide_inr_send_06cbaaf9")} />

          {!standardMode ? (
            <>
              <button
                className={`${styles.btnGhost} ${styles.iconOnlyBtn} ${styles.hamburgerBtn}`}
                onClick={onOpenFolders}
                type="button"
                aria-label={i18nT("dossiers_2a59919f")}
                title={i18nT("dossiers_2a59919f")}
              >
                <span aria-hidden>☰</span>
                <span className={styles.srOnly}>{i18nT("dossiers_2a59919f")}</span>
              </button>

              <ResponsiveActionButton
                desktopLabel={i18nT("reglages_00d63297")}
                mobileIcon="⚙️"
                onClick={onOpenSettings}
              />

              <SettingsDrawer
                title={i18nT("reglages_mails_a1957d12")}
                isOpen={settingsOpen}
                onClose={requestCloseSettings}
                closeOnBackdrop={false}
                closeOnEscape={false}
              >
                <MailsSettingsContent onUnsavedChange={setSettingsHasUnsavedChanges} />
              </SettingsDrawer>
            </>
          ) : null}

          <ResponsiveActionButton
            desktopLabel={i18nT("fermer_5ab4ec64")}
            mobileIcon="✕"
            href="/dashboard"
            title={i18nT("fermer_inr_send_af3bf63f")}
          />
        </div>
      </div>

      <HelpModal open={helpOpen} title={i18nT("inr_send_98e1b891")} onClose={onCloseHelp}>
        <p style={{ marginTop: 0 }}>
          {standardMode
            ? i18nT("inr_send_conserve_l_historique_de_dbe7414c")
            : i18nT("inr_send_est_le_centre_d_245bc065")}
        </p>
        {standardMode ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>{i18nT("retrouvez_le_resultat_de_chaque_publication_a7900687")}</li>
            <li>{i18nT("consultez_le_detail_canal_par_canal_fc4be278")}</li>
            <li>{i18nT("relancez_ou_corrigez_une_publication_lorsque_df50de0a")}</li>
          </ul>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>{i18nT("centralisez_vos_echanges_et_vos_messages_51c4769a")}</li>
            <li>{i18nT("gagnez_du_temps_pour_communiquer_sur_99ee117e")}</li>
            <li>{i18nT("utilisez_les_reglages_pour_connecter_configurer_73a0b071")}</li>
          </ul>
        )}

        <div style={{ marginTop: 16 }}>
          <strong>{i18nT("durees_d_affichage_dans_inr_send_63a8688d")}</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li>{i18nT("publications_value_b1beddf7", { value0: getInrSendRetentionLabel("publications") })}</li>
            {!standardMode ? (
              <>
                <li>{i18nT("propulsions_value_6041847f", { value0: getInrSendRetentionLabel("propulsions") })}</li>
                <li>{i18nT("fidelisations_value_8453cedc", { value0: getInrSendRetentionLabel("fidelisations") })}</li>
                <li>{i18nT("mails_value_06a6c395", { value0: getInrSendRetentionLabel("mails") })}</li>
                <li>{i18nT("devis_value_2759ff13", { value0: getInrSendRetentionLabel("devis") })}</li>
                <li>{i18nT("factures_value_fd6f4118", { value0: getInrSendRetentionLabel("factures") })}</li>
              </>
            ) : null}
          </ul>
          <p style={{ margin: "10px 0 0", opacity: 0.86 }}>
            {i18nT("ces_durees_concernent_uniquement_l_historique_c2600148")}{" "}</p>
        </div>

        <div style={{ marginTop: 14 }}>
          <strong>{i18nT("suppression_des_historiques_00f809a7")}</strong>
          <p style={{ margin: "8px 0 0", opacity: 0.86 }}>
            {i18nT("aucune_suppression_manuelle_n_est_disponible_0685aa74")}{" "}</p>
        </div>
      </HelpModal>
    </>
  );
}
