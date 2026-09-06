import { NextResponse } from "next/server";

import { enforceRateLimit, getClientIp } from "@/lib/rateLimit";
import {
  rejectUntrustedVisioOrigin,
  visioOptions,
  withVisioCors,
} from "@/lib/visioBookingCors";
import { getVisioAvailability } from "@/lib/visioBookingGoogle";
import { verifyVisioBookingToken } from "@/lib/visioBookingToken";

export const runtime = "nodejs";

function json(request: Request, body: unknown, status = 200) {
  return withVisioCors(NextResponse.json(body, { status }), request);
}

function publicError(request: Request, error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "visio_booking_token_expired") {
    return json(
      request,
      { ok: false, code, error: "Ce lien de réservation a expiré." },
      401,
    );
  }
  if (code === "visio_booking_token_invalid") {
    return json(
      request,
      { ok: false, code, error: "Ce lien de réservation n’est pas valide." },
      401,
    );
  }
  console.error(
    "[visio-booking][availability]",
    error instanceof Error ? error.message : "availability_failed",
  );
  return json(
    request,
    {
      ok: false,
      code: "visio_booking_unavailable",
      error: "Les créneaux sont momentanément indisponibles. Vous pourrez réessayer plus tard.",
    },
    503,
  );
}

export async function POST(request: Request) {
  if (rejectUntrustedVisioOrigin(request)) {
    return json(request, { ok: false, error: "Origine non autorisée." }, 403);
  }
  const limited = await enforceRateLimit({
    name: "public_visio_availability",
    identifier: getClientIp(request),
    limit: 30,
    window: "10 m",
    fallbackLimit: 12,
  });
  if (limited) return withVisioCors(limited, request);

  try {
    const body = (await request.json()) as { token?: unknown };
    verifyVisioBookingToken(body?.token);
    const days = await getVisioAvailability();
    return json(request, {
      ok: true,
      timezone: "Europe/Paris",
      duration_minutes: 60,
      spacing_minutes: 120,
      days,
    });
  } catch (error) {
    return publicError(request, error);
  }
}

export function OPTIONS(request: Request) {
  return visioOptions(request);
}
