const CHANNEL_RULES = {
  inrcy_site: { min: 350, max: 2600, maxHashtags: 0 },
  site_web: { min: 450, max: 3200, maxHashtags: 0 },
  gmb: { min: 180, max: 1200, maxHashtags: 0, forbidContact: true },
  facebook: { min: 180, max: 1500, maxHashtags: 2 },
  instagram: { min: 140, max: 1200, maxHashtags: 8 },
  linkedin: { min: 250, max: 1900, maxHashtags: 3 },
  tiktok: { min: 70, max: 850, maxHashtags: 8 },
  youtube_shorts: { min: 220, max: 2400, maxHashtags: 8 },
  pinterest: { min: 90, max: 900, maxHashtags: 8 },
};

const LANGUAGE_HINTS = {
  fr: new Set(["avec", "dans", "pour", "vous", "nous", "votre", "notre", "chez", "devis", "travaux", "projet", "realisation", "decouvrez", "contactez", "service", "jardin", "qualite"]),
  en: new Set(["with", "your", "you", "our", "the", "and", "for", "from", "this", "project", "work", "discover", "contact", "service", "garden", "quality", "without"]),
  es: new Set(["con", "para", "usted", "ustedes", "nuestro", "nuestra", "proyecto", "trabajo", "descubre", "contacto", "servicio", "jardin", "calidad", "sin"]),
  it: new Set(["con", "per", "voi", "nostro", "nostra", "progetto", "lavoro", "scopri", "contatto", "servizio", "giardino", "qualita", "senza", "questa"]),
  de: new Set(["mit", "fur", "sie", "ihr", "ihre", "unser", "projekt", "arbeit", "entdecken", "kontakt", "service", "garten", "qualitat", "ohne", "diese", "wir"]),
  nl: new Set(["met", "voor", "uw", "ons", "onze", "project", "werk", "ontdek", "contact", "dienst", "tuin", "kwaliteit", "zonder", "deze", "wij"]),
  pt: new Set(["com", "para", "voce", "voces", "nosso", "nossa", "projeto", "trabalho", "descubra", "contato", "servico", "jardim", "qualidade", "sem"]),
  th: new Set(["กับ", "สำหรับ", "คุณ", "เรา", "ของเรา", "โครงการ", "งาน", "บริการ", "คุณภาพ", "ติดต่อ"]),
  zh: new Set(["与", "为", "您", "我们", "项目", "工作", "服务", "质量", "联系", "了解"]),
};

const STOP_WORDS = new Set([
  "avec", "dans", "pour", "vous", "nous", "votre", "notre",
  "the", "and", "for", "your", "with", "this", "that",
  "para", "con", "este", "esta", "per", "mit", "fur", "met", "voor", "com",
]);

const ADDRESS_PATTERNS = {
  fr: { informal: /\b(tu|ton|ta|tes|toi)\b/, formal: /\b(vous|votre|vos)\b/ },
  en: { informal: /\b(you|your|yours)\b/, formal: /\b(you|your|yours)\b/ },
  es: { informal: /\b(tu|tus|te|contigo)\b/, formal: /\b(usted|ustedes|su|sus)\b/ },
  it: { informal: /\b(tu|tuo|tua|tuoi|tue|ti)\b/, formal: /\b(voi|vostro|vostra|vostri|vostre)\b/ },
  de: { informal: /\b(du|dein|deine|deinen|dir|dich)\b/, formal: /\b(sie|ihr|ihre|ihren|ihnen)\b/ },
  nl: { informal: /\b(jij|je|jouw|jou)\b/, formal: /\b(u|uw)\b/ },
  pt: { informal: /\b(tu|teu|tua|teus|tuas|te)\b/, formal: /\b(voce|voces|seu|sua|seus|suas)\b/ },
  th: { informal: /(เธอ|คุณ)/, formal: /(คุณ|ท่าน)/ },
  zh: { informal: /(你|你的)/, formal: /(您|您的)/ },
};

const VOICE_PATTERNS = {
  fr: { singular: /\b(je|moi|mon|ma|mes)\b/, plural: /\b(nous|notre|nos)\b/ },
  en: { singular: /\b(i|my|mine|me)\b/, plural: /\b(we|our|ours|us)\b/ },
  es: { singular: /\b(yo|mi|mis|mio|mia)\b/, plural: /\b(nosotros|nosotras|nuestro|nuestra|nuestros|nuestras)\b/ },
  it: { singular: /\b(io|mio|mia|miei|mie)\b/, plural: /\b(noi|nostro|nostra|nostri|nostre)\b/ },
  de: { singular: /\b(ich|mein|meine|meiner)\b/, plural: /\b(wir|unser|unsere|unseren)\b/ },
  nl: { singular: /\b(ik|mijn|mij)\b/, plural: /\b(wij|we|ons|onze)\b/ },
  pt: { singular: /\b(eu|meu|minha|meus|minhas)\b/, plural: /\b(nos|nosso|nossa|nossos|nossas)\b/ },
  th: { singular: /(ฉัน|ผม|ดิฉัน)/, plural: /(เรา|พวกเรา)/ },
  zh: { singular: /(我|我的)/, plural: /(我们|我们的)/ },
};

