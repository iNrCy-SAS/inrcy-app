import { createHash } from "node:crypto";

export type SignupFailureStage =
  | "account_lookup"
  | "auth_invitation"
  | "bubble_access"
  | "profile_bootstrap"
  | "profile_update"
  | "business_profile_update"
  | "notification_preferences"
  | "welcome_notifications"
  | "trial_subscription"
  | "unknown";

export type SignupFailureContact = {
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  consent: boolean;
};

export type SignupFailureAlertInput = {
  source: string;
  stage: SignupFailureStage;
  requestId: string;
  occurredAt: string;
  userId?: string | null;
  authUserCreated: boolean;
  contact: SignupFailureContact;
  errorCode: string;
  errorMessage: string;
};

const STAGE_LABELS: Record<SignupFailureStage, string> = {
  account_lookup: "Vérification du compte existant",
  auth_invitation: "Création de l’invitation Supabase",
  bubble_access: "Provisionnement des accès",
  profile_bootstrap: "Initialisation du profil",
  profile_update: "Enregistrement des coordonnées",
  business_profile_update: "Enregistrement de la langue",
  notification_preferences: "Préférences de notifications",
  welcome_notifications: "Notifications d’accueil",
  trial_subscription: "Création de la période d’essai",
  unknown: "Étape non identifiée",
};

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayValue(value: string) {
  return value || "Non renseigné";
}

function emailRow(label: string, value: string, emphasis = false) {
  return `
    <tr>
      <td style="padding:8px 12px 8px 0;color:#64748b;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;color:#0f172a;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;${emphasis ? "font-weight:700;" : ""}">${escapeHtml(value)}</td>
    </tr>
  `;
}

