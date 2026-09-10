import { NextResponse } from "next/server";

import { resendVisioBookingLink } from "@/lib/visioBookingGoogle";
import { requireVisioTeamApi } from "@/lib/visioTeamAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function errorResponse(error: unknown) {
  const code = error instanceof Error
    ? error.message.split(":")[0]
    : "unknown_error";

  if (code === "visio_booking_manual_resend_invalid") {
    return NextResponse.json(
      { ok: false, error: "La demande de renvoi est invalide." },
      { status: 400 },
    );
  }
  if (
    code === "visio_team_assignment_mirror_missing" ||
    code === "visio_booking_manual_resend_not_booking"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Ce rendez-vous site n’est plus disponible. Actualisez la liste.",
      },
      { status: 404 },
    );
  }
  if (code === "visio_booking_manual_resend_recipient_missing") {
    return NextResponse.json(
      {
        ok: false,
        error: "Aucun destinataire professionnel n’est associé à ce rendez-vous.",
      },
      { status: 409 },
    );
  }
  if (code === "visio_booking_manual_resend_recipient_ambiguous") {
    return NextResponse.json(
      {
        ok: false,
        error: "Plusieurs destinataires externes sont associés à ce rendez-vous. Le renvoi est bloqué par sécurité.",
      },
      { status: 409 },
    );
  }
  if (code === "visio_booking_manual_resend_in_progress") {
    return NextResponse.json(
      {
        ok: false,
        error: "Ce renvoi est déjà en cours. Ne cliquez pas une seconde fois.",
      },
      { status: 409 },
    );
  }
  if (
    code === "visio_booking_manual_resend_idempotency_unavailable" ||
    code === "visio_booking_manual_resend_commit_uncertain"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "L’état de l’envoi ne peut pas être confirmé. Vérifiez la réception avant tout nouveau renvoi.",
      },
      { status: 503 },
    );
  }
  if (code === "visio_booking_manual_resend_delivery_failed") {
    return NextResponse.json(
      {
        ok: false,
        error: "Le service e-mail n’a pas confirmé l’envoi. Vérifiez la réception avant de réessayer.",
      },
      { status: 502 },
    );
  }

  console.error(
    "[visio-booking][manual-link-resend-api]",
    error instanceof Error ? error.message : "unknown_error",
  );
  return NextResponse.json(
    { ok: false, error: "Le lien n’a pas pu être renvoyé." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const authorization = await requireVisioTeamApi();
  if (!authorization.ok) return authorization.response;
  if (
    String(request.headers.get("sec-fetch-site") || "").toLowerCase() ===
    "cross-site"
  ) {
    return NextResponse.json(
      { ok: false, error: "Requête non autorisée." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null) as {
    mirrorEventId?: unknown;
    appointmentIdentity?: unknown;
    appointmentStart?: unknown;
    deliveryKey?: unknown;
  } | null;
  const mirrorEventId = String(body?.mirrorEventId || "").trim();
  const appointmentIdentity = String(body?.appointmentIdentity || "").trim();
  const appointmentStart = String(body?.appointmentStart || "").trim();
  const deliveryKey = String(body?.deliveryKey || "").trim();
  if (
    !/^[a-zA-Z0-9_-]{5,1024}$/.test(mirrorEventId) ||
    !appointmentIdentity ||
    appointmentIdentity.length > 2048 ||
    !Number.isFinite(new Date(appointmentStart).getTime()) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      deliveryKey,
    )
  ) {
    return NextResponse.json(
      { ok: false, error: "Demande invalide." },
      { status: 400 },
    );
  }

  try {
    const result = await resendVisioBookingLink({
      mirrorEventId,
      appointmentIdentity,
      appointmentStart,
      deliveryKey,
      actor: authorization.actor,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
