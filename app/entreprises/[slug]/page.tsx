import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import {
  buildInrSearchProfessionUrl,
  buildInrSearchPublicUrl,
  loadInrSearchPublicPage,
  normalizeInrSearchDirectorySlug,
  type InrSearchPublicPageData,
} from "@/lib/inrSearchPublic";
import styles from "./inrSearchPublic.module.css";
import InrSearchAnalyticsClient from "./InrSearchAnalyticsClient";
import InrSearchExperience from "./InrSearchExperience";
import InrSearchLogo from "./InrSearchLogo";
import InrSearchNewsShowcase from "./InrSearchNewsShowcase";
import InrSearchServicesOrbit from "./InrSearchServicesOrbit";
import InrSearchGalleryOrbit from "./InrSearchGalleryOrbit";
import InrSearchZoneOrbit from "./InrSearchZoneOrbit";
import InrSearchFaqOrbit from "./InrSearchFaqOrbit";
import InrSearchContactOrbit from "./InrSearchContactOrbit";
import InrSearchVisualIdentity from "./InrSearchVisualIdentity";
import InrSearchSocialOrbit from "./InrSearchSocialOrbit";
import InrSearchStrengthsOrbit from "./InrSearchStrengthsOrbit";
import { buildOpeningHoursSpecifications } from "@/lib/openingSchedule";
import {
  buildInrSearchFallbackPalette,
  inferInrSearchVisualTheme,
  rgbTriplet,
} from "@/lib/inrSearchVisualIdentity";

// Keep the route itself dynamic so a transient cold-start failure can never
// persist a false 404. The data loader still caches successful public pages
// for five minutes and publication flows invalidate that cache explicitly.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string }>;
};

type IconName =
  | "arrow"
  | "calendar"
  | "check"
  | "clock"
  | "email"
  | "globe"
  | "location"
  | "phone"
  | "qr"
  | "search"
  | "services"
  | "sparkles"
  | "users";

function Icon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths: Record<IconName, ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14" {...common} />
        <path d="m14 7 5 5-5 5" {...common} />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" {...common} />
        <path d="M8 3v4M16 3v4M3 10h18" {...common} />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" {...common} />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" {...common} />
        <path d="M12 7v5l3 2" {...common} />
      </>
    ),
    email: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" {...common} />
        <path d="m4 7 8 6 8-6" {...common} />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" {...common} />
        <path
          d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"
          {...common}
        />
      </>
    ),
    location: (
      <>
        <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" {...common} />
        <circle cx="12" cy="10" r="2.5" {...common} />
      </>
    ),
    phone: (
      <path
        d="M8.2 3.8 10 8.2 7.7 10a15 15 0 0 0 6.3 6.3l1.8-2.3 4.4 1.8v3.3c0 1-.8 1.8-1.8 1.8C9.9 20.9 3.1 14.1 3.1 5.6c0-1 .8-1.8 1.8-1.8h3.3Z"
        {...common}
      />
    ),
    qr: (
      <>
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" {...common} />
        <path d="M14 14h2v2h-2zM18 14h2v4h-2zM14 18h4v2h-4z" {...common} />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" {...common} />
        <path d="m15.5 15.5 5 5" {...common} />
      </>
    ),
    services: (
      <>
        <path d="M4 7h16M4 12h10M4 17h13" {...common} />
        <circle cx="19" cy="17" r="2" {...common} />
      </>
    ),
    sparkles: (
      <>
        <path
          d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"
          {...common}
        />
        <path
          d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 12l.6 1.4L21 14l-1.4.6L19 16l-.6-1.4L17 14l1.4-.6L19 12Z"
          {...common}
        />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...common} />
        <circle cx="9" cy="7" r="4" {...common} />
        <path
          d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"
          {...common}
        />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function joinLocalizedList(values: string[], locale = "fr-FR") {
  const cleanValues = values.map((value) => value.trim()).filter(Boolean);
  if (!cleanValues.length) return "";
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(cleanValues);
}

function lowerInitial(value: string, locale = "fr-FR") {
  if (!value) return value;
  return value.slice(0, 1).toLocaleLowerCase(locale) + value.slice(1);
}

