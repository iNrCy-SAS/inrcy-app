import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
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
  translate: AgentTranslator
) {
  const messageKey = AGENT_CHANNEL_MESSAGE_KEYS[channel];
  return messageKey
    ? translate(messageKey)
    : channelOptions[channel]?.name || channel;
}

function localizedRecipientMetaLine(
  recipient: CampaignRecipientPreview,
  translate: AgentTranslator
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
    bytes < 1024 ? "byte" : bytes < 1024 * 1024 ? "kilobyte" : "megabyte";
  const amount =
    unit === "byte"
      ? Math.round(bytes)
      : unit === "kilobyte"
      ? Math.round(bytes / 1024)
      : Number(
          (bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)
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
            : "draft_save_campaign_aria"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={i18nT("fermer_5ab4ec64")}
          disabled={saveState === "saving"}
        >
          ×
        </button>
        <p className={styles.modalEyebrow}>
          {i18nT("brouillon_inrsend_38854c1c")}
        </p>
        <h2>
          {isPublishView
            ? i18nT("enregistrer_cette_publication_1116f936")
            : i18nT("enregistrer_cette_campagne_c80acd9a")}
        </h2>
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
                        : "propulser_2de43942"
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
                {(previewNavigationChannels.length
                  ? previewNavigationChannels
                  : selectedConfigChannels
                )
                  .map((channel) => localizedAgentChannelLabel(channel, i18nT))
                  .join(" / ") || "—"}
              </strong>
              <small>{i18nT("contenu_f3cb82af")}</small>
              <strong>
                {publishContentKind || i18nT("publication_e00441c4")}
              </strong>
            </>
          ) : (
            <>
              <small>{i18nT("objet_3de621c5")}</small>
              <strong>{campaignMailPreview?.subject || "—"}</strong>
              <small>{i18nT("destinataires_prevus_8f9d87d7")}</small>
              <strong>
                {campaignMailPreview?.recipientsCount || 0}{" "}
                {i18nT("contact_1a73af9e")}{" "}
                {(campaignMailPreview?.recipientsCount || 0) > 1 ? "s" : ""}
              </strong>
            </>
          )}
        </div>
        <div className={styles.modalActions}>
          <button
            type="button"
            onClick={onClose}
            disabled={saveState === "saving"}
          >
            {i18nT("annuler_49ba3292")}{" "}
          </button>
          <button
            type="button"
            onClick={isPublishView ? onSavePublish : onSaveCampaign}
            disabled={saveState === "saving"}
          >
            {saveState === "saving"
              ? i18nT("enregistrement_9bf1058a")
              : i18nT("enregistrer_en_brouillon_d0c5a1eb")}
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
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={i18nT("fermer_5ab4ec64")}
        >
          ×
        </button>
        <p className={styles.modalEyebrow}>
          {i18nT("publication_inr_agent_62b957d7")}
        </p>
        <h2>{i18nT("modifier_la_publication_295870a4")}</h2>
        <div className={styles.campaignEditGrid}>
          <button type="button" onClick={onOpenText}>
            <strong>{i18nT("contenu_f3cb82af")}</strong>
            <small>{i18nT("modifier_le_titre_le_texte_le_325c7a96")}</small>
          </button>
          <button type="button" onClick={onOpenMedia}>
            <strong>{i18nT("media_d8a313d3")}</strong>
            <small>
              {mediaName
                ? i18nT("media_actuel_value_36aa9a80", { value0: mediaName })
                : i18nT("ajouter_remplacer_ou_adapter_l_image_042b8754")}
            </small>
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
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={i18nT("fermer_5ab4ec64")}
        >
          ×
        </button>
        <p className={styles.modalEyebrow}>
          {i18nT("campagne_inr_agent_fa7db334")}
        </p>
        <h2>{i18nT("modifier_la_campagne_cb246f76")}</h2>
        <div className={styles.campaignEditGrid}>
          <button type="button" onClick={onOpenText}>
            <strong>{i18nT("texte_du_mail_47e3722c")}</strong>
            <small>{i18nT("modifier_l_objet_et_le_corps_6c600d4a")}</small>
          </button>
          <button type="button" onClick={onOpenAttachments}>
            <strong>{i18nT("piece_jointe_2ecefd2c")}</strong>
            <small>
              {attachmentCount > 0
                ? i18nT("value_fichier_value_34309747", {
                    value0: attachmentCount,
                    value1: attachmentCount > 1 ? "s" : "",
                  })
                : i18nT("ajouter_ou_remplacer_un_fichier_20caa78d")}
            </small>
          </button>
          <button type="button" onClick={onOpenRecipients}>
            <strong>{i18nT("destinataires_crm_beffd723")}</strong>
            <small>
              {preview.recipientsCount} {i18nT("contact_1a73af9e")}
              {preview.recipientsCount > 1 ? "s" : ""} {i18nT("prevu_37c9337b")}{" "}
              {preview.recipientsCount > 1 ? "s" : ""}
              {i18nT("voir_la_liste_6f48769b")}{" "}
            </small>
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

