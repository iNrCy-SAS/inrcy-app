import { getBoosterLinkCtaAction, isBoosterLinkCtaChoice, type BoosterLinkCtaChoice } from "@/lib/boosterCtaActions";
import { BOOSTER_ASIAN_CTA_LABELS } from "@/lib/boosterAsianCtaLabels";
import { resolveAiChannelCtaMap, type AiChannelCtaMap, type AiCtaChannel } from "@/lib/aiChannelCtaPreferences";
import type {
  BoosterChannelKey,
  BoosterCtaMode,
  BoosterPostLike,
} from "@/lib/boosterCta";
import {
  getSupportedBoosterCtaModesForChannel,
  isBoosterCtaLabelCompatibleWithMode,
  isBoosterCtaModeSupportedForChannel,
} from "@/lib/boosterCta";
import {
  buildBoosterWhatsAppUrl,
  getBoosterWhatsAppPhoneFromUrl,
  isBoosterWhatsAppUrl,
} from "@/lib/boosterWhatsappCta";

export type BoosterPreferredCta =
  | "none"
  | "site"
  | "devis"
  | "appeler"
  | "message"
  | "whatsapp"
  | "custom"
  | BoosterLinkCtaChoice;

export type BoosterAiLanguage =
  | "fr"
  | "en"
  | "es"
  | "it"
  | "de"
  | "nl"
  | "pt"
  | "th"
  | "zh";

export type BoosterCtaDefaults = {
  preferredWebsiteUrl: string;
  preferredWebsiteLabel: string;
  siteWebUrl: string;
  phone: string;
  preferredCta: BoosterPreferredCta;
  aiLanguage?: BoosterAiLanguage;
  channelCtas?: AiChannelCtaMap;
  youtubeAutoHashtags?: boolean;
};

export type BoosterStructuredCtaPatch = {
  ctaMode: BoosterCtaMode;
  cta: string;
  ctaUrl: string;
  ctaPhone: string;
  ctaAction?: string;
};

const PREFERRED_CTA_VALUES = new Set<BoosterPreferredCta>([
  "none",
  "site",
  "devis",
  "appeler",
  "message",
  "whatsapp",
  "custom",
  "reserver",
  "commander",
  "acheter",
  "inscrire",
]);

const PREFERRED_CTA_MODE: Record<BoosterPreferredCta, BoosterCtaMode> = {
  none: "none",
  site: "website",
  devis: "website",
  appeler: "call",
  message: "message",
  whatsapp: "custom",
  custom: "custom",
  reserver: "website",
  commander: "website",
  acheter: "website",
  inscrire: "website",
};

export function getSupportedPreferredCtasForChannel(
  channel: BoosterChannelKey,
): BoosterPreferredCta[] {
  const modes = getSupportedBoosterCtaModesForChannel(channel);
  return Array.from(PREFERRED_CTA_VALUES).filter((choice) =>
    modes.includes(PREFERRED_CTA_MODE[choice]),
  );
}

export function isBoosterPreferredCtaSupportedForChannel(
  channel: BoosterChannelKey,
  choice: BoosterPreferredCta,
) {
  return isBoosterCtaModeSupportedForChannel(
    channel,
    PREFERRED_CTA_MODE[choice],
  );
}

const AI_LANGUAGE_VALUES = new Set<BoosterAiLanguage>([
  "fr",
  "en",
  "es",
  "it",
  "de",
  "nl",
  "pt",
  "th",
  "zh",
]);

const CTA_LABELS_BY_LANGUAGE: Record<
  BoosterAiLanguage,
  Record<BoosterPreferredCta, string>