function redactSecrets(value: string) {
  return value
    .replace(/\b(?:bearer)\s+[a-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(password|passwd|token|secret|cookie|authorization|access[_-]?token|refresh[_-]?token|api[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /([?&](?:token|secret|password|access_token|refresh_token|api_key)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    );
}

export function getSignupFailureErrorCode(error: unknown) {
  const candidate = (error || {}) as { code?: unknown; status?: unknown; name?: unknown };
  const raw = candidate.code || candidate.status || candidate.name || "signup_failed";
  const normalized = cleanText(raw, 100)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "signup_failed";
}

export function getSignupFailureSafeMessage(error: unknown) {
  const candidate = error as { message?: unknown } | null;
  const raw = candidate?.message || (typeof error === "string" ? error : "Échec technique non détaillé.");
  return cleanText(redactSecrets(String(raw)), 500) || "Échec technique non détaillé.";
}

export function maskSignupEmailForLog(value: unknown) {
  const email = cleanText(value, 320).toLowerCase();
  const [local, domain] = email.split("@");
  if (!local || !domain) return "non_renseigne";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, Math.min(6, local.length - visible.length)))}@${domain}`;
}

export function createSignupFailureFingerprint(input: SignupFailureAlertInput) {
  const email = cleanText(input.contact.email, 320).toLowerCase();
  const phone = cleanText(input.contact.phone, 80).replace(/\D+/g, "");
  return createHash("sha256")
    .update(
      [
        cleanText(input.source, 100).toLowerCase(),
        input.stage,
        email,
        phone,
        cleanText(input.errorCode, 100).toLowerCase(),
        input.authUserCreated ? "post_auth" : "pre_auth",
      ].join("\0"),
    )
    .digest("hex");
}

function incidentLabel(input: SignupFailureAlertInput) {
  if (input.authUserCreated) return "URGENT — compte partiellement créé";
  if (input.stage === "auth_invitation") return "Invitation à vérifier";
  return "Prospect bloqué avant création";
}

function recommendedAction(input: SignupFailureAlertInput) {
  if (input.authUserCreated) {
    return "Le compte Auth existe probablement déjà. Vérifier le user ID ci-dessous avant toute nouvelle invitation, puis terminer ou réparer le provisionnement.";
  }
  if (input.stage === "auth_invitation") {
    return "Vérifier dans Supabase si l’utilisateur a malgré tout été créé avant de renvoyer une invitation.";
  }
  return "Contacter rapidement le prospect et vérifier l’incident technique avant de relancer son inscription.";
}

function formatParisDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return cleanText(value, 80) || "Non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "medium",
    timeZone: "Europe/Paris",
  }).format(date);
}

export function buildSignupFailureMail(input: SignupFailureAlertInput) {
  const contact = {
    email: cleanText(input.contact.email, 320).toLowerCase(),
    firstName: cleanText(input.contact.firstName, 120),
    lastName: cleanText(input.contact.lastName, 120),
    companyName: cleanText(input.contact.companyName, 200),
    phone: cleanText(input.contact.phone, 80),
  };
  const label = incidentLabel(input);
  const action = recommendedAction(input);
  const stage = STAGE_LABELS[input.stage] || STAGE_LABELS.unknown;
  const source = cleanText(input.source, 160) || "wordpress-elementor";
  const requestId = cleanText(input.requestId, 160) || "Non renseigné";
  const userId = cleanText(input.userId, 160) || "Non créé / inconnu";
  const errorCode = cleanText(input.errorCode, 100) || "signup_failed";
  const errorMessage = cleanText(redactSecrets(input.errorMessage), 500) || "Échec technique non détaillé.";
  const occurredAt = formatParisDate(input.occurredAt);
  const subjectContact = contact.email || contact.phone || contact.companyName || "contact non identifié";
  const subject = `iNrCy — ${label} — ${subjectContact}`;

  const text = [
    label,
    "",
    "Un professionnel a validé le formulaire mais son inscription n’a pas abouti.",
    "",
    "CONTACT À RÉCUPÉRER",
    `Nom : ${displayValue(contact.lastName)}`,
    `Prénom : ${displayValue(contact.firstName)}`,
    `E-mail : ${displayValue(contact.email)}`,
    `Société : ${displayValue(contact.companyName)}`,
    `Téléphone : ${displayValue(contact.phone)}`,
    `Consentement : ${input.contact.consent ? "Oui" : "Non"}`,
    "",
    "ACTION RECOMMANDÉE",
    action,
    "",
    "DIAGNOSTIC TECHNIQUE",
    `Étape : ${stage}`,
    `Code : ${errorCode}`,
    `Détail : ${errorMessage}`,
    `Compte Auth créé : ${input.authUserCreated ? "Oui" : "Non / inconnu"}`,
    `User ID : ${userId}`,
    `Request ID : ${requestId}`,
    `Source : ${source}`,
    `Date : ${occurredAt}`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f6f7fb;padding:24px;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:18px;padding:26px;border:1px solid #e5e7eb;box-shadow:0 18px 50px rgba(15,23,42,0.08);">
        <div style="display:inline-block;margin-bottom:14px;padding:7px 11px;border-radius:999px;background:${input.authUserCreated ? "#fee2e2" : "#ffedd5"};color:${input.authUserCreated ? "#991b1b" : "#9a3412"};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">
          ${escapeHtml(label)}
        </div>
        <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">Inscription iNrCy non finalisée</h1>
        <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.55;">
          Un professionnel a validé le formulaire, mais son inscription n’a pas abouti. Ses coordonnées sont conservées ici pour permettre un rappel rapide.
        </p>

        <div style="margin:0 0 18px;padding:18px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;">
          <div style="margin:0 0 8px;color:#0f172a;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;">Contact à récupérer</div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;table-layout:fixed;">
            ${emailRow("Nom", displayValue(contact.lastName), true)}
            ${emailRow("Prénom", displayValue(contact.firstName), true)}
            ${emailRow("E-mail", displayValue(contact.email), true)}
            ${emailRow("Société", displayValue(contact.companyName), true)}
            ${emailRow("Téléphone", displayValue(contact.phone), true)}
            ${emailRow("Consentement", input.contact.consent ? "Oui" : "Non")}
          </table>
        </div>

        <div style="margin:0 0 18px;padding:18px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;">
          <div style="margin:0 0 7px;color:#9a3412;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;">Action recommandée</div>
          <p style="margin:0;color:#7c2d12;font-size:14px;line-height:1.55;">${escapeHtml(action)}</p>
        </div>

        <div style="padding:18px;border-radius:14px;background:#ffffff;border:1px solid #e2e8f0;">
          <div style="margin:0 0 8px;color:#64748b;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;">Diagnostic technique</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;">
            ${emailRow("Étape", stage, true)}
            ${emailRow("Code", errorCode)}
            ${emailRow("Détail", errorMessage)}
            ${emailRow("Compte Auth créé", input.authUserCreated ? "Oui" : "Non / inconnu", input.authUserCreated)}
            ${emailRow("User ID", userId)}
            ${emailRow("Request ID", requestId)}
            ${emailRow("Source", source)}
            ${emailRow("Date", occurredAt)}
          </table>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
}
