import type { BoosterCtaMode } from "../../booster/publier/publishModal.shared";
import type {
  InrAgentFrequency,
  InrAgentPreferredMediaSource,
  InrAgentPlanningHorizonDays,
  InrAgentSettings,
  InrAgentValidationMode,
} from "@/lib/inrAgentSettings";
import type {
  InrAgentActionStatus,
  InrAgentActionType,
  InrAgentTargetTool,
} from "@/lib/inrAgentActions";

export type AutomationKey = "publish" | "grow" | "loyalty" | "stats";

export type ChannelKey =
  | "siteInrcy"
  | "siteWeb"
  | "inrSearch"
  | "gmb"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "pinterest"
  | "mails";

export type PublishMediaMutation = "append" | "replace" | "remove";

export type Automation = {
  key: AutomationKey;
  title: string;
  shortTitle: string;
  iconLabel: string;
  settingsTitle: string;
  availableThemes: string[];
  availableChannels: ChannelKey[];
};

export type AutomationConfig = {
  enabled: boolean;
  frequency: string;
  day: string;
  time: string;
  scheduleSlots: Array<{ day: string; time: string }>;
  monthDays: number[];
  channels: ChannelKey[];
  themes: string[];
  validation: string;
  source: string;
  signatureAutomatic: boolean;
  preferredMediaSource: InrAgentPreferredMediaSource;
  planningHorizonDays: InrAgentPlanningHorizonDays;
};

export type EditorialPlanApplyMode = "now" | "next_cycle";

export type EditorialPlanQuotaImpact = {
  affectedPublications: number;
  generatedPublications: number;
  lostImages: number;
  lostVideos: number;
  requiredImages: number;
  requiredVideos: number;
  availableImages: number | null;
  availableVideos: number | null;
  quotaSufficient: boolean;
  quotaAvailable: boolean;
  protectedUntil: string | null;
  horizonDays: 7 | 15 | 30;
};

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

export type AutomationSettingsOptions = {
  frequency: SelectOption<InrAgentFrequency>[];
  validation: SelectOption<InrAgentValidationMode>[];
};

export type LoadState = "idle" | "loading" | "ready" | "error";

export type SaveState = "idle" | "saving" | "saved" | "error";

export type ActionsLoadState = "idle" | "loading" | "ready" | "error";

export type ActionMutationState = "idle" | "saving";

export type ActionMutationIntent = "validated" | "refused" | null;

export type PrepareActionState = "idle" | "saving";

export type StatsProgressState = { label: string; percent: number } | null;

export type PrepareProgressState = {
  key: Exclude<AutomationKey, "stats">;
  label: string;
  percent: number;
} | null;

export type PrepareNowConfirmState = {
  key: Extract<AutomationKey, "grow" | "loyalty">;
  label: string;
  pendingCount: number;
} | null;

export type AgentPublishExecutionProgressState = {
  progress: number;
  label: string;
} | null;

export type AgentCampaignLaunchNotice = {
  queued: number;
  folder: "propulsions" | "fidelisations" | "mails";
  title: string;
  details: string;
} | null;

export type AgentImageAsset = {
  url?: string;
  src?: string;
  publicUrl?: string;
  renderedUrl?: string;
  originalUrl?: string;
  originalPublicUrl?: string;
  path?: string;
  alt?: string;
  title?: string;
  name?: string;
  type?: string;
  mimeType?: string;
  mime_type?: string;
};

export type AgentPreparedAction = {
  id: string;
  automationKey: AutomationKey | null;
  actionType: InrAgentActionType;
  targetTool: InrAgentTargetTool;
  title: string;
  summary: string;
  previewText: string;
  targetChannels: string[];
  targetThemes: string[];
  recipients: unknown[];
  imageAssets: unknown[];
  payload: Record<string, unknown>;
  validationRequired: boolean;
  executionPolicy: string;
  status: InrAgentActionStatus;
  scheduledFor: string | null;
  preparedAt: string | null;
  validatedAt?: string | null;
  refusedAt?: string | null;
  completedAt?: string | null;
  createdAt: string | null;
  updatedAt?: string | null;
};

export type AgentReportDocument = {
  bucket?: string;
  storagePath?: string;
  filename?: string;
  mimeType?: string;
  bytes?: number;
  createdAt?: string;
  downloadUrl?: string;
};

export type AgentStatsReport = {
  id: string;
  title: string;
  summary: string;
  recommendations: string[];
  createdAt: string | null;
  completedAt?: string | null;
  document: AgentReportDocument;
  runMode: "automatic" | "manual";
};

export type AgentChannelPreview = {
  title: string;
  body: string;
  cta: string;
  ctaMode: BoosterCtaMode;
  ctaUrl: string;
  ctaPhone: string;
  hashtags: string[];
};