> = {
  fr: {
    none: "",
    reserver: "Réserver",
    commander: "Commander",
    acheter: "Acheter",
    inscrire: "S’inscrire",
    site: "Voir le site",
    devis: "Demander un devis",
    appeler: "Appeler",
    message: "Envoyer un message",
    whatsapp: "Écrire sur WhatsApp",
    custom: "",
  },
  en: {
    none: "",
    reserver: "Book now",
    commander: "Order now",
    acheter: "Shop now",
    inscrire: "Sign up",
    site: "Visit website",
    devis: "Request a quote",
    appeler: "Call",
    message: "Send a message",
    whatsapp: "Message us on WhatsApp",
    custom: "",
  },
  es: {
    none: "",
    reserver: "Reservar",
    commander: "Hacer un pedido",
    acheter: "Comprar",
    inscrire: "Registrarse",
    site: "Ver sitio web",
    devis: "Solicitar presupuesto",
    appeler: "Llamar",
    message: "Enviar mensaje",
    whatsapp: "Escribir por WhatsApp",
    custom: "",
  },
  it: {
    none: "",
    reserver: "Prenota",
    commander: "Ordina",
    acheter: "Acquista",
    inscrire: "Iscriviti",
    site: "Visita il sito",
    devis: "Richiedi un preventivo",
    appeler: "Chiama",
    message: "Invia un messaggio",
    whatsapp: "Scrivici su WhatsApp",
    custom: "",
  },
  de: {
    none: "",
    reserver: "Jetzt buchen",
    commander: "Bestellen",
    acheter: "Einkaufen",
    inscrire: "Registrieren",
    site: "Website ansehen",
    devis: "Angebot anfordern",
    appeler: "Anrufen",
    message: "Nachricht senden",
    whatsapp: "Über WhatsApp schreiben",
    custom: "",
  },
  nl: {
    none: "",
    reserver: "Reserveren",
    commander: "Bestellen",
    acheter: "Kopen",
    inscrire: "Aanmelden",
    site: "Website bekijken",
    devis: "Offerte aanvragen",
    appeler: "Bellen",
    message: "Bericht sturen",
    whatsapp: "Stuur een WhatsApp-bericht",
    custom: "",
  },
  pt: {
    none: "",
    reserver: "Reservar",
    commander: "Encomendar",
    acheter: "Comprar",
    inscrire: "Inscrever-se",
    site: "Ver site",
    devis: "Pedir orçamento",
    appeler: "Ligar",
    message: "Enviar mensagem",
    whatsapp: "Enviar mensagem no WhatsApp",
    custom: "",
  },
  th: BOOSTER_ASIAN_CTA_LABELS.th,
  zh: BOOSTER_ASIAN_CTA_LABELS.zh,
};

