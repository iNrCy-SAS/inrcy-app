/**
 * Le planning iNr'Agent attribue un vrai sujet à chaque créneau avant la
 * génération. On ne laisse donc pas le modèle choisir indéfiniment parmi une
 * longue liste de prestations : le sujet, le territoire et l'angle sont
 * distribués puis persistés avec le créneau.
 *
 * Ce module est volontairement pur. Il peut être testé sans Supabase et le
 * résultat reste stable lors d'une nouvelle tentative de génération.
 */

export const INR_AGENT_EDITORIAL_VARIATION_VERSION = 1 as const;

export type InrAgentEditorialFocusSource =
  | "professional_idea"
  | "business_dna"
  | "business_profile_fallback";

export type InrAgentEditorialFocus = {
  version: typeof INR_AGENT_EDITORIAL_VARIATION_VERSION;
  source: InrAgentEditorialFocusSource;
  /** Sujet prioritaire transmis au rédacteur et au générateur média. */
  subject: string;
  /** Prestation ou spécialité réellement sélectionnée, si renseignée. */
  service: string;
  zone: string;
  audience: string;
  strength: string;
  specialty: string;
  customerNeed: string;
  /** Argument ou preuve issue de l'iNr'ADN, jamais inventée par le modèle. */
  businessArgument: string;
  /** Repère récent fourni par l'iNr'ADN, utilisé sans en inventer les détails. */
  contextualHook: string;
  angle: string;
  /** Direction visuelle dérivée du même sujet que le texte. */
  mediaDirection: string;
  /** Empreinte lisible utilisée pour éviter la répétition exacte. */
  focusKey: string;
};

type JsonRecord = Record<string, unknown>;

type EditorialSlotLike = {
  slotKey: string;
  sequence: number;
  theme: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function cleanText(value: unknown, maxLength = 180) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanList(
  value: unknown,
  maxItems = 24,
  maxItemLength = 160,
): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[;,\n]/)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    const text = cleanText(item, maxItemLength);
    const key = normalizedKey(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }

  return result;
}

function mergedList(
  values: unknown[],
  maxItems = 24,
  maxItemLength = 160,
) {
  return cleanList(values.flatMap((value) => cleanList(value, maxItems, maxItemLength)), maxItems, maxItemLength);
}

