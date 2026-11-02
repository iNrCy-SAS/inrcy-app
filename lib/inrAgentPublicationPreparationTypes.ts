import "server-only";

import { type BoosterCtaMode } from "@/lib/boosterCta";
import { type InrAgentEditorialSlot } from "@/lib/inrAgentEditorialPlanning";

export type JsonRecord = Record<string, unknown>;

export type EditorialPreparationTarget = {
  id: string;
  payload: JsonRecord;
  metadata: JsonRecord;
  plan: InrAgentEditorialSlot & { timezone?: string; state?: string };
};

export type ChannelPost = {
  title: string;
  content: string;
  cta: string;
  hashtags: string[];
  ctaMode?: BoosterCtaMode;
  ctaUrl?: string;
  ctaPhone?: string;
};

export type ImageBankAsset = {
  id: string;
  bucket: string;
  storagePath: string;
  url: string;
  title: string;
  sector: string;
  job: string;
  tags: string[];
  orientation: string;
  source: string;
  librarySource?: "pro_media_library" | "inrcy_image_bank";
  matchLevel?: string;
  mediaType?: "image" | "video";
  kind?: "image" | "video";
  mimeType?: string;
  size?: number | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
};

export type RecentMediaUsage = {
  cutoffIso: string;
  rowsScanned: number;
  proMediaIds: Set<string>;
  imageBankIds: Set<string>;
  storageKeys: Set<string>;
};

export type MediaSelectionAttempt = {
  source: "pro_media_library" | "inrcy_image_bank";
  matchLevel: string;
  mediaType: "image" | "video";
  token?: string;
  sector?: string;
  job?: string;
  totalCandidates: number;
  excludedRecentlyUsed: number;
  eligibleCandidates: number;
  genericSectorCandidates?: number;
  excludedNonGenericSectorCount?: number;
  selected: boolean;
  selectedCandidateId?: string;
  selectedStoragePath?: string;
};

export type AutomationDbRow = {
  enabled?: boolean | null;
  frequency?: string | null;
  day_of_week?: number | null;
  time?: string | null;
  validation_mode?: string | null;
  allowed_channels?: string[] | null;
  allowed_themes?: string[] | null;
  use_image_bank?: boolean | null;
  image_required?: boolean | null;
  recipient_scope?: string | null;
  source_strategy?: string | null;
  last_prepared_at?: string | null;
  last_executed_at?: string | null;
  next_run_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Server-resolved scope. Create only after resolveInrAgentActionRequest succeeds. */
export type InrAgentPublicationPreparationContext = Readonly<{ accountId: string; actorAuthUserId: string; isCron: boolean }>;
