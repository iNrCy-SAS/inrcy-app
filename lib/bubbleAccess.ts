export const APP_BUBBLE_KEYS = [
  "inrbadge",
  "mails",
  "site_inrcy",
  "site_web",
  "gmb",
  "inr_search",
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube_shorts",
  "pinterest",
  "inr_agent",
  "inr_calendar",
  "inr_crm",
  "inr_send",
  "inr_stats",
  "documents",
] as const;

export type AppBubbleKey = (typeof APP_BUBBLE_KEYS)[number];
export type AppBubbleAccessMap = Record<AppBubbleKey, boolean>;

export const APP_BUBBLE_ALWAYS_ENABLED_KEYS: readonly AppBubbleKey[] = [
  "inr_agent",
  "tiktok",
];

export type AppBubbleAccessRow = {
  bubble_key: string | null;
  enabled: boolean | null;
};

export type AppBubbleAccessInsertRow = {
  user_id: string;
  bubble_key: AppBubbleKey;
  enabled: boolean;
};

export const APP_BUBBLE_DEFAULT_ACCESS: AppBubbleAccessMap = {
  inrbadge: true,
  mails: true,
  // Site iNrCy is an opt-in entitlement managed from Supabase/admin.
  // Fail closed when no authoritative row exists.
  site_inrcy: false,
  site_web: true,
  gmb: true,
  inr_search: true,
  facebook: true,
  instagram: true,
  linkedin: true,
  // X reste en pilote tant que les clés, crédits et coûts par compte ne sont
  // pas certifiés. L'admin peut l'activer compte par compte via Bubble Access.
  x: false,
  tiktok: true,
  youtube_shorts: true,
  pinterest: true,
  inr_agent: true,
  inr_calendar: true,
  inr_crm: true,
  inr_send: true,
  inr_stats: true,
  documents: true,
};

const APP_BUBBLE_KEY_SET = new Set<string>(APP_BUBBLE_KEYS);
const APP_BUBBLE_ALWAYS_ENABLED_KEY_SET = new Set<AppBubbleKey>(
  APP_BUBBLE_ALWAYS_ENABLED_KEYS,
);

export function isAppBubbleKey(value: unknown): value is AppBubbleKey {
  return typeof value === "string" && APP_BUBBLE_KEY_SET.has(value);
}

export function normalizeAppBubbleKey(value: unknown): AppBubbleKey | null {
  if (isAppBubbleKey(value)) return value;
  return null;
}

export function isAppBubbleAlwaysEnabled(bubbleKey: AppBubbleKey): boolean {
  return APP_BUBBLE_ALWAYS_ENABLED_KEY_SET.has(bubbleKey);
}

export function createDefaultBubbleAccessMap(): AppBubbleAccessMap {
  return { ...APP_BUBBLE_DEFAULT_ACCESS };
}


export function createDefaultBubbleAccessRows(userId: string): AppBubbleAccessInsertRow[] {
  return APP_BUBBLE_KEYS.map((bubbleKey) => ({
    user_id: userId,
    bubble_key: bubbleKey,
    enabled: APP_BUBBLE_DEFAULT_ACCESS[bubbleKey],
  }));
}

export function buildBubbleAccessMap(rows?: AppBubbleAccessRow[] | null): AppBubbleAccessMap {
  const accessMap = createDefaultBubbleAccessMap();

  for (const row of rows ?? []) {
    const bubbleKey = normalizeAppBubbleKey(row?.bubble_key);
    if (!bubbleKey) continue;
    accessMap[bubbleKey] = Boolean(row.enabled);
  }

  for (const bubbleKey of APP_BUBBLE_ALWAYS_ENABLED_KEYS) {
    accessMap[bubbleKey] = true;
  }

  return accessMap;
}

export function isBubbleEnabled(
  accessMap: Partial<Record<AppBubbleKey, boolean>> | null | undefined,
  bubbleKey: AppBubbleKey,
): boolean {
  if (isAppBubbleAlwaysEnabled(bubbleKey)) return true;
  return accessMap?.[bubbleKey] ?? APP_BUBBLE_DEFAULT_ACCESS[bubbleKey];
}
