export type SupportedAiLanguageCode = "fr" | "en" | "es" | "it" | "de" | "nl" | "pt" | "th" | "zh";

const SUPPORTED_LANGUAGES = new Set<SupportedAiLanguageCode>([
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

const LANGUAGE_HINTS: Record<SupportedAiLanguageCode, ReadonlySet<string>> = {
  fr: new Set([
    "avec", "dans", "pour", "vous", "nous", "votre", "vos", "notre", "nos", "chez", "mais", "sans",
    "besoin", "besoins", "projet", "travaux", "devis", "realisation", "realise", "decouvrez", "contactez",
    "service", "services", "jardin", "chantier", "entreprise", "qualite", "conseil", "conseils", "local", "locale",
  ]),
  en: new Set([
    "with", "your", "you", "our", "the", "and", "for", "from", "this", "that", "without", "need", "project",
    "work", "completed", "discover", "contact", "service", "services", "garden", "business", "quality", "careful",
    "local", "advice", "result", "results", "outdoor", "today", "more", "about",
  ]),
  es: new Set([
    "con", "para", "usted", "ustedes", "nuestro", "nuestra", "nuestros", "su", "sus", "sin", "proyecto", "trabajo",
    "realizado", "descubre", "contacto", "servicio", "servicios", "jardin", "empresa", "calidad", "consejo", "local",
    "resultado", "resultados", "exterior", "hoy", "como", "esta", "este", "mas", "sobre",
  ]),
  it: new Set([
    "con", "per", "voi", "nostro", "nostra", "vostro", "vostra", "senza", "progetto", "lavoro", "realizzato",
    "scopri", "contatto", "servizio", "servizi", "giardino", "azienda", "qualita", "consiglio", "locale", "risultato",
    "risultati", "esterno", "oggi", "come", "questo", "questa", "piu", "sul", "sulla",
  ]),
  de: new Set([
    "mit", "fur", "sie", "ihr", "ihre", "unser", "unsere", "ohne", "projekt", "arbeit", "fertiggestellt", "entdecken",
    "kontakt", "service", "garten", "unternehmen", "qualitat", "beratung", "lokal", "ergebnis", "ergebnisse", "aussenbereich",
    "heute", "wie", "dieser", "diese", "dieses", "mehr", "uber", "und", "wir",
  ]),
  nl: new Set([
    "met", "voor", "uw", "ons", "onze", "zonder", "project", "werk", "afgerond", "ontdek", "contact", "dienst",
    "diensten", "tuin", "bedrijf", "kwaliteit", "advies", "lokaal", "resultaat", "resultaten", "buitenruimte", "vandaag",
    "zoals", "deze", "dit", "meer", "over", "het", "een", "wij",
  ]),
  pt: new Set([
    "com", "para", "voce", "voces", "nosso", "nossa", "seu", "sua", "sem", "projeto", "trabalho", "realizado",
    "descubra", "contato", "servico", "servicos", "jardim", "empresa", "qualidade", "conselho", "local", "resultado",
    "resultados", "exterior", "hoje", "como", "este", "esta", "mais", "sobre", "nossos",
  ]),
  th: new Set(["และ", "สำหรับ", "คุณ", "เรา", "บริการ", "คุณภาพ", "โครงการ", "ติดต่อ"]),
  zh: new Set(["和", "为", "您", "我们", "服务", "质量", "项目", "联系"]),
};

function normalizeToken(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .trim();
}

function tokenize(value: unknown) {
  return (String(value ?? "").match(/[\p{L}\p{M}\p{N}'-]+/gu) || [])
    .map(normalizeToken)
    .filter((token) => token.length >= 2);
}

function countScriptCharacters(value: string, pattern: RegExp) {
  return value.match(pattern)?.length || 0;
}

export function getSupportedAiLanguageCode(value: unknown): SupportedAiLanguageCode | null {
  const code = String(value ?? "").trim().toLocaleLowerCase() as SupportedAiLanguageCode;
  return SUPPORTED_LANGUAGES.has(code) ? code : null;
}

export function scoreTextLanguages(value: unknown) {
  const raw = String(value ?? "");
  const tokens = tokenize(raw);
  const scores = Object.fromEntries(
    (Array.from(SUPPORTED_LANGUAGES) as SupportedAiLanguageCode[]).map((language) => [
      language,
      tokens.reduce((sum, token) => sum + (LANGUAGE_HINTS[language].has(token) ? 1 : 0), 0),
    ]),
  ) as Record<SupportedAiLanguageCode, number>;

  // Le thaï n'utilise généralement pas d'espaces entre les mots et le chinois
  // n'en utilise pas du tout. Les scripts sont donc un signal plus fiable que
  // les listes de mots pour ces deux langues.
  const thaiCharacters = countScriptCharacters(raw, /\p{Script=Thai}/gu);
  const hanCharacters = countScriptCharacters(raw, /\p{Script=Han}/gu);
  scores.th += Math.ceil(thaiCharacters / 3);
  scores.zh += Math.ceil(hanCharacters / 2);
  const evidenceCount = tokens.length + Math.ceil(thaiCharacters / 2) + Math.ceil(hanCharacters / 2);

  return { tokens, scores, evidenceCount };
}

export function detectLikelyAiLanguage(value: unknown): {
  language: SupportedAiLanguageCode | null;
  confidence: number;
  scores: Record<SupportedAiLanguageCode, number>;
  tokenCount: number;
} {
  const { scores, evidenceCount } = scoreTextLanguages(value);
  const ranked = (Object.entries(scores) as Array<[SupportedAiLanguageCode, number]>)
    .sort((left, right) => right[1] - left[1]);
  const [bestLanguage, bestScore] = ranked[0] || [null, 0];
  const secondScore = ranked[1]?.[1] || 0;
  const confidence = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - secondScore + 1) / (bestScore + 1))) : 0;

  return {
    language: bestScore >= 3 ? bestLanguage : null,
    confidence,
    scores,
    tokenCount: evidenceCount,
  };
}

/**
 * Détecteur local conservateur : il ne bloque que lorsqu'une autre langue
 * supportée possède une avance nette. Les textes courts/neutres restent acceptés.
 */
export function hasAiLanguageMismatch(expectedLanguage: unknown, value: unknown): boolean {
  const expected = getSupportedAiLanguageCode(expectedLanguage);
  if (!expected) return false;

  const { scores, evidenceCount } = scoreTextLanguages(value);
  if (evidenceCount < 10) return false;

  const expectedScore = scores[expected] || 0;
  const otherScores = (Object.entries(scores) as Array<[SupportedAiLanguageCode, number]>)
    .filter(([language]) => language !== expected)
    .sort((left, right) => right[1] - left[1]);
  const [, bestOtherScore = 0] = otherScores[0] || [];

  // Pas assez d'indices pour conclure : on préserve la créativité et les textes
  // contenant des noms propres ou du vocabulaire métier international.
  if (bestOtherScore < 4) return false;
  if (expectedScore >= bestOtherScore - 1) return false;

  const gap = bestOtherScore - expectedScore;
  const dominance = bestOtherScore / Math.max(1, bestOtherScore + expectedScore);
  return gap >= 3 && dominance >= 0.64;
}
