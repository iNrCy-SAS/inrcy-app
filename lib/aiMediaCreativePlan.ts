import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type {
  AiMediaGenerationRequest,
  AiMediaTypology,
} from "@/lib/aiMediaGenerationContracts";
import { getAiMediaVideoSegmentCount } from "@/lib/aiMediaVideoTimeline";

type RecentPublication = {
  title?: string | null;
  content?: string | null;
  idea?: string | null;
};

export type AiMediaCreativeScene = {
  eyebrow: string;
  title: string;
  body: string;
  visualBrief: string;
  layout: "hero" | "editorial" | "statement" | "cta";
};

export type AiMediaCreativePlan = {
  headline: string;
  subline: string;
  companyName: string;
  cta: string;
  scenes: AiMediaCreativeScene[];
};

function clean(value: unknown, max = 160) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[#*_`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function compactHeadline(value: string, max = 58) {
  const normalized = clean(value, 140);
  if (normalized.length <= max) return normalized;
  const words = normalized.slice(0, max + 1).replace(/\s+\S*$/, "").trim();
  return `${words || normalized.slice(0, max - 1).trim()}…`;
}

function capitalize(value: string) {
  const normalized = clean(value, 48);
  return normalized
    ? `${normalized.charAt(0).toLocaleUpperCase()}${normalized.slice(1)}`
    : "";
}

function keywordHeadline(values: readonly string[], variant: number) {
  const keywords = values
    .map((value) => capitalize(value))
    .filter(Boolean)
    .slice(0, 3);
  if (!keywords.length) return "";
  if (keywords.length === 1) {
    const [keyword] = keywords;
    const candidates = [
      `${keyword} en lumière`,
      `Cap sur ${keyword}`,
      `${keyword}, autrement`,
    ];
    return compactHeadline(candidates[variant % candidates.length]);
  }
  // Les tags sont des intentions sémantiques, jamais une ligne à afficher
  // telle quelle. Ce secours reste une vraie accroche même si le mini
  // copywriter IA est momentanément indisponible.
  const [keyword] = keywords;
  const candidates = [
    `${keyword}, une idée qui prend vie`,
    `${keyword} au service de votre projet`,
    `Une nouvelle façon de vivre ${keyword}`,
  ];
  return compactHeadline(candidates[variant % candidates.length]);
}

function historyText(publications: readonly RecentPublication[]) {
  return publications
    .map((item) => `${item.idea || ""} ${item.title || ""} ${item.content || ""}`)
    .join(" ")
    .toLocaleLowerCase();
}

function chooseFresh(values: readonly string[], history: string, offset = 0) {
  const cleaned = values.map((value) => clean(value, 90)).filter(Boolean);
  const fresh = cleaned.filter((value) => !history.includes(value.toLocaleLowerCase()));
  const candidates = fresh.length ? fresh : cleaned;
  return candidates.length ? candidates[offset % candidates.length] : "";
}

function variationIndex(value: string, modulo: number) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return modulo > 0 ? hash % modulo : 0;
}

function safeTypology(request: AiMediaGenerationRequest): AiMediaTypology {
  if (
    ["offer", "event", "recruitment"].includes(request.typology) &&
    request.subjectSource === "profile"
  ) {
    return "service";
  }
  return request.typology;
}

function typologyHeadline(args: {
  typology: AiMediaTypology;
  textKeywords: readonly string[];
  service: string;
  profession: string;
  company: string;
  variant: number;
}) {
  const guided = keywordHeadline(args.textKeywords, args.variant);
  if (guided) return guided;
  const subject = args.service || args.profession || args.company || "Votre projet";
  const templates: Record<AiMediaTypology, string[]> = {
    company: args.company
      ? [`Découvrez ${args.company}`, `${args.company}, à vos côtés`, `L’univers ${args.company}`]
      : ["Un savoir-faire à découvrir", "Une expertise à votre service", "Votre projet, notre métier"],
    service: [subject, "Une expertise pensée pour vous", "Votre projet entre de bonnes mains"],
    advice: ["Le conseil de votre expert", "Le bon réflexe de votre expert", "Un conseil qui fait la différence"],
    showcase: ["Notre savoir-faire en images", "Le geste qui fait la différence", "La qualité dans chaque détail"],
    offer: [subject, "Une solution à découvrir", "Le bon moment pour votre projet"],
    event: [subject, "Un rendez-vous à ne pas manquer", "Retrouvons-nous prochainement"],
    behind_scenes: ["Dans les coulisses de notre métier", "Les gestes derrière notre savoir-faire", "Au cœur de notre quotidien"],
    recruitment: ["Rejoignez notre aventure", "Construisons la suite ensemble", "Votre talent a sa place ici"],
  };
  const candidates = templates[args.typology];
  return clean(candidates[args.variant % candidates.length], 58);
}

