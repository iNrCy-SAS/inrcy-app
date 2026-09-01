import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { optionalEnv, requireEnv } from "@/lib/env";
import { ensureNotificationPreferences, seedWelcomeNotifications } from "@/lib/notifications";
import { ensureProfileRow } from "@/lib/ensureProfileRow";
import { provisionNewAccountBubbleAccess } from "@/lib/appBubbleAccessProvisioning";
import { ensurePrincipalInrcyAccountProvisioned } from "@/lib/inrcyAccountProvisioning";
import { getClientIp, enforceRateLimit } from "@/lib/rateLimit";
import { log } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request";
import { captureApiException } from "@/lib/observability/sentry";
import { sendAdminSubscriptionAlertForUser } from "@/lib/subscriptionAdmin";
import { sendSignupFailureAlert } from "@/lib/signupFailureAlert";
import {
  getSignupFailureErrorCode,
  getSignupFailureSafeMessage,
  maskSignupEmailForLog,
  type SignupFailureStage,
} from "@/lib/signupFailureAlertPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureTrialSubscription } from "@/lib/trialSubscription";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { buildSupabaseEmailRedirectUrl } from "@/lib/authEmailLinks";
import {
  hasKnownInrcyAccountForEmail,
  isExistingAuthUserError,
} from "@/lib/supabaseAuthBusinessErrors";
import {
  createSignupFormSnapshot,
  SIGNUP_FORM_METADATA_KEY,
} from "@/lib/signupFormSnapshot";
import {
  createMetaBrowserMatch,
  createSignupAttributionSnapshot,
  getSignupAdLabel,
  getSignupCampaignLabel,
  getSignupAttributionSourceLabel,
  SIGNUP_ATTRIBUTION_METADATA_KEY,
  type MetaBrowserMatch,
  type SignupAttributionSnapshot,
} from "@/lib/signupAttribution";
import { sendMetaLeadConversion } from "@/lib/metaConversionsApi";
import { persistSignupAttribution } from "@/lib/signupAttributionPersistence";
import {
  DEFAULT_APP_LOCALE,
  appLanguageFromLocale,
  tryNormalizeAppLocale,
  type AppLanguage,
  type AppLocale,
} from "@/i18n/config";

export const runtime = "nodejs";

type LooseRecord = Record<string, unknown>;

type SignupPayload = {
  email: string;
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  consent: boolean;
  honeypot: string;
  source: string;
  language: AppLanguage;
  locale: AppLocale;
  attribution: SignupAttributionSnapshot;
  browserMatch: MetaBrowserMatch;
};

function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    },
  });
}

function isValidSignupEmail(value: string) {
  if (!value || value.length > 254 || /\s/.test(value)) return false;
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator !== value.indexOf("@")) return false;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (!local || local.length > 64 || !domain || domain.length > 253) return false;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return !domain.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"));
}

function toPlainObject(value: unknown): LooseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as LooseRecord;
}

function maybeParseStructuredString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function extractScalarStrings(input: unknown, out: Record<string, string>, parentKey = "") {
  if (input == null) return;

  if (typeof input === "string") {
    const parsed = maybeParseStructuredString(input);
    if (parsed !== input) {
      extractScalarStrings(parsed, out, parentKey);
      return;
    }
    const key = parentKey.trim();
    if (key) out[key] = input.trim();
    return;
  }

  if (typeof input === "number" || typeof input === "boolean") {
    const key = parentKey.trim();
    if (key) out[key] = String(input).trim();
    return;
  }

  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      extractScalarStrings(item, out, parentKey ? `${parentKey}[${index}]` : String(index));
    });
    return;
  }

  if (typeof input === "object") {
    for (const [rawKey, rawValue] of Object.entries(input as LooseRecord)) {
      const key = rawKey.trim();
      const nextKey = parentKey ? `${parentKey}.${key}` : key;
      extractScalarStrings(rawValue, out, nextKey);

      if (
        rawValue &&
        typeof rawValue === "object" &&
        !Array.isArray(rawValue) &&
        Object.prototype.hasOwnProperty.call(rawValue, "value")
      ) {
        const value = (rawValue as LooseRecord).value;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          out[key] = String(value).trim();
        }
      }
    }
  }
}

