import {
  AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS,
  AI_MEDIA_SPOKEN_LINE_MAX_WORDS,
  normalizeAiMediaCopy,
} from "./aiMediaTextIntegrity.ts";

const DIALOGUE_FALLBACKS: Record<
  string,
  ReadonlyArray<readonly [string, string]>
> = {
  fr: [
    [
      "Votre projet mérite une attention vraiment sur mesure",
      "Nous avançons ensemble avec des étapes très claires",
    ],
    [
      "Notre méthode transforme chaque besoin en action concrète",
      "Chaque détail renforce durablement la qualité du résultat",
    ],
    [
      "Votre prochain projet peut commencer dès aujourd’hui",
      "Nous restons disponibles pour construire la suite ensemble",
    ],
  ],
  en: [
    [
      "Your project deserves truly tailored professional attention",
      "We move forward together through clear practical steps",
    ],
    [
      "Our method turns each need into concrete action",
      "Every detail strengthens the quality of the result",
    ],
    [
      "Your next project can begin with confidence today",
      "We are ready to build the next step together",
    ],
  ],
  es: [
    [
      "Tu proyecto merece una atención realmente personalizada",
      "Avanzamos juntos con pasos claros y muy concretos",
    ],
    [
      "Nuestro método convierte cada necesidad en acción concreta",
      "Cada detalle refuerza la calidad final del resultado",
    ],
    [
      "Tu próximo proyecto puede empezar hoy con confianza",
      "Estamos disponibles para construir juntos el siguiente paso",
    ],
  ],
  it: [
    [
      "Il tuo progetto merita un’attenzione davvero personalizzata",
      "Procediamo insieme attraverso passaggi chiari e concreti",
    ],
    [
      "Il nostro metodo trasforma ogni esigenza in azione",
      "Ogni dettaglio rafforza la qualità del risultato finale",
    ],
    [
      "Il tuo prossimo progetto può iniziare oggi",
      "Siamo pronti a costruire insieme il prossimo passo",
    ],
  ],
  de: [
    [
      "Ihr Projekt verdient eine wirklich persönliche Betreuung",
      "Wir gehen gemeinsam in klaren Schritten voran",
    ],
    [
      "Unsere Methode macht jeden Bedarf konkret umsetzbar",
      "Jedes Detail stärkt nachhaltig die Qualität des Ergebnisses",
    ],
    [
      "Ihr nächstes Projekt kann heute sicher beginnen",
      "Wir gestalten den nächsten Schritt gerne gemeinsam",
    ],
  ],
  nl: [
    [
      "Uw project verdient echt persoonlijke professionele aandacht",
      "We gaan samen verder met heldere concrete stappen",
    ],
    [
      "Onze methode vertaalt elke behoefte naar concrete actie",
      "Elk detail versterkt duurzaam de kwaliteit van het resultaat",
    ],
    [
      "Uw volgende project kan vandaag met vertrouwen starten",
      "We bouwen graag samen aan de volgende stap",
    ],
  ],
  pt: [
    [
      "O seu projeto merece atenção realmente personalizada",
      "Avançamos juntos através de etapas claras e concretas",
    ],
    [
      "O nosso método transforma necessidades em ações concretas",
      "Cada detalhe reforça a qualidade final do resultado",
    ],
    [
      "O seu próximo projeto pode começar hoje",
      "Estamos disponíveis para construir juntos o próximo passo",
    ],
  ],
  th: [
    ["โครงการของคุณสมควรได้รับการดูแลอย่างตรงจุด", "เราจะก้าวไปด้วยกันผ่านขั้นตอนที่ชัดเจน"],
    ["วิธีของเราเปลี่ยนทุกความต้องการเป็นการลงมือทำ", "ทุกรายละเอียดช่วยยกระดับคุณภาพของผลงาน"],
    ["โครงการถัดไปของคุณเริ่มต้นได้อย่างมั่นใจวันนี้", "เราพร้อมสร้างขั้นตอนต่อไปร่วมกันเสมอ"],
  ],
  zh: [
    ["您的项目值得真正量身定制的专业关注", "我们将通过清晰步骤与您共同推进"],
    ["我们的方法把每项需求转化为具体行动", "每个细节都持续提升最终成果质量"],
    ["您的下一个项目今天就能自信启动", "我们随时准备共同完成下一阶段"],
  ],
};

const GENERIC_DIALOGUE_PATTERN =
  /^(?:on s['’]y met|on avance bien|c['’]est pr[eê]t|exactement|shall we get started|we(?:'|’)re making good progress|it(?:'|’)s ready|absolutely|perfect|empezamos|claro|exacto|cominciamo|esatto|perfetto|fangen wir an|genau|zullen we beginnen|precies|come[cç]amos|exatamente)[.!?\s]*$/iu;