export type AgentPublishMediaItem = {
  record: Record<string, unknown>;
  name: string;
  url: string;
  kind: "image" | "video" | "file";
};

export type AgentPublishMediaPreview = {
  name: string;
  typeLabel: string;
  statusLabel: string;
  statusTone: "ready" | "blocked" | "warning" | "neutral";
  url: string;
  kind: "image" | "video" | "file" | "none";
  note: string;
  items: AgentPublishMediaItem[];
  count: number;
  activeIndex: number;
};

export type AgentMediaAdaptationPreview = {
  strategy: string;
  mediaType: "image" | "video" | "none" | "file";
  note: string;
  userEditable: boolean;
};

export type AgentMediaLibraryItem = {
  id: string;
  bucket_name: string | null;
  storage_path: string;
  media_type: "image" | "video";
  mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  signed_url: string | null;
};

export type CampaignAttachmentPreview = {
  bucket?: string;
  path?: string;
  name: string;
  type: string;
  size: string;
  url: string;
};

export type CampaignAttachmentRef = {
  bucket: string;
  path: string;
  name: string;
  type?: string | null;
  size?: number | null;
};

export type CampaignRecipientPreview = {
  contact_id?: string | null;
  contactId?: string | null;
  id?: string | null;
  display_name?: string | null;
  displayName?: string | null;
  name?: string | null;
  email: string;
  phone?: string | null;
  contact_type?: string | null;
  contactType?: string | null;
  category?: string | null;
  company_name?: string | null;
  companyName?: string | null;
  city?: string | null;
  postal_code?: string | null;
  postalCode?: string | null;
  manual?: boolean | null;
};

export type CrmContactForAgent = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  category?: string | null;
  contact_type?: string | null;
  postal_code?: string | null;
  city?: string | null;
  important?: boolean | null;
};

export type AgentMailAccount = {
  id: string;
  provider?: string | null;
  status?: string | null;
  connection_status?: string | null;
  requires_update?: boolean | null;
  display_name?: string | null;
  email_address?: string | null;
  account_email?: string | null;
  email?: string | null;
  resource_label?: string | null;
  label?: string | null;
};

export type CampaignMailPreview = {
  subject: string;
  body: string;
  paragraphs: string[];
  mission: string;
  recipientsCount: number;
  mailAccountLabel: string;
  mailAccountProvider: string;
  attachment: CampaignAttachmentPreview | null;
};

export type AgentActionsResponse = {
  actions?: AgentPreparedAction[];
  tableMissing?: boolean;
  error?: string;
};

export type AgentScheduledAction = {
  id: string;
  automationKey: AutomationKey | null;
  actionType: string;
  targetTool: string;
  source: "manual" | "automatic";
  title: string;
  summary: string;
  scheduledAt: string | null;
  timezone: string;
  channels: string[];
  payload: Record<string, unknown>;
  status: "scheduled" | "running" | "done" | "failed" | "cancelled";
  attemptCount: number;
  lastError: string | null;
  executedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ScheduledActionEditSession = {
  scheduledAction: AgentScheduledAction;
  action: AgentPreparedAction;
  previousSelectedKey: AutomationKey;
  baselineSignature: string;
  dirty: boolean;
};

export type ScheduleOnlyEditState = {
  actionId: string;
  label: string;
  scheduledAtIso: string | null;
  source: "manual" | "editorial";
};

export type AutomationScheduleEditState = {
  key: AutomationKey;
  label: string;
  scheduledAtIso: string | null;
};

export type AgentConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "warning" | "danger";
  onConfirm: () => void | Promise<void>;
} | null;

export type ScheduledActionsResponse = {
  scheduledActions?: AgentScheduledAction[];
  tableMissing?: boolean;
  error?: string;
};

export type ScheduleListItem = {
  id: string;
  action: string;
  date: string;
  time: string;
  typeLabel: string;
  channelLabel: string;
  channelLabels: string[];
  originLabel: string;
  status: string;
  statusKey?: string;
  automationKey?: AutomationKey | null;
  scheduledActionId?: string | null;
  preparedActionId?: string | null;
  scheduledAtIso?: string | null;
  contentReady?: boolean;
  editable: boolean;
  removable: boolean;
  source: "automatic" | "manual" | "editorial";
};

export type ConnectedChannelMap = Partial<Record<ChannelKey, boolean>>;

export type CachedAgentViewSnapshot = {
  version: 1;
  savedAt: number;
  settings?: InrAgentSettings;
  connectedChannels?: ConnectedChannelMap;
  actions?: AgentPreparedAction[];
  scheduledActions?: AgentScheduledAction[];
  tableMissing?: boolean;
  scheduledActionsTableMissing?: boolean;
};

export type HeaderToolLink = {
  label: string;
  compactLabel: string;
  href: string;
  logoSrc?: string;
};