function ctaLabel(profile: NormalizedAiGenerationProfile) {
  const labels: Record<string, string> = {
    devis: "Demandez votre devis",
    contact: "Contactez-nous",
    reservation: "Réservez votre rendez-vous",
    site: "Découvrez notre univers",
    message: "Échangeons sur votre projet",
  };
  return labels[profile.preferences.preferredCta] || "Parlons de votre projet";
}

function scene(
  eyebrow: string,
  title: string,
  body: string,
  layout: AiMediaCreativeScene["layout"],
  visualBrief = "",
): AiMediaCreativeScene | null {
  const safeTitle = clean(title, 86);
  if (!safeTitle) return null;
  return {
    eyebrow: clean(eyebrow, 38),
    title: safeTitle,
    body: clean(body, 150),
    visualBrief: clean(visualBrief, 700),
    layout,
  };
}

export function buildAiMediaCreativePlan(args: {
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  recentPublications?: readonly RecentPublication[];
}): AiMediaCreativePlan {
  const { request, profile } = args;
  const business = profile.business;
  const history = historyText(args.recentPublications || []);
  const variant = variationIndex(request.requestId, 97);
  const service = chooseFresh(business.services, history, variant);
  const strength = chooseFresh(business.strengths, history, variant + 1);
  const audience = chooseFresh(business.customerTypologies, history, variant + 2);
  const zone = chooseFresh(business.interventionZones, history, variant + 3);
  const profession = business.professionLabel || business.sectorLabel;
  const companyName = business.companyName || "Votre professionnel iNrCy";
  const typology = safeTypology(request);
  const headline = typologyHeadline({
    typology,
    textKeywords: request.withText ? request.textKeywords : [],
    service,
    profession,
    company: business.companyName,
    variant,
  });
  const subline = clean(
    business.description ||
      [profession, business.city].filter(Boolean).join(" à ") ||
      "Une expertise au service de votre projet",
    145,
  );
  const cta = ctaLabel(profile);
  const idea = request.subjectSource === "profile" ? "" : clean(request.idea, 700);
  const ideaDirection = idea
    ? `S'inspirer strictement de cette idee sans la recopier a l'ecran : ${idea}`
    : `Representer concretement l'activite ${profession || companyName}.`;

  const candidates = [
    scene(companyName, headline, subline, "hero", ideaDirection),
    service
      ? scene(
          "Notre expertise",
          service,
          profession,
          "editorial",
          `${ideaDirection} Montrer une action credible liee a la prestation ${service}.`,
        )
      : null,
    business.services[1]
      ? scene(
          "À vos côtés",
          business.services[1],
          companyName,
          "editorial",
          `${ideaDirection} Illustrer concretement ${business.services[1]}.`,
        )
      : null,
    strength
      ? scene(
          "Notre différence",
          strength,
          subline,
          "statement",
          `${ideaDirection} Rendre visible la force professionnelle suivante : ${strength}.`,
        )
      : null,
    audience
      ? scene(
          "Pensé pour vous",
          audience,
          service || profession,
          "editorial",
          `${ideaDirection} Mettre en scene la clientele ${audience} dans une situation naturelle.`,
        )
      : null,
    zone || business.city
      ? scene(
          "Proche de vous",
          zone || business.city,
          [profession, business.city].filter(Boolean).join(" · "),
          "statement",
          `${ideaDirection} Ancrer la scene de facon credible a ${zone || business.city}.`,
        )
      : null,
    business.openingHours
      ? scene("Disponible", "À votre rythme", business.openingHours, "editorial")
      : null,
    business.services[2]
      ? scene("Une solution complète", business.services[2], strength, "editorial")
      : null,
    scene(companyName, cta, business.city, "cta"),
  ].filter((value): value is AiMediaCreativeScene => Boolean(value));

  const targetCount = getAiMediaVideoSegmentCount(request.durationSeconds || 16);
  const fallbackScenes = [
    scene("Votre projet", "Une réponse sur mesure", service || profession, "statement"),
    scene("L’essentiel", "Qualité, écoute, proximité", strength || subline, "editorial"),
    scene(companyName, cta, business.city, "cta"),
  ].filter((value): value is AiMediaCreativeScene => Boolean(value));
  while (candidates.length < targetCount) {
    candidates.splice(Math.max(1, candidates.length - 1), 0, fallbackScenes[candidates.length % fallbackScenes.length]);
  }

  return {
    headline,
    subline,
    companyName,
    cta,
    scenes: candidates.slice(0, targetCount),
  };
}