const MAX_NATIVE_DIALOGUE_CHARACTERS = AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS;

const DANGLING_SPEECH_ENDINGS: Readonly<Record<string, ReadonlySet<string>>> = {
  fr: new Set([
    "a",
    "afin",
    "au",
    "aux",
    "avec",
    "car",
    "ce",
    "ces",
    "cet",
    "cette",
    "d",
    "dans",
    "de",
    "des",
    "du",
    "en",
    "et",
    "la",
    "le",
    "les",
    "mais",
    "mes",
    "nos",
    "notre",
    "ou",
    "par",
    "pour",
    "que",
    "qui",
    "sans",
    "si",
    "sous",
    "sur",
    "tes",
    "un",
    "une",
    "vers",
    "vos",
    "votre",
  ]),
  en: new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "because",
    "but",
    "by",
    "for",
    "from",
    "if",
    "in",
    "into",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
    "without",
  ]),
  es: new Set([
    "a", "al", "con", "de", "del", "el", "en", "la", "las", "los", "o",
    "para", "por", "que", "sin", "un", "una", "y",
  ]),
  it: new Set([
    "a", "al", "alla", "con", "da", "di", "e", "il", "in", "la", "le",
    "o", "per", "senza", "un", "una",
  ]),
  de: new Set([
    "aber", "am", "an", "auf", "aus", "bei", "das", "dem", "den", "der",
    "die", "ein", "eine", "für", "in", "mit", "oder", "ohne", "und", "von",
    "zu", "zum", "zur",
  ]),
  nl: new Set([
    "aan", "als", "bij", "de", "een", "en", "in", "met", "naar", "of", "om",
    "op", "voor", "van", "zonder",
  ]),
  pt: new Set([
    "a", "ao", "com", "da", "de", "do", "e", "em", "o", "ou", "para", "por",
    "que", "sem", "um", "uma",
  ]),
};

function normalizedLanguage(language: string) {
  return String(language || "fr").toLowerCase().split(/[-_]/u)[0] || "fr";
}

function normalizedLastWord(value: string) {
  const words = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  return words?.at(-1) || "";
}

/**
 * Détecte les fins orales qui ne peuvent pas être livrées telles quelles.
 * La ponctuation seule n'est pas une preuve : « parler de. » reste une phrase
 * coupée. Ce garde-fou est partagé par la voix off et le dialogue natif Veo.
 */
export function hasCompleteAiMediaSpeechEnding(
  value: unknown,
  language: string,
) {
  const line = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!line || /(?:\.{3}|…|[,;:—-])\s*$/u.test(line)) return false;
  const dangling = DANGLING_SPEECH_ENDINGS[normalizedLanguage(language)];
  return !dangling?.has(normalizedLastWord(line));
}

/**
 * Refuse les pseudo-phrases qui ne sont en réalité qu'une succession de
 * mots-clés. Ce contrôle reste volontairement structurel et multilingue : il
 * ne réécrit rien, mais exige des propositions assez longues pour porter un
 * discours et limite la ponctuation de type liste.
 */