export function RecipientsPreviewModal({
  open,
  preview,
  recipients,
  onClose,
  onEdit,
}: RecipientsPreviewModalProps) {
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
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={i18nT("fermer_5ab4ec64")}
        >
          ×
        </button>
        <p className={styles.modalEyebrow}>{i18nT("destinataires_51610ad7")}</p>
        <h2>
          {recipients.length} {i18nT("contact_1a73af9e")}
          {recipients.length > 1 ? "s" : ""} {i18nT("prevu_37c9337b")}
          {recipients.length > 1 ? "s" : ""}
        </h2>
        <div className={styles.agentListScroll}>
          {recipients.length > 0 ? (
            recipients.map((recipient) => (
              <article
                key={recipient.email}
                className={`${styles.agentListRow} ${styles.agentRecipientRow}`}
              >
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
            <p className={styles.campaignEditHint}>
              {i18nT("aucun_destinataire_n_est_prevu_pour_65410721")}
            </p>
          )}
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>
            {i18nT("fermer_5ab4ec64")}
          </button>
          <button type="button" onClick={onEdit}>
            {i18nT("modifier_les_destinataires_3a589ae7")}
          </button>
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
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={i18nT("fermer_5ab4ec64")}
        >
          ×
        </button>
        <p className={styles.modalEyebrow}>{i18nT("boite_d_envoi_8af123c1")}</p>
        <h2>{i18nT("choisir_la_boite_mail_8804ac3f")}</h2>
        <div className={styles.agentListScroll}>
          {loading ? (
            <p className={styles.campaignEditHint}>
              {i18nT("chargement_des_boites_connectees_0e870b3a")}
            </p>
          ) : accounts.length > 0 ? (
            accounts.map((account) => {
              const usable =
                account.status === "connected" &&
                account.connection_status !== "needs_update" &&
                !account.requires_update;
              return (
                <label
                  key={account.id}
                  className={`${styles.agentListRow} ${
                    styles.agentSelectableRow
                  } ${!usable ? styles.agentDisabledRow : ""}`}
                >
                  <input
                    type="radio"
                    name="agent-mail-account"
                    checked={selectedAccountId === account.id}
                    disabled={!usable}
                    onChange={() => onSelect(account.id)}
                  />
                  <span className={styles.agentListAvatar} aria-hidden>
                    ✉
                  </span>
                  <span className={styles.agentListContent}>
                    <strong>{mailAccountLabel(account)}</strong>
                    <small>
                      {mailAccountSecondaryLabel(account)}
                      {usable
                        ? i18nT("connectee_fea289b7")
                        : i18nT("a_reconnecter_45087b6f")}
                    </small>
                  </span>
                  <span className={styles.agentListTag}>
                    {usable
                      ? i18nT("ok_9ce3bd42")
                      : i18nT("a_corriger_4e4cde57")}
                  </span>
                </label>
              );
            })
          ) : (
            <p className={styles.campaignEditHint}>
              {i18nT("aucune_boite_mail_connectee_connecte_une_98952f86")}
            </p>
          )}
        </div>
        <div className={styles.modalActions}>
          <button
            type="button"
            onClick={onClose}
            disabled={saveState === "saving"}
          >
            {i18nT("annuler_49ba3292")}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saveState === "saving" || !selectedAccountId}
          >
            {saveState === "saving"
              ? i18nT("enregistrement_9bf1058a")
              : i18nT("utiliser_cette_boite_38fae254")}
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
  onOpenOptimizer: ComponentProps<
    typeof MediaLibraryPickerModal
  >["onOpenOptimizer"];
  onOversizedMedia: ComponentProps<
    typeof MediaLibraryPickerModal
  >["onOversizedMedia"];
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
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          aria-label={i18nT("fermer_5ab4ec64")}
        >
          ×
        </button>
        <p className={styles.modalEyebrow}>{i18nT("piece_jointe_2ecefd2c")}</p>
        <h2>
          {attachments.length > 0
            ? i18nT("pieces_jointes_98d89a25")
            : i18nT("ajouter_une_piece_jointe_fec460dc")}
        </h2>
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
              {uploadState === "saving"
                ? i18nT("preparation_2c6b897e")
                : i18nT("joindre_2ee36407")}
            </label>
            <button
              type="button"
              onClick={onOpenLibrary}
              disabled={uploadState === "saving"}
            >
              <span aria-hidden>🖼️</span>
              {i18nT("mediatheque_e4fa8e31")}{" "}
            </button>
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
              <div
                key={`${attachment.bucket}-${attachment.path}`}
                className={styles.attachmentListRow}
              >
                <span aria-hidden>📄</span>
                <strong>{attachment.name}</strong>
                <small>
                  {attachment.type || i18nT("document_e214b8a2")}
                  {attachment.size
                    ? ` · ${formatLocalizedAttachmentSize(
                        attachment.size,
                        locale
                      )}`
                    : ""}
                </small>
                <button
                  type="button"
                  onClick={() => onRemove(attachment.path)}
                  disabled={uploadState === "saving"}
                >
                  {i18nT("supprimer_1acfc1c7")}{" "}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.campaignEditHint}>
            {i18nT("aucune_piece_jointe_n_est_prevue_cf88fd9f")}
          </p>
        )}
      </section>
    </div>
  );
}

