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
import {
  AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS,
  AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS,
  AI_MEDIA_VISIBLE_EYEBROW_MAX_CHARACTERS,
  AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS,
  acceptCompleteAiMediaVisibleCopy,
  normalizeAiMediaCopy,
} from "@/lib/aiMediaTextIntegrity";
import { getAiMediaVideoSegmentCount } from "@/lib/aiMediaVideoTimeline";
import { fitAiMediaSceneDirection } from "./aiMediaTechnicalText.ts";

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

function resolveAiMediaTextMode(request: AiMediaGenerationRequest) {
  return request.textMode || (request.withText ? "ai" : "none");
}

function applyAiMediaTextPolicy(
  request: AiMediaGenerationRequest,
  plan: AiMediaCreativePlan
): AiMediaCreativePlan {
  const textMode = resolveAiMediaTextMode(request);
  if (textMode === "ai") return plan;

  if (textMode === "exact") {
    const exactText = cleanStructuredText(request.exactText, 600);
    return {
      ...plan,
      headline: exactText,
      subline: "",
      cta: "",
      scenes: plan.scenes.map((scene, index) => ({
        ...scene,
        eyebrow: "",
        title: index === 0 ? exactText : "",
        body: "",
      })),
    };
  }

  // Le plan narratif reste utile au moteur (action, continuité, narration),
  // mais `withText:false` empêche son rendu à l'écran dans les compositeurs.
  return plan;
}

function clean(value: unknown, max = 160) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[#*_`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanStructuredText(value: unknown, max = 600) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** Validate-or-reject helper for internal copy building. Never slices words. */
function compactAtWordBoundary(value: unknown, max: number) {
  const normalized = clean(value, Math.max(300, max + 80));
  if (normalized.length <= max) return normalized;
  return "";
}

function compactHeadline(
  value: string,
  max = AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS
) {
  return acceptCompleteAiMediaVisibleCopy(value, max);
}

function compactVisibleBody(
  value: string,
  max = AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS
) {
  return acceptCompleteAiMediaVisibleCopy(value, max);
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
    "la peinture "
  );
}

/**
 * Une idée libre est souvent une petite scène ("un artisan reçoit...") et non
 * un groupe nominal. Le secours local reste strictement factuel : il reformule
 * une action détectable ou conserve le sujet nettoyé, sans ajouter de slogan.
 */
function narrativeIdeaHeadline(value: string, variant: number) {
  const clause = value.match(
    /^(.{2,34}?)\s+(reçoit|reçoivent|a reçu|ont reçu)\s+(.{3,58})$/i
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
    /^(.{2,34}?)\s+(?:crée|créent|prépare|préparent|réalise|réalisent|lance|lancent|organise|organisent|accompagne|accompagnent|transforme|transforment|rénove|rénovent|répare|réparent|présente|présentent|dévoile|dévoilent|développe|développent|installe|installent|construit|construisent|livre|livrent|accueille|accueillent)\s+(.{3,58})$/i
  );
  if (!actionClause) return "";
  const actor = lowerFirst(actionClause[1]);
  const object = lowerFirst(actionClause[2]);
  const factualCandidates = [
    capitalize(value),
    `${capitalize(object)} — ${actor}`,
  ];
  return compactHeadline(
    factualCandidates[variant % factualCandidates.length]
  );
}

function commercialOfferDetails(value: string) {
  if (
    !/\b(?:pack|forfait|formule|offre|abonnement|tarif|prix|compar)\w*/i.test(
      value
    )
  ) {
    return null;
  }
  const pricePattern =
    "\\d{1,4}(?:[.,]\\d{1,2})?\\s*(?:€|euros?)(?:\\s*(?:/|par)\\s*(?:mois|an|année|jour))?";
  const normalizePrice = (raw: string) =>
    raw
      .replace(/\s*(?:euros?)/i, " €")
      .replace(/\s*€/u, " €")
      .replace(/\s*(?:\/|par)\s*/i, " / ")
      .trim();
  const namedOffers = Array.from(
    value.matchAll(
      new RegExp(
        `\\b(?:pack|forfait|formule|offre)\\s+([\\p{L}\\p{M}\\p{N}'’\\-]{2,28})\\s*(?:à|:|-)?\\s*(${pricePattern})`,
        "giu"
      )
    ),
    (match) => ({ name: match[1].trim(), price: normalizePrice(match[2]) })
  ).slice(0, 2);
  const amounts = Array.from(
    value.matchAll(new RegExp(`\\b${pricePattern}`, "giu")),
    (match) => normalizePrice(match[0])
  ).filter((amount, index, all) => all.indexOf(amount) === index);
  if (namedOffers.length >= 2) {
    return {
      headline: compactHeadline(
        `${capitalize(namedOffers[0].name)} ou ${capitalize(
          namedOffers[1].name
        )}`
      ),
      subline: clean(
        `${namedOffers[0].name} ${namedOffers[0].price} · ${namedOffers[1].name} ${namedOffers[1].price}`,
        AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS
      ),
    };
  }
  if (amounts.length >= 2) {
    return {
      headline: compactHeadline(`Packs : ${amounts[0]} et ${amounts[1]}`),
      subline: clean(
        `${amounts[0]} · ${amounts[1]}`,
        AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS
      ),
    };
  }
  if (amounts.length === 1) {
    return {
      headline: compactHeadline(`Une offre à ${amounts[0]}`),
      subline: amounts[0],
    };
  }
  return null;
}