export function hasNaturalAiMediaSpeechFlow(
  value: unknown,
  language: string,
) {
  const line = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line || !hasCompleteAiMediaSpeechEnding(line, language)) return false;
  if (/[|·+]/u.test(line) || /(?:^|\s)(?:[-•]|\d+[.)])\s+/u.test(line)) {
    return false;
  }

  const normalized = normalizedLanguage(language);
  if (["zh", "th"].includes(normalized)) {
    return dialogueSpokenUnitCount(line, normalized) >= 8;
  }

  const sentences = line
    .split(/[.!?]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (!sentences.length) return false;
  // Le seuil de liste s'applique à une phrase, pas à toute une narration :
  // deux phrases liées peuvent naturellement totaliser trois virgules.
  if (sentences.some((sentence) => (sentence.match(/[,;:]/gu) || []).length >= 3)) return false;
  const signatures = sentences.map(aiMediaDialogueSignature);
  if (new Set(signatures).size !== signatures.length) return false;
  if (sentences.some((sentence) => !hasCompleteAiMediaSpeechEnding(sentence, language))) {
    return false;
  }
  // Un complément de lieu isolé ne devient pas une phrase grâce à « un » ou
  // « de ». Il provenait du découpage du brief et pouvait être récité tel quel.
  if (normalized === "fr" && sentences.some((sentence) =>
    /^(?:dans|au|aux|chez|avec|sans|sous|sur|près de)\s+/iu.test(sentence)
    && !/[,;:]|\b(?:je|tu|il|elle|on|nous|vous|ils|elles|est|sont|sera|seront|fait|font|prend|prennent|naît|naissent|choisit|choisissent|sort|sortent|se|s['’])\b/iu.test(sentence)
    && !/\b[\p{L}]{3,}(?:ons|ez)\b/iu.test(sentence)
  )) return false;
  // Une succession de mots-clés reste une liste même sans virgules. Ce signal
  // structurel conserve les phrases reliées par des déterminants, pronoms ou
  // prépositions ; il ne prétend pas remplacer une analyse grammaticale.
  if (
    normalized === "fr" &&
    sentences.some((sentence) =>
      !/(?:^|[\s'’])(?:je|tu|il|elle|on|nous|vous|ils|elles|ce|cela|ça|ces|cet|cette|le|la|les|un|une|des|du|de|d|l|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|nos|votre|vos|leur|leurs|chaque|quel|quelle|quels|quelles|qui|que|qu|à|au|aux|avec|chez|dans|en|par|pour|sans|sous|sur|vers|est|sont|sera|seront|a|ont)(?=[\s'’,;:]|$)/iu.test(sentence)
    )
  ) {
    return false;
  }
  const sentenceWordCounts = sentences.map((sentence) =>
    sentence.split(/\s+/u).filter(Boolean).length
  );
  const totalWords = sentenceWordCounts.reduce((sum, count) => sum + count, 0);
  const maximumSentences = Math.max(1, Math.ceil(totalWords / 9));
  return (
    sentences.length <= maximumSentences &&
    sentenceWordCounts.every((count) => count >= 4)
  );
}

export function completeAiMediaSpeechSentence(
  value: unknown,
  language: string,
) {
  const line = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/^[\s"'«»*-]+/g, "")
    .replace(/[\s"'«»*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!hasCompleteAiMediaSpeechEnding(line, language)) return "";
  return /[.!?。！？]$/u.test(line) ? line : `${line}.`;
}

function spokenUnitCount(value: string, language: string) {
  const normalized = normalizedLanguage(language);
  if (normalized === "zh") {
    return Math.ceil((value.match(/\p{Script=Han}/gu)?.length || 0) / 2);
  }
  if (normalized === "th") {
    return Math.ceil((value.match(/\p{Script=Thai}/gu)?.length || 0) / 4);
  }
  return value.split(/\s+/u).filter(Boolean).length;
}

function dialogueSpokenUnitCount(value: string, language: string) {
  if (["zh", "th"].includes(normalizedLanguage(language))) {
    return Array.from(value.replace(/[^\p{L}\p{N}]/gu, "")).length;
  }
  return spokenUnitCount(value, language);
}

/**
 * Raccourcit uniquement à une frontière de phrase complète. Si aucune phrase
 * entière ne tient, renvoie une chaîne vide afin que l'appelant utilise son
 * texte de secours plutôt que de couper une proposition en plein milieu.
 */
export function fitAiMediaSpeechToCompleteSentences(args: {
  value: unknown;
  language: string;
  maximumUnits: number;
}) {
  const normalized = String(args.value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const complete = completeAiMediaSpeechSentence(normalized, args.language);
  if (
    complete &&
    spokenUnitCount(complete, args.language) <= args.maximumUnits
  ) {
    return complete;
  }

  const sentences = normalized.match(/[^.!?。！？]+[.!?。！？]+/gu) || [];
  let fitted = "";
  for (const sentence of sentences) {
    const candidateSentence = completeAiMediaSpeechSentence(
      sentence,
      args.language,
    );
    if (!candidateSentence) continue;
    const candidate = [fitted, candidateSentence].filter(Boolean).join(" ");
    if (spokenUnitCount(candidate, args.language) > args.maximumUnits) {
      if (fitted) break;
      continue;
    }
    fitted = candidate;
  }
  return fitted;
}

export function compactAiMediaDialogue(
  value: unknown,
  maximum = AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS
) {
  const normalized = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/^[\s"'«»]+|[\s"'«»]+$/g, "")
    .replace(/\s*[|·]+\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maximum) return normalized;
  return "";
}

export function aiMediaDialogueSignature(value: unknown) {
  return normalizeAiMediaCopy(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function isQualityAiMediaDialogueLine(
  value: unknown,
  language: string,
  usedSignatures: ReadonlySet<string> = new Set(),
) {
  const line = compactAiMediaDialogue(value);
  const signature = aiMediaDialogueSignature(line);
  if (!line || !signature || usedSignatures.has(signature)) return false;
  if (GENERIC_DIALOGUE_PATTERN.test(line)) return false;
  if (line.length > MAX_NATIVE_DIALOGUE_CHARACTERS) return false;
  if (!hasCompleteAiMediaSpeechEnding(line, language)) return false;
  if (!hasNaturalAiMediaSpeechFlow(line, language)) return false;
  const count = dialogueSpokenUnitCount(line, language);
  return ["zh", "th"].includes(normalizedLanguage(language))
    ? count >= 8 && count <= 42
    : count >= 5 && count <= AI_MEDIA_SPOKEN_LINE_MAX_WORDS;
}

export function selectAiMediaDialogueLine(args: {
  value: unknown;
  language: string;
  sceneIndex: number;
  sceneCount?: number;
  speaker: "lead" | "reply";
  usedSignatures?: ReadonlySet<string>;
}) {
  const language = String(args.language || "fr").toLowerCase();
  const used = args.usedSignatures || new Set<string>();
  const candidate = compactAiMediaDialogue(args.value);
  if (isQualityAiMediaDialogueLine(candidate, language, used)) return candidate;

  const fallbacks = DIALOGUE_FALLBACKS[language] || DIALOGUE_FALLBACKS.fr;
  const speakerIndex = args.speaker === "lead" ? 0 : 1;
  const fallbackIndex =
    args.sceneCount && args.sceneCount > 1
      ? args.sceneIndex <= 0
        ? 0
        : args.sceneIndex >= args.sceneCount - 1
          ? fallbacks.length - 1
          : Math.min(1, fallbacks.length - 1)
      : args.sceneIndex % fallbacks.length;
  for (let offset = 0; offset < fallbacks.length; offset += 1) {
    const pair = fallbacks[(fallbackIndex + offset) % fallbacks.length]!;
    const fallback = pair[speakerIndex];
    if (isQualityAiMediaDialogueLine(fallback, language, used)) return fallback;
  }
  return fallbacks[fallbackIndex]![speakerIndex];
}

export function getAiMediaDialogueFallbackPair(
  language: string,
  sceneIndex: number,
) {
  const fallbacks =
    DIALOGUE_FALLBACKS[String(language || "fr").toLowerCase()] ||
    DIALOGUE_FALLBACKS.fr;
  return fallbacks[sceneIndex % fallbacks.length]!;
}

/** Une citation explicitement donnée à prononcer n'est pas du texte à réécrire. */
export function extractAiMediaRequestedDialogue(source: string) {
  // Studio transmet le même brief dans idea et aiInstruction. Dédupliquer
  // ces sources identiques, pas les répliques : deux citations explicitement
  // répétées dans un même brief doivent conserver leur ordre et leur nombre.
  const distinctSources = Array.from(new Set(source.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean))).join("\n");
  const pattern = /(?:\b(?:dit|dis|disent|dire|dira|déclare|déclarent|répond|répondent|prononce|prononcent|récite|récitent)\b|\b(?:réplique|dialogue|phrase\s+(?:exacte|à\s+(?:dire|prononcer))))[^«“"\n]{0,90}[«“"]([^»”"]+)[»”"]/giu;
  return Array.from(distinctSources.matchAll(pattern), (match) => match[1]!.trim());
}

export function validateAiMediaRequestedDialogue(lines: readonly string[], language: string) {
  for (const line of lines) {
    if (!isQualityAiMediaDialogueLine(line, language)) {
      throw new Error("ai_media_exact_dialogue_unfit");
    }
  }
}

/** Resolve the exact script once, in order, for both generation and audio QA.
 * Tracking selected fallbacks (not rejected source lines) prevents a later
 * scene from accidentally repeating a replacement spoken in an earlier act.
 */
export function resolveAiMediaDialogueSequence(args: {
  scenes: ReadonlyArray<{ spokenLine?: string; body?: string; title?: string }>;
  headline: string;
  language: string;
  requestedSpeech?: string;
}) {
  const exact = extractAiMediaRequestedDialogue(args.requestedSpeech || "");
  if (exact.length) {
    validateAiMediaRequestedDialogue(exact, args.language);
    if (exact.length > args.scenes.length) throw new Error("ai_media_exact_dialogue_unfit");
    return args.scenes.map((_scene, index) => exact[index] || "");
  }
  const used = new Set<string>();
  return args.scenes.map((scene, sceneIndex) => {
    const selected = selectAiMediaDialogueLine({
      value: scene.spokenLine || scene.body || scene.title || args.headline,
      language: args.language,
      sceneIndex,
      sceneCount: args.scenes.length,
      speaker: "lead",
      usedSignatures: used,
    });
    const line = completeAiMediaSpeechSentence(selected, args.language);
    used.add(aiMediaDialogueSignature(line));
    return line;
  });
}
