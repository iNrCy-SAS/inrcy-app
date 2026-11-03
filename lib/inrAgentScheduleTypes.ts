import "server-only";

import { type BoosterCtaMode } from "@/lib/boosterCta";

export type JsonRecord = Record<string, unknown>;

export type BoosterChannel =
  | "site_web"
  | "inr_search"
  | "gmb"
  | "facebook"
  | "instagram"
  | "threads"
  | "linkedin"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest"
  | "x";

export type BoosterPost = {
  title: string;
  content: string;
  cta: string;
  hashtags: string[];
  ctaMode?: BoosterCtaMode;
  ctaUrl?: string;
  ctaPhone?: string;
  ctaAction?: string;
};

export type NormalizedScheduleSelection = {
  channel: BoosterChannel;
  scheduledAt: string;
};

export type ScheduledPublicationSnapshotRow = {
  id?: unknown;
  scheduled_at?: unknown;
  channels?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

export type ScheduledPublicationSnapshotResult = {
  rows: ScheduledPublicationSnapshotRow[];
  createdWorkspaceIds: string[];
};

/** Constructed at the HTTP boundary after request/account authorization. */
export type InrAgentScheduleContext = Readonly<{ accountId: string; actorAuthUserId: string; isCron: boolean }>;

export type InrAgentScheduleResult = { body: unknown; status: number };