function normalizedKey(value: unknown) {
  return cleanText(value, 2_000)
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableScore(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizedKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedTokens(value: unknown) {
  return normalizedKey(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

/**
 * Une idée est considérée comme déjà couverte uniquement lorsque le texte est
 * très proche. Cela évite de jeter une idée parce qu'elle partage un simple
 * mot métier avec une publication antérieure.
 */
export function isInrAgentEditorialIdeaCovered(
  idea: unknown,
  historicalSubjects: readonly unknown[],
) {
  const normalizedIdea = normalizedKey(idea);
  const ideaTokens = Array.from(new Set(normalizedTokens(idea)));
  if (!normalizedIdea || !ideaTokens.length) return false;

  return historicalSubjects.some((history) => {
    const normalizedHistory = normalizedKey(history);
    if (!normalizedHistory) return false;
    if (
      normalizedHistory === normalizedIdea ||
      (normalizedIdea.length >= 18 && normalizedHistory.includes(normalizedIdea)) ||
      (normalizedHistory.length >= 18 && normalizedIdea.includes(normalizedHistory))
    ) {
      return true;
    }

    const historyTokens = new Set(normalizedTokens(history));
    const shared = ideaTokens.filter((token) => historyTokens.has(token)).length;
    const requiredShared = Math.min(3, ideaTokens.length);
    return (
      shared >= requiredShared &&
      shared / ideaTokens.length >= 0.72
    );
  });
}

export function normalizeInrAgentEditorialFocus(
  value: unknown,
): InrAgentEditorialFocus | null {
  const source = asRecord(value);
  const rawSource = cleanText(source.source, 80);
  const focusSource: InrAgentEditorialFocusSource = [
    "professional_idea",
    "business_dna",
    "business_profile_fallback",
  ].includes(rawSource)
    ? (rawSource as InrAgentEditorialFocusSource)
    : "business_profile_fallback";
  const subject = cleanText(source.subject, 500);
  if (!subject) return null;
  const service = cleanText(source.service, 180);
  const zone = cleanText(source.zone, 160);
  const audience = cleanText(source.audience, 160);
  const strength = cleanText(source.strength, 180);
  const specialty = cleanText(source.specialty, 180);
  const customerNeed = cleanText(source.customerNeed, 180);
  const businessArgument = cleanText(source.businessArgument, 280);
  const contextualHook = cleanText(source.contextualHook, 240);
  const angle = cleanText(source.angle, 100) || "conseil_pratique";
  const mediaDirection = cleanText(source.mediaDirection, 500);
  const focusKey =
    cleanText(source.focusKey, 500) ||
    [
      focusSource,
      subject,
      service,
      zone,
      audience,
      strength,
      specialty,
      customerNeed,
      businessArgument,
      contextualHook,
      angle,
    ]
      .map(normalizedKey)
      .filter(Boolean)
      .join(":");

  return {
    version: INR_AGENT_EDITORIAL_VARIATION_VERSION,
    source: focusSource,
    subject,
    service,
    zone,
    audience,
    strength,
    specialty,
    customerNeed,
    businessArgument,
    contextualHook,
    angle,
    mediaDirection,
    focusKey,
  };
}

function focusFromExisting(
  value: unknown,
): InrAgentEditorialFocus | null {
  return normalizeInrAgentEditorialFocus(value);
}

function existingFocusForSlot(
  value: ReadonlyMap<string, unknown> | Record<string, unknown> | undefined,
  slotKey: string,
) {
  if (!value) return null;
  const possibleMap = value as ReadonlyMap<string, unknown>;
  const raw =
    typeof possibleMap.get === "function"
      ? possibleMap.get(slotKey)
      : (value as Record<string, unknown>)[slotKey];
  return focusFromExisting(raw);
}

function listForBusiness(
  business: JsonRecord,
  memory: JsonRecord,
  keys: string[],
  memoryKeys: string[] = [],
  maxItems = 24,
) {
  return mergedList(
    [
      ...keys.map((key) => business[key]),
      ...memoryKeys.map((key) => memory[key]),
    ],
    maxItems,
  );
}

function angleCandidates(theme: string) {
  const candidatesByTheme: Record<string, string[]> = {
    conseils: ["conseil_pratique", "erreur_a_eviter", "repere_utile", "bon_reflexe"],
    realisations: ["methode", "avant_apres_sans_promesse", "savoir_faire", "detail_qui_compte"],
    offres: ["benefice_client", "choix_eclaire", "service_a_decouvrir", "appel_a_l_action"],
    actualites: ["saisonnier", "actualite_utile", "prevention", "tendance_metier"],
    coulisses: ["geste_metier", "organisation", "preparation", "exigence_qualite"],
    temoignages: ["confiance", "preuve_sobre", "ecoute_client", "relation_durable"],
    services: ["fonctionnement", "pour_qui", "benefice_concret", "etape_cle"],
    faq: ["question_frequente", "idee_recue", "mode_d_emploi", "reponse_simple"],
    recrutement: ["valeurs", "metier", "savoir_faire", "transmission"],
  };
  return candidatesByTheme[theme] || [
    "conseil_pratique",
    "benefice_client",
    "savoir_faire",
    "ancrage_local",
  ];
}

function increaseCount(counts: Map<string, number>, value: string) {
  const key = normalizedKey(value);
  if (!key) return;
  counts.set(key, (counts.get(key) || 0) + 1);
}

function seedCountsFromHistory(
  candidates: string[],
  historicalSubjects: readonly unknown[],
) {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const candidateKey = normalizedKey(candidate);
    if (!candidateKey) continue;
    const mentions = historicalSubjects.filter((subject) =>
      normalizedKey(subject).includes(candidateKey),
    ).length;
    if (mentions) counts.set(candidateKey, mentions);
  }
  return counts;
}

function chooseLeastUsed(
  candidates: string[],
  counts: Map<string, number>,
  seed: string,
) {
  if (!candidates.length) return "";
  const minimum = Math.min(
    ...candidates.map((candidate) => counts.get(normalizedKey(candidate)) || 0),
  );
  const tied = candidates
    .filter((candidate) => (counts.get(normalizedKey(candidate)) || 0) === minimum)
    .sort(
      (left, right) =>
        stableScore(`${seed}:${normalizedKey(left)}`) -
        stableScore(`${seed}:${normalizedKey(right)}`),
    );
  return tied[0] || candidates[0];
}

function inferFallbackSubject(business: JsonRecord, profile: JsonRecord, memory: JsonRecord) {
  return (
    cleanText(business.profession_label || business.professionLabel || business.profession, 160) ||
    cleanText(business.activity_label || business.activity || business.sector_label || business.sector, 160) ||
    cleanText(profile.profession || profile.activity || profile.company_legal_name || profile.companyLegalName, 160) ||
    cleanText(memory.mission || memory.detailedDescription || business.business_description || business.activity_description, 180) ||
    "votre activité"
  );
}

function mediaDirectionForFocus(args: {
  subject: string;
  service: string;
  zone: string;
  strength: string;
  contextualHook: string;
  angle: string;
}) {
  const parts = [
    `Illustrer le sujet « ${args.subject} »`,
    args.service && args.service !== args.subject
      ? `avec une scène liée à « ${args.service} »`
      : "",
    args.zone ? `dans le contexte de « ${args.zone} » sans inventer de lieu identifiable` : "",
    args.strength ? `en faisant ressentir « ${args.strength} »` : "",
    args.contextualHook
      ? `en s'appuyant sobrement sur le repère fourni « ${args.contextualHook} »`
      : "",
    `angle visuel : ${args.angle.replaceAll("_", " ")}`,
    "sans texte ajouté, sans logo inventé et sans promesse non vérifiée",
  ].filter(Boolean);
  return parts.join(". ");
}

function buildFocus(args: {
  source: InrAgentEditorialFocusSource;
  subject: string;
  service?: string;
  zone?: string;
  audience?: string;
  strength?: string;
  specialty?: string;
  customerNeed?: string;
  businessArgument?: string;
  contextualHook?: string;
  angle: string;
}) {
  const focus = {
    version: INR_AGENT_EDITORIAL_VARIATION_VERSION,
    source: args.source,
    subject: cleanText(args.subject, 500),
    service: cleanText(args.service, 180),
    zone: cleanText(args.zone, 160),
    audience: cleanText(args.audience, 160),
    strength: cleanText(args.strength, 180),
    specialty: cleanText(args.specialty, 180),
    customerNeed: cleanText(args.customerNeed, 180),
    businessArgument: cleanText(args.businessArgument, 280),
    contextualHook: cleanText(args.contextualHook, 240),
    angle: cleanText(args.angle, 100) || "conseil_pratique",
  } satisfies Omit<InrAgentEditorialFocus, "mediaDirection" | "focusKey">;
  const focusKey = [
    focus.source,
    focus.subject,
    focus.service,
    focus.zone,
    focus.audience,
    focus.strength,
    focus.specialty,
    focus.customerNeed,
    focus.businessArgument,
    focus.contextualHook,
    focus.angle,
  ]
    .map(normalizedKey)
    .filter(Boolean)
    .join(":");
  return {
    ...focus,
    mediaDirection: mediaDirectionForFocus(focus),
    focusKey,
  };
}

function accountForFocus(
  focus: InrAgentEditorialFocus,
  counts: {
    subjects: Map<string, number>;
    services: Map<string, number>;
    zones: Map<string, number>;
    audiences: Map<string, number>;
    strengths: Map<string, number>;
    specialties: Map<string, number>;
    needs: Map<string, number>;
    arguments: Map<string, number>;
    hooks: Map<string, number>;
    angles: Map<string, number>;
  },
) {
  increaseCount(counts.subjects, focus.subject);
  increaseCount(counts.services, focus.service);
  increaseCount(counts.zones, focus.zone);
  increaseCount(counts.audiences, focus.audience);
  increaseCount(counts.strengths, focus.strength);
  increaseCount(counts.specialties, focus.specialty);
  increaseCount(counts.needs, focus.customerNeed);
  increaseCount(counts.arguments, focus.businessArgument);
  increaseCount(counts.hooks, focus.contextualHook);
  increaseCount(counts.angles, focus.angle);
}

function subjectForFocus(args: {
  service: string;
  specialty: string;
  customerNeed: string;
  strength: string;
  contextualHook: string;
  fallbackSubject: string;
}) {
  const base =
    args.service || args.specialty || args.contextualHook || args.fallbackSubject;
  const complement =
    args.customerNeed ||
    (args.service ? args.specialty : "") ||
    args.strength ||
    args.contextualHook;
  if (!complement || normalizedKey(base).includes(normalizedKey(complement))) {
    return base;
  }
  return `${base} : ${complement}`;
}

export function buildInrAgentEditorialFocusPlan<T extends EditorialSlotLike>(args: {
  slots: readonly T[];
  business?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  publicationIdeas?: unknown;
  historicalSubjects?: readonly unknown[];
  existingFocusBySlotKey?: ReadonlyMap<string, unknown> | Record<string, unknown>;
  seed?: string;
}): Array<T & { focus: InrAgentEditorialFocus }> {
  const business = asRecord(args.business);
  const profile = asRecord(args.profile);
  const memory = asRecord(business.ai_memory);
  const historicalSubjects = uniqueStrings(
    (args.historicalSubjects || [])
      .map((value) => cleanText(value, 1_200))
      .filter(Boolean),
  );
  const services = listForBusiness(
    business,
    memory,
    ["services", "services_text", "service_descriptions", "services_descriptions"],
    [],
    24,
  );
  const specialties = listForBusiness(
    business,
    memory,
    [],
    ["specialties"],
    18,
  );
  const zones = listForBusiness(
    business,
    memory,
    ["intervention_zones", "intervention_zones_text", "zones"],
    [],
    30,
  );
  if (!zones.length) {
    const city = cleanText(profile.hq_city || profile.hqCity || profile.city, 160);
    if (city) zones.push(city);
  }
  const strengths = listForBusiness(
    business,
    memory,
    ["strengths", "strengths_text"],
    ["differentiators", "values", "commitments"],
    24,
  );
  const audiences = listForBusiness(
    business,
    memory,
    ["customer_typologies", "customer_types", "audiences"],
    ["targetAudiences"],
    18,
  );
  const customerNeeds = listForBusiness(business, memory, [], ["customerNeeds"], 18);
  const businessArguments = listForBusiness(
    business,
    memory,
    [],
    ["keyArguments", "offersAndArguments", "proofsAndObjections", "objectionResponses"],
    18,
  );
  const news = listForBusiness(business, memory, [], ["recentNewsItems"], 8);
  const fallbackSubject = inferFallbackSubject(business, profile, memory);
  const manualIdeas = uniqueStrings(cleanList(args.publicationIdeas, 12, 500));
  const usableManualIdeas = manualIdeas.filter(
    (idea) => !isInrAgentEditorialIdeaCovered(idea, historicalSubjects),
  );

  const counts = {
    subjects: seedCountsFromHistory(news, historicalSubjects),
    services: seedCountsFromHistory(services, historicalSubjects),
    zones: seedCountsFromHistory(zones, historicalSubjects),
    audiences: seedCountsFromHistory(audiences, historicalSubjects),
    strengths: seedCountsFromHistory(strengths, historicalSubjects),
    specialties: seedCountsFromHistory(specialties, historicalSubjects),
    needs: seedCountsFromHistory(customerNeeds, historicalSubjects),
    arguments: seedCountsFromHistory(businessArguments, historicalSubjects),
    hooks: seedCountsFromHistory(news, historicalSubjects),
    angles: new Map<string, number>(),
  };
  const existingBySlot = new Map<string, InrAgentEditorialFocus>();
  const alreadyAssignedManualIdeas = new Set<string>();
  const knownFocusKeys = new Set<string>();

  for (const slot of args.slots) {
    const focus = existingFocusForSlot(args.existingFocusBySlotKey, slot.slotKey);
    if (!focus) continue;
    existingBySlot.set(slot.slotKey, focus);
    knownFocusKeys.add(focus.focusKey);
    accountForFocus(focus, counts);
    if (focus.source === "professional_idea") {
      alreadyAssignedManualIdeas.add(normalizedKey(focus.subject));
    }
  }

  const sortedSlots = [...args.slots].sort(
    (left, right) => left.sequence - right.sequence || left.slotKey.localeCompare(right.slotKey),
  );
  const resultBySlot = new Map<string, InrAgentEditorialFocus>();

  for (const slot of sortedSlots) {
    const existing = existingBySlot.get(slot.slotKey);
    if (existing) {
      resultBySlot.set(slot.slotKey, existing);
      continue;
    }

    const focusSeed = `${args.seed || "inr-agent-editorial"}:${slot.slotKey}:${slot.theme}:${slot.sequence}`;
    const manualIdea = usableManualIdeas.find(
      (idea) => !alreadyAssignedManualIdeas.has(normalizedKey(idea)),
    );
    const angle = chooseLeastUsed(
      angleCandidates(slot.theme),
      counts.angles,
      `${focusSeed}:angle`,
    );

    let focus: InrAgentEditorialFocus;
    if (manualIdea) {
      alreadyAssignedManualIdeas.add(normalizedKey(manualIdea));
      focus = buildFocus({
        source: "professional_idea",
        subject: manualIdea,
        angle,
      });
    } else {
      const service = chooseLeastUsed(services, counts.services, `${focusSeed}:service`);
      const specialty = chooseLeastUsed(
        specialties.filter((candidate) => normalizedKey(candidate) !== normalizedKey(service)),
        counts.specialties,
        `${focusSeed}:specialty`,
      );
      const contextualHook = chooseLeastUsed(
        news,
        counts.hooks,
        `${focusSeed}:news`,
      );
      const subjectFromNews = !service && !specialty ? contextualHook : "";
      const zone = chooseLeastUsed(zones, counts.zones, `${focusSeed}:zone`);
      const audience = chooseLeastUsed(
        audiences,
        counts.audiences,
        `${focusSeed}:audience`,
      );
      const strength = chooseLeastUsed(
        strengths,
        counts.strengths,
        `${focusSeed}:strength`,
      );
      const customerNeed = chooseLeastUsed(
        customerNeeds,
        counts.needs,
        `${focusSeed}:need`,
      );
      const businessArgument = chooseLeastUsed(
        businessArguments,
        counts.arguments,
        `${focusSeed}:argument`,
      );
      const subject = subjectForFocus({
        service,
        specialty,
        customerNeed,
        strength,
        contextualHook: subjectFromNews || contextualHook,
        fallbackSubject,
      });
      const source: InrAgentEditorialFocusSource =
        service ||
        specialty ||
        strengths.length ||
        audiences.length ||
        customerNeeds.length ||
        businessArguments.length ||
        news.length
          ? "business_dna"
          : "business_profile_fallback";
      focus = buildFocus({
        source,
        subject,
        service,
        zone,
        audience,
        strength,
        specialty,
        customerNeed,
        businessArgument,
        contextualHook,
        angle,
      });
    }

    // Quand toutes les dimensions sont minuscules, une répétition devient
    // inévitable. Avant cela, on force un autre angle disponible afin que le
    // texte et le média ne soient jamais deux fois la même proposition.
    if (knownFocusKeys.has(focus.focusKey)) {
      const alternatives = angleCandidates(slot.theme).filter(
        (candidate) => candidate !== focus.angle,
      );
      if (alternatives.length) {
        focus = buildFocus({
          ...focus,
          angle: chooseLeastUsed(
            alternatives,
            counts.angles,
            `${focusSeed}:retry-angle`,
          ),
        });
      }
    }
    knownFocusKeys.add(focus.focusKey);
    accountForFocus(focus, counts);
    resultBySlot.set(slot.slotKey, focus);
  }

  return args.slots.map((slot) => ({
    ...slot,
    focus:
      resultBySlot.get(slot.slotKey) ||
      buildFocus({
        source: "business_profile_fallback",
        subject: fallbackSubject,
        angle: "conseil_pratique",
      }),
  }));
}
