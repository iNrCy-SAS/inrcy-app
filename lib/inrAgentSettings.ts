export const INR_AGENT_AUTOMATION_KEYS = ["publish", "grow", "loyalty", "stats"] as const;
export const INR_AGENT_FREQUENCIES = ["weekly", "twice_weekly", "biweekly", "monthly", "quarterly", "one_off"] as const;
export const INR_AGENT_VALIDATION_MODES = ["validation_required", "draft_only", "notify_before_validation", "automatic_report"] as const;
export const INR_AGENT_GOALS = ["visibility", "acquisition", "loyalty", "stats"] as const;
export const INR_AGENT_TONES = ["professional", "friendly", "premium", "local", "dynamic"] as const;
export const INR_AGENT_CHANNELS = ["site_inrcy", "site_web", "gmb", "inr_search", "facebook", "instagram", "linkedin", "tiktok", "youtube", "pinterest", "mails"] as const;
export const INR_AGENT_THEMES = [
  "conseils",
  "realisations",
  "offres",
  "actualites",
  "valoriser",
  "recolter",
  "offrir",
  "informer",
  "enqueter",
  "suivre",
  "vue_globale",
  "inrbadge",
  "mails",
  "site_inrcy",
  "site_web",
  "gmb",
  "inr_search",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
] as const;
export const INR_AGENT_RECIPIENT_SCOPES = ["none", "all_crm", "clients", "prospects", "recent_contacts", "inactive_contacts", "manual_selection"] as const;
export const INR_AGENT_SOURCE_STRATEGIES = ["published_history", "templates", "stats_snapshot", "mixed"] as const;
export const INR_AGENT_PREFERRED_MEDIA_SOURCES = [
  "media_library",
  "image_bank",
  "ai_generation",
] as const;

export type InrAgentAutomationKey = (typeof INR_AGENT_AUTOMATION_KEYS)[number];
export type InrAgentFrequency = (typeof INR_AGENT_FREQUENCIES)[number];
export type InrAgentValidationMode = (typeof INR_AGENT_VALIDATION_MODES)[number];
export type InrAgentGoal = (typeof INR_AGENT_GOALS)[number];
export type InrAgentTone = (typeof INR_AGENT_TONES)[number];
export type InrAgentChannel = (typeof INR_AGENT_CHANNELS)[number];
export type InrAgentTheme = (typeof INR_AGENT_THEMES)[number];
export type InrAgentRecipientScope = (typeof INR_AGENT_RECIPIENT_SCOPES)[number];
export type InrAgentSourceStrategy = (typeof INR_AGENT_SOURCE_STRATEGIES)[number];
export type InrAgentPreferredMediaSource =
  (typeof INR_AGENT_PREFERRED_MEDIA_SOURCES)[number];

// Compat anciens composants / ancien vocabulaire V1.
export const INR_AGENT_MODES = INR_AGENT_VALIDATION_MODES;
export const INR_AGENT_ACTIONS = ["publication", "mailing", "review_request", "loyalty"] as const;
export type InrAgentMode = InrAgentValidationMode;
export type InrAgentAction = (typeof INR_AGENT_ACTIONS)[number];

export type InrAgentAutomationSettings = {
  enabled: boolean;
  frequency: InrAgentFrequency;
  dayOfWeek: number;
  time: string;
  validationMode: InrAgentValidationMode;
  allowedChannels: InrAgentChannel[];
  allowedThemes: InrAgentTheme[];
  useImageBank: boolean;
  imageRequired: boolean;
  preferredMediaSource: InrAgentPreferredMediaSource;
  recipientScope: InrAgentRecipientScope;
  sourceStrategy: InrAgentSourceStrategy;
  lastPreparedAt: string | null;
  lastExecutedAt: string | null;
  nextRunAt: string | null;
  metadata: Record<string, unknown>;
};