const ANGLE_HINTS = {
  quality: /\b(qualit|quality|calidad|qualita|qualitat|kwaliteit|qualidade|soin|careful|cuidado|cura|sorgfalt|zorgvuldig|acabamento|finitions?)\w*\b/,
  trust: /\b(confiance|trust|confianza|fiducia|vertrauen|betrouw|confianca|fiable|reliable|serieux|serious|transparen)\w*\b/,
  local: /\b(local|proxim|nearby|vicin|regional|bairro|quartier|arras|lens|douai)\w*\b/,
  price: /\b(prix|price|precio|prezzo|preis|prijs|preco|budget|tarif|offre|offer)\w*\b/,
  speed: /\b(rapid|fast|quick|rapido|schnell|snel|agil|delai|deadline)\w*\b/,
};

const QUOTE_HINTS = /\b(devis|quote|estimate|presupuesto|preventivo|angebot|offerte|orcamento|orcamento)\w*\b/;
const CONTACT_HINTS = /\b(contact|contactez|contacte|contatt|kontakt|neem contact|fale connosco|appelez|call|message|ecrivez|write|demandez|request|solicita)\w*\b/;
const ENGAGEMENT_HINTS = /\b(comment|partage|share|tell us|dites nous|cuentanos|raccontaci|schreib|laat ons weten|conte nos)\w*\b/;
const AGGRESSIVE_SALES_HINTS = /\b(achetez|buy now|compre ya|acquista ora|jetzt kaufen|koop nu|compre agora|urgent|limited offer|offre limitee)\w*\b/;
const WARM_HINTS = /\b(plaisir|heureux|ravis|fier|passion|ensemble|merci|welcome|delighted|proud|care|encantad|orgull|grazie|freude|blij|trots|prazer|orgulh)\w*\b/;
const QUALITY_HINTS = ANGLE_HINTS.quality;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

function meaningfulWords(value) {
  return Array.from(new Set(words(value).filter((word) => word.length >= 4 && !STOP_WORDS.has(word))));
}

