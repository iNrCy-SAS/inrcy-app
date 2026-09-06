import { NextResponse } from "next/server";

import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import {
  rejectUntrustedVisioOrigin,
  visioOptions,
  withVisioCors,
} from "@/lib/visioBookingCors";
import { bookVisioSlot } from "@/lib/visioBookingGoogle";
import { verifyVisioBookingToken } from "@/lib/visioBookingToken";

export const runtime = "nodejs";

function json(request: Request, body: unknown, status = 200) {
  return withVisioCors(NextResponse.json(body, { status }), request);
}

function publicError(request: Request, error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "visio_booking_token_expired" || code === "visio_booking_token_invalid") {
    return json(
      request,
      {
        ok: false,
        code,
        error: code.endsWith("expired")
          ? "Ce lien de réservation a expiré."
          : "Ce lien de réservation n’est pas valide.",
      },
      401,
    );
  }
  if (code === "visio_slot_invalid") {
    return json(
      request,
      { ok: false, code, error: "Ce créneau n’est pas valide." },
      400,
    );
  }
  if (code === "visio_slot_unavailable" || code === "visio_slot_busy") {
    return json(
      request,
      {
        ok: false,
        code: "visio_slot_unavailable",
        error: "Ce créneau vient d’être réservé. Choisissez-en un autre.",
      },
      409,
    );
  }
  console.error(
    "[visio-booking][book]",
    error instanceof Error ? error.message : "booking_failed",
  );
  return json(
    request,
    {
      ok: false,
      code: "visio_booking_failed",
      error: "Le rendez-vous n’a pas pu être créé pour le moment. Merci de réessayer.",
    },
    503,
  );
}

export async function POST(request: Request) {
  if (rejectUntrustedVisioOrigin(request)) {
    return json(request, { ok: false, error: "Origine non autorisée." }, 403);
  }
  const limited = await enforceRateLimit({
    name: "public_visio_booking",
    identifier: getClientIp(request),
    limit: 12,
    window: "10 m",
    fallbackLimit: 5,
    failClosed: true,
  });
  if (limited) return withVisioCors(limited, request);

  try {
    const body = (await request.json()) as { token?: unknown; start?: unknown };
    const claims = verifyVisioBookingToken(body?.token);
    const booking = await bookVisioSlot(claims, body?.start);
    return json(request, { ok: true, booking });
  } catch (error) {
    return publicError(request, error);
  }
}

export function OPTIONS(request: Request) {
  return visioOptions(request);
}
