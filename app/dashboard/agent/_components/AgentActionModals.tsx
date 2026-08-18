import { useLocale, useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import MediaLibraryPickerModal from "../../_components/MediaLibraryPickerModal";
import styles from "../agent.module.css";
import { channelOptions } from "../_lib/agent.config";
import {
  mailAccountLabel,
  mailAccountSecondaryLabel,
  recipientDisplayName,
  recipientMetaLine,
} from "../_lib/agent.campaign-preview";
import type {
  AgentMailAccount,
  AgentPreparedAction,
  AutomationKey,
  CampaignAttachmentRef,
  CampaignMailPreview,
  CampaignRecipientPreview,
  ChannelKey,
  ScheduleListItem,
  ScheduledActionEditSession,
} from "../_lib/agent.types";

type AgentTranslator = (key: any) => string;

const AGENT_CHANNEL_MESSAGE_KEYS: Partial<Record<ChannelKey, string>> = {
  siteInrcy: "site_inrcy_57016d6f",
  siteWeb: "site_web_7e78af33",
  mails: "mails_8d79d3a8",
};

function localizedAgentChannelLabel(
  channel: ChannelKey,
  translate: AgentTranslator,
) {
  const messageKey = AGENT_CHANNEL_MESSAGE_KEYS[channel];
  return messageKey
    ? translate(messageKey)
    : channelOptions[channel]?.name || channel;
}

function localizedRecipientMetaLine(
  recipient: CampaignRecipientPreview,
  translate: AgentTranslator,
) {
  const label = recipientMetaLine(recipient);
  if (label === "Destinataire libre") {
    return translate("destinataire_libre_27f79223");
  }
  if (label === "Destinataire") return translate("destinataire_56579042");
  return label;
}

function formatLocalizedAttachmentSize(value: number, locale: string) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const unit =
    bytes < 1024
      ? "byte"
      : bytes < 1024 * 1024
        ? "kilobyte"
        : "megabyte";
  const amount =
    unit === "byte"
      ? Math.round(bytes)
      : unit === "kilobyte"
        ? Math.round(bytes / 1024)
        : Number(
            (bytes / 1024 / 1024).toFixed(
              bytes >= 10 * 1024 * 1024 ? 0 : 1,
            ),
          );
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(amount);
}

type CampaignDraftConfirmModalProps = {
  open: boolean;
  isPublishView: boolean;
  campaignMailPreview: CampaignMailPreview | null;
  selectedAutomationKey: AutomationKey;
  previewNavigationChannels: ChannelKey[];
  selectedConfigChannels: ChannelKey[];
  publishContentKind: string;
  saveState: "idle" | "saving";
  onClose: () => void;
  onSavePublish: () => void;
  onSaveCampaign: () => void;
};

