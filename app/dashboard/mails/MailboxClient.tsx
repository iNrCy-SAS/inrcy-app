"use client";

import { useLocale, useTranslations } from "next-intl";


import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";

import { readWorkflowMailPrefillAttachments } from "@/app/dashboard/_lib/workflowMailPrefillAttachments";
import { saveWorkflowCampaignState } from "@/app/dashboard/_lib/workflowCampaignState";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./mails.module.css";
import { createClient } from "@/lib/supabaseClient";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { requestBoosterVideoTransforms } from "@/lib/boosterVideoTransformClient";
import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
} from "@/lib/boosterVideoTransforms";
import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  PROFILE_VERSION_EVENT,
  type ProfileVersionChangeDetail,
} from "@/lib/profileVersioning";
import MailboxHeader from "./_components/MailboxHeader";
import PublishAiConfigurationDrawer from "../booster/publier/components/PublishAiConfigurationDrawer";
import MobileFoldersMenu from "./_components/MobileFoldersMenu";
import FolderTabs from "./_components/FolderTabs";
import MailboxToolbar from "./_components/MailboxToolbar";
import MailboxList from "./_components/MailboxList";
import MailboxSearchPanel from "./_components/MailboxSearchPanel";
import MailboxDetailsModal from "./_components/MailboxDetailsModal";
import type { MediaLibraryPickerItem } from "@/app/dashboard/_components/MediaLibraryPickerModal";
import MailboxPublicationImageAdapterModal from "./_components/MailboxPublicationImageAdapterModal";
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
  campaignTitleFromFolder,
  channelApiPath,
  computePublicationPreviewLayout,
  defaultFolderFromSendType,
  emptyFolderCounts,
  extractAttachmentsFromPayload,
  extractChannelPublications,
  extractChannelsFromPayload,
  extractMessageFromPayload,
  extractPublicationParts,
  extractPublicationResults,
  folderFromTrack,
  folderLabel,
  folderTheme,
  formatCampaignDuration,
  formatCampaignFilterLabel,
  formatCampaignProgress,
  formatChannelLabel,
  formatOutboxStatusLabel,
  getPublicationChannelPreset,
  getCampaignRecipientStatusLabel,
  getChannelIndicatorMeta,
  getFailedChannelMessage,
  getPublicationBackgroundMode,
  buildPublicationDefaultTransform,
  getPublicationChannelStatuses,
  hasAttachmentFields,
  firstNonEmpty,
  historyEmptyState,
  isBusinessMailFolder,
  isDeletedChannelResult,
  isFailedChannelResult,
  isFolderValue,
  isImageAttachment,
  isPublicationTransformModified,
  isRetryableCampaignItem,
  isVideoAttachment,
  isVisibleInFolder,
  listGridTemplateColumns,
  makePublicationImageAssetKey,
  normalizeChannelKey,
  normalizeFolderCounts,
  offsetFromPublicationDrawPosition,
  orderChannelKeys,
  pill,
  publicationClamp,
  renderPublicationChannelsWithFailures,
  renderPublicationImageAsset,
  resolveCampaignFolder,
  safeDecode,
  safeS,
  splitList,
  stripText,
  tagsToEditorString,
  toolbarActionTheme,
  withPublicationBackgroundMode,
  type BoxView,
  type CampaignExperienceReport,
  type CampaignHealthSummary,
  type CampaignRecipientLog,
  type CampaignRecipientsFilterId,
  type ChannelPublication,
  type ComposeAttachmentRef,
  type ComposeCrmRecipientHint,
  type EditablePublicationAttachment,
  type Folder,
  type FolderCounts,
  type MailAccount,
  type OutboxItem,
  type PublicationChannelImagesState,
  type PublicationImageAsset,
  type PublicationImageBackgroundMode,
  type PublicationImageFitMode,
  type PublicationImageTransform,
  type PublicationEditForm,
  type PublicationParts,
  type SendItem,
  type SendType,
  type Status,
} from "./_lib/mailboxPhase1";

import {
  MAILBOX_HISTORY_PREFETCH_CONCURRENCY,
  buildMailboxHistoryPreloadPlan,
  isMailboxHistorySnapshotFresh,
  mailboxHistoryContextKey,
  mailboxHistoryGroupKey,
  mailboxHistoryPageCount,
  mailboxHistoryPageKey,
  mailboxHistoryRefreshInterval,
  normalizeMailboxHistoryQuery,
  type MailboxHistoryContext,
  type MailboxHistorySnapshot,
} from "./_lib/mailboxHistoryPreload";

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
import { stripTemplateSignatureBlock } from "@/lib/mailTemplateCleanup";
import {
  normalizeRichMailHtmlForSend,
  textToRichMailHtml,
} from "@/lib/mailRichText";
import {
  BOOSTER_MAX_IMAGE_BYTES,
  BOOSTER_MAX_IMAGE_COUNT,
  BOOSTER_MAX_IMAGE_MB_LABEL,
  BOOSTER_MAX_MEDIA_BYTES,
  BOOSTER_MAX_MEDIA_MB_LABEL,
  BOOSTER_MAX_VIDEO_BYTES,
  BOOSTER_MAX_VIDEO_MB_LABEL,
  uploadBoosterVideo,
  getLocalizedVideoAdaptationModeLabel,
  getLocalizedVideoFormatLabel,
  getLocalizedVideoOrientationLabel,
  isUnsupportedBrowserImageFile,
  type BoosterVideoSourceMetadata,
  type ChannelKey as BoosterChannelKey,
  type VideoAdaptationMode,
  type VideoFormat,
  type VideoPayload,
} from "../booster/publier/publishModal.shared";
import {
  attachmentToVideoPayload,
  normalizeBoosterChannelKeyForVideo,
  readPublicationVideoMetadata,
  type CampaignDistributionNotice,
  type PublicationEditVideoState,
} from "./_lib/mailboxPublicationVideo.foundations";
import {
  asScheduledRecord,
  contactDepartment,
  inferTrackFromCampaign,
  normalizeCampaignAttachments,
  sanitizeCrmDepartmentFilter,
  serializeComposeAttachments,
  workflowDraftTargetFromSendItem,
  type PendingTrack,
} from "./_lib/mailboxComposeCampaign.foundations";

type InrSendDefaultSnapshot = {
  items: OutboxItem[];
  page: number;
  total: number | null;
  hasMore: boolean;
  folderCounts: FolderCounts;
  draftFolderCounts: FolderCounts;
};

const INRSEND_HISTORY_RECOVERY_THROTTLE_MS = 10_000;
const INRSEND_COUNTS_CACHE_MS = 30_000;

function mailboxHistoryCountsKey(context: MailboxHistoryContext) {
  return `account=${encodeURIComponent(context.filterAccountId)}|q=${encodeURIComponent(context.query)}`;
}