function normalizeLookupKey(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\]\[/g, ".")
    .replace(/\[/g, ".")
    .replace(/\]/g, "")
    .replace(/["']/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/_+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function buildLookupVariants(key: string) {
  const base = normalizeLookupKey(key);
  if (!base) return [];

  const variants = new Set<string>([base]);
  const prefixes = [
    "fields.",
    "field.",
    "form_fields.",
    "form.field.",
    "form.data.",
    "meta.",
    "data.",
    "payload.",
    "request.",
    "body.",
  ];

  let added = true;
  while (added) {
    added = false;
    for (const value of Array.from(variants)) {
      for (const prefix of prefixes) {
        if (value.startsWith(prefix)) {
          const stripped = value.slice(prefix.length);
          if (stripped && !variants.has(stripped)) {
            variants.add(stripped);
            added = true;
          }
        }
      }

      for (const suffix of [".value", ".raw_value", ".checked"]) {
        if (value.endsWith(suffix)) {
          const stripped = value.slice(0, -suffix.length);
          if (stripped && !variants.has(stripped)) {
            variants.add(stripped);
            added = true;
          }
        }
      }
    }
  }

  return Array.from(variants);
}

function lookupValue(flat: Record<string, string>, aliases: string[]) {
  const normalized = new Map<string, string>();

  for (const [key, value] of Object.entries(flat)) {
    for (const variant of buildLookupVariants(key)) {
      if (!normalized.has(variant)) normalized.set(variant, value.trim());
    }
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeLookupKey(alias);
    const match = normalized.get(normalizedAlias);
    if (match) return match;
  }

  return "";
}

function parseFormLikeEntries(entries: Iterable<[string, string]>) {
  const out: LooseRecord = {};
  for (const [key, rawValue] of entries) {
    out[key] = maybeParseStructuredString(rawValue);
  }
  return out;
}

async function readRequestBody(req: Request): Promise<LooseRecord> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return toPlainObject(await req.json().catch(() => ({})));
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const raw = await req.text().catch(() => "");
    return parseFormLikeEntries(new URLSearchParams(raw).entries());
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData().catch(() => null);
    if (!formData) return {};
    const entries: [string, string][] = Array.from(formData.entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name]);
    return parseFormLikeEntries(entries);
  }

  const raw = await req.text().catch(() => "");
  if (!raw) return {};

  try {
    return toPlainObject(JSON.parse(raw));
  } catch {
    return parseFormLikeEntries(new URLSearchParams(raw).entries());
  }
}