export function CampaignDraftConfirmModal({
  open,
  isPublishView,
  campaignMailPreview,
  selectedAutomationKey,
  previewNavigationChannels,
  selectedConfigChannels,
  publishContentKind,
  saveState,
  onClose,
  onSavePublish,
  onSaveCampaign,
}: CampaignDraftConfirmModalProps) {
  const i18nT = useTranslations("agent");
  if (!open || (!campaignMailPreview && !isPublishView)) return null;

  return (
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onClick={() => saveState !== "saving" && onClose()}
    >
      <section
        className={`${styles.settingsModal} ${styles.campaignDraftModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT(
          isPublishView
            ? "draft_save_publication_aria"
            : "draft_save_campaign_aria",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label={i18nT("fermer_5ab4ec64")} disabled={saveState === "saving"}>
          ×
        </button>
        <p className={styles.modalEyebrow}>{i18nT("brouillon_inrsend_38854c1c")}</p>
        <h2>{isPublishView ? i18nT("enregistrer_cette_publication_1116f936") : i18nT("enregistrer_cette_campagne_c80acd9a")}</h2>
        <div className={styles.campaignDraftNotice}>
          <span aria-hidden>💾</span>
          <div>
            <strong>
              {isPublishView
                ? i18nT("la_publication_va_etre_enregistree_en_154b5bc3")
                : i18nT("la_campagne_va_etre_enregistree_en_3c545443")}
            </strong>
            <p>
              {isPublishView
                ? i18nT("vous_pourrez_la_retrouver_plus_tard_c2acfbd6")
                : i18nT("vous_pourrez_la_retrouver_plus_tard_93d2f550", {
                    value0: ` ${i18nT(
                      selectedAutomationKey === "loyalty"
                        ? "fideliser_8fa9e4f1"
                        : "propulser_2de43942",
                    )}`,
                  })}
            </p>
          </div>
        </div>
        <div className={styles.campaignDraftSummary}>
          {isPublishView ? (
            <>
              <small>{i18nT("canaux_27cb4473")}</small>
              <strong>
                {(previewNavigationChannels.length ? previewNavigationChannels : selectedConfigChannels)
                  .map((channel) => localizedAgentChannelLabel(channel, i18nT))
                  .join(" / ") || "—"}
              </strong>
              <small>{i18nT("contenu_f3cb82af")}</small>
              <strong>{publishContentKind || i18nT("publication_e00441c4")}</strong>
            </>
          ) : (
            <>
              <small>{i18nT("objet_3de621c5")}</small>
              <strong>{campaignMailPreview?.subject || "—"}</strong>
              <small>{i18nT("destinataires_prevus_8f9d87d7")}</small>
              <strong>
                {campaignMailPreview?.recipientsCount || 0} {" "}{i18nT("contact_1a73af9e")}{" "}{(campaignMailPreview?.recipientsCount || 0) > 1 ? "s" : ""}
              </strong>
            </>
          )}
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose} disabled={saveState === "saving"}>
            {i18nT("annuler_49ba3292")}{" "}</button>
          <button
            type="button"
            onClick={isPublishView ? onSavePublish : onSaveCampaign}
            disabled={saveState === "saving"}
          >
            {saveState === "saving" ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_en_brouillon_d0c5a1eb")}
          </button>
        </div>
      </section>
    </div>
  );
}

type PublishEditChoiceModalProps = {
  open: boolean;
  isPublishView: boolean;
  hasPreparedAction: boolean;
  mediaName?: string;
  onClose: () => void;
  onOpenText: () => void;
  onOpenMedia: () => void;
};

export function PublishEditChoiceModal({
  open,
  isPublishView,
  hasPreparedAction,
  mediaName,
  onClose,
  onOpenText,
  onOpenMedia,
}: PublishEditChoiceModalProps) {
  const i18nT = useTranslations("agent");
  if (!open || !isPublishView || !hasPreparedAction) return null;
  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={`${styles.settingsModal} ${styles.campaignEditModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("modifier_la_publication_295870a4")}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
        <p className={styles.modalEyebrow}>{i18nT("publication_inr_agent_62b957d7")}</p>
        <h2>{i18nT("modifier_la_publication_295870a4")}</h2>
        <div className={styles.campaignEditGrid}>
          <button type="button" onClick={onOpenText}>
            <strong>{i18nT("contenu_f3cb82af")}</strong>
            <small>{i18nT("modifier_le_titre_le_texte_le_325c7a96")}</small>
          </button>
          <button type="button" onClick={onOpenMedia}>
            <strong>{i18nT("media_d8a313d3")}</strong>
            <small>{mediaName ? i18nT("media_actuel_value_36aa9a80", { value0: mediaName }) : i18nT("ajouter_remplacer_ou_adapter_l_image_042b8754")}</small>
          </button>
        </div>
      </section>
    </div>
  );
}

type CampaignEditChoiceModalProps = {
  open: boolean;
  preview: CampaignMailPreview | null;
  attachmentCount: number;
  onClose: () => void;
  onOpenText: () => void;
  onOpenAttachments: () => void;
  onOpenRecipients: () => void;
  onOpenMailAccount: () => void;
};

export function CampaignEditChoiceModal({
  open,
  preview,
  attachmentCount,
  onClose,
  onOpenText,
  onOpenAttachments,
  onOpenRecipients,
  onOpenMailAccount,
}: CampaignEditChoiceModalProps) {
  const i18nT = useTranslations("agent");
  if (!open || !preview) return null;
  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={`${styles.settingsModal} ${styles.campaignEditModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("modifier_la_campagne_cb246f76")}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
        <p className={styles.modalEyebrow}>{i18nT("campagne_inr_agent_fa7db334")}</p>
        <h2>{i18nT("modifier_la_campagne_cb246f76")}</h2>
        <div className={styles.campaignEditGrid}>
          <button type="button" onClick={onOpenText}>
            <strong>{i18nT("texte_du_mail_47e3722c")}</strong>
            <small>{i18nT("modifier_l_objet_et_le_corps_6c600d4a")}</small>
          </button>
          <button type="button" onClick={onOpenAttachments}>
            <strong>{i18nT("piece_jointe_2ecefd2c")}</strong>
            <small>{attachmentCount > 0 ? i18nT("value_fichier_value_34309747", { value0: attachmentCount, value1: attachmentCount > 1 ? "s" : "" }) : i18nT("ajouter_ou_remplacer_un_fichier_20caa78d")}</small>
          </button>
          <button type="button" onClick={onOpenRecipients}>
            <strong>{i18nT("destinataires_crm_beffd723")}</strong>
            <small>
              {preview.recipientsCount} {" "}{i18nT("contact_1a73af9e")}{preview.recipientsCount > 1 ? "s" : ""} {" "}{i18nT("prevu_37c9337b")}{" "}{preview.recipientsCount > 1 ? "s" : ""}{i18nT("voir_la_liste_6f48769b")}{" "}</small>
          </button>
          <button type="button" onClick={onOpenMailAccount}>
            <strong>{i18nT("boite_d_envoi_8af123c1")}</strong>
            <small>{preview.mailAccountLabel}</small>
          </button>
        </div>
      </section>
    </div>
  );
}

type RecipientsPreviewModalProps = {
  open: boolean;
  preview: CampaignMailPreview | null;
  recipients: CampaignRecipientPreview[];
  onClose: () => void;
  onEdit: () => void;
};

export function RecipientsPreviewModal({ open, preview, recipients, onClose, onEdit }: RecipientsPreviewModalProps) {
  const i18nT = useTranslations("agent");
  if (!open || !preview) return null;
  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={`${styles.settingsModal} ${styles.agentListModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("destinataires_prevus_8f9d87d7")}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
        <p className={styles.modalEyebrow}>{i18nT("destinataires_51610ad7")}</p>
        <h2>
          {recipients.length} {" "}{i18nT("contact_1a73af9e")}{recipients.length > 1 ? "s" : ""} {" "}{i18nT("prevu_37c9337b")}{recipients.length > 1 ? "s" : ""}
        </h2>
        <div className={styles.agentListScroll}>
          {recipients.length > 0 ? (
            recipients.map((recipient) => (
              <article key={recipient.email} className={`${styles.agentListRow} ${styles.agentRecipientRow}`}>
                <span className={styles.agentListContent}>
                  <strong className={styles.agentRecipientMain}>
                    <span>{recipientDisplayName(recipient)}</span>
                    <em>— {recipient.email}</em>
                  </strong>
                  <small>{localizedRecipientMetaLine(recipient, i18nT)}</small>
                </span>
              </article>
            ))
          ) : (
            <p className={styles.campaignEditHint}>{i18nT("aucun_destinataire_n_est_prevu_pour_65410721")}</p>
          )}
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>{i18nT("fermer_5ab4ec64")}</button>
          <button type="button" onClick={onEdit}>{i18nT("modifier_les_destinataires_3a589ae7")}</button>
        </div>
      </section>
    </div>
  );
}

type MailAccountEditModalProps = {
  open: boolean;
  preview: CampaignMailPreview | null;
  accounts: AgentMailAccount[];
  loading: boolean;
  selectedAccountId: string;
  saveState: "idle" | "saving";
  onSelect: (accountId: string) => void;
  onClose: () => void;
  onSave: () => void;
};

export function MailAccountEditModal({
  open,
  preview,
  accounts,
  loading,
  selectedAccountId,
  saveState,
  onSelect,
  onClose,
  onSave,
}: MailAccountEditModalProps) {
  const i18nT = useTranslations("agent");
  if (!open || !preview) return null;
  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={`${styles.settingsModal} ${styles.agentListModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("modifier_la_boite_d_envoi_a79d173b")}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
        <p className={styles.modalEyebrow}>{i18nT("boite_d_envoi_8af123c1")}</p>
        <h2>{i18nT("choisir_la_boite_mail_8804ac3f")}</h2>
        <div className={styles.agentListScroll}>
          {loading ? (
            <p className={styles.campaignEditHint}>{i18nT("chargement_des_boites_connectees_0e870b3a")}</p>
          ) : accounts.length > 0 ? (
            accounts.map((account) => {
              const usable = account.status === "connected" && account.connection_status !== "needs_update" && !account.requires_update;
              return (
                <label key={account.id} className={`${styles.agentListRow} ${styles.agentSelectableRow} ${!usable ? styles.agentDisabledRow : ""}`}>
                  <input
                    type="radio"
                    name="agent-mail-account"
                    checked={selectedAccountId === account.id}
                    disabled={!usable}
                    onChange={() => onSelect(account.id)}
                  />
                  <span className={styles.agentListAvatar} aria-hidden>✉</span>
                  <span className={styles.agentListContent}>
                    <strong>{mailAccountLabel(account)}</strong>
                    <small>{mailAccountSecondaryLabel(account)}{usable ? i18nT("connectee_fea289b7") : i18nT("a_reconnecter_45087b6f")}</small>
                  </span>
                  <span className={styles.agentListTag}>{usable ? i18nT("ok_9ce3bd42") : i18nT("a_corriger_4e4cde57")}</span>
                </label>
              );
            })
          ) : (
            <p className={styles.campaignEditHint}>{i18nT("aucune_boite_mail_connectee_connecte_une_98952f86")}</p>
          )}
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose} disabled={saveState === "saving"}>{i18nT("annuler_49ba3292")}</button>
          <button type="button" onClick={onSave} disabled={saveState === "saving" || !selectedAccountId}>
            {saveState === "saving" ? i18nT("enregistrement_9bf1058a") : i18nT("utiliser_cette_boite_38fae254")}
          </button>
        </div>
      </section>
    </div>
  );
}

type AttachmentModalProps = {
  open: boolean;
  preview: CampaignMailPreview | null;
  attachments: CampaignAttachmentRef[];
  uploadState: "idle" | "saving";
  libraryPickerOpen: boolean;
  onClose: () => void;
  onFilesSelected: (files: FileList | null) => void;
  onOpenLibrary: () => void;
  onCloseLibrary: () => void;
  onConfirmLibrary: ComponentProps<typeof MediaLibraryPickerModal>["onConfirm"];
  maxAttachmentBytes: number;
  onOpenOptimizer: ComponentProps<typeof MediaLibraryPickerModal>["onOpenOptimizer"];
  onOversizedMedia: ComponentProps<typeof MediaLibraryPickerModal>["onOversizedMedia"];
  onRemove: (path: string) => void;
};

export function AttachmentModal({
  open,
  preview,
  attachments,
  uploadState,
  libraryPickerOpen,
  onClose,
  onFilesSelected,
  onOpenLibrary,
  onCloseLibrary,
  onConfirmLibrary,
  maxAttachmentBytes,
  onOpenOptimizer,
  onOversizedMedia,
  onRemove,
}: AttachmentModalProps) {
  const locale = useLocale();
  const i18nT = useTranslations("agent");
  if (!open || !preview) return null;
  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={`${styles.settingsModal} ${styles.attachmentModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("piece_jointe_2ecefd2c")}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
        <p className={styles.modalEyebrow}>{i18nT("piece_jointe_2ecefd2c")}</p>
        <h2>{attachments.length > 0 ? i18nT("pieces_jointes_98d89a25") : i18nT("ajouter_une_piece_jointe_fec460dc")}</h2>
        <div className={styles.attachmentUploadBox}>
          <input
            id="agent-campaign-attachment"
            type="file"
            multiple
            onChange={(event) => {
              onFilesSelected(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
            disabled={uploadState === "saving"}
          />
          <div className={styles.campaignAttachmentActionButtons}>
            <label htmlFor="agent-campaign-attachment">
              <span aria-hidden>📎</span>
              {uploadState === "saving" ? i18nT("preparation_2c6b897e") : i18nT("joindre_2ee36407")}
            </label>
            <button type="button" onClick={onOpenLibrary} disabled={uploadState === "saving"}>
              <span aria-hidden>🖼️</span>
              {i18nT("mediatheque_e4fa8e31")}{" "}</button>
          </div>
          <small>{i18nT("20_mo_maximum_par_fichier_les_bc9d123e")}</small>
        </div>

        <MediaLibraryPickerModal
          open={libraryPickerOpen}
          title={i18nT("joindre_depuis_la_mediatheque_132a0a6b")}
          subtitle={i18nT("attachment_library_subtitle")}
          accept="all"
          multiple
          maxSelection={10}
          maxImageBytes={maxAttachmentBytes}
          maxVideoBytes={maxAttachmentBytes}
          confirmLabel={i18nT("joindre_2ee36407")}
          selectedHint={i18nT("choisissez_les_medias_a_joindre_a_58b1d39a")}
          onOpenOptimizer={onOpenOptimizer}
          onOversizedMedia={onOversizedMedia}
          onClose={onCloseLibrary}
          onConfirm={onConfirmLibrary}
        />
        {attachments.length > 0 ? (
          <div className={styles.attachmentList}>
            {attachments.map((attachment) => (
              <div key={`${attachment.bucket}-${attachment.path}`} className={styles.attachmentListRow}>
                <span aria-hidden>📄</span>
                <strong>{attachment.name}</strong>
                <small>
                  {attachment.type || i18nT("document_e214b8a2")}
                  {attachment.size
                    ? ` · ${formatLocalizedAttachmentSize(attachment.size, locale)}`
                    : ""}
                </small>
                <button type="button" onClick={() => onRemove(attachment.path)} disabled={uploadState === "saving"}>
                  {i18nT("supprimer_1acfc1c7")}{" "}</button>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.campaignEditHint}>{i18nT("aucune_piece_jointe_n_est_prevue_cf88fd9f")}</p>
        )}
      </section>
    </div>
  );
}

function ScheduleChannelCell({ labels }: { labels: string[] }) {
  const cleanedLabels = labels.filter(Boolean);
  const primaryLabel = cleanedLabels[0] || "—";
  const extraLabels = cleanedLabels.slice(1);
  if (extraLabels.length === 0) return <span className={styles.scheduleChannelSingle}>{primaryLabel}</span>;
  return (
    <details className={styles.scheduleChannelDetails}>
      <summary className={styles.scheduleChannelSummary}>
        <span>{primaryLabel}</span>
        <span className={styles.scheduleChannelChevron} aria-hidden="true">▾</span>
      </summary>
      <div className={styles.scheduleChannelMenu}>
        {cleanedLabels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </details>
  );
}

type AgentScheduleModalProps = {
  open: boolean;
  items: ScheduleListItem[];
  mutationState: "idle" | "saving";
  onClose: () => void;
  onModify: (item: ScheduleListItem) => void;
  onDelete: (item: ScheduleListItem) => void;
};

export function AgentScheduleModal({ open, items, mutationState, onClose, onModify, onDelete }: AgentScheduleModalProps) {
  const i18nT = useTranslations("agent");
  if (!open) return null;
  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={`${styles.settingsModal} ${styles.scheduleModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("actions_programmees_77ae2684")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.scheduleModalHeader}>
          <div className={styles.scheduleModalTitle}>
            <p className={styles.modalEyebrow}>{i18nT("programmation_6255df3b")}</p>
            <h2>{i18nT("actions_programmees_77ae2684")}</h2>
          </div>
          <div className={styles.scheduleModalHeaderActions}>
            <div className={styles.scheduleSummaryPill} aria-label={i18nT("value_actions_a_venir_11a80df3", { value0: items.length })}>
              <strong>{items.length}</strong>
              <span>{i18nT("actions_a_venir_a611605d")}</span>
            </div>
            <button type="button" className={styles.scheduleCloseButton} onClick={onClose}>{i18nT("fermer_5ab4ec64")}</button>
          </div>
        </div>

        <section className={styles.scheduleSection}>
          <div className={styles.scheduleSectionHeader}>
            <strong>{i18nT("actions_a_venir_7f041ed9")}</strong>
            <span>{i18nT("ordre_chronologique_38b17a1e")}</span>
          </div>
          {items.length > 0 ? (
            <div className={styles.scheduleTable} role="table" aria-label={i18nT("actions_programmees_a_venir_c1f610d0")}>
              <div className={styles.scheduleTableHeader} role="row">
                <span>{i18nT("date_eb9a4bc1")}</span><span>{i18nT("heure_5073129f")}</span><span>{i18nT("action_97c89a4d")}</span><span>{i18nT("type_3deb7456")}</span><span>{i18nT("canal_61f21e6f")}</span><span>{i18nT("origine_62e96258")}</span><span>{i18nT("actions_c3cd636a")}</span>
              </div>
              {items.map((item) => (
                <div key={item.id} className={styles.scheduleTableRow} data-status={item.statusKey} role="row">
                  <span>{item.date}</span>
                  <span>{item.time}</span>
                  <span className={styles.scheduleActionCell} title={item.action}>{item.action}</span>
                  <span>{item.typeLabel}</span>
                  <span className={styles.scheduleChannelCell}><ScheduleChannelCell labels={item.channelLabels} /></span>
                  <span>{item.originLabel}</span>
                  <span className={styles.scheduleActionsCell}>
                    <button
                      type="button"
                      className={styles.scheduleIconButton}
                      onClick={() => onModify(item)}
                      disabled={!item.editable || mutationState === "saving"}
                      aria-label={i18nT(
                        item.source === "automatic" ||
                          item.automationKey === "stats"
                          ? "modifier_la_programmation_2bdd7cdc"
                          : "edit_content",
                      )}
                      title={i18nT(
                        item.source === "automatic" ||
                          item.automationKey === "stats"
                          ? "modifier_la_programmation_2bdd7cdc"
                          : "edit_content",
                      )}
                    >
                      {item.source === "automatic" || item.automationKey === "stats" ? "🕘" : "✎"}
                    </button>
                    <button
                      type="button"
                      className={`${styles.scheduleIconButton} ${styles.scheduleIconDanger}`}
                      onClick={() => onDelete(item)}
                      disabled={!item.removable || mutationState === "saving"}
                      aria-label={i18nT("supprimer_1acfc1c7")}
                      title={i18nT("supprimer_1acfc1c7")}
                    >
                      🗑
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.scheduleEmpty}>{i18nT("aucune_action_programmee_a_venir_a0bce831")}</p>
          )}
        </section>
      </section>
    </div>
  );
}

type ValidationChoiceModalProps = {
  open: boolean;
  selectedPreparedAction: AgentPreparedAction | null;
  scheduledEditSession: ScheduledActionEditSession | null;
  mutationState: "idle" | "saving";
  onClose: () => void;
  onRunNow: () => void;
  onSchedule: () => void;
};

export function ValidationChoiceModal({
  open,
  selectedPreparedAction,
  scheduledEditSession,
  mutationState,
  onClose,
  onRunNow,
  onSchedule,
}: ValidationChoiceModalProps) {
  const i18nT = useTranslations("agent");
  if (!open || !selectedPreparedAction) return null;
  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={() => mutationState !== "saving" && onClose()}>
      <section
        className={`${styles.settingsModal} ${styles.validationChoiceModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("valider_l_action_inr_agent_be980832")}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} disabled={mutationState === "saving"} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
        <p className={styles.modalEyebrow}>{i18nT("validation_dd74d182")}</p>
        <h2>
          {scheduledEditSession
            ? i18nT("que_faire_de_cette_action_programmee_6ed6ff22")
            : selectedPreparedAction.automationKey === "publish"
              ? i18nT("publier_cette_action_333559e3")
              : i18nT("envoyer_cette_campagne_fe09ca14")}
        </h2>
        <p className={styles.modalHint}>
          {scheduledEditSession
            ? i18nT("vous_pouvez_lancer_maintenant_ce_contenu_8c5a8a4d")
            : i18nT("l_action_est_prete_vous_pouvez_91507571")}
        </p>
        <div className={styles.validationChoiceGrid}>
          <button type="button" className={styles.validationChoiceCard} onClick={onRunNow} disabled={mutationState === "saving"}>
            <span aria-hidden>⚡</span>
            <strong>
              {scheduledEditSession
                ? i18nT("lancer_maintenant_7bd5005e")
                : selectedPreparedAction.automationKey === "publish"
                  ? i18nT("publier_maintenant_b99ae0df")
                  : i18nT("envoyer_maintenant_54fbd09c")}
            </strong>
            <small>
              {scheduledEditSession
                ? i18nT("inr_agent_execute_l_action_immediatement_eae4b203")
                : i18nT("inr_agent_execute_l_action_immediatement_9dc25e33")}
            </small>
          </button>
          <button type="button" className={styles.validationChoiceCard} onClick={onSchedule} disabled={mutationState === "saving"}>
            <span aria-hidden>🕒</span>
            <strong>
              {scheduledEditSession
                ? i18nT("programmer_f704a30b")
                : selectedPreparedAction.automationKey === "publish"
                  ? i18nT("programmer_la_publication_a364ade3")
                  : i18nT("programmer_l_envoi_1c7213bd")}
            </strong>
            <small>{i18nT("les_informations_actuelles_sont_preremplies_c8604211")}</small>
          </button>
        </div>
      </section>
    </div>
  );
}