function normalizeServiceDescriptionKey(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashText(value: string) {
  return Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function pickVariant(values: string[], seed: string) {
  return values[hashText(seed) % values.length];
}

function storedServiceDescription(service: string, data: InrSearchPublicPageData) {
  const key = normalizeServiceDescriptionKey(service);
  return (
    data.serviceDescriptions[service] ||
    data.serviceDescriptions[key] ||
    ""
  ).trim();
}

function buildFactualSummary(data: InrSearchPublicPageData, i18nT: (_key: string, _values?: Record<string, string>) => string, locale: string) {
  const identity = [
    data.companyName,
    data.profession
      ? i18nT("exerce_l_activite_de_value_f7f3f9fc", { value0: lowerInitial(data.profession, locale) })
      : data.sectorLabel
        ? i18nT("exerce_dans_le_secteur_value_3680f396", { value0: lowerInitial(data.sectorLabel, locale) })
        : i18nT("est_une_entreprise_2774c8db"),
    data.city ? i18nT("situee_a_value_5ce1fb79", { value0: data.city }) : "",
  ]
    .filter(Boolean)
    .join(" ");

  const serviceSentence = data.services.length
    ? i18nT("elle_propose_notamment_les_prestations_suivantes_401d6823", { value0: joinLocalizedList(data.services.slice(0, 5), locale) })
    : "";
  const zoneSentence = data.zones.length
    ? i18nT("elle_intervient_notamment_dans_les_zones_33195e40", { value0: joinLocalizedList(data.zones.slice(0, 8), locale) })
    : "";
  const audienceSentence = data.customerTypes.length
    ? i18nT("ses_prestations_s_adressent_notamment_aux_a595758d", { value0: joinLocalizedList(data.customerTypes.map((value) => lowerInitial(value, locale)), locale) })
    : "";
  const hoursSentence =
    data.openingDays || data.openingHours
      ? i18nT("l_entreprise_est_joignable_value_2b382674", { value0: [data.openingDays, data.openingHours].filter(Boolean).join(", ") })
      : "";

  return [
    `${identity}.`,
    serviceSentence,
    zoneSentence,
    audienceSentence,
    hoursSentence,
  ]
    .filter(Boolean)
    .join(" ");
}


function buildPresentationLead(
  data: InrSearchPublicPageData,
  i18nT: (_key: string, _values?: Record<string, string>) => string,
  locale: string,
) {
  const intro = data.description?.trim().replace(/\s+/g, " ");
  const services = data.services.length
    ? i18nT("elle_propose_notamment_les_prestations_suivantes_401d6823", {
        value0: joinLocalizedList(
          data.services.slice(0, 3).map((value) => lowerInitial(value, locale)),
          locale,
        ),
      })
    : "";

  const generatedIdentity = [
    data.companyName,
    data.profession
      ? i18nT("exerce_l_activite_de_value_f7f3f9fc", {
          value0: lowerInitial(data.profession, locale),
        })
      : data.sectorLabel
        ? i18nT("exerce_dans_le_secteur_value_3680f396", {
            value0: lowerInitial(data.sectorLabel, locale),
          })
        : i18nT("est_une_entreprise_2774c8db"),
    data.city ? i18nT("situee_a_value_5ce1fb79", { value0: data.city }) : "",
  ]
    .filter(Boolean)
    .join(" ");

  const identity = intro && intro.length <= 180
    ? intro
    : generatedIdentity;

  return [identity, services]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildConversionSummary(data: InrSearchPublicPageData, i18nT: (_key: string, _values?: Record<string, string>) => string, locale: string) {
  const details = [
    data.services.length ? i18nT("ses_prestations_df8b6ca7") : "",
    data.zones.length || data.city ? i18nT("sa_zone_d_intervention_3a5e6ee4") : "",
    data.strengths.length ? i18nT("ses_points_forts_e59ac9bd") : "",
  ].filter(Boolean);
  const usefulDetails = details.length
    ? joinLocalizedList(details, locale)
    : i18nT("les_informations_utiles_0ab61a92");

  return i18nT("retrouvez_value_avant_de_prendre_contact_1e01dd34", { value0: usefulDetails, value1: data.companyName });
}

function buildPresentationStrengthValue(strengths: string[]) {
  const cleanStrengths = strengths.map((strength) => strength.trim()).filter(Boolean);
  if (!cleanStrengths.length) return "";
  if (cleanStrengths.length <= 3) return cleanStrengths.join(" · ");
  return `${cleanStrengths.slice(0, 3).join(" · ")} +${cleanStrengths.length - 3}`;
}

function normalizePlaceKey(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildEnhancedZones(data: InrSearchPublicPageData) {
  const zones: string[] = [];
  const seen = new Set<string>();
  const addZone = (zone: string) => {
    const cleanZone = zone.trim();
    const key = normalizePlaceKey(cleanZone);
    if (!cleanZone || seen.has(key)) return;
    zones.push(cleanZone);
    seen.add(key);
  };

  // Never infer an intervention area from the company address. A nearby city
  // may be useful as a suggestion in the dashboard, but it must not become a
  // public SEO claim or an areaServed signal without professional confirmation.
  data.zones.forEach(addZone);
  return zones;
}

function compactMetaText(value: string, maxLength: number) {
  const cleanValue = value.replace(/\s+/g, " ").trim();
  if (cleanValue.length <= maxLength) return cleanValue;
  const clipped = cleanValue.slice(0, maxLength - 1).replace(/\s+\S*$/, "").trim();
  return `${clipped}…`;
}

function buildSeoTitle(
  data: InrSearchPublicPageData,
  i18nT: (_key: string, _values?: Record<string, string>) => string,
  locale: string,
) {
  const activity = data.profession || data.sectorLabel || i18nT("entreprise_locale_17aeb576");
  const location = data.city ? ` · ${data.city}` : "";
  const services = joinLocalizedList(data.services.slice(0, 2), locale);
  const suffix = services ? ` | ${services}` : "";
  return compactMetaText(`${data.companyName}, ${activity}${location}${suffix}`, 70);
}

function normalizeMetaComparison(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveSeoTitle(
  data: InrSearchPublicPageData,
  i18nT: (_key: string, _values?: Record<string, string>) => string,
  locale: string,
) {
  const customTitle = data.pageTitle.trim();
  if (
    !customTitle
    || normalizeMetaComparison(customTitle) === normalizeMetaComparison(data.companyName)
  ) {
    return buildSeoTitle(data, i18nT, locale);
  }
  return compactMetaText(customTitle, 70);
}

function buildSeoDescription(
  data: InrSearchPublicPageData,
  i18nT: (_key: string, _values?: Record<string, string>) => string,
  locale: string,
) {
  const activity = data.profession || data.sectorLabel || i18nT("entreprise_locale_17aeb576");
  const services = data.services.length
    ? i18nT("prestations_value_e11114c0", {
        value0: joinLocalizedList(data.services.slice(0, 4), locale),
      })
    : "";
  const zones = data.zones.length
    ? i18nT("intervention_value_fd8c4083", {
        value0: joinLocalizedList(data.zones.slice(0, 3), locale),
      })
    : "";
  const identity = [data.companyName, activity, data.city].filter(Boolean).join(" · ");
  const lead = (data.pageDescription || data.description).trim();
  const base = lead && normalizeMetaComparison(lead).startsWith(normalizeMetaComparison(identity))
    ? lead
    : `${identity}. ${lead}`;
  return compactMetaText(
    [base, services, zones].filter(Boolean).join(" "),
    160,
  );
}

function buildServiceDescription(
  service: string,
  data: InrSearchPublicPageData,
  i18nT: (_key: string, _values?: Record<string, string>) => string,
  locale: string,
) {
  const generated = storedServiceDescription(service, data);
  if (generated) return generated;

  const normalized = normalizeServiceDescriptionKey(service);
  const serviceLabel = lowerInitial(service, locale);
  const audiences = data.customerTypes.length
    ? i18nT("service_audience_sentence", {
        audiences: joinLocalizedList(
          data.customerTypes.map((value) => lowerInitial(value, locale)),
          locale,
        ),
      })
    : "";
  const zones = data.zones.length
    ? i18nT("service_zones_sentence", {
        zones: joinLocalizedList(data.zones.slice(0, 3), locale),
      })
    : data.city
      ? i18nT("service_city_sentence", { city: data.city })
      : "";
  const strengths = data.strengths.length
    ? i18nT("l_approche_s_appuie_sur_value_c533a7c6", {
        value0: joinLocalizedList(
          data.strengths.slice(0, 2).map((value) => lowerInitial(value, locale)),
          locale,
        ),
      })
    : "";
  const localContext = data.description
    ? i18nT("service_company_context", {
        company: data.companyName,
        description: data.description.replace(/\s+/g, " ").slice(0, 150),
      })
    : "";

  const intentKey = (() => {
    if (/(strategie|audit|diagnostic|conseil|plan|etude)/.test(normalized)) {
      return "service_intent_strategy";
    }
    if (/(identite|logo|charte|visuel|marque|branding|image)/.test(normalized)) {
      return "service_intent_identity";
    }
    if (/(digital|reseau|social|facebook|instagram|linkedin|google|seo|sea|campagne|publicite|ads)/.test(normalized)) {
      return "service_intent_visibility";
    }
    if (/(print|flyer|brochure|carte|affiche|enseigne|support|signalétique|signaletique)/.test(normalized)) {
      return "service_intent_print";
    }
    if (/(editorial|redaction|contenu|article|texte|copywriting)/.test(normalized)) {
      return "service_intent_editorial";
    }
    if (/(pose|installation|creation|conception|fabrication|amenagement)/.test(normalized)) {
      return "service_intent_creation";
    }
    if (/(depannage|urgence|reparation|fuite|remplacement|debouchage)/.test(normalized)) {
      return "service_intent_emergency";
    }
    if (/(entretien|maintenance|nettoyage|suivi|controle)/.test(normalized)) {
      return "service_intent_maintenance";
    }
    return "service_intent_default";
  })();

  const method = pickVariant([
    i18nT("le_but_est_d_obtenir_une_8a418741"),
    i18nT("chaque_demande_peut_ainsi_etre_qualifiee_d221b852"),
    i18nT("le_visiteur_comprend_ce_qui_est_e12625fa"),
  ], `${service}-${data.companyName}`);

  return [
    i18nT("service_description_intro", {
      service: serviceLabel,
      company: data.companyName,
    }),
    i18nT(intentKey),
    audiences,
    zones,
    method,
    strengths || localContext,
    i18nT("cette_expertise_permet_de_presenter_un_4f450f12"),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function withSource(value: string, source: string) {
  try {
    const url = new URL(value);
    url.searchParams.set("src", source);
    return url.toString();
  } catch {
    return value;
  }
}

function safeJsonLd(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildOpeningHoursSpecification(data: InrSearchPublicPageData) {
  return buildOpeningHoursSpecifications(
    [data.openingDays, data.openingHours].filter(Boolean).join("\n"),
  );
}

function normalizeStructuredPhone(value: string) {
  const compact = value.replace(/[^+\d]/g, "");
  if (/^0\d{9}$/.test(compact)) return `+33${compact.slice(1)}`;
  return compact || undefined;
}

function buildJsonLd(data: InrSearchPublicPageData, i18nT: (_key: string, _values?: Record<string, string>) => string, locale: string) {
  const sameAs = data.socialLinks.map((link) => link.url).filter(Boolean);
  const offers = data.services.map((service) => ({
    "@type": "Offer",
    itemOffered: {
      "@type": "Service",
      name: service,
      serviceType: service,
      description: buildServiceDescription(service, data, i18nT, locale),
      provider: { "@id": `${buildInrSearchPublicUrl(data.slug)}#business` },
      areaServed: data.zones.length
        ? data.zones.map((zone) => ({ "@type": "AdministrativeArea", name: zone }))
        : undefined,
    },
  }));

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${buildInrSearchPublicUrl(data.slug)}#business`,
    name: data.companyName,
    description: data.description,
    url: buildInrSearchPublicUrl(data.slug),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${buildInrSearchPublicUrl(data.slug)}#webpage`,
    },
    dateModified: data.updatedAt || undefined,
    image: [data.logoUrl, ...data.media.map((media) => media.url)].filter(
      Boolean,
    ),
    logo: data.logoUrl || undefined,
    telephone: normalizeStructuredPhone(data.phone),
    email: data.email || undefined,
    contactPoint:
      data.phone || data.email
        ? {
            "@type": "ContactPoint",
            telephone: normalizeStructuredPhone(data.phone),
            email: data.email || undefined,
            contactType: i18nT("customer_service_label"),
            availableLanguage: [locale],
          }
        : undefined,
    hasMap: data.googleBusinessUrl || undefined,
    potentialAction:
      data.phone || data.email
        ? {
            "@type": "CommunicateAction",
            name: i18nT("contacter_value_78104412", {
              value0: data.companyName,
            }),
            target: data.phone
              ? `tel:${data.phone.replace(/[^+\d]/g, "")}`
              : `mailto:${data.email}`,
          }
        : undefined,
    address: data.addressLine || data.city || data.zip
      ? {
          "@type": "PostalAddress",
          streetAddress: data.address || undefined,
          postalCode: data.zip || undefined,
          addressLocality: data.city || undefined,
          addressCountry: data.country || "FR",
        }
      : undefined,
    areaServed: data.zones.length
      ? data.zones.map((zone) => ({ "@type": "AdministrativeArea", name: zone }))
      : undefined,
    openingHours: data.openingHours || undefined,
    openingHoursSpecification: buildOpeningHoursSpecification(data),
    sameAs: sameAs.length ? sameAs : undefined,
    knowsAbout: [data.profession, ...data.services].filter(Boolean),
    audience: data.customerTypes.length
      ? data.customerTypes.map((audienceType) => ({
          "@type": "Audience",
          audienceType,
        }))
      : undefined,
    subjectOf: data.inrBadgeUrl
      ? {
          "@type": "WebPage",
          url: data.inrBadgeUrl,
          name: i18nT("inr_badge_page_of", { company: data.companyName }),
        }
      : undefined,
    hasOfferCatalog: offers.length
      ? {
          "@type": "OfferCatalog",
          name: i18nT("les_prestations_de_value_39d5ec75", {
            value0: data.companyName,
          }),
          itemListElement: offers,
        }
      : undefined,
  };
}

function buildFaqJsonLd(data: InrSearchPublicPageData) {
  if (!data.sections.faq || !data.faq.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: data.faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

function buildWebPageJsonLd(
  data: InrSearchPublicPageData,
  i18nT: (_key: string, _values?: Record<string, string>) => string,
  locale: string,
) {
  const url = buildInrSearchPublicUrl(data.slug);
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: buildSeoTitle(data, i18nT, locale),
    description: buildSeoDescription(data, i18nT, locale),
    dateModified: data.updatedAt || undefined,
    about: { "@id": `${url}#business` },
    mainEntity: { "@id": `${url}#business` },
    primaryImageOfPage: data.logoUrl || data.media[0]?.url
      ? {
          "@type": "ImageObject",
          url: data.media[0]?.url || data.logoUrl,
          caption: [data.companyName, data.city].filter(Boolean).join(" — "),
        }
      : undefined,
    hasPart: [
      { "@type": "WebPageElement", "@id": `${url}#presentation`, name: i18nT("presentation_aa245f5f") },
      ...(data.sections.services && data.services.length
        ? [{ "@type": "WebPageElement", "@id": `${url}#prestations`, name: i18nT("expertises_ecd4aa4e") }]
        : []),
      ...(data.sections.media && data.media.length
        ? [{ "@type": "WebPageElement", "@id": `${url}#realisations`, name: i18nT("realisations_c8d62f4b") }]
        : []),
      ...(data.sections.news
        ? [{ "@type": "WebPageElement", "@id": `${url}#actualites`, name: i18nT("actualites_a3baa78e") }]
        : []),
      ...(data.sections.areas && data.zones.length
        ? [{ "@type": "WebPageElement", "@id": `${url}#zone`, name: i18nT("zone_d_intervention_2e900603") }]
        : []),
      ...(data.sections.faq && data.faq.length
        ? [{ "@type": "WebPageElement", "@id": `${url}#faq`, name: i18nT("questions_frequentes_16664684") }]
        : []),
      ...(data.sections.cta
        ? [{ "@type": "WebPageElement", "@id": `${url}#contact`, name: i18nT("contact_b37456c4") }]
        : []),
    ],
    inLanguage: locale,
  };
}

function buildNewsJsonLd(
  data: InrSearchPublicPageData,
  i18nT: (_key: string, _values?: Record<string, string>) => string,
  locale: string,
) {
  if (!data.publications.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: i18nT("les_actualites_de_value_d3ad6de3", {
      value0: data.companyName,
    }),
    itemListElement: data.publications.map((publication, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "BlogPosting",
        "@id": `${buildInrSearchPublicUrl(data.slug)}#actualite-${index + 1}`,
        url: `${buildInrSearchPublicUrl(data.slug)}#actualite-${index + 1}`,
        headline: publication.title,
        description: publication.content?.replace(/\s+/g, " ").trim().slice(0, 220) || undefined,
        articleBody: publication.content || undefined,
        articleSection: i18nT("actualites_a3baa78e"),
        inLanguage: locale,
        datePublished: publication.createdAt || undefined,
        dateModified: publication.createdAt || undefined,
        image: publication.imageUrl || undefined,
        mainEntityOfPage: { "@id": `${buildInrSearchPublicUrl(data.slug)}#webpage` },
        author: { "@id": `${buildInrSearchPublicUrl(data.slug)}#business` },
        publisher: {
          "@id": `${buildInrSearchPublicUrl(data.slug)}#business`,
          name: data.companyName,
          logo: data.logoUrl
            ? { "@type": "ImageObject", url: data.logoUrl }
            : undefined,
        },
      },
    })),
  };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const [i18nT, locale] = await Promise.all([
    getTranslations("public"),
    getLocale(),
  ]);
  const { slug } = await params;
  const data = await loadInrSearchPublicPage(slug);
  if (!data) {
    return {
      title: i18nT("entreprise_introuvable_inrcy_73785415"),
      robots: { index: false, follow: false },
    };
  }

  const canonical = buildInrSearchPublicUrl(data.slug);
  const title = resolveSeoTitle(data, i18nT, locale);
  const description = buildSeoDescription(data, i18nT, locale);
  const image = data.logoUrl || data.media[0]?.url || undefined;

  return {
    title,
    description,
    applicationName: data.companyName,
    authors: [{ name: data.companyName, url: canonical }],
    creator: data.companyName,
    publisher: data.companyName,
    category: data.sectorLabel || data.profession || i18nT("entreprise_locale_17aeb576"),
    referrer: "strict-origin-when-cross-origin",
    alternates: {
      canonical,
      types: { "text/plain": `${canonical}/llms.txt` },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      locale: locale.replace("-", "_"),
      url: canonical,
      siteName: data.companyName,
      title,
      description,
      images: image ? [{ url: image, alt: data.companyName }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function InrSearchCompanyPage({ params }: PageProps) {
  const i18nT = await getTranslations("public");
  const locale = await getLocale();
  const { slug } = await params;
  const data = await loadInrSearchPublicPage(slug);
  if (!data) notFound();
  if (normalizeInrSearchDirectorySlug(slug) !== data.slug) {
    permanentRedirect(`/entreprises/${data.slug}`);
  }

  const localBusinessJsonLd = buildJsonLd(data, i18nT, locale);
  const webPageJsonLd = buildWebPageJsonLd(data, i18nT, locale);
  const faqJsonLd = buildFaqJsonLd(data);
  const newsJsonLd = buildNewsJsonLd(data, i18nT, locale);
  const factualSummary = buildFactualSummary(data, i18nT, locale);
  const presentationLead = buildPresentationLead(data, i18nT, locale);
  const conversionSummary = buildConversionSummary(data, i18nT, locale);
  const enhancedZones = buildEnhancedZones(data);
  const phoneHref = data.phone
    ? `tel:${data.phone.replace(/[^+\d]/g, "")}`
    : "";
  const emailHref = data.email ? `mailto:${data.email}` : "";
  const contactHref = phoneHref || emailHref;
  const professionSlug = normalizeInrSearchDirectorySlug(data.profession);
  const professionUrl = professionSlug
    ? buildInrSearchProfessionUrl(professionSlug)
    : "";
  const inrBadgeOpenUrl = withSource(data.inrBadgeUrl, "inrsearch");
  const navItems = [
    { href: "#presentation", label: i18nT("identite_3138be1c") },
    ...(data.sections.services && data.services.length
      ? [{ href: "#prestations", label: i18nT("expertises_ecd4aa4e") }]
      : []),
    ...(data.sections.media && data.media.length
      ? [{ href: "#realisations", label: i18nT("realisations_c8d62f4b") }]
      : []),
    ...(data.sections.news
      ? [{ href: "#actualites", label: i18nT("actualites_a3baa78e") }]
      : []),
    ...(data.sections.areas && enhancedZones.length
      ? [{ href: "#zone", label: i18nT("zone_03efccb4") }]
      : []),
    ...(data.sections.trust && (data.strengths.length || data.inrBadgeUrl)
      ? [{ href: "#points-forts", label: i18nT("confiance_7b2239f6") }]
      : []),
    ...(data.sections.faq && data.faq.length
      ? [{ href: "#faq", label: "FAQ" }]
      : []),
    ...(data.sections.socials && data.socialLinks.length
      ? [{ href: "#reseaux", label: i18nT("reseaux_ee81e84d") }]
      : []),
    ...(data.sections.cta ? [{ href: "#contact", label: i18nT("contact_b37456c4") }] : []),
  ];
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: i18nT("entreprises_4b0c7c83"),
        item: `${buildInrSearchPublicUrl(data.slug).split("/entreprises/")[0]}/entreprises`,
      },
      ...(data.profession && professionUrl
        ? [
            {
              "@type": "ListItem",
              position: 2,
              name: data.profession,
              item: professionUrl,
            },
          ]
        : []),
      {
        "@type": "ListItem",
        position: data.profession && professionUrl ? 3 : 2,
        name: data.pageTitle,
        item: buildInrSearchPublicUrl(data.slug),
      },
    ],
  };

  const visualTheme = inferInrSearchVisualTheme(
    `${data.profession} ${data.sectorLabel}`,
  );
  const visualPalette = buildInrSearchFallbackPalette(
    `${data.companyName}|${data.profession}|${data.sectorLabel}`,
    visualTheme,
  );
  const visualStyle = {
    "--brand-primary-rgb": rgbTriplet(visualPalette.primary),
    "--brand-secondary-rgb": rgbTriplet(visualPalette.secondary),
    "--brand-tertiary-rgb": rgbTriplet(visualPalette.tertiary),
    "--brand-ink-rgb": rgbTriplet(visualPalette.ink),
  } as CSSProperties;

  const facts = [
    data.profession || data.sectorLabel
      ? {
          icon: "services" as IconName,
          kind: "activity",
          label: i18nT("activite_8fe12048"),
          value: data.profession || data.sectorLabel,
          href: "",
          actionKey: "",
        }
      : null,
    data.city
      ? {
          icon: "location" as IconName,
          kind: "anchor",
          label: i18nT("ancrage_7c8e1801"),
          value: data.city,
          href: "",
          actionKey: "",
        }
      : null,
    data.customerTypes.length
      ? {
          icon: "users" as IconName,
          kind: "audience",
          label: i18nT("pour_qui_c99cf10a"),
          value: joinLocalizedList(data.customerTypes.slice(0, 2), locale),
          href: "",
          actionKey: "",
        }
      : null,
    data.strengths.length
      ? {
          icon: "sparkles" as IconName,
          kind: "strengths",
          label: i18nT("forces_5eb175b9"),
          value: buildPresentationStrengthValue(data.strengths),
          href: "#points-forts",
          actionKey: "strengths_view",
        }
      : null,
    data.sections.hours && (data.openingDays || data.openingHours)
      ? {
          icon: "clock" as IconName,
          kind: "availability",
          label: i18nT("disponibilite_0f06e60a"),
          value: [data.openingDays, data.openingHours].filter(Boolean).join(" · "),
          href: "",
          actionKey: "",
        }
      : null,
  ].filter(Boolean) as Array<{
    icon: IconName;
    label: string;
    value: string;
    href: string;
    actionKey: string;
    kind: string;
  }>;

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: "html,body{background:#050b2b!important;color-scheme:dark;overscroll-behavior:none}",
        }}
      />
      <main
        className={styles.page}
      data-inrsearch-page
      data-visual-theme={visualTheme}
      data-motion="full"
      data-active-section="presentation"
      style={visualStyle}
    >
      <InrSearchVisualIdentity
        companyName={data.companyName}
        logoUrl={data.logoUrl}
        profession={data.profession}
        sector={data.sectorLabel}
        initialTheme={visualTheme}
      />
      <a className={styles.skipLink} href="#presentation">
        {i18nT("aller_au_contenu_principal_e97ff563")}{" "}</a>
      <InrSearchAnalyticsClient slug={data.slug} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(localBusinessJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(webPageJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      {faqJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
        />
      ) : null}
      {newsJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(newsJsonLd) }}
        />
      ) : null}

      <InrSearchExperience
        companyName={data.companyName}
        logoUrl={data.logoUrl}
        navItems={navItems}
      />

      <p className={styles.visuallyHidden} id="orbit-instructions">
        {i18nT("parcourez_les_rubriques_horizontalement_avec_les_93d0621c")}{" "}</p>
      <div
        className={styles.orbitViewport}
        data-inrsearch-orbit
        role="region"
        aria-roledescription="carrousel"
        aria-describedby="orbit-instructions"
        aria-label={i18nT("parcours_de_value_d9df712e", { value0: data.companyName })}
      >
        <section
          className={`${styles.orbitPanel} ${styles.presentationOrbit}`}
          id="presentation"
          tabIndex={-1}
          data-orbit-section
          aria-label={i18nT("presentation_aa245f5f")}
        >
          <div className={styles.presentationStage}>
            <div className={styles.presentationAurora} aria-hidden="true" />
            <div className={styles.presentationGrid} aria-hidden="true" />
            <div className={styles.presentationRingOne} aria-hidden="true" />
            <div className={styles.presentationRingTwo} aria-hidden="true" />
            <div className={styles.presentationRingThree} aria-hidden="true" />
            <div className={styles.presentationBeam} aria-hidden="true" />

            <div className={styles.presentationLayout}>
              <div className={styles.presentationCopy}>
                <div className={styles.presentationStatus}>
                  <span><Icon name="sparkles" /></span>
                  <strong>{i18nT("profil_professionnel_vivant_066ce124")}</strong>
                  {data.city ? <small>{data.city}</small> : null}
                </div>

                <h1 className={styles.presentationTitle}>{data.companyName}</h1>

                {data.sections.presentation ? (
                  <p className={styles.presentationDescription}>{presentationLead}</p>
                ) : null}

                <details className={styles.presentationSummary} open>
                  <summary>{i18nT("informations_essentielles_9792d409")}</summary>
                  <p>{conversionSummary || factualSummary}</p>
                </details>

                {data.sections.cta ? (
                  <div className={styles.presentationActions}>
                    <a className={styles.presentationPrimaryAction} href="#contact">
                      <Icon name="sparkles" /> {" "}{i18nT("presenter_mon_besoin_7ee41902")}{" "}</a>
                    {navItems[1] ? (
                      <a
                        className={styles.presentationSecondaryAction}
                        href={navItems[1].href}
                      >
                        <Icon name="arrow" /> {" "}{i18nT("explorer_l_univers_df48f50e")}{" "}</a>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className={styles.presentationUniverse} aria-label={i18nT("identite_visuelle_de_value_316874b8", { value0: data.companyName })}>
                <div className={styles.presentationHalo} aria-hidden="true" />
                <div className={styles.presentationMediaOrb}>
                  <div className={styles.presentationMediaFallback}>
                    <InrSearchLogo
                      src={data.logoUrl}
                      alt={i18nT("logo_de_value_90704662", { value0: data.companyName })}
                      companyName={data.companyName}
                      width={260}
                      height={260}
                      fallbackClassName={styles.presentationLogoFallback}
                      fetchPriority="high"
                    />
                  </div>
                  <div className={styles.presentationMediaShade} />
                  <div className={styles.presentationMediaCaption}>
                    <small>{data.profession || data.sectorLabel}</small>
                    <strong>{data.companyName}</strong>
                    {data.city ? <span>{data.city}</span> : null}
                  </div>
                </div>

                <div className={styles.presentationFactOrbit} aria-label={i18nT("informations_principales_48373a61")}>
                  {facts.map((fact, index) => {
                    const body = (
                      <>
                        <span className={styles.presentationFactIcon}><Icon name={fact.icon} /></span>
                        <span className={styles.presentationFactText}>
                          <small>{fact.label}</small>
                          <strong>{fact.value}</strong>
                        </span>
                      </>
                    );
                    return fact.href ? (
                      <a
                        className={styles.presentationSatellite}
                        data-slot={String(index)}
                        data-kind={fact.kind}
                        href={fact.href}
                        key={fact.label}
                        target={fact.href.startsWith("http") ? "_blank" : undefined}
                        rel={fact.href.startsWith("http") ? "noreferrer" : undefined}
                        data-inrsearch-action={fact.actionKey || undefined}
                        data-inrsearch-target={fact.actionKey ? fact.href : undefined}
                      >
                        {body}
                      </a>
                    ) : (
                      <article className={styles.presentationSatellite} data-slot={String(index)} data-kind={fact.kind} key={fact.label}>
                        {body}
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className={styles.presentationSwipeHint} aria-hidden="true">
              <span>{i18nT("faites_glisser_pour_decouvrir_f34ec42f")}</span>
              <strong>→</strong>
            </div>
          </div>
        </section>

        {data.sections.services && data.services.length ? (
          <section
            className={`${styles.section} ${styles.servicesSection} ${styles.orbitPanel}`}
            id="prestations"
            aria-labelledby="prestations-title"
            data-reveal
            tabIndex={-1}
            data-orbit-section
            aria-label={i18nT("prestations_0370136a")}
          >
            <InrSearchServicesOrbit
              companyName={data.companyName}
              services={data.services.map((service) => ({
                name: service,
                description: buildServiceDescription(service, data, i18nT, locale),
              }))}
              audiences={data.customerTypes}
            />
          </section>
        ) : null}

        {data.sections.media && data.media.length ? (
          <section
            className={`${styles.section} ${styles.galleryOrbitSection} ${styles.orbitPanel}`}
            id="realisations"
            aria-labelledby="realisations-title"
            data-reveal
            tabIndex={-1}
            data-orbit-section
            aria-label={i18nT("realisations_c8d62f4b")}
          >
            <InrSearchGalleryOrbit
              companyName={data.companyName}
              profession={data.profession || data.sectorLabel}
              city={data.city}
              services={data.services}
              zones={data.zones}
              media={data.media}
            />
          </section>
        ) : null}

        {data.sections.news ? (
          <section
            className={`${styles.section} ${styles.newsSection} ${styles.orbitPanel}`}
            id="actualites"
            aria-labelledby="actualites-title"
            data-reveal
            tabIndex={-1}
            data-orbit-section
            aria-label={i18nT("actualites_a3baa78e")}
          >
            <InrSearchNewsShowcase
              companyName={data.companyName}
              publications={data.publications}
            />
          </section>
        ) : null}

        {data.sections.areas && enhancedZones.length ? (
          <section
            className={`${styles.section} ${styles.areaSection} ${styles.zoneOrbitSection} ${styles.orbitPanel}`}
            id="zone"
            aria-labelledby="zones-title"
            data-reveal
            tabIndex={-1}
            data-orbit-section
            aria-label={i18nT("zone_d_intervention_2e900603")}
          >
            <InrSearchZoneOrbit
              companyName={data.companyName}
              city={data.city}
              profession={data.profession || data.sectorLabel}
              zones={enhancedZones}
            />
          </section>
        ) : null}

        {data.sections.trust && (data.strengths.length || data.inrBadgeUrl) ? (
          <section
            className={`${styles.section} ${styles.strengthOrbitSection} ${styles.orbitPanel}`}
            id="points-forts"
            aria-labelledby="points-forts-title"
            data-reveal
            tabIndex={-1}
            data-orbit-section
            aria-label={i18nT("points_forts_40aaecb4")}
          >
            <InrSearchStrengthsOrbit
              companyName={data.companyName}
              strengths={data.strengths}
              inrBadgeUrl={inrBadgeOpenUrl}
              inrBadgeQrUrl={data.inrBadgeQrUrl}
            />
          </section>
        ) : null}

        {data.sections.faq && data.faq.length ? (
          <section
            className={`${styles.section} ${styles.faqSection} ${styles.faqOrbitSection} ${styles.orbitPanel}`}
            id="faq"
            aria-labelledby="faq-title"
            data-reveal
            tabIndex={-1}
            data-orbit-section
            aria-label={i18nT("questions_frequentes_16664684")}
          >
            <InrSearchFaqOrbit
              companyName={data.companyName}
              items={data.faq}
              contactHref={contactHref || "#contact"}
            />
          </section>
        ) : null}

        {data.sections.socials && data.socialLinks.length ? (
          <section
            className={`${styles.section} ${styles.socialOrbitSection} ${styles.orbitPanel}`}
            id="reseaux"
            data-reveal
            tabIndex={-1}
            data-orbit-section
            aria-label={i18nT("reseaux_et_presence_en_ligne_171134dc")}
          >
            <InrSearchSocialOrbit
              companyName={data.companyName}
              logoUrl={data.logoUrl}
              profession={data.profession || data.sectorLabel}
              city={data.city}
              links={data.socialLinks}
            />
          </section>
        ) : null}

        {data.sections.cta ? (
          <section
            className={`${styles.orbitPanel} ${styles.contactOrbit}`}
            id="contact"
            tabIndex={-1}
            data-orbit-section
            aria-label={i18nT("contact_b37456c4")}
          >
            <div className={styles.contactOrbitInner}>
              <div data-reveal>
                <InrSearchContactOrbit
                  slug={data.slug}
                  companyName={data.companyName}
                  logoUrl={data.logoUrl}
                  profession={data.profession || data.sectorLabel}
                  city={data.city}
                  phone={data.phone}
                  phoneHref={phoneHref}
                  email={data.email}
                  emailHref={emailHref}
                  addressLine={data.addressLine}
                  websiteUrl={data.websiteUrl}
                  directionsUrl={data.googleBusinessUrl}
                />
              </div>

           </div>
          </section>
        ) : null}
      </div>

      </main>
    </>
  );
}