export type InrAgentSettings = {
  globalEnabled: boolean;
  tone: InrAgentTone;
  timezone: string;
  automations: Record<InrAgentAutomationKey, InrAgentAutomationSettings>;

  // Champs de compatibilité V1 utilisés par l'ancien panneau Réglages.
  enabled: boolean;
  frequency: InrAgentFrequency;
  dayOfWeek: number;
  time: string;
  mode: InrAgentMode;
  goal: InrAgentGoal;
  allowedActions: InrAgentAction[];
  allowedChannels: InrAgentChannel[];
  useMediaLibrary: boolean;
  allowAiImages: boolean;
};

const DEFAULT_AUTOMATIONS: Record<InrAgentAutomationKey, InrAgentAutomationSettings> = {
  publish: {
    enabled: true,
    frequency: "weekly",
    dayOfWeek: 1,
    time: "09:00",
    validationMode: "validation_required",
    allowedChannels: ["site_inrcy", "site_web", "gmb", "inr_search", "facebook", "instagram", "linkedin", "tiktok", "youtube", "pinterest"],
    allowedThemes: ["conseils", "realisations", "offres", "actualites"],
    useImageBank: true,
    imageRequired: true,
    preferredMediaSource: "media_library",
    recipientScope: "none",
    sourceStrategy: "published_history",
    lastPreparedAt: null,
    lastExecutedAt: null,
    nextRunAt: null,
    metadata: {},
  },
  grow: {
    enabled: false,
    frequency: "biweekly",
    dayOfWeek: 3,
    time: "10:00",
    validationMode: "validation_required",
    allowedChannels: ["mails"],
    allowedThemes: ["valoriser", "recolter", "offrir"],
    useImageBank: true,
    imageRequired: false,
    preferredMediaSource: "media_library",
    recipientScope: "all_crm",
    sourceStrategy: "templates",
    lastPreparedAt: null,
    lastExecutedAt: null,
    nextRunAt: null,
    metadata: {},
  },
  loyalty: {
    enabled: false,
    frequency: "monthly",
    dayOfWeek: 5,
    time: "09:30",
    validationMode: "validation_required",
    allowedChannels: ["mails"],
    allowedThemes: ["informer", "enqueter", "suivre"],
    useImageBank: true,
    imageRequired: false,
    preferredMediaSource: "media_library",
    recipientScope: "clients",
    sourceStrategy: "templates",
    lastPreparedAt: null,
    lastExecutedAt: null,
    nextRunAt: null,
    metadata: {},
  },
  stats: {
    enabled: false,
    frequency: "weekly",
    dayOfWeek: 1,
    time: "08:30",
    validationMode: "automatic_report",
    allowedChannels: [],
    allowedThemes: ["vue_globale", "site_inrcy", "site_web", "gmb", "inr_search", "facebook", "instagram", "linkedin", "tiktok", "youtube", "pinterest", "mails", "inrbadge"],
    useImageBank: false,
    imageRequired: false,
    preferredMediaSource: "media_library",
    recipientScope: "none",
    sourceStrategy: "stats_snapshot",
    lastPreparedAt: null,
    lastExecutedAt: null,
    nextRunAt: null,
    metadata: {},
  },
};

export const INR_AGENT_DEFAULT_SETTINGS: InrAgentSettings = {
  globalEnabled: false,
  tone: "professional",
  timezone: "Europe/Paris",
  automations: DEFAULT_AUTOMATIONS,

  enabled: false,
  frequency: "weekly",
  dayOfWeek: 1,
  time: "09:00",
  mode: "validation_required",
  goal: "visibility",
  allowedActions: ["publication", "mailing", "review_request", "loyalty"],
  allowedChannels: ["site_inrcy", "site_web", "gmb", "inr_search", "facebook", "instagram", "linkedin", "tiktok", "youtube", "pinterest", "mails"],
  useMediaLibrary: true,
  allowAiImages: false,
};

