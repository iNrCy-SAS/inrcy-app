import { createHash } from "node:crypto";

export const VISIO_BOOKING_MANUAL_RESEND_SCOPE = "visio_booking_manual_link_v1";
export const VISIO_BOOKING_MANUAL_RESEND_LOCK_TTL_MS =
  7 * 24 * 60 * 60 * 1000;

function clean(value: unknown) {
  return String(value || "").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validMeetUrl(value: unknown) {
  const candidate = clean(value);
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.hostname !== "meet.google.com") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function buildVisioBookingManualResendKey(input: {
  appointmentIdentity: unknown;
  deliveryKey: unknown;
}) {
  const appointmentIdentity = clean(input.appointmentIdentity).toLowerCase();
  const deliveryKey = clean(input.deliveryKey).toLowerCase();
  if (
    !appointmentIdentity ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      deliveryKey,
    )
  ) {
    throw new Error("visio_booking_manual_resend_invalid");
  }
  return `v1:${digest(`${appointmentIdentity}\n${deliveryKey}`)}`;
}

export function visioBookingManualResendFingerprint(input: {
  appointmentIdentity: unknown;
  deliveryKey: unknown;
}) {
  return buildVisioBookingManualResendKey(input).slice(3);
}

export function buildVisioBookingLinkMail(input: {
  start: unknown;
  end: unknown;
  meetUrl: unknown;
}) {
  const start = new Date(clean(input.start));
  const end = new Date(clean(input.end));
  const meetUrl = validMeetUrl(input.meetUrl);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end.getTime() <= start.getTime() ||
    !meetUrl
  ) {
    throw new Error("visio_booking_manual_resend_invalid");
  }

  const date = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(start).replace(":", "h");
  const endTime = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(end).replace(":", "h");
  const safeMeetUrl = escapeHtml(meetUrl);

  return {
    subject: "Votre lien Google Meet — iNrCy",
    text: [
      "Bonjour,",
      "",
      "L’équipe iNrCy vous renvoie manuellement le lien de votre rendez-vous de présentation.",
      `Date : ${date}`,
      `Horaire : ${time} - ${endTime}`,
      `Google Meet : ${meetUrl}`,
      "",
      "Aucun rappel automatique supplémentaire ne sera envoyé par iNrCy.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#071329;color:#eef5ff;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:620px;margin:0 auto;padding:28px;border:1px solid #294777;border-radius:20px;background:#0b1c3d;">
      <p style="margin:0 0 18px;">Bonjour,</p>
      <h1 style="margin:0 0 14px;font-size:24px;">Votre rendez-vous iNrCy</h1>
      <p style="margin:0 0 18px;line-height:1.6;">L’équipe iNrCy vous renvoie manuellement le lien de votre rendez-vous de présentation.</p>
      <p style="margin:0 0 6px;"><strong>Date :</strong> ${escapeHtml(date)}</p>
      <p style="margin:0 0 22px;"><strong>Horaire :</strong> ${escapeHtml(time)} - ${escapeHtml(endTime)}</p>
      <p style="margin:0 0 24px;"><a href="${safeMeetUrl}" style="display:inline-block;padding:13px 22px;border-radius:12px;background:linear-gradient(135deg,#2eb9f0,#bd46d3);color:#fff;font-weight:700;text-decoration:none;">Rejoindre le Google Meet</a></p>
      <p style="margin:0;color:#a9b8d3;font-size:13px;line-height:1.5;">Aucun rappel automatique supplémentaire ne sera envoyé par iNrCy.</p>
    </div>
  </body>
</html>`,
  };
}
