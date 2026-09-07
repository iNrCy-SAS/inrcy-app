import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type {
  AiMediaGenerationRequest,
  AiMediaTypology,
} from "@/lib/aiMediaGenerationContracts";
import {
  aiMediaDialogueSignature,
  selectAiMediaDialogueLine,
} from "@/lib/aiMediaDialogue";
import { getAiMediaLanguageCopy } from "@/lib/aiMediaLanguage";
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
  /** Phrase courte réellement prononcée lorsque le personnage parle. */
  spokenLine: string;
  /** Réponse éventuelle du second personnage dans une scène d'équipe. */
  spokenReply: string;
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

/**
 * Les textes visibles ne doivent jamais subir le `slice` technique de
 * `clean()`: il transformait par exemple "Guyancourt" en "Guyanc" dans le
 * secours déterministe. On préfère retirer le dernier mot entier si la limite
 * est atteinte.
 */
function compactAtWordBoundary(value: unknown, max: number) {
  const normalized = clean(value, Math.max(300, max + 80));
  if (normalized.length <= max) return normalized;
  const candidate = normalized
    .slice(0, max + 1)
    .replace(/\s+\S*$/, "")
    .trim();
  return candidate || normalized;
}

const DANGLING_VISIBLE_WORDS = new Set([
  "a", "afin", "au", "aux", "avec", "car", "ce", "ces", "chez", "comme",
  "dans", "de", "des", "du", "en", "et", "la", "le", "les", "mais", "notre",
  "ou", "par", "pour", "que", "qui", "sans", "sur", "un", "une", "vers", "votre",
]);

function visibleWordSignature(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z]/g, "");
}