function normalizePayload(body: LooseRecord): SignupPayload {
  const flat: Record<string, string> = {};
  extractScalarStrings(body, flat);

  const consentRaw = lookupValue(flat, [
    "consent",
    "consentement",
    "acceptance",
    "privacy",
    "privacy_policy",
    "rgpd",
    "gdpr",
  ])
    .trim()
    .toLowerCase();

  const consent =
    !!consentRaw &&
    !["0", "false", "no", "non", "off", "unchecked"].includes(consentRaw);

  const rawLocale = lookupValue(flat, [
    "language",
    "lang",
    "locale",
    "language_code",
    "site_language",
    "wp_language",
    // TranslatePress injecte ce champ caché dans les formulaires Elementor.
    // Conserver les deux graphies protège les payloads JSON et form-data.
    "trp-form-language",
    "trp_form_language",
    "trp_language",
  ]);
  const sourcePageUrl = lookupValue(flat, [
    "page_url",
    "page-url",
    "referer",
    "referrer",
    "source_url",
  ]);
  let locale = tryNormalizeAppLocale(rawLocale);

  if (!locale && sourcePageUrl) {
    try {
      const sourceUrl = new URL(sourcePageUrl, "https://inrcy.com");
      for (const segment of sourceUrl.pathname.split("/")) {
        locale = tryNormalizeAppLocale(segment);
        if (locale) break;
      }
    } catch {
      // Une URL source invalide ne doit jamais bloquer une inscription.
    }
  }

  locale ||= DEFAULT_APP_LOCALE;

  const formSource =
    lookupValue(flat, ["source", "form_name", "form-id"]) ||
    optionalEnv("INRCY_MARKETING_SOURCE", "wordpress-elementor");
  const marketingConsent = lookupValue(flat, [
    "meta_tracking_consent",
    "marketing_consent",
    "cmplz_marketing_consent",
  ]);
  const capturedAt = lookupValue(flat, [
    "attribution_captured_at",
    "captured_at",
    "landing_timestamp",
  ]);
  const fbclid = lookupValue(flat, ["fbclid", "meta_click_id"]);
  const suppliedFbc = lookupValue(flat, ["fbc", "_fbc"]);
  const marketingConsentAccepted = [
    "1",
    "true",
    "yes",
    "oui",
    "on",
    "allow",
    "accepted",
  ].includes(marketingConsent.trim().toLowerCase());
  const derivedFbc =
    marketingConsentAccepted && fbclid
      ? `fb.1.${Date.now()}.${fbclid.slice(0, 200)}`
      : "";

  const attribution = createSignupAttributionSnapshot({
    formSource,
    utmSource: lookupValue(flat, ["utm_source"]),
    utmMedium: lookupValue(flat, ["utm_medium"]),
    utmCampaign: lookupValue(flat, ["utm_campaign"]),
    utmContent: lookupValue(flat, ["utm_content"]),
    utmTerm: lookupValue(flat, ["utm_term"]),
    campaignId: lookupValue(flat, ["campaign_id", "meta_campaign_id"]),
    campaignName: lookupValue(flat, ["campaign_name", "meta_campaign_name"]),
    adsetId: lookupValue(flat, ["adset_id", "ad_set_id", "meta_adset_id"]),
    adsetName: lookupValue(flat, ["adset_name", "ad_set_name", "meta_adset_name"]),
    adId: lookupValue(flat, ["ad_id", "meta_ad_id"]),
    adName: lookupValue(flat, ["ad_name", "meta_ad_name"]),
    placement: lookupValue(flat, ["placement", "meta_placement"]),
    siteSourceName: lookupValue(flat, ["site_source_name", "meta_site_source_name"]),
    landingPageUrl: lookupValue(flat, [
      "landing_page_url",
      "original_landing_page_url",
      "original_landing_url",
    ]),
    eventSourceUrl: lookupValue(flat, [
      "event_source_url",
      "page_url",
      "page-url",
      "source_url",
    ]),
    referrerUrl: lookupValue(flat, ["referrer_url", "referer_url", "referrer", "referer"]),
    eventId: lookupValue(flat, ["event_id", "meta_event_id"]) || `inrcy-lead-${randomUUID()}`,
    capturedAt: capturedAt || new Date().toISOString(),
    marketingConsent: marketingConsentAccepted,
  });

  return {
    email: lookupValue(flat, ["email", "e-mail", "mail", "your-email"]).trim().toLowerCase(),
    firstName: lookupValue(flat, ["first_name", "firstname", "prenom", "prénom", "first-name"]),
    lastName: lookupValue(flat, ["last_name", "lastname", "nom", "last-name"]),
    companyName: lookupValue(flat, [
      "company_name",
      "company",
      "company_legal_name",
      "societe",
      "société",
      "entreprise",
      "societe_raison_sociale",
    ]),
    phone: lookupValue(flat, ["phone", "telephone", "téléphone", "tel", "mobile", "portable"]),
    consent,
    // Honeypot anti-spam uniquement.
    // Compat: l'ancien formulaire Elementor utilisait `website` comme champ caché.
    // Ne pas ajouter ici `site_web`, `company_website` ou `url` : ce sont des vrais champs possibles.
    honeypot: lookupValue(flat, [
      "honeypot",
      "website_hp",
      "company_website_hp",
      "inrcy_honeypot",
      "inrcy_hp",
      "hp",
      "website",
    ]),
    source: formSource,
    language: appLanguageFromLocale(locale),
    locale,
    attribution,
    browserMatch: createMetaBrowserMatch({
      fbp: marketingConsentAccepted ? lookupValue(flat, ["fbp", "_fbp"]) : "",
      fbc: marketingConsentAccepted ? suppliedFbc || derivedFbc : "",
      clientUserAgent: marketingConsentAccepted
        ? lookupValue(flat, ["client_user_agent", "browser_user_agent"])
        : "",
    }),
  };
}

