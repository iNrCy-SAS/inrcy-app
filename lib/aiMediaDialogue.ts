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

export function compactAiMediaDialogue(value: unknown, maximum = 96) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/^[\s"'«»]+|[\s"'«»]+$/g, "")
    .replace(/\s*[|·]+\s*/g, ", ")
    .replace(/[…]+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function aiMediaDialogueSignature(value: unknown) {
  return compactAiMediaDialogue(value, 120)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function spokenUnitCount(value: string, language: string) {
  if (["zh", "th"].includes(language)) {
    return Array.from(value.replace(/[^\p{L}\p{N}]/gu, "")).length;
  }
  return value.split(/\s+/u).filter(Boolean).length;
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
  const count = spokenUnitCount(line, language);
  return ["zh", "th"].includes(language)
    ? count >= 8 && count <= 42
    : count >= 5 && count <= 12;
}

export function selectAiMediaDialogueLine(args: {
  value: unknown;
  language: string;
  sceneIndex: number;
  speaker: "lead" | "reply";
  usedSignatures?: ReadonlySet<string>;
}) {
  const language = String(args.language || "fr").toLowerCase();
  const used = args.usedSignatures || new Set<string>();
  const candidate = compactAiMediaDialogue(args.value);
  if (isQualityAiMediaDialogueLine(candidate, language, used)) return candidate;

  const fallbacks = DIALOGUE_FALLBACKS[language] || DIALOGUE_FALLBACKS.fr;
  const speakerIndex = args.speaker === "lead" ? 0 : 1;
  for (let offset = 0; offset < fallbacks.length; offset += 1) {
    const pair = fallbacks[(args.sceneIndex + offset) % fallbacks.length]!;
    const fallback = pair[speakerIndex];
    if (isQualityAiMediaDialogueLine(fallback, language, used)) return fallback;
  }
  return fallbacks[args.sceneIndex % fallbacks.length]![speakerIndex];
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