/**
 * Build a fast, deterministic fallback from a free-form idea without ever
 * exposing the instruction verbatim. The AI copywriter can improve it, but a
 * short timeout must not make the visible copy unrelated to the chosen topic.
 */
function ideaHeadline(value: string, variant: number) {
  const original = normalizeAiMediaCopy(value)
    .replace(/[.!?]+$/g, "")
    .trim();
  const commercialDetails = commercialOfferDetails(original);
  if (commercialDetails) return commercialDetails.headline;
  const firstBeat =
    original.split(/\s*(?:,|;|→|->|\bpuis\b|\bensuite\b|\bafin de\b)\s*/i)[0] ||
    original;
  const normalizedSubject = normalizeAiMediaCopy(
    normalizeFrenchIdeaTopic(
      firstBeat
        .replace(
          /^(?:je\s+(?:veux|souhaite|voudrais)\s+(?:une?\s+)?(?:image|vid[eé]o|publication|contenu)?\s*(?:qui|sur|pour|de)?\s*)/i,
          ""
        )
        .replace(
          /^(?:(?:mettre\s+en\s+avant|cr[eé]er|faire|montrer|pr[eé]senter|illustrer|raconter|expliquer|valoriser|animer|filmer)\s+|partir\s+(?:d['’]|de\s+|du\s+|des\s+|avec\s+)|parler\s+de\s+)/i,
          ""
        )
    )
  );
  const subject =
    normalizedSubject.length <= AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS
      ? normalizedSubject
      : "";
  const topic =
    subject ||
    compactAtWordBoundary(normalizeFrenchIdeaTopic(firstBeat), 80);
  if (!topic) return "";
  const narrativeHeadline = narrativeIdeaHeadline(topic, variant);
  if (narrativeHeadline) return narrativeHeadline;
  return compactHeadline(capitalize(topic));
}

function capitalize(value: string) {
  const normalized = compactAtWordBoundary(
    value,
    AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS
  );
  return normalized
    ? `${normalized.charAt(0).toLocaleUpperCase()}${normalized.slice(1)}`
    : "";
}

function keywordHeadline(values: readonly string[]) {
  const keywords = values
    .map((value) => capitalize(value))
    .filter(Boolean)
    .slice(0, 3);
  if (!keywords.length) return "";
  if (keywords.length === 1) {
    return compactHeadline(keywords[0]);
  }
  // Plusieurs tags restent des intentions sémantiques. Le plan technique ne
  // fabrique jamais une accroche à partir d'une liste : le copywriter central
  // doit produire la formulation finale ou le média reste sans texte.
  return "";
}

function historyText(publications: readonly RecentPublication[]) {
  return publications
    .map(
      (item) => `${item.idea || ""} ${item.title || ""} ${item.content || ""}`
    )
    .join(" ")
    .toLocaleLowerCase();
}

function chooseFresh(values: readonly string[], history: string, offset = 0) {
  const cleaned = values.map((value) => clean(value, 90)).filter(Boolean);
  const fresh = cleaned.filter(
    (value) => !history.includes(value.toLocaleLowerCase())
  );
  // Ne recycle jamais silencieusement un service déjà présent dans
  // l'historique. Les autres faits vérifiés du profil prendront le relais.
  return fresh.length ? fresh[offset % fresh.length] : "";
}

function variationIndex(value: string, modulo: number) {
  let hash = 0;
  for (const character of value)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
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
  const guided = keywordHeadline(args.textKeywords);
  if (guided) return guided;
  const subject =
    args.service || args.profession || args.company;
  if (!subject) return "";
  // Le plan local ne produit plus de slogan par typologie. Il transmet un fait
  // vérifié (entreprise, service ou métier) au composeur et laisse le
  // copywriter v23 créer une accroche contextualisée lorsqu'un texte est voulu.
  return compactHeadline(
    args.typology === "company" && args.company ? args.company : subject
  );
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
  visualBrief = ""
): AiMediaCreativeScene | null {
  const safeTitle = compactHeadline(title);
  if (!safeTitle) return null;
  const safeBody = compactVisibleBody(body);
  return {
    eyebrow:
      normalizeAiMediaCopy(eyebrow).length <= AI_MEDIA_VISIBLE_EYEBROW_MAX_CHARACTERS
        ? normalizeAiMediaCopy(eyebrow)
        : "",
    title: safeTitle,
    body: safeBody,
    // Secours local immédiatement prononçable. Le copywriter média remplace
    // ces formulations par des répliques contextualisées quand les
    // personnages doivent parler.
    spokenLine: compactAtWordBoundary(safeTitle, AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS),
    spokenReply:
      safeBody ||
      compactAtWordBoundary(safeTitle, AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS),
    visualBrief: fitAiMediaSceneDirection(visualBrief),
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
  const contentTarget = Math.max(0, args.targetCount - (conclusion ? 1 : 0));
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
    selected.splice(
      Math.max(0, selected.length - (conclusion ? 1 : 0)),
      0,
      candidate
    );
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
  const audience = chooseFresh(
    business.customerTypologies,
    history,
    variant + 2
  );
  const zone = chooseFresh(business.interventionZones, history, variant + 3);
  const profession = business.professionLabel || business.sectorLabel;
  const companyName = business.companyName || localized.professionalFallback;
  const typology = safeTypology(request);
  const targetCount =
    request.kind === "video"
      ? getAiMediaVideoSegmentCount(request.durationSeconds || 16)
      : 1;
  const oneShotInstruction = cleanStructuredText(request.aiInstruction, 2_400);
  const priorityBrief = cleanStructuredText(
    request.idea || request.aiInstruction,
    2_400
  );
  const commercialDetails = commercialOfferDetails(priorityBrief);
  const instructionDirection = oneShotInstruction
    ? ` CONSIGNE PRIORITAIRE : ${oneShotInstruction}. L'appliquer entièrement sans l'afficher ni la réciter.`
    : "";

  const exactIdeaDirection = (idea: string) =>
    [
      `SUJET IMMUTABLE : ${cleanStructuredText(idea, 2_000)}.`,
      "Conserver ce même sujet, ses personnages ou objets, son action et son objectif dans chaque acte ; ne jamais le remplacer par une prestation générique de l'ADN.",
      instructionDirection,
    ]
      .filter(Boolean)
      .join(" ");

  const userDirectedScenes = (options: {
    idea: string;
    headline: string;
    subline: string;
    cta: string;
    supportingEyebrow: string;
    supportingTitle: string;
    supportingBody: string;
  }) => {
    const contract = exactIdeaDirection(options.idea);
    return [
      scene(
        companyName,
        options.headline,
        options.subline,
        "hero",
        `ACTE 1 : commencer l'action principale dès la première image et rendre immédiatement le sujet reconnaissable. ${contract}`
      ),
      scene(
        options.supportingEyebrow,
        options.supportingTitle,
        options.supportingBody,
        "editorial",
        `ACTE 2 : poursuivre exactement la même action avec une étape ou une preuve nouvelle et concrète, sans redémarrer ni changer de sujet. ${contract}`
      ),
      scene(
        companyName,
        options.cta,
        business.city,
        "cta",
        `ACTE FINAL : achever exactement la même action, montrer son résultat concret puis une prochaine étape naturelle, sans introduire une autre prestation. ${contract}`
      ),
    ].filter((value): value is AiMediaCreativeScene => Boolean(value));
  };

  // Le plan français historique reste riche et très contextualisé. Pour toute
  // autre langue, le plan déterministe de secours n'affiche volontairement que
  // des formulations déjà localisées et des noms propres vérifiés. Le petit
  // copywriter média le personnalise ensuite à partir du profil ; s'il tombe,
  // aucun fragment français du profil ne fuit dans le visuel final.
  if (language !== "fr") {
    const headline = compactHeadline(
      commercialDetails?.headline ||
        service ||
        profession ||
        business.companyName ||
        companyName
    );
    const subline = clean(
      commercialDetails?.subline ||
        strength ||
        business.description ||
        zone ||
        business.city,
      145
    );
    const cta = ctaLabel(profile);
    const idea = priorityBrief;
    if (idea) {
      return applyAiMediaTextPolicy(request, {
        headline,
        subline,
        companyName,
        cta,
        scenes: finalizeScenes({
          candidates: userDirectedScenes({
            idea,
            headline,
            subline,
            cta,
            supportingEyebrow: companyName,
            supportingTitle:
              strength || business.services[1] || service || profession,
            supportingBody: zone || business.city || subline,
          }),
          targetCount,
          language,
        }),
      });
    }
    const ideaDirection =
      `Représenter concrètement l'activité ${profession || companyName}.` +
      instructionDirection;
    const localizedScenes = [
      scene(companyName, headline, subline, "hero", ideaDirection),
      scene(
        companyName,
        strength || business.services[1] || service || profession || headline,
        zone || business.city || subline,
        "editorial",
        `${ideaDirection} Montrer une action professionnelle crédible, sans texte généré dans le décor.`
      ),
      scene(
        companyName,
        cta,
        business.city,
        "cta",
        `Conclure la même histoire sur un résultat clair et rassurant. ${ideaDirection}`
      ),
    ].filter((value): value is AiMediaCreativeScene => Boolean(value));

    return applyAiMediaTextPolicy(request, {
      headline,
      subline,
      companyName,
      cta,
      scenes: finalizeScenes({
        candidates: localizedScenes,
        targetCount,
        language,
      }),
    });
  }

  const idea = priorityBrief;
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
    commercialDetails?.subline ||
      business.description ||
      [profession, business.city].filter(Boolean).join(" à "),
    145
  );
  const cta = commercialDetails ? "Comparer les offres" : ctaLabel(profile);
  if (idea) {
    return applyAiMediaTextPolicy(request, {
      headline,
      subline,
      companyName,
      cta,
      scenes: finalizeScenes({
        candidates: userDirectedScenes({
          idea,
          headline,
          subline,
          cta,
          supportingEyebrow: companyName,
          supportingTitle:
            strength || business.services[1] || service || profession || headline,
          supportingBody: subline,
        }),
        targetCount,
        language,
      }),
    });
  }
  const ideaDirection =
    `Representer concretement l'activite ${profession || companyName}.` +
    instructionDirection;

  const candidates = [
    scene(companyName, headline, subline, "hero", ideaDirection),
    service
      ? scene(
          companyName,
          service,
          profession,
          "editorial",
          `${ideaDirection} Montrer une action credible liee a la prestation ${service}.`
        )
      : null,
    business.services[1]
      ? scene(
          companyName,
          business.services[1],
          companyName,
          "editorial",
          `${ideaDirection} Illustrer concretement ${business.services[1]}.`
        )
      : null,
    strength
      ? scene(
          companyName,
          strength,
          subline,
          "statement",
          `${ideaDirection} Rendre visible la force professionnelle suivante : ${strength}.`
        )
      : null,
    audience
      ? scene(
          companyName,
          audience,
          service || profession,
          "editorial",
          `${ideaDirection} Mettre en scene la clientele ${audience} dans une situation naturelle.`
        )
      : null,
    zone || business.city
      ? scene(
          companyName,
          zone || business.city,
          [profession, business.city].filter(Boolean).join(" · "),
          "statement",
          `${ideaDirection} Ancrer la scene de facon credible a ${
            zone || business.city
          }.`
        )
      : null,
    business.openingHours
      ? scene(
          companyName,
          business.openingHours,
          business.openingHours,
          "editorial"
        )
      : null,
    business.services[2]
      ? scene(
          companyName,
          business.services[2],
          strength,
          "editorial"
        )
      : null,
    scene(
      companyName,
      cta,
      business.city,
      "cta",
      `Conclure la même histoire en montrant le résultat concret obtenu et une prochaine étape naturelle. ${ideaDirection}`
    ),
  ].filter((value): value is AiMediaCreativeScene => Boolean(value));

  const fallbackScenes = [
    scene(
      companyName,
      service || profession || companyName,
      strength || business.description,
      "statement"
    ),
    scene(
      companyName,
      strength || service || profession || companyName,
      zone || business.city,
      "editorial"
    ),
    scene(
      companyName,
      cta,
      business.city,
      "cta",
      `Conclure la même histoire en montrant le résultat concret obtenu et une prochaine étape naturelle. ${ideaDirection}`
    ),
  ].filter((value): value is AiMediaCreativeScene => Boolean(value));
  return applyAiMediaTextPolicy(request, {
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
  });
}
