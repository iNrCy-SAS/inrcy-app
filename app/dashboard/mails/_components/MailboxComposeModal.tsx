import { useTranslations } from "next-intl";
import React from "react";
import MediaLibraryPickerModal, {
  mediaLibraryItemToAttachment,
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import MediaOptimizerModal, {
  type MediaOptimizerItem,
} from "@/app/dashboard/_components/MediaOptimizerModal";
import {
  MEDIA_LIBRARY_EMAIL_TARGET_BYTES,
  getMediaLibraryOptimizationRequirements,
} from "@/lib/mediaLibraryOptimizationPolicy";
import { detectUniversalUploadMediaType } from "@/lib/mediaUploadPolicy";
import styles from "../mails.module.css";
import {
  normalizeMailSubject,
  normalizeMailSubjectDraft,
} from "@/lib/mailEncoding";
import { pill } from "../_lib/mailboxPhase1";
import { normalizeEmails } from "../_lib/mailboxPhase25";
import { inputStyle, textareaStyle } from "./mailboxInlineStyles";
import RichMailEditor from "@/app/dashboard/_components/RichMailEditor";
import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  extractTemplatePlaceholders,
  textToRichMailHtml,
} from "@/lib/mailRichText";
import { useUnsavedExitGuard } from "@/app/dashboard/_hooks/useUnsavedExitGuard";
import TemplateSubjectInlineEditor from "@/app/dashboard/_components/TemplateSubjectInlineEditor";
import CampaignScheduleModal from "@/app/dashboard/_components/CampaignScheduleModal";

type MailboxComposeModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenAiConfiguration: () => void;
  draftId: string | null;
  currentComposeSnapshot: string;
  lastSavedComposeSnapshot: string | null;
  mailAccounts: any[];
  selectedAccountId: string;
  setSelectedAccountId: React.Dispatch<React.SetStateAction<string>>;
  selectedAccount: any | null;
  to: string;
  setTo: React.Dispatch<React.SetStateAction<string>>;
  subject: string;
  setSubject: React.Dispatch<React.SetStateAction<string>>;
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  html: string;
  setHtml: React.Dispatch<React.SetStateAction<string>>;
  composeRecipientList: string[];
  isBulkCampaignCompose: boolean;
  bulkCampaignNotice: {
    tone: "strong" | "danger" | "warning" | "info";
    title: string;
    text: string;
  } | null;
  crmPickerOpen: boolean;
  setCrmPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  crmSearchOpen: boolean;
  setCrmSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  crmSearchRef: React.RefObject<HTMLInputElement | null>;
  crmFilter: string;
  setCrmFilter: React.Dispatch<React.SetStateAction<string>>;
  crmCategory: any;
  setCrmCategory: React.Dispatch<React.SetStateAction<any>>;
  crmContactType: any;
  setCrmContactType: React.Dispatch<React.SetStateAction<any>>;
  crmDepartment: string;
  setCrmDepartment: React.Dispatch<React.SetStateAction<string>>;
  crmImportantOnly: boolean;
  setCrmImportantOnly: React.Dispatch<React.SetStateAction<boolean>>;
  selectedCrmCount: number;
  filteredContacts: any[];
  selectedToSet: Set<string>;
  crmLoading: boolean;
  crmError: string | null;
  loadCrmContacts: () => Promise<void>;
  toggleEmailInTo: (email: string) => void;
  fileInputId: string;
  attachBusy: boolean;
  composeAttachments: any[];
  setComposeAttachments: React.Dispatch<React.SetStateAction<any[]>>;
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  uploadComposeFiles: (files: File[]) => Promise<any[]>;
  signatureEnabled: boolean;
  signaturePreview: string;
  signatureImageUrl: string;
  signatureImageWidth: number;
  saveDraft: () => Promise<void>;
  doSend: () => Promise<void>;
  scheduledEditMode?: boolean;
  scheduledEditSaving?: boolean;
  scheduledEditScheduledAt?: string | null;
  onSaveScheduledEdit?: () => Promise<void> | void;
  scheduleWorkflowCampaign?: (scheduledAt: string) => Promise<void>;
  onScheduledSuccess?: () => void | Promise<void>;
  sendBusy: boolean;
  scheduleBusy?: boolean;
  toast: string | null;
  setToast: React.Dispatch<React.SetStateAction<string | null>>;
  workflowFinalizerKind?: "propulser" | "fideliser" | null;
  onWorkflowPrevious?: () => void | Promise<void>;
};

const MAIL_WRITING_TYPE_OPTIONS = [
  { value: "auto", messageKey: "automatique_f8a3c37b" },
  { value: "presentation", messageKey: "presentation_aa245f5f" },
  { value: "prospection", messageKey: "prospection_2f8b56f9" },
  { value: "relance", messageKey: "relance_1b0d4e35" },
  { value: "thanks", messageKey: "remerciement_cbbf9b3a" },
  { value: "info", messageKey: "information_0eb5ed50" },
  { value: "offer", messageKey: "offre_commerciale_40790051" },
  { value: "reply", messageKey: "reponse_client_565c825f" },
  { value: "meeting", messageKey: "invitation_rdv_0715fb3e" },
] as const;

type MailWritingType = (typeof MAIL_WRITING_TYPE_OPTIONS)[number]["value"];