export const INR_AGENT_LABELS = {
  automations: {
    publish: "Publier",
    grow: "Propulser",
    loyalty: "Fidéliser",
    stats: "Statistiques",
  } satisfies Record<InrAgentAutomationKey, string>,
  frequencies: {
    weekly: "1 fois / semaine",
    twice_weekly: "2 fois / semaine",
    biweekly: "2 fois / mois",
    monthly: "1 fois / mois",
    quarterly: "1 fois / trimestre",
    one_off: "Ponctuel",
  } satisfies Record<InrAgentFrequency, string>,
  modes: {
    validation_required: "Validation obligatoire",
    draft_only: "Brouillon uniquement",
    notify_before_validation: "Notification avant validation",
    automatic_report: "Automatique pour les bilans",
  } satisfies Record<InrAgentMode, string>,
  validationModes: {
    validation_required: "Validation obligatoire",
    draft_only: "Brouillon uniquement",
    notify_before_validation: "Notification avant validation",
    automatic_report: "Automatique pour les bilans",
  } satisfies Record<InrAgentValidationMode, string>,
  goals: {
    visibility: "Visibilité",
    acquisition: "Acquisition",
    loyalty: "Fidélisation",
    stats: "Statistiques",
  } satisfies Record<InrAgentGoal, string>,
  tones: {
    professional: "Professionnel",
    friendly: "Accessible",
    premium: "Premium",
    local: "Local",
    dynamic: "Dynamique",
  } satisfies Record<InrAgentTone, string>,
  actions: {
    publication: "Publications",
    mailing: "Campagnes mails",
    review_request: "Demandes d'avis",
    loyalty: "Fidélisation",
  } satisfies Record<InrAgentAction, string>,
  channels: {
    site_inrcy: "Site iNrCy",
    site_web: "Site Web",
    gmb: "Google Business",
    inr_search: "iNr'Search",
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    tiktok: "TikTok",
    youtube: "YouTube",
    pinterest: "Pinterest",
    mails: "Mails",
  } satisfies Record<InrAgentChannel, string>,
  themes: {
    conseils: "Conseils",
    realisations: "Réalisations",
    offres: "Offres",
    actualites: "Actualités",
    valoriser: "Valoriser",
    recolter: "Récolter",
    offrir: "Offrir",
    informer: "Informer",
    enqueter: "Enquêter",
    suivre: "Suivre",
    vue_globale: "Vue globale",
    inrbadge: "iNrBadge",
    mails: "Mails",
    site_inrcy: "Site iNrCy",
    site_web: "Site Web",
    gmb: "Google Business",
    inr_search: "iNr'Search",
    facebook: "Facebook",
    instagram: "Instagram",
    linkedin: "LinkedIn",
    tiktok: "TikTok",
    youtube: "YouTube",
    pinterest: "Pinterest",
  } satisfies Record<InrAgentTheme, string>,
  recipientScopes: {
    none: "Aucun destinataire",
    all_crm: "Tout le CRM",
    clients: "Clients",
    prospects: "Prospects",
    recent_contacts: "Contacts récents",
    inactive_contacts: "Contacts inactifs",
    manual_selection: "Sélection manuelle",
  } satisfies Record<InrAgentRecipientScope, string>,
};

export const INR_AGENT_DAYS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 0, label: "Dimanche" },
] as const;

function includesValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function cloneDefaults(): InrAgentSettings {
  return {
    ...INR_AGENT_DEFAULT_SETTINGS,
    automations: Object.fromEntries(
      INR_AGENT_AUTOMATION_KEYS.map((key) => [key, { ...DEFAULT_AUTOMATIONS[key], metadata: { ...DEFAULT_AUTOMATIONS[key].metadata } }]),
    ) as Record<InrAgentAutomationKey, InrAgentAutomationSettings>,
    allowedActions: [...INR_AGENT_DEFAULT_SETTINGS.allowedActions],
    allowedChannels: [...INR_AGENT_DEFAULT_SETTINGS.allowedChannels],
  };
}

