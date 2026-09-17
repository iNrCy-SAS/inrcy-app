import { NextResponse } from "next/server";

import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import {
  rejectUntrustedVisioOrigin,
  visioOptions,
  withVisioCors,
} from "@/lib/visioBookingCors";
import {
  isVisioBookingFunnelEvent,
  isVisioBookingFunnelUuid,
  recordVisioBookingFunnelEvent,
} from "@/lib/visioBookingFunnel";
import { verifyVisioBookingToken } from "@/lib/visioBookingToken";

export const runtime = "nodejs";

function json(request: Request, body: unknown, status = 200) {
  return withVisioCors(NextResponse.json(body, { status }), request);
}

export async function POST(request: Request) {
  if (rejectUntrustedVisioOrigin(request)) {
    return json(request, { ok: false, error: "Origine non autorisée." }, 403);
  }
  const limited = await enforceRateLimit({
    name: "public_visio_funnel_event",
    identifier: getClientIp(request),
    limit: 120,
    window: "10 m",
    fallbackLimit: 40,
  });
  if (limited) return withVisioCors(limited, request);

  try {
    const body = (await request.json()) as {
      token?: unknown;
      eventId?: unknown;
      eventName?: unknown;
      sessionId?: unknown;
      step?: unknown;
      metadata?: unknown;
    };
    const claims = verifyVisioBookingToken(body.token);
    if (!isVisioBookingFunnelUuid(body.eventId)) {
      return json(request, { ok: false, error: "Événement invalide." }, 400);
    }
    if (body.sessionId && !isVisioBookingFunnelUuid(body.sessionId)) {
      return json(request, { ok: false, error: "Session invalide." }, 400);
    }
    if (!isVisioBookingFunnelEvent(body.eventName)) {
      return json(request, { ok: false, error: "Type d’événement invalide." }, 400);
    }

    await recordVisioBookingFunnelEvent({
      claims,
      eventId: String(body.eventId),
      eventName: body.eventName,
      sessionId: body.sessionId ? String(body.sessionId) : undefined,
      step: Number(body.step),
      metadata: body.metadata,
    });
    return json(request, { ok: true }, 202);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "visio_booking_token_expired" || code === "visio_booking_token_invalid") {
      return json(request, { ok: false, code, error: "Lien de réservation invalide." }, 401);
    }
    console.error("[visio-booking][funnel]", code || "event_write_failed");
    return json(request, { ok: false, error: "Suivi momentanément indisponible." }, 503);
  }
}

export function OPTIONS(request: Request) {
  return visioOptions(request);
}