export default function MailboxComposeModal(props: MailboxComposeModalProps) {
  const i18nT = useTranslations("mails");
  const {
    open,
    onClose,
    onOpenSettings,
    onOpenAiConfiguration,
    draftId,
    currentComposeSnapshot,
    lastSavedComposeSnapshot,
    mailAccounts,
    selectedAccountId,
    setSelectedAccountId,
    selectedAccount,
    to,
    setTo,
    subject,
    setSubject,
    text,
    setText,
    html,
    setHtml,
    composeRecipientList,
    isBulkCampaignCompose,
    bulkCampaignNotice,
    crmPickerOpen,
    setCrmPickerOpen,
    crmSearchOpen,
    setCrmSearchOpen,
    crmSearchRef,
    crmFilter,
    setCrmFilter,
    crmCategory,
    setCrmCategory,
    crmContactType,
    setCrmContactType,
    crmDepartment,
    setCrmDepartment,
    crmImportantOnly,
    setCrmImportantOnly,
    selectedCrmCount,
    filteredContacts,
    selectedToSet,
    crmLoading,
    crmError,
    loadCrmContacts,
    toggleEmailInTo,
    fileInputId,
    attachBusy,
    composeAttachments,
    setComposeAttachments,
    setFiles,
    uploadComposeFiles,
    signatureEnabled,
    signaturePreview,
    signatureImageUrl,
    signatureImageWidth,
    saveDraft,
    doSend,
    scheduledEditMode = false,
    scheduledEditSaving = false,
    scheduledEditScheduledAt = null,
    onSaveScheduledEdit,
    scheduleWorkflowCampaign,
    onScheduledSuccess,
    sendBusy,
    scheduleBusy = false,
    toast,
    setToast,
    workflowFinalizerKind = null,
    onWorkflowPrevious,
  } = props;

  const [mediaLibraryOpen, setMediaLibraryOpen] = React.useState(false);
  const [optimizerFile, setOptimizerFile] = React.useState<File | null>(null);
  const [optimizerItem, setOptimizerItem] = React.useState<MediaLibraryPickerItem | null>(null);
  const [optimizerQueue, setOptimizerQueue] = React.useState<File[]>([]);
  const [optimizerCompleted, setOptimizerCompleted] = React.useState(false);

  const hasComposeWork = React.useMemo(() => {
    return Boolean(
      to.trim() ||
      subject.trim() ||
      text.trim() ||
      html.trim() ||
      selectedCrmCount > 0 ||
      composeAttachments.length > 0,
    );
  }, [composeAttachments.length, html, selectedCrmCount, subject, text, to]);

  const hasUnsavedComposeChanges = React.useMemo(() => {
    if (!hasComposeWork) return false;
    return currentComposeSnapshot !== lastSavedComposeSnapshot;
  }, [currentComposeSnapshot, hasComposeWork, lastSavedComposeSnapshot]);

  const requestClose = React.useCallback(async () => {
    if (!hasUnsavedComposeChanges) {
      onClose();
      return;
    }

    const confirmed = await confirmInrcy({
      title: scheduledEditMode ? "Continuer sans sauvegarder ?" : "Fermer le message ?",
      message: scheduledEditMode
        ? "Les modifications du mail programmé seront perdues. Continuer ?"
        : "Vous avez un message en cours. Voulez-vous vraiment fermer cette fenêtre sans l’envoyer ni sauvegarder le brouillon ?",
      confirmLabel: scheduledEditMode ? "Continuer sans sauvegarder" : "Fermer sans sauvegarder",
      cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
      variant: "warning",
    });

    if (confirmed) onClose();
  }, [hasUnsavedComposeChanges, onClose, scheduledEditMode]);

  useUnsavedExitGuard({
    active: open,
    shouldBlock: hasUnsavedComposeChanges,
    onConfirmExit: onClose,
    title: scheduledEditMode ? "Continuer sans sauvegarder ?" : "Fermer le message ?",
    message: scheduledEditMode
      ? "Les modifications du mail programmé seront perdues. Continuer ?"
      : "Vous avez un message en cours. Voulez-vous vraiment fermer cette fenêtre sans l’envoyer ni sauvegarder le brouillon ?",
    confirmLabel: scheduledEditMode ? "Continuer sans sauvegarder" : "Fermer sans sauvegarder",
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

  const [crmFiltersOpen, setCrmFiltersOpen] = React.useState(false);

  React.useEffect(() => {
    if (!crmPickerOpen) setCrmFiltersOpen(false);
  }, [crmPickerOpen]);

  const activeCrmFiltersCount = React.useMemo(() => {
    let count = 0;
    if ((crmCategory ?? "all") !== "all") count += 1;
    if ((crmContactType ?? "all") !== "all") count += 1;
    if (crmDepartment.trim()) count += 1;
    if (crmImportantOnly) count += 1;
    return count;
  }, [crmCategory, crmContactType, crmDepartment, crmImportantOnly]);

  const isWorkflowFinalizer =
    workflowFinalizerKind === "propulser" ||
    workflowFinalizerKind === "fideliser";
  const workflowFinalizerLabel =
    workflowFinalizerKind === "propulser"
      ? i18nT("workflow_propulser_name")
      : workflowFinalizerKind === "fideliser"
        ? i18nT("workflow_fideliser_name")
        : "";
  const workflowFinalizerIcon =
    workflowFinalizerKind === "propulser"
      ? "🚀"
      : workflowFinalizerKind === "fideliser"
        ? "💌"
        : "✉️";

  const requestSend = React.useCallback(async () => {
    const placeholders = extractTemplatePlaceholders(`${subject}\n${text}`);
    if (placeholders.length > 0) {
      const preview = placeholders.slice(0, 6).join(", ");
      const more =
        placeholders.length > 6
          ? ` et ${placeholders.length - 6} autre(s)`
          : "";
      const confirmed = await confirmInrcy({
        title: i18nT("elements_a_completer_c23b6061"),
        message: i18nT("votre_message_contient_encore_des_elements_8afb764f", { value0: preview, value1: more }),
        confirmLabel: i18nT("envoyer_quand_meme_f5af0679"),
        cancelLabel: i18nT("corriger_le_message_6d7e26a8"),
        variant: "warning",
      });
      if (!confirmed) return;
    }
    await doSend();
  }, [doSend, subject, text]);

  const [isMobileViewport, setIsMobileViewport] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 760px)");
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  const [aiGenerating, setAiGenerating] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [mailWritingType, setMailWritingType] =
    React.useState<MailWritingType>("auto");

  const [scheduleModalOpen, setScheduleModalOpen] = React.useState(false);
  const [scheduleError, setScheduleError] = React.useState<string | null>(null);

  const openScheduleModal = React.useCallback(() => {
    setScheduleError(null);
    setScheduleModalOpen(true);
  }, []);

  const confirmSchedule = React.useCallback(
    async (scheduledAt: string) => {
      if (!scheduleWorkflowCampaign) return;
      setScheduleError(null);
      try {
        await scheduleWorkflowCampaign(scheduledAt);
      } catch (error) {
        console.error("Unable to schedule mail campaign", error);
        const message = i18nT("schedule_failed");
        setScheduleError(message);
        throw new Error(message);
      }
    },
    [i18nT, scheduleWorkflowCampaign],
  );

  const generateMailWithAi = React.useCallback(async () => {
    const mailSubject = normalizeMailSubject(subject).trim();
    if (!mailSubject) {
      setAiError(i18nT("renseignez_d_abord_un_objet_pour_7e7699f1"));
      return;
    }

    setAiGenerating(true);
    setAiError(null);
    setToast(null);

    try {
      const response = await fetch("/api/mails/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: mailSubject,
          body: text,
          writingType: mailWritingType,
          attachments: composeAttachments
            .map((attachment) => ({
              bucket: String(attachment.bucket || "").trim(),
              path: String(attachment.path || "").trim(),
              name: String(
                attachment.name ||
                  attachment.path?.split?.("/").pop?.() ||
                  "piece-jointe",
              ).trim(),
              type: attachment.type || null,
              size: attachment.size ?? null,
            }))
            .filter((attachment) => attachment.bucket && attachment.path),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(i18nT("ai_generation_failed"));
      const nextText = String(payload?.body_text || "").trim();
      if (!nextText) throw new Error(i18nT("ai_generation_empty"));
      setText(nextText);
      setHtml(textToRichMailHtml(nextText));
      setToast(
        composeAttachments.length > 0
          ? i18nT("ai_message_generated_with_attachments")
          : i18nT("ai_message_generated"),
      );
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : i18nT("ai_generation_failed"),
      );
    } finally {
      setAiGenerating(false);
    }
  }, [
    composeAttachments,
    i18nT,
    mailWritingType,
    setHtml,
    setText,
    setToast,
    subject,
    text,
  ]);

  const appendComposeAttachments = React.useCallback(
    (items: any[]) => {
      setComposeAttachments((prev) => {
        const merged = [...prev];
        for (const item of items) {
          const exists = merged.some(
            (current) =>
              current.bucket === item.bucket && current.path === item.path,
          );
          if (!exists) merged.push(item);
        }
        return merged;
      });
    },
    [setComposeAttachments],
  );

  const openOptimizerForFiles = React.useCallback((files: File[]) => {
    const [first, ...rest] = files;
    if (!first) return;
    setOptimizerItem(null);
    setOptimizerFile(first);
    setOptimizerQueue(rest);
    setOptimizerCompleted(false);
  }, []);

  const closeOptimizer = React.useCallback(() => {
    if (optimizerCompleted && optimizerQueue.length > 0) {
      const [next, ...rest] = optimizerQueue;
      setOptimizerItem(null);
      setOptimizerFile(next);
      setOptimizerQueue(rest);
      setOptimizerCompleted(false);
      return;
    }
    setOptimizerFile(null);
    setOptimizerItem(null);
    setOptimizerQueue([]);
    setOptimizerCompleted(false);
  }, [optimizerCompleted, optimizerQueue]);

  if (!open) return null;

  const composeInputStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 46,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(7,10,24,0.62)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    fontSize: 15,
  };

  const composeEditorStyle: React.CSSProperties = {
    ...textareaStyle,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(7,10,24,0.72)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    padding: "14px 14px",
  };

  const handleAttachmentInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = e.currentTarget;
    const next = Array.from<File>(input.files || []);
    input.value = "";
    setFiles([]);
    if (!next.length) return;

    const directFiles: File[] = [];
    const oversizedMedia: File[] = [];
    const oversizedUnsupported: File[] = [];
    for (const file of next) {
      const mediaType = detectUniversalUploadMediaType({
        name: file.name,
        mimeType: file.type,
      });
      if (mediaType === "image" || mediaType === "video") {
        const requirements = getMediaLibraryOptimizationRequirements({
          mediaType,
          sizeBytes: file.size,
          targetBytes: MEDIA_LIBRARY_EMAIL_TARGET_BYTES,
          name: file.name,
          mimeType: file.type,
        });
        if (requirements.needsOptimization) oversizedMedia.push(file);
        else directFiles.push(file);
      } else if (file.size <= MEDIA_LIBRARY_EMAIL_TARGET_BYTES) {
        directFiles.push(file);
      } else {
        oversizedUnsupported.push(file);
      }
    }

    if (oversizedUnsupported.length > 0) {
      setToast(
        i18nT("les_pieces_jointes_sont_limitees_a_8ef45f93", { value0: oversizedUnsupported[0].name }),
      );
    }

    if (directFiles.length > 0) {
      try {
        setFiles(directFiles);
        const uploaded = await uploadComposeFiles(directFiles);
        appendComposeAttachments(uploaded);
      } catch (err) {
        console.error("Attachment upload failed", err);
        setToast(
          i18nT("impossible_de_preparer_cette_piece_jointe_9bbce7b0"),
        );
      } finally {
        setFiles([]);
      }
    }

    if (oversizedMedia.length > 0) {
      setToast(i18nT("ce_media_doit_etre_optimise_inrcy_0fe5d1f4"));
      openOptimizerForFiles(oversizedMedia);
    }
  };

  const addMediaLibraryAttachments = (items: MediaLibraryPickerItem[]) => {
    appendComposeAttachments(items.map(mediaLibraryItemToAttachment));
  };

  const openOptimizerForLibraryItem = (item: MediaLibraryPickerItem) => {
    setOptimizerFile(null);
    setOptimizerQueue([]);
    setOptimizerItem(item);
    setOptimizerCompleted(false);
  };

  const handleOptimizedAttachment = async (item: MediaOptimizerItem) => {
    if (Number(item.size_bytes || 0) > MEDIA_LIBRARY_EMAIL_TARGET_BYTES) {
      setToast(i18nT("le_media_optimise_depasse_encore_20_ced888d4"));
      return;
    }
    appendComposeAttachments([mediaLibraryItemToAttachment(item)]);
    setOptimizerCompleted(true);
    setToast(i18nT("media_optimise_ajoute_au_message_06c69f58"));
  };

  return (
    <div className={`${styles.modalOverlay} ${styles.composeModalOverlay}`} onClick={(e) => e.stopPropagation()}>
      <MediaOptimizerModal
        open={Boolean(optimizerFile || optimizerItem)}
        sourceFile={optimizerFile}
        sourceItem={optimizerItem}
        origin="email"
        onClose={closeOptimizer}
        onOptimized={handleOptimizedAttachment}
      />
      <MediaLibraryPickerModal
        open={mediaLibraryOpen}
        title={i18nT("joindre_depuis_la_mediatheque_132a0a6b")}
        subtitle="Ajoutez un média déjà stocké dans iNrCy · format adapté si nécessaire · 20 Mo max."
        accept="all"
        multiple
        maxSelection={10}
        maxImageBytes={MEDIA_LIBRARY_EMAIL_TARGET_BYTES}
        maxVideoBytes={MEDIA_LIBRARY_EMAIL_TARGET_BYTES}
        confirmLabel={i18nT("joindre_2ee36407")}
        onOpenOptimizer={openOptimizerForLibraryItem}
        onClose={() => setMediaLibraryOpen(false)}
        onConfirm={(items) => addMediaLibraryAttachments(items)}
      />
      <div
        className={`${styles.modalCard} ${styles.composeModalCard}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`${styles.modalHeader} ${styles.composeModalHeader}`}>
          <div className={styles.composeHeaderTitleWrap}>
            <div className={styles.composeTitleRow}>
              <div className={styles.composeTitleIcon}>
                {workflowFinalizerIcon}
              </div>
              <div className={styles.composeTitleText}>
                {scheduledEditMode
                  ? i18nT("modifier_le_mail_programme_d6b80ee8")
                  : isWorkflowFinalizer
                    ? i18nT("finaliser_l_envoi_value_6d2ac3eb", { value0: workflowFinalizerLabel })
                    : draftId
                      ? i18nT("editer_le_brouillon_8d63fe6b")
                      : i18nT("nouveau_message_ed68c30d")}
              </div>
              <span className={`${styles.badge} ${styles.composeTypeBadge}`}>
                {isWorkflowFinalizer ? workflowFinalizerLabel : i18nT("mail_92379cbb")}
              </span>
            </div>
            <div className={styles.composeSubtitle}>
              {scheduledEditMode
                ? i18nT("modifiez_ce_mail_programme_enregistrez_pour_3066350a")
                : isWorkflowFinalizer
                  ? i18nT("verifiez_les_destinataires_l_objet_et_111a6b88", { value0: workflowFinalizerLabel })
                  : i18nT("preparez_un_message_clair_choisissez_vos_30c3b015")}
            </div>
          </div>

          <div className={styles.composeHeaderActions}>
            {!scheduledEditMode ? (
              <button
                className={`${styles.btnGhost} ${styles.composeHeaderIconBtn}`}
                onClick={() => void saveDraft()}
                type="button"
                aria-label={i18nT("sauvegarder_le_brouillon_debe7862")}
                title={i18nT("sauvegarder_le_brouillon_debe7862")}
                disabled={sendBusy || attachBusy}
              >
                {attachBusy ? "…" : "💾"}
              </button>
            ) : null}
            {!isWorkflowFinalizer ? (
              <button
                className={`${styles.btnGhost} ${styles.composeHeaderIconBtn} ${styles.aiHeaderBtn}`}
                onClick={onOpenAiConfiguration}
                type="button"
                aria-label={i18nT("configuration_ia_f620c8d8")}
                title={i18nT("configuration_ia_f620c8d8")}
              >
                {i18nT("ia_d41daf59")}{" "}</button>
            ) : null}
            <button
              className={`${styles.btnGhost} ${styles.composeHeaderIconBtn}`}
              onClick={onOpenSettings}
              type="button"
              aria-label={i18nT("ouvrir_les_reglages_inr_send_0a4fdc66")}
              title={i18nT("reglages_mails_a1957d12")}
            >
              ⚙️
            </button>
            <button
              className={`${styles.btnGhost} ${styles.composeCloseBtn}`}
              onClick={() => void requestClose()}
              type="button"
              aria-label={i18nT("fermer_5ab4ec64")}
              title={i18nT("fermer_5ab4ec64")}
            >
              ✕
            </button>
          </div>
        </div>

        <div className={`${styles.modalBody} ${styles.composeModalBody}`}>
          <div className={styles.composeFormStack}>
            <section className={styles.composeSection}>
              <div className={styles.composeSectionHeader}>
                <div>
                  <div className={styles.composeSectionTitle}>
                    <span className={styles.composeSectionIcon}>➜</span>{i18nT("boite_d_envoi_8af123c1")}{" "}</div>
                  <div className={styles.composeSectionHint}>
                    {i18nT("compte_utilise_pour_envoyer_le_message_3386d4a9")}{" "}</div>
                </div>
                {selectedAccount ? (
                  <span
                    className={`${styles.badge} ${styles.composeProviderBadge} ${pill(selectedAccount.provider).cls}`}
                  >
                    {pill(selectedAccount.provider).label}
                  </span>
                ) : null}
              </div>

              <select
                className={`${styles.selectDark} ${styles.composeSelect}`}
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                style={composeInputStyle}
              >
                {mailAccounts.map((a) => {
                  const needsUpdate =
                    a.connection_status === "needs_update" || a.requires_update;
                  return (
                    <option
                      key={a.id}
                      value={a.id}
                      disabled={needsUpdate}
                      style={{ background: "#ffffff", color: "#0b1020" }}
                    >
                      {(a.display_name ? `${a.display_name} — ` : "") +
                        a.email_address +
                        ` (${a.provider}${needsUpdate ? " — à actualiser" : ""})`}
                    </option>
                  );
                })}
              </select>
            </section>

            <section className={styles.composeSection}>
              <div className={styles.composeSectionHeader}>
                <div>
                  <div className={styles.composeSectionTitle}>
                    <span className={styles.composeSectionIcon}>👥</span>
                    {i18nT("destinataires_51610ad7")}{" "}</div>
                  <div className={styles.composeSectionHint}>
                    {i18nT("saisissez_une_adresse_ou_selectionnez_des_3e134c3b")}{" "}</div>
                </div>
                {selectedCrmCount > 0 ? (
                  <span
                    className={`${styles.badge} ${styles.composeCountBadge}`}
                  >
                    {selectedCrmCount} {" "}{i18nT("selectionne_34d3d2da")}{" "}{selectedCrmCount > 1 ? "s" : ""}
                  </span>
                ) : null}
              </div>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={i18nT("email_exemple_com_autre_exemple_com_5b0dd69e")}
                style={composeInputStyle}
              />
              {isBulkCampaignCompose ? (
                <span style={{ fontSize: 12, color: "rgba(125,211,252,0.95)" }}>
                  {i18nT("value_destinataires_detectes_inr_send_lancera_14fd84ca", { value0: composeRecipientList.length })}</span>
              ) : null}
              {bulkCampaignNotice ? (
                <div
                  style={{
                    marginTop: 4,
                    borderRadius: 12,
                    padding: "10px 12px",
                    border:
                      bulkCampaignNotice.tone === "strong"
                        ? "1px solid rgba(251,146,60,0.40)"
                        : bulkCampaignNotice.tone === "warning"
                          ? "1px solid rgba(250,204,21,0.34)"
                          : "1px solid rgba(56,189,248,0.26)",
                    background:
                      bulkCampaignNotice.tone === "strong"
                        ? "rgba(251,146,60,0.12)"
                        : bulkCampaignNotice.tone === "warning"
                          ? "rgba(250,204,21,0.10)"
                          : "rgba(56,189,248,0.10)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: "rgba(255,255,255,0.92)",
                    }}
                  >
                    {bulkCampaignNotice.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.72)",
                      marginTop: 4,
                    }}
                  >
                    {bulkCampaignNotice.text}
                  </div>
                </div>
              ) : null}

              {/* CRM picker (dropdown + checkboxes) */}
              <div style={{ display: "grid", gap: 8 }}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => setCrmPickerOpen((v) => !v)}
                  style={{
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 14,
                    borderColor: "rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.18)",
                  }}
                >
                  <span
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.78)",
                        fontWeight: 700,
                      }}
                    >
                      {i18nT("contacts_crm_641538bb")}{" "}</span>
                    <span className={styles.badge} style={{ opacity: 0.9 }}>
                      {selectedCrmCount} {" "}{i18nT("selectionne_34d3d2da")}{" "}{selectedCrmCount > 1 ? "s" : ""}
                    </span>
                    <span
                      className={`${styles.badge} ${styles.crmPickerCountBadge}`}
                    >
                      {filteredContacts.length} {" "}{i18nT("contact_1a73af9e")}{" "}{filteredContacts.length > 1 ? "s" : ""}
                    </span>
                  </span>
                  <span style={{ opacity: 0.85 }}>
                    {crmPickerOpen ? "▴" : "▾"}
                  </span>
                </button>

                {crmPickerOpen ? (
                  <div className={styles.crmPickerPanel}>
                    <div className={styles.crmCompactToolbar}>
                      <div className={styles.crmSearchBox}>
                        <span className={styles.crmSearchPrefix} aria-hidden>
                          🔎
                        </span>
                        <input
                          ref={crmSearchRef}
                          value={crmFilter}
                          onChange={(e) => setCrmFilter(e.target.value)}
                          onFocus={() => setCrmSearchOpen(true)}
                          placeholder={i18nT("rechercher_un_contact_99c66f51")}
                          className={styles.crmSearchInlineInput}
                        />
                        {crmFilter.trim() ? (
                          <button
                            type="button"
                            className={styles.crmSearchClearInline}
                            onClick={() => {
                              setCrmFilter("");
                              setTimeout(
                                () => crmSearchRef.current?.focus(),
                                0,
                              );
                            }}
                            aria-label={i18nT("effacer_la_recherche_189351c0")}
                            title={i18nT("effacer_fe23de7b")}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        className={`${styles.btnGhost} ${styles.crmToolbarBtn} ${activeCrmFiltersCount > 0 ? styles.crmToolbarBtnActive : ""}`}
                        onClick={() => setCrmFiltersOpen((v) => !v)}
                        aria-expanded={crmFiltersOpen}
                        title={i18nT("afficher_les_filtres_cd8abbe3")}
                      >
                        <span aria-hidden>⚙️</span>
                        <span>
                          {i18nT("filtres_2a8e76e0")}{" "}{activeCrmFiltersCount > 0
                            ? ` (${activeCrmFiltersCount})`
                            : ""}
                        </span>
                      </button>

                      <button
                        type="button"
                        className={`${styles.btnGhost} ${styles.crmToolbarBtn}`}
                        onClick={() => {
                          const current = normalizeEmails(to);
                          const setLower = new Set(
                            current.map((e) => e.toLowerCase()),
                          );
                          const add = filteredContacts
                            .map((c) => c.email)
                            .filter(Boolean)
                            .map((e) => String(e));
                          const next = [...current];
                          for (const e of add) {
                            if (!setLower.has(e.toLowerCase())) {
                              next.push(e);
                              setLower.add(e.toLowerCase());
                            }
                          }
                          setTo(next.join(", "));
                        }}
                        disabled={crmLoading || filteredContacts.length === 0}
                        title={i18nT("selectionner_tous_les_contacts_affiches_dbbe3910")}
                      >
                        {i18nT("tout_6b0b09b8")}{" "}</button>

                      <button
                        type="button"
                        className={`${styles.btnGhost} ${styles.crmToolbarBtn}`}
                        onClick={() => {
                          const removeSet = new Set(
                            filteredContacts
                              .map((c) => c.email)
                              .filter(Boolean)
                              .map((e) => String(e).toLowerCase()),
                          );
                          const current = normalizeEmails(to);
                          const next = current.filter(
                            (e) => !removeSet.has(e.toLowerCase()),
                          );
                          setTo(next.join(", "));
                        }}
                        disabled={crmLoading || filteredContacts.length === 0}
                        title={i18nT("deselectionner_tous_les_contacts_affiches_7417b99b")}
                      >
                        {i18nT("aucun_b2ed82f1")}{" "}</button>

                      <div className={styles.crmToolbarCount}>
                        {filteredContacts.length} {" "}{i18nT("contact_1a73af9e")}{" "}{filteredContacts.length > 1 ? "s" : ""}
                      </div>
                    </div>

                    {crmFiltersOpen ? (
                      <div className={styles.crmFiltersPanel}>
                        <label className={styles.crmFilterField}>
                          <span>{i18nT("categorie_6b38300a")}</span>
                          <select
                            value={crmCategory ?? "all"}
                            onChange={(e) =>
                              setCrmCategory(e.target.value as any)
                            }
                            className={styles.crmSelect}
                          >
                            <option value="all">{i18nT("toutes_c5f641e4")}</option>
                            <option value="particulier">{i18nT("particuliers_918ed212")}</option>
                            <option value="professionnel">
                              {i18nT("professionnels_8d94a78e")}{" "}</option>
                            <option value="collectivite_publique">
                              {i18nT("collectivites_c0c84588")}{" "}</option>
                          </select>
                        </label>

                        <label className={styles.crmFilterField}>
                          <span>{i18nT("type_3deb7456")}</span>
                          <select
                            value={crmContactType ?? "all"}
                            onChange={(e) =>
                              setCrmContactType(e.target.value as any)
                            }
                            className={styles.crmSelect}
                          >
                            <option value="all">{i18nT("tous_b97ae3b4")}</option>
                            <option value="client">{i18nT("clients_28e22fe3")}</option>
                            <option value="prospect">{i18nT("prospects_8f522b12")}</option>
                            <option value="fournisseur">{i18nT("fournisseurs_06b6d88c")}</option>
                            <option value="partenaire">{i18nT("partenaires_e56efd6d")}</option>
                            <option value="autre">{i18nT("autres_2f0dd042")}</option>
                          </select>
                        </label>

                        <label className={styles.crmFilterField}>
                          <span>{i18nT("departement_3d7c87c2")}</span>
                          <input
                            value={crmDepartment}
                            onChange={(e) => setCrmDepartment(e.target.value)}
                            className={styles.crmInput}
                            inputMode="text"
                            maxLength={3}
                            placeholder="62"
                            aria-label={i18nT("filtrer_par_departement_f4272d54")}
                          />
                        </label>

                        <button
                          type="button"
                          className={`${styles.crmImportantToggle} ${crmImportantOnly ? styles.crmImportantToggleActive : ""}`}
                          onClick={() => setCrmImportantOnly((v) => !v)}
                          aria-pressed={crmImportantOnly}
                        >
                          <span aria-hidden>
                            {crmImportantOnly ? "★" : "☆"}
                          </span>
                          <span>{i18nT("important_uniquement_ce4158c9")}</span>
                        </button>
                      </div>
                    ) : null}

                    <div className={styles.crmContactsList}>
                      {crmLoading ? (
                        <div className={styles.crmStateText}>
                          {i18nT("chargement_des_contacts_37c250fb")}{" "}</div>
                      ) : crmError ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          <div className={styles.crmStateText}>{crmError}</div>
                          <button
                            className={styles.btnPrimary}
                            type="button"
                            onClick={() => void loadCrmContacts()}
                            style={{ width: "fit-content" }}
                          >
                            {i18nT("reessayer_895d416b")}{" "}</button>
                        </div>
                      ) : filteredContacts.length === 0 ? (
                        <div className={styles.crmStateText}>
                          {i18nT("aucun_contact_9b8a0582")}{" "}</div>
                      ) : (
                        <div className={styles.crmContactsGrid}>
                          {filteredContacts.slice(0, 200).map((c) => {
                            const email = c.email ? String(c.email) : "";
                            const checked = email
                              ? selectedToSet.has(email.toLowerCase())
                              : false;
                            return (
                              <label
                                key={c.id}
                                className={`${styles.crmContactRow} ${checked ? styles.crmContactRowChecked : ""}`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={!email}
                                  checked={checked}
                                  onChange={() => {
                                    if (!email) return;
                                    toggleEmailInTo(email);
                                  }}
                                />
                                <div className={styles.crmContactText}>
                                  <div className={styles.crmContactName}>
                                    {c.full_name || i18nT("sans_nom_1f7c630b")}
                                    {c.important ? (
                                      <span className={styles.crmImportantMark}>
                                        ★
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className={styles.crmContactEmail}>
                                    {email}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section
              className={`${styles.composeSection} ${styles.composeSubjectSection}`}
            >
              <div
                className={`${styles.composeSectionHeader} ${styles.composeSubjectHeader}`}
              >
                {isWorkflowFinalizer ? (
                  <div>
                    <div className={styles.composeSectionTitle}>
                      <span className={styles.composeSectionIcon}>🏷️</span>{i18nT("objet_3de621c5")}{" "}</div>
                    <div className={styles.composeSectionHint}>
                      {i18nT("objet_prepare_depuis_value_vous_pouvez_43db283f", { value0: workflowFinalizerLabel })}</div>
                  </div>
                ) : (
                  <div className={styles.composeSubjectHeaderGrid}>
                    <div className={styles.composeSubjectHeaderMain}>
                      <div className={styles.composeSectionTitle}>
                        <span className={styles.composeSectionIcon}>🏷️</span>
                        {i18nT("objet_3de621c5")}{" "}</div>
                      <div className={styles.composeSectionHint}>
                        {i18nT("titre_visible_dans_la_boite_mail_c1aa8673")}{" "}</div>
                    </div>
                    <div className={styles.composeWritingTypeLabel}>
                      {i18nT("typologie_3b7e8267")}{" "}</div>
                    <div aria-hidden="true" />
                  </div>
                )}
              </div>
              <div
                className={
                  isWorkflowFinalizer
                    ? styles.composeSubjectFinalizerRow
                    : styles.composeSubjectInlineAiRow
                }
              >
                <div className={styles.composeSubjectInputStack}>
                  {isMobileViewport ? (
                    <TemplateSubjectInlineEditor
                      value={subject}
                      onChange={(next) =>
                        setSubject(normalizeMailSubjectDraft(next))
                      }
                      placeholder={i18nT("ex_relance_devis_presentation_de_nos_2feaebb2")}
                    />
                  ) : (
                    <input
                      value={subject}
                      onChange={(e) =>
                        setSubject(normalizeMailSubjectDraft(e.target.value))
                      }
                      onBlur={(e) =>
                        setSubject(normalizeMailSubject(e.target.value))
                      }
                      placeholder={i18nT("ex_relance_devis_presentation_de_nos_2feaebb2")}
                      style={composeInputStyle}
                    />
                  )}
                  {!subject.trim() ? (
                    <span className={styles.composeWarning}>
                      {i18nT("le_message_partira_avec_sans_objet_19716814")}{" "}</span>
                  ) : null}
                </div>
                {!isWorkflowFinalizer ? (
                  <>
                    <div className={styles.composeWritingTypeStack}>
                      <select
                        aria-label={i18nT("typologie_du_mail_09972fbd")}
                        className={styles.composeWritingTypeSelect}
                        value={mailWritingType}
                        onChange={(e) =>
                          setMailWritingType(e.target.value as MailWritingType)
                        }
                      >
                        {MAIL_WRITING_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {i18nT(option.messageKey)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.composeSubjectAiInline}>
                      <button
                        type="button"
                        className={`${styles.btnGhost} ${styles.aiGenerateBtn}`}
                        onClick={() => void generateMailWithAi()}
                        disabled={aiGenerating || attachBusy || !subject.trim()}
                        title={
                          !subject.trim()
                            ? i18nT("renseignez_d_abord_un_objet_pour_7e7699f1")
                            : attachBusy
                              ? i18nT("patientez_les_pieces_jointes_sont_encore_ac136c9e")
                              : composeAttachments.length > 0
                                ? i18nT("generate_with_attachments_title")
                                : i18nT("generate_message_title")
                        }
                      >
                        {aiGenerating ? i18nT("generation_ce4e3498") : i18nT("generer_avec_inrcy_58900495")}
                      </button>
                      {aiError ? (
                        <span className={styles.composeAiError}>{aiError}</span>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </section>

            <section
              className={`${styles.composeSection} ${styles.composeMessageSection}`}
            >
              <RichMailEditor
                text={text}
                html={html}
                onChange={({ text: nextText, html: nextHtml }) => {
                  setText(nextText);
                  setHtml(nextHtml);
                }}
                placeholder={i18nT("votre_message_ffe7b099")}
                toolbarTitle={
                  <div>
                    <div className={styles.composeSectionTitle}>
                      <span className={styles.composeSectionIcon}>✍️</span>
                      {i18nT("message_68f4145f")}{" "}</div>
                    <div className={styles.composeSectionHint}>
                      {isWorkflowFinalizer
                        ? i18nT("message_prepare_depuis_value_relisez_et_172c2523", { value0: workflowFinalizerLabel })
                        : i18nT("ajoutez_la_touche_finale_avant_l_2e3b2378")}
                    </div>
                  </div>
                }
                compactToolbar
                minHeight={"clamp(260px, 38vh, 430px)"}
                editorStyle={composeEditorStyle}
              />
              <div className={styles.composeSignaturePreview}>
                <div className={styles.composeSignaturePreviewHeader}>
                  <div>
                    <div className={styles.composeSignaturePreviewTitle}>
                      <span className={styles.composeSectionIcon}>✅</span>
                      {i18nT("signature_automatique_77745712")}{" "}</div>
                    <div className={styles.composeSignaturePreviewHint}>
                      {i18nT("elle_sera_ajoutee_automatiquement_en_bas_f1e910e0")}{" "}</div>
                  </div>
                  <div className={styles.composeSignatureActions}>
                    <span
                      className={`${styles.badge} ${signatureEnabled ? styles.composeSignatureOn : styles.composeSignatureOff}`}
                    >
                      {signatureEnabled ? i18nT("activee_9b4e7cfb") : i18nT("desactivee_74cc3b9b")}
                    </span>
                  </div>
                </div>

                {signatureEnabled ? (
                  <div className={styles.composeSignaturePreviewBox}>
                    <pre className={styles.composeSignaturePreviewText}>
                      {signaturePreview?.trim() ||
                        i18nT("apercu_indisponible_pour_le_moment_9ceb14a7")}
                    </pre>
                    {signatureImageUrl ? (
                      <div className={styles.composeSignatureImageWrap}>
                        <img
                          src={signatureImageUrl}
                          alt={i18nT("signature_automatique_77745712")}
                          style={{
                            width: `${signatureImageWidth}px`,
                            maxWidth: "100%",
                            maxHeight: 220,
                            objectFit: "contain",
                            borderRadius: 10,
                            display: "block",
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.composeSignaturePreviewEmpty}>
                    {i18nT("aucune_signature_ne_sera_ajoutee_a_e8dda5d5")}{" "}</div>
                )}
              </div>
            </section>
          </div>
        </div>

        <input
          id={fileInputId}
          type="file"
          multiple
          onChange={handleAttachmentInputChange}
          className={styles.hiddenFileInput}
        />

        <div className={`${styles.modalFooter} ${styles.composeModalFooter}`}>
          <div className={styles.composeAttachmentDock}>
            <label
              htmlFor={fileInputId}
              className={styles.btnAttach}
              aria-disabled={attachBusy}
              title={i18nT("joindre_un_fichier_20_mo_max_0776b74d")}
            >
              <span aria-hidden>📎</span>
              <span className={styles.composeAttachLabel}>{i18nT("joindre_2ee36407")}</span>
            </label>
            <button
              type="button"
              className={styles.btnAttach}
              onClick={() => setMediaLibraryOpen(true)}
              disabled={attachBusy}
              title={i18nT("joindre_depuis_la_mediatheque_132a0a6b")}
            >
              <span aria-hidden>🖼️</span>
              <span className={styles.composeAttachLabel}>{i18nT("mediatheque_e4fa8e31")}</span>
            </button>
            <span className={styles.composeAttachmentStatus}>
              {composeAttachments.length > 0
                ? i18nT("value_fichier_value_34309747", { value0: composeAttachments.length, value1: composeAttachments.length > 1 ? "s" : "" })
                : attachBusy
                  ? i18nT("preparation_47305e12")
                  : i18nT("aucun_fichier_b960337c")}
            </span>
            {composeAttachments.length > 0 ? (
              <div
                className={styles.composeAttachmentChips}
                aria-label={i18nT("pieces_jointes_ajoutees_b8f13395")}
              >
                {composeAttachments.map((f, idx) => (
                  <span
                    key={`${f.bucket}:${f.path}:${idx}`}
                    className={styles.fileChip}
                    title={f.name}
                  >
                    {f.name}
                    <button
                      type="button"
                      className={styles.fileChipRemove}
                      onClick={() =>
                        setComposeAttachments((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      aria-label={i18nT("retirer_value_c04cdfcb", { value0: f.name })}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className={styles.composeFooterActions}>
            {isWorkflowFinalizer && onWorkflowPrevious ? (
              <button
                className={`${styles.btnGhost} ${styles.composePreviousBtn}`}
                onClick={() => void onWorkflowPrevious()}
                type="button"
                disabled={sendBusy || attachBusy}
                title={i18nT("revenir_a_l_etape_precedente_81b175a7")}
                aria-label={i18nT("revenir_a_l_etape_precedente_81b175a7")}
              >
                <span className={styles.composePreviousMobileIcon} aria-hidden>
                  ←
                </span>
                <span className={styles.composePreviousDesktopText}>
                  {i18nT("precedent_a527f171")}{" "}</span>
              </button>
            ) : null}
            {scheduledEditMode && onSaveScheduledEdit ? (
              <button
                className={`${styles.btnGhost} ${styles.composeScheduledSaveBtn}`}
                onClick={() => void onSaveScheduledEdit()}
                type="button"
                disabled={sendBusy || scheduleBusy || attachBusy || scheduledEditSaving}
                title={scheduledEditSaving ? "Enregistrement en cours" : "Enregistrer les modifications sans changer la programmation"}
                aria-label={scheduledEditSaving ? "Enregistrement en cours" : "Enregistrer le mail programmé"}
                aria-busy={scheduledEditSaving}
              >
                <span aria-hidden>{scheduledEditSaving ? "…" : "💾"}</span>
                <span className={styles.composeScheduledSaveText}>
                  {scheduledEditSaving ? i18nT("enregistrement_e7d5f232") : i18nT("enregistrer_f7c8bcd8")}
                </span>
              </button>
            ) : null}
            {scheduleWorkflowCampaign ? (
              <button
                className={`${styles.btnGhost} ${styles.composeScheduleBtn}`}
                onClick={openScheduleModal}
                type="button"
                disabled={sendBusy || scheduleBusy || attachBusy}
                title={i18nT("programmer_l_envoi_avec_inr_agent_224abf77")}
              >
                <span aria-hidden>🕒</span>
                <span className={styles.composeScheduleText}>{i18nT("programmer_f704a30b")}</span>
              </button>
            ) : null}
            <button
              className={`${styles.btnPrimary} ${styles.composeSendBtn} ${scheduledEditMode ? styles.composeSendBtnScheduledEdit : ""}`}
              onClick={() => void requestSend()}
              type="button"
              disabled={sendBusy || scheduleBusy || attachBusy || scheduledEditSaving}
              title={i18nT(
                scheduledEditMode ? "send_now" : "envoyer_e9ce243b",
              )}
              aria-label={i18nT(
                scheduledEditMode ? "send_now" : "envoyer_e9ce243b",
              )}
            >
              <span className={styles.composeSendIcon} aria-hidden>➤</span>
              <span className={styles.composeSendText}>
                {attachBusy ? i18nT("preparation_47305e12") : sendBusy || scheduledEditSaving ? i18nT("envoi_a625611f") : i18nT("envoyer_e9ce243b")}
              </span>
            </button>
          </div>
        </div>

        <CampaignScheduleModal
          open={scheduleModalOpen}
          description={
            isWorkflowFinalizer
              ? i18nT("schedule_campaign_description", {
                  workflow: workflowFinalizerLabel,
                })
              : i18nT("schedule_mail_description")
          }
          recipientCount={
            composeRecipientList.length ||
            selectedCrmCount ||
            normalizeEmails(to).length
          }
          subject={subject.trim() || i18nT("sans_objet_e5ad6a39")}
          saving={Boolean(scheduleBusy || scheduledEditSaving)}
          error={scheduleError}
          successMessage={i18nT("programmation_reussie_1307249b")}
          savingLabel={i18nT("programmation_en_cours_13ae187c")}
          initialScheduledAt={scheduledEditScheduledAt}
          onClose={() => !scheduleBusy && !scheduledEditSaving && setScheduleModalOpen(false)}
          onConfirm={(scheduledAt) => confirmSchedule(scheduledAt)}
          onSuccess={async () => {
            setScheduleModalOpen(false);
            await onScheduledSuccess?.();
          }}
        />

        {toast ? (
          <div className={styles.composeToast}>
            {toast}{" "}
            <button
              className={styles.btnGhost}
              onClick={() => setToast(null)}
              type="button"
            >
              {i18nT("ok_9ce3bd42")}{" "}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
