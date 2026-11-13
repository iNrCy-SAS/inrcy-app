"use client";

import { useMailboxHistory } from "./_hooks/useMailboxHistory";
import { useInrAssistantSendHistoryControls } from "../_hooks/useInrAssistantSendHistoryControls";
import { useInrAssistantMailCommands } from "../_hooks/useInrAssistantMailCommands";
import { inrAssistantMailDraftVersion, persistInrAssistantMailDraft, type InrAssistantMailDraftVersion } from "@/lib/inrAssistantMailDraftPersistence";
import type { InrAssistantMailExecution } from "@/lib/inrAssistantMailLifecycle";
import { mergeInrAssistantMailAttachments } from "@/lib/inrAssistantMailAttachments";
import { useMailboxCrmRecipients } from "./_hooks/useMailboxCrmRecipients";
import { useMailboxPublicationMedia } from "./_hooks/useMailboxPublicationMedia";

import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { filterMetaPilotPayload } from "@/lib/metaChannelUiAccess";
import { useLocale, useTranslations } from "next-intl";

import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";

import { readWorkflowMailPrefillAttachments } from "@/app/dashboard/_lib/workflowMailPrefillAttachments";
import {
  normalizeWorkflowCampaignState,
  readWorkflowCampaignState,
  saveWorkflowCampaignState,
  workflowCampaignTargetFromTrack,
} from "@/app/dashboard/_lib/workflowCampaignState";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./mails.module.css";
import { createClient } from "@/lib/supabaseClient";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { getPinterestPublicationEditText, orderPinterestPublicationEditImages } from "./_lib/pinterestPublicationEditText";
import { getInstagramPublicationEditText } from "./_lib/instagramPublicationEditText";
import {
  containsForbiddenXUrl,
  X_FORBIDDEN_URL_ERROR,
} from "@/lib/xChannel";

import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
} from "@/lib/boosterVideoTransforms";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { canRemoveInstagramDraftLocally } from "@/lib/inrsend/instagramCapabilities";
import { publicationEditSourceVersion } from "@/lib/inrsend/publicationEditVersion";

import MailboxHeader from "./_components/MailboxHeader";
import PublishAiConfigurationDrawer from "../booster/publier/components/PublishAiConfigurationDrawer";
import FolderTabs from "./_components/FolderTabs";
import AdsCampaignsFolder from "./_components/AdsCampaignsFolder";
import { useAdsCampaignCount } from "./_hooks/useAdsCampaignCount";
import MailboxToolbar from "./_components/MailboxToolbar";
import MailboxList from "./_components/MailboxList";
import MailboxSearchPanel from "./_components/MailboxSearchPanel";
import MailboxDetailsModal from "./_components/MailboxDetailsModal";

import { useInrStudioSession } from "@/app/dashboard/_hooks/useInrStudioSession";
import {
  consumeInrStudioReturn,
  createInrStudioHandoff,
    clearInrStudioHandoff,
  type InrStudioReturnedMedia,
} from "@/lib/inrStudioNavigation";
import {
  consumeInrSendPublicationEditorSnapshot,
  type InrSendPublicationEditorSnapshot,
} from "./_lib/mailboxStudioSnapshot";
import MailboxComposeModal from "./_components/MailboxComposeModal";
import {
  ALL_FOLDERS,
  BULK_CONFIRM_STRONG_THRESHOLD,
  BULK_CONFIRM_WARNING_THRESHOLD,
  MAILBOX_PAGE_SIZE,
  MAILBOX_RECIPIENTS_PAGE_SIZE,
  MAIL_ACCOUNTS_UPDATED_EVENT,
  applyCampaignRecipientsFilter,
  arePublicationTransformsEquivalent,
  buildDefaultMailText,
  bulkConfirmationMessage,
  campaignCounts,
  campaignReportToHealth,
  channelApiPath,
  extractChannelPublications,
  extractPublicationParts,
  folderFromTrack,
  formatCampaignDuration,
  formatCampaignProgress,
  formatChannelLabel,
  getPublicationChannelPreset,
  isBusinessMailFolder,
  isPublicationTransformModified,
  normalizeChannelKey,
  orderChannelKeys,
  renderPublicationImageAsset,
  safeDecode,
  tagsToEditorString,
  type BoxView,
  type CampaignExperienceReport,
  type CampaignHealthSummary,
  type CampaignRecipientLog,
  type CampaignRecipientsFilterId,
  type ChannelPublication,
  type ComposeAttachmentRef,
  type ComposeCrmRecipientHint,
  type Folder,
  type MailAccount,
  type OutboxItem,
  type PublicationEditForm,
  type SendType,
  type Status,
} from "./_lib/mailboxPhase1";

import {
  MAILBOX_FILE_INPUT_ID,
  PUBLICATION_EDIT_FILE_INPUT_ID,
  itemMailAccountId,
  makeAttachmentPath,
  normalizeComposeRecipientHints,
  normalizeEmails,
  providerSendEndpoint,
} from "./_lib/mailboxPhase25";
import { normalizeMailSubject } from "@/lib/mailEncoding";
import { resolveMailAccountSelection } from "./_lib/mailboxAccountSelection";
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import {
  normalizeRichMailHtmlForSend,
  textToRichMailHtml,
} from "@/lib/mailRichText";

import {
  normalizeBoosterChannelKeyForVideo,
  type CampaignDistributionNotice,
} from "./_lib/mailboxPublicationVideo.foundations";
import {
  asScheduledRecord,
  inferTrackFromCampaign,
  normalizeCampaignAttachments,
  sanitizeCrmDepartmentFilter,
  serializeComposeAttachments,
  workflowDraftTargetFromSendItem,
  type PendingTrack,
} from "./_lib/mailboxComposeCampaign.foundations";