function cleanText(value: unknown, maxLength = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeBoosterPreferredCta(
  value: unknown,
): BoosterPreferredCta {
  const raw = cleanText(value).toLowerCase() as BoosterPreferredCta;
  return PREFERRED_CTA_VALUES.has(raw) ? raw : "devis";
}

export function normalizeBoosterAiLanguage(
  value: unknown,
): BoosterAiLanguage {
  const raw = cleanText(value).toLowerCase();
  if (AI_LANGUAGE_VALUES.has(raw as BoosterAiLanguage)) {
    return raw as BoosterAiLanguage;
  }
  if (["english", "anglais"].includes(raw)) return "en";
  if (["spanish", "espagnol"].includes(raw)) return "es";
  if (["italian", "italien"].includes(raw)) return "it";
  if (["german", "allemand"].includes(raw)) return "de";
  if (["dutch", "neerlandais", "néerlandais"].includes(raw)) return "nl";
  if (["portuguese", "portugais"].includes(raw)) return "pt";
  if (["thai", "thailandais", "thaïlandais", "ภาษาไทย", "th-th"].includes(raw)) {
    return "th";
  }
  if (
    [
      "chinese",
      "simplified chinese",
      "chinois",
      "chinois simplifié",
      "中文",
      "简体中文",
      "zh-cn",
      "zh_cn",
      "zh-hans",
    ].includes(raw)
  ) {
    return "zh";
  }
  return "fr";
}

export function getPreferredCtaLabel(
  choice: BoosterPreferredCta,
  language: unknown,
) {
  const normalizedLanguage = normalizeBoosterAiLanguage(language);
  return (
    CTA_LABELS_BY_LANGUAGE[normalizedLanguage][choice] ||
    CTA_LABELS_BY_LANGUAGE.fr[choice] ||
    ""
  );
}

export function normalizeCtaWebsiteUrl(value: unknown) {
  const raw = cleanText(value, 2048);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  if (/^[^\s]+\.[^\s]+/.test(raw)) return `https://${raw}`;
  return "";
}

export function normalizeCtaPhone(value: unknown) {
  const phone = cleanText(value, 48)
    .replace(/[^\d+().\-\s]/g, "")
    .trim();
  const digitCount = phone.replace(/\D/g, "").length;
  return digitCount >= 8 && digitCount <= 15 ? phone : "";
}

export function getPreferredWebsiteUrlForChannel(
  channel: BoosterChannelKey,
  defaults: BoosterCtaDefaults | null | undefined,
) {
  if (!defaults) return "";
  const siteWebUrl = normalizeCtaWebsiteUrl(defaults.siteWebUrl);
  const preferredWebsiteUrl = normalizeCtaWebsiteUrl(
    defaults.preferredWebsiteUrl,
  );

  if (channel === "site_web") return siteWebUrl || preferredWebsiteUrl;
  return preferredWebsiteUrl || siteWebUrl;
}

function emptyCta(): BoosterStructuredCtaPatch {
  return { ctaMode: "none", cta: "", ctaUrl: "", ctaPhone: "", ctaAction: "" };
}

function resolveUsablePreferredCtaChoice(args: {
  channel: BoosterChannelKey;
  choice: BoosterPreferredCta;
  websiteUrl: string;
  phone: string;
  customUrl: string;
  hasWhatsAppUrl: boolean;
  allowIncompleteInput: boolean;
}): BoosterPreferredCta {
  if (args.choice === "none") return "none";

  const supported = isBoosterPreferredCtaSupportedForChannel(
    args.channel,
    args.choice,
  );
  const hasRequiredData =
    isBoosterLinkCtaChoice(args.choice) ? Boolean(args.customUrl) :
    args.choice === "site" || args.choice === "devis"
      ? Boolean(args.websiteUrl)
      : args.choice === "appeler"
        ? Boolean(args.phone)
        : args.choice === "whatsapp"
          ? Boolean(args.phone || args.hasWhatsAppUrl)
          : args.choice === "custom"
            ? Boolean(args.customUrl)
            : true;

  if (supported && (hasRequiredData || args.allowIncompleteInput)) {
    return args.choice;
  }

  // A booking/order/shop/signup link must be supplied explicitly.
  if (isBoosterLinkCtaChoice(args.choice)) return "none";

  if (
    args.websiteUrl &&
    isBoosterPreferredCtaSupportedForChannel(args.channel, "site")
  ) {
    return "site";
  }
  if (
    args.phone &&
    isBoosterPreferredCtaSupportedForChannel(args.channel, "appeler")
  ) {
    return "appeler";
  }
  if (isBoosterPreferredCtaSupportedForChannel(args.channel, "message")) {
    return "message";
  }
  return "none";
}

export function buildSafePreferredCtaPatch(args: {
  channel: BoosterChannelKey;
  choice: unknown;
  defaults: BoosterCtaDefaults | null | undefined;
  post?: Partial<BoosterPostLike> | null;
  language?: unknown;
  allowIncompleteInput?: boolean;
}): BoosterStructuredCtaPatch {
  const requestedChoice = normalizeBoosterPreferredCta(args.choice);
  const language = args.language || args.defaults?.aiLanguage || "fr";
  const websiteUrl = getPreferredWebsiteUrlForChannel(
    args.channel,
    args.defaults,
  );
  const phone = normalizeCtaPhone(
    args.post?.ctaPhone || args.defaults?.phone,
  );
  const customUrl = normalizeCtaWebsiteUrl(args.post?.ctaUrl);
  const choice = resolveUsablePreferredCtaChoice({
    channel: args.channel,
    choice: requestedChoice,
    websiteUrl,
    phone,
    customUrl,
    hasWhatsAppUrl: isBoosterWhatsAppUrl(customUrl),
    allowIncompleteInput: args.allowIncompleteInput === true,
  });

  if (choice === "none") return emptyCta();

  if (isBoosterLinkCtaChoice(choice)) {
    return { ctaMode: "website", cta: getPreferredCtaLabel(choice, language), ctaUrl: customUrl, ctaPhone: "", ctaAction: getBoosterLinkCtaAction(choice) };
  }

  if (choice === "site" || choice === "devis") {
    if (!websiteUrl && args.allowIncompleteInput !== true) return emptyCta();
    return {
      ctaMode: "website",
      cta: getPreferredCtaLabel(choice, language),
      ctaUrl: websiteUrl,
      ctaPhone: "",
      ctaAction: "",
    };
  }

  if (choice === "appeler") {
    if (phone) {
      return {
        ctaMode: "call",
        cta: getPreferredCtaLabel("appeler", language),
        ctaUrl: "",
        ctaPhone: phone,
        ctaAction: "",
      };
    }
    if (args.allowIncompleteInput === true) {
      return {
        ctaMode: "call",
        cta: getPreferredCtaLabel("appeler", language),
        ctaUrl: "",
        ctaPhone: "",
        ctaAction: "",
      };
    }
    if (!websiteUrl) return emptyCta();
    return {
      ctaMode: "website",
      cta: getPreferredCtaLabel("site", language),
      ctaUrl: websiteUrl,
      ctaPhone: "",
      ctaAction: "",
    };
  }

  if (choice === "message") {
    if (args.channel !== "gmb") {
      return {
        ctaMode: "message",
        cta: getPreferredCtaLabel("message", language),
        ctaUrl: "",
        ctaPhone: "",
        ctaAction: "",
      };
    }
    if (!websiteUrl) return emptyCta();
    return {
      ctaMode: "website",
      cta: getPreferredCtaLabel("site", language),
      ctaUrl: websiteUrl,
      ctaPhone: "",
      ctaAction: "",
    };
  }

  if (choice === "whatsapp") {
    const existingUrl = normalizeCtaWebsiteUrl(args.post?.ctaUrl);
    const existingWhatsAppPhone = getBoosterWhatsAppPhoneFromUrl(existingUrl);
    const whatsappPhone = phone || existingWhatsAppPhone;
    const whatsappUrl = isBoosterWhatsAppUrl(existingUrl)
      ? existingUrl
      : buildBoosterWhatsAppUrl(whatsappPhone);
    return {
      ctaMode: "custom",
      cta: getPreferredCtaLabel("whatsapp", language),
      ctaUrl: whatsappUrl,
      ctaPhone: whatsappPhone,
      ctaAction: "",
    };
  }

  if (!customUrl && args.allowIncompleteInput !== true) return emptyCta();
  return {
    ctaMode: "custom",
    cta: cleanText(args.post?.cta),
    ctaUrl: customUrl,
    ctaPhone: "",
    ctaAction: "",
  };
}

function hasUsableExplicitStructuredCta(
  channel: BoosterChannelKey,
  post: Partial<BoosterPostLike>,
) {
  const mode = cleanText(post.ctaMode) as BoosterCtaMode;
  if (mode === "none") return true;
  if (!isBoosterCtaModeSupportedForChannel(channel, mode)) return false;
  if (!isBoosterCtaLabelCompatibleWithMode(mode, post.cta)) return false;
  if (mode === "website" || mode === "custom") {
    return Boolean(normalizeCtaWebsiteUrl(post.ctaUrl));
  }
  if (mode === "call") return Boolean(normalizeCtaPhone(post.ctaPhone));
  if (mode === "message") return channel !== "gmb";
  return false;
}

export function applySafePreferredCta<T extends BoosterPostLike>(args: {
  channel: BoosterChannelKey;
  post: T;
  defaults: BoosterCtaDefaults | null | undefined;
  preserveExplicit?: boolean;
}): T {
  const configured = resolveAiChannelCtaMap(args.defaults?.channelCtas, args.defaults)[
    args.channel as AiCtaChannel
  ];
  if (!configured) {
    // No usable destination or supported explicit setting: do not invent a CTA.
    // A saved/manual publication keeps its own CTA, including an explicit none.
    return args.preserveExplicit === false
      ? { ...args.post, ...emptyCta() }
      : args.post;
  }

  const explicitMode = cleanText(args.post.ctaMode);
  if (args.preserveExplicit !== false && !explicitMode &&
    (cleanText(args.post.title) || cleanText(args.post.content))) {
    return args.post;
  }
  if (
    args.preserveExplicit !== false &&
    explicitMode &&
    hasUsableExplicitStructuredCta(args.channel, args.post)
  ) {
    return args.post;
  }

  const choice = configured.choice;
  const label = configured.label || getPreferredCtaLabel(choice, args.defaults?.aiLanguage);
  const websiteUrl = normalizeCtaWebsiteUrl(
    configured.url || getPreferredWebsiteUrlForChannel(args.channel, args.defaults),
  );
  const phone = normalizeCtaPhone(configured.phone || args.defaults?.phone);
  let patch: BoosterStructuredCtaPatch = emptyCta();
  if (isBoosterLinkCtaChoice(choice)) {
    const url = normalizeCtaWebsiteUrl(configured.url);
    if (url) patch = { ctaMode: "website", cta: label, ctaUrl: url, ctaPhone: "", ctaAction: getBoosterLinkCtaAction(choice) };
  } else if (choice === "site" || choice === "devis") {
    if (websiteUrl) {
      patch = { ctaMode: "website", cta: label, ctaUrl: websiteUrl, ctaPhone: "" };
    }
  } else if (choice === "appeler") {
    if (phone) patch = { ctaMode: "call", cta: label, ctaUrl: "", ctaPhone: phone };
  } else if (choice === "message") {
    patch = { ctaMode: "message", cta: label, ctaUrl: "", ctaPhone: "" };
  } else if (choice === "whatsapp") {
    const whatsappUrl = isBoosterWhatsAppUrl(configured.url)
      ? configured.url
      : buildBoosterWhatsAppUrl(phone);
    if (whatsappUrl) {
      patch = { ctaMode: "custom", cta: label, ctaUrl: whatsappUrl, ctaPhone: phone };
    }
  } else if (choice === "custom") {
    const customUrl = normalizeCtaWebsiteUrl(configured.url);
    if (customUrl) {
      patch = { ctaMode: "custom", cta: label, ctaUrl: customUrl, ctaPhone: "" };
    }
  }
  return { ...args.post, ctaAction: "", ...patch };
}
