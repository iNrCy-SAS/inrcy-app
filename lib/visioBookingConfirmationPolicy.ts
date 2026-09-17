import { createHash } from "node:crypto";

export const VISIO_BOOKING_CONFIRMATION_LOCK_TTL_MS = 10 * 60 * 1000;
export const VISIO_BOOKING_CONFIRMATION_MAX_ATTEMPTS = 12;

export type VisioBookingConfirmationPayload = {
  googleEventId: string;
  prospectUserId: string;
  recipient: string;
  prospectName: string;
  company: string;
  assignedMemberId: string;
  assignedMemberName: string;
  dateLabel: string;
  timeLabel: string;
  meetUrl: string;
  calendarUrl: string;
  subject: string;
  text: string;
  html: string;
};

function clean(value: unknown, maxLength = 2_000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizedEmail(value: unknown) {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function safeHttpsUrl(value: unknown, expectedHost?: string) {
  try {
    const url = new URL(clean(value, 2_000));
    if (url.protocol !== "https:") return "";
    if (expectedHost && url.hostname.toLowerCase() !== expectedHost) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function escapeHtml(value: unknown) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildVisioBookingConfirmationDeliveryKey(input: {
  googleEventId: unknown;
  recipient: unknown;
}) {
  const googleEventId = clean(input.googleEventId, 512);
  const recipient = normalizedEmail(input.recipient);
  if (!googleEventId || !recipient) {
    throw new Error("visio_booking_confirmation_invalid");
  }
  return `v1:${digest(`${googleEventId}\n${recipient}`)}`;
}

export function buildVisioBookingConfirmationPayload(input: {
  googleEventId: unknown;
  prospectUserId: unknown;
  recipient: unknown;
  prospectName: unknown;
  company?: unknown;
  assignedMemberId: unknown;
  assignedMemberName: unknown;
  dateLabel: unknown;
  timeLabel: unknown;
  meetUrl: unknown;
  calendarUrl?: unknown;
}): VisioBookingConfirmationPayload {
  const googleEventId = clean(input.googleEventId, 512);
  const prospectUserId = clean(input.prospectUserId, 128);
  const recipient = normalizedEmail(input.recipient);
  const prospectName = clean(input.prospectName, 160) || "Professionnel iNrCy";
  const company = clean(input.company, 200);
  const assignedMemberId = clean(input.assignedMemberId, 80);
  const assignedMemberName = clean(input.assignedMemberName, 120) || "Équipe iNrCy";
  const dateLabel = clean(input.dateLabel, 120);
  const timeLabel = clean(input.timeLabel, 40);
  const meetUrl = safeHttpsUrl(input.meetUrl, "meet.google.com");
  const calendarUrl = safeHttpsUrl(input.calendarUrl);
  if (
    !googleEventId ||
    !prospectUserId ||
    !recipient ||
    !dateLabel ||
    !timeLabel ||
    !meetUrl
  ) {
    throw new Error("visio_booking_confirmation_invalid");
  }

  const subject = `Votre rendez-vous iNrCy est confirmé — ${dateLabel} à ${timeLabel}`;
  const text = [
    `Bonjour ${prospectName},`,
    "",
    "Votre rendez-vous de mise en route iNrCy est bien confirmé.",
    `Date : ${dateLabel}`,
    `Heure : ${timeLabel}`,
    "Durée prévue : 30 à 45 minutes",
    `Votre interlocuteur : ${assignedMemberName}`,
    "",
    `Rejoindre la visioconférence Google Meet : ${meetUrl}`,
    calendarUrl ? `Consulter le rendez-vous dans Google Agenda : ${calendarUrl}` : "",
    "",
    "Conservez cet e-mail : il contient votre lien personnel de visioconférence.",
    "La création de votre mot de passe iNrCy reste accessible dans l’e-mail séparé prévu à cet effet.",
    "",
    "À très vite,",
    "L’équipe iNrCy",
  ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n");

  const calendarButton = calendarUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:14px auto 0"><tr><td align="center" bgcolor="#13264D" style="background-color:#13264D;border:1px solid #55D7FF;border-radius:10px"><a href="${escapeHtml(calendarUrl)}" style="display:block;padding:12px 18px;color:#DDF8FF;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none">Voir dans mon agenda</a></td></tr></table>`
    : "";
  const html = `<!doctype html><html lang="fr"><body bgcolor="#071127" style="margin:0;padding:0;background-color:#071127;color:#F7F9FF;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden;color:#071127">Votre rendez-vous iNrCy est confirmé. Votre lien Google Meet est prêt.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#071127" style="width:100%;background-color:#071127"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" bgcolor="#0D1833" style="width:100%;max-width:620px;background-color:#0D1833;border:1px solid #2B3E68;border-radius:18px;overflow:hidden"><tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td width="25%" height="7" bgcolor="#25BFF5" style="background-color:#25BFF5;font-size:0;line-height:0">&nbsp;</td><td width="25%" height="7" bgcolor="#635BFF" style="background-color:#635BFF;font-size:0;line-height:0">&nbsp;</td><td width="25%" height="7" bgcolor="#EB3FAF" style="background-color:#EB3FAF;font-size:0;line-height:0">&nbsp;</td><td width="25%" height="7" bgcolor="#FF8A3D" style="background-color:#FF8A3D;font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr><tr><td style="padding:32px 36px"><img src="cid:inrcy-logo@inrcy" width="142" alt="iNrCy" style="display:block;width:142px;max-width:142px;height:auto;border:0"><p style="margin:28px 0 8px;font-family:Arial,sans-serif;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#55D7FF">Rendez-vous confirmé</p><h1 style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:29px;line-height:36px;color:#FFFFFF">Votre mise en route iNrCy est réservée</h1><p style="margin:0 0 22px;font-family:Arial,sans-serif;font-size:16px;line-height:25px;color:#E7EDFC">Bonjour ${escapeHtml(prospectName)}, votre créneau est bien enregistré. Nous avons hâte de vous présenter iNrCy et de vous aider à partir sur de bonnes bases.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#101F42" style="width:100%;background-color:#101F42;border:1px solid #34558F;border-radius:14px"><tr><td style="padding:20px 22px"><p style="margin:0 0 7px;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#8FE8FF">DATE</p><p style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:20px;font-weight:800;line-height:26px;color:#FFFFFF">${escapeHtml(dateLabel)} à ${escapeHtml(timeLabel)}</p><p style="margin:0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#DCE5FA"><strong style="color:#FFFFFF">Durée :</strong> 30 à 45 minutes<br><strong style="color:#FFFFFF">Votre interlocuteur :</strong> ${escapeHtml(assignedMemberName)}</p></td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 14px"><tr><td align="center" bgcolor="#635BFF" style="background-color:#635BFF;border:1px solid #857DFF;border-radius:12px"><a href="${escapeHtml(meetUrl)}" style="display:block;padding:18px 22px;color:#FFFFFF;font-family:Arial,sans-serif;font-size:17px;font-weight:900;line-height:22px;text-align:center;text-decoration:none">Rejoindre la visio Google Meet</a></td></tr></table><p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;text-align:center;color:#9FB2D8">Si le bouton ne s’affiche pas, utilisez ce lien :<br><a href="${escapeHtml(meetUrl)}" style="color:#55D7FF;text-decoration:underline;word-break:break-all">${escapeHtml(meetUrl)}</a></p>${calendarButton}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#0A1630" style="margin-top:26px;width:100%;background-color:#0A1630;border-left:4px solid #EB3FAF"><tr><td style="padding:14px 16px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#AFC0E2">Conservez cet e-mail : il contient votre lien personnel de visioconférence. La création de votre mot de passe reste dans l’e-mail iNrCy séparé prévu à cet effet.</td></tr></table><p style="margin:24px 0 0;font-family:Arial,sans-serif;font-size:14px;line-height:22px;color:#DCE5FA">À très vite,<br><strong style="color:#FFFFFF">L’équipe iNrCy</strong></p></td></tr></table></td></tr></table></body></html>`;

  return {
    googleEventId,
    prospectUserId,
    recipient,
    prospectName,
    company,
    assignedMemberId,
    assignedMemberName,
    dateLabel,
    timeLabel,
    meetUrl,
    calendarUrl,
    subject,
    text,
    html,
  };
}

export function visioBookingConfirmationRetryAt(input: {
  attemptCount: number;
  deliveryKey: string;
  now?: Date;
}) {
  const attempt = Math.max(1, Math.floor(input.attemptCount));
  const baseMs = Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** (attempt - 1));
  const jitterMs = Number.parseInt(digest(input.deliveryKey).slice(0, 6), 16) % 30_001;
  return new Date((input.now || new Date()).getTime() + baseMs + jitterMs);
}

export function visioBookingConfirmationErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "send_failed");
  return raw.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_").slice(0, 120) || "send_failed";
}
