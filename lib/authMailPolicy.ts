import { createHash } from "node:crypto";

export const AUTH_EMAIL_ACTIONS = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
  "reauthentication",
  "password_changed_notification",
  "email_changed_notification",
  "phone_changed_notification",
  "identity_linked_notification",
  "identity_unlinked_notification",
  "mfa_factor_enrolled_notification",
  "mfa_factor_unenrolled_notification",
] as const;

export type AuthEmailAction = (typeof AUTH_EMAIL_ACTIONS)[number];

const AUTH_EMAIL_ACTION_SET = new Set<string>(AUTH_EMAIL_ACTIONS);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGE_PATTERN = /^(fr|en|es|it|de|nl|pt|th|zh)$/;
const DELIVERY_HASH_PATTERN = /^[0-9a-f]{64}$/;

const SECURITY_NOTIFICATION_ACTIONS = new Set<AuthEmailAction>([
  "password_changed_notification",
  "email_changed_notification",
  "phone_changed_notification",
  "identity_linked_notification",
  "identity_unlinked_notification",
  "mfa_factor_enrolled_notification",
  "mfa_factor_unenrolled_notification",
]);

export type SupabaseAuthEmailHookPayload = {
  user: {
    id: string;
    email: string;
    newEmail: string;
    userMetadata: Record<string, unknown>;
  };
  emailData: {
    token: string;
    tokenHash: string;
    redirectTo: string;
    action: AuthEmailAction;
    siteUrl: string;
    tokenNew: string;
    tokenHashNew: string;
    oldEmail: string;
    oldPhone: string;
    provider: string;
    factorType: string;
  };
};

export type PreparedAuthEmail = {
  deliveryKey: string;
  deliveryHash: string;
  providerIdempotencyKey: string;
  hookId: string;
  sequence: number;
  userId: string;
  recipient: string;
  action: AuthEmailAction;
  subject: string;
  text: string;
  html: string;
};

export type AuthEmailProviderStatus =
  | "sent"
  | "delivered"
  | "delayed"
  | "failed"
  | "bounced"
  | "suppressed"
  | "complained";

export type NormalizedResendAuthEvent =
  | { kind: "ignored"; reason: "not_auth" | "unsupported_event" }
  | {
      kind: "event";
      providerMessageId: string;
      deliveryKey: string | null;
      eventType:
        | "email.sent"
        | "email.delivered"
        | "email.delivery_delayed"
        | "email.failed"
        | "email.bounced"
        | "email.suppressed"
        | "email.complained";
      eventCreatedAt: string;
      status: AuthEmailProviderStatus;
      statusRank: number;
      errorCode: string | null;
      errorMessage: string | null;
    };

