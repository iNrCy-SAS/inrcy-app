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

function joinFrenchList(values: string[]) {
  const cleanValues = values.map((value) => value.trim()).filter(Boolean);
  if (!cleanValues.length) return "";
  if (cleanValues.length === 1) return cleanValues[0];
  if (cleanValues.length === 2) return `${cleanValues[0]} et ${cleanValues[1]}`;
  return `${cleanValues.slice(0, -1).join(", ")} et ${cleanValues[cleanValues.length - 1]}`;
}

function lowerInitial(value: string) {
  if (!value) return value;
  return value.slice(0, 1).toLocaleLowerCase("fr-FR") + value.slice(1);
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

function buildFactualSummary(data: InrSearchPublicPageData) {
  const identity = [
    data.companyName,
    data.profession
      ? `exerce l’activité de ${lowerInitial(data.profession)}`
      : data.sectorLabel
        ? `exerce dans le secteur ${lowerInitial(data.sectorLabel)}`
        : "est une entreprise",
    data.city ? `située à ${data.city}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const serviceSentence = data.services.length
    ? `Elle propose notamment les prestations suivantes : ${joinFrenchList(data.services.slice(0, 5))}.`
    : "";
  const zoneSentence = data.zones.length
    ? `Elle intervient notamment dans les zones suivantes : ${joinFrenchList(data.zones.slice(0, 8))}.`
    : "";
  const audienceSentence = data.customerTypes.length
    ? `Ses prestations s’adressent notamment aux ${joinFrenchList(data.customerTypes.map(lowerInitial))}.`
    : "";
  const hoursSentence =
    data.openingDays || data.openingHours
      ? `L’entreprise est joignable ${[data.openingDays, data.openingHours].filter(Boolean).join(", ")}.`
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


function buildPresentationLead(data: InrSearchPublicPageData) {
  const intro = data.description?.trim().replace(/\s+/g, " ");
  const services = data.services.length
    ? `Découvrez notamment ${joinFrenchList(data.services.slice(0, 3).map(lowerInitial))}.`
    : "";

  const generatedIdentity = [
    data.companyName,
    data.profession
      ? `est une ${lowerInitial(data.profession)}`
      : data.sectorLabel
        ? `évolue dans le secteur ${lowerInitial(data.sectorLabel)}`
        : "est une entreprise locale",
    data.city ? `basée à ${data.city}.` : ".",
  ].join(" ");

  const identity = intro && intro.length <= 180
    ? intro
    : generatedIdentity;

  return [identity, services]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildConversionSummary(data: InrSearchPublicPageData) {
  const details = [
    data.services.length ? "ses prestations" : "",
    data.zones.length || data.city ? "sa zone d’intervention" : "",
    data.strengths.length ? "ses points forts" : "",
  ].filter(Boolean);
  const usefulDetails = details.length
    ? joinFrenchList(details)
    : "les informations utiles";

  return `Retrouvez ${usefulDetails} avant de prendre contact. Vous pouvez ensuite présenter directement votre besoin à ${data.companyName}.`;
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

function buildSeoTitle(data: InrSearchPublicPageData) {
  const activity = data.profession || data.sectorLabel || "entreprise";
  const location = data.city ? ` à ${data.city}` : "";
  const services = data.services.slice(0, 2).join(" et ");
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

function resolveSeoTitle(data: InrSearchPublicPageData) {
  const customTitle = data.pageTitle.trim();
  if (
    !customTitle
    || normalizeMetaComparison(customTitle) === normalizeMetaComparison(data.companyName)
  ) {
    return buildSeoTitle(data);
  }
  return compactMetaText(customTitle, 70);
}

function buildSeoDescription(data: InrSearchPublicPageData) {
  const activity = data.profession || data.sectorLabel || "entreprise";
  const location = data.city ? ` à ${data.city}` : "";
  const services = data.services.length
    ? ` Prestations : ${joinFrenchList(data.services.slice(0, 4))}.`
    : "";
  const zones = data.zones.length
    ? ` Intervention : ${joinFrenchList(data.zones.slice(0, 3))}.`
    : "";
  const identity = `${data.companyName}, ${activity}${location}`;
  const lead = (data.pageDescription || data.description).trim();
  const base = lead && normalizeMetaComparison(lead).startsWith(normalizeMetaComparison(identity))
    ? lead
    : `${identity}. ${lead}`;
  return compactMetaText(
    `${base}${services}${zones}`,
    160,
  );
}

function buildServiceDescription(
  service: string,
  data: InrSearchPublicPageData,
) {
  const generated = storedServiceDescription(service, data);
  if (generated) return generated;

  const normalized = normalizeServiceDescriptionKey(service);
  const serviceLabel = lowerInitial(service);
  const audiences = data.customerTypes.length
    ? ` pour ${joinFrenchList(data.customerTypes.map(lowerInitial))}`
    : "";
  const zones = data.zones.length
    ? ` autour de ${joinFrenchList(data.zones.slice(0, 3))}`
    : data.city
      ? ` depuis ${data.city}`
      : "";
  const strengths = data.strengths.length
    ? ` L’approche s’appuie sur ${joinFrenchList(data.strengths.slice(0, 2).map(lowerInitial))}, afin de garder un accompagnement clair et utile.`
    : "";
  const localContext = data.description
    ? ` Elle s’inscrit dans l’univers de ${data.companyName} : ${data.description.replace(/\s+/g, " ").slice(0, 150)}.`
    : "";

  const intent = (() => {
    if (/(strategie|audit|diagnostic|conseil|plan|etude)/.test(normalized)) {
      return "clarifie le point de départ, les priorités et les actions à mener pour éviter les décisions au hasard";
    }
    if (/(identite|logo|charte|visuel|marque|branding|image)/.test(normalized)) {
      return "donne une forme reconnaissable à l’entreprise, avec des repères visuels cohérents sur chaque support";
    }
    if (/(digital|reseau|social|facebook|instagram|linkedin|google|seo|sea|campagne|publicite|ads)/.test(normalized)) {
      return "sert à gagner en visibilité, toucher les bons contacts et transformer l’attention en demandes concrètes";
    }
    if (/(print|flyer|brochure|carte|affiche|enseigne|support|signalétique|signaletique)/.test(normalized)) {
      return "matérialise le message de l’entreprise sur des supports lisibles, utiles et prêts à être diffusés";
    }
    if (/(editorial|redaction|contenu|article|texte|copywriting)/.test(normalized)) {
      return "structure le message, choisit les bons mots et rend l’offre plus facile à comprendre";
    }
    if (/(pose|installation|creation|conception|fabrication|amenagement)/.test(normalized)) {
      return "transforme le besoin initial en réalisation concrète, avec une préparation adaptée au contexte";
    }
    if (/(depannage|urgence|reparation|fuite|remplacement|debouchage)/.test(normalized)) {
      return "répond à une situation précise avec une intervention lisible, rapide et orientée solution";
    }
    if (/(entretien|maintenance|nettoyage|suivi|controle)/.test(normalized)) {
      return "préserve la qualité du résultat dans le temps et limite les problèmes évitables";
    }
    return "répond à un besoin précis en cadrant les attentes, les contraintes et le résultat recherché";
  })();

  const method = pickVariant([
    "Le but est d’obtenir une réponse lisible, directement reliée au besoin exprimé.",
    "Chaque demande peut ainsi être qualifiée plus simplement avant de passer à l’action.",
    "Le visiteur comprend ce qui est proposé, pour qui, et dans quel contexte l’entreprise peut intervenir.",
  ], `${service}-${data.companyName}`);

  return [
    `Avec ${serviceLabel}, ${data.companyName} ${intent}${audiences}${zones}.`,
    method,
    strengths || localContext,
    `Cette expertise permet de présenter un besoin précis et d’obtenir un échange plus pertinent avec l’entreprise.`,
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

function buildJsonLd(data: InrSearchPublicPageData) {
  const sameAs = data.socialLinks.map((link) => link.url).filter(Boolean);
  const offers = data.services.map((service) => ({
    "@type": "Offer",
    itemOffered: {
      "@type": "Service",
      name: service,
      serviceType: service,
      description: buildServiceDescription(service, data),
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
            contactType: "customer service",
            availableLanguage: ["fr"],
          }
        : undefined,
    hasMap: data.googleBusinessUrl || undefined,
    potentialAction:
      data.phone || data.email
        ? {
            "@type": "CommunicateAction",
            name: `Contacter ${data.companyName}`,
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
          name: `Fiche iNr'Badge de ${data.companyName}`,
        }
      : undefined,
    hasOfferCatalog: offers.length
      ? {
          "@type": "OfferCatalog",
          name: `Prestations de ${data.companyName}`,
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

function buildWebPageJsonLd(data: InrSearchPublicPageData) {
  const url = buildInrSearchPublicUrl(data.slug);
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: buildSeoTitle(data),
    description: buildSeoDescription(data),
    dateModified: data.updatedAt || undefined,
    about: { "@id": `${url}#business` },
    mainEntity: { "@id": `${url}#business` },
    primaryImageOfPage: data.logoUrl || data.media[0]?.url
      ? {
          "@type": "ImageObject",
          url: data.media[0]?.url || data.logoUrl,
          caption: `${data.companyName}${data.city ? ` à ${data.city}` : ""}`,
        }
      : undefined,
    hasPart: [
      { "@type": "WebPageElement", "@id": `${url}#presentation`, name: "Présentation" },
      ...(data.sections.services && data.services.length
        ? [{ "@type": "WebPageElement", "@id": `${url}#prestations`, name: "Prestations" }]
        : []),
      ...(data.sections.media && data.media.length
        ? [{ "@type": "WebPageElement", "@id": `${url}#realisations`, name: "Réalisations" }]
        : []),
      ...(data.sections.news
        ? [{ "@type": "WebPageElement", "@id": `${url}#actualites`, name: "Actualités" }]
        : []),
      ...(data.sections.areas && data.zones.length
        ? [{ "@type": "WebPageElement", "@id": `${url}#zone`, name: "Zone d’intervention" }]
        : []),
      ...(data.sections.faq && data.faq.length
        ? [{ "@type": "WebPageElement", "@id": `${url}#faq`, name: "Questions fréquentes" }]
        : []),
      ...(data.sections.cta
        ? [{ "@type": "WebPageElement", "@id": `${url}#contact`, name: "Contact" }]
        : []),
    ],
    inLanguage: "fr-FR",
  };
}

function buildNewsJsonLd(data: InrSearchPublicPageData) {
  if (!data.publications.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Actualités de ${data.companyName}`,
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
        articleSection: "Actualités",
        inLanguage: "fr-FR",
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
  const { slug } = await params;
  const data = await loadInrSearchPublicPage(slug);
  if (!data) {
    return {
      title: "Entreprise introuvable | iNrCy",
      robots: { index: false, follow: false },
    };
  }

  const canonical = buildInrSearchPublicUrl(data.slug);
  const title = resolveSeoTitle(data);
  const description = buildSeoDescription(data);
  const image = data.logoUrl || data.media[0]?.url || undefined;

  return {
    title,
    description,
    applicationName: data.companyName,
    authors: [{ name: data.companyName, url: canonical }],
    creator: data.companyName,
    publisher: data.companyName,
    category: data.sectorLabel || data.profession || "Entreprise locale",
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
      locale: "fr_FR",
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
  const { slug } = await params;
  const data = await loadInrSearchPublicPage(slug);
  if (!data) notFound();
  if (normalizeInrSearchDirectorySlug(slug) !== data.slug) {
    permanentRedirect(`/entreprises/${data.slug}`);
  }

  const localBusinessJsonLd = buildJsonLd(data);
  const webPageJsonLd = buildWebPageJsonLd(data);
  const faqJsonLd = buildFaqJsonLd(data);
  const newsJsonLd = buildNewsJsonLd(data);
  const factualSummary = buildFactualSummary(data);
  const presentationLead = buildPresentationLead(data);
  const conversionSummary = buildConversionSummary(data);
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
    { href: "#presentation", label: "Identité" },
    ...(data.sections.services && data.services.length
      ? [{ href: "#prestations", label: "Expertises" }]
      : []),
    ...(data.sections.media && data.media.length
      ? [{ href: "#realisations", label: "Réalisations" }]
      : []),
    ...(data.sections.news
      ? [{ href: "#actualites", label: "Actualités" }]
      : []),
    ...(data.sections.areas && enhancedZones.length
      ? [{ href: "#zone", label: "Zone" }]
      : []),
    ...(data.sections.trust && (data.strengths.length || data.inrBadgeUrl)
      ? [{ href: "#points-forts", label: "Confiance" }]
      : []),
    ...(data.sections.faq && data.faq.length
      ? [{ href: "#faq", label: "FAQ" }]
      : []),
    ...(data.sections.socials && data.socialLinks.length
      ? [{ href: "#reseaux", label: "Réseaux" }]
      : []),
    ...(data.sections.cta ? [{ href: "#contact", label: "Contact" }] : []),
  ];
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Entreprises",
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
          label: "Activité",
          value: data.profession || data.sectorLabel,
          href: "",
          actionKey: "",
        }
      : null,
    data.city
      ? {
          icon: "location" as IconName,
          kind: "anchor",
          label: "Ancrage",
          value: data.city,
          href: "",
          actionKey: "",
        }
      : null,
    data.customerTypes.length
      ? {
          icon: "users" as IconName,
          kind: "audience",
          label: "Pour qui",
          value: joinFrenchList(data.customerTypes.slice(0, 2)),
          href: "",
          actionKey: "",
        }
      : null,
    data.strengths.length
      ? {
          icon: "sparkles" as IconName,
          kind: "strengths",
          label: "Forces",
          value: buildPresentationStrengthValue(data.strengths),
          href: "#points-forts",
          actionKey: "strengths_view",
        }
      : null,
    data.sections.hours && (data.openingDays || data.openingHours)
      ? {
          icon: "clock" as IconName,
          kind: "availability",
          label: "Disponibilité",
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
        Aller au contenu principal
      </a>
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
        Parcourez les rubriques horizontalement avec les flèches, la molette, le balayage tactile ou les liens de navigation.
      </p>
      <div
        className={styles.orbitViewport}
        data-inrsearch-orbit
        role="region"
        aria-roledescription="carrousel"
        aria-describedby="orbit-instructions"
        aria-label={`Parcours de ${data.companyName}`}
      >
        <section
          className={`${styles.orbitPanel} ${styles.presentationOrbit}`}
          id="presentation"
          tabIndex={-1}
          data-orbit-section
          aria-label="Présentation"
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
                  <strong>Profil professionnel vivant</strong>
                  {data.city ? <small>{data.city}</small> : null}
                </div>

                <h1 className={styles.presentationTitle}>{data.companyName}</h1>

                {data.sections.presentation ? (
                  <p className={styles.presentationDescription}>{presentationLead}</p>
                ) : null}

                <details className={styles.presentationSummary} open>
                  <summary>Informations essentielles</summary>
                  <p>{conversionSummary || factualSummary}</p>
                </details>

                {data.sections.cta ? (
                  <div className={styles.presentationActions}>
                    <a className={styles.presentationPrimaryAction} href="#contact">
                      <Icon name="sparkles" /> Présenter mon besoin
                    </a>
                    {navItems[1] ? (
                      <a
                        className={styles.presentationSecondaryAction}
                        href={navItems[1].href}
                      >
                        <Icon name="arrow" /> Explorer l’univers
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className={styles.presentationUniverse} aria-label={`Identité visuelle de ${data.companyName}`}>
                <div className={styles.presentationHalo} aria-hidden="true" />
                <div className={styles.presentationMediaOrb}>
                  <div className={styles.presentationMediaFallback}>
                    <InrSearchLogo
                      src={data.logoUrl}
                      alt={`Logo de ${data.companyName}`}
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

                <div className={styles.presentationFactOrbit} aria-label="Informations principales">
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
              <span>Faites glisser pour découvrir</span>
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
            aria-label="Prestations"
          >
            <InrSearchServicesOrbit
              companyName={data.companyName}
              services={data.services.map((service) => ({
                name: service,
                description: buildServiceDescription(service, data),
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
            aria-label="Réalisations"
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
            aria-label="Actualités"
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
            aria-label="Zone d’intervention"
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
            aria-label="Points forts"
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
            aria-label="Questions fréquentes"
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
            aria-label="Réseaux et présence en ligne"
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
            aria-label="Contact"
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