function sanitizeStringArray<T extends readonly string[]>(values: T, input: unknown, fallback: T[number][]): T[number][] {
  if (!Array.isArray(input)) return [...fallback];
  const sanitized = input.filter((value): value is T[number] => includesValue(values, value));
  return sanitized.length > 0 ? Array.from(new Set(sanitized)) : [...fallback];
}

function sanitizeMaybeEmptyStringArray<T extends readonly string[]>(values: T, input: unknown, fallback: T[number][]): T[number][] {
  if (!Array.isArray(input)) return [...fallback];
  return Array.from(new Set(input.filter((value): value is T[number] => includesValue(values, value))));
}

function sanitizeTime(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function sanitizeDay(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  return rounded >= 0 && rounded <= 6 ? rounded : fallback;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

const INR_SEARCH_PUBLISH_MIGRATION_FLAG = "inrSearchChannelAdded";
export const INR_AGENT_PINTEREST_PUBLISH_MIGRATION_FLAG = "pinterestChannelAdded";

export function sanitizeInrAgentAutomationSettings(
  key: InrAgentAutomationKey,
  input: Partial<InrAgentAutomationSettings> | null | undefined,
): InrAgentAutomationSettings {
  const defaults = DEFAULT_AUTOMATIONS[key];
  const source = input ?? {};
  const allowedChannels = sanitizeMaybeEmptyStringArray(
    INR_AGENT_CHANNELS,
    source.allowedChannels,
    defaults.allowedChannels,
  );
  const metadata = sanitizeMetadata(source.metadata);
  const shouldMigratePublishChannels =
    key === "publish" &&
    Array.isArray(source.allowedChannels) &&
    allowedChannels.length > 0 &&
    !allowedChannels.includes("inr_search") &&
    metadata[INR_SEARCH_PUBLISH_MIGRATION_FLAG] !== true;
  const normalizedAllowedChannels: InrAgentChannel[] = [...allowedChannels];
  if (shouldMigratePublishChannels) normalizedAllowedChannels.push("inr_search");
  const preferredMediaSourceInput =
    source.preferredMediaSource ?? metadata.preferredMediaSource;
  const preferredMediaSource = includesValue(
    INR_AGENT_PREFERRED_MEDIA_SOURCES,
    preferredMediaSourceInput,
  )
    ? preferredMediaSourceInput
    : defaults.preferredMediaSource;
  const normalizedMetadataBase = shouldMigratePublishChannels
    ? { ...metadata, [INR_SEARCH_PUBLISH_MIGRATION_FLAG]: true }
    : metadata;
  const normalizedMetadata = {
    ...normalizedMetadataBase,
    preferredMediaSource,
  };

  return {
    enabled: sanitizeBoolean(source.enabled, defaults.enabled),
    frequency: includesValue(INR_AGENT_FREQUENCIES, source.frequency) ? source.frequency : defaults.frequency,
    dayOfWeek: sanitizeDay(source.dayOfWeek, defaults.dayOfWeek),
    time: sanitizeTime(source.time, defaults.time),
    validationMode: includesValue(INR_AGENT_VALIDATION_MODES, source.validationMode) ? source.validationMode : defaults.validationMode,
    allowedChannels: normalizedAllowedChannels,
    allowedThemes: sanitizeMaybeEmptyStringArray(INR_AGENT_THEMES, source.allowedThemes, defaults.allowedThemes),
    useImageBank: sanitizeBoolean(source.useImageBank, defaults.useImageBank),
    imageRequired: sanitizeBoolean(source.imageRequired, defaults.imageRequired),
    preferredMediaSource,
    recipientScope: includesValue(INR_AGENT_RECIPIENT_SCOPES, source.recipientScope) ? source.recipientScope : defaults.recipientScope,
    sourceStrategy: includesValue(INR_AGENT_SOURCE_STRATEGIES, source.sourceStrategy) ? source.sourceStrategy : defaults.sourceStrategy,
    lastPreparedAt: sanitizeNullableString(source.lastPreparedAt) ?? defaults.lastPreparedAt,
    lastExecutedAt: sanitizeNullableString(source.lastExecutedAt) ?? defaults.lastExecutedAt,
    nextRunAt: sanitizeNullableString(source.nextRunAt) ?? defaults.nextRunAt,
    metadata: normalizedMetadata,
  };
}

export function sanitizeInrAgentSettings(input: Partial<InrAgentSettings> | null | undefined): InrAgentSettings {
  const defaults = cloneDefaults();
  const source = input ?? {};
  const legacyEnabled = sanitizeBoolean(source.enabled, defaults.enabled);
  const globalEnabled = sanitizeBoolean(source.globalEnabled, legacyEnabled);
  const legacyFrequency = includesValue(INR_AGENT_FREQUENCIES, source.frequency) ? source.frequency : defaults.frequency;
  const legacyDay = sanitizeDay(source.dayOfWeek, defaults.dayOfWeek);
  const legacyTime = sanitizeTime(source.time, defaults.time);
  const legacyMode = includesValue(INR_AGENT_VALIDATION_MODES, source.mode) ? source.mode : defaults.mode;
  const useMediaLibrary = sanitizeBoolean(source.useMediaLibrary, defaults.useMediaLibrary);

  const sourceAutomations = source.automations && typeof source.automations === "object" ? source.automations : {};
  const automations = Object.fromEntries(
    INR_AGENT_AUTOMATION_KEYS.map((key) => {
      const rawAutomation = (sourceAutomations as Partial<Record<InrAgentAutomationKey, Partial<InrAgentAutomationSettings>>>)[key];
      const fallbackFromLegacy = key === "publish" && !rawAutomation
        ? {
            enabled: legacyEnabled,
            frequency: legacyFrequency,
            dayOfWeek: legacyDay,
            time: legacyTime,
            validationMode: legacyMode,
            allowedChannels: sanitizeStringArray(INR_AGENT_CHANNELS, source.allowedChannels, defaults.allowedChannels),
            useImageBank: useMediaLibrary,
          }
        : rawAutomation;
      return [key, sanitizeInrAgentAutomationSettings(key, fallbackFromLegacy)];
    }),
  ) as Record<InrAgentAutomationKey, InrAgentAutomationSettings>;

  return {
    globalEnabled,
    tone: includesValue(INR_AGENT_TONES, source.tone) ? source.tone : defaults.tone,
    timezone: typeof source.timezone === "string" && source.timezone.trim().length > 0 ? source.timezone : defaults.timezone,
    automations,

    enabled: globalEnabled,
    frequency: automations.publish.frequency,
    dayOfWeek: automations.publish.dayOfWeek,
    time: automations.publish.time,
    mode: automations.publish.validationMode,
    goal: includesValue(INR_AGENT_GOALS, source.goal) ? source.goal : defaults.goal,
    allowedActions: sanitizeStringArray(INR_AGENT_ACTIONS, source.allowedActions, defaults.allowedActions),
    allowedChannels: automations.publish.allowedChannels,
    useMediaLibrary: automations.publish.useImageBank,
    allowAiImages: sanitizeBoolean(source.allowAiImages, defaults.allowAiImages),
  };
}

export function automationSettingsToDbRow(userId: string, key: InrAgentAutomationKey, automation: InrAgentAutomationSettings) {
  return {
    user_id: userId,
    automation_key: key,
    enabled: automation.enabled,
    frequency: automation.frequency,
    day_of_week: automation.dayOfWeek,
    time: automation.time,
    validation_mode: automation.validationMode,
    allowed_channels: automation.allowedChannels,
    allowed_themes: automation.allowedThemes,
    use_image_bank: automation.useImageBank,
    image_required: automation.imageRequired,
    recipient_scope: automation.recipientScope,
    source_strategy: automation.sourceStrategy,
    last_prepared_at: automation.lastPreparedAt,
    last_executed_at: automation.lastExecutedAt,
    next_run_at: automation.nextRunAt,
    metadata: automation.metadata,
    updated_at: new Date().toISOString(),
  };
}