function trimDanglingVisibleEnding(value: string) {
  const words = value
    .replace(/(?:\.{3}|…)+$/g, "")
    .replace(/[,:;\-–—]+$/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (
    words.length > 1 &&
    DANGLING_VISIBLE_WORDS.has(visibleWordSignature(words.at(-1) || ""))
  ) {
    words.pop();
  }
  return words.join(" ").replace(/[,:;\-–—]+$/g, "").trim();
}

function hasDanglingVisibleEnding(value: string) {
  const lastWord = value
    .replace(/[.,;:!?…\-–—]+$/g, "")
    .trim()
    .split(/\s+/)
    .at(-1);
  return DANGLING_VISIBLE_WORDS.has(visibleWordSignature(lastWord || ""));
}

function compactHeadline(value: string, max = 58) {
  const normalized = clean(value, 140);
  if (normalized.length <= max) return trimDanglingVisibleEnding(normalized);
  const words = normalized.slice(0, max + 1).replace(/\s+\S*$/, "").trim();
  return trimDanglingVisibleEnding(words || normalized.split(/\s+/)[0] || "");
}

function compactVisibleBody(value: string, max = 78) {
  const normalized = clean(value, 300);
  if (
    normalized.length <= max &&
    !/(?:\.{3}|…)\s*$/.test(normalized) &&
    !hasDanglingVisibleEnding(normalized)
  ) {
    return normalized;
  }
  const sentenceEnd = /[.!?]+(?=\s|$)/g;
  let match: RegExpExecArray | null;
  let best = "";
  while ((match = sentenceEnd.exec(normalized))) {
    if (match[0].length >= 3) continue;
    const candidate = normalized.slice(0, match.index + match[0].length).trim();
    if (candidate.length > max) break;
    if (hasDanglingVisibleEnding(candidate)) continue;
    best = candidate;
  }
  return best;
}

function lowerFirst(value: string) {
  const normalized = compactAtWordBoundary(value, 80);
  return normalized
    ? `${normalized.charAt(0).toLocaleLowerCase()}${normalized.slice(1)}`
    : "";
}

function normalizeFrenchIdeaTopic(value: string) {
  return value.replace(
    /^(?:(?:des?|les)\s+)?(?:travaux\s+de\s+)?peintures?\s+r[ée]alis(?:é|ée|és|ées)\s+/i,
    "la peinture ",
  );
}

/**
 * Une idée libre est souvent une petite scène ("un artisan reçoit...") et non
 * un groupe nominal. Lui préfixer "Cap sur" produit une phrase cassée. Cette
 * reformulation locale couvre les verbes les plus fréquents sans inventer de
 * fait et reste disponible lorsque le copywriter distant expire.
 */
function narrativeIdeaHeadline(value: string, variant: number) {
  const clause = value.match(
    /^(.{2,34}?)\s+(reçoit|reçoivent|a reçu|ont reçu)\s+(.{3,58})$/i,
  );
  if (clause) {
    const actor = lowerFirst(clause[1]);
    const object = lowerFirst(clause[3]);
    const plural = /^(?:reçoivent|ont reçu)$/i.test(clause[2]);
    const candidates = [
      `${capitalize(object)} : ${actor} en action`,
      `Face à ${object}, ${actor} ${plural ? "passent" : "passe"} à l’action`,
    ];
    return compactHeadline(candidates[variant % candidates.length]);
  }

  const actionClause = value.match(
    /^(.{2,34}?)\s+(?:crée|créent|prépare|préparent|réalise|réalisent|lance|lancent|organise|organisent|accompagne|accompagnent|transforme|transforment|rénove|rénovent|répare|réparent|présente|présentent|dévoile|dévoilent|développe|développent|installe|installent|construit|construisent|livre|livrent|accueille|accueillent)\s+(.{3,58})$/i,
  );
  if (!actionClause) return "";
  const actor = lowerFirst(actionClause[1]);
  const object = lowerFirst(actionClause[2]);
  return compactHeadline(
    variant % 2 === 0
      ? `${capitalize(object)} prend forme`
      : `${capitalize(actor)}, au cœur de l’action`,
  );
}

/**
 * Build a fast, deterministic fallback from a free-form idea without ever
 * exposing the instruction verbatim. The AI copywriter can improve it, but a
 * short timeout must not make the visible copy unrelated to the chosen topic.
 */
function ideaHeadline(value: string, variant: number) {
  const original = clean(value, 140).replace(/[.!?]+$/g, "").trim();
  const firstBeat =
    original.split(/\s*(?:,|;|→|->|\bpuis\b|\bensuite\b|\bafin de\b)\s*/i)[0] ||
    original;
  const subject = compactAtWordBoundary(
    normalizeFrenchIdeaTopic(
      firstBeat
      .replace(
        /^(?:je\s+(?:veux|souhaite|voudrais)\s+(?:une?\s+)?(?:image|vid[eé]o|publication|contenu)?\s*(?:qui|sur|pour|de)?\s*)/i,
        "",
      )
      .replace(
        /^(?:(?:mettre\s+en\s+avant|cr[eé]er|faire|montrer|pr[eé]senter|illustrer|raconter|expliquer|valoriser|animer|filmer)\s+|partir\s+(?:d['’]|de\s+|du\s+|des\s+|avec\s+)|parler\s+de\s+)/i,
        "",
      ),
    ),
    80,
  );
  const topic =
    subject ||
    compactAtWordBoundary(normalizeFrenchIdeaTopic(firstBeat), 80) ||
    "votre projet";
  const narrativeHeadline = narrativeIdeaHeadline(topic, variant);
  if (narrativeHeadline) return narrativeHeadline;
  const lowerTopic = `${topic.charAt(0).toLocaleLowerCase()}${topic.slice(1)}`;
  const candidates = [
    `${capitalize(topic)} prend vie`,
    `Cap sur ${lowerTopic}`,
    `${capitalize(topic)}, autrement`,
  ];
  return compactHeadline(candidates[variant % candidates.length]);
}

function capitalize(value: string) {
  const normalized = compactAtWordBoundary(value, 80);
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
  return compactHeadline(candidates[args.variant % candidates.length], 58);
}

function ctaLabel(profile: NormalizedAiGenerationProfile) {
  const copy = getAiMediaLanguageCopy(profile.preferences.language);
  return copy.ctas[profile.preferences.preferredCta] || copy.ctas.none;
}

function scene(
  eyebrow: string,
  title: string,
  body: string,
  layout: AiMediaCreativeScene["layout"],
  visualBrief = "",
): AiMediaCreativeScene | null {
  const safeTitle = compactHeadline(title, 58);
  if (!safeTitle) return null;
  const safeBody = compactVisibleBody(body);
  return {
    eyebrow: compactAtWordBoundary(eyebrow, 38),
    title: safeTitle,
    body: safeBody,
    // Secours local immédiatement prononçable. Le copywriter média remplace
    // ces formulations par des répliques contextualisées quand les
    // personnages doivent parler.
    spokenLine: compactAtWordBoundary(safeTitle, 96),
    spokenReply: safeBody || compactAtWordBoundary(safeTitle, 96),
    visualBrief: clean(visualBrief, 700),
    layout,
  };
}

function sceneTitleSignature(value: unknown) {
  return clean(value, 100)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Veo/Omni receive one scene per eight-second act. Duplicate headings used to
 * make two acts restart from the same idea. Keep each act semantically unique
 * and make the local dialogue fallback usable even when the copywriter is
 * unavailable.
 */
function finalizeScenes(args: {
  candidates: readonly AiMediaCreativeScene[];
  fallbacks?: readonly AiMediaCreativeScene[];
  targetCount: number;
  language: string;
}) {
  const pool = [...args.candidates, ...(args.fallbacks || [])];
  // Dès qu'un film comporte plusieurs actes, son dernier acte doit être une
  // vraie conclusion. Prendre simplement les N premières propositions
  // transformait parfois la scène 2/2 ou 3/3 en une prestation intermédiaire
  // alors que les moteurs la recevaient comme FINAL ACT.
  const conclusion =
    args.targetCount > 1
      ? [...pool].reverse().find((candidate) => candidate.layout === "cta")
      : undefined;
  const contentTarget = Math.max(
    0,
    args.targetCount - (conclusion ? 1 : 0),
  );
  const selected: AiMediaCreativeScene[] = [];
  const usedTitles = new Set<string>();
  for (const candidate of pool) {
    if (candidate === conclusion) continue;
    const signature = sceneTitleSignature(candidate.title);
    if (!signature || usedTitles.has(signature)) continue;
    usedTitles.add(signature);
    selected.push(candidate);
    if (selected.length === contentTarget) break;
  }
  if (conclusion) {
    const signature = sceneTitleSignature(conclusion.title);
    // Le CTA reste le dernier acte même si son libellé est aussi celui d'une
    // prestation. Une collision de titre ne doit jamais supprimer la fin du
    // film ni transformer 16/24 s en suite sans conclusion.
    if (signature) usedTitles.add(signature);
    selected.push(conclusion);
  }
  // Garde la durée contractuelle même si un CTA historique porte
  // exceptionnellement le même titre qu'une autre scène.
  for (const candidate of pool) {
    if (selected.length === args.targetCount) break;
    if (selected.includes(candidate)) continue;
    const signature = sceneTitleSignature(candidate.title);
    if (!signature || usedTitles.has(signature)) continue;
    usedTitles.add(signature);
    selected.splice(Math.max(0, selected.length - (conclusion ? 1 : 0)), 0, candidate);
  }

  const usedDialogue = new Set<string>();
  return selected.map((candidate, sceneIndex) => {
    const spokenLine = selectAiMediaDialogueLine({
      value: candidate.spokenLine,
      language: args.language,
      sceneIndex,
      sceneCount: selected.length,
      speaker: "lead",
      usedSignatures: usedDialogue,
    });
    usedDialogue.add(aiMediaDialogueSignature(spokenLine));
    const spokenReply = selectAiMediaDialogueLine({
      value: candidate.spokenReply,
      language: args.language,
      sceneIndex,
      sceneCount: selected.length,
      speaker: "reply",
      usedSignatures: usedDialogue,
    });
    usedDialogue.add(aiMediaDialogueSignature(spokenReply));
    return { ...candidate, spokenLine, spokenReply };
  });
}

export function buildAiMediaCreativePlan(args: {
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  recentPublications?: readonly RecentPublication[];
}): AiMediaCreativePlan {
  const { request, profile } = args;
  const business = profile.business;
  const language = profile.preferences.language;
  const localized = getAiMediaLanguageCopy(language);
  const history = historyText(args.recentPublications || []);
  const variant = variationIndex(request.requestId, 97);
  const service = chooseFresh(business.services, history, variant);
  const strength = chooseFresh(business.strengths, history, variant + 1);
  const audience = chooseFresh(business.customerTypologies, history, variant + 2);
  const zone = chooseFresh(business.interventionZones, history, variant + 3);
  const profession = business.professionLabel || business.sectorLabel;
  const companyName = business.companyName || localized.professionalFallback;
  const typology = safeTypology(request);
  const targetCount = getAiMediaVideoSegmentCount(request.durationSeconds || 16);
  const oneShotInstruction = clean(request.aiInstruction, 600);
  const instructionDirection = oneShotInstruction
    ? ` Consigne ponctuelle à appliquer sans l'afficher ni la recopier : ${oneShotInstruction}`
    : "";

  // Le plan français historique reste riche et très contextualisé. Pour toute
  // autre langue, le plan déterministe de secours n'affiche volontairement que
  // des formulations déjà localisées et des noms propres vérifiés. Le petit
  // copywriter média le personnalise ensuite à partir du profil ; s'il tombe,
  // aucun fragment français du profil ne fuit dans le visuel final.
  if (language !== "fr") {
    const headline = localized.headlines[typology];
    const subline = localized.sublineFallback;
    const cta = ctaLabel(profile);
    const idea = request.subjectSource === "profile" ? "" : clean(request.idea, 700);
    const ideaDirection = (idea
      ? `S'inspirer strictement de cette idée sans la recopier à l'écran : ${idea}`
      : `Représenter concrètement l'activité ${profession || companyName}.`) + instructionDirection;
    const localizedScenes = [
      scene(companyName, headline, subline, "hero", ideaDirection),
      scene(
        localized.supportingEyebrow,
        localized.supportingTitle,
        localized.supportingBody,
        "editorial",
        `${ideaDirection} Montrer une action professionnelle crédible, sans texte généré dans le décor.`,
      ),
      scene(
        companyName,
        cta,
        business.city,
        "cta",
        `Conclure la même histoire sur un résultat clair et rassurant. ${ideaDirection}`,
      ),
    ].filter((value): value is AiMediaCreativeScene => Boolean(value));

    return {
      headline,
      subline,
      companyName,
      cta,
      scenes: finalizeScenes({
        candidates: localizedScenes,
        targetCount,
        language,
      }),
    };
  }

  const idea = request.subjectSource === "profile" ? "" : clean(request.idea, 700);
  // Le copywriter reformule normalement cette base. Si son appel très court
  // expire, le secours local reste lié au vrai sujet sans jamais recopier la
  // consigne brute ou simplement la tronquer à l'écran.
  const headline = idea
    ? ideaHeadline(idea, variant)
    : typologyHeadline({
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
  const ideaDirection = (idea
    ? `S'inspirer strictement de cette idee sans la recopier a l'ecran : ${idea}`
    : `Representer concretement l'activite ${profession || companyName}.`) + instructionDirection;

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
    scene(
      companyName,
      cta,
      business.city,
      "cta",
      `Conclure la même histoire en montrant le résultat concret obtenu et une prochaine étape naturelle. ${ideaDirection}`,
    ),
  ].filter((value): value is AiMediaCreativeScene => Boolean(value));

  const fallbackScenes = [
    scene("Votre projet", "Une réponse sur mesure", service || profession, "statement"),
    scene("L’essentiel", "Qualité, écoute, proximité", strength || subline, "editorial"),
    scene(
      companyName,
      cta,
      business.city,
      "cta",
      `Conclure la même histoire en montrant le résultat concret obtenu et une prochaine étape naturelle. ${ideaDirection}`,
    ),
  ].filter((value): value is AiMediaCreativeScene => Boolean(value));
  return {
    headline,
    subline,
    companyName,
    cta,
    scenes: finalizeScenes({
      candidates,
      fallbacks: fallbackScenes,
      targetCount,
      language,
    }),
  };
}