type ScheduleCalendarGroup = {
  key: string;
  dayKey: string;
  primary: ScheduleListItem;
  channelLabels: string[];
  itemCount: number;
};

type ScheduleFilterKey = "publications" | "stats" | "campaigns";

const DEFAULT_SCHEDULE_FILTERS: Record<ScheduleFilterKey, boolean> = {
  publications: true,
  stats: true,
  campaigns: true,
};

function scheduleFilterKey(item: ScheduleListItem): ScheduleFilterKey {
  if (item.automationKey === "stats") return "stats";
  if (item.automationKey === "grow" || item.automationKey === "loyalty") {
    return "campaigns";
  }
  if (item.automationKey === "publish") return "publications";

  const searchable = [
    item.action,
    item.typeLabel,
    item.channelLabel,
    ...item.channelLabels,
  ]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(stat|statistique|bilan|rapport)\b/.test(searchable)) return "stats";
  if (/\b(campagne|mail|email|propulser|fideliser)\b/.test(searchable)) {
    return "campaigns";
  }
  return "publications";
}

function scheduleItemLocalDate(item: ScheduleListItem) {
  const dateParts = item.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const timeParts = item.time.match(/^(\d{1,2}):(\d{2})/);
  if (dateParts) {
    const parsed = new Date(
      Number(dateParts[3]),
      Number(dateParts[2]) - 1,
      Number(dateParts[1]),
      timeParts ? Number(timeParts[1]) : 12,
      timeParts ? Number(timeParts[2]) : 0
    );
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (item.scheduledAtIso) {
    const parsed = new Date(item.scheduledAtIso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function scheduleDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupScheduleItems(items: ScheduleListItem[]) {
  const groups = new Map<string, ScheduleCalendarGroup>();
  items.forEach((item) => {
    if (item.statusKey === "cancelled") return;
    const date = scheduleItemLocalDate(item);
    if (!date) return;
    const dayKey = scheduleDayKey(date);
    const groupKey = [
      dayKey,
      item.time,
      item.action,
      item.typeLabel,
      item.originLabel,
      item.source,
      item.automationKey || "",
      item.statusKey || item.status,
    ].join("|");
    const existing = groups.get(groupKey);
    if (existing) {
      existing.itemCount += 1;
      item.channelLabels.forEach((label) => {
        if (label && !existing.channelLabels.includes(label))
          existing.channelLabels.push(label);
      });
      return;
    }
    groups.set(groupKey, {
      key: groupKey,
      dayKey,
      primary: item,
      channelLabels: [...new Set(item.channelLabels.filter(Boolean))],
      itemCount: 1,
    });
  });
  return [...groups.values()];
}

function scheduleApprovalState(item: ScheduleListItem) {
  if (item.statusKey === "refused") return "refused";
  if (scheduleFilterKey(item) === "stats" || item.source === "manual") {
    return "approved";
  }
  return ["validated", "completed", "done"].includes(item.statusKey || "")
    ? "approved"
    : "pending";
}

type AgentScheduleModalProps = {
  open: boolean;
  items: ScheduleListItem[];
  mutationState: "idle" | "saving";
  loading?: boolean;
  readOnly?: boolean;
  showCampaigns?: boolean;
  onClose: () => void;
  onOpenContent: (item: ScheduleListItem) => void;
  onReschedule: (item: ScheduleListItem) => void;
  onDelete: (item: ScheduleListItem) => void;
};

export function AgentScheduleModal({
  open,
  items,
  mutationState,
  loading = false,
  readOnly = false,
  showCampaigns = true,
  onClose,
  onOpenContent,
  onReschedule,
  onDelete,
}: AgentScheduleModalProps) {
  const i18nT = useTranslations("agent");
  const locale = useLocale();
  const [activeFilters, setActiveFilters] = useState(DEFAULT_SCHEDULE_FILTERS);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const eligibleItems = useMemo(
    () =>
      showCampaigns
        ? items
        : items.filter((item) => scheduleFilterKey(item) !== "campaigns"),
    [items, showCampaigns]
  );
  const initialMonth = useMemo(() => {
    const now = new Date();
    const datedItems = eligibleItems
      .map(scheduleItemLocalDate)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => a.getTime() - b.getTime());
    const firstUpcoming = datedItems.find(
      (date) => date.getTime() >= now.getTime() - 86_400_000
    );
    const anchor = firstUpcoming || datedItems[0] || now;
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  }, [eligibleItems]);
  const [visibleMonth, setVisibleMonth] = useState(initialMonth);
  const [visibleHalf, setVisibleHalf] = useState<1 | 2>(() => {
    const now = new Date();
    return now.getFullYear() === initialMonth.getFullYear() &&
      now.getMonth() === initialMonth.getMonth() &&
      now.getDate() > 15
      ? 2
      : 1;
  });
  const wasOpenRef = useRef(false);
  const visiblePeriodItems = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDay = visibleHalf === 1 ? 1 : 16;
    const finalDay =
      visibleHalf === 1 ? 15 : new Date(year, month + 1, 0).getDate();
    return eligibleItems.filter((item) => {
      const date = scheduleItemLocalDate(item);
      return Boolean(
        date &&
          (date.getTime() >= nowTimestamp || item.statusKey === "refused") &&
          date.getFullYear() === year &&
          date.getMonth() === month &&
          date.getDate() >= firstDay &&
          date.getDate() <= finalDay
      );
    });
  }, [eligibleItems, nowTimestamp, visibleHalf, visibleMonth]);
  const filterCounts = useMemo(
    () => ({
      publications: groupScheduleItems(
        visiblePeriodItems.filter(
          (item) => scheduleFilterKey(item) === "publications"
        )
      ).length,
      stats: groupScheduleItems(
        visiblePeriodItems.filter((item) => scheduleFilterKey(item) === "stats")
      ).length,
      campaigns: groupScheduleItems(
        visiblePeriodItems.filter(
          (item) => scheduleFilterKey(item) === "campaigns"
        )
      ).length,
    }),
    [visiblePeriodItems]
  );
  const filteredItems = useMemo(
    () =>
      visiblePeriodItems.filter(
        (item) => activeFilters[scheduleFilterKey(item)]
      ),
    [activeFilters, visiblePeriodItems]
  );
  const groupedItems = useMemo(
    () => groupScheduleItems(filteredItems),
    [filteredItems]
  );

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setNowTimestamp(Date.now());
    setVisibleMonth(initialMonth);
    const now = new Date();
    setVisibleHalf(
      now.getFullYear() === initialMonth.getFullYear() &&
        now.getMonth() === initialMonth.getMonth() &&
        now.getDate() > 15
        ? 2
        : 1
    );
  }, [initialMonth, open]);

  const calendarModel = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const firstDay = visibleHalf === 1 ? 1 : 16;
    const finalDay = visibleHalf === 1 ? 15 : lastDay;
    const leadingBlanks = (new Date(year, month, firstDay).getDay() + 6) % 7;
    const cells: Array<Date | null> = Array.from(
      { length: leadingBlanks },
      () => null
    );
    for (let day = firstDay; day <= finalDay; day += 1)
      cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    const groupsByDay = new Map<string, ScheduleCalendarGroup[]>();
    groupedItems.forEach((group) => {
      const list = groupsByDay.get(group.dayKey) || [];
      list.push(group);
      groupsByDay.set(group.dayKey, list);
    });
    groupsByDay.forEach((list) =>
      list.sort((a, b) => a.primary.time.localeCompare(b.primary.time))
    );
    return { cells, groupsByDay, firstDay, finalDay, lastDay };
  }, [groupedItems, visibleHalf, visibleMonth]);

  const weekdayLabels = useMemo(() => {
    const monday = new Date(2026, 0, 5);
    return Array.from({ length: 7 }, (_, index) =>
      new Intl.DateTimeFormat(locale, { weekday: "short" })
        .format(
          new Date(
            monday.getFullYear(),
            monday.getMonth(),
            monday.getDate() + index
          )
        )
        .replace(".", "")
    );
  }, [locale]);

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);
  const todayKey = scheduleDayKey(new Date());

  const scheduleFilters: Array<{
    key: ScheduleFilterKey;
    label: string;
  }> = [
    { key: "publications", label: i18nT("planning_filter_publications") },
    { key: "stats", label: i18nT("planning_filter_stats") },
    ...(showCampaigns
      ? [{ key: "campaigns" as const, label: i18nT("planning_filter_campaigns") }]
      : []),
  ];

  const moveMonth = (offset: number) => {
    setVisibleMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + offset, 1)
    );
    setVisibleHalf(offset < 0 ? 2 : 1);
  };

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
            <h2>{i18nT("actions_programmees_77ae2684")}</h2>
          </div>
          <div className={styles.scheduleHeaderPeriodControls}>
            <div className={styles.scheduleMonthNavigation}>
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                aria-label={i18nT("mois_precedent")}
              >
                ‹
              </button>
              <strong>{monthLabel}</strong>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                aria-label={i18nT("mois_suivant")}
              >
                ›
              </button>
            </div>
            <div
              className={styles.scheduleHalfSwitcher}
              aria-label={i18nT("periode_affichee")}
            >
              <button
                type="button"
                data-active={visibleHalf === 1}
                onClick={() => setVisibleHalf(1)}
              >
                1–15
              </button>
              <button
                type="button"
                data-active={visibleHalf === 2}
                onClick={() => setVisibleHalf(2)}
              >
                16–{calendarModel.lastDay}
              </button>
            </div>
          </div>
          <div className={styles.scheduleModalHeaderActions}>
            <div
              className={styles.scheduleSummaryPill}
              aria-label={i18nT("value_actions_a_venir_11a80df3", {
                value0: groupedItems.length,
              })}
            >
              <strong>{groupedItems.length}</strong>
              <span>{i18nT("actions_a_venir_a611605d")}</span>
            </div>
            <button
              type="button"
              className={styles.scheduleCloseButton}
              onClick={onClose}
            >
              {i18nT("fermer_5ab4ec64")}
            </button>
          </div>
        </div>

        <section className={styles.scheduleSection}>
          {eligibleItems.length > 0 ? (
            <div className={styles.scheduleCalendarShell}>
              <div
                className={styles.scheduleFilters}
                role="group"
                aria-label={i18nT("planning_filter_label")}
              >
                {scheduleFilters.map((filter) => (
                  <label
                    key={filter.key}
                    className={styles.scheduleFilter}
                    data-filter={filter.key}
                    data-active={activeFilters[filter.key]}
                  >
                    <input
                      type="checkbox"
                      checked={activeFilters[filter.key]}
                      onChange={(event) =>
                        setActiveFilters((current) => ({
                          ...current,
                          [filter.key]: event.currentTarget.checked,
                        }))
                      }
                    />
                    <span
                      className={styles.scheduleFilterCheck}
                      aria-hidden="true"
                    >
                      {activeFilters[filter.key] ? "✓" : ""}
                    </span>
                    <span
                      className={styles.scheduleFilterDot}
                      aria-hidden="true"
                    />
                    <strong>{filter.label}</strong>
                    <small>{filterCounts[filter.key]}</small>
                  </label>
                ))}
              </div>
              <div className={styles.scheduleCalendarViewport}>
                {groupedItems.length > 0 ? (
                  <div
                    className={styles.scheduleCalendar}
                    role="grid"
                    aria-label={i18nT("calendrier_des_publications_a_venir")}
                  >
                    {weekdayLabels.map((label) => (
                      <div
                        key={label}
                        className={styles.scheduleWeekday}
                        role="columnheader"
                      >
                        {label}
                      </div>
                    ))}
                    {calendarModel.cells.map((date, index) => {
                      if (!date)
                        return (
                          <div
                            key={`empty-${index}`}
                            className={`${styles.scheduleDayCell} ${styles.scheduleDayEmpty}`}
                            aria-hidden="true"
                          />
                        );
                      const dayKey = scheduleDayKey(date);
                      const dayGroups =
                        calendarModel.groupsByDay.get(dayKey) || [];
                      return (
                        <div
                          key={dayKey}
                          className={styles.scheduleDayCell}
                          data-today={dayKey === todayKey}
                          role="gridcell"
                        >
                          <div className={styles.scheduleDayHeader}>
                            <span>{date.getDate()}</span>
                            {dayGroups.length > 0 ? (
                              <small>{dayGroups.length}</small>
                            ) : null}
                          </div>
                          <div className={styles.scheduleDayActions}>
                            {dayGroups.map((group) => {
                              const item = group.primary;
                              const channelLabels =
                                group.channelLabels.length > 0
                                  ? group.channelLabels
                                  : [item.channelLabel || "—"];
                              const channels = channelLabels.join(" · ");
                              const category = scheduleFilterKey(item);
                              const approvalState = scheduleApprovalState(item);
                              const approvalLabelKey =
                                approvalState === "approved"
                                  ? "planning_status_approved"
                                  : approvalState === "refused"
                                    ? "planning_status_refused"
                                    : "planning_status_pending";
                              return (
                                <article
                                  key={group.key}
                                  className={styles.scheduleCalendarCard}
                                  data-status={item.statusKey}
                                  data-category={category}
                                  data-approval={approvalState}
                                >
                                  <div
                                    className={
                                      styles.scheduleCalendarCardTopline
                                    }
                                  >
                                    <time>{item.time}</time>
                                    <span
                                      className={
                                        styles.scheduleCalendarCardControls
                                      }
                                    >
                                      {!readOnly ? (
                                        <>
                                          <button
                                            type="button"
                                            className={styles.scheduleIconButton}
                                            onClick={() => onOpenContent(item)}
                                            disabled={
                                              mutationState === "saving" ||
                                              (item.source === "editorial" &&
                                                !item.contentReady)
                                            }
                                            aria-label={
                                              item.source === "editorial" &&
                                              !item.contentReady
                                                ? i18nT(
                                                    "preparation_en_cours_28379fdb"
                                                  )
                                                : i18nT("edit_content")
                                            }
                                            title={
                                              item.source === "editorial" &&
                                              !item.contentReady
                                                ? i18nT(
                                                    "preparation_en_cours_28379fdb"
                                                  )
                                                : i18nT("edit_content")
                                            }
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              aria-hidden="true"
                                            >
                                              <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Z" />
                                              <path d="m13.8 6 4.2 4.2" />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            className={styles.scheduleIconButton}
                                            onClick={() => onReschedule(item)}
                                            disabled={
                                              !item.editable ||
                                              mutationState === "saving"
                                            }
                                            aria-label={i18nT(
                                              "modifier_la_programmation_2bdd7cdc"
                                            )}
                                            title={i18nT(
                                              "modifier_la_programmation_2bdd7cdc"
                                            )}
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              aria-hidden="true"
                                            >
                                              <circle cx="12" cy="12" r="8" />
                                              <path d="M12 8v5l3 2" />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            className={`${styles.scheduleIconButton} ${styles.scheduleIconDanger}`}
                                            onClick={() => onDelete(item)}
                                            disabled={
                                              !item.removable ||
                                              mutationState === "saving"
                                            }
                                            aria-label={i18nT("supprimer_1acfc1c7")}
                                            title={i18nT("supprimer_1acfc1c7")}
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              aria-hidden="true"
                                            >
                                              <path d="M5 7h14" />
                                              <path d="M9 7V4h6v3" />
                                              <path d="m7 7 1 13h8l1-13" />
                                              <path d="M10 11v5M14 11v5" />
                                            </svg>
                                          </button>
                                        </>
                                      ) : null}
                                      <span
                                        className={
                                          styles.scheduleApprovalIndicator
                                        }
                                        data-state={approvalState}
                                        role="img"
                                        aria-label={i18nT(approvalLabelKey)}
                                        title={i18nT(approvalLabelKey)}
                                      />
                                    </span>
                                  </div>
                                  <strong title={item.action}>
                                    {item.action}
                                  </strong>
                                  <div
                                    className={styles.scheduleCalendarCardMeta}
                                  >
                                    {channelLabels.length > 1 ? (
                                      <details
                                        className={
                                          styles.scheduleCalendarChannels
                                        }
                                      >
                                        <summary title={channels}>
                                          <span>
                                            {channelLabels.length}{" "}
                                            {i18nT(
                                              "canaux_27cb4473"
                                            ).toLocaleLowerCase(locale)}
                                          </span>
                                          <span aria-hidden="true">⌄</span>
                                        </summary>
                                        <div>
                                          {channelLabels.map((label) => (
                                            <span key={label}>{label}</span>
                                          ))}
                                        </div>
                                      </details>
                                    ) : (
                                      <small title={channels}>{channels}</small>
                                    )}
                                    <em>{item.originLabel}</em>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className={styles.scheduleFilteredEmpty}>
                    {i18nT("planning_filter_empty")}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className={styles.scheduleEmpty}>
              {loading
                ? i18nT("synchronisation_60a2d2da")
                : i18nT("aucune_action_programmee_a_venir_a0bce831")}
            </p>
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
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onClick={() => mutationState !== "saving" && onClose()}
    >
      <section
        className={`${styles.settingsModal} ${styles.validationChoiceModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("valider_l_action_inr_agent_be980832")}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.modalClose}
          onClick={onClose}
          disabled={mutationState === "saving"}
          aria-label={i18nT("fermer_5ab4ec64")}
        >
          ×
        </button>
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
          <button
            type="button"
            className={styles.validationChoiceCard}
            onClick={onRunNow}
            disabled={mutationState === "saving"}
          >
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
          <button
            type="button"
            className={styles.validationChoiceCard}
            onClick={onSchedule}
            disabled={mutationState === "saving"}
          >
            <span aria-hidden>🕒</span>
            <strong>
              {scheduledEditSession
                ? i18nT("programmer_f704a30b")
                : selectedPreparedAction.automationKey === "publish"
                ? i18nT("programmer_la_publication_a364ade3")
                : i18nT("programmer_l_envoi_1c7213bd")}
            </strong>
            <small>
              {i18nT("les_informations_actuelles_sont_preremplies_c8604211")}
            </small>
          </button>
        </div>
      </section>
    </div>
  );
}