export default function MailboxClient({ standardMode = false }: { standardMode?: boolean }) {
  const i18nT = useTranslations("mails");
  const locale = useLocale();
  const [helpOpen, setHelpOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [mobileFoldersOpen, setMobileFoldersOpen] = useState(false);
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

  // Keep the server render and the first browser render identical. Reading
  // sessionStorage inside a state initializer made the server display `0`
  // while the hydrating client displayed `…`, forcing React to rebuild iNrSend.
  const [initialHistorySnapshot, setInitialHistorySnapshot] =
    useState<InrSendDefaultSnapshot | null>(null);
  const [historyCacheHydrated, setHistoryCacheHydrated] = useState(false);
  const [folder, setFolder] = useState<Folder>("publications");
  const [boxView, setBoxView] = useState<BoxView>("sent");
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoadedOnce, setHistoryLoadedOnce] = useState(false);
  const [historyCountsLoadedOnce, setHistoryCountsLoadedOnce] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const historyPageRef = useRef(1);
  const [historyHasMorePotential, setHistoryHasMorePotential] = useState(false);
  const [historyTotalCount, setHistoryTotalCount] = useState<number | null>(null);
  const [folderCounts, setFolderCounts] = useState<FolderCounts>(() =>
    emptyFolderCounts(),
  );
  const [draftFolderCounts, setDraftFolderCounts] = useState<FolderCounts>(() =>
    emptyFolderCounts(),
  );

  const historyCacheRef = useRef<Map<string, MailboxHistorySnapshot<OutboxItem>>>(new Map());
  const historyInFlightRef = useRef<Map<string, Promise<MailboxHistorySnapshot<OutboxItem> | null>>>(new Map());
  const historyCountsInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const historyCountsFetchedAtRef = useRef<Map<string, number>>(new Map());
  const historyCountsDisplayKeyRef = useRef("");
  const historyDisplayedContextKeyRef = useRef("");
  const historyLoadedContextKeyRef = useRef("");
  const historyPreloadGenerationRef = useRef(0);
  const historyPreloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const snapshot =
      readModuleSnapshot<InrSendDefaultSnapshot>(
        MODULE_SNAPSHOT_KEYS.inrSendDefault,
      )?.data ?? null;
    setInitialHistorySnapshot(snapshot);
    if (snapshot) {
      const restoredItems = Array.isArray(snapshot.items) ? snapshot.items : [];
      const restoredPage = Math.max(1, snapshot.page || 1);
      setItems(restoredItems);
      setLoading(false);
      setHistoryLoadedOnce(true);
      setSelectedId(restoredItems[0]?.id ?? null);
      setHistoryPage(restoredPage);
      historyPageRef.current = restoredPage;
      setHistoryHasMorePotential(Boolean(snapshot.hasMore));
      setHistoryTotalCount(snapshot.total ?? null);
      setFolderCounts(snapshot.folderCounts ?? emptyFolderCounts());
      setDraftFolderCounts(snapshot.draftFolderCounts ?? emptyFolderCounts());
      historyDisplayedContextKeyRef.current = mailboxHistoryContextKey({
        folder: "publications",
        boxView: "sent",
        filterAccountId: "",
        query: "",
      });
    }
    setHistoryCacheHydrated(true);
  }, []);

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
  const [publicationEditImagesByChannel, setPublicationEditImagesByChannel] =
    useState<Record<string, PublicationChannelImagesState>>({});
  const [publicationEditVideoByChannel, setPublicationEditVideoByChannel] =
    useState<Record<string, PublicationEditVideoState>>({});
  const [
    publicationImageAdapterChannelKey,
    setPublicationImageAdapterChannelKey,
  ] = useState<string | null>(null);
  const [publicationImageAdapterImageKey, setPublicationImageAdapterImageKey] =
    useState<string | null>(null);
  const publicationImageAdapterDragRef = useRef<{
    channel: string;
    imageKey: string;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const publicationImageAdapterReturnScrollTopRef = useRef<number | null>(null);
  const publicationImageAdapterStageRef = useRef<HTMLDivElement | null>(null);
  const [
    publicationImageAdapterStageSize,
    setPublicationImageAdapterStageSize,
  ] = useState({ width: 0, height: 0 });
  const [
    publicationImageAdapterImageMeta,
    setPublicationImageAdapterImageMeta,
  ] = useState<Record<string, { width: number; height: number }>>({});
  const [
    isPublicationImageAdapterDragging,
    setIsPublicationImageAdapterDragging,
  ] = useState(false);

  const publicationImageAdapterChannelState = publicationImageAdapterChannelKey
    ? publicationEditImagesByChannel[publicationImageAdapterChannelKey] || {
        assets: [],
      }
    : null;
  const publicationImageAdapterAsset =
    publicationImageAdapterChannelState?.assets.find(
      (asset) => asset.key === publicationImageAdapterImageKey,
    ) || null;

  useEffect(() => {
    historyPageRef.current = historyPage;
  }, [historyPage]);

  useEffect(() => {
    if (!detailsOpen || !detailsEditMode || !publicationImageAdapterAsset)
      return;
    const key = publicationImageAdapterAsset.key;
    if (publicationImageAdapterImageMeta[key]) return;
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (cancelled) return;
      setPublicationImageAdapterImageMeta((prev) => ({
        ...prev,
        [key]: {
          width: image.naturalWidth || image.width || 0,
          height: image.naturalHeight || image.height || 0,
        },
      }));
    };
    image.src = publicationImageAdapterAsset.previewUrl;
    return () => {
      cancelled = true;
    };
  }, [
    detailsOpen,
    detailsEditMode,
    publicationImageAdapterAsset?.key,
    publicationImageAdapterAsset?.previewUrl,
    publicationImageAdapterImageMeta,
  ]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsEditMode ||
      !publicationImageAdapterAsset ||
      !publicationImageAdapterStageRef.current
    )
      return;
    const node = publicationImageAdapterStageRef.current;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setPublicationImageAdapterStageSize({
        width: rect.width,
        height: rect.height,
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [detailsOpen, detailsEditMode, publicationImageAdapterAsset?.key]);

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
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [filterAccountId, setFilterAccountId] = useState<string>("");

  // Compose
  const [composeOpen, setComposeOpen] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [composeType, setComposeType] = useState<SendType>("mail");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [files, setFiles] = useState<File[]>([]);
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

    setFolder("publications");
    setBoxView("sent");
    setFilterAccountId("");
    setMobileFoldersOpen(false);
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
    if ((requestedFolder && requestedFolder !== "publications") || hasPremiumComposeIntent) {
      router.replace("/dashboard/mails?folder=publications", { scroll: false });
    }
  }, [router, searchParams, standardMode]);

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

  // CRM selection (compose)
  type CrmContact = {
    id: string;
    full_name: string | null;
    email: string | null;
    category: "particulier" | "professionnel" | "collectivite_publique" | null;
    contact_type:
      "client" | "prospect" | "fournisseur" | "partenaire" | "autre" | null;
    postal_code: string | null;
    city: string | null;
    important: boolean;
  };

  const [crmContacts, setCrmContacts] = useState<CrmContact[]>([]);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmFilter, setCrmFilter] = useState("");
  const [crmSearchOpen, setCrmSearchOpen] = useState(false);
  const crmSearchRef = useRef<HTMLInputElement | null>(null);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [crmPickerOpen, setCrmPickerOpen] = useState(false);
  const [crmCategory, setCrmCategory] = useState<
    "all" | CrmContact["category"]
  >("all");
  const [crmContactType, setCrmContactType] = useState<
    "all" | CrmContact["contact_type"]
  >("all");
  const [crmDepartment, setCrmDepartment] = useState("");
  const [crmImportantOnly, setCrmImportantOnly] = useState(false);

  // Used to trigger the hidden file input with a nice button
  const fileInputId = MAILBOX_FILE_INPUT_ID;
  const publicationEditFileInputId = PUBLICATION_EDIT_FILE_INPUT_ID;

  function toggleEmailInTo(email: string) {
    const list = normalizeEmails(to);
    const lower = email.toLowerCase();
    const exists = list.some((x) => x.toLowerCase() === lower);
    const next = exists
      ? list.filter((x) => x.toLowerCase() !== lower)
      : [...list, email];
    setTo(next.join(", "));
  }

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

  // Recherche dans l'historique iNr'Send
  const [historyQuery, setHistoryQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const historySearchRef = useRef<HTMLInputElement | null>(null);

  const activeHistoryContext = useMemo<MailboxHistoryContext>(() => ({
    folder,
    boxView,
    filterAccountId,
    query: normalizeMailboxHistoryQuery(historyQuery),
  }), [boxView, filterAccountId, folder, historyQuery]);
  const activeHistoryContextKey = useMemo(
    () => mailboxHistoryContextKey(activeHistoryContext),
    [activeHistoryContext],
  );
  const activeHistoryContextKeyRef = useRef(activeHistoryContextKey);
  const activeHistoryContextRef = useRef(activeHistoryContext);

  useLayoutEffect(() => {
    activeHistoryContextKeyRef.current = activeHistoryContextKey;
    activeHistoryContextRef.current = activeHistoryContext;
  }, [activeHistoryContext, activeHistoryContextKey]);

  useEffect(() => {
    if (!initialHistorySnapshot) return;
    const initialContext: MailboxHistoryContext = {
      folder: "publications",
      boxView: "sent",
      filterAccountId: "",
      query: "",
    };
    historyCacheRef.current.set(
      mailboxHistoryPageKey(initialContext, initialHistorySnapshot.page),
      {
        items: initialHistorySnapshot.items,
        page: initialHistorySnapshot.page,
        total: initialHistorySnapshot.total,
        hasMore: initialHistorySnapshot.hasMore,
        folderCounts: initialHistorySnapshot.folderCounts,
        draftFolderCounts: initialHistorySnapshot.draftFolderCounts,
        fetchedAt: Date.now(),
      },
    );
  }, [initialHistorySnapshot]);

  useEffect(() => () => {
    historyPreloadGenerationRef.current += 1;
    if (historyPreloadTimerRef.current) {
      clearTimeout(historyPreloadTimerRef.current);
      historyPreloadTimerRef.current = null;
    }
  }, []);

  const filteredContacts = useMemo(() => {
    const q = crmFilter.trim().toLowerCase();
    const department = sanitizeCrmDepartmentFilter(crmDepartment);
    return crmContacts.filter((c) => {
      if (crmImportantOnly && !c.important) return false;
      if (crmCategory !== "all" && c.category !== crmCategory) return false;
      if (crmContactType !== "all" && c.contact_type !== crmContactType)
        return false;
      if (
        department &&
        !contactDepartment(c.postal_code).startsWith(department)
      )
        return false;
      if (!q) return true;
      const hay =
        `${c.full_name || ""} ${c.email || ""} ${c.postal_code || ""} ${c.city || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [
    crmContacts,
    crmFilter,
    crmImportantOnly,
    crmCategory,
    crmContactType,
    crmDepartment,
  ]);

  const selectedToSet = useMemo(() => {
    return new Set(normalizeEmails(to).map((e) => e.toLowerCase()));
  }, [to]);

  const selectedCrmCount = useMemo(() => {
    let n = 0;
    for (const c of crmContacts) {
      if (c.email && selectedToSet.has(String(c.email).toLowerCase())) n += 1;
    }
    return n;
  }, [crmContacts, selectedToSet]);

  const crmRecipientsByEmail = useMemo(() => {
    const map = new Map<string, ComposeCrmRecipientHint>();
    for (const contact of crmContacts) {
      const email = String(contact.email || "").trim();
      if (!email) continue;
      const lower = email.toLowerCase();
      if (map.has(lower)) continue;
      map.set(lower, {
        email,
        contact_id: contact.id,
        display_name: (contact.full_name || "").trim() || null,
      });
    }
    return map;
  }, [crmContacts]);

  const composeRecipientHintsByEmail = useMemo(() => {
    const map = new Map<string, ComposeCrmRecipientHint>();
    for (const hint of composeRecipientHints) {
      const email = String(hint.email || "").trim();
      if (!email) continue;
      map.set(email.toLowerCase(), {
        email,
        contact_id: hint.contact_id || null,
        display_name: hint.display_name || null,
      });
    }
    return map;
  }, [composeRecipientHints]);

  const counts = folderCounts;
  const currentFolderDraftCount = draftFolderCounts[folder] || 0;

  function makeComposeSnapshot(input?: {
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
  }) {
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
  }

  const currentComposeSnapshot = useMemo(
    () => makeComposeSnapshot(),
    [
      selectedAccountId,
      to,
      subject,
      text,
      html,
      composeType,
      composeAttachments,
      composeSourceDocSaveId,
      composeSourceDocType,
      composeSourceDocNumber,
      composeTemplateKey,
      pendingTrack,
    ],
  );

  function setComposeSavedSnapshotFromCurrent() {
    setLastSavedComposeSnapshot(makeComposeSnapshot());
  }

  function buildScheduledMailEditPayload(scheduledAt?: string | null) {
    if (!scheduledMailEdit) return null;
    if (!selectedAccount) {
      throw new Error(i18nT("veuillez_connecter_une_boite_d_envoi_98abd470"));
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

    const restoreKey = saveWorkflowCampaignState({
      kind: target.kind,
      action: target.action,
      folder: target.folder,
      trackKind: target.kind,
      trackType: target.trackType,
      templateKey: String(raw.template_key || "") || null,
      templateCategory: null,
      subject: normalizeMailSubject(String(raw.subject || item.subject || "")),
      bodyText: String(raw.body_text || item.detailText || ""),
      bodyHtml: String(
        raw.body_html ||
          item.detailHtml ||
          textToRichMailHtml(String(raw.body_text || item.detailText || "")),
      ),
      attachments: normalizeCampaignAttachments(raw.attachments),
      draftId: item.id,
    });

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
        raw.type === "facture" || raw.type === "devis" ? raw.type : "mail";
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
      setComposeSourceDocSaveId(String(raw.source_doc_save_id || ""));
      setComposeSourceDocType(
        raw.source_doc_type === "facture" || raw.source_doc_type === "devis"
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

  async function loadAccounts() {
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

    const connected = accounts.filter(
      (a) =>
        a.status === "connected" &&
        a.connection_status !== "needs_update" &&
        !a.requires_update,
    );
    const defaultId = connected[0]?.id || "";
    const usableAccountIds = new Set(
      connected.map((a) => String(a?.id || "")).filter(Boolean),
    );
    const accountIds = new Set(
      accounts.map((a) => String(a?.id || "")).filter(Boolean),
    );

    setSelectedAccountId((prev) =>
      prev && usableAccountIds.has(prev) ? prev : defaultId,
    );
    setFilterAccountId((prev) => (prev && accountIds.has(prev) ? prev : ""));
  }

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

  const applyHistorySnapshot = useCallback((
    context: MailboxHistoryContext,
    snapshot: MailboxHistorySnapshot<OutboxItem>,
  ) => {
    const contextKey = mailboxHistoryContextKey(context);
    if (activeHistoryContextKeyRef.current !== contextKey) return false;

    setItems(snapshot.items);
    setHistoryPage(snapshot.page);
    setHistoryHasMorePotential(snapshot.hasMore);
    setHistoryTotalCount(snapshot.total);
    if (snapshot.folderCounts) setFolderCounts(snapshot.folderCounts);
    if (snapshot.draftFolderCounts) setDraftFolderCounts(snapshot.draftFolderCounts);
    setSelectedId((previous) =>
      snapshot.items.some((item) => item.id === previous)
        ? previous
        : (snapshot.items[0]?.id ?? null),
    );
    historyDisplayedContextKeyRef.current = contextKey;

    const isDefaultSnapshot =
      snapshot.page === 1 &&
      context.folder === "publications" &&
      context.boxView === "sent" &&
      !context.filterAccountId &&
      !context.query;
    if (isDefaultSnapshot && snapshot.folderCounts && snapshot.draftFolderCounts) {
      writeModuleSnapshot<InrSendDefaultSnapshot>(MODULE_SNAPSHOT_KEYS.inrSendDefault, {
        items: snapshot.items,
        page: snapshot.page,
        total: snapshot.total,
        hasMore: snapshot.hasMore,
        folderCounts: snapshot.folderCounts,
        draftFolderCounts: snapshot.draftFolderCounts,
      });
    }

    return true;
  }, []);

  const fetchHistoryPage = useCallback(async (options: {
    context: MailboxHistoryContext;
    page: number;
    totalHint?: number | null;
    folderCountsHint?: FolderCounts;
    draftFolderCountsHint?: FolderCounts;
  }): Promise<MailboxHistorySnapshot<OutboxItem> | null> => {
    const targetPage = Math.max(1, Math.floor(options.page || 1));
    const pageKey = mailboxHistoryPageKey(options.context, targetPage);
    const requestKey = pageKey;
    const existingRequest = historyInFlightRef.current.get(requestKey);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      try {
        const params = new URLSearchParams();
        params.set("page", String(targetPage));
        params.set("pageSize", String(MAILBOX_PAGE_SIZE));
        params.set("folder", options.context.folder);
        params.set("boxView", options.context.boxView);
        if (options.context.filterAccountId) {
          params.set("filterAccountId", options.context.filterAccountId);
        }
        if (options.context.query) params.set("q", options.context.query);
        params.set("includeCounts", "0");

        const response = await fetch(`/api/inrsend/history?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            payload?.error || i18nT("history_load_failed"),
          );
        }

        const nextItems = Array.isArray(payload?.items)
          ? (payload.items as OutboxItem[])
          : [];
        const nextPage = typeof payload?.page === "number"
          ? Math.max(1, Number(payload.page))
          : targetPage;
        const nextFolderCounts = payload?.folderCounts
          ? normalizeFolderCounts(payload.folderCounts)
          : options.folderCountsHint;
        const nextDraftFolderCounts = payload?.draftFolderCounts
          ? normalizeFolderCounts(payload.draftFolderCounts)
          : options.draftFolderCountsHint;
        const nextTotal = typeof payload?.total === "number"
          ? Math.max(0, Number(payload.total))
          : typeof options.totalHint === "number"
            ? Math.max(0, Number(options.totalHint))
            : null;
        const nextHasMore = nextTotal != null
          ? nextPage < mailboxHistoryPageCount(nextTotal, MAILBOX_PAGE_SIZE)
          : Boolean(payload?.hasMore);

        const snapshot: MailboxHistorySnapshot<OutboxItem> = {
          items: nextItems,
          page: nextPage,
          total: nextTotal,
          hasMore: nextHasMore,
          folderCounts: nextFolderCounts,
          draftFolderCounts: nextDraftFolderCounts,
          fetchedAt: Date.now(),
        };
        historyCacheRef.current.set(pageKey, snapshot);
        return snapshot;
      } catch (error) {
        console.error(error);
        return null;
      } finally {
        historyInFlightRef.current.delete(requestKey);
      }
    })();

    historyInFlightRef.current.set(requestKey, request);
    return request;
  }, []);

  const loadHistoryCounts = useCallback(async (
    context: MailboxHistoryContext,
    options?: { force?: boolean },
  ) => {
    const countsKey = mailboxHistoryCountsKey(context);
    const now = Date.now();
    const lastFetchedAt = historyCountsFetchedAtRef.current.get(countsKey) || 0;
    if (
      !options?.force &&
      historyCountsDisplayKeyRef.current === countsKey &&
      now - lastFetchedAt < INRSEND_COUNTS_CACHE_MS
    ) {
      return true;
    }

    const existingRequest = historyCountsInFlightRef.current.get(countsKey);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      try {
        const params = new URLSearchParams();
        params.set("countsOnly", "1");
        if (context.filterAccountId) {
          params.set("filterAccountId", context.filterAccountId);
        }
        if (context.query) params.set("q", context.query);

        const response = await fetch(`/api/inrsend/history?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.countsIncluded !== true) return false;

        const nextFolderCounts = normalizeFolderCounts(payload.folderCounts);
        const nextDraftFolderCounts = normalizeFolderCounts(payload.draftFolderCounts);
        historyCountsFetchedAtRef.current.set(countsKey, Date.now());

        const currentContext = activeHistoryContextRef.current;
        if (mailboxHistoryCountsKey(currentContext) !== countsKey) return true;

        const activeCounts = currentContext.boxView === "drafts"
          ? nextDraftFolderCounts
          : nextFolderCounts;
        const nextTotal = Math.max(0, Number(activeCounts[currentContext.folder] || 0));
        setFolderCounts(nextFolderCounts);
        setDraftFolderCounts(nextDraftFolderCounts);
        setHistoryTotalCount(nextTotal);
        setHistoryHasMorePotential(
          historyPageRef.current < mailboxHistoryPageCount(nextTotal, MAILBOX_PAGE_SIZE),
        );
        setHistoryCountsLoadedOnce(true);
        historyCountsDisplayKeyRef.current = countsKey;

        const currentSnapshot = historyCacheRef.current.get(
          mailboxHistoryPageKey(currentContext, historyPageRef.current),
        );
        if (currentSnapshot) {
          const enrichedSnapshot = {
            ...currentSnapshot,
            total: nextTotal,
            hasMore:
              historyPageRef.current < mailboxHistoryPageCount(nextTotal, MAILBOX_PAGE_SIZE),
            folderCounts: nextFolderCounts,
            draftFolderCounts: nextDraftFolderCounts,
          };
          historyCacheRef.current.set(
            mailboxHistoryPageKey(currentContext, historyPageRef.current),
            enrichedSnapshot,
          );

          const isDefaultSnapshot =
            enrichedSnapshot.page === 1 &&
            currentContext.folder === "publications" &&
            currentContext.boxView === "sent" &&
            !currentContext.filterAccountId &&
            !currentContext.query;
          if (isDefaultSnapshot) {
            writeModuleSnapshot<InrSendDefaultSnapshot>(MODULE_SNAPSHOT_KEYS.inrSendDefault, {
              items: enrichedSnapshot.items,
              page: enrichedSnapshot.page,
              total: enrichedSnapshot.total,
              hasMore: enrichedSnapshot.hasMore,
              folderCounts: nextFolderCounts,
              draftFolderCounts: nextDraftFolderCounts,
            });
          }
        }

        return true;
      } catch (error) {
        console.error(error);
        return false;
      } finally {
        historyCountsInFlightRef.current.delete(countsKey);
      }
    })();

    historyCountsInFlightRef.current.set(countsKey, request);
    return request;
  }, []);

  const scheduleHistoryPreload = useCallback((
    context: MailboxHistoryContext,
    snapshot: MailboxHistorySnapshot<OutboxItem>,
  ) => {
    const availableFolderCounts = snapshot.folderCounts;
    const availableDraftFolderCounts = snapshot.draftFolderCounts;

    historyPreloadGenerationRef.current += 1;
    const generation = historyPreloadGenerationRef.current;
    if (historyPreloadTimerRef.current) {
      clearTimeout(historyPreloadTimerRef.current);
      historyPreloadTimerRef.current = null;
    }

    const plan = buildMailboxHistoryPreloadPlan({
      currentContext: context,
      currentPage: snapshot.page,
      pageSize: MAILBOX_PAGE_SIZE,
      currentTotal: snapshot.total,
      currentHasMore: snapshot.hasMore,
    }).filter((job) => {
      const cached = historyCacheRef.current.get(
        mailboxHistoryPageKey(job.context, job.page),
      );
      return !isMailboxHistorySnapshotFresh(cached);
    });

    if (!plan.length) return;

    historyPreloadTimerRef.current = setTimeout(() => {
      historyPreloadTimerRef.current = null;
      let cursor = 0;
      const worker = async () => {
        while (cursor < plan.length && generation === historyPreloadGenerationRef.current) {
          const job = plan[cursor];
          cursor += 1;
          const pageKey = mailboxHistoryPageKey(job.context, job.page);
          if (isMailboxHistorySnapshotFresh(historyCacheRef.current.get(pageKey))) {
            continue;
          }
          await fetchHistoryPage({
            context: job.context,
            page: job.page,
            totalHint: job.total,
            folderCountsHint: availableFolderCounts,
            draftFolderCountsHint: availableDraftFolderCounts,
          });
        }
      };

      void Promise.all(
        Array.from(
          { length: Math.min(MAILBOX_HISTORY_PREFETCH_CONCURRENCY, plan.length) },
          () => worker(),
        ),
      );
    }, 600);
  }, [fetchHistoryPage]);

  const loadHistory = useCallback(
    async (options?: { page?: number; silent?: boolean; force?: boolean }) => {
      const context = activeHistoryContext;
      const contextKey = mailboxHistoryContextKey(context);
      const countsKey = mailboxHistoryCountsKey(context);
      if (historyCountsDisplayKeyRef.current !== countsKey) {
        setHistoryCountsLoadedOnce(false);
      }
      const targetPage = Math.max(
        1,
        options?.page ?? historyPageRef.current ?? 1,
      );
      // Calls without options come from refresh buttons, mutations or external
      // version events. They deliberately bypass the cache.
      const force = options?.force ?? options === undefined;

      if (force) {
        historyPreloadGenerationRef.current += 1;
        const groupPrefix = `${mailboxHistoryGroupKey(context)}|`;
        for (const key of historyCacheRef.current.keys()) {
          if (key.startsWith(groupPrefix)) historyCacheRef.current.delete(key);
        }
      }

      const pageKey = mailboxHistoryPageKey(context, targetPage);
      const cached = force ? null : historyCacheRef.current.get(pageKey);
      if (isMailboxHistorySnapshotFresh(cached)) {
        applyHistorySnapshot(context, cached);
        setHistoryLoadedOnce(true);
        setLoading(false);
        scheduleHistoryPreload(context, cached);
        void loadHistoryCounts(context, { force });
        return cached;
      }

      const contextChanged =
        Boolean(historyDisplayedContextKeyRef.current) &&
        historyDisplayedContextKeyRef.current !== contextKey;
      if (contextChanged) {
        setItems([]);
        setSelectedId(null);
      }
      if (!options?.silent || contextChanged) setLoading(true);

      const snapshot = await fetchHistoryPage({
        context,
        page: targetPage,
      });

      if (snapshot) {
        applyHistorySnapshot(context, snapshot);
        scheduleHistoryPreload(context, snapshot);
        void loadHistoryCounts(context, { force });
      } else if (activeHistoryContextKeyRef.current === contextKey) {
        // A transient API error must never erase a previously visible history or
        // replace valid counters with zeros. Keep the last known UI state and let
        // the recovery refresh retry silently.
        if (!historyLoadedOnce && !initialHistorySnapshot) {
          setHistoryPage(targetPage);
          setHistoryHasMorePotential(false);
          setHistoryTotalCount(null);
          setSelectedId(null);
        }
      }

      if (activeHistoryContextKeyRef.current === contextKey) {
        setHistoryLoadedOnce(true);
        setLoading(false);
      }
      return snapshot;
    },
    [
      activeHistoryContext,
      applyHistorySnapshot,
      fetchHistoryPage,
      historyLoadedOnce,
      initialHistorySnapshot,
      loadHistoryCounts,
      scheduleHistoryPreload,
    ],
  );

  const filteredItems = items;

  const historyPageCount = useMemo(() => {
    if (historyTotalCount == null) {
      return Math.max(1, historyPage + (historyHasMorePotential ? 1 : 0));
    }
    return Math.max(1, Math.ceil(historyTotalCount / MAILBOX_PAGE_SIZE));
  }, [historyHasMorePotential, historyPage, historyTotalCount]);

  const visibleItems = filteredItems;

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
      ? (((detailsItem as any)?.raw?.payload || null) as any)
      : null;
  }, [detailsItem]);

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
    [campaignRecipientsFilter, campaignRecipientsPage, supabase],
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
    [],
  );

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsItem ||
      detailsItem.source !== "mail_campaigns"
    ) {
      setCampaignReport(null);
      setCampaignHealth(null);
      setCampaignHealthLoading(false);
      return;
    }
    void loadCampaignHealth(detailsItem.id, (detailsItem as any).raw || {});
  }, [detailsOpen, detailsItem?.id, detailsItem?.source, loadCampaignHealth]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsItem ||
      detailsItem.source !== "mail_campaigns"
    ) {
      setCampaignRecipients([]);
      setCampaignRecipientsLoading(false);
      setCampaignRecipientsTotal(0);
      setCampaignRecipientsPageCount(1);
      return;
    }
    void loadCampaignRecipients(
      detailsItem.id,
      campaignRecipientsPage,
      campaignRecipientsFilter,
    );
  }, [
    campaignRecipientsFilter,
    campaignRecipientsPage,
    detailsOpen,
    detailsItem?.id,
    detailsItem?.source,
    loadCampaignRecipients,
  ]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsItem ||
      detailsItem.source !== "mail_campaigns"
    ) {
      setCampaignRecipientsPage(1);
      setCampaignRecipientsFilter("all");
      return;
    }
    setCampaignRecipientsPage(1);
    setCampaignRecipientsFilter("all");
  }, [detailsItem?.id, detailsItem?.source, detailsOpen]);

  useEffect(() => {
    if (campaignRecipientsPage <= campaignRecipientsPageCount) return;
    setCampaignRecipientsPage(campaignRecipientsPageCount);
  }, [campaignRecipientsPage, campaignRecipientsPageCount]);

  useEffect(() => {
    if (!detailsOpen || !detailsItem || detailsItem.source !== "mail_campaigns") return;
    const status = String(campaignReport?.status || (detailsItem as any).raw?.status || "").toLowerCase();
    if (["completed", "partial", "failed", "sent"].includes(status)) return;

    const campaignId = detailsItem.id;
    const campaignRaw = (detailsItem as any).raw || {};
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
          loadCampaignHealth(campaignId, campaignRaw),
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
    campaignReport?.status,
    detailsItem?.id,
    detailsItem?.source,
    detailsOpen,
    loadCampaignHealth,
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
  const activePublicationEditAssets =
    publicationEditImagesByChannel[activePublicationEditChannelKey]?.assets ||
    [];
  const activePublicationEditVideo =
    publicationEditVideoByChannel[activePublicationEditChannelKey] || null;

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
      hashtags: tagsToEditorString(parts.hashtags),
    });
  }, [
    detailsOpen,
    detailsItem,
    activeDetailsChannelEntry?.key,
    detailsEditMode,
  ]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsItem ||
      detailsItem.source !== "app_events" ||
      detailsEditMode
    )
      return;
    const nextState: Record<string, PublicationChannelImagesState> = {};
    for (const entry of detailsChannelEntries) {
      const channel = normalizeChannelKey(entry.key);
      const defaultTransform = buildPublicationDefaultTransform(channel);
      const assets = (
        Array.isArray(entry.parts.attachments) ? entry.parts.attachments : []
      )
        .filter(
          (att) =>
            (att?.url ||
              att?.originalUrl ||
              att?.originalPublicUrl ||
              att?.renderedUrl) &&
            isImageAttachment({
              ...att,
              url:
                att.url ||
                att.originalUrl ||
                att.originalPublicUrl ||
                att.renderedUrl,
            }),
        )
        .map((att, index) => {
          const renderedUrl = String(
            att.renderedUrl || att.url || att.publicUrl || "",
          ).trim();
          const originalUrl = String(
            att.originalUrl || att.originalPublicUrl || "",
          ).trim();
          const previewUrl = originalUrl || renderedUrl;
          const storedTransform =
            att.transform && typeof att.transform === "object"
              ? (att.transform as Partial<PublicationImageTransform>)
              : null;
          // iNrSend edition always restarts from the healthy source image when
          // the publication kept one. Never reapply a previous crop to that
          // source: the professional can create a fresh adaptation instead of
          // accumulating crops across successive edits.
          const initialTransform = originalUrl
            ? { ...defaultTransform }
            : storedTransform
              ? { ...defaultTransform, ...storedTransform }
              : { ...defaultTransform };
          return {
            key: makePublicationImageAssetKey(
              "existing",
              att.name || `image-${index + 1}`,
              `${index}:${previewUrl || renderedUrl}`,
            ),
            name: att.originalName || att.name || `Image ${index + 1}`,
            type:
              String(att.originalType || att.type || "image/jpeg") ||
              "image/jpeg",
            previewUrl,
            sourceUrl: renderedUrl || previewUrl || null,
            originalUrl: originalUrl || null,
            renderedUrl: renderedUrl || null,
            originalStoragePath: att.originalStoragePath || null,
            originalName: att.originalName || att.name || null,
            originalType: att.originalType || att.type || null,
            file: null,
            selected: channel === "pinterest" ? index === 0 : true,
            transform: initialTransform,
            savedTransform: { ...initialTransform },
            imageMeta: att.imageMeta || null,
          };
        });
      nextState[channel] = { assets };
    }
    setPublicationEditImagesByChannel(nextState);
    setPublicationImageAdapterChannelKey(null);
    setPublicationImageAdapterImageKey(null);
  }, [
    detailsOpen,
    detailsItem?.id,
    detailsChannelEntries,
    detailsEditMode,
  ]);

  useEffect(() => {
    if (
      !detailsOpen ||
      !detailsItem ||
      detailsItem.source !== "app_events" ||
      detailsEditMode
    )
      return;
    const nextState: Record<string, PublicationEditVideoState> = {};
    for (const entry of detailsChannelEntries) {
      const channel = normalizeBoosterChannelKeyForVideo(entry.key);
      const parts = (entry.parts || {}) as any;
      const videoCandidate =
        parts.video ||
        (Array.isArray(parts.attachments)
          ? parts.attachments.find((att: any) => isVideoAttachment(att))
          : null);
      const finalVideo = attachmentToVideoPayload(videoCandidate);
      if (!finalVideo) continue;
      const settings = parts.videoSettings || {};
      const sourceVideo =
        attachmentToVideoPayload(parts.sourceVideo) || finalVideo;
      const sourceMetadata =
        sourceVideo.sourceMetadata || finalVideo.sourceMetadata || null;
      const defaultFormat: VideoFormat = "original";
      const format = (settings.format ||
        parts.videoFormat ||
        defaultFormat) as VideoFormat;
      const adaptationMode = (settings.adaptationMode ||
        parts.videoAdaptationMode ||
        "safe_frame") as VideoAdaptationMode;
      const signature = buildVideoTransformSignature(
        format,
        adaptationMode,
        getVideoPublicationProfileForChannel(
          normalizeBoosterChannelKeyForVideo(channel),
        ),
      );
      const syntheticFinalVariant =
        finalVideo.publicUrl || finalVideo.url
          ? {
              key: `${channel}-${format}-${adaptationMode}-published`,
              channel,
              format,
              adaptationMode,
              signature,
              publicUrl: finalVideo.publicUrl || finalVideo.url || "",
              url: finalVideo.publicUrl || finalVideo.url || "",
              storagePath: finalVideo.storagePath || "",
              contentType: finalVideo.type || "video/mp4",
              size: finalVideo.size || 0,
              duration: finalVideo.duration || null,
              target: {
                label: getLocalizedVideoFormatLabel(
                  channel,
                  format,
                  sourceMetadata,
                  i18nT,
                ),
              },
            }
          : null;
      const storedVariants = Array.isArray(finalVideo.transformedVariants)
        ? finalVideo.transformedVariants
        : [];
      const transformedVariants = [syntheticFinalVariant, ...storedVariants]
        .filter(Boolean)
        .filter(
          (variant: any, index, arr) =>
            arr.findIndex(
              (candidate: any) =>
                String(
                  candidate?.signature ||
                    candidate?.publicUrl ||
                    candidate?.url ||
                    "",
                ) ===
                String(
                  variant?.signature ||
                    variant?.publicUrl ||
                    variant?.url ||
                    "",
                ),
            ) === index,
        ) as NonNullable<VideoPayload["transformedVariants"]>;
      nextState[channel] = {
        file: null,
        previewUrl:
          sourceVideo.publicUrl ||
          sourceVideo.url ||
          finalVideo.publicUrl ||
          finalVideo.url ||
          "",
        name: sourceVideo.name || finalVideo.name || "video-inrcy.mp4",
        type: sourceVideo.type || finalVideo.type || "video/mp4",
        size: sourceVideo.size || finalVideo.size || 0,
        duration: sourceVideo.duration || finalVideo.duration || null,
        sourceMetadata,
        sourceVideo,
        transformedVariants,
        format,
        adaptationMode,
        preparation: finalVideo.publicUrl
          ? {
              status: "ready",
              label: i18nT("format_applique_43fe4a7e"),
              detail: `${getLocalizedVideoFormatLabel(channel, format, sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(adaptationMode, i18nT)}`,
            }
          : null,
      };
    }
    setPublicationEditVideoByChannel(nextState);
  }, [
    detailsOpen,
    detailsItem?.id,
    detailsChannelEntries,
    detailsEditMode,
  ]);

  const selectedAccount = useMemo(() => {
    return mailAccounts.find((a) => a.id === selectedAccountId) || null;
  }, [mailAccounts, selectedAccountId]);

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
  }, [composeRecipientList]);

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
  }, [folder]);

  // initial
  useEffect(() => {
    if (standardMode) return;
    void loadAccounts();
    void loadSignature();
  }, [standardMode]);

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

  // refresh des changements de filtres / recherche
  useEffect(() => {
    if (!historyCacheHydrated) return;
    if (historyLoadedContextKeyRef.current === activeHistoryContextKey) return;
    const isInitialContextLoad = historyLoadedContextKeyRef.current === "";
    historyLoadedContextKeyRef.current = activeHistoryContextKey;
    void loadHistory({
      page: 1,
      silent: isInitialContextLoad && Boolean(initialHistorySnapshot),
      // The cached snapshot makes navigation instant, but it can predate a
      // publication that just finished. Always revalidate the first visible
      // context once; later tab/search changes can still reuse their cache.
      force: isInitialContextLoad,
    });
  }, [
    activeHistoryContextKey,
    historyCacheHydrated,
    initialHistorySnapshot,
    loadHistory,
  ]);

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
  }, [loadHistory, standardMode]);

  useEffect(() => {
    if (standardMode) return;
    if (!composeOpen) return;
    void loadAccounts();
  }, [composeOpen, standardMode]);

  // UX recherche: Ctrl/Cmd+K pour ouvrir, Esc pour fermer (sans perdre la saisie)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      const isK = key === "k";
      const isEsc = key === "escape" || key === "esc";

      if ((e.ctrlKey || e.metaKey) && isK) {
        e.preventDefault();
        setSearchOpen(true);
        // focus après rendu
        requestAnimationFrame(() => historySearchRef.current?.focus());
        return;
      }

      if (isEsc && searchOpen) {
        e.preventDefault();
        setSearchOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    requestAnimationFrame(() => historySearchRef.current?.focus());
  }, [searchOpen]);

  useEffect(() => {
    const handleProfileVersionChange = (event: Event) => {
      const detail = (event as CustomEvent<ProfileVersionChangeDetail>).detail;
      if (!(
        detail?.field === "inrsend_version" ||
        detail?.field === "docs_version" ||
        detail?.field === "publications_version"
      ))
        return;
      void loadHistory({ silent: true, force: true });
    };

    window.addEventListener(
      PROFILE_VERSION_EVENT,
      handleProfileVersionChange as EventListener,
    );
    return () => {
      window.removeEventListener(
        PROFILE_VERSION_EVENT,
        handleProfileVersionChange as EventListener,
      );
    };
  }, [loadHistory]);

  useEffect(() => {
    let lastRefreshAt = 0;
    let stopped = false;
    let recoveryTimer: number | null = null;

    const refreshVisibleHistory = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastRefreshAt < INRSEND_HISTORY_RECOVERY_THROTTLE_MS) return;
      lastRefreshAt = now;
      void loadHistory({ silent: true, force: true });
    };

    const scheduleRecovery = () => {
      if (stopped) return;
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null;
        refreshVisibleHistory();
        scheduleRecovery();
      }, mailboxHistoryRefreshInterval({
        context: activeHistoryContext,
        items,
      }));
    };

    scheduleRecovery();
    const handleFocus = () => refreshVisibleHistory();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshVisibleHistory();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stopped = true;
      if (recoveryTimer != null) window.clearTimeout(recoveryTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeHistoryContext, items, loadHistory]);

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
    if (q && allowed[q]) setFolder(allowed[q]);
  }, [searchParams, signatureEnabled, signaturePreview, standardMode]);

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
  }, [searchParams, signatureEnabled, signaturePreview, standardMode]);

  // Prefill compose modal from workflow modules (Booster / Propulser / Fidéliser).
  // Usage:
  // - /dashboard/mails?folder=propulsions&template_key=...&prefill_subject=...&prefill_text=...&compose=1
  // If template_key is provided, we render placeholders server-side from the user's profile/activity + connected tools.
  useEffect(() => {
    if (standardMode) return;
    const preSubjectRaw = searchParams?.get("prefill_subject") || "";
    const preTextRaw = searchParams?.get("prefill_text") || "";
    const preHtmlRaw = searchParams?.get("prefill_html") || "";
    const preAttachmentsRaw = searchParams?.get("prefill_attachments") || "";
    const preAttachmentsKey =
      searchParams?.get("prefill_attachments_key") || "";
    const templateKey = searchParams?.get("template_key") || "";
    const open = (searchParams?.get("compose") || "").toLowerCase();
    if (templateKey) setComposeTemplateKey(templateKey);

    // Optional tracking intent (sent from Booster/Fidéliser modules)
    const trackKind = (searchParams?.get("track_kind") || "").toLowerCase();
    const trackType = searchParams?.get("track_type") || "";
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
          : {};
      } catch {
        payload = {};
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
      !templateKey
    )
      return;

    const preSubject = safeDecode(preSubjectRaw);
    const preText = safeDecode(preTextRaw);
    const preHtml = safeDecode(preHtmlRaw);
    const preAttachmentsFromStorage = readWorkflowMailPrefillAttachments(
      safeDecode(preAttachmentsKey),
    );
    const preAttachments = preAttachmentsFromStorage.length
      ? preAttachmentsFromStorage
      : normalizeCampaignAttachments(safeDecode(preAttachmentsRaw));

    const run = async () => {
      // If we have a template key, ask the server to render placeholders + compute links.
      if (templateKey) {
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
  }, [searchParams, standardMode]);

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
          throw new Error(data?.error || i18nT("scheduled_mail_missing"));
        }
        const action = data.scheduledAction;
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
      } catch (error) {
        setToast(
          getClientUserFacingErrorMessage(
            error,
            i18nT("scheduled_mail_open_failed"),
          ),
        );
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

  async function loadCrmContacts() {
    if (crmLoading) return;
    setCrmError(null);
    setCrmLoading(true);

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 12000);
    try {
      // We go through the API route so the same auth method is used as the CRM screens.
      const res = await fetch("/api/crm/contacts?all=1", {
        method: "GET",
        credentials: "include",
        signal: ac.signal,
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const json = (await res.json().catch(() => ({}))) as any;
      const rows = Array.isArray(json?.contacts) ? json.contacts : [];
      const mapped = rows.map((c: any) => {
        const left = [c.first_name, c.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        const company = (c.company_name || "").trim();
        const full =
          company && left ? `${company} — ${left}` : company || left || null;
        return {
          id: String(c.id),
          full_name: full,
          email: c.email || null,
          category: (c.category as any) ?? null,
          contact_type: (c.contact_type as any) ?? null,
          postal_code: c.postal_code || null,
          city: c.city || null,
          important: Boolean(c.important),
        };
      });
      setCrmContacts(mapped);
    } catch (e: any) {
      console.error("CRM load error", e);
      const msg =
        e?.name === "AbortError"
          ? i18nT("contacts_load_timeout")
          : i18nT("contacts_load_failed");
      setCrmError(msg);
    } finally {
      clearTimeout(timeout);
      setCrmLoading(false);
    }
  }

  // load CRM when compose opens (lazy)
  useEffect(() => {
    if (!composeOpen) return;
    if (crmContacts.length > 0) return;
    void loadCrmContacts();
  }, [composeOpen]);

  function updateFolder(next: Folder) {
    if (standardMode) {
      setFolder("publications");
      setBoxView("sent");
      setSelectedId(null);
      router.replace("/dashboard/mails?folder=publications");
      return;
    }
    setFolder(next);
    // quand on change de dossier, on revient à la vue principale
    setBoxView("sent");
    router.replace(`/dashboard/mails?folder=${encodeURIComponent(next)}`);
    // reset selection to first item in that folder
    setSelectedId(null);
  }

  async function saveDraft() {
    if (attachBusy) {
      throw new Error(
        i18nT("patientez_les_pieces_jointes_sont_encore_ac136c9e"),
      );
    }
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id ? resolveActiveBrowserUserId(auth.user.id) : null;
    if (!userId) return;

    const draftFolder = getBulkCampaignFolder();
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
    };

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

    if (draftId) {
      let usedLegacyFallback = false;
      let { error } = await supabase
        .from("send_items")
        .update(draftPayload as any)
        .eq("id", draftId)
        .eq("user_id", userId);
      if (error && isMissingDraftMetadataColumn(error)) {
        ({ error } = await supabase
          .from("send_items")
          .update(legacyPayload)
          .eq("id", draftId)
          .eq("user_id", userId));
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
      await loadHistory();
      return;
    }

    let usedLegacyFallback = false;
    let { data, error } = await supabase
      .from("send_items")
      .insert(draftPayload as any)
      .select("id")
      .single();
    if (error && isMissingDraftMetadataColumn(error)) {
      ({ data, error } = await supabase
        .from("send_items")
        .insert(legacyPayload)
        .select("id")
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
        i18nT("veuillez_connecter_une_boite_d_envoi_98abd470"),
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

  async function doSend() {
    if (attachBusy) {
      setToast(i18nT("patientez_les_pieces_jointes_sont_encore_ac136c9e"));
      return;
    }
    if (!selectedAccount) {
      setToast(i18nT("veuillez_connecter_une_boite_d_envoi_98abd470"));
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
      if (!ok) return;
    }

    setSendBusy(true);
    try {
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
        ...(draftId ? { sendItemId: draftId } : {}),
        attachments: serializeComposeAttachments(composeAttachments),
        sourceDocSaveId: composeSourceDocSaveId || undefined,
        sourceDocType: composeSourceDocType || undefined,
        sourceDocNumber: composeSourceDocNumber || undefined,
      };

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

  function resetDetailsStateForItem(item: OutboxItem) {
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
  }

  function openDetails(it: OutboxItem) {
    resetDetailsStateForItem(it);
    setDetailsOpen(true);
  }

  async function navigateDetails(direction: -1 | 1) {
    if (!detailsItem || detailsNavigationBusy) return;
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
      const pageItems = Array.isArray(loaded?.items) ? loaded.items : [];
      const target = direction > 0 ? pageItems[0] : pageItems[pageItems.length - 1];
      if (target) resetDetailsStateForItem(target);
    } finally {
      setDetailsNavigationBusy(false);
    }
  }

  function updatePublicationChannelAssets(
    channel: string,
    updater: (assets: PublicationImageAsset[]) => PublicationImageAsset[],
  ) {
    const normalizedChannel = normalizeChannelKey(channel);
    setPublicationEditImagesByChannel((prev) => ({
      ...prev,
      [normalizedChannel]: {
        assets: updater(prev[normalizedChannel]?.assets || []).slice(0, 5),
      },
    }));
  }

  function togglePublicationImage(channel: string, imageKey: string) {
    const normalizedChannel = normalizeChannelKey(channel);
    updatePublicationChannelAssets(normalizedChannel, (assets) => {
      if (normalizedChannel === "pinterest") {
        const target = assets.find((asset) => asset.key === imageKey);
        if (!target) return assets;
        if (target.selected) {
          return assets.map((asset) =>
            asset.key === imageKey ? { ...asset, selected: false } : asset,
          );
        }
        return assets.map((asset) => ({
          ...asset,
          selected: asset.key === imageKey,
        }));
      }
      return assets.map((asset) =>
        asset.key === imageKey
          ? { ...asset, selected: !asset.selected }
          : asset,
      );
    });
  }

  function resetPublicationImage(channel: string, imageKey: string) {
    updatePublicationChannelAssets(channel, (assets) =>
      assets.map((asset) =>
        asset.key === imageKey
          ? {
              ...asset,
              transform: buildPublicationDefaultTransform(
                normalizeChannelKey(channel),
              ),
            }
          : asset,
      ),
    );
  }

  function movePublicationImage(
    channel: string,
    imageKey: string,
    direction: -1 | 1,
  ) {
    updatePublicationChannelAssets(channel, (assets) => {
      const selectedAssets = assets.filter((asset) => asset.selected);
      const selectedIndex = selectedAssets.findIndex(
        (asset) => asset.key === imageKey,
      );
      const targetSelected = selectedAssets[selectedIndex + direction];
      if (!targetSelected) return assets;
      const sourceIndex = assets.findIndex((asset) => asset.key === imageKey);
      const targetIndex = assets.findIndex(
        (asset) => asset.key === targetSelected.key,
      );
      if (sourceIndex < 0 || targetIndex < 0) return assets;
      const next = assets.slice();
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function openPublicationImageAdapter(channel: string, imageKey: string) {
    if (typeof document !== "undefined") {
      const detailsBody = document.querySelector<HTMLElement>(
        "[data-inrsend-details-body='true']",
      );
      publicationImageAdapterReturnScrollTopRef.current =
        detailsBody?.scrollTop ?? null;
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    setPublicationImageAdapterChannelKey(normalizeChannelKey(channel));
    setPublicationImageAdapterImageKey(imageKey);
    setDetailsActionError(null);
  }

  function closePublicationImageAdapter() {
    const scrollTopToRestore =
      publicationImageAdapterReturnScrollTopRef.current;
    setPublicationImageAdapterChannelKey(null);
    setPublicationImageAdapterImageKey(null);
    publicationImageAdapterDragRef.current = null;
    setIsPublicationImageAdapterDragging(false);

    if (typeof window !== "undefined" && scrollTopToRestore !== null) {
      window.requestAnimationFrame(() => {
        const detailsBody = document.querySelector<HTMLElement>(
          "[data-inrsend-details-body='true']",
        );
        if (detailsBody) detailsBody.scrollTop = scrollTopToRestore;
        publicationImageAdapterReturnScrollTopRef.current = null;
      });
    } else {
      publicationImageAdapterReturnScrollTopRef.current = null;
    }
  }

  function addPublicationPickedFiles(picked: File[]) {
    const channel = normalizeChannelKey(activeDetailsChannelEntry?.key || "");
    if (!channel) return;
    setDetailsActionError(null);
    if (!picked.length) return;

    const invalid = picked.find((file) => !file.type.startsWith("image/"));
    if (invalid) {
      setDetailsActionError(
        i18nT("seules_les_images_sont_acceptees_dans_d018d9b9"),
      );
      return;
    }

    const unsupported = picked.find(isUnsupportedBrowserImageFile);
    if (unsupported) {
      setDetailsActionError(
        i18nT("unsupported_browser_image", { name: unsupported.name }),
      );
      return;
    }

    const tooBig = picked.find((file) => file.size > BOOSTER_MAX_IMAGE_BYTES);
    if (tooBig) {
      setDetailsActionError(
        i18nT("l_image_value_depasse_value_1c15db6a", {
          value0: tooBig.name || i18nT("selected_file"),
          value1: BOOSTER_MAX_IMAGE_MB_LABEL,
        }),
      );
      return;
    }

    const currentSelectedFileBytes = (
      publicationEditImagesByChannel[channel]?.assets || []
    )
      .filter((asset) => asset.selected && asset.file)
      .reduce((sum, asset) => sum + (asset.file?.size || 0), 0);
    const nextPickedBytes = picked.reduce(
      (sum, file) => sum + (file?.size || 0),
      0,
    );
    if (currentSelectedFileBytes + nextPickedBytes > BOOSTER_MAX_MEDIA_BYTES) {
      setDetailsActionError(
        i18nT("les_images_depassent_value_au_total_0e09a0f4", {
          value0: BOOSTER_MAX_MEDIA_MB_LABEL,
        }),
      );
      return;
    }

    setPublicationEditVideoByChannel((prev) => {
      const videoChannel = normalizeBoosterChannelKeyForVideo(channel);
      const previousVideoState = prev[videoChannel];
      if (!previousVideoState) return prev;
      return {
        ...prev,
        [videoChannel]: {
          ...previousVideoState,
          file: null,
          previewUrl: "",
          sourceVideo: null,
          transformedVariants: [],
          removed: true,
          preparation: {
            status: "idle",
            label: i18nT("images_selectionnees_db1d99e0"),
            detail: i18nT("publication_saved_as_images"),
          },
        },
      };
    });

    updatePublicationChannelAssets(channel, (assets) => {
      const merged = [...assets];
      for (const file of picked) {
        const key = makePublicationImageAssetKey(
          "new",
          file.name,
          `${file.size}:${file.lastModified}`,
        );
        if (merged.some((asset) => asset.key === key)) continue;
        if (merged.length >= BOOSTER_MAX_IMAGE_COUNT) {
          setDetailsActionError(
            i18nT("maximum_images_per_publication", {
              count: BOOSTER_MAX_IMAGE_COUNT,
            }),
          );
          break;
        }
        merged.push({
          key,
          name: file.name,
          type: file.type || "image/jpeg",
          previewUrl: URL.createObjectURL(file),
          sourceUrl: null,
          file,
          selected:
            channel === "pinterest" ? !merged.some((asset) => asset.selected) : true,
          transform: buildPublicationDefaultTransform(channel),
        });
      }
      return merged;
    });
  }

  function addPublicationFiles(fileList: FileList | File[] | null) {
    if (!fileList) return;
    addPublicationPickedFiles(Array.from(fileList));
  }

  function addPublicationPhoto(file: File) {
    addPublicationPickedFiles([file]);
  }

  function getMediaLibraryDisplayName(item: MediaLibraryPickerItem) {
    return (
      item.title ||
      item.storage_path.split("/").pop() ||
      (item.media_type === "video" ? "video-inrcy.mp4" : "image-inrcy.jpg")
    );
  }

  async function mediaLibraryItemToFile(
    item: MediaLibraryPickerItem,
  ): Promise<File> {
    const sourceUrl = String(item.signed_url || "").trim();
    if (!sourceUrl) throw new Error(i18nT("media_unavailable_in_library"));
    const response = await fetch(sourceUrl);
    if (!response.ok)
      throw new Error(
        i18nT("media_load_failed_with_status", { status: response.status }),
      );
    const blob = await response.blob();
    const type =
      item.mime_type ||
      blob.type ||
      (item.media_type === "video" ? "video/mp4" : "image/jpeg");
    return new File([blob], getMediaLibraryDisplayName(item), {
      type,
      lastModified: Date.now(),
    });
  }

  function buildMediaLibraryVideoMetadata(
    item: MediaLibraryPickerItem,
    file: File,
  ): BoosterVideoSourceMetadata {
    const width = Number(item.width || 0) || null;
    const height = Number(item.height || 0) || null;
    const duration = Number(item.duration_seconds || 0) || null;
    const ratio = width && height ? width / height : null;
    const orientation =
      width && height
        ? width > height
          ? "horizontal"
          : width < height
            ? "vertical"
            : "square"
        : "unknown";
    return {
      width,
      height,
      duration,
      size: file.size || Number(item.size_bytes || 0) || 0,
      type: file.type || item.mime_type || "video/mp4",
      ratio,
      ratioLabel:
        width && height ? `${width}:${height}` : i18nT("ratio_inconnu_26a9214a"),
      orientation,
      orientationLabel: getLocalizedVideoOrientationLabel(orientation, i18nT),
    };
  }

  async function addPublicationMediaLibraryItems(
    items: MediaLibraryPickerItem[],
  ) {
    const channel = normalizeChannelKey(activeDetailsChannelEntry?.key || "");
    if (!channel) return;
    const selectedItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!selectedItems.length) return;

    const videos = selectedItems.filter((item) => item.media_type === "video");
    const imageItems = selectedItems.filter(
      (item) => item.media_type === "image",
    );
    if (videos.length && imageItems.length) {
      const message = i18nT("mixed_media_not_allowed");
      setDetailsActionError(message);
      throw new Error(message);
    }
    if (videos.length > 1) {
      const message = i18nT("one_video_per_publication");
      setDetailsActionError(message);
      throw new Error(message);
    }

    if (videos.length) {
      const item = videos[0];
      const file = await mediaLibraryItemToFile(item);
      if (file.size > BOOSTER_MAX_VIDEO_BYTES) {
        const message = i18nT(
          "video_trop_lourde_taille_maximale_value_358dea38",
          { value0: BOOSTER_MAX_VIDEO_MB_LABEL },
        );
        setDetailsActionError(message);
        throw new Error(message);
      }
      const previewUrl = URL.createObjectURL(file);
      const fallbackMeta = buildMediaLibraryVideoMetadata(item, file);
      const sourceMetadata =
        fallbackMeta.width || fallbackMeta.height
          ? fallbackMeta
          : await readPublicationVideoMetadata(file, previewUrl);
      const videoChannel = normalizeBoosterChannelKeyForVideo(channel);
      const defaultFormat: VideoFormat = "original";
      setDetailsActionError(null);
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [videoChannel]: {
          file,
          previewUrl,
          name: file.name || getMediaLibraryDisplayName(item),
          type: file.type || item.mime_type || "video/mp4",
          size: file.size || Number(item.size_bytes || 0) || 0,
          duration:
            sourceMetadata.duration ||
            Number(item.duration_seconds || 0) ||
            null,
          sourceMetadata,
          sourceVideo: null,
          transformedVariants: [],
          format: defaultFormat,
          adaptationMode: prev[videoChannel]?.adaptationMode || "safe_frame",
          preparation: {
            status: "idle",
            label: i18nT("video_ajoutee_depuis_la_mediatheque_880252c9"),
            detail: i18nT("apply_format_before_saving"),
          },
          preparing: false,
          removed: false,
        },
      }));
      return;
    }

    if (imageItems.length) {
      const files = await Promise.all(
        imageItems.map((item) => mediaLibraryItemToFile(item)),
      );
      const invalid = files.find((file) => !file.type.startsWith("image/"));
      if (invalid) {
        const message = i18nT("images_only_for_channel");
        setDetailsActionError(message);
        throw new Error(message);
      }
      const tooBig = files.find((file) => file.size > BOOSTER_MAX_IMAGE_BYTES);
      if (tooBig) {
        const message = i18nT("l_image_value_depasse_value_1c15db6a", {
          value0: tooBig.name || i18nT("selected_file"),
          value1: BOOSTER_MAX_IMAGE_MB_LABEL,
        });
        setDetailsActionError(message);
        throw new Error(message);
      }
      const currentSelectedFileBytes = (
        publicationEditImagesByChannel[channel]?.assets || []
      )
        .filter((asset) => asset.selected && asset.file)
        .reduce((sum, asset) => sum + (asset.file?.size || 0), 0);
      const nextPickedBytes = files.reduce(
        (sum, file) => sum + (file?.size || 0),
        0,
      );
      if (
        currentSelectedFileBytes + nextPickedBytes >
        BOOSTER_MAX_MEDIA_BYTES
      ) {
        const message = i18nT(
          "les_images_depassent_value_au_total_0e09a0f4",
          { value0: BOOSTER_MAX_MEDIA_MB_LABEL },
        );
        setDetailsActionError(message);
        throw new Error(message);
      }

      setPublicationEditVideoByChannel((prev) => {
        const videoChannel = normalizeBoosterChannelKeyForVideo(channel);
        const previousVideoState = prev[videoChannel];
        if (!previousVideoState) return prev;
        return {
          ...prev,
          [videoChannel]: {
            ...previousVideoState,
            file: null,
            previewUrl: "",
            sourceVideo: null,
            transformedVariants: [],
            removed: true,
            preparation: {
              status: "idle",
              label: i18nT("images_selectionnees_db1d99e0"),
              detail: i18nT("publication_saved_as_images"),
            },
          },
        };
      });

      updatePublicationChannelAssets(channel, (assets) => {
        const merged = [...assets];
        files.forEach((file, index) => {
          const item = imageItems[index];
          const key = makePublicationImageAssetKey(
            "library",
            file.name,
            item.id || `${item.storage_path}:${file.size}`,
          );
          if (merged.some((asset) => asset.key === key)) return;
          if (merged.length >= BOOSTER_MAX_IMAGE_COUNT) {
            setDetailsActionError(
              i18nT("maximum_images_per_publication", {
                count: BOOSTER_MAX_IMAGE_COUNT,
              }),
            );
            return;
          }
          const imageMeta =
            item.width && item.height
              ? {
                  width: item.width,
                  height: item.height,
                  ratio: item.width / item.height,
                }
              : null;
          merged.push({
            key,
            name: file.name || getMediaLibraryDisplayName(item),
            type: file.type || item.mime_type || "image/jpeg",
            previewUrl: URL.createObjectURL(file),
            sourceUrl: null,
            originalUrl: item.signed_url || null,
            originalName: getMediaLibraryDisplayName(item),
            originalType: item.mime_type || file.type || "image/jpeg",
            file,
            selected:
              channel === "pinterest"
                ? !merged.some((asset) => asset.selected)
                : true,
            transform: buildPublicationDefaultTransform(channel),
            imageMeta,
          });
        });
        return merged;
      });
      setDetailsActionError(null);
    }
  }

  async function replacePublicationMediaLibraryItem(
    item: MediaLibraryPickerItem,
  ): Promise<void> {
    const channel = normalizeChannelKey(activeDetailsChannelEntry?.key || "");
    if (!channel) {
      throw new Error(i18nT("publication_update_failed"));
    }

    const file = await mediaLibraryItemToFile(item);
    const videoChannel = normalizeBoosterChannelKeyForVideo(channel);

    if (item.media_type === "video") {
      if (file.size > BOOSTER_MAX_VIDEO_BYTES) {
        const message = i18nT(
          "video_trop_lourde_taille_maximale_value_358dea38",
          { value0: BOOSTER_MAX_VIDEO_MB_LABEL },
        );
        setDetailsActionError(message);
        throw new Error(message);
      }

      const previewUrl = URL.createObjectURL(file);
      const fallbackMeta = buildMediaLibraryVideoMetadata(item, file);
      const sourceMetadata =
        fallbackMeta.width || fallbackMeta.height
          ? fallbackMeta
          : await readPublicationVideoMetadata(file, previewUrl);

      setPublicationEditImagesByChannel((prev) => ({
        ...prev,
        [channel]: { assets: [] },
      }));
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [videoChannel]: {
          file,
          previewUrl,
          name: file.name || getMediaLibraryDisplayName(item),
          type: file.type || item.mime_type || "video/mp4",
          size: file.size || Number(item.size_bytes || 0) || 0,
          duration:
            sourceMetadata.duration ||
            Number(item.duration_seconds || 0) ||
            null,
          sourceMetadata,
          sourceVideo: null,
          transformedVariants: [],
          format: "original",
          adaptationMode: prev[videoChannel]?.adaptationMode || "safe_frame",
          preparation: {
            status: "idle",
            label: i18nT("video_ajoutee_depuis_la_mediatheque_880252c9"),
            detail: i18nT("apply_format_before_saving"),
          },
          preparing: false,
          removed: false,
        },
      }));
      setDetailsActionError(null);
      return;
    }

    if (!file.type.startsWith("image/") || isUnsupportedBrowserImageFile(file)) {
      const message = i18nT("images_only_for_channel");
      setDetailsActionError(message);
      throw new Error(message);
    }
    if (file.size > BOOSTER_MAX_IMAGE_BYTES) {
      const message = i18nT("l_image_value_depasse_value_1c15db6a", {
        value0: file.name || i18nT("selected_file"),
        value1: BOOSTER_MAX_IMAGE_MB_LABEL,
      });
      setDetailsActionError(message);
      throw new Error(message);
    }

    const key = makePublicationImageAssetKey(
      "library",
      file.name,
      item.id || `${item.storage_path}:${file.size}`,
    );
    const imageMeta =
      item.width && item.height
        ? {
            width: item.width,
            height: item.height,
            ratio: item.width / item.height,
          }
        : null;

    setPublicationEditVideoByChannel((prev) => {
      const previousVideoState = prev[videoChannel];
      return {
        ...prev,
        [videoChannel]: {
          ...(previousVideoState || {
            file: null,
            previewUrl: "",
            name: "video-inrcy.mp4",
            type: "video/mp4",
            size: 0,
            duration: null,
            sourceMetadata: null,
            sourceVideo: null,
            transformedVariants: [],
            format: "original",
            adaptationMode: "safe_frame",
          }),
          file: null,
          previewUrl: "",
          sourceVideo: null,
          transformedVariants: [],
          removed: true,
          preparation: {
            status: "idle",
            label: i18nT("images_selectionnees_db1d99e0"),
            detail: i18nT("publication_saved_as_images"),
          },
        },
      };
    });
    setPublicationEditImagesByChannel((prev) => ({
      ...prev,
      [channel]: {
        assets: [
          {
            key,
            name: file.name || getMediaLibraryDisplayName(item),
            type: file.type || item.mime_type || "image/jpeg",
            previewUrl: URL.createObjectURL(file),
            sourceUrl: null,
            originalUrl: item.signed_url || null,
            originalName: getMediaLibraryDisplayName(item),
            originalType: item.mime_type || file.type || "image/jpeg",
            file,
            selected: true,
            transform: buildPublicationDefaultTransform(channel),
            imageMeta,
          },
        ],
      },
    }));
    setDetailsActionError(null);
  }

  async function addPublicationVideo(fileList: FileList | File[] | null) {
    const channel = normalizeBoosterChannelKeyForVideo(
      activeDetailsChannelEntry?.key || "",
    );
    if (!channel || !fileList?.length) return;
    const file = Array.from(fileList).find(
      (candidate) =>
        candidate.type.startsWith("video/") ||
        /\.(mp4|m4v|mov|webm)$/i.test(candidate.name || ""),
    );
    if (!file) {
      setDetailsActionError(
        i18nT("seuls_les_fichiers_video_sont_acceptes_20063d2f"),
      );
      return;
    }
    if (file.size > BOOSTER_MAX_VIDEO_BYTES) {
      setDetailsActionError(
        i18nT("video_trop_lourde_taille_maximale_value_358dea38", {
          value0: BOOSTER_MAX_VIDEO_MB_LABEL,
        }),
      );
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const sourceMetadata = await readPublicationVideoMetadata(file, previewUrl);
    const defaultFormat: VideoFormat = "original";
    setDetailsActionError(null);
    setPublicationEditVideoByChannel((prev) => ({
      ...prev,
      [channel]: {
        file,
        previewUrl,
        name: file.name || "video-inrcy.mp4",
        type: file.type || "video/mp4",
        size: file.size || 0,
        duration: sourceMetadata.duration || null,
        sourceMetadata,
        sourceVideo: null,
        transformedVariants: [],
        format: defaultFormat,
        adaptationMode: prev[channel]?.adaptationMode || "safe_frame",
        preparation: {
          status: "idle",
          label: i18nT("nouvelle_video_ajoutee_73db7bab"),
          detail: i18nT("apply_format_before_saving"),
        },
        removed: false,
      },
    }));
  }

  function removePublicationVideo(channelValue?: string) {
    const channel = normalizeBoosterChannelKeyForVideo(
      channelValue || activeDetailsChannelEntry?.key || "",
    );
    if (!channel) return;
    setPublicationEditVideoByChannel((prev) => {
      const previousVideoState = prev[channel];
      return {
        ...prev,
        [channel]: {
          ...(previousVideoState || {
            file: null,
            previewUrl: "",
            name: "video-inrcy.mp4",
            type: "video/mp4",
            size: 0,
            duration: null,
            sourceMetadata: null,
            sourceVideo: null,
            transformedVariants: [],
            format: "original",
            adaptationMode: "safe_frame",
          }),
          file: null,
          previewUrl: "",
          sourceVideo: null,
          transformedVariants: [],
          removed: true,
          preparation: {
            status: "error",
            label: i18nT("video_supprimee_5fd3ed00"),
            detail: i18nT("ajoutez_une_nouvelle_video_avant_d_803819f5"),
          },
        },
      };
    });
  }

  function setPublicationVideoFormatForChannel(
    channelValue: string,
    format: VideoFormat,
  ) {
    const channel = normalizeBoosterChannelKeyForVideo(channelValue);
    setPublicationEditVideoByChannel((prev) => {
      const current = prev[channel];
      if (!current) return prev;
      return {
        ...prev,
        [channel]: {
          ...current,
          format,
          preparation:
            current.preparation?.status === "ready"
              ? {
                  status: "idle",
                  label: i18nT("format_modifie_a2680e9d"),
                  detail: i18nT("apply_this_format_before_saving"),
                }
              : current.preparation,
        },
      };
    });
  }

  function setPublicationVideoAdaptationModeForChannel(
    channelValue: string,
    mode: VideoAdaptationMode,
  ) {
    const channel = normalizeBoosterChannelKeyForVideo(channelValue);
    setPublicationEditVideoByChannel((prev) => {
      const current = prev[channel];
      if (!current) return prev;
      return {
        ...prev,
        [channel]: {
          ...current,
          adaptationMode: mode,
          preparation:
            current.preparation?.status === "ready"
              ? {
                  status: "idle",
                  label: i18nT("adaptation_modifiee_7c8ae175"),
                  detail: i18nT("apply_this_format_before_saving"),
                }
              : current.preparation,
        },
      };
    });
  }

  async function ensurePublicationEditVideoUploaded(
    channel: BoosterChannelKey,
    current: PublicationEditVideoState,
  ): Promise<VideoPayload> {
    if (!current.file && current.sourceVideo?.publicUrl)
      return current.sourceVideo;
    if (!current.file)
      throw new Error(i18nT("add_video_before_saving"));
    const uploaded = await uploadBoosterVideo(current.file, {
      folder: "booster-videos",
      duration: current.duration,
      sourceMetadata: current.sourceMetadata,
    });
    setPublicationEditVideoByChannel((prev) => ({
      ...prev,
      [channel]: {
        ...(prev[channel] || current),
        sourceVideo: uploaded,
        previewUrl: uploaded.publicUrl || uploaded.url || current.previewUrl,
        transformedVariants: [],
        preparation: {
          status: "idle",
          label: i18nT("video_ajoutee_ad22d54a"),
          detail: i18nT("format_can_be_applied"),
        },
      },
    }));
    return uploaded;
  }

  async function applyPublicationVideoFormatForChannel(channelValue: string) {
    const channel = normalizeBoosterChannelKeyForVideo(channelValue);
    const current = publicationEditVideoByChannel[channel];
    if (!current || current.removed || !current.previewUrl) {
      setDetailsActionError(i18nT("ajoutez_une_video_avant_d_appliquer_580c0ec6"));
      return;
    }

    const format = current.format || "original";
    const adaptationMode = current.adaptationMode || "safe_frame";
    const signature = buildVideoTransformSignature(
      format,
      adaptationMode,
      getVideoPublicationProfileForChannel(channel),
    );
    const existing = current.transformedVariants.find(
      (variant: any) => variant.signature === signature,
    );
    if (existing?.publicUrl || existing?.url) {
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [channel]: {
          ...current,
          previewUrl: existing.publicUrl || existing.url || current.previewUrl,
          preparation: {
            status: "ready",
            label: i18nT("format_applique_43fe4a7e"),
            detail: `${getLocalizedVideoFormatLabel(channel, format, current.sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(adaptationMode, i18nT)}`,
          },
        },
      }));
      return;
    }

    setDetailsActionError(null);
    setPublicationEditVideoByChannel((prev) => ({
      ...prev,
      [channel]: {
        ...current,
        preparing: true,
        preparation: {
          status: "preparing",
          label: i18nT("modification_du_format_d563b6d2"),
          detail: `${getLocalizedVideoFormatLabel(channel, format, current.sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(adaptationMode, i18nT)}`,
        },
      },
    }));

    try {
      const base = await ensurePublicationEditVideoUploaded(channel, current);
      const response = await requestBoosterVideoTransforms({
        source: {
          storagePath: base.storagePath,
          publicUrl: base.publicUrl || base.url,
          url: base.url || base.publicUrl,
          name: base.name,
          type: base.type,
          size: base.size,
          duration: base.duration,
          sourceMetadata: base.sourceMetadata || current.sourceMetadata,
        },
        variants: [
          {
            key: `${channel}-${format}-${adaptationMode}`,
            channel,
            format,
            adaptationMode,
          },
        ],
      });
      const variants = [
        ...current.transformedVariants.filter(
          (variant: any) => variant.signature !== signature,
        ),
        ...(Array.isArray(response.variants) ? response.variants : []),
      ];
      const found = variants.find(
        (variant: any) => variant.signature === signature,
      );
      if (!found?.publicUrl && !found?.url) {
        setPublicationEditVideoByChannel((prev) => ({
          ...prev,
          [channel]: {
            ...(prev[channel] || current),
            sourceVideo: base,
            transformedVariants: variants,
            previewUrl: base.publicUrl || base.url || current.previewUrl,
            file: current.file,
            preparing: false,
            preparation: {
              status: "ready",
              label: i18nT("video_originale_conservee_84fd0d77"),
              detail: i18nT(
                "adaptation_automatique_indisponible_la_video_ori_c770d639",
              ),
            },
          },
        }));
        setDetailsActionError(
          i18nT("adaptation_automatique_indisponible_la_video_ori_c770d639"),
        );
        return;
      }
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [channel]: {
          ...(prev[channel] || current),
          sourceVideo: base,
          transformedVariants: variants,
          previewUrl: found.publicUrl || found.url || current.previewUrl,
          file: current.file,
          preparing: false,
          preparation: {
            status: "ready",
            label: i18nT("format_applique_43fe4a7e"),
            detail: `${getLocalizedVideoFormatLabel(channel, format, current.sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(adaptationMode, i18nT)}`,
          },
        },
      }));
    } catch (error: any) {
      const fallbackDetail = i18nT(
        "adaptation_automatique_indisponible_la_video_ori_c770d639",
      );
      setDetailsActionError(fallbackDetail);
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [channel]: {
          ...(prev[channel] || current),
          preparing: false,
          preparation: {
            status: "ready",
            label: i18nT("video_originale_conservee_84fd0d77"),
            detail: fallbackDetail,
          },
        },
      }));
    }
  }

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

    setDetailsActionBusy(true);
    setDetailsActionError(null);
    setDetailsActionSuccess(null);
    try {
      const hashtags = publicationEditForm.hashtags
        .split(/[;,\n\s]+/)
        .map((tag) => tag.trim().replace(/^#+/, ""))
        .filter(Boolean);

      const normalizedChannel = normalizeChannelKey(channel);
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
            imageMeta:
              publicationImageAdapterImageMeta[asset.key] ||
              asset.imageMeta ||
              null,
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
          imageMeta:
            publicationImageAdapterImageMeta[asset.key] ||
            asset.imageMeta ||
            null,
        } as any);
      }

      const res = await fetch(
        `/api/inrsend/publications/${encodeURIComponent(publicationId)}/${encodeURIComponent(channelApiPath(channel))}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: publicationEditForm.title,
            content: publicationEditForm.content,
            cta: publicationEditForm.cta,
            ctaMode: publicationEditForm.ctaMode,
            ctaUrl: publicationEditForm.ctaUrl,
            ctaPhone: publicationEditForm.ctaPhone,
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
      if (!res.ok) {
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
        i18nT("publication_value_supprimee_3fa97962", { value0: label }),
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
      const nextType = (
        raw.type === "facture" || raw.type === "devis" ? raw.type : "mail"
      ) as SendType;
      const nextTrack =
        raw.track_kind && raw.track_type
          ? ({
              kind: raw.track_kind,
              type: raw.track_type,
              payload: {},
            } as PendingTrack)
          : inferTrackFromCampaign(it);
      const nextAttachments = normalizeCampaignAttachments(raw.attachments);
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
      setTo(raw.to_emails || "");
      setSubject(normalizeMailSubject(raw.subject || ""));
      setComposeBody(raw.body_text || "", raw.body_html || "");
      setComposeAttachments(nextAttachments);
      setFiles([]);
      setLastSavedComposeSnapshot(
        makeComposeSnapshot({
          selectedAccountId: String(
            raw.integration_id || selectedAccountId || "",
          ),
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
    saveWorkflowCampaignState(
      {
        kind: workflowFinalizerKind,
        action: workflowReturnAction,
        folder,
        trackKind: workflowFinalizerKind,
        trackType,
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
    composeTemplateKey,
    draftId,
    folder,
    html,
    pendingTrack,
    router,
    searchParams,
    subject,
    text,
    workflowFinalizerKind,
    workflowReturnAction,
    workflowReturnKey,
  ]);

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
          helpOpen={helpOpen}
          settingsOpen={settingsOpen}
          onOpenHelp={() => setHelpOpen(true)}
          onCloseHelp={() => setHelpOpen(false)}
          onOpenFolders={() => setMobileFoldersOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onCloseSettings={() => {
            setSettingsOpen(false);
            void loadSignature(selectedAccountId || undefined);
          }}
        />

        {!standardMode ? (
          <MobileFoldersMenu
            open={mobileFoldersOpen}
            folder={folder}
            counts={counts}
            countsLoading={!historyCountsLoadedOnce}
            onClose={() => setMobileFoldersOpen(false)}
            onSelectFolder={updateFolder}
          />
        ) : null}

        <div className={styles.grid}>
          <div className={`${styles.card} ${styles.listCard}`}>
            {!standardMode ? (
              <FolderTabs
                folder={folder}
                counts={counts}
                countsLoading={!historyCountsLoadedOnce}
                onSelectFolder={updateFolder}
              />
            ) : null}

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
              setBoxView={setBoxView}
              draftCount={currentFolderDraftCount}
            />

            <MailboxSearchPanel
              open={searchOpen}
              value={historyQuery}
              inputRef={historySearchRef}
              onChange={setHistoryQuery}
              onClose={() => setSearchOpen(false)}
              onClear={() => {
                setHistoryQuery("");
                requestAnimationFrame(() => historySearchRef.current?.focus());
              }}
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
          </div>
        </div>

        <MailboxDetailsModal
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
          setPublicationVideoFormatForChannel={
            setPublicationVideoFormatForChannel
          }
          setPublicationVideoAdaptationModeForChannel={
            setPublicationVideoAdaptationModeForChannel
          }
          applyPublicationVideoFormatForChannel={
            applyPublicationVideoFormatForChannel
          }
          togglePublicationImage={togglePublicationImage}
          openPublicationImageAdapter={openPublicationImageAdapter}
          resetPublicationImage={resetPublicationImage}
          movePublicationImage={movePublicationImage}
          addPublicationFiles={addPublicationFiles}
          addPublicationPhoto={addPublicationPhoto}
          addPublicationMediaLibraryItems={addPublicationMediaLibraryItems}
          replacePublicationMediaLibraryItem={replacePublicationMediaLibraryItem}
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

        <MailboxPublicationImageAdapterModal
          open={detailsOpen}
          detailsEditMode={detailsEditMode}
          publicationImageAdapterAsset={publicationImageAdapterAsset}
          publicationImageAdapterChannelKey={publicationImageAdapterChannelKey}
          publicationImageAdapterStageRef={publicationImageAdapterStageRef}
          publicationImageAdapterStageSize={publicationImageAdapterStageSize}
          publicationImageAdapterImageMeta={publicationImageAdapterImageMeta}
          isPublicationImageAdapterDragging={isPublicationImageAdapterDragging}
          publicationEditImagesByChannel={publicationEditImagesByChannel}
          setPublicationImageAdapterImageKey={
            setPublicationImageAdapterImageKey
          }
          publicationImageAdapterDragRef={publicationImageAdapterDragRef}
          setIsPublicationImageAdapterDragging={
            setIsPublicationImageAdapterDragging
          }
          updatePublicationChannelAssets={updatePublicationChannelAssets}
          closePublicationImageAdapter={closePublicationImageAdapter}
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
    </div>
  );
}