function jaccard(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function countEmoji(value) {
  const matches = String(value || "").match(/\p{Extended_Pictographic}/gu);
  return matches ? matches.length : 0;
}

function detectLanguageScore(value, expectedLanguage) {
  const raw = String(value || "");
  if (expectedLanguage === "th") {
    const thai = (raw.match(/[\u0E00-\u0E7F]/g) || []).length;
    const han = (raw.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
    if (thai || han) return thai > han ? Math.min(1, 0.78 + thai / 120) : 0.25;
  }
  if (expectedLanguage === "zh") {
    const han = (raw.match(/[\u3400-\u4DBF\u4E00-\u9FFF]/g) || []).length;
    const thai = (raw.match(/[\u0E00-\u0E7F]/g) || []).length;
    if (han || thai) return han > thai ? Math.min(1, 0.78 + han / 120) : 0.25;
  }
  const tokens = words(value);
  if (!tokens.length) return 0;
  const scores = Object.fromEntries(
    Object.entries(LANGUAGE_HINTS).map(([language, hints]) => [
      language,
      tokens.reduce((sum, token) => sum + (hints.has(token) ? 1 : 0), 0),
    ]),
  );
  const expected = scores[expectedLanguage] || 0;
  const bestOther = Math.max(0, ...Object.entries(scores).filter(([key]) => key !== expectedLanguage).map(([, value]) => value));
  if (expected === 0 && bestOther === 0) return 0.7;
  if (expected >= bestOther + 2) return 1;
  if (expected >= bestOther) return 0.82;
  return 0.25;
}

function extractVersions(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return {};
  const versions = output.versions && typeof output.versions === "object" && !Array.isArray(output.versions)
    ? output.versions
    : output;
  return versions || {};
}

function asPost(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const title = String(value.title || value.titre || value.headline || "").trim();
  const content = String(value.content || value.description || value.body || value.text || value.caption || "").trim();
  const cta = String(value.cta || value.call_to_action || value.callToAction || "").trim();
  const hashtags = Array.isArray(value.hashtags)
    ? value.hashtags.map((item) => String(item || "").replace(/^#+/, "").trim()).filter(Boolean)
    : typeof value.hashtags === "string"
      ? value.hashtags.split(/[\s,;]+/).map((item) => item.replace(/^#+/, "").trim()).filter(Boolean)
      : [];
  return { title, content, cta, hashtags };
}

function ideaAnchorScore(idea, post) {
  const ideaTokens = meaningfulWords(idea).slice(0, 8);
  if (!ideaTokens.length) return 1;
  const text = normalizeText(`${post.title} ${post.content} ${post.cta} ${(post.hashtags || []).join(" ")}`);
  const matches = ideaTokens.filter((token) => text.includes(token)).length;
  return clamp01(matches / Math.min(2, ideaTokens.length));
}

function addressPreferenceScore(text, language, mode) {
  const patterns = ADDRESS_PATTERNS[language] || ADDRESS_PATTERNS.fr;
  const informal = patterns.informal.test(text);
  const formal = patterns.formal.test(text);
  if (mode === "tu") return informal ? 1 : formal ? 0.25 : 0.7;
  if (mode === "vous") return formal ? 1 : informal && language !== "en" ? 0.25 : 0.7;
  return 1;
}

function voicePreferenceScore(text, language, voice) {
  const patterns = VOICE_PATTERNS[language] || VOICE_PATTERNS.fr;
  if (voice === "je") return patterns.singular.test(text) ? 1 : patterns.plural.test(text) ? 0.45 : 0.7;
  if (voice === "nous") return patterns.plural.test(text) ? 1 : patterns.singular.test(text) ? 0.45 : 0.7;
  return 1;
}

function emojiPreferenceScore(rawText, level) {
  const count = countEmoji(rawText);
  if (level === "none") return count === 0 ? 1 : count === 1 ? 0.55 : 0.2;
  if (level === "dynamic" || level === "many") return count >= 2 ? 1 : count === 1 ? 0.75 : 0.5;
  if (level === "light" || level === "few") return count <= 3 ? 1 : count <= 5 ? 0.75 : 0.45;
  return count <= 5 ? 1 : 0.55;
}

function lengthPreferenceScore(post, preference, channel) {
  const rule = CHANNEL_RULES[channel] || { min: 80, max: 3000 };
  const length = post.content.length;
  const mode = String(preference || "medium").toLowerCase();
  if (["short", "court", "concise"].includes(mode)) {
    const cap = Math.max(rule.min * 2.2, rule.max * 0.42);
    return length <= cap ? 1 : length <= cap * 1.35 ? 0.72 : 0.42;
  }
  if (["detailed", "long", "detaille", "detailed_long"].includes(mode)) {
    const floor = Math.min(rule.max * 0.72, Math.max(rule.min * 1.15, 220));
    return length >= floor ? 1 : length >= floor * 0.7 ? 0.76 : 0.52;
  }
  const low = Math.max(80, rule.min * 0.8);
  const high = Math.max(low + 1, rule.max * 0.78);
  return length >= low && length <= high ? 1 : length < low ? 0.68 : 0.72;
}

function tonePreferenceScore(rawText, text, tone) {
  const mode = String(tone || "").toLowerCase();
  const emojiCount = countEmoji(rawText);
  const exclamations = (rawText.match(/!/g) || []).length;
  if (["serious", "serieux", "professional"].includes(mode)) {
    return emojiCount <= 1 && exclamations <= 2 ? 1 : emojiCount <= 3 ? 0.7 : 0.4;
  }
  if (["warm", "chaleureux", "friendly"].includes(mode)) {
    return WARM_HINTS.test(text) ? 1 : emojiCount > 0 ? 0.82 : 0.68;
  }
  if (["fun", "playful", "humorous"].includes(mode)) {
    return emojiCount >= 1 || exclamations >= 2 ? 1 : 0.62;
  }
  return 0.85;
}

function communicationStyleScore(rawText, style) {
  const mode = String(style || "").toLowerCase();
  const sentenceCount = Math.max(1, rawText.split(/[.!?]+/).filter((part) => part.trim()).length);
  const avgWords = words(rawText).length / sentenceCount;
  const paragraphCount = rawText.split(/\n\s*\n/).filter((part) => part.trim()).length;
  if (["simple", "clear", "clair"].includes(mode)) {
    return avgWords <= 24 ? 1 : avgWords <= 32 ? 0.76 : 0.52;
  }
  if (["dynamic", "dynamique"].includes(mode)) {
    const signals = Number(paragraphCount >= 2) + Number(sentenceCount >= 3) + Number(/[!?]/.test(rawText));
    return signals >= 2 ? 1 : signals === 1 ? 0.76 : 0.58;
  }
  return 0.85;
}

function commercialPreferenceScore(text, rawText, level) {
  const mode = String(level || "").toLowerCase();
  const hasContact = CONTACT_HINTS.test(text) || QUOTE_HINTS.test(text) || Boolean(rawText.trim());
  const aggressive = AGGRESSIVE_SALES_HINTS.test(text);
  if (["discreet", "discret", "low"].includes(mode)) return aggressive ? 0.25 : 1;
  if (["assertive", "strong", "fort"].includes(mode)) return hasContact ? 1 : 0.58;
  if (["balanced", "equilibre", "medium"].includes(mode)) return aggressive ? 0.55 : hasContact ? 1 : 0.75;
  return 0.85;
}

function mainGoalScore(text, rawText, goal) {
  const mode = String(goal || "").toLowerCase();
  if (["contacts", "contact", "leads"].includes(mode)) {
    return CONTACT_HINTS.test(text) || QUOTE_HINTS.test(text) ? 1 : /\?/.test(rawText) ? 0.72 : 0.62;
  }
  if (["engagement", "interactions"].includes(mode)) {
    return /\?/.test(rawText) || ENGAGEMENT_HINTS.test(text) ? 1 : 0.62;
  }
  if (["visibility", "visibilite", "awareness"].includes(mode)) {
    return aggressiveSalesPenalty(text);
  }
  return 0.85;
}

function aggressiveSalesPenalty(text) {
  return AGGRESSIVE_SALES_HINTS.test(text) ? 0.55 : 1;
}

function preferredAngleScore(text, angle) {
  const mode = String(angle || "").toLowerCase();
  const matcher = ANGLE_HINTS[mode];
  if (!matcher) return 0.85;
  return matcher.test(text) ? 1 : mode === "quality" && QUALITY_HINTS.test(text) ? 1 : 0.62;
}

function preferredCtaScore(post, preference) {
  const mode = String(preference || "").toLowerCase();
  const ctaText = normalizeText(post.cta || "");
  const allText = normalizeText(`${post.content} ${post.cta}`);
  if (["none", "aucun", "no"].includes(mode)) {
    return ctaText ? 0.55 : CONTACT_HINTS.test(allText) || QUOTE_HINTS.test(allText) ? 0.72 : 1;
  }
  if (["devis", "quote", "estimate"].includes(mode)) {
    return QUOTE_HINTS.test(allText) ? 1 : CONTACT_HINTS.test(allText) ? 0.78 : 0.52;
  }
  return ctaText ? 1 : 0.72;
}

function preferenceScore(post, preferences, language, channel) {
  const text = normalizeText(`${post.title} ${post.content} ${post.cta}`);
  const rawText = `${post.title}\n${post.content}\n${post.cta}`;
  const breakdown = {
    addressMode: addressPreferenceScore(text, language, preferences.addressMode),
    emojiLevel: emojiPreferenceScore(rawText, preferences.emojiLevel),
    voice: voicePreferenceScore(text, language, preferences.voice),
    length: lengthPreferenceScore(post, preferences.length, channel),
    tone: tonePreferenceScore(rawText, text, preferences.tone),
    communicationStyle: communicationStyleScore(rawText, preferences.communicationStyle),
    commercialLevel: commercialPreferenceScore(text, post.cta, preferences.commercialLevel),
    mainGoal: mainGoalScore(text, rawText, preferences.mainGoal),
    preferredAngle: preferredAngleScore(text, preferences.preferredAngle),
    preferredCta: preferredCtaScore(post, preferences.preferredCta),
  };
  const values = Object.values(breakdown).map(Number).filter(Number.isFinite);
  const score = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
  return { score, breakdown };
}

function channelComplianceScore(channel, post) {
  const rule = CHANNEL_RULES[channel] || { min: 80, max: 3000, maxHashtags: 8 };
  let score = 1;
  if (!post.title) score -= 0.2;
  if (post.content.length < rule.min) score -= 0.35;
  if (post.content.length > rule.max) score -= 0.15;
  if ((post.hashtags || []).length > rule.maxHashtags) score -= 0.2;
  if (channel === "gmb" && (post.hashtags || []).length) score -= 0.25;
  if (rule.forbidContact && /(https?:\/\/|www\.|\b\S+@\S+\.\S+\b|\+?\d[\d .()-]{7,}\d)/i.test(post.content)) score -= 0.25;
  return clamp01(score);
}

function pairwiseDiversity(posts) {
  if (posts.length < 2) return 1;
  const values = [];
  for (let i = 0; i < posts.length; i += 1) {
    for (let j = i + 1; j < posts.length; j += 1) {
      values.push(1 - jaccard(meaningfulWords(posts[i].content), meaningfulWords(posts[j].content)));
    }
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function evaluateGeneration({ output, channels, scenario }) {
  const versions = extractVersions(output);
  const validPosts = [];
  const channelResults = {};
  const invalidChannels = [];

  for (const channel of channels) {
    const post = asPost(versions[channel]);
    if (!post) {
      invalidChannels.push(channel);
      channelResults[channel] = { present: false, score: 0 };
      continue;
    }

    const publishable = Boolean(post.title && post.content && post.content.length >= Math.min(80, CHANNEL_RULES[channel]?.min || 80));
    const compliance = channelComplianceScore(channel, post);
    const language = detectLanguageScore(`${post.title} ${post.content} ${post.cta}`, scenario.language);
    const preference = preferenceScore(post, scenario.preferences || {}, scenario.language, channel);
    const preferences = preference.score;
    const anchor = ideaAnchorScore(scenario.idea, post);
    const score = clamp01(
      (publishable ? 0.22 : 0) + compliance * 0.24 + language * 0.2 + preferences * 0.18 + anchor * 0.16,
    );

    channelResults[channel] = {
      present: true,
      publishable,
      compliance,
      language,
      preferences,
      preferenceBreakdown: preference.breakdown,
      anchor,
      score,
      titleChars: post.title.length,
      contentChars: post.content.length,
      hashtagCount: post.hashtags.length,
    };

    if (!publishable || compliance < 0.65 || language < 0.6 || anchor < 0.45) {
      invalidChannels.push(channel);
    } else {
      validPosts.push(post);
    }
  }

  const entries = Object.values(channelResults);
  const average = (key) => entries.length
    ? entries.reduce((sum, row) => sum + Number(row[key] || 0), 0) / entries.length
    : 0;
  const completeness = channels.length ? (channels.length - invalidChannels.filter((channel) => !channelResults[channel]?.present).length) / channels.length : 1;
  const publishableRatio = channels.length ? entries.filter((row) => row.publishable).length / channels.length : 1;
  const crossChannelDiversity = pairwiseDiversity(validPosts);
  const totalScore = clamp01(
    completeness * 0.18 + publishableRatio * 0.18 + average("compliance") * 0.18 + average("language") * 0.14 + average("preferences") * 0.14 + average("anchor") * 0.1 + crossChannelDiversity * 0.08,
  );

  const preferenceDimensions = {};
  for (const row of entries) {
    for (const [key, value] of Object.entries(row.preferenceBreakdown || {})) {
      const list = preferenceDimensions[key] || [];
      list.push(Number(value));
      preferenceDimensions[key] = list;
    }
  }
  const preferenceBreakdown = Object.fromEntries(
    Object.entries(preferenceDimensions).map(([key, values]) => [
      key,
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    ]),
  );

  return {
    totalScore,
    completeness,
    publishableRatio,
    channelCompliance: average("compliance"),
    languageScore: average("language"),
    preferenceAdherence: average("preferences"),
    preferenceBreakdown,
    ideaAnchor: average("anchor"),
    crossChannelDiversity,
    invalidChannels: Array.from(new Set(invalidChannels)),
    channelResults,
  };
}

export function computeCrossEngineDiversity(results) {
  const byScenario = new Map();
  for (const result of results) {
    if (!result?.success || !result?.output) continue;
    const list = byScenario.get(result.scenarioId) || [];
    list.push(result);
    byScenario.set(result.scenarioId, list);
  }

  const perEngine = new Map();
  for (const rows of byScenario.values()) {
    for (let i = 0; i < rows.length; i += 1) {
      const left = rows[i];
      const leftText = JSON.stringify(extractVersions(left.output));
      const scores = [];
      for (let j = 0; j < rows.length; j += 1) {
        if (i === j) continue;
        const rightText = JSON.stringify(extractVersions(rows[j].output));
        scores.push(1 - jaccard(meaningfulWords(leftText), meaningfulWords(rightText)));
      }
      if (!scores.length) continue;
      const current = perEngine.get(left.engine) || [];
      current.push(scores.reduce((sum, value) => sum + value, 0) / scores.length);
      perEngine.set(left.engine, current);
    }
  }

  return Object.fromEntries(
    Array.from(perEngine.entries()).map(([engine, scores]) => [
      engine,
      scores.reduce((sum, value) => sum + value, 0) / scores.length,
    ]),
  );
}

export function percentile(values, p) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}
