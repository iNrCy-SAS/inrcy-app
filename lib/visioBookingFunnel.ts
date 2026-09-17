import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { VisioBookingClaims } from "@/lib/visioBookingToken";

export const VISIO_BOOKING_FUNNEL_EVENTS = [
  "modal_viewed",
  "booking_started",
  "availability_loaded",
  "slot_selected",
  "booking_submitted",
  "booking_completed",
  "modal_skipped",
  "modal_closed",
  "availability_failed",
  "booking_failed",
] as const;

export type VisioBookingFunnelEvent =
  (typeof VISIO_BOOKING_FUNNEL_EVENTS)[number];

const EVENT_NAMES = new Set<string>(VISIO_BOOKING_FUNNEL_EVENTS);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shortText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function boundedNumber(value: unknown, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : undefined;
}

export function isVisioBookingFunnelEvent(
  value: unknown,
): value is VisioBookingFunnelEvent {
  return EVENT_NAMES.has(String(value || ""));
}

export function isVisioBookingFunnelUuid(value: unknown) {
  return UUID_PATTERN.test(String(value || ""));
}

export function sanitizeVisioBookingFunnelMetadata(value: unknown) {
  const input = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const metadata: Record<string, string | number> = {};
  const surface = shortText(input.surface, 32);
  const viewport = shortText(input.viewport, 24);
  const errorCode = shortText(input.errorCode, 80);
  const slotStart = shortText(input.slotStart, 40);
  const availabilityDays = boundedNumber(input.availabilityDays, 0, 60);

  if (surface) metadata.surface = surface;
  if (viewport) metadata.viewport = viewport;
  if (errorCode) metadata.errorCode = errorCode;
  if (slotStart && Number.isFinite(new Date(slotStart).getTime())) {
    metadata.slotStart = new Date(slotStart).toISOString();
  }
  if (availabilityDays !== undefined) {
    metadata.availabilityDays = Math.floor(availabilityDays);
  }
  return metadata;
}

export async function recordVisioBookingFunnelEvent(input: {
  claims: VisioBookingClaims;
  eventId: string;
  eventName: VisioBookingFunnelEvent;
  sessionId?: string;
  step?: number;
  metadata?: unknown;
}) {
  const step = boundedNumber(input.step, 1, 3);
  const { error } = await supabaseAdmin
    .from("visio_booking_funnel_events")
    .upsert({
      event_id: input.eventId,
      prospect_user_id: input.claims.sub,
      event_name: input.eventName,
      source: "wordpress_signup",
      session_id: input.sessionId || null,
      step: step === undefined ? null : Math.floor(step),
      metadata: sanitizeVisioBookingFunnelMetadata(input.metadata),
      occurred_at: new Date().toISOString(),
    }, { onConflict: "event_id", ignoreDuplicates: true });

  if (error) {
    throw new Error(`visio_booking_funnel_write_failed:${error.message}`);
  }
}