function resolveSharedSecret(req: Request, body: LooseRecord) {
  const url = new URL(req.url);
  const bodySecret = String((body.token ?? body.secret ?? body.webhook_secret ?? "") || "").trim();
  return (
    req.headers.get("x-trial-signup-secret") ||
    req.headers.get("x-admin-secret") ||
    url.searchParams.get("token") ||
    bodySecret ||
    ""
  ).trim();
}

export async function POST(req: Request) {
  const requestId = getRequestId(req) || randomUUID();
  let payload: SignupPayload | null = null;
  let acceptedAttempt = false;
  let stage: SignupFailureStage = "unknown";
  let authUserCreated = false;
  let userId: string | null = null;

  try {
    const body = await readRequestBody(req);
    payload = normalizePayload(body);

    const expectedSecret = requireEnv("INRCY_TRIAL_SIGNUP_SECRET").trim();
    const gotSecret = resolveSharedSecret(req, body);
    if (gotSecret !== expectedSecret) {
      return jsonResponse({ error: "Accès non autorisé.", message: "Accès non autorisé." }, 401);
    }

    const limited = await enforceRateLimit({
      name: "public_trial_signup",
      identifier: `${getClientIp(req)}:${payload.email || "unknown"}`,
      limit: 8,
      window: "10 m",
      failClosed: false,
    });
    if (limited) return limited;

    if (payload.honeypot) {
      return jsonResponse({ ok: true });
    }

    if (!payload.email) {
      return jsonResponse({ error: "Email manquant.", message: "Email manquant." }, 400);
    }

    if (!isValidSignupEmail(payload.email)) {
      return jsonResponse({ error: "Adresse email invalide.", message: "Adresse email invalide." }, 400);
    }

    if (!payload.consent) {
      return jsonResponse({
        error: "Le consentement est obligatoire.",
        message: "Le consentement est obligatoire.",
      }, 400);
    }

    acceptedAttempt = true;
    const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://app.inrcy.com").replace(/\/$/, "");
    const inviteRedirectUrl = buildSupabaseEmailRedirectUrl(
      appOrigin,
      "/auth/finish-invite",
      payload.language,
    );

    stage = "account_lookup";
    if (await hasKnownInrcyAccountForEmail(payload.email)) {
      return jsonResponse(
        {
          error:
            "Un compte existe déjà avec cet email. Le professionnel peut se connecter directement ou utiliser “Mot de passe oublié”.",
        },
        409,
      );
    }

    const signupFormSnapshot = createSignupFormSnapshot({
      lastName: payload.lastName,
      firstName: payload.firstName,
      email: payload.email,
      companyName: payload.companyName,
      phone: payload.phone,
      consent: payload.consent,
    });

    stage = "auth_invitation";
    const { data: invite, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(payload.email, {
      data: {
        first_name: payload.firstName || undefined,
        last_name: payload.lastName || undefined,
        company_legal_name: payload.companyName || undefined,
        phone: payload.phone || undefined,
        source: payload.source || undefined,
        app_language: payload.language,
        app_locale: payload.locale,
        [SIGNUP_FORM_METADATA_KEY]: signupFormSnapshot,
        [SIGNUP_ATTRIBUTION_METADATA_KEY]: payload.attribution,
      },
      redirectTo: inviteRedirectUrl,
    });

    if (inviteError) {
      if (isExistingAuthUserError(inviteError)) {
        return jsonResponse(
          {
            error:
              "Un compte existe déjà avec cet email. Le professionnel peut se connecter directement ou utiliser “Mot de passe oublié”.",
          },
          409
        );
      }
      throw inviteError;
    }

    const invitedUser = invite.user;
    userId = invitedUser?.id || null;
    if (!userId) throw new Error("supabase_invitation_user_missing");
    authUserCreated = true;
    const nowIso = new Date().toISOString();

    // Postcondition obligatoire : l'invitation ne peut être déclarée réussie
    // sans établissement principal, membership ni configuration multicompte.
    stage = "profile_bootstrap";
    await ensurePrincipalInrcyAccountProvisioned(invitedUser);

    // Apply authoritative defaults after the Auth trigger has completed.
    // In particular, Site iNrCy must remain opt-in (false) for every new account.
    stage = "bubble_access";
    await provisionNewAccountBubbleAccess(userId);
    stage = "profile_bootstrap";
    await ensureProfileRow(invitedUser);

    const profilePatch: LooseRecord = {
      user_id: userId,
      admin_email: payload.email,
      contact_email: payload.email,
      updated_at: nowIso,
    };
    if (payload.firstName) profilePatch.first_name = payload.firstName;
    if (payload.lastName) profilePatch.last_name = payload.lastName;
    if (payload.companyName) profilePatch.company_legal_name = payload.companyName;
    if (payload.phone) profilePatch.phone = payload.phone;

    stage = "profile_update";
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(profilePatch, { onConflict: "user_id" });
    if (profileError) throw profileError;

    stage = "business_profile_update";
    const { error: languageProfileError } = await supabaseAdmin
      .from("business_profiles")
      .upsert(
        {
          user_id: userId,
          app_language: payload.language,
          updated_at: nowIso,
        },
        { onConflict: "user_id" },
      );
    if (languageProfileError) throw languageProfileError;

    stage = "notification_preferences";
    await ensureNotificationPreferences(userId);
    stage = "welcome_notifications";
    await seedWelcomeNotifications(userId);
    stage = "trial_subscription";
    const { edition, trialDays, end } = await ensureTrialSubscription(userId, payload.email);

    const capiResult = await sendMetaLeadConversion({
      userId,
      email: payload.email,
      phone: payload.phone,
      firstName: payload.firstName,
      lastName: payload.lastName,
      attribution: payload.attribution,
      browserMatch: payload.browserMatch,
    });

    await persistSignupAttribution({
      userId,
      attribution: payload.attribution,
      capi: capiResult,
    }).catch((error: unknown) => {
      console.error(
        "[trial-signup][attribution]",
        error instanceof Error ? error.message : "persistence_failed",
      );
    });

    await sendAdminSubscriptionAlertForUser({
      type: "trial_started",
      source: payload.source || "wordpress-elementor",
      userId,
      accountEmail: payload.email,
      profileContactEmail: payload.email,
      plan: "Trial",
      status: "trialing",
      trialEndAt: end.toISOString(),
      note: [
        payload.firstName || payload.lastName
          ? `Contact: ${[payload.firstName, payload.lastName].filter(Boolean).join(" ")}`
          : null,
        payload.companyName ? `Société: ${payload.companyName}` : null,
        payload.phone ? `Téléphone: ${payload.phone}` : null,
        `Acquisition: ${getSignupAttributionSourceLabel(payload.attribution)}`,
        getSignupCampaignLabel(payload.attribution)
          ? `Campagne: ${getSignupCampaignLabel(payload.attribution)}`
          : null,
        getSignupAdLabel(payload.attribution)
          ? `Publicité: ${getSignupAdLabel(payload.attribution)}`
          : null,
        "Consentement RGPD coché",
      ]
        .filter(Boolean)
        .join(" | "),
    }).catch(() => null);

    return jsonResponse({
      ok: true,
      user_id: userId,
      app_edition: edition,
      trial_days: trialDays,
      trial_end_at: end.toISOString(),
      message: "Invitation envoyée. Le professionnel peut créer son mot de passe depuis l'email reçu.",
    });
  } catch (error: unknown) {
    const errorCode = getSignupFailureErrorCode(error);
    const safeErrorMessage = getSignupFailureSafeMessage(error);
    const canAlert = acceptedAttempt && payload !== null;
    let alertDelivery: "not-applicable" | "pending" | "sent" | "deduplicated" | "failed" =
      canAlert ? "pending" : "not-applicable";

    log.error("trial_signup_failed", {
      request_id: requestId,
      route: "/api/public/trial-signup",
      status_code: 500,
      stage,
      user_id: userId || undefined,
      auth_user_created: authUserCreated,
      email_masked: maskSignupEmailForLog(payload?.email),
      source: String(payload?.source || "wordpress-elementor").slice(0, 100),
      error_code: errorCode,
      error_message: safeErrorMessage,
      alert_delivery: alertDelivery,
    });
    captureApiException(req, error, {
      area: "auth",
      operation: "POST /api/public/trial-signup",
      statusCode: 500,
      userId,
      stage,
      authUserCreated,
      errorCode,
    });

    if (canAlert && payload) {
      const alertInput = {
        source: payload.source || "wordpress-elementor",
        stage,
        requestId,
        occurredAt: new Date().toISOString(),
        userId,
        authUserCreated,
        contact: {
          email: payload.email,
          firstName: payload.firstName,
          lastName: payload.lastName,
          companyName: payload.companyName,
          phone: payload.phone,
          consent: payload.consent,
        },
        errorCode,
        errorMessage: safeErrorMessage,
      } as const;

      try {
        const result = await sendSignupFailureAlert(alertInput);
        alertDelivery = result.inFlight
          ? "pending"
          : result.deduplicated
            ? "deduplicated"
            : "sent";
        log.info(
          result.inFlight
            ? "trial_signup_failure_alert_pending"
            : result.deduplicated
              ? "trial_signup_failure_alert_deduplicated"
              : "trial_signup_failure_alert_sent",
          {
            request_id: requestId,
            stage,
            user_id: userId || undefined,
            email_masked: maskSignupEmailForLog(payload?.email),
          },
        );
      } catch (alertError) {
        alertDelivery = "failed";
        log.error("trial_signup_failure_alert_failed", {
          request_id: requestId,
          stage,
          user_id: userId || undefined,
          email_masked: maskSignupEmailForLog(payload?.email),
          error_code: getSignupFailureErrorCode(alertError),
          error_message: getSignupFailureSafeMessage(alertError),
        });
        captureApiException(req, alertError, {
          area: "auth",
          operation: "signup failure alert delivery",
          statusCode: 500,
          userId,
          stage,
        });
      }
    }

    const message = getSimpleFrenchErrorMessage(
      error,
      "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes."
    );
    return jsonResponse(
      {
        error: message,
        request_id: requestId,
        alert_delivery: alertDelivery,
        alert_sent: alertDelivery === "sent",
        alert_deduplicated: alertDelivery === "deduplicated",
      },
      500,
      {
        "X-Request-Id": requestId,
        "X-InrCy-Signup-Alert": alertDelivery,
      },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
      "Cache-Control": "no-store",
    },
  });
}