export class AuthMailPayloadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthMailPayloadError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clean(value: unknown, maxLength = 2_000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function email(value: unknown) {
  const normalized = clean(value, 320).toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : "";
}

function escapeHtml(value: unknown) {
  return clean(value, 1_000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeProviderDetail(value: unknown) {
  return clean(value, 500).replace(/[\r\n\t]+/g, " ") || null;
}

export function parseSupabaseAuthEmailHookPayload(
  input: unknown,
): SupabaseAuthEmailHookPayload {
  const root = record(input);
  const rawUser = record(root.user);
  // Supabase's current HTTP hook contract calls this property `email_data`.
  // Deliberately do not accept the historic/documentation typo `email`.
  const rawEmailData = record(root.email_data);
  const userId = clean(rawUser.id, 64);
  const userEmail = email(rawUser.email);
  const actionValue = clean(rawEmailData.email_action_type, 64);

  if (!UUID_PATTERN.test(userId)) {
    throw new AuthMailPayloadError("invalid_user_id", "Invalid Auth user id");
  }
  if (!userEmail) {
    throw new AuthMailPayloadError("invalid_recipient", "Invalid Auth email recipient");
  }
  if (!AUTH_EMAIL_ACTION_SET.has(actionValue)) {
    throw new AuthMailPayloadError("unsupported_action", "Unsupported Auth email action");
  }

  return {
    user: {
      id: userId,
      email: userEmail,
      newEmail: email(rawUser.new_email),
      userMetadata: record(rawUser.user_metadata),
    },
    emailData: {
      token: clean(rawEmailData.token, 512),
      tokenHash: clean(rawEmailData.token_hash, 2_048),
      redirectTo: clean(rawEmailData.redirect_to, 2_048),
      action: actionValue as AuthEmailAction,
      siteUrl: clean(rawEmailData.site_url, 2_048),
      tokenNew: clean(rawEmailData.token_new, 512),
      tokenHashNew: clean(rawEmailData.token_hash_new, 2_048),
      oldEmail: email(rawEmailData.old_email),
      oldPhone: clean(rawEmailData.old_phone, 64),
      provider: clean(rawEmailData.provider, 120),
      factorType: clean(rawEmailData.factor_type, 120),
    },
  };
}

function authLanguage(redirectTo: string) {
  try {
    const parts = new URL(redirectTo).pathname.split("/").filter(Boolean);
    const candidate = String(parts.at(-1) || "").toLowerCase();
    return LANGUAGE_PATTERN.test(candidate) ? candidate : "fr";
  } catch {
    return "fr";
  }
}

function displayName(payload: SupabaseAuthEmailHookPayload) {
  const metadata = payload.user.userMetadata;
  const value =
    metadata.first_name ||
    metadata.full_name ||
    metadata.name ||
    metadata.company ||
    "";
  return clean(value, 120);
}

function allowedAppOrigin(appOrigin: string) {
  const parsed = new URL(appOrigin);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new AuthMailPayloadError("invalid_app_origin", "Auth app origin must use HTTPS");
  }
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function validatedRedirect(
  redirectTo: string,
  appOrigin: string,
  allowLocalhost: boolean,
) {
  const expectedOrigin = allowedAppOrigin(appOrigin);
  let parsed: URL;
  try {
    parsed = new URL(redirectTo || "/dashboard", expectedOrigin);
  } catch {
    throw new AuthMailPayloadError("invalid_redirect", "Invalid Auth redirect URL");
  }

  const isExpectedOrigin = parsed.origin === expectedOrigin.origin;
  const isAllowedLocalhost =
    allowLocalhost &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
    (parsed.protocol === "http:" || parsed.protocol === "https:");
  if (!isExpectedOrigin && !isAllowedLocalhost) {
    throw new AuthMailPayloadError("invalid_redirect_origin", "Auth redirect origin is not allowed");
  }

  parsed.hash = "";
  parsed.searchParams.delete("token");
  parsed.searchParams.delete("token_hash");
  parsed.searchParams.delete("type");
  parsed.searchParams.delete("email");
  return parsed;
}

function localizedFinishPath(action: "invite" | "recovery", language: string) {
  const base = action === "invite" ? "/auth/finish-invite" : "/auth/finish-reset";
  return LANGUAGE_PATTERN.test(language) ? `${base}/${language}` : base;
}

function buildAuthActionUrl(args: {
  action: AuthEmailAction;
  tokenHash: string;
  recipient: string;
  redirectTo: string;
  appOrigin: string;
  allowLocalhost: boolean;
  language: string;
}) {
  if (!args.tokenHash) {
    throw new AuthMailPayloadError("missing_token_hash", "Auth email token hash is missing");
  }
  const redirect = validatedRedirect(args.redirectTo, args.appOrigin, args.allowLocalhost);
  const app = allowedAppOrigin(args.appOrigin);

  if (args.action === "invite" || args.action === "recovery") {
    const target = new URL(localizedFinishPath(args.action, args.language), app);
    target.searchParams.set("token_hash", args.tokenHash);
    target.searchParams.set("type", args.action);
    target.searchParams.set("email", args.recipient);
    return target.toString();
  }

  const callback = new URL("/auth/callback", app);
  callback.searchParams.set("token_hash", args.tokenHash);
  callback.searchParams.set("type", args.action);
  callback.searchParams.set("email", args.recipient);
  callback.searchParams.set("next", `${redirect.pathname}${redirect.search}`);
  return callback.toString();
}

function actionCopy(action: AuthEmailAction, language: string) {
  const english = language !== "fr";
  const copies: Record<AuthEmailAction, { subject: string; title: string; body: string; cta?: string }> = english
    ? {
        signup: { subject: "Confirm your iNrCy email", title: "Confirm your email", body: "Confirm this address to finish setting up your iNrCy account.", cta: "Confirm my email" },
        invite: { subject: "Create your iNrCy password", title: "Welcome to iNrCy", body: "Create your password to securely access your professional workspace.", cta: "Create my password" },
        magiclink: { subject: "Your iNrCy sign-in link", title: "Sign in to iNrCy", body: "Use this secure link to sign in to your workspace.", cta: "Sign in" },
        recovery: { subject: "Reset your iNrCy password", title: "Reset your password", body: "Use this secure link to choose a new password.", cta: "Reset my password" },
        email_change: { subject: "Confirm your new iNrCy email", title: "Confirm your email change", body: "Confirm this address to complete the requested email change.", cta: "Confirm the change" },
        email: { subject: "Your iNrCy verification code", title: "Verify your email", body: "Use the verification code below to continue." },
        reauthentication: { subject: "Your iNrCy security code", title: "Confirm this sensitive action", body: "Use the security code below to continue." },
        password_changed_notification: { subject: "Your iNrCy password was changed", title: "Password changed", body: "The password for your iNrCy account has just been changed." },
        email_changed_notification: { subject: "Your iNrCy email was changed", title: "Email changed", body: "The email address for your iNrCy account has just been changed." },
        phone_changed_notification: { subject: "Your iNrCy phone was changed", title: "Phone changed", body: "The phone number for your iNrCy account has just been changed." },
        identity_linked_notification: { subject: "A sign-in method was linked to iNrCy", title: "Sign-in method linked", body: "A new identity provider was linked to your iNrCy account." },
        identity_unlinked_notification: { subject: "A sign-in method was removed from iNrCy", title: "Sign-in method removed", body: "An identity provider was removed from your iNrCy account." },
        mfa_factor_enrolled_notification: { subject: "Two-factor authentication enabled on iNrCy", title: "Two-factor authentication enabled", body: "A new two-factor authentication method was added to your account." },
        mfa_factor_unenrolled_notification: { subject: "Two-factor authentication changed on iNrCy", title: "Two-factor authentication changed", body: "A two-factor authentication method was removed from your account." },
      }
    : {
        signup: { subject: "Confirmez votre e-mail iNrCy", title: "Confirmez votre adresse e-mail", body: "Confirmez cette adresse pour terminer la création de votre compte iNrCy.", cta: "Confirmer mon e-mail" },
        invite: { subject: "Créez votre mot de passe iNrCy", title: "Bienvenue sur iNrCy", body: "Créez votre mot de passe pour accéder en toute sécurité à votre espace professionnel.", cta: "Créer mon mot de passe" },
        magiclink: { subject: "Votre lien de connexion iNrCy", title: "Connectez-vous à iNrCy", body: "Utilisez ce lien sécurisé pour accéder à votre espace.", cta: "Me connecter" },
        recovery: { subject: "Réinitialisez votre mot de passe iNrCy", title: "Réinitialisez votre mot de passe", body: "Utilisez ce lien sécurisé pour choisir un nouveau mot de passe.", cta: "Réinitialiser mon mot de passe" },
        email_change: { subject: "Confirmez votre nouvel e-mail iNrCy", title: "Confirmez le changement d’e-mail", body: "Confirmez cette adresse pour terminer le changement demandé.", cta: "Confirmer le changement" },
        email: { subject: "Votre code de vérification iNrCy", title: "Vérifiez votre e-mail", body: "Utilisez le code de vérification ci-dessous pour continuer." },
        reauthentication: { subject: "Votre code de sécurité iNrCy", title: "Confirmez cette action sensible", body: "Utilisez le code de sécurité ci-dessous pour continuer." },
        password_changed_notification: { subject: "Votre mot de passe iNrCy a été modifié", title: "Mot de passe modifié", body: "Le mot de passe de votre compte iNrCy vient d’être modifié." },
        email_changed_notification: { subject: "Votre e-mail iNrCy a été modifié", title: "E-mail modifié", body: "L’adresse e-mail de votre compte iNrCy vient d’être modifiée." },
        phone_changed_notification: { subject: "Votre téléphone iNrCy a été modifié", title: "Téléphone modifié", body: "Le numéro de téléphone de votre compte iNrCy vient d’être modifié." },
        identity_linked_notification: { subject: "Une méthode de connexion a été ajoutée à iNrCy", title: "Méthode de connexion ajoutée", body: "Un nouveau fournisseur d’identité a été lié à votre compte iNrCy." },
        identity_unlinked_notification: { subject: "Une méthode de connexion a été retirée d’iNrCy", title: "Méthode de connexion retirée", body: "Un fournisseur d’identité a été retiré de votre compte iNrCy." },
        mfa_factor_enrolled_notification: { subject: "Double authentification activée sur iNrCy", title: "Double authentification activée", body: "Une nouvelle méthode de double authentification a été ajoutée à votre compte." },
        mfa_factor_unenrolled_notification: { subject: "Double authentification modifiée sur iNrCy", title: "Double authentification modifiée", body: "Une méthode de double authentification a été retirée de votre compte." },
      };
  return copies[action];
}

function emailDocument(args: {
  subject: string;
  title: string;
  body: string;
  displayName: string;
  cta?: string;
  actionUrl?: string;
  code?: string;
  language: string;
}) {
  const hello = args.language === "fr" ? "Bonjour" : "Hello";
  const greeting = args.displayName ? `${hello} ${args.displayName},` : `${hello},`;
  const safety = args.language === "fr"
    ? "Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail et contactez-nous si nécessaire."
    : "If you did not request this, ignore this email and contact us if needed.";
  const expiry = args.language === "fr"
    ? "Ce lien est personnel et temporaire. Ne le transférez pas."
    : "This link is personal and temporary. Do not forward it.";

  const actionText = args.actionUrl && args.cta
    ? `\n\n${args.cta}: ${args.actionUrl}`
    : "";
  const codeText = args.code ? `\n\n${args.code}` : "";
  const text = `${greeting}\n\n${args.body}${actionText}${codeText}\n\n${args.actionUrl ? expiry : safety}\n\nL’équipe iNrCy`;

  const actionHtml = args.actionUrl && args.cta
    ? `<p style="margin:28px 0"><a href="${escapeHtml(args.actionUrl)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:linear-gradient(90deg,#25bff5,#8a5cff,#eb3faf);color:#fff;text-decoration:none;font-weight:700">${escapeHtml(args.cta)}</a></p>`
    : "";
  const codeHtml = args.code
    ? `<div style="margin:24px 0;padding:16px;border:1px solid #384a75;border-radius:12px;background:#111c38;font-size:28px;font-weight:800;letter-spacing:6px;text-align:center;color:#fff">${escapeHtml(args.code)}</div>`
    : "";
  const html = `<!doctype html><html lang="${escapeHtml(args.language)}"><body style="margin:0;background:#071127;color:#f7f9ff;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#071127;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#0d1833;border:1px solid #26385f;border-radius:18px"><tr><td style="padding:30px"><div style="font-size:24px;font-weight:800;color:#fff">iNrCy</div><h1 style="font-size:26px;line-height:1.2;margin:28px 0 18px;color:#fff">${escapeHtml(args.title)}</h1><p style="font-size:16px;line-height:1.6;color:#dce5fa">${escapeHtml(greeting)}</p><p style="font-size:16px;line-height:1.6;color:#dce5fa">${escapeHtml(args.body)}</p>${actionHtml}${codeHtml}<p style="font-size:13px;line-height:1.6;color:#98a8c9">${escapeHtml(args.actionUrl ? expiry : safety)}</p><p style="font-size:14px;color:#dce5fa">L’équipe iNrCy</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

function deliveryIdentity(args: {
  hookId: string;
  action: AuthEmailAction;
  userId: string;
  recipient: string;
  sequence: number;
}) {
  const hookId = clean(args.hookId, 256);
  if (!hookId) {
    throw new AuthMailPayloadError("missing_webhook_id", "Supabase webhook id is missing");
  }
  const digest = createHash("sha256")
    .update(`auth-mail-v1\n${hookId}\n${args.action}\n${args.userId}\n${args.recipient}\n${args.sequence}`)
    .digest("hex");
  return {
    deliveryHash: digest,
    deliveryKey: `v1:${digest}`,
    providerIdempotencyKey: `inrcy-auth-${digest}`,
  };
}

export function buildPreparedAuthEmails(args: {
  payload: SupabaseAuthEmailHookPayload;
  hookId: string;
  appOrigin: string;
  allowLocalhost?: boolean;
}) {
  const { payload } = args;
  const action = payload.emailData.action;
  const language = authLanguage(payload.emailData.redirectTo);
  const copy = actionCopy(action, language);
  const name = displayName(payload);
  const allowLocalhost = Boolean(args.allowLocalhost);

  const candidates: Array<{ recipient: string; tokenHash?: string; code?: string }> = [];
  if (action === "email_change") {
    // Supabase intentionally exposes the secure-change hashes with historic,
    // counter-intuitive names: current email -> token_hash_new; new email -> token_hash.
    if (payload.emailData.tokenHashNew) {
      candidates.push({ recipient: payload.user.email, tokenHash: payload.emailData.tokenHashNew });
    }
    if (payload.user.newEmail && payload.emailData.tokenHash) {
      candidates.push({ recipient: payload.user.newEmail, tokenHash: payload.emailData.tokenHash });
    }
    if (candidates.length === 0 && payload.emailData.tokenHash) {
      candidates.push({ recipient: payload.user.newEmail || payload.user.email, tokenHash: payload.emailData.tokenHash });
    }
  } else if (action === "reauthentication" || action === "email") {
    if (!payload.emailData.token) {
      throw new AuthMailPayloadError("missing_otp", "Auth email OTP is missing");
    }
    candidates.push({ recipient: payload.user.email, code: payload.emailData.token });
  } else if (SECURITY_NOTIFICATION_ACTIONS.has(action)) {
    candidates.push({ recipient: payload.user.email });
  } else {
    candidates.push({ recipient: payload.user.email, tokenHash: payload.emailData.tokenHash });
  }

  if (candidates.length === 0) {
    throw new AuthMailPayloadError("missing_recipient", "No Auth email recipient was produced");
  }

  return candidates.map((candidate, sequence): PreparedAuthEmail => {
    const recipient = email(candidate.recipient);
    if (!recipient) {
      throw new AuthMailPayloadError("invalid_recipient", "Invalid Auth email recipient");
    }
    const actionUrl = candidate.tokenHash
      ? buildAuthActionUrl({
          action,
          tokenHash: candidate.tokenHash,
          recipient,
          redirectTo: payload.emailData.redirectTo,
          appOrigin: args.appOrigin,
          allowLocalhost,
          language,
        })
      : undefined;
    const document = emailDocument({
      ...copy,
      displayName: name,
      actionUrl,
      code: candidate.code,
      language,
    });
    return {
      ...deliveryIdentity({
        hookId: args.hookId,
        action,
        userId: payload.user.id,
        recipient,
        sequence,
      }),
      hookId: clean(args.hookId, 256),
      sequence,
      userId: payload.user.id,
      recipient,
      action,
      subject: copy.subject,
      text: document.text,
      html: document.html,
    };
  });
}

function tagsFromProvider(value: unknown) {
  if (Array.isArray(value)) {
    const result: Record<string, string> = {};
    for (const item of value) {
      const tag = record(item);
      const name = clean(tag.name, 256);
      if (name) result[name] = clean(tag.value, 256);
    }
    return result;
  }
  const source = record(value);
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [clean(key, 256), clean(value, 256)]),
  );
}

const PROVIDER_EVENT_STATUS: Record<string, { status: AuthEmailProviderStatus; rank: number }> = {
  "email.sent": { status: "sent", rank: 20 },
  "email.delivery_delayed": { status: "delayed", rank: 30 },
  "email.delivered": { status: "delivered", rank: 50 },
  "email.failed": { status: "failed", rank: 70 },
  "email.bounced": { status: "bounced", rank: 75 },
  "email.suppressed": { status: "suppressed", rank: 75 },
  "email.complained": { status: "complained", rank: 80 },
};

export function normalizeResendAuthEvent(input: unknown): NormalizedResendAuthEvent {
  const event = record(input);
  const eventType = clean(event.type, 80);
  const statusDefinition = PROVIDER_EVENT_STATUS[eventType];
  if (!statusDefinition) {
    return { kind: "ignored", reason: "unsupported_event" };
  }
  const data = record(event.data);
  const tags = tagsFromProvider(data.tags);
  if (tags.category !== "auth") {
    return { kind: "ignored", reason: "not_auth" };
  }

  const providerMessageId = clean(data.email_id, 256);
  if (!providerMessageId) {
    throw new AuthMailPayloadError("missing_provider_message_id", "Resend email id is missing");
  }
  const createdAtRaw = clean(event.created_at || data.created_at, 80);
  const createdAtDate = new Date(createdAtRaw);
  if (!createdAtRaw || Number.isNaN(createdAtDate.valueOf())) {
    throw new AuthMailPayloadError("invalid_provider_timestamp", "Resend event timestamp is invalid");
  }
  const deliveryHash = clean(tags.delivery_hash, 64).toLowerCase();
  const deliveryKey = DELIVERY_HASH_PATTERN.test(deliveryHash) ? `v1:${deliveryHash}` : null;

  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  if (eventType === "email.failed") {
    const failure = record(data.failed);
    errorCode = "resend_delivery_failed";
    errorMessage = safeProviderDetail(failure.reason);
  } else if (eventType === "email.bounced") {
    const bounce = record(data.bounce);
    errorCode = safeProviderDetail(`${clean(bounce.type, 60)}_${clean(bounce.subType, 60)}`) || "resend_bounced";
    errorMessage = safeProviderDetail(bounce.message);
  } else if (eventType === "email.suppressed") {
    const suppressed = record(data.suppressed);
    errorCode = safeProviderDetail(`resend_suppressed_${clean(suppressed.type, 80)}`) || "resend_suppressed";
    errorMessage = safeProviderDetail(suppressed.message);
  } else if (eventType === "email.complained") {
    errorCode = "resend_complained";
    errorMessage = "Recipient reported this authentication email as spam";
  }

  return {
    kind: "event",
    providerMessageId,
    deliveryKey,
    eventType: eventType as Extract<NormalizedResendAuthEvent, { kind: "event" }>["eventType"],
    eventCreatedAt: createdAtDate.toISOString(),
    status: statusDefinition.status,
    statusRank: statusDefinition.rank,
    errorCode,
    errorMessage,
  };
}

export function authMailStatusNeedsAlert(status: string) {
  return status === "acceptance_uncertain" || status === "failed" || status === "bounced" || status === "suppressed" || status === "complained";
}

export function redactAuthMailError(error: unknown) {
  if (error instanceof AuthMailPayloadError) {
    return { code: error.code, message: safeProviderDetail(error.message) || "Auth mail payload error" };
  }
  const source = record(error);
  const statusCode = Number(source.statusCode || source.status || 0);
  const name = clean(source.name, 120).toLowerCase();
  const rawMessage = error instanceof Error ? error.message : source.message;
  return {
    code: name || (statusCode ? `http_${statusCode}` : "auth_mail_error"),
    message: safeProviderDetail(rawMessage) || "Authentication email delivery failed",
  };
}