export default function MailboxClient({
  standardMode = false,
  founderMode = false,
  adsEnabled = false,
}: {
  standardMode?: boolean;
  founderMode?: boolean;
  adsEnabled?: boolean;
}) {
  const { metaPilotEnabled, activeAccountId } = useDashboardViewerAccess();
  const i18nT = useTranslations("mails");
  const locale = useLocale();
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const adsCampaignsSelected = adsEnabled && searchParams?.get("folder") === "campagnes-ads";
  const { count: adsCampaignCount, error: adsCampaignCountError, refresh: refreshAdsCampaignCount } = useAdsCampaignCount(adsEnabled, activeAccountId);
  const supabase = useMemo(() => createClient(), []);
  const visibleFolders = useMemo(
    () => standardMode ? ALL_FOLDERS.filter((candidate) => candidate === "publications")
      : founderMode ? ALL_FOLDERS
        : ALL_FOLDERS.filter((candidate) => candidate !== "factures" && candidate !== "devis"),
    [founderMode, standardMode],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiConfigurationOpen, setAiConfigurationOpen] = useState(false);
  const [isMobileHeader, setIsMobileHeader] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobileHeader(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const {
    folder,
    setFolder,
    boxView,
    setBoxView,
    items,
    setItems,
    loading,
    historyCountsLoadedOnce,
    selectedId,
    setSelectedId,
    historyPage,
    historyHasMorePotential,
    historyTotalCount,
    folderCounts,
    draftFolderCounts,
    filterAccountId,
    setFilterAccountId,
    historyQuery,
    setHistoryQuery,
    searchOpen,
    setSearchOpen,
    historySearchRef,
    loadHistory,
    filteredItems,
    historyPageCount,
    historyReadVersion,
    historyDisplayedContextKey,
    visibleItems
  } = useMailboxHistory({ metaPilotEnabled });

  // Détails : ouverture en double-clic dans une fenêtre au-dessus (modal)
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [detailsChannelKey, setDetailsChannelKey] = useState<string | null>(
    null,
  );
  const [detailsEditMode, setDetailsEditMode] = useState(false);
  const [detailsActionBusy, setDetailsActionBusy] = useState(false);
  const [detailsActionError, setDetailsActionError] = useState<string | null>(
    null,
  );
  const [detailsActionSuccess, setDetailsActionSuccess] = useState<
    string | null
  >(null);
  const [detailsNavigationBusy, setDetailsNavigationBusy] = useState(false);
  const [pendingStudioReturn, setPendingStudioReturn] =
    useState<InrStudioReturnedMedia | null>(null);
  const [pendingStudioReturnStage, setPendingStudioReturnStage] = useState<
    "restore" | "wait" | "apply"
  >("restore");
  const [pendingStudioEditorSnapshot, setPendingStudioEditorSnapshot] =
    useState<InrSendPublicationEditorSnapshot | null>(null);
  const [resolvedStudioEditorSnapshotKey, setResolvedStudioEditorSnapshotKey] =
    useState<string | null>(null);
  const [failedStudioEditorSnapshotKey, setFailedStudioEditorSnapshotKey] =
    useState<string | null>(null);
  const studioEditorSnapshotLoadRef = useRef("");
  const receiveEmbeddedStudioReturn = useCallback(
    (returned: InrStudioReturnedMedia) => {
      // The iNrSend editor is still mounted behind Studio. Apply directly to
      // that live draft instead of restoring the navigation fallback snapshot.
      setPendingStudioReturn(returned);
      setPendingStudioReturnStage("apply");
    },
    [],
  );
  const {
    openStudio,
    studio,
    activeTab: publicationStudioTab,
    completeReturn: completeEmbeddedStudioReturn,
  } = useInrStudioSession({ onReturned: receiveEmbeddedStudioReturn });
  const [detailsSourceDocPayload, setDetailsSourceDocPayload] = useState<
    any | null
  >(null);
  const [campaignRecipients, setCampaignRecipients] = useState<
    CampaignRecipientLog[]
  >([]);
  const [campaignRecipientsLoading, setCampaignRecipientsLoading] =
    useState(false);
  const [campaignRecipientsPage, setCampaignRecipientsPage] = useState(1);
  const [campaignRecipientsPageCount, setCampaignRecipientsPageCount] =
    useState(1);
  const [campaignRecipientsTotal, setCampaignRecipientsTotal] = useState(0);
  const [campaignRecipientsFilter, setCampaignRecipientsFilter] =
    useState<CampaignRecipientsFilterId>("all");
  const [campaignHealth, setCampaignHealth] =
    useState<CampaignHealthSummary | null>(null);
  const [campaignHealthLoading, setCampaignHealthLoading] = useState(false);
  const [campaignReport, setCampaignReport] =
    useState<CampaignExperienceReport | null>(null);
  const [campaignSummaryBusyId, setCampaignSummaryBusyId] = useState<string | null>(null);
  const [campaignActionBusyId, setCampaignActionBusyId] = useState<
    string | null
  >(null);
  const [publicationEditForm, setPublicationEditForm] =
    useState<PublicationEditForm>({
      title: "",
      content: "",
      cta: "",
      ctaMode: "none",
      ctaUrl: "",
      ctaPhone: "",
      hashtags: "",
    });

  useEffect(() => {
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyTouchAction = body.style.touchAction;

    if (detailsOpen) {
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.touchAction = "none";
    }

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.touchAction = previousBodyTouchAction;
    };
  }, [detailsOpen]);

  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  const [requestedAccountId, setSelectedAccountId] = useState<string>("");
  const selectedAccount = resolveMailAccountSelection(mailAccounts, requestedAccountId);
  const selectedAccountId = selectedAccount?.id || "";

  // Compose
  const [composeOpen, setComposeOpen] = useState(false);
  const [draftId, setDraftIdState] = useState<string | null>(null);
  const [draftServerVersion, setDraftServerVersion] = useState<InrAssistantMailDraftVersion | null>(null);
  const setDraftId = useCallback((id: string | null) => { setDraftIdState(id); setDraftServerVersion(null); }, []);
  const [composeType, setComposeType] = useState<SendType>("mail");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [, setFiles] = useState<File[]>([]);
  const [composeAttachments, setComposeAttachments] = useState<
    ComposeAttachmentRef[]
  >([]);
  const [composeRecipientHints, setComposeRecipientHints] = useState<
    ComposeCrmRecipientHint[]
  >([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [composeSourceDocSaveId, setComposeSourceDocSaveId] =
    useState<string>("");
  const [composeSourceDocType, setComposeSourceDocType] = useState<
    "devis" | "facture" | ""
  >("");
  const [composeSourceDocNumber, setComposeSourceDocNumber] =
    useState<string>("");
  const [composeTemplateKey, setComposeTemplateKey] = useState<string>("");
  const [sendBusy, setSendBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [campaignDistributionNotice, setCampaignDistributionNotice] =
    useState<CampaignDistributionNotice | null>(null);
  const [signaturePreview, setSignaturePreview] = useState("Cordialement,");
  const [signatureEnabled, setSignatureEnabled] = useState(true);
  const [signatureImageUrl, setSignatureImageUrl] = useState("");
  const [signatureImageWidth, setSignatureImageWidth] = useState(400);
  const [lastSavedComposeSnapshot, setLastSavedComposeSnapshot] = useState<
    string | null
  >(null);
  const [scheduledMailEdit, setScheduledMailEdit] =
    useState<ScheduledMailEditState | null>(null);
  const scheduledMailEditLoadRef = useRef<string>("");
  const [scheduledMailEditSaving, setScheduledMailEditSaving] = useState(false);

  useEffect(() => {
    if (!standardMode) return;

    const requestedBoxView = String(searchParams?.get("boxView") || "").toLowerCase();
    const nextBoxView: BoxView = requestedBoxView === "drafts" ? "drafts" : "sent";
    setFolder("publications");
    setBoxView(nextBoxView);
    setFilterAccountId("");
    setSettingsOpen(false);
    setComposeOpen(false);

    const requestedFolder = String(searchParams?.get("folder") || "").toLowerCase();
    const hasPremiumComposeIntent = [
      "compose",
      "template_key",
      "finalizer",
      "workflow_finalizer",
      "scheduled_edit_id",
    ].some((key) => searchParams?.has(key));
    if ((requestedFolder && requestedFolder !== "publications" && !(adsEnabled && requestedFolder === "campagnes-ads")) || hasPremiumComposeIntent) {
      router.replace("/dashboard/mails?folder=publications", { scroll: false });
    }
  }, [adsEnabled, router, searchParams, standardMode, setBoxView, setFilterAccountId, setFolder]);

  // Attachments uploaded by Factures / Devis screens are stored here.
  const ATTACH_BUCKET = "inrbox_attachments";
  const lastAttachKeyRef = useRef<string>("");

  // Optional tracking intent passed by Booster / Propulser / Fidéliser templates.
  // iNr'Send must only count items that are actually SENT.
  const [pendingTrack, setPendingTrack] = useState<PendingTrack | null>(null);
  type CampaignReuseMode = "reuse" | "resend";

  type ScheduledMailEditState = {
    id: string;
    scheduledAt: string | null;
    title: string;
    payload: Record<string, any>;
  };

  const {
    crmLoading,
    crmFilter,
    setCrmFilter,
    crmSearchOpen,
    setCrmSearchOpen,
    crmSearchRef,
    crmError,
    crmPickerOpen,
    setCrmPickerOpen,
    crmCategory,
    setCrmCategory,
    crmContactType,
    setCrmContactType,
    crmDepartment,
    setCrmDepartment,
    crmImportantOnly,
    setCrmImportantOnly,
    toggleEmailInTo,
    filteredContacts,
    selectedToSet,
    selectedCrmCount,
    crmRecipientsByEmail,
    composeRecipientHintsByEmail,
    loadCrmContacts
  } = useMailboxCrmRecipients({
    composeOpen,
    to,
    setTo,
    composeRecipientHints,
  });

  // Used to trigger the hidden file input with a nice button
  const fileInputId = MAILBOX_FILE_INPUT_ID;
  const publicationEditFileInputId = PUBLICATION_EDIT_FILE_INPUT_ID;

  async function uploadComposeFiles(nextFiles: File[]) {
    if (!nextFiles.length) return [] as ComposeAttachmentRef[];
    setAttachBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id ? resolveActiveBrowserUserId(auth.user.id) : null;
      const uploaded: ComposeAttachmentRef[] = [];
      for (const file of nextFiles) {
        const path = makeAttachmentPath(file.name || "piece-jointe", userId);
        const { error } = await supabase.storage
          .from(ATTACH_BUCKET)
          .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || "application/octet-stream",
          });
        if (error) throw error;
        uploaded.push({
          bucket: ATTACH_BUCKET,
          path,
          name: file.name || "piece-jointe",
          type: file.type || "application/octet-stream",
          size: file.size || 0,
        });
      }
      return uploaded;
    } finally {
      setAttachBusy(false);
    }
  }

  const counts = folderCounts;
  const currentFolderDraftCount = draftFolderCounts[folder] || 0;

  const makeComposeSnapshot = useCallback((input?: {
    selectedAccountId?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
    composeType?: SendType;
    composeAttachments?: ComposeAttachmentRef[];
    composeSourceDocSaveId?: string;
    composeSourceDocType?: string;
    composeSourceDocNumber?: string;
    composeTemplateKey?: string;
    pendingTrack?: PendingTrack | null;
  }) => {
    const source = input || {};
    return JSON.stringify({
      selectedAccountId: source.selectedAccountId ?? selectedAccountId ?? "",
      to: source.to ?? to ?? "",
      subject: source.subject ?? subject ?? "",
      text: source.text ?? text ?? "",
      html: source.html ?? html ?? "",
      composeType: source.composeType ?? composeType,
      attachments: serializeComposeAttachments(
        source.composeAttachments ?? composeAttachments,
      ),
      sourceDocSaveId:
        source.composeSourceDocSaveId ?? composeSourceDocSaveId ?? "",
      sourceDocType: source.composeSourceDocType ?? composeSourceDocType ?? "",
      sourceDocNumber:
        source.composeSourceDocNumber ?? composeSourceDocNumber ?? "",
      templateKey: source.composeTemplateKey ?? composeTemplateKey ?? "",
      pendingTrack: source.pendingTrack ?? pendingTrack ?? null,
    });
  }, [
    selectedAccountId, to, subject, text, html, composeType, composeAttachments,
    composeSourceDocSaveId, composeSourceDocType, composeSourceDocNumber,
    composeTemplateKey, pendingTrack,
  ]);

  const currentComposeSnapshot = useMemo(
    () => makeComposeSnapshot(),
    [makeComposeSnapshot],
  );

  const assistantMailControls = useRef<{ send: (execution: InrAssistantMailExecution) => Promise<void> } | null>(null);
  const [assistantScheduleOpen, setAssistantScheduleOpen] = useState(false);
  const [assistantConsumedSnapshot, setAssistantConsumedSnapshot] = useState<string | null>(null);
  const assistantComposeConsumed = assistantConsumedSnapshot === currentComposeSnapshot;
  useInrAssistantMailCommands({
    open: composeOpen,
    enabled: composeOpen && !scheduledMailEdit && !assistantComposeConsumed && !sendBusy && !scheduleBusy && !attachBusy && !scheduledMailEditSaving,
    snapshot: { currentComposeSnapshot, draftId, scheduledMailEdit },
    pendingChanges: lastSavedComposeSnapshot !== currentComposeSnapshot,
    consumed: assistantComposeConsumed,
    canSchedule: composeType === "mail",
    openSchedule: () => setAssistantScheduleOpen(true), scheduleOpen: assistantScheduleOpen,
    save: async execution => {
      try { await saveDraft(execution); }
      catch (error) { setToast(getClientUserFacingErrorMessage(error, i18nT("draft_save_failed"))); throw error; }
    },
    send: async execution => { if (assistantMailControls.current) await assistantMailControls.current.send(execution); },
    apply: command => {
      if (command.command !== "configure_mail_draft") return false;
      const patch = command.patch;
      const attachments = patch.attachments ? mergeInrAssistantMailAttachments(composeAttachments, patch.attachments) : null;
      if (patch.attachments && !attachments) return false;
      if (patch.recipient !== undefined) setTo(patch.recipient);
      if (patch.subject !== undefined) setSubject(patch.subject);
      if (patch.bodyText !== undefined) { setText(patch.bodyText); setHtml(""); }
      if (attachments) setComposeAttachments(attachments);
      return true;
    },
    isApplied: command => command.command === "configure_mail_draft"
      && (command.patch.recipient === undefined || to === command.patch.recipient)
      && (command.patch.subject === undefined || subject === command.patch.subject)
      && (!command.patch.attachments || command.patch.attachments.every(item => composeAttachments.some(existing => existing.bucket === item.bucket && existing.path === item.path)))
      && (command.patch.bodyText === undefined || text === command.patch.bodyText && html === ""),
  });

  function setComposeSavedSnapshotFromCurrent() {
    setLastSavedComposeSnapshot(makeComposeSnapshot());
  }

  function buildScheduledMailEditPayload(scheduledAt?: string | null) {
    if (!scheduledMailEdit) return null;
    if (!selectedAccount) {
      throw new Error(i18nT(mailAccounts.length ? "select_send_account" : "veuillez_connecter_une_boite_d_envoi_98abd470"));
    }
    const recipientsList = normalizeEmails(to);
    if (recipientsList.length === 0) {
      throw new Error(i18nT("veuillez_ajouter_au_moins_un_destinataire_7e03a00e"));
    }

    const existingPayload = asScheduledRecord(scheduledMailEdit.payload);
    const existingCampaign = asScheduledRecord(existingPayload.campaign);
    const cleanSubject = normalizeMailSubject(
      subject.trim() || i18nT("sans_objet_e5ad6a39"),
    );
    const campaignPayload = {
      ...existingCampaign,
      accountId: selectedAccount.id,
      accountEmail: selectedAccount.email_address || "",
      accountProvider: selectedAccount.provider || "",
      type: composeType,
      folder: "mails",
      trackKind: undefined,
      trackType: undefined,
      templateKey: composeTemplateKey || undefined,
      subject: cleanSubject,
      text: text || "",
      html: normalizeRichMailHtmlForSend(text, html),
      recipients: recipientsList.map((email) => {
        const lower = email.toLowerCase();
        const hint = composeRecipientHintsByEmail.get(lower);
        const crmContact = crmRecipientsByEmail.get(lower);
        return {
          email,
          contact_id: hint?.contact_id || crmContact?.contact_id || null,
          display_name: hint?.display_name || crmContact?.display_name || null,
        };
      }),
      attachments: serializeComposeAttachments(composeAttachments),
      sourceDocSaveId: composeSourceDocSaveId || undefined,
      sourceDocType: composeSourceDocType || undefined,
      sourceDocNumber: composeSourceDocNumber || undefined,
    };

    return {
      automationKey: null,
      actionType: "mailing",
      targetTool: "mails",
      title: i18nT("mail_value_772b3623", { value0: cleanSubject }),
      summary: i18nT("scheduled_mail_recipient_summary", {
        count: recipientsList.length,
        account:
          selectedAccount.email_address ||
          selectedAccount.provider ||
          i18nT("connected_mailbox"),
      }),
      ...(scheduledAt ? { scheduledAt } : {}),
      channels: ["mails"],
      payload: {
        ...existingPayload,
        kind: "mail_campaign",
        origin: "inrsend_mail",
        workflowFinalizerKind: null,
        campaign: campaignPayload,
      },
    };
  }

  async function patchScheduledMailEdit(
    body: Record<string, unknown>,
  ): Promise<ScheduledMailEditState> {
    if (!scheduledMailEdit) {
      throw new Error(i18nT("scheduled_mail_missing"));
    }
    const response = await fetch(
      `/api/agent/scheduled-actions/${scheduledMailEdit.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = (await response.json().catch(() => null)) as {
      scheduledAction?: any;
      error?: string;
    } | null;
    if (!response.ok || !data?.scheduledAction) {
      throw new Error(
        data?.error || i18nT("scheduled_mail_save_failed"),
      );
    }
    return {
      id: String(data.scheduledAction.id),
      scheduledAt: data.scheduledAction.scheduledAt || null,
      title: String(data.scheduledAction.title || i18nT("scheduled_mail_default_title")),
      payload: asScheduledRecord(data.scheduledAction.payload),
    };
  }

  async function saveScheduledMailEdit(scheduledAt?: string | null) {
    const body = buildScheduledMailEditPayload(scheduledAt);
    if (!body) return;
    setScheduledMailEditSaving(true);
    try {
      const saved = await patchScheduledMailEdit(body);
      setScheduledMailEdit(saved);
      setLastSavedComposeSnapshot(makeComposeSnapshot());
      setToast(i18nT("mail_programme_enregistre_85a78243"));
      setComposeOpen(false);
      setScheduledMailEdit(null);
      scheduledMailEditLoadRef.current = "";
    } catch (error) {
      const message = getClientUserFacingErrorMessage(
        error,
        i18nT("scheduled_mail_save_failed"),
      );
      setToast(message);
    } finally {
      setScheduledMailEditSaving(false);
    }
  }

  async function sendScheduledMailEditNow() {
    if (!scheduledMailEdit) return;
    const body = buildScheduledMailEditPayload(null);
    if (!body) return;
    setScheduledMailEditSaving(true);
    try {
      await patchScheduledMailEdit(body);
      const response = await fetch(
        `/api/agent/scheduled-actions/${scheduledMailEdit.id}/execute`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error || i18nT("scheduled_mail_send_now_failed"),
        );
      }
      setToast(i18nT("mail_lance_maintenant_la_programmation_future_73010184"));
      setComposeOpen(false);
      setScheduledMailEdit(null);
      await loadHistory();
      updateFolder("mails");
    } catch (error) {
      setToast(
        getClientUserFacingErrorMessage(
          error,
          i18nT("scheduled_mail_send_now_failed"),
        ),
      );
    } finally {
      setScheduledMailEditSaving(false);
    }
  }

  function setComposeBody(nextText: string, nextHtml?: string | null) {
    const cleanText = stripTemplateSignatureBlock(String(nextText || ""));
    setText(cleanText);
    setHtml(
      normalizeRichMailHtmlForSend(
        cleanText,
        nextHtml || textToRichMailHtml(cleanText),
      ),
    );
  }

  function resetCompose(nextType: SendType = "mail") {
    setAssistantScheduleOpen(false);
    setAssistantConsumedSnapshot(null);
    setDraftId(null);
    setLastSavedComposeSnapshot(null);
    setComposeType(nextType);
    setComposeSourceDocSaveId("");
    setComposeSourceDocType("");
    setComposeSourceDocNumber("");
    setComposeTemplateKey("");
    setPendingTrack(null);
    setScheduledMailEdit(null);
    setTo("");
    setSubject("");
    setComposeBody(buildDefaultMailText({ kind: nextType }));
    setFiles([]);
    setComposeAttachments([]);
    setComposeRecipientHints([]);
    setCrmPickerOpen(false);
  }

  function openWorkflowCampaignDraft(
    item: OutboxItem,
    raw: Record<string, any>,
  ) {
    const target = workflowDraftTargetFromSendItem(item, raw);
    if (!target) return false;

    const supplemental =
      raw.draft_state && typeof raw.draft_state === "object" && !Array.isArray(raw.draft_state)
        ? (raw.draft_state as Record<string, unknown>)
        : {};
    // Un brouillon enregistré dans le compositeur doit rouvrir le compositeur,
    // pas faire reculer artificiellement l'utilisateur dans l'éditeur de campagne.
    if (supplemental.stage === "compose") return false;

    const restored = normalizeWorkflowCampaignState({
      ...supplemental,
      version: 1,
      kind: target.kind,
      action: target.action,
      folder: target.folder,
      trackKind: target.kind,
      trackType: target.trackType,
      templateKey: String(raw.template_key || "") || null,
      subject: normalizeMailSubject(String(raw.subject || item.subject || "")),
      bodyText: String(raw.body_text || item.detailText || ""),
      bodyHtml: String(
        raw.body_html ||
          item.detailHtml ||
          textToRichMailHtml(String(raw.body_text || item.detailText || "")),
      ),
      attachments: normalizeCampaignAttachments(raw.attachments),
      selectedAccountId: String(raw.integration_id || supplemental.selectedAccountId || "") || null,
      provider: String(raw.provider || supplemental.provider || "") || null,
      toEmails: String(raw.to_emails || supplemental.toEmails || ""),
      draftId: item.id,
      createdAt: new Date(String(raw.created_at || Date.now())).getTime(),
      updatedAt: new Date(String(raw.updated_at || raw.created_at || Date.now())).getTime(),
    });
    if (!restored) return false;

    const restoreKey = saveWorkflowCampaignState(restored);

    setDetailsOpen(false);
    setComposeOpen(false);
    router.push(
      `/dashboard/${target.kind}?action=${encodeURIComponent(target.action)}&restore_key=${encodeURIComponent(restoreKey)}`,
    );
    return true;
  }

  async function loadAllCampaignRecipientsForCompose(
    campaignId: string,
  ): Promise<ComposeCrmRecipientHint[]> {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ? resolveActiveBrowserUserId(auth.user.id) : null;
    if (!userId) throw new Error(i18nT("active_establishment_unavailable"));

    const pageSize = 1000;
    let from = 0;
    const result: ComposeCrmRecipientHint[] = [];
    const seen = new Set<string>();

    for (let guard = 0; guard < 20; guard += 1) {
      const toRange = from + pageSize - 1;
      const { data, error } = await supabase
        .from("mail_campaign_recipients")
        .select("email,display_name,contact_id")
        .eq("user_id", userId)
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true })
        .range(from, toRange);

      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      for (const row of rows as any[]) {
        const email = String(row?.email || "").trim();
        const lower = email.toLowerCase();
        if (!email || seen.has(lower)) continue;
        seen.add(lower);
        result.push({
          email,
          contact_id: row?.contact_id || null,
          display_name: row?.display_name || null,
        });
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return result;
  }

  async function openCampaignComposeFromHistory(
    item: OutboxItem,
    mode: CampaignReuseMode,
  ) {
    if (!item || item.source !== "mail_campaigns") return;
    if (campaignActionBusyId) return;

    const raw = ((item as any).raw || {}) as Record<string, any>;
    setCampaignActionBusyId(item.id);

    try {
      const nextType: SendType =
        founderMode && (raw.type === "facture" || raw.type === "devis") ? raw.type : "mail";
      const track = inferTrackFromCampaign(item);
      const recipients =
        mode === "resend"
          ? await loadAllCampaignRecipientsForCompose(item.id)
          : [];

      if (mode === "resend" && recipients.length === 0) {
        setToast(
          i18nT("impossible_de_retrouver_les_destinataires_de_a9386f01"),
        );
        return;
      }

      setDraftId(null);
      setComposeType(nextType);
      setComposeTemplateKey(String(raw.template_key || ""));
      setComposeSourceDocSaveId(founderMode ? String(raw.source_doc_save_id || "") : "");
      setComposeSourceDocType(
        founderMode && (raw.source_doc_type === "facture" || raw.source_doc_type === "devis")
          ? raw.source_doc_type
          : "",
      );
      setComposeSourceDocNumber(String(raw.source_doc_number || ""));
      setSubject(
        normalizeMailSubject(
          String(raw.subject || item.subject || "").trim() ||
            i18nT("sans_objet_e5ad6a39"),
        ),
      );
      setComposeBody(
        String(raw.body_text || item.detailText || ""),
        String(raw.body_html || ""),
      );
      setFiles([]);
      setComposeAttachments(normalizeCampaignAttachments(raw.attachments));
      setTo(
        mode === "resend"
          ? recipients.map((recipient) => recipient.email).join(", ")
          : "",
      );
      setComposeRecipientHints(mode === "resend" ? recipients : []);
      setCrmPickerOpen(mode === "reuse");

      if (raw.integration_id) {
        setSelectedAccountId(String(raw.integration_id));
      }

      setPendingTrack(
        track
          ? {
              ...track,
              payload: {
                ...(track.payload || {}),
                reused_from_campaign_id: item.id,
                reuse_mode: mode,
              },
            }
          : null,
      );

      lastAttachKeyRef.current = "";
      setDetailsOpen(false);
      setComposeOpen(true);
      setToast(
        mode === "resend"
          ? i18nT("campaign_ready_to_resend")
          : i18nT("campaign_ready_to_reuse"),
      );
    } catch (error) {
      console.error(error);
      setToast(i18nT("impossible_de_preparer_cette_campagne_pour_24419c7f"));
    } finally {
      setCampaignActionBusyId(null);
    }
  }

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/integrations/status", { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return;

    // Backward/forward compatibility:
    // - new API returns { mailAccounts }
    // - older API could return { accounts }
    const accounts = Array.isArray(j?.mailAccounts)
      ? (j.mailAccounts as any[])
      : Array.isArray(j?.accounts)
        ? (j.accounts as any[]).filter((a) => a?.category === "mail")
        : [];

    setMailAccounts(accounts as any);

    const accountIds = new Set(
      accounts.map((a) => String(a?.id || "")).filter(Boolean),
    );

    setSelectedAccountId((prev) =>
      resolveMailAccountSelection(accounts as MailAccount[], prev)?.id || "",
    );
    setFilterAccountId((prev) => (prev && accountIds.has(prev) ? prev : ""));
  }, [setFilterAccountId]);

  async function loadSignature(accountId?: string) {
    try {
      const params = new URLSearchParams();
      if (accountId) params.set("accountId", accountId);
      const url = params.toString()
        ? `/api/inrsend/signature?${params.toString()}`
        : "/api/inrsend/signature";
      const res = await fetch(url, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setSignatureEnabled(j?.enabled !== false);
      setSignaturePreview(String(j?.preview || "").trim() || "Cordialement,");
      setSignatureImageUrl(String(j?.imageUrl || ""));
      setSignatureImageWidth(Number(j?.imageWidth || 400) || 400);
    } catch {
      // keep fallback signature
    }
  }

  const detailsItem = useMemo(() => {
    if (!detailsId) return null;
    return items.find((x) => x.id === detailsId) || null;
  }, [items, detailsId]);

  const detailsItemIndex = useMemo(
    () => (detailsId ? visibleItems.findIndex((item) => item.id === detailsId) : -1),
    [detailsId, visibleItems],
  );
  const detailsCanNavigatePrevious = Boolean(
    detailsItem && (detailsItemIndex > 0 || historyPage > 1),
  );
  const detailsCanNavigateNext = Boolean(
    detailsItem &&
      (detailsItemIndex >= 0 && detailsItemIndex < visibleItems.length - 1
        ? true
        : historyTotalCount != null
          ? historyPage < historyPageCount
          : historyHasMorePotential),
  );
  const detailsNavigationLabel = useMemo(() => {
    if (!detailsItem || detailsItemIndex < 0) return "—";
    const position = (historyPage - 1) * MAILBOX_PAGE_SIZE + detailsItemIndex + 1;
    const loadedThrough =
      (historyPage - 1) * MAILBOX_PAGE_SIZE + visibleItems.length;
    const totalLabel =
      historyTotalCount != null
        ? String(historyTotalCount)
        : historyHasMorePotential
          ? `${Math.max(position + 1, loadedThrough + 1)}+`
          : String(Math.max(position, loadedThrough));
    return `${position} / ${totalLabel}`;
  }, [
    detailsItem,
    detailsItemIndex,
    historyHasMorePotential,
    historyPage,
    historyTotalCount,
    visibleItems.length,
  ]);

  const detailsAccountLabel = useMemo(() => {
    if (!detailsItem) return "";
    const id = itemMailAccountId(detailsItem);
    if (!id) return "";
    const acc = mailAccounts.find((a) => a.id === id);
    if (!acc) return "";
    return (
      (acc.display_name ? `${acc.display_name} — ` : "") + acc.email_address
    );
  }, [detailsItem, mailAccounts]);

  const detailsPayload = useMemo(() => {
    return detailsItem && detailsItem.source === "app_events"
      ? filterMetaPilotPayload(((detailsItem as any)?.raw?.payload || null) as any, metaPilotEnabled)
      : null;
  }, [detailsItem, metaPilotEnabled]);

  const loadCampaignRecipients = useCallback(
    async (
      campaignId: string,
      targetPage = campaignRecipientsPage,
      targetFilter = campaignRecipientsFilter,
    ) => {
      if (!campaignId) {
        setCampaignRecipients([]);
        setCampaignRecipientsTotal(0);
        setCampaignRecipientsPageCount(1);
        return;
      }
      setCampaignRecipientsLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth?.user?.id ? resolveActiveBrowserUserId(auth.user.id) : null;
        if (!userId) throw new Error(i18nT("active_establishment_unavailable"));

        const safePage = Math.max(1, targetPage);
        const from = (safePage - 1) * MAILBOX_RECIPIENTS_PAGE_SIZE;
        const to = from + MAILBOX_RECIPIENTS_PAGE_SIZE - 1;
        let query: any = supabase
          .from("mail_campaign_recipients")
          .select(
            "id,email,display_name,status,error,last_error,attempt_count,max_attempts,next_attempt_at,sent_at,updated_at,suppression_reason,bounce_type,bounced_at,unsubscribed_at,delivery_status,delivery_event,delivery_last_event_at,delivered_at,failure_kind,failure_retryable,provider_status",
            { count: "exact" },
          )
          .eq("user_id", userId)
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: true });
        query = applyCampaignRecipientsFilter(query, targetFilter);
        const { data, error, count } = await query.range(from, to);
        if (error) throw error;
        const total = Math.max(0, Number(count || 0));
        setCampaignRecipients(
          ((data || []) as any[]).map((row: any) => ({
            id: String(row.id || ""),
            email: String(row.email || ""),
            display_name: row.display_name || null,
            status: String(row.status || "queued"),
            error: row.error || null,
            last_error: row.last_error || null,
            attempt_count:
              row.attempt_count == null ? null : Number(row.attempt_count),
            max_attempts:
              row.max_attempts == null ? null : Number(row.max_attempts),
            next_attempt_at: row.next_attempt_at || null,
            sent_at: row.sent_at || null,
            updated_at: row.updated_at || null,
            suppression_reason: row.suppression_reason || null,
            bounce_type: row.bounce_type || null,
            bounced_at: row.bounced_at || null,
            unsubscribed_at: row.unsubscribed_at || null,
            delivery_status: row.delivery_status || null,
            delivery_event: row.delivery_event || null,
            delivery_last_event_at: row.delivery_last_event_at || null,
            delivered_at: row.delivered_at || null,
            failure_kind: row.failure_kind || null,
            failure_retryable: row.failure_retryable == null ? null : Boolean(row.failure_retryable),
            provider_status: row.provider_status == null ? null : Number(row.provider_status),
          })),
        );
        setCampaignRecipientsTotal(total);
        setCampaignRecipientsPageCount(
          Math.max(1, Math.ceil(total / MAILBOX_RECIPIENTS_PAGE_SIZE)),
        );
      } catch (error) {
        console.error(error);
        setCampaignRecipients([]);
        setCampaignRecipientsTotal(0);
        setCampaignRecipientsPageCount(1);
      } finally {
        setCampaignRecipientsLoading(false);
      }
    },
    [campaignRecipientsFilter, campaignRecipientsPage, i18nT, supabase],
  );

  const loadCampaignHealth = useCallback(
    async (campaignId: string, raw?: any) => {
      if (!campaignId) {
        setCampaignReport(null);
        setCampaignHealth(null);
        return;
      }

      const baseCounts = campaignCounts(raw || {});
      setCampaignHealthLoading(true);
      try {
        const response = await fetch(
          `/api/inrsend/campaigns/${encodeURIComponent(campaignId)}/report`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.report) {
          throw new Error(data?.error || "Suivi de campagne indisponible.");
        }
        const report = data.report as CampaignExperienceReport;
        setCampaignReport(report);
        setCampaignHealth(campaignReportToHealth(report));
        setItems((current) =>
          current.map((item) => {
            if (item.source !== "mail_campaigns" || item.id !== campaignId) return item;
            const nextRaw = {
              ...((item.raw || {}) as Record<string, unknown>),
              status: report.status,
              total_count: report.counts.total,
              queued_count: report.counts.queued,
              processing_count: report.counts.processing,
              sent_count: report.counts.sent,
              failed_count: report.counts.failed,
              progress_percent: report.progressPercent,
              estimated_completion_at: report.estimatedCompletionAt,
              report_summary: report,
              report_updated_at: report.generatedAt,
              completion_email_status: report.completionEmail.status,
              completion_email_attempts: report.completionEmail.attempts,
              completion_email_sent_at: report.completionEmail.sentAt,
              completion_email_last_error: report.completionEmail.lastError,
              finished_at: report.finishedAt,
              last_activity_at: report.lastActivityAt,
            };
            return {
              ...item,
              status: report.status as Status,
              sent_at: report.finishedAt,
              preview: formatCampaignProgress(nextRaw),
              raw: nextRaw,
            };
          }),
        );
      } catch (error) {
        console.error(error);
        setCampaignReport(null);
        setCampaignHealth({
          ...baseCounts,
          blocked: 0,
          opt_out: 0,
          blacklist: 0,
          retryable: Math.max(0, baseCounts.failed),
        });
      } finally {
        setCampaignHealthLoading(false);
      }
    },
    [setItems],
  );

  const detailsItemId = detailsItem?.id;
  const detailsItemSource = detailsItem?.source;
  const detailsCampaignStatus = String(campaignReport?.status || (detailsItem as any)?.raw?.status || "").toLowerCase();
  // Health responses replace raw metadata; that must not trigger another request.
  const onCampaignHealthRequested = useEffectEvent((campaignId: string) => {
    if (detailsItem?.id !== campaignId) return;
    return loadCampaignHealth(campaignId, (detailsItem as any).raw || {});
  });

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsItemId ||
      detailsItemSource !== "mail_campaigns"
    ) {
      setCampaignReport(null);
      setCampaignHealth(null);
      setCampaignHealthLoading(false);
      return;
    }
    void onCampaignHealthRequested(detailsItemId);
  }, [detailsOpen, detailsItemId, detailsItemSource]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsItemId ||
      detailsItemSource !== "mail_campaigns"
    ) {
      setCampaignRecipients([]);
      setCampaignRecipientsLoading(false);
      setCampaignRecipientsTotal(0);
      setCampaignRecipientsPageCount(1);
      return;
    }
    void loadCampaignRecipients(
      detailsItemId,
      campaignRecipientsPage,
      campaignRecipientsFilter,
    );
  }, [
    campaignRecipientsFilter,
    campaignRecipientsPage,
    detailsOpen,
    detailsItemId,
    detailsItemSource,
    loadCampaignRecipients,
  ]);

  useEffect(() => {
    setCampaignRecipientsPage(1);
    setCampaignRecipientsFilter("all");
  }, [detailsItemId, detailsItemSource, detailsOpen]);

  useEffect(() => {
    if (campaignRecipientsPage <= campaignRecipientsPageCount) return;
    setCampaignRecipientsPage(campaignRecipientsPageCount);
  }, [campaignRecipientsPage, campaignRecipientsPageCount]);

  useEffect(() => {
    if (!detailsOpen || !detailsItemId || detailsItemSource !== "mail_campaigns") return;
    if (["completed", "partial", "failed", "sent"].includes(detailsCampaignStatus)) return;

    const campaignId = detailsItemId;
    let cancelled = false;
    let inFlight = false;
    let resumeRequested = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (!timer) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      if (cancelled || document.hidden) return;
      timer = window.setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    };

    const run = async () => {
      if (cancelled || document.hidden) return;
      if (inFlight) {
        resumeRequested = true;
        return;
      }

      inFlight = true;
      try {
        await Promise.all([
          onCampaignHealthRequested(campaignId),
          loadCampaignRecipients(campaignId, campaignRecipientsPage, campaignRecipientsFilter),
        ]);
      } finally {
        inFlight = false;
      }

      if (cancelled || document.hidden) return;
      if (resumeRequested) {
        resumeRequested = false;
        schedule(0);
        return;
      }
      schedule(120_000);
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;
      if (document.hidden) {
        clearTimer();
        return;
      }
      if (inFlight) {
        resumeRequested = true;
        return;
      }
      schedule(0);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden) schedule(120_000);
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    campaignRecipientsFilter,
    campaignRecipientsPage,
    detailsCampaignStatus,
    detailsItemId,
    detailsItemSource,
    detailsOpen,
    loadCampaignRecipients,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!detailsOpen || !detailsItem || detailsItem.source !== "send_items") {
      setDetailsSourceDocPayload(null);
      return;
    }

    const saveId = (detailsItem as any)?.raw?.source_doc_save_id;
    const sourceType = (detailsItem as any)?.raw?.source_doc_type;
    if (!saveId || !sourceType) {
      setDetailsSourceDocPayload(null);
      return;
    }

    const loadSourceDocPayload = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setDetailsSourceDocPayload(null);
        return;
      }

      const { data, error } = await supabase
        .from("doc_saves")
        .select("payload")
        .eq("id", saveId)
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .eq("type", sourceType)
        .maybeSingle();

      if (!cancelled) {
        setDetailsSourceDocPayload(error ? null : data?.payload || null);
      }
    };

    void loadSourceDocPayload();
    return () => {
      cancelled = true;
    };
  }, [detailsOpen, detailsItem, supabase]);

  const detailsChannelEntries = useMemo(() => {
    if (!detailsItem || detailsItem.source !== "app_events")
      return [] as ChannelPublication[];
    const payload = detailsPayload;
    const channelPublications = extractChannelPublications(payload);
    if (channelPublications.length) return channelPublications;
    const defaultParts = extractPublicationParts(payload);
    return orderChannelKeys(
      (detailsItem.channels && detailsItem.channels.length
        ? detailsItem.channels
        : [detailsItem.target]
      )
        .filter(Boolean)
        .map((channel) => String(channel)),
    ).map((channel) => ({
      key: channel,
      label: formatChannelLabel(channel),
      parts: defaultParts,
    }));
  }, [detailsItem, detailsPayload]);

  const activeDetailsChannelEntry = useMemo(() => {
    if (!detailsChannelEntries.length) return null;
    return (
      detailsChannelEntries.find((entry) => entry.key === detailsChannelKey) ||
      detailsChannelEntries[0] ||
      null
    );
  }, [detailsChannelEntries, detailsChannelKey]);

  const activeDetailsChannelResult = useMemo(() => {
    if (!detailsPayload || !activeDetailsChannelEntry) return null;
    const results =
      detailsPayload?.results && typeof detailsPayload.results === "object"
        ? detailsPayload.results
        : {};
    return (results as any)?.[activeDetailsChannelEntry.key] || null;
  }, [detailsPayload, activeDetailsChannelEntry]);

  const activePublicationEditChannelKey = normalizeChannelKey(
    activeDetailsChannelEntry?.key || "",
  );
  const activePublicationEditPreset = useMemo(
    () => getPublicationChannelPreset(activePublicationEditChannelKey),
    [activePublicationEditChannelKey],
  );

  const publicationEditBaselineRef = useRef<{ identity: string; expectedState: Promise<string>; operationKey: string } | null>(null);
  useEffect(() => {
    if (detailsEditMode) return; // Never refresh a baseline while its form is being edited.
    const publicationId = String((detailsItem?.raw as any)?.payload?.publication_id || "");
    const channel = normalizeChannelKey(String(activeDetailsChannelEntry?.key || ""));
    if (!detailsOpen || detailsItem?.source !== "app_events" || !activeAccountId || !publicationId || !channel) { publicationEditBaselineRef.current = null; return; }
    const payload = structuredClone((detailsItem.raw as any).payload);
    publicationEditBaselineRef.current = { identity: `${activeAccountId}:${publicationId}:${channel}`,
      expectedState: publicationEditSourceVersion(activeAccountId, publicationId, channel, payload).catch(() => ""), operationKey: crypto.randomUUID() };
  }, [activeAccountId, activeDetailsChannelEntry?.key, detailsEditMode, detailsItem, detailsOpen]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsItem ||
      detailsItem.source !== "app_events" ||
      detailsEditMode
    )
      return;
    const parts = activeDetailsChannelEntry?.parts || {};
    setPublicationEditForm({
      title: parts.title || "",
      content: parts.content || "",
      cta: parts.cta || "",
      ctaMode:
        parts.ctaMode ||
        (parts.ctaUrl
          ? "website"
          : parts.ctaPhone
            ? "call"
            : parts.cta
              ? "custom"
              : "none"),
      ctaUrl: parts.ctaUrl || "",
      ctaPhone: parts.ctaPhone || "",
      ctaAction: parts.ctaAction || "",
      hashtags: tagsToEditorString(parts.hashtags),
    });
  }, [
    detailsOpen,
    detailsItem,
    activeDetailsChannelEntry?.key,
    activeDetailsChannelEntry?.parts,
    detailsEditMode,
  ]);

  const {
    publicationEditImagesByChannel,
    setPublicationEditImagesByChannel,
    publicationEditVideoByChannel,
    setPublicationEditVideoByChannel,
    togglePublicationImage,
    resetPublicationImage,
    movePublicationImage,
    addPublicationFiles,
    addPublicationPhoto,
    addPublicationMediaLibraryItems,
    replacePublicationMediaLibraryItem,
    addPublicationVideo,
    removePublicationVideo,
    ensurePublicationEditVideoUploaded,
  } = useMailboxPublicationMedia({
    detailsOpen,
    detailsItem,
    detailsEditMode,
    detailsChannelEntries,
    activeDetailsChannelEntry,
    setDetailsActionError,
  });

  const activePublicationEditAssets =
    publicationEditImagesByChannel[activePublicationEditChannelKey]?.assets ||
    [];

  const activePublicationEditVideo =
    publicationEditVideoByChannel[activePublicationEditChannelKey] || null;

  const workflowFinalizerKind = useMemo<
    "propulser" | "fideliser" | null
  >(() => {
    const raw = String(
      searchParams?.get("finalizer") ||
        searchParams?.get("workflow_finalizer") ||
        "",
    ).toLowerCase();
    return raw === "propulser" || raw === "fideliser" ? raw : null;
  }, [searchParams]);

  const workflowReturnAction = useMemo(
    () => String(searchParams?.get("workflow_action") || "").trim(),
    [searchParams],
  );
  const workflowReturnKey = useMemo(
    () => String(searchParams?.get("workflow_return_key") || "").trim(),
    [searchParams],
  );

  const composeRecipientList = useMemo(() => normalizeEmails(to), [to]);
  const isBulkCampaignCompose = composeRecipientList.length > 1;
  const bulkCampaignNotice = useMemo(() => {
    const count = composeRecipientList.length;
    if (count >= BULK_CONFIRM_STRONG_THRESHOLD) {
      return {
        tone: "strong" as const,
        title: i18nT("campagne_importante_value_destinataires_473e90bc", { value0: count }),
        text: i18nT("une_confirmation_sera_demandee_avant_l_5e7f4ea1"),
      };
    }
    if (count >= BULK_CONFIRM_WARNING_THRESHOLD) {
      return {
        tone: "warning" as const,
        title: i18nT("campagne_multi_destinataires_value_destinataires_64088f63", { value0: count }),
        text: i18nT("verifiez_l_objet_la_boite_d_3d1bbaee"),
      };
    }
    if (count > 1) {
      return {
        tone: "info" as const,
        title: i18nT("mode_campagne_active_value_destinataires_80a94557", { value0: count }),
        text: i18nT("chaque_contact_recevra_un_email_individuel_996f757c"),
      };
    }
    return null;
  }, [composeRecipientList, i18nT]);

  const toolCfg = useMemo(() => {
    switch (folder) {
      case "mails":
        return { label: i18nT("envoyer_f1d24a59"), href: null as string | null };
      case "factures":
        return { label: i18nT("factures_7bcc32e6"), href: "/dashboard/factures/new" };
      case "devis":
        return { label: i18nT("devis_0eddca3e"), href: "/dashboard/devis/new" };

      case "publications":
        return { label: i18nT("publier_34ef049f"), href: "/dashboard?action=publish" };
      case "propulsions":
      case "recoltes":
      case "offres":
        return { label: i18nT("propulser_e7c8950b"), href: "/dashboard/propulser" };
      case "fidelisations":
      case "informations":
      case "suivis":
      case "enquetes":
        return { label: i18nT("fideliser_398bb02e"), href: "/dashboard/fideliser" };
      case "stats":
        return { label: i18nT("inr_stats_22458bde"), href: "/dashboard/stats" };

      default:
        return { label: i18nT("ouvrir_l_outil_32a62f9c"), href: null as string | null };
    }
  }, [folder, i18nT]);

  // initial
  useEffect(() => {
    if (standardMode) return;
    void loadAccounts();
    void loadSignature();
  }, [loadAccounts, standardMode]);

  useEffect(() => {
    if (standardMode) return;
    if (!composeOpen) {
      setLastSavedComposeSnapshot(null);
      return;
    }
    void loadSignature(selectedAccountId || undefined);
  }, [composeOpen, selectedAccountId, standardMode]);

  useEffect(() => {
    if (standardMode) return;
    const handleSignatureUpdated = () => {
      void loadSignature(selectedAccountId || undefined);
    };

    window.addEventListener(
      "inrsend:signature-updated",
      handleSignatureUpdated,
    );
    return () =>
      window.removeEventListener(
        "inrsend:signature-updated",
        handleSignatureUpdated,
      );
  }, [selectedAccountId, standardMode]);

  useEffect(() => {
    if (standardMode) return;
    const handleMailAccountsUpdated = async () => {
      await loadAccounts();
      await loadHistory();
    };

    window.addEventListener(
      MAIL_ACCOUNTS_UPDATED_EVENT,
      handleMailAccountsUpdated as EventListener,
    );
    return () =>
      window.removeEventListener(
        MAIL_ACCOUNTS_UPDATED_EVENT,
        handleMailAccountsUpdated as EventListener,
      );
  }, [loadAccounts, loadHistory, standardMode]);

  useEffect(() => {
    if (standardMode) return;
    if (!composeOpen) return;
    void loadAccounts();
  }, [composeOpen, loadAccounts, standardMode]);

  // open folder from URL
  useEffect(() => {
    if (standardMode) {
      setFolder("publications");
      return;
    }
    const q = (searchParams?.get("folder") || "").toLowerCase();
    const allowed: Record<string, Folder> = {
      mails: "mails",
      factures: "factures",
      devis: "devis",
      publications: "publications",
      propulsions: "propulsions",
      fidelisations: "fidelisations",
      stats: "stats",
      bilans: "stats",
      inrstats: "stats",
      recoltes: "propulsions",
      offres: "propulsions",
      informations: "fidelisations",
      suivis: "fidelisations",
      enquetes: "fidelisations",
    };
    const nextFolder = q ? allowed[q] : null;
    if (nextFolder === "factures" || nextFolder === "devis") {
      if (!founderMode) {
        setFolder("publications");
        router.replace("/dashboard/mails?folder=publications", { scroll: false });
        return;
      }
    }
    if (nextFolder) setFolder(nextFolder);
  }, [founderMode, router, searchParams, signatureEnabled, signaturePreview, standardMode, setFolder]);

  // Open compose + prefill basic fields from URL params.
  // Used by:
  // - CRM: /dashboard/mails?compose=1&to=...&from=crm
  // - Factures / Devis: /dashboard/mails?compose=1&to=...&attachKey=...&attachName=...
  useEffect(() => {
    if (standardMode) return;
    const openRaw = (searchParams?.get("compose") || "").toLowerCase();
    const shouldOpen = openRaw !== "0" && openRaw !== "false" && openRaw !== "";
    if (!shouldOpen) return;

    let toParam = safeDecode(searchParams?.get("to") || "").trim();
    const prefillStorage = (
      searchParams?.get("prefillStorage") || ""
    ).toLowerCase();
    let sessionRecipientHints: ComposeCrmRecipientHint[] = [];
    if (
      !toParam &&
      prefillStorage === "session" &&
      typeof window !== "undefined"
    ) {
      try {
        const raw = window.sessionStorage.getItem("inrcy_pending_mail_compose");
        if (raw) {
          const payload = JSON.parse(raw) as {
            to?: string[] | string;
            recipients?: unknown;
            createdAt?: number;
          };
          const ageMs = Date.now() - Number(payload?.createdAt || 0);
          const loaded = Array.isArray(payload?.to)
            ? payload.to.join(", ")
            : String(payload?.to || "");
          if (ageMs >= 0 && ageMs <= 10 * 60 * 1000) {
            if (loaded) toParam = loaded.trim();
            sessionRecipientHints = normalizeComposeRecipientHints(
              payload?.recipients,
            );
          }
        }
      } catch {
        // ignore invalid session payload
      } finally {
        try {
          window.sessionStorage.removeItem("inrcy_pending_mail_compose");
        } catch {}
      }
    }
    const subjParam = safeDecode(searchParams?.get("subject") || "");
    const textParam = safeDecode(searchParams?.get("text") || "");
    const nameParam = safeDecode(
      searchParams?.get("name") ||
        searchParams?.get("clientName") ||
        searchParams?.get("contactName") ||
        "",
    ).trim();
    const contactIdParam = safeDecode(
      searchParams?.get("contactId") || "",
    ).trim();
    const attachKey = safeDecode(searchParams?.get("attachKey") || "").trim();
    const attachName = safeDecode(searchParams?.get("attachName") || "").trim();

    // Determine composer type (optional).
    // If not provided explicitly, we infer it from the attachment path.
    const typeParam = (
      searchParams?.get("type") ||
      searchParams?.get("sendType") ||
      ""
    ).toLowerCase();
    const sourceDocSaveIdParam = safeDecode(
      searchParams?.get("docSaveId") ||
        searchParams?.get("sourceDocSaveId") ||
        "",
    ).trim();
    const sourceDocTypeParam = safeDecode(
      searchParams?.get("docType") || searchParams?.get("sourceDocType") || "",
    )
      .trim()
      .toLowerCase();
    const sourceDocNumberParam = safeDecode(
      searchParams?.get("docNumber") ||
        searchParams?.get("sourceDocNumber") ||
        "",
    ).trim();
    const templateKeyParam = safeDecode(
      searchParams?.get("template_key") || "",
    ).trim();
    let nextType: SendType = "mail";
    if (typeParam === "facture") nextType = "facture";
    else if (typeParam === "devis") nextType = "devis";
    else if (
      attachKey.includes("/factures/") ||
      attachKey.includes("/facture/")
    )
      nextType = "facture";
    else if (attachKey.includes("/devis/")) nextType = "devis";
    if (
      !founderMode &&
      (
        nextType === "facture" ||
        nextType === "devis" ||
        sourceDocTypeParam === "facture" ||
        sourceDocTypeParam === "devis"
      )
    ) {
      router.replace("/dashboard/mails", { scroll: false });
      return;
    }
    setComposeType(nextType);
    setComposeSourceDocSaveId(sourceDocSaveIdParam);
    setComposeSourceDocType(
      sourceDocTypeParam === "facture" || sourceDocTypeParam === "devis"
        ? (sourceDocTypeParam as "facture" | "devis")
        : "",
    );
    setComposeSourceDocNumber(
      sourceDocNumberParam ||
        (attachName || attachKey.split("/").pop() || "").replace(/\.pdf$/i, ""),
    );
    if (templateKeyParam) setComposeTemplateKey(templateKeyParam);

    if (toParam) setTo(toParam);
    if (subjParam) setSubject(normalizeMailSubject(subjParam));
    const htmlParam = safeDecode(
      searchParams?.get("html") || searchParams?.get("body_html") || "",
    );
    if (textParam || htmlParam)
      setComposeBody(textParam, htmlParam || undefined);

    const urlRecipientHints =
      !sessionRecipientHints.length && toParam && contactIdParam
        ? normalizeEmails(toParam).map((email, index) => ({
            email,
            contact_id: index === 0 ? contactIdParam : null,
            display_name: index === 0 ? nameParam || null : null,
          }))
        : [];
    setComposeRecipientHints(
      sessionRecipientHints.length ? sessionRecipientHints : urlRecipientHints,
    );

    // If the caller didn't provide a subject/body, we inject a friendly default template.
    // This keeps the connected tools consistent (CRM/Devis/Factures all go through iNr'SEND compose).
    const docRef = (attachName || attachKey.split("/").pop() || "").replace(
      /\.pdf$/i,
      "",
    );
    if (!subjParam?.trim()) {
      if (nextType === "facture")
        setSubject((prev) =>
          prev?.trim() ? prev : `Envoi de votre facture ${docRef || ""}`.trim(),
        );
      else if (nextType === "devis")
        setSubject((prev) =>
          prev?.trim() ? prev : `Envoi de votre devis ${docRef || ""}`.trim(),
        );
      else if (nameParam)
        setSubject((prev) =>
          prev?.trim() ? prev : `Message pour ${nameParam}`,
        );
    }
    if (!textParam?.trim() && !htmlParam?.trim()) {
      setText((prev) => {
        if (prev?.trim()) return prev;
        const fallback = buildDefaultMailText({
          kind: nextType,
          name: nameParam,
          docRef,
        });
        setHtml(textToRichMailHtml(fallback));
        return fallback;
      });
    }

    // Open the modal.
    setComposeOpen(true);

    // If we have an attachment key, reference the existing storage object directly.
    // This avoids re-uploading the binary through the mail send endpoint.
    const run = async () => {
      if (!attachKey) return;
      if (lastAttachKeyRef.current === attachKey) return;
      lastAttachKeyRef.current = attachKey;

      const inferredName =
        attachName || attachKey.split("/").pop() || "document.pdf";
      setComposeAttachments((prev) => {
        const already = prev.some(
          (f) => f.bucket === ATTACH_BUCKET && f.path === attachKey,
        );
        if (already) return prev;
        return [
          {
            bucket: ATTACH_BUCKET,
            path: attachKey,
            name: inferredName,
            type: "application/pdf",
            size: null,
          },
          ...prev,
        ];
      });

      setSubject((prev) => {
        if (prev?.trim()) return prev;
        if (nextType === "facture")
          return `Facture ${inferredName.replace(/\.pdf$/i, "")}`;
        if (nextType === "devis")
          return `Devis ${inferredName.replace(/\.pdf$/i, "")}`;
        return prev;
      });
    };

    void run();
  }, [founderMode, router, searchParams, signatureEnabled, signaturePreview, standardMode]);

  // Prefill compose modal from workflow modules (Booster / Propulser / Fidéliser).
  // Usage:
  // - /dashboard/mails?folder=propulsions&template_key=...&prefill_subject=...&prefill_text=...&compose=1
  // If template_key is provided, we render placeholders server-side from the user's unified profile + connected tools.
  useEffect(() => {
    if (standardMode) return;
    const preSubjectRaw = searchParams?.get("prefill_subject") || "";
    const preTextRaw = searchParams?.get("prefill_text") || "";
    const preHtmlRaw = searchParams?.get("prefill_html") || "";
    const preAttachmentsRaw = searchParams?.get("prefill_attachments") || "";
    const preAttachmentsKey =
      searchParams?.get("prefill_attachments_key") || "";
    const returnKey = searchParams?.get("workflow_return_key") || "";
    const storedWorkflowState = readWorkflowCampaignState(returnKey);
    const storedComposeState =
      storedWorkflowState?.stage === "compose" ? storedWorkflowState : null;
    const templateKey =
      searchParams?.get("template_key") ||
      storedComposeState?.templateKey ||
      "";
    const open = (searchParams?.get("compose") || "").toLowerCase();
    if (templateKey) setComposeTemplateKey(templateKey);
    if (storedComposeState) {
      setDraftId(storedComposeState.draftId || null);
      setSelectedAccountId(storedComposeState.selectedAccountId || "");
      setTo(storedComposeState.toEmails || "");
      setComposeRecipientHints(
        normalizeComposeRecipientHints(storedComposeState.recipientHints),
      );
    }

    // Optional tracking intent (sent from Booster/Fidéliser modules)
    const trackKind = (
      searchParams?.get("track_kind") ||
      storedComposeState?.trackKind ||
      ""
    ).toLowerCase();
    const trackType =
      searchParams?.get("track_type") || storedComposeState?.trackType || "";
    const trackPayloadRaw = searchParams?.get("track_payload") || "";

    if (
      (trackKind === "booster" ||
        trackKind === "propulser" ||
        trackKind === "fideliser") &&
      trackType
    ) {
      let payload: Record<string, any> = {};
      try {
        payload = trackPayloadRaw
          ? (JSON.parse(safeDecode(trackPayloadRaw)) as any)
          : ((storedComposeState?.trackPayload || {}) as Record<string, any>);
      } catch {
        payload = (storedComposeState?.trackPayload || {}) as Record<
          string,
          any
        >;
      }
      setPendingTrack({ kind: trackKind as any, type: trackType, payload });

      // Remove tracking params from the URL to avoid double-counting if the user later sends another email.
      try {
        const q = new URLSearchParams(searchParams?.toString() || "");
        q.delete("track_kind");
        q.delete("track_type");
        q.delete("track_payload");
        router.replace(`/dashboard/mails?${q.toString()}`);
      } catch {
        // ignore
      }
    }

    // Only prefill when something is provided
    if (
      !preSubjectRaw &&
      !preTextRaw &&
      !preHtmlRaw &&
      !preAttachmentsRaw &&
      !preAttachmentsKey &&
      !templateKey &&
      !storedComposeState
    )
      return;

    const preSubject = storedComposeState
      ? storedComposeState.subject
      : safeDecode(preSubjectRaw);
    const preText = storedComposeState
      ? storedComposeState.bodyText
      : safeDecode(preTextRaw);
    const preHtml = storedComposeState
      ? storedComposeState.bodyHtml
      : safeDecode(preHtmlRaw);
    const preAttachmentsFromStorage = readWorkflowMailPrefillAttachments(
      safeDecode(preAttachmentsKey),
    );
    const preAttachments = storedComposeState
      ? normalizeCampaignAttachments(storedComposeState.attachments)
      : preAttachmentsFromStorage.length
        ? preAttachmentsFromStorage
        : normalizeCampaignAttachments(safeDecode(preAttachmentsRaw));

    const run = async () => {
      // A restored compose draft is already the user's exact snapshot. Re-rendering
      // its template here could silently replace edits made after generation.
      if (storedComposeState) {
        if (preSubject) setSubject(normalizeMailSubject(preSubject));
        setComposeBody(preText, preHtml || undefined);
      }
      // If we have a template key, ask the server to render placeholders + compute links.
      else if (templateKey) {
        try {
          const r = await fetch("/api/templates/render", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              template_key: templateKey,
              subject_override: preSubject,
              body_override: preText,
            }),
          });
          const j = await r.json().catch(() => ({}));
          if (j?.subject) setSubject(normalizeMailSubject(String(j.subject)));
          else if (preSubject) setSubject(normalizeMailSubject(preSubject));

          if (preHtml) {
            setComposeBody(preText || String(j?.body_text || ""), preHtml);
          } else if (j?.body_text) {
            const renderedBody = String(j.body_text);
            setComposeBody(renderedBody);
          } else if (preText) {
            setComposeBody(preText);
          }
        } catch {
          if (preSubject) setSubject(normalizeMailSubject(preSubject));
          if (preText || preHtml) {
            setComposeBody(preText, preHtml || undefined);
          }
        }
      } else {
        if (preSubject) setSubject(normalizeMailSubject(preSubject));
        if (preText || preHtml) {
          setComposeBody(preText, preHtml || undefined);
        }
      }

      setComposeType("mail");
      setFiles([]);
      setComposeAttachments(preAttachments);
      // Open compose by default (compose=1), but also open when not specified (better UX)
      if (open !== "0" && open !== "false") setComposeOpen(true);
    };

    run();
  }, [router, searchParams, setDraftId, standardMode]);

  const onScheduledMailEditLoaded = useEffectEvent((editId: string, action: any) => {
    const payload = asScheduledRecord(action.payload);
    const campaign = asScheduledRecord(payload.campaign);
    const recipients = Array.isArray(campaign.recipients)
      ? campaign.recipients
      : Array.isArray(payload.recipients)
        ? payload.recipients
        : [];
    const recipientEmails = recipients
      .map((recipient: any) =>
        typeof recipient === "string"
          ? recipient
          : String(recipient?.email || ""),
      )
      .map((email: string) => email.trim())
      .filter(Boolean);
    const recipientHints = recipients
      .map((recipient: any) => {
        if (!recipient || typeof recipient === "string") return null;
        const email = String(recipient.email || "").trim();
        if (!email) return null;
        return {
          email,
          contact_id: recipient.contact_id || recipient.contactId || null,
          display_name:
            recipient.display_name || recipient.displayName || null,
        };
      })
      .filter(Boolean) as ComposeCrmRecipientHint[];

    const nextAccountId = String(
      campaign.accountId || payload.accountId || "",
    );
    const nextSubject = normalizeMailSubject(
      String(campaign.subject || payload.subject || action.title || "").trim() ||
        i18nT("sans_objet_e5ad6a39"),
    );
    const nextText = String(
      campaign.text || payload.campaignBody || payload.bodyText || "",
    );
    const nextHtml = normalizeRichMailHtmlForSend(
      nextText,
      String(campaign.html || payload.bodyHtml || payload.html || ""),
    );
    const nextAttachments = normalizeCampaignAttachments(
      campaign.attachments || payload.attachments,
    );
    const nextTemplateKey = String(
      campaign.templateKey || payload.templateKey || "",
    );
    const nextSourceDocSaveId = String(
      campaign.sourceDocSaveId || payload.sourceDocSaveId || "",
    );
    const nextSourceDocType =
      campaign.sourceDocType === "facture" || campaign.sourceDocType === "devis"
        ? campaign.sourceDocType
        : payload.sourceDocType === "facture" || payload.sourceDocType === "devis"
          ? payload.sourceDocType
          : "";
    const nextSourceDocNumber = String(
      campaign.sourceDocNumber || payload.sourceDocNumber || "",
    );

    setScheduledMailEdit({
      id: editId,
      scheduledAt: action.scheduledAt || null,
      title: String(action.title || i18nT("scheduled_mail_default_title")),
      payload,
  });
  setDraftId(null);
  setComposeType("mail");
  setPendingTrack(null);
  setSelectedAccountId(nextAccountId);
  setTo(recipientEmails.join(", "));
  setSubject(nextSubject);
  setText(nextText);
  setHtml(nextHtml);
  setComposeAttachments(nextAttachments);
  setComposeRecipientHints(recipientHints);
  setComposeTemplateKey(nextTemplateKey);
  setComposeSourceDocSaveId(nextSourceDocSaveId);
  setComposeSourceDocType(nextSourceDocType);
  setComposeSourceDocNumber(nextSourceDocNumber);
  setFiles([]);
  setCrmPickerOpen(false);
  setLastSavedComposeSnapshot(
    makeComposeSnapshot({
      selectedAccountId: nextAccountId,
      to: recipientEmails.join(", "),
      subject: nextSubject,
      text: nextText,
      html: nextHtml,
      composeType: "mail",
      composeAttachments: nextAttachments,
      composeSourceDocSaveId: nextSourceDocSaveId,
      composeSourceDocType: nextSourceDocType,
      composeSourceDocNumber: nextSourceDocNumber,
      composeTemplateKey: nextTemplateKey,
      pendingTrack: null,
    }),
  );
  setComposeOpen(true);
  setToast(i18nT("mail_programme_ouvert_en_reedition_25196d5f"));
  router.replace("/dashboard/mails?folder=mails", { scroll: false });
  });

  const onScheduledMailEditLoadFailed = useEffectEvent((error: unknown) => {
    setToast(getClientUserFacingErrorMessage(error, i18nT("scheduled_mail_open_failed")));
  });
  const onScheduledMailEditMissing = useEffectEvent(() => i18nT("scheduled_mail_missing"));

  useEffect(() => {
    if (standardMode) return;
    const editId = String(searchParams?.get("scheduled_edit_id") || "").trim();
    if (!editId || scheduledMailEditLoadRef.current === editId) return;
    scheduledMailEditLoadRef.current = editId;

    const run = async () => {
      try {
        const response = await fetch(`/api/agent/scheduled-actions/${editId}`, {
          cache: "no-store",
        });
        const data = (await response.json().catch(() => null)) as {
          scheduledAction?: any;
          error?: string;
        } | null;
        if (!response.ok || !data?.scheduledAction) {
          throw new Error(data?.error || onScheduledMailEditMissing());
        }
        onScheduledMailEditLoaded(editId, data.scheduledAction);
      } catch (error) {
        onScheduledMailEditLoadFailed(error);
      }
    };

    void run();
  }, [searchParams, standardMode]);

  useEffect(() => {
    if (!composeOpen) return;
    setText((prev) => {
      const base = String(prev || "");
      const next = base.trim()
        ? stripTemplateSignatureBlock(base)
        : buildDefaultMailText({ kind: composeType });
      setHtml((currentHtml) =>
        normalizeRichMailHtmlForSend(
          next,
          currentHtml || textToRichMailHtml(next),
        ),
      );
      return next;
    });
  }, [composeOpen, composeType, signatureEnabled, signaturePreview]);

  function updateFolder(next: Folder) {
    if (standardMode) {
      setFolder("publications");
      setBoxView("sent");
      setSelectedId(null);
      router.replace("/dashboard/mails?folder=publications");
      return;
    }
    if (!founderMode && (next === "factures" || next === "devis")) {
      setFolder("publications");
      setBoxView("sent");
      setSelectedId(null);
      router.replace("/dashboard/mails?folder=publications", { scroll: false });
      return;
    }
    setFolder(next);
    // quand on change de dossier, on revient à la vue principale
    setBoxView("sent");
    router.replace(`/dashboard/mails?folder=${encodeURIComponent(next)}`);
    // reset selection to first item in that folder
    setSelectedId(null);
  }

  function updateBoxView(next: BoxView) {
    setBoxView(next);
    setSelectedId(null);

    if (!standardMode) return;

    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("folder", "publications");
    params.set("boxView", next);
    router.replace(`/dashboard/mails?${params.toString()}`, { scroll: false });
  }

  async function saveDraft(assistant?: InrAssistantMailExecution) {
    if (assistantComposeConsumed || assistant && !assistant.isCurrent()) return;
    if (attachBusy) {
      throw new Error(
        i18nT("patientez_les_pieces_jointes_sont_encore_ac136c9e"),
      );
    }
    const { data: auth } = await supabase.auth.getUser();
    if (assistant && !assistant.isCurrent()) return;
    const userId = auth?.user?.id ? resolveActiveBrowserUserId(auth.user.id) : null;
    if (!userId) return;

    const draftFolder = getBulkCampaignFolder();
    const workflowKind =
      pendingTrack?.kind === "propulser" || pendingTrack?.kind === "fideliser"
        ? pendingTrack.kind
        : null;
    const workflowSessionState = readWorkflowCampaignState(workflowReturnKey);
    const workflowTarget = workflowKind
      ? workflowCampaignTargetFromTrack(workflowKind, pendingTrack?.type || "")
      : null;
    const draftState = workflowTarget
      ? {
          version: 1,
          kind: workflowKind,
          action: workflowTarget.action,
          folder: draftFolder,
          trackKind: workflowKind,
          trackType: workflowTarget.trackType,
          templateCategory: workflowSessionState?.templateCategory || null,
          aiEngine: workflowSessionState?.aiEngine || null,
          stage: "compose",
          selectedAccountId: selectedAccountId || null,
          provider: selectedAccount?.provider || null,
          toEmails: to.trim(),
          recipientHints: normalizeComposeRecipientHints(composeRecipientHints),
          trackPayload: pendingTrack?.payload || workflowSessionState?.trackPayload || {},
        }
      : {
          version: 1,
          stage: "compose",
          selectedAccountId: selectedAccountId || null,
          provider: selectedAccount?.provider || null,
          toEmails: to.trim(),
          recipientHints: normalizeComposeRecipientHints(composeRecipientHints),
        };
    const draftPayload = {
      user_id: userId,
      integration_id: selectedAccountId || null,
      type: composeType,
      status: "draft" as const,
      to_emails: to.trim(),
      subject: subject.trim() || null,
      body_text: text || null,
      body_html: normalizeRichMailHtmlForSend(text, html),
      provider: selectedAccount?.provider || null,
      source_doc_save_id: composeSourceDocSaveId || null,
      source_doc_type: composeSourceDocType || null,
      source_doc_number: composeSourceDocNumber || null,
      folder: draftFolder,
      track_kind: pendingTrack?.kind || null,
      track_type: pendingTrack?.type || null,
      template_key: composeTemplateKey || null,
      attachments: serializeComposeAttachments(composeAttachments),
      draft_state: draftState,
    };

    if (assistant) {
      const saved = await persistInrAssistantMailDraft({ supabase, accountId: userId, draftId, expectedVersion: draftServerVersion, payload: draftPayload, baseline: lastSavedComposeSnapshot, isCurrent: assistant.isCurrent, onWriteStarted: assistant.started });
      if (!assistant.isCurrent()) return;
      assistant.accepted("saved", saved.id);
      setDraftId(saved.id); setDraftServerVersion({ id: saved.id, accountId: userId, updatedAt: saved.updatedAt }); setComposeSavedSnapshotFromCurrent(); setToast(i18nT("draft_saved"));
      void loadHistory();
      return;
    }

    const metadataPayload = { ...draftPayload } as Record<string, unknown>;
    delete metadataPayload.draft_state;

    const legacyPayload = {
      user_id: draftPayload.user_id,
      integration_id: draftPayload.integration_id,
      type: draftPayload.type,
      status: draftPayload.status,
      to_emails: draftPayload.to_emails,
      subject: draftPayload.subject,
      body_text: draftPayload.body_text,
      body_html: draftPayload.body_html,
      provider: draftPayload.provider,
      source_doc_save_id: draftPayload.source_doc_save_id,
      source_doc_type: draftPayload.source_doc_type,
      source_doc_number: draftPayload.source_doc_number,
    };

    const isMissingDraftMetadataColumn = (error: any) => {
      const msg = String(
        error?.message || error?.details || error?.hint || "",
      ).toLowerCase();
      return (
        error?.code === "PGRST204" ||
        msg.includes("folder") ||
        msg.includes("track_kind") ||
        msg.includes("track_type") ||
        msg.includes("template_key") ||
        msg.includes("attachments")
      );
    };

    const isMissingDraftStateColumn = (error: any) => {
      const msg = String(
        error?.message || error?.details || error?.hint || "",
      ).toLowerCase();
      return error?.code === "PGRST204" || msg.includes("draft_state");
    };

    if (draftId) {
      let usedLegacyFallback = false;
      let { data: savedVersion, error } = await supabase
        .from("send_items")
        .update({ ...draftPayload, updated_at: new Date().toISOString() } as any)
        .eq("id", draftId)
        .eq("user_id", userId).select("id,updated_at").maybeSingle();
      if (error && isMissingDraftStateColumn(error)) {
        ({ data: savedVersion, error } = await supabase
          .from("send_items")
          .update({ ...metadataPayload, updated_at: new Date().toISOString() })
          .eq("id", draftId)
          .eq("user_id", userId).select("id,updated_at").maybeSingle());
      }
      if (error && isMissingDraftMetadataColumn(error)) {
        ({ data: savedVersion, error } = await supabase
          .from("send_items")
          .update({ ...legacyPayload, updated_at: new Date().toISOString() })
          .eq("id", draftId)
          .eq("user_id", userId).select("id,updated_at").maybeSingle());
        usedLegacyFallback = !error;
      }
      if (error) {
        setToast(
          getClientUserFacingErrorMessage(
            error,
            i18nT("draft_save_failed"),
          ),
        );
        return;
      }
      setToast(
        usedLegacyFallback
          ? i18nT("draft_saved_advanced_unavailable")
          : i18nT("draft_saved"),
      );
      setComposeSavedSnapshotFromCurrent();
      setDraftServerVersion(!usedLegacyFallback ? inrAssistantMailDraftVersion({ ...savedVersion, user_id: userId }) : null);
      await loadHistory();
      return;
    }

    let usedLegacyFallback = false;
    let { data, error } = await supabase
      .from("send_items")
      .insert(draftPayload as any)
      .select("id,updated_at")
      .single();
    if (error && isMissingDraftStateColumn(error)) {
      ({ data, error } = await supabase
        .from("send_items")
        .insert(metadataPayload)
        .select("id,updated_at")
        .single());
    }
    if (error && isMissingDraftMetadataColumn(error)) {
      ({ data, error } = await supabase
        .from("send_items")
        .insert(legacyPayload)
        .select("id,updated_at")
        .single());
      usedLegacyFallback = !error;
    }
    if (error) {
      setToast(
        getClientUserFacingErrorMessage(
          error,
          i18nT("draft_save_failed"),
        ),
      );
      return;
    }
    if (data?.id) {
      setDraftId(data.id);
      setDraftServerVersion(!usedLegacyFallback ? inrAssistantMailDraftVersion({ ...data, user_id: userId }) : null);
      setToast(
        usedLegacyFallback
          ? i18nT("draft_saved_advanced_unavailable")
          : i18nT("draft_saved"),
      );
      setComposeSavedSnapshotFromCurrent();
      await loadHistory();
      if (!usedLegacyFallback && draftFolder !== folder)
        updateFolder(draftFolder);
    }
  }

  function getBulkCampaignFolder(): Folder {
    if (composeType === "facture") return "factures";
    if (composeType === "devis") return "devis";
    if (pendingTrack?.kind && pendingTrack?.type) {
      return folderFromTrack(
        pendingTrack.kind,
        pendingTrack.type,
        isBusinessMailFolder(folder) ? folder : "mails",
      );
    }
    return isBusinessMailFolder(folder) ? folder : "mails";
  }

  async function scheduleMailWithAgent(scheduledAt: string) {
    if (attachBusy) {
      throw new Error(
        i18nT("patientez_les_pieces_jointes_sont_encore_ac136c9e"),
      );
    }
    const isWorkflowFinalizer =
      workflowFinalizerKind === "propulser" ||
      workflowFinalizerKind === "fideliser";
    if (!isWorkflowFinalizer && composeType !== "mail") {
      throw new Error(
        i18nT("scheduling_supported_types"),
      );
    }
    if (!selectedAccount) {
      throw new Error(
        i18nT(mailAccounts.length ? "select_send_account" : "veuillez_connecter_une_boite_d_envoi_98abd470"),
      );
    }
    if (
      selectedAccount.connection_status === "needs_update" ||
      selectedAccount.requires_update
    ) {
      throw new Error(
        i18nT("send_account_refresh_required_for_schedule"),
      );
    }

    const scheduledDate = new Date(String(scheduledAt || ""));
    if (
      !Number.isFinite(scheduledDate.getTime()) ||
      scheduledDate.getTime() <= Date.now() + 30_000
    ) {
      throw new Error(i18nT("schedule_future_required"));
    }

    const recipientsList = normalizeEmails(to);
    if (recipientsList.length === 0) {
      throw new Error(i18nT("veuillez_ajouter_au_moins_un_destinataire_7e03a00e"));
    }

    const trackedCampaign = pendingTrack;
    const campaignFolder =
      isWorkflowFinalizer && trackedCampaign?.kind && trackedCampaign?.type
        ? folderFromTrack(
            trackedCampaign.kind,
            trackedCampaign.type,
            isBusinessMailFolder(folder) ? folder : "mails",
          )
        : isWorkflowFinalizer
          ? getBulkCampaignFolder()
          : "mails";
    const templateKey =
      composeTemplateKey || searchParams?.get("template_key") || "";
    const cleanSubject = normalizeMailSubject(
      subject.trim() || i18nT("sans_objet_e5ad6a39"),
    );
    const scheduleTargetTool = isWorkflowFinalizer
      ? workflowFinalizerKind
      : "mails";
    const scheduleActionType = isWorkflowFinalizer ? "campaign" : "mailing";
    const scheduleTypeLabel =
      workflowFinalizerKind === "propulser"
        ? i18nT("workflow_propulser_name")
        : workflowFinalizerKind === "fideliser"
          ? i18nT("workflow_fideliser_name")
          : i18nT("mail_92379cbb");
    const campaignPayload = {
      accountId: selectedAccount.id,
      accountEmail: selectedAccount.email_address || "",
      accountProvider: selectedAccount.provider || "",
      type: composeType,
      folder: campaignFolder,
      trackKind: trackedCampaign?.kind || workflowFinalizerKind,
      trackType: trackedCampaign?.type || undefined,
      templateKey: templateKey || undefined,
      subject: cleanSubject,
      text: text || "",
      html: normalizeRichMailHtmlForSend(text, html),
      recipients: recipientsList.map((email) => {
        const lower = email.toLowerCase();
        const hint = composeRecipientHintsByEmail.get(lower);
        const crmContact = crmRecipientsByEmail.get(lower);
        return {
          email,
          contact_id: hint?.contact_id || crmContact?.contact_id || null,
          display_name: hint?.display_name || crmContact?.display_name || null,
        };
      }),
      attachments: serializeComposeAttachments(composeAttachments),
      sourceDocSaveId: composeSourceDocSaveId || undefined,
      sourceDocType: composeSourceDocType || undefined,
      sourceDocNumber: composeSourceDocNumber || undefined,
    };

    setScheduleBusy(true);
    try {
      if (scheduledMailEdit) {
        const saved = await patchScheduledMailEdit(
          buildScheduledMailEditPayload(scheduledDate.toISOString()) || {},
        );
        setScheduledMailEdit(saved);
        setLastSavedComposeSnapshot(makeComposeSnapshot());
        setToast(i18nT("mail_programme_mis_a_jour_9819e8e5"));
        return;
      }

      const response = await fetch("/api/agent/scheduled-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          automationKey: null,
          actionType: scheduleActionType,
          targetTool: scheduleTargetTool,
          source: "manual",
          title: `${scheduleTypeLabel} — ${cleanSubject}`,
          summary: i18nT("scheduled_mail_recipient_summary", {
            count: recipientsList.length,
            account:
              selectedAccount.email_address ||
              selectedAccount.provider ||
              i18nT("connected_mailbox"),
          }),
          scheduledAt: scheduledDate.toISOString(),
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris",
          channels: ["mails"],
          payload: {
            kind: "mail_campaign",
            origin: isWorkflowFinalizer
              ? "inrsend_workflow_finalizer"
              : "inrsend_mail",
            workflowFinalizerKind: isWorkflowFinalizer
              ? workflowFinalizerKind
              : null,
            campaign: campaignPayload,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.user_message ||
            data?.error ||
            i18nT("campaign_schedule_failed"),
        );
      }

      if (draftId) {
        await supabase
          .from("send_items")
          .delete()
          .eq("id", draftId)
          .eq("user_id", resolveActiveBrowserUserId((await supabase.auth.getUser()).data?.user?.id || ""))
          .eq("status", "draft");
      }
      setToast(
        isWorkflowFinalizer
          ? i18nT("campaign_scheduled_in_agent")
          : i18nT("mail_scheduled_in_agent"),
      );
      await loadHistory();
      updateFolder(campaignFolder);
    } finally {
      setScheduleBusy(false);
    }
  }

  async function doSend(assistant?: InrAssistantMailExecution) {
    if (assistantComposeConsumed || assistant && !assistant.isCurrent()) return;
    if (attachBusy) {
      setToast(i18nT("patientez_les_pieces_jointes_sont_encore_ac136c9e"));
      return;
    }
    if (!selectedAccount) {
      setToast(i18nT(mailAccounts.length ? "select_send_account" : "veuillez_connecter_une_boite_d_envoi_98abd470"));
      return;
    }
    if (
      selectedAccount.connection_status === "needs_update" ||
      selectedAccount.requires_update
    ) {
      setToast(
        i18nT("cette_boite_d_envoi_doit_etre_9e1cb696"),
      );
      return;
    }

    const recipientsList = normalizeEmails(to);
    if (recipientsList.length === 0) {
      setToast(i18nT("veuillez_ajouter_au_moins_un_destinataire_7e03a00e"));
      return;
    }
    if (attachBusy) {
      setToast(i18nT("veuillez_patienter_pendant_le_chargement_des_354773b1"));
      return;
    }

    const trackedCampaign = pendingTrack;
    const shouldSendAsCampaign =
      recipientsList.length > 1 || trackedCampaign !== null;

    if (recipientsList.length > 1 && composeType !== "mail") {
      setToast(
        i18nT("l_envoi_individuel_en_masse_est_d93580cc"),
      );
      return;
    }

    if (recipientsList.length >= BULK_CONFIRM_WARNING_THRESHOLD) {
      const ok = await confirmInrcy({
        title: i18nT("confirmer_l_envoi_en_masse_ad787aad"),
        message: bulkConfirmationMessage(recipientsList.length),
        confirmLabel: i18nT("envoyer_e9ce243b"),
        variant: "warning",
      });
      if (!ok || assistant && !assistant.isCurrent()) return;
    }

    setSendBusy(true);
    try {
      if (assistant && !assistant.isCurrent()) return;
      if (shouldSendAsCampaign) {
        const campaignFolder =
          trackedCampaign?.kind && trackedCampaign?.type
            ? folderFromTrack(
                trackedCampaign.kind,
                trackedCampaign.type,
                isBusinessMailFolder(folder) ? folder : "mails",
              )
            : getBulkCampaignFolder();
        const templateKey =
          composeTemplateKey || searchParams?.get("template_key") || "";
        const campaignPayload = {
          accountId: selectedAccount.id,
          type: composeType,
          folder: campaignFolder,
          trackKind: trackedCampaign?.kind || undefined,
          trackType: trackedCampaign?.type || undefined,
          templateKey: templateKey || undefined,
          subject: normalizeMailSubject(
            subject.trim() || i18nT("sans_objet_e5ad6a39"),
          ),
          text: text || "",
          html: normalizeRichMailHtmlForSend(text, html),
          recipients: recipientsList.map((email) => {
            const lower = email.toLowerCase();
            const hint = composeRecipientHintsByEmail.get(lower);
            const crmContact = crmRecipientsByEmail.get(lower);
            return {
              email,
              contact_id: hint?.contact_id || crmContact?.contact_id || null,
              display_name:
                hint?.display_name || crmContact?.display_name || null,
            };
          }),
          attachments: serializeComposeAttachments(composeAttachments),
          sourceDocSaveId: composeSourceDocSaveId || undefined,
          sourceDocType: composeSourceDocType || undefined,
          sourceDocNumber: composeSourceDocNumber || undefined,
        };

        assistant?.started();
        const res = await fetch("/api/crm/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(campaignPayload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setToast(
            data?.error ||
              i18nT("campaign_launch_failed"),
          );
          return;
        }

        if (assistant) {
          if (!assistant.isCurrent() || typeof data?.campaignId !== "string" && typeof data?.id !== "string" || !Number.isFinite(Number(data?.queued))) return;
          assistant.accepted("queued", String(data.campaignId || data.id));
          setDraftId(null);
          setAssistantConsumedSnapshot(currentComposeSnapshot);
          setToast(i18nT("accepte_par_la_messagerie_d_envoi_ac2abd25"));
          void loadHistory();
          return;
        }

        if (draftId) {
          await supabase
            .from("send_items")
            .delete()
            .eq("id", draftId)
            .eq("user_id", resolveActiveBrowserUserId((await supabase.auth.getUser()).data?.user?.id || ""))
            .eq("status", "draft");
        }
        if (trackedCampaign) setPendingTrack(null);
        const queuedCount = Math.max(
          0,
          Number(data?.queued ?? recipientsList.length),
        );
        const blockedDuplicates = Math.max(
          0,
          Number(data?.blockedDuplicates ?? 0),
        );
        const ignoredInvalid = Math.max(0, Number(data?.ignoredInvalid ?? 0));
        const blockedOptOut = Math.max(0, Number(data?.blockedOptOut ?? 0));
        const blockedBlacklist = Math.max(
          0,
          Number(data?.blockedBlacklist ?? 0),
        );
        const blockedHardBounce = Math.max(
          0,
          Number(data?.blockedHardBounce ?? 0),
        );
        const blockedComplaint = Math.max(
          0,
          Number(data?.blockedComplaint ?? 0),
        );
        const extras: string[] = [];
        if (blockedDuplicates > 0)
          extras.push(
            i18nT("blocked_duplicates", { count: blockedDuplicates }),
          );
        if (ignoredInvalid > 0)
          extras.push(
            i18nT("ignored_recipients", { count: ignoredInvalid }),
          );
        if (blockedOptOut > 0)
          extras.push(
            i18nT("blocked_unsubscribes", { count: blockedOptOut }),
          );
        if (blockedBlacklist > 0)
          extras.push(
            i18nT("blocked_blacklist", { count: blockedBlacklist }),
          );
        if (blockedHardBounce > 0)
          extras.push(
            `${blockedHardBounce} rebond${blockedHardBounce > 1 ? "s" : ""} dur${blockedHardBounce > 1 ? "s" : ""}`,
          );
        if (blockedComplaint > 0)
          extras.push(
            `${blockedComplaint} plainte${blockedComplaint > 1 ? "s" : ""}`,
          );
        const deferredReason = String(data?.deferredReason || "").trim();
        const batchSize = Math.max(1, Number(data?.batchSize || 50));
        setToast(null);
        setCampaignDistributionNotice({
          queuedCount,
          batchSize,
          deferredReason,
          extras,
          estimatedDurationMs: Number.isFinite(Number(data?.estimatedDurationMs))
            ? Math.max(0, Number(data.estimatedDurationMs))
            : null,
          estimatedCompletionAt: String(data?.estimatedCompletionAt || "").trim() || null,
        });
        setComposeOpen(false);
        resetCompose();
        await loadHistory();
        updateFolder(campaignFolder);
        return;
      }

      const payload = {
        accountId: selectedAccount.id,
        to: recipientsList[0],
        subject: normalizeMailSubject(
          subject.trim() || i18nT("sans_objet_e5ad6a39"),
        ),
        text: text || "",
        html: normalizeRichMailHtmlForSend(text, html),
        type: composeType,
        // The provider's legacy history update has no draft version guard.
        // Preserve the original draft and append outgoing history for assistant sends.
        ...(draftId && !assistant ? { sendItemId: draftId } : {}),
        attachments: serializeComposeAttachments(composeAttachments),
        sourceDocSaveId: composeSourceDocSaveId || undefined,
        sourceDocType: composeSourceDocType || undefined,
        sourceDocNumber: composeSourceDocNumber || undefined,
      };

      assistant?.started();
      const res = await fetch(providerSendEndpoint(selectedAccount.provider), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(
          data?.user_message ||
            data?.error ||
            i18nT("message_send_failed"),
        );
        return;
      }

      if (assistant) {
        if (!assistant.isCurrent() || data?.ok !== true && data?.success !== true) return;
        assistant.accepted("accepted", typeof data?.id === "string" ? data.id : undefined);
        setDraftId(null);
        setAssistantConsumedSnapshot(currentComposeSnapshot);
        setToast(i18nT("accepte_par_la_messagerie_d_envoi_ac2abd25"));
        void loadHistory();
        return;
      }

      setToast(i18nT("message_envoye_1791794b"));
      setComposeOpen(false);
      resetCompose();
      await loadHistory();
      updateFolder(
        composeType === "facture"
          ? "factures"
          : composeType === "devis"
            ? "devis"
            : "mails",
      );
    } finally {
      setSendBusy(false);
    }
  }

  // L’historique iNr’Send est en lecture seule : seule la rétention automatique le nettoie.

  const resetDetailsStateForItem = useCallback((item: OutboxItem) => {
    setSelectedId(item.id);
    setDetailsId(item.id);
    setDetailsChannelKey(null);
    setDetailsEditMode(false);
    setDetailsActionBusy(false);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    setDetailsSourceDocPayload(null);
    setCampaignRecipients([]);
    setCampaignRecipientsPage(1);
    setCampaignRecipientsPageCount(1);
    setCampaignRecipientsTotal(0);
    setCampaignRecipientsFilter("all");
    setCampaignHealth(null);
    setCampaignReport(null);
  }, [setSelectedId]);

  function openDetails(it: OutboxItem) {
    resetDetailsStateForItem(it);
    setDetailsOpen(true);
  }

  async function navigateDetails(direction: -1 | 1, canContinue: () => boolean = () => true) {
    if (!detailsItem || detailsNavigationBusy || !canContinue()) return;
    const allowed = direction < 0 ? detailsCanNavigatePrevious : detailsCanNavigateNext;
    if (!allowed) return;

    setDetailsNavigationBusy(true);
    try {
      const localIndex = visibleItems.findIndex((item) => item.id === detailsItem.id);
      const localTarget = visibleItems[localIndex + direction];
      if (localTarget) {
        resetDetailsStateForItem(localTarget);
        return;
      }

      const targetPage = historyPage + direction;
      if (targetPage < 1) return;
      const loaded = await loadHistory({ page: targetPage });
      if (!canContinue()) return;
      const pageItems = Array.isArray(loaded?.items) ? loaded.items : [];
      const target = direction > 0 ? pageItems[0] : pageItems[pageItems.length - 1];
      if (target) resetDetailsStateForItem(target);
    } finally {
      setDetailsNavigationBusy(false);
    }
  }

  async function launchPublicationMediaGenerator(publicationBrief: string, stillCurrent: () => boolean = () => true) {
    if (!stillCurrent()) return;
    const channel = normalizeChannelKey(activePublicationEditChannelKey);
    setDetailsActionError(null);
    try {
      const { href, handoff } = await createInrStudioHandoff({
        tab: "generate",
        origin: "inrsend-publish",
        publicationBrief,
        context: {
          itemId: detailsItem?.id || null,
          channel,
        },
      });
      if (!stillCurrent()) { await clearInrStudioHandoff(handoff.key); return; }
      openStudio(href);
    } catch (error) {
      if (!stillCurrent()) return;
      const message =
        error instanceof Error
          ? error.message
          : "Impossible d’ouvrir iNrStudio.";
      setDetailsActionError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  async function openPublicationImageInStudio(
    tab: "modify" | "retouch",
    channel: string,
    imageKey: string,
  ) {
    const normalizedChannel = normalizeChannelKey(channel);
    const asset = publicationEditImagesByChannel[
      normalizedChannel
    ]?.assets.find((candidate) => candidate.key === imageKey);
    if (!asset?.previewUrl && !asset?.file) {
      setDetailsActionError(i18nT("cette_image_n_est_plus_disponible_5dd0b440"));
      return;
    }
    setDetailsActionError(null);
    try {
      const { href } = await createInrStudioHandoff({
        tab,
        origin: "inrsend-publish",
        source: {
          file: asset.file instanceof File ? asset.file : null,
          url: asset.previewUrl || null,
          name: asset.name || "image-publication",
          mimeType:
            asset.file instanceof File ? asset.file.type : "image/jpeg",
        },
        context: {
          itemId: detailsItem?.id || null,
          channel: normalizedChannel,
          imageKey,
        },
      });
      openStudio(href);
    } catch (error) {
      setDetailsActionError(
        error instanceof Error
          ? error.message
          : "Impossible d’ouvrir iNrStudio.",
      );
    }
  }

  const openPublicationImageRetoucher = (channel: string, imageKey: string) =>
    openPublicationImageInStudio("retouch", channel, imageKey);
  const openPublicationImageModifier = (channel: string, imageKey: string) =>
    openPublicationImageInStudio("modify", channel, imageKey);

  async function openPublicationVideoRetoucher(channelValue: string, stillCurrent: () => boolean = () => true) {
    if (!stillCurrent()) return;
    const channel = normalizeChannelKey(channelValue);
    const videoChannel = normalizeBoosterChannelKeyForVideo(channelValue);
    const video = publicationEditVideoByChannel[videoChannel];
    const sourceRecord = (video?.sourceVideo || {}) as Record<string, any>;
    const sourceUrl = String(
      video?.previewUrl ||
        sourceRecord.publicUrl ||
        sourceRecord.public_url ||
        sourceRecord.url ||
        "",
    ).trim();

    if (!channel || !video || video.removed || (!video.file && !sourceUrl)) {
      setDetailsActionError(i18nT("cette_video_n_est_plus_disponible_2d410e11"));
      return;
    }

    setDetailsActionError(null);
    try {
      const storagePath = String(
        sourceRecord.storagePath || sourceRecord.storage_path || "",
      ).trim();
      const publicUrl = String(
        sourceRecord.publicUrl || sourceRecord.public_url || sourceRecord.url || "",
      ).trim();
      const { href, handoff } = await createInrStudioHandoff({
        tab: "retouch",
        origin: "inrsend-publish",
        source: {
          mediaType: "video",
          file: video.file instanceof File ? video.file : null,
          url: sourceUrl || null,
          name: video.name || sourceRecord.name || "video-inrsend.mp4",
          mimeType:
            video.type || sourceRecord.type || sourceRecord.mimeType || "video/mp4",
        },
        context: {
          itemId: detailsItem?.id || null,
          channel,
          mediaType: "video",
        },
        payload: {
          videoChannel,
          videoFormat: video.format || "original",
          videoAdaptationMode: video.adaptationMode || "safe_frame",
          videoStoragePath: storagePath || null,
          videoPublicUrl: publicUrl || sourceUrl || null,
          videoDurationSeconds: video.duration || null,
          videoSize: video.size || null,
          videoSourceMetadata: video.sourceMetadata || null,
          videoTransformedVariants: video.transformedVariants || [],
          videoMediaRecord: sourceRecord,
          deferVideoPreparation: false,
        },
      });
      if (!stillCurrent()) { await clearInrStudioHandoff(handoff.key); return; }
      openStudio(href);
    } catch (error) {
      if (!stillCurrent()) return;
      setDetailsActionError(
        error instanceof Error
          ? error.message
          : "Impossible d’ouvrir iNrStudio.",
      );
    }
  }

  useEffect(() => {
    const snapshotKey = String(
      searchParams?.get("studio_editor_snapshot") || "",
    ).trim();
    if (!snapshotKey || studioEditorSnapshotLoadRef.current === snapshotKey) {
      return;
    }
    studioEditorSnapshotLoadRef.current = snapshotKey;

    void consumeInrSendPublicationEditorSnapshot(snapshotKey)
      .then((snapshot) => {
        if (snapshot) {
          setPendingStudioEditorSnapshot(snapshot);
          setResolvedStudioEditorSnapshotKey(snapshotKey);
          setFailedStudioEditorSnapshotKey(null);
        } else {
          setFailedStudioEditorSnapshotKey(snapshotKey);
          setDetailsActionError(
            i18nT("le_brouillon_local_inrsend_n_a_d34f8f0a"),
          );
        }
      })
      .catch((error) => {
        setFailedStudioEditorSnapshotKey(snapshotKey);
        setDetailsActionError(
          error instanceof Error
            ? error.message
            : "Le brouillon local iNrSend n’a pas pu être restauré.",
        );
      })
      .finally(() => {
        const nextParams = new URLSearchParams(window.location.search);
        nextParams.delete("studio_editor_snapshot");
        nextParams.delete("studio_return");
        router.replace(
          `${window.location.pathname}${nextParams.size ? `?${nextParams.toString()}` : ""}${window.location.hash}`,
          { scroll: false },
        );
      });
  }, [i18nT, router, searchParams]);

  useEffect(() => {
    if (!pendingStudioEditorSnapshot) return;
    const targetItem = items.find(
      (item) => item.id === pendingStudioEditorSnapshot.itemId,
    );
    if (!targetItem) return;

    resetDetailsStateForItem(targetItem);
    setDetailsChannelKey(pendingStudioEditorSnapshot.channel);
    setPublicationEditForm(pendingStudioEditorSnapshot.form);
    setPublicationEditImagesByChannel(
      pendingStudioEditorSnapshot.imagesByChannel,
    );
    setPublicationEditVideoByChannel(
      pendingStudioEditorSnapshot.videoByChannel,
    );
    publicationEditBaselineRef.current = pendingStudioEditorSnapshot.editSourceVersion && activeAccountId
      ? { identity: `${activeAccountId}:${String((targetItem.raw as any)?.payload?.publication_id || "")}:${normalizeChannelKey(pendingStudioEditorSnapshot.channel)}`, expectedState: Promise.resolve(pendingStudioEditorSnapshot.editSourceVersion), operationKey: pendingStudioEditorSnapshot.editOperationKey || crypto.randomUUID() }
      : null; // A legacy snapshot cannot silently acquire a newer source version.
    setDetailsOpen(true);
    setDetailsEditMode(true);
    setPendingStudioEditorSnapshot(null);
  }, [activeAccountId, items, pendingStudioEditorSnapshot, resetDetailsStateForItem, setPublicationEditImagesByChannel, setPublicationEditVideoByChannel]);

  useEffect(() => {
    const returnKey = String(searchParams?.get("studio_return") || "").trim();
    if (!returnKey || pendingStudioReturn) return;
    const returned = consumeInrStudioReturn(returnKey);
    if (!returned?.item) return;

    setPendingStudioReturn(returned);
    setPendingStudioReturnStage("restore");
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.delete("studio_return");
    router.replace(
      `${window.location.pathname}${nextParams.size ? `?${nextParams.toString()}` : ""}${window.location.hash}`,
      { scroll: false },
    );
  }, [pendingStudioReturn, router, searchParams]);

  useEffect(() => {
    if (!pendingStudioReturn) return;
    const itemId = String(pendingStudioReturn.context.itemId || "").trim();
    const channel = normalizeChannelKey(
      String(pendingStudioReturn.context.channel || ""),
    );
    if (!itemId || !channel) {
      setDetailsActionError(i18nT("le_retour_inrstudio_ne_contient_plus_10c05760"));
      setPendingStudioReturn(null);
      setPendingStudioReturnStage("restore");
      completeEmbeddedStudioReturn();
      return;
    }

    if (pendingStudioReturnStage === "restore") {
      const editorSnapshotKey = String(
        pendingStudioReturn.context.editorSnapshotKey || "",
      ).trim();
      if (
        editorSnapshotKey &&
        resolvedStudioEditorSnapshotKey !== editorSnapshotKey &&
        failedStudioEditorSnapshotKey !== editorSnapshotKey
      ) {
        return;
      }
      const targetItem = items.find((item) => item.id === itemId);
      if (!targetItem) return;
      if (editorSnapshotKey && resolvedStudioEditorSnapshotKey === editorSnapshotKey) {
        if (
          !detailsOpen ||
          detailsItem?.id !== itemId ||
          activePublicationEditChannelKey !== channel
        ) {
          return;
        }
        setPendingStudioReturnStage("apply");
        return;
      }
      resetDetailsStateForItem(targetItem);
      setDetailsChannelKey(channel);
      setDetailsOpen(true);
      setPendingStudioReturnStage("wait");
      return;
    }

    if (
      !detailsOpen ||
      detailsItem?.id !== itemId ||
      activePublicationEditChannelKey !== channel
    ) {
      return;
    }
    if (pendingStudioReturnStage === "wait") {
      setPendingStudioReturnStage("apply");
      return;
    }

    const imagesInitialized = Object.prototype.hasOwnProperty.call(
      publicationEditImagesByChannel,
      channel,
    );
    const isSourceEdit =
      pendingStudioReturn.action === "retouch" ||
      pendingStudioReturn.action === "modify";
    const isVideoSourceEdit =
      pendingStudioReturn.item?.media_type === "video" ||
      pendingStudioReturn.context.mediaType === "video";
    if (!isVideoSourceEdit && !imagesInitialized) return;
    const imageKey = String(pendingStudioReturn.context.imageKey || "").trim();
    if (
      isSourceEdit &&
      !isVideoSourceEdit &&
      (!imageKey ||
        !publicationEditImagesByChannel[channel]?.assets.some(
          (asset) => asset.key === imageKey,
        ))
    ) {
      setDetailsActionError(i18nT("l_image_source_de_cette_action_13d33d71"));
      setPendingStudioReturn(null);
      setPendingStudioReturnStage("restore");
      completeEmbeddedStudioReturn();
      return;
    }
    setDetailsEditMode(true);
  }, [
    activePublicationEditChannelKey,
    completeEmbeddedStudioReturn,
    detailsItem?.id,
    detailsOpen,
    i18nT,
    items,
    pendingStudioReturn,
    pendingStudioReturnStage,
    publicationEditImagesByChannel,
    resolvedStudioEditorSnapshotKey,
    failedStudioEditorSnapshotKey,
    resetDetailsStateForItem,
  ]);

  const handleStudioReturnHandled = useCallback(() => {
    setPendingStudioReturn(null);
    setPendingStudioReturnStage("restore");
    setResolvedStudioEditorSnapshotKey(null);
    setFailedStudioEditorSnapshotKey(null);
    completeEmbeddedStudioReturn();
  }, [completeEmbeddedStudioReturn]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () =>
        reject(reader.error ?? new Error(i18nT("file_read_failed")));
      reader.readAsDataURL(file);
    });

  async function saveChannelPublication(): Promise<void> {
    if (!detailsItem || detailsItem.source !== "app_events") return;
    const publicationId = String(
      (detailsPayload as any)?.publication_id || "",
    ).trim();
    const channel = String(activeDetailsChannelEntry?.key || "").trim();
    if (!publicationId || !channel) return;

    const normalizedChannel = normalizeChannelKey(channel);
    const baseline = publicationEditBaselineRef.current;
    if (!baseline || baseline.identity !== `${activeAccountId}:${publicationId}:${normalizedChannel}`) {
      setDetailsActionError(i18nT("rouvrez_le_detail_de_cette_publication_32ee1e34"));
      return;
    }
    if (
      normalizedChannel === "x" &&
      [
        publicationEditForm.title,
        publicationEditForm.content,
        publicationEditForm.cta,
        publicationEditForm.ctaUrl,
        publicationEditForm.hashtags,
      ].some(containsForbiddenXUrl)
    ) {
      setDetailsActionSuccess(null);
      setDetailsActionError(X_FORBIDDEN_URL_ERROR);
      return;
    }
    setDetailsActionBusy(true);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    try {
      if (normalizedChannel === "pinterest" || normalizedChannel === "instagram") {
        const defaultsResponse = await fetch("/api/booster/cta-defaults", { cache: "no-store" });
        if (!defaultsResponse.ok) throw new Error(i18nT("pinterest_publication_defaults_unavailable"));
        const defaults = await defaultsResponse.json().catch(() => null);
        if (!defaults || typeof defaults !== "object") throw new Error(i18nT("pinterest_publication_defaults_unavailable"));
        const editVideo = publicationEditVideoByChannel[normalizedChannel];
        const selectedImages = editVideo && !editVideo.removed && editVideo.previewUrl
          ? [] : (publicationEditImagesByChannel[normalizedChannel]?.assets || []).filter(asset => asset.selected).slice(0, 5);
        const images = orderPinterestPublicationEditImages(selectedImages, asset => Boolean(asset.sourceUrl && !asset.file && !(asset.savedTransform
          ? !arePublicationTransformsEquivalent(asset.transform, asset.savedTransform)
          : isPublicationTransformModified(asset.transform, normalizedChannel))));
        const context = { websiteUrl: String(defaults.siteWebUrl || ""), phone: String(defaults.phone || "") };
        if (normalizedChannel === "pinterest") {
          const issue = getPinterestPublicationEditText(publicationEditForm, images, context).issues[0];
          if (issue) throw new Error(i18nT(issue.field === "title" ? "pinterest_publication_title_too_long" : "pinterest_publication_description_too_long", { count: issue.excess }));
        } else {
          const issue = getInstagramPublicationEditText(publicationEditForm, images, context).issue;
          if (issue) throw new Error(i18nT("instagram_publication_caption_too_long", { count: issue.excess }));
        }
      }
      if (normalizedChannel === "instagram") {
        const confirmed = await confirmInrcy({
          title: i18nT("instagram_business_edit_warning_title"),
          message: i18nT("instagram_business_edit_warning_message"),
          confirmLabel: i18nT("instagram_business_edit_warning_confirm"),
          variant: "warning",
        });
        if (!confirmed) return;
      }
      const expectedState = await baseline.expectedState;
      if (!/^[a-f0-9]{64}$/.test(expectedState)) throw new Error("La version d’origine n’a pas pu être vérifiée. Rouvrez le détail avant de l’enregistrer.");
      const hashtags = publicationEditForm.hashtags
        .split(/[;,\n\s]+/)
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter(Boolean);

      const editVideo = publicationEditVideoByChannel[normalizedChannel];
      const isVideoEdit = Boolean(
        editVideo && !editVideo.removed && editVideo.previewUrl,
      );
      let nextVideoPayload: any = null;
      let nextVideoSettings: any = null;

      if (isVideoEdit) {
        if (!editVideo || editVideo.removed || !editVideo.previewUrl) {
          throw new Error(
            i18nT("ajoutez_une_nouvelle_video_avant_d_803819f5"),
          );
        }
        const boosterChannel = normalizeBoosterChannelKeyForVideo(channel);
        const baseVideo = await ensurePublicationEditVideoUploaded(
          boosterChannel,
          editVideo,
        );
        const format = editVideo.format || "original";
        const adaptationMode = editVideo.adaptationMode || "safe_frame";
        const signature = buildVideoTransformSignature(
        format,
        adaptationMode,
        getVideoPublicationProfileForChannel(
          normalizeBoosterChannelKeyForVideo(channel),
        ),
      );
        let transformedVariants = Array.isArray(editVideo.transformedVariants)
          ? [...editVideo.transformedVariants]
          : [];
        let finalVariant = transformedVariants.find(
          (variant: any) => variant.signature === signature,
        );
        // Sécurité prod : l’enregistrement d’une publication ne doit pas lancer
        // une adaptation vidéo implicite. On utilise uniquement une variante déjà
        // générée via une action explicite du pro ; sinon on conserve l’original.
        if (!finalVariant?.publicUrl && !finalVariant?.url) {
          transformedVariants = transformedVariants.filter(
            (variant: any) => variant.signature !== signature,
          );
          finalVariant = undefined;
        }
        const finalVideo =
          finalVariant?.publicUrl || finalVariant?.url
            ? {
                ...baseVideo,
                ...finalVariant,
                name: finalVariant.name || baseVideo.name || editVideo.name,
                type:
                  finalVariant.contentType ||
                  finalVariant.type ||
                  baseVideo.type ||
                  editVideo.type,
                publicUrl: finalVariant.publicUrl || finalVariant.url,
                url: finalVariant.publicUrl || finalVariant.url,
                storagePath: finalVariant.storagePath || baseVideo.storagePath,
                sourceVideo: baseVideo,
                transformedVariants,
              }
            : {
                ...baseVideo,
                sourceVideo: baseVideo,
                transformedVariants,
              };
        nextVideoPayload = {
          ...finalVideo,
          videoSettings: { format, adaptationMode },
          sourceVideo: baseVideo,
          transformedVariants,
        };
        nextVideoSettings = { format, adaptationMode };
      }

      const channelImages =
        publicationEditImagesByChannel[normalizedChannel]?.assets || [];
      const selectedAssets = channelImages
        .filter((asset) => asset.selected)
        .slice(0, 5);
      const retainedImages: string[] = [];
      const newImages: Array<{ name: string; type: string; dataUrl: string }> =
        [];

      for (const asset of selectedAssets) {
        const transformChanged = asset.savedTransform
          ? !arePublicationTransformsEquivalent(
              asset.transform,
              asset.savedTransform,
            )
          : isPublicationTransformModified(asset.transform, channel);
        const canRetain = !!asset.sourceUrl && !asset.file && !transformChanged;
        if (canRetain) {
          retainedImages.push(String(asset.sourceUrl || ""));
          continue;
        }

        if (
          asset.file &&
          !isPublicationTransformModified(asset.transform, channel)
        ) {
          newImages.push({
            name: asset.name,
            type: asset.type,
            dataUrl: await fileToDataUrl(asset.file),
            originalName: asset.originalName || asset.name,
            originalType: asset.originalType || asset.type,
            transform: asset.transform,
            imageMeta: asset.imageMeta || null,
          } as any);
          continue;
        }

        const renderedImage = await renderPublicationImageAsset({
          source: asset.file || asset.previewUrl,
          transform: asset.transform,
          channel,
          name: asset.name,
          type: asset.type,
        });
        newImages.push({
          ...renderedImage,
          originalUrl: asset.originalUrl || asset.previewUrl || null,
          originalName: asset.originalName || asset.name,
          originalType: asset.originalType || asset.type,
          transform: asset.transform,
          imageMeta: asset.imageMeta || null,
        } as any);
      }

      const res = await fetch(
        `/api/inrsend/publications/${encodeURIComponent(publicationId)}/${encodeURIComponent(channelApiPath(channel))}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedState,
            operationKey: baseline.operationKey,
            title: publicationEditForm.title,
            content: publicationEditForm.content,
            cta: publicationEditForm.cta,
            ctaMode: publicationEditForm.ctaMode,
            ctaUrl: publicationEditForm.ctaUrl,
            ctaPhone: publicationEditForm.ctaPhone,
            ctaAction: publicationEditForm.ctaAction || "",
            hashtags,
            externalId:
              (activeDetailsChannelResult as any)?.external_id || null,
            mediaType: isVideoEdit ? "video" : "images",
            video: nextVideoPayload,
            videoSettings: nextVideoSettings,
            retainedImages: isVideoEdit ? [] : retainedImages,
            newImages: isVideoEdit ? [] : newImages,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || i18nT("publication_update_failed"));
      }
      setDetailsActionSuccess(
        i18nT("publication_value_modifiee_acf7a96f", {
          value0: formatChannelLabel(channel),
        }),
      );
      setDetailsEditMode(false);
      await loadHistory();
    } catch (e: any) {
      setDetailsActionError(
        getClientUserFacingErrorMessage(
          e,
          i18nT("publication_update_failed"),
        ),
      );
    } finally {
      setDetailsActionBusy(false);
    }
  }

  async function deleteChannelPublication(): Promise<{ payload: any; channel: string } | null> {
    if (!detailsItem || detailsItem.source !== "app_events") return null;
    const publicationId = String(
      (detailsPayload as any)?.publication_id || "",
    ).trim();
    const channel = String(activeDetailsChannelEntry?.key || "").trim();
    if (!publicationId || !channel) return null;
    if (channel === "instagram" && !canRemoveInstagramDraftLocally(activeDetailsChannelResult, (detailsPayload as any)?.results_delivery)) {
      setDetailsActionSuccess(null);
      setDetailsActionError(i18nT("instagram_delete_unsupported"));
      return null;
    }
    const label =
      activeDetailsChannelEntry?.label || formatChannelLabel(channel);
    const ok = await confirmInrcy({
      title: i18nT("supprimer_la_publication_1006f8f4"),
      message: i18nT("cette_action_supprimera_la_publication_value_ea883f23", { value0: label }),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      variant: "danger",
    });
    if (!ok) return null;

    setDetailsActionBusy(true);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    try {
      const res = await fetch(
        `/api/inrsend/publications/${encodeURIComponent(publicationId)}/${encodeURIComponent(channelApiPath(channel))}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            externalId:
              (activeDetailsChannelResult as any)?.external_id || null,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok !== true || json?.deleted !== true) {
        throw new Error(json?.error || i18nT("publication_delete_failed"));
      }

      // The API returns the authoritative app_events payload after the remote
      // deletion. Apply it immediately so the details modal switches to
      // "Supprimé" without waiting for a history round-trip or a manual refresh.
      const apiDeletedPayload =
        json?.payload &&
        typeof json.payload === "object" &&
        !Array.isArray(json.payload)
          ? json.payload
          : null;
      const fallbackDeletedResult = {
        ...(activeDetailsChannelResult && typeof activeDetailsChannelResult === "object"
          ? activeDetailsChannelResult
          : {}),
        ok: true,
        deleted: true,
        status: "deleted",
        deleted_at: new Date().toISOString(),
      };
      const payloadBase =
        apiDeletedPayload ||
        ((detailsPayload && typeof detailsPayload === "object") ? detailsPayload : {});
      const payloadResults =
        (payloadBase as any)?.results && typeof (payloadBase as any).results === "object"
          ? (payloadBase as any).results
          : {};
      const apiDeletedChannelResult =
        payloadResults?.[channel] && typeof payloadResults[channel] === "object"
          ? payloadResults[channel]
          : {};
      const deletedPayload = {
        ...payloadBase,
        results: {
          ...payloadResults,
          [channel]: {
            ...fallbackDeletedResult,
            ...apiDeletedChannelResult,
            ok: true,
            deleted: true,
            status: "deleted",
          },
        },
      };
      setItems((current) =>
        current.map((item) =>
          item.id === detailsItem.id && item.source === "app_events"
            ? {
                ...item,
                raw: {
                  ...((item.raw || {}) as Record<string, unknown>),
                  payload: deletedPayload,
                },
              }
            : item,
        ),
      );
      setDetailsActionSuccess(
        channel === "instagram" && json?.local_deleted_only === true
          ? i18nT("instagram_draft_deleted_local")
          : i18nT("publication_value_supprimee_3fa97962", { value0: label }),
      );
      setDetailsEditMode(false);
      // Release the action immediately. The history refresh can continue in
      // the background so the professional may inspect another channel while
      // the remote deletion is being reflected in iNrSend.
      setDetailsActionBusy(false);
      setDetailsChannelKey(channel);
      void loadHistory();
      return { payload: deletedPayload, channel };
    } catch (e: any) {
      const baseMessage = getClientUserFacingErrorMessage(
        e,
        i18nT("publication_delete_failed"),
      );
      setDetailsActionError(baseMessage);
      return null;
    } finally {
      setDetailsActionBusy(false);
    }
  }

  async function retryCampaignFailedRecipients(campaignId: string) {
    if (!campaignId) return;
    setCampaignActionBusyId(campaignId);
    try {
      const res = await fetch(
        `/api/crm/campaigns/${encodeURIComponent(campaignId)}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(
          getClientUserFacingErrorMessage(
            data?.error,
            i18nT("campaign_retry_failed"),
          ),
        );
        return;
      }
      const blocked = Math.max(0, Number(data?.blocked ?? 0));
      const deliveryState = String(data?.campaignStatus || "").toLowerCase();
      const batchSize = Math.max(1, Number(data?.batchSize || 50));
      const baseRetryMessage = data?.retried
        ? [
            i18nT("campaign_retry_contacts", { count: Number(data.retried) }),
            blocked > 0
              ? i18nT("campaign_retry_blocked", { count: blocked })
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        : data?.resumed
          ? i18nT("campaign_resumed")
          : i18nT("campaign_failures_retried");
      const stateMessage =
        deliveryState === "paused"
          ? i18nT("campaign_auto_paused")
          : deliveryState === "queued"
            ? i18nT("campaign_requeued")
            : i18nT("campaign_retry_batches", { count: batchSize });
      setToast(`${baseRetryMessage} ${stateMessage}`.trim());
      await loadHistory();
      if (detailsOpen && detailsId === campaignId) {
        await Promise.all([
          loadCampaignRecipients(campaignId, 1, campaignRecipientsFilter),
          loadCampaignHealth(campaignId, (detailsItem as any)?.raw || {}),
        ]);
      }
    } finally {
      setCampaignActionBusyId(null);
    }
  }

  async function resendCampaignCompletionSummary(campaignId: string) {
    if (!campaignId || campaignSummaryBusyId) return;
    setCampaignSummaryBusyId(campaignId);
    try {
      const response = await fetch(
        `/api/inrsend/campaigns/${encodeURIComponent(campaignId)}/completion-summary`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setToast(
          getClientUserFacingErrorMessage(
            data?.error,
            i18nT("le_bilan_n_a_pas_pu_e6885e77"),
          ),
        );
        return;
      }
      setToast(i18nT("bilan_de_campagne_envoye_0c1ba823"));
      await loadCampaignHealth(campaignId, (detailsItem as any)?.raw || {});
    } finally {
      setCampaignSummaryBusyId(null);
    }
  }

  async function openItem(it: OutboxItem) {
    setSelectedId(it.id);
    if (it.source === "send_items" && it.status === "draft") {
      // raw = SendItem
      const raw = (it.raw || {}) as any;
      if (openWorkflowCampaignDraft(it, raw)) return;
      setComposeOpen(true);
      setDraftId(it.id);
      setDraftServerVersion(inrAssistantMailDraftVersion(raw));
      const draftState =
        raw.draft_state && typeof raw.draft_state === "object" && !Array.isArray(raw.draft_state)
          ? (raw.draft_state as Record<string, any>)
          : {};
      const nextType = (
        raw.type === "facture" || raw.type === "devis" ? raw.type : "mail"
      ) as SendType;
      const nextTrack =
        raw.track_kind && raw.track_type
          ? ({
              kind: raw.track_kind,
              type: raw.track_type,
              payload:
                draftState.trackPayload && typeof draftState.trackPayload === "object"
                  ? draftState.trackPayload
                  : {},
            } as PendingTrack)
          : inferTrackFromCampaign(it);
      const nextAttachments = normalizeCampaignAttachments(raw.attachments);
      const nextSelectedAccountId = String(
        raw.integration_id || draftState.selectedAccountId || "",
      );
      setComposeType(nextType);
      setComposeTemplateKey(String(raw.template_key || ""));
      setComposeSourceDocSaveId(String(raw.source_doc_save_id || ""));
      setComposeSourceDocType(
        raw.source_doc_type === "facture" || raw.source_doc_type === "devis"
          ? raw.source_doc_type
          : "",
      );
      setComposeSourceDocNumber(String(raw.source_doc_number || ""));
      setPendingTrack(nextTrack);
      setSelectedAccountId(nextSelectedAccountId);
      setTo(raw.to_emails || "");
      setComposeRecipientHints(
        normalizeComposeRecipientHints(draftState.recipientHints),
      );
      setSubject(normalizeMailSubject(raw.subject || ""));
      setComposeBody(raw.body_text || "", raw.body_html || "");
      setComposeAttachments(nextAttachments);
      setFiles([]);
      setLastSavedComposeSnapshot(
        makeComposeSnapshot({
          selectedAccountId: nextSelectedAccountId,
          to: String(raw.to_emails || ""),
          subject: normalizeMailSubject(raw.subject || ""),
          text: String(raw.body_text || ""),
          html: String(raw.body_html || ""),
          composeType: nextType,
          composeAttachments: nextAttachments,
          composeSourceDocSaveId: String(raw.source_doc_save_id || ""),
          composeSourceDocType:
            raw.source_doc_type === "facture" || raw.source_doc_type === "devis"
              ? raw.source_doc_type
              : "",
          composeSourceDocNumber: String(raw.source_doc_number || ""),
          composeTemplateKey: String(raw.template_key || ""),
          pendingTrack: nextTrack,
        }),
      );
    } else if (it.source === "app_events" && it.status === "draft") {
      const href =
        it.reopenHref ||
        `/dashboard?action=publish&draftId=${encodeURIComponent(String(it.id || ""))}`;
      setDetailsOpen(false);
      router.push(href);
    }
  }

  function resumeDraftFromDetails(item: OutboxItem) {
    setDetailsOpen(false);
    void openItem(item);
  }

  const handleWorkflowPrevious = useCallback(async () => {
    if (!workflowFinalizerKind || !workflowReturnAction) return;
    const nextKey =
      workflowReturnKey ||
      `${workflowFinalizerKind}_${workflowReturnAction}_${Date.now()}`;
    const trackType =
      pendingTrack?.type || String(searchParams?.get("track_type") || "");
    const trackPayload = (pendingTrack?.payload || {}) as Record<string, any>;
    const currentWorkflowState = readWorkflowCampaignState(workflowReturnKey);
    saveWorkflowCampaignState(
      {
        version: 1,
        kind: workflowFinalizerKind,
        action: workflowReturnAction,
        aiEngine: currentWorkflowState?.aiEngine || null,
        stage: "editor",
        folder,
        selectedAccountId: selectedAccountId || null,
        provider: selectedAccount?.provider || null,
        toEmails: to,
        recipientHints: composeRecipientHints,
        trackKind: workflowFinalizerKind,
        trackType,
        trackPayload,
        templateKey:
          composeTemplateKey ||
          String(searchParams?.get("template_key") || "") ||
          null,
        templateCategory: trackPayload.template_category || null,
        subject,
        bodyText: text,
        bodyHtml: html || textToRichMailHtml(text),
        attachments: composeAttachments,
        draftId: draftId || null,
      },
      nextKey,
    );
    setComposeOpen(false);
    router.push(
      `/dashboard/${workflowFinalizerKind}?action=${encodeURIComponent(workflowReturnAction)}&restore_key=${encodeURIComponent(nextKey)}`,
    );
  }, [
    composeAttachments,
    composeRecipientHints,
    composeTemplateKey,
    draftId,
    folder,
    html,
    pendingTrack,
    router,
    searchParams,
    selectedAccount?.provider,
    selectedAccountId,
    subject,
    text,
    to,
    workflowFinalizerKind,
    workflowReturnAction,
    workflowReturnKey,
  ]);

  const clearHistorySearch = () => {
    setHistoryQuery("");
    requestAnimationFrame(() => historySearchRef.current?.focus());
  };
  useInrAssistantSendHistoryControls({ enabled: folder === "publications" && !adsCampaignsSelected,
    query: historyQuery, boxView, page: historyPage, pageCount: historyPageCount, filterAccountId,
    displayedContextKey: historyDisplayedContextKey, readVersion: historyReadVersion, loading, searchOpen,
    visibleItems, detailsOpen, detailsId, blocked: detailsActionBusy || detailsEditMode || detailsNavigationBusy,
    setQuery: setHistoryQuery, clearSearch: clearHistorySearch, setSearchOpen, setBoxView: updateBoxView, loadHistory, openDetails,
  });

  return (
    <div className={styles.page}>
      {!standardMode ? (
        <PublishAiConfigurationDrawer
          open={aiConfigurationOpen}
          isMobile={isMobileHeader}
          drawerHeight="100dvh"
          onClose={() => setAiConfigurationOpen(false)}
        />
      ) : null}
      <div className={styles.wrap}>
        <MailboxHeader
          standardMode={standardMode}
          founderMode={founderMode}
          helpOpen={helpOpen}
          settingsOpen={settingsOpen}
          onOpenHelp={() => setHelpOpen(true)}
          onCloseHelp={() => setHelpOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onCloseSettings={() => {
            setSettingsOpen(false);
            void loadSignature(selectedAccountId || undefined);
          }}
        />

        <div className={styles.grid}>
          <div className={`${styles.card} ${styles.listCard}`}>
            {(!standardMode || adsEnabled) ? (
              <FolderTabs
                folders={visibleFolders}
                folder={folder}
                counts={counts}
                countsLoading={!historyCountsLoadedOnce}
                onSelectFolder={updateFolder}
                adsTab={adsEnabled ? { active: Boolean(adsCampaignsSelected), count: adsCampaignCount, countError: adsCampaignCountError, onSelect: () => router.replace("/dashboard/mails?folder=campagnes-ads") } : undefined}
              />
            ) : null}

            {adsCampaignsSelected ? <AdsCampaignsFolder key={activeAccountId} onCountChange={refreshAdsCampaignCount} draftOnly={searchParams?.get("boxView") === "drafts"} /> : <>
            <MailboxToolbar
              publicationOnly={standardMode}
              folder={folder}
              filterAccountId={filterAccountId}
              setFilterAccountId={setFilterAccountId}
              mailAccounts={mailAccounts}
              searchOpen={searchOpen}
              historyQuery={historyQuery}
              setSearchOpen={setSearchOpen}
              loadHistory={() => loadHistory()}
              toolCfg={toolCfg}
              resetCompose={resetCompose}
              setComposeOpen={setComposeOpen}
              boxView={boxView}
              onBoxViewChange={updateBoxView}
              draftCount={currentFolderDraftCount}
            />

            <MailboxSearchPanel
              open={searchOpen}
              value={historyQuery}
              inputRef={historySearchRef}
              onChange={setHistoryQuery}
              onClose={() => setSearchOpen(false)}
              onClear={clearHistorySearch}
            />

            <MailboxList
              folder={folder}
              boxView={boxView}
              loading={loading}
              visibleItems={visibleItems}
              selectedId={selectedId}
              openItem={openItem}
              openDetails={openDetails}
              mailAccounts={mailAccounts}
              itemMailAccountId={itemMailAccountId}
              filteredItemsLength={filteredItems.length}
              historyPage={historyPage}
              historyTotalCount={historyTotalCount}
              historyHasMorePotential={historyHasMorePotential}
              historyPageCount={historyPageCount}
              loadHistory={loadHistory}
              refreshHistory={() => loadHistory()}
              historyQuery={historyQuery}
            />
            </>}
          </div>
        </div>

        <MailboxDetailsModal
          documentsEnabled={founderMode}
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          detailsItem={detailsItem}
          detailsAccountLabel={detailsAccountLabel}
          detailsChannelKey={detailsChannelKey}
          setDetailsChannelKey={setDetailsChannelKey}
          detailsEditMode={detailsEditMode}
          setDetailsEditMode={setDetailsEditMode}
          detailsActionBusy={detailsActionBusy}
          detailsActionError={detailsActionError}
          detailsActionSuccess={detailsActionSuccess}
          setDetailsActionError={setDetailsActionError}
          setDetailsActionSuccess={setDetailsActionSuccess}
          detailsSourceDocPayload={detailsSourceDocPayload}
          canNavigatePrevious={detailsCanNavigatePrevious}
          canNavigateNext={detailsCanNavigateNext}
          navigationLabel={detailsNavigationLabel}
          navigationBusy={detailsNavigationBusy}
          onNavigate={navigateDetails}
          campaignRecipients={campaignRecipients}
          campaignRecipientsLoading={campaignRecipientsLoading}
          campaignRecipientsPage={campaignRecipientsPage}
          setCampaignRecipientsPage={setCampaignRecipientsPage}
          campaignRecipientsPageCount={campaignRecipientsPageCount}
          campaignRecipientsTotal={campaignRecipientsTotal}
          campaignRecipientsFilter={campaignRecipientsFilter}
          setCampaignRecipientsFilter={setCampaignRecipientsFilter}
          campaignHealth={campaignHealth}
          campaignHealthLoading={campaignHealthLoading}
          campaignReport={campaignReport}
          campaignSummaryBusyId={campaignSummaryBusyId}
          campaignActionBusyId={campaignActionBusyId}
          publicationEditForm={publicationEditForm}
          setPublicationEditForm={setPublicationEditForm}
          publicationEditFileInputId={publicationEditFileInputId}
          activePublicationEditChannelKey={activePublicationEditChannelKey}
          activePublicationEditPreset={activePublicationEditPreset}
          activePublicationEditAssets={activePublicationEditAssets}
          publicationVideoInputId="publication-edit-video-input"
          activePublicationEditVideo={activePublicationEditVideo}
          addPublicationVideo={addPublicationVideo}
          removePublicationVideo={removePublicationVideo}
          togglePublicationImage={togglePublicationImage}
          launchPublicationMediaGenerator={launchPublicationMediaGenerator}
          publicationStudioTab={publicationStudioTab}
          openPublicationImageRetoucher={openPublicationImageRetoucher}
          openPublicationImageModifier={openPublicationImageModifier}
          openPublicationVideoRetoucher={openPublicationVideoRetoucher}
          resetPublicationImage={resetPublicationImage}
          movePublicationImage={movePublicationImage}
          addPublicationFiles={addPublicationFiles}
          addPublicationPhoto={addPublicationPhoto}
          addPublicationMediaLibraryItems={addPublicationMediaLibraryItems}
          replacePublicationMediaLibraryItem={replacePublicationMediaLibraryItem}
          studioReturn={pendingStudioReturn}
          onStudioReturnHandled={handleStudioReturnHandled}
          saveChannelPublication={saveChannelPublication}
          deleteChannelPublication={deleteChannelPublication}
          retryCampaignFailedRecipients={retryCampaignFailedRecipients}
          resendCampaignCompletionSummary={resendCampaignCompletionSummary}
          openCampaignComposeFromHistory={openCampaignComposeFromHistory}
          loadCampaignRecipients={loadCampaignRecipients}
          loadCampaignHealth={loadCampaignHealth}
          refreshHistory={loadHistory}
          resumeDraft={resumeDraftFromDetails}
        />

        {!standardMode ? (
          <MailboxComposeModal
          open={composeOpen}
          onClose={() => {
            setComposeOpen(false);
            if (scheduledMailEdit) {
              setScheduledMailEdit(null);
              scheduledMailEditLoadRef.current = "";
            }
            if (workflowFinalizerKind)
              router.push(`/dashboard/${workflowFinalizerKind}`);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAiConfiguration={() => setAiConfigurationOpen(true)}
          draftId={draftId}
          currentComposeSnapshot={currentComposeSnapshot}
          lastSavedComposeSnapshot={lastSavedComposeSnapshot}
          mailAccounts={mailAccounts}
          selectedAccountId={selectedAccountId}
          setSelectedAccountId={setSelectedAccountId}
          selectedAccount={selectedAccount}
          to={to}
          setTo={setTo}
          subject={subject}
          setSubject={setSubject}
          text={text}
          setText={setText}
          html={html}
          setHtml={setHtml}
          composeRecipientList={composeRecipientList}
          isBulkCampaignCompose={isBulkCampaignCompose}
          bulkCampaignNotice={bulkCampaignNotice}
          crmPickerOpen={crmPickerOpen}
          setCrmPickerOpen={setCrmPickerOpen}
          crmSearchOpen={crmSearchOpen}
          setCrmSearchOpen={setCrmSearchOpen}
          crmSearchRef={crmSearchRef}
          crmFilter={crmFilter}
          setCrmFilter={setCrmFilter}
          crmCategory={crmCategory}
          setCrmCategory={setCrmCategory}
          crmContactType={crmContactType}
          setCrmContactType={setCrmContactType}
          crmDepartment={crmDepartment}
          setCrmDepartment={(value) =>
            setCrmDepartment(
              sanitizeCrmDepartmentFilter(
                typeof value === "function" ? value(crmDepartment) : value,
              ),
            )
          }
          crmImportantOnly={crmImportantOnly}
          setCrmImportantOnly={setCrmImportantOnly}
          selectedCrmCount={selectedCrmCount}
          filteredContacts={filteredContacts}
          selectedToSet={selectedToSet}
          crmLoading={crmLoading}
          crmError={crmError}
          loadCrmContacts={loadCrmContacts}
          toggleEmailInTo={toggleEmailInTo}
          fileInputId={fileInputId}
          attachBusy={attachBusy}
          composeAttachments={composeAttachments}
          setComposeAttachments={setComposeAttachments}
          setFiles={setFiles}
          uploadComposeFiles={uploadComposeFiles}
          signatureEnabled={signatureEnabled}
          signaturePreview={signaturePreview}
          signatureImageUrl={signatureImageUrl}
          signatureImageWidth={signatureImageWidth}
          saveDraft={saveDraft}
          doSend={scheduledMailEdit ? sendScheduledMailEditNow : doSend}
          onAssistantControls={controls => { assistantMailControls.current = controls; }}
          assistantConsumed={assistantComposeConsumed}
          controlledScheduleOpen={assistantScheduleOpen}
          onControlledScheduleOpenChange={setAssistantScheduleOpen}
          scheduledEditMode={Boolean(scheduledMailEdit)}
          scheduledEditSaving={scheduledMailEditSaving}
          scheduledEditScheduledAt={scheduledMailEdit?.scheduledAt || null}
          onSaveScheduledEdit={() => saveScheduledMailEdit()}
          scheduleWorkflowCampaign={
            composeType === "mail" || workflowFinalizerKind
              ? scheduleMailWithAgent
              : undefined
          }
          onScheduledSuccess={() => {
            setComposeOpen(false);
            if (scheduledMailEdit) {
              setScheduledMailEdit(null);
              scheduledMailEditLoadRef.current = "";
            } else {
              resetCompose();
            }
            if (workflowFinalizerKind)
              router.push(`/dashboard/${workflowFinalizerKind}`);
          }}
          sendBusy={sendBusy}
          scheduleBusy={scheduleBusy}
          toast={toast}
          setToast={setToast}
          workflowFinalizerKind={workflowFinalizerKind}
          onWorkflowPrevious={
            workflowFinalizerKind && workflowReturnAction
              ? handleWorkflowPrevious
              : undefined
          }
          />
        ) : null}

        {!standardMode && campaignDistributionNotice ? (
          <div
            className={styles.campaignDistributionOverlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-distribution-title"
            onMouseDown={() => setCampaignDistributionNotice(null)}
          >
            <div
              className={styles.campaignDistributionCard}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div
                className={styles.campaignDistributionIcon}
                aria-hidden="true"
              >
                ✓
              </div>
              <h2
                id="campaign-distribution-title"
                className={styles.campaignDistributionTitle}
              >
                {i18nT("campagne_validee_en_cours_de_distribution_1588afb2")}{" "}</h2>
              <p className={styles.campaignDistributionText}>
                {campaignDistributionNotice.queuedCount} {" "}{i18nT("email_a88b7dcd")}{" "}{campaignDistributionNotice.queuedCount > 1 ? "s" : ""} {" "}{i18nT("vont_partir_automatiquement_par_vagues_de_6041fa3e")}{" "}
                {campaignDistributionNotice.batchSize} maximum.
              </p>
              <p className={styles.campaignDistributionSubText}>
                {i18nT("vous_pouvez_fermer_cette_fenetre_le_301098d7")}{" "}</p>
              {campaignDistributionNotice.estimatedDurationMs != null ? (
                <p className={styles.campaignDistributionNote}>
                  {i18nT("duree_estimee_526601ed")}{" "}{formatCampaignDuration(
                    campaignDistributionNotice.estimatedDurationMs,
                    i18nT("moins_d_une_minute_abf2db93"),
                  )}
                  {campaignDistributionNotice.estimatedCompletionAt
                    ? i18nT("fin_prevue_vers_value_50f1aa26", { value0: new Date(campaignDistributionNotice.estimatedCompletionAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })
                    : ""}
                </p>
              ) : null}
              {campaignDistributionNotice.deferredReason ? (
                <p className={styles.campaignDistributionNote}>
                  {campaignDistributionNotice.deferredReason}
                </p>
              ) : null}
              {campaignDistributionNotice.extras.length ? (
                <p className={styles.campaignDistributionNote}>
                  {campaignDistributionNotice.extras.join(" · ")}
                </p>
              ) : null}
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => setCampaignDistributionNotice(null)}
              >
                {i18nT("fermer_5ab4ec64")}{" "}</button>
            </div>
          </div>
        ) : null}
      </div>
      {studio}
    </div>
  );
}
