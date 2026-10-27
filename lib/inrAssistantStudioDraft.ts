/** Editable creative data only. This payload never authorizes paid generation. */
export type InrAssistantStudioDraft = {
  version: 1;
  mediaType: "image" | "video";
  prompt: string;
  format: "square" | "portrait" | "story" | "landscape" | null;
  durationSeconds: number | null;
};

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const formats = ["square", "portrait", "story", "landscape"] as const;
const fields = new Set(["version", "mediaType", "prompt", "format", "durationSeconds"]);
const unsafeControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function promptText(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4000 || unsafeControls.test(value)) return null;
  let text = value.replace(/\r\n?/g, "\n").trim();
  const closing: Record<string, string> = { "«": "»", "“": "”", '"': '"' };
  if (closing[text[0]]) {
    if (!text.endsWith(closing[text[0]])) return null;
    text = text.slice(1, -1).trim();
  }
  if (text.length < 3) return null;
  return text;
}

/** Strict persisted/public shape: no account scope, callback or execution URL. */
export function parseInrAssistantStudioDraft(value: unknown): InrAssistantStudioDraft | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.has(key))) return null;
    const row = value as Record<string, unknown>;
    const prompt = promptText(row.prompt);
    if (row.version !== 1 || (row.mediaType !== "image" && row.mediaType !== "video") || !prompt ||
      (row.format !== null && !formats.includes(row.format as typeof formats[number])) ||
      (row.durationSeconds !== null && (!Number.isInteger(row.durationSeconds) || Number(row.durationSeconds) < 4 || Number(row.durationSeconds) > 30)) ||
      (row.mediaType === "image" && row.durationSeconds !== null)) return null;
    return { version: 1, mediaType: row.mediaType, prompt, format: row.format as InrAssistantStudioDraft["format"], durationSeconds: row.durationSeconds as number | null };
  } catch { return null; }
}

type Blocks = { outside: string; candidates: string[]; valid: boolean };
function markdownBlocks(value: string): Blocks {
  const outside: string[] = [], candidates: string[] = [];
  let quote: string[] = [], fence: { marker: string; language: string; lines: string[] } | null = null;
  const flushQuote = () => { if (quote.length) candidates.push(quote.join("\n")); quote = []; };
  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence) {
      const closing = line.match(/^\s{0,3}(\x60{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === fence.marker[0] && closing[1].length >= fence.marker.length) {
        if (!fence.language || /^(?:text|texte|txt|plaintext|prompt|markdown|md)$/i.test(fence.language)) candidates.push(fence.lines.join("\n"));
        fence = null;
      } else fence.lines.push(line);
      continue;
    }
    const opening = line.match(/^\s{0,3}(\x60{3,}|~{3,})([\w-]*)\s*$/);
    if (opening) { flushQuote(); fence = { marker: opening[1], language: opening[2], lines: [] }; continue; }
    const quoted = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quoted) { quote.push(quoted[1]); continue; }
    flushQuote(); outside.push(line);
  }
  flushQuote();
  return { outside: outside.join("\n"), candidates, valid: fence === null };
}

function requestProse(value: string): string | null {
  if (typeof value !== "string" || value.length > 4000 || unsafeControls.test(value)) return null;
  const blocks = markdownBlocks(value);
  if (!blocks.valid) return null;
  return normalize(blocks.outside.replace(/«[^»]*»|“[^”]*”|"[^"]*"|\x60[^\x60]*\x60/g, " "));
}

/** Recognizes writing a prompt, never a grant to run the resulting prompt. */
export function isInrAssistantStudioDraftRequest(userRequest: string): boolean {
  const text = requestProse(userRequest);
  if (!text || /^(?:comment|pourquoi|explique|how|why|what|wie|warum|como)\b/.test(text.trim()) ||
    /\b(?:explique|explain|montre|show|teach)\b.{0,70}\b(?:comment|how|pourquoi|why)\b/.test(text)) return false;
  const writing = "(?:ecri(?:s|re|vez|ves|ve|viez)|redige(?:r|z|s)?|prepare(?:r|z|s)?|propose(?:r|z|s)?|donne(?:r|z|s)?|ameliore(?:r|z|s)?|modifi(?:e|er|ez|es)|adapte(?:r|z|s)?|fais|faire|faites|genere(?:r|z|s)?|cree(?:r|z|s)?|write|draft|prepare|give|create|improve|edit|rewrite|escrib\\w*|redact\\w*|schreib\\w*|erstelle\\w*|scriv\\w*|escrev\\w*|schrijf\\w*)";
  if (new RegExp("\\b(?:ne|pas|jamais|not|never|don't|do not|no|nicht)\\b.{0,45}\\b" + writing + "\\b|\\b" + writing + "\\b.{0,12}\\b(?:pas|jamais|not|never)\\b").test(text) ||
    /\b(?:pas de|aucun|no|not a|kein)\s+(?:prompt|brief)\b/.test(text)) return false;
  const noun = /\b(?:prompt|brief|consigne(?:s)?)\b|提示词|提示語|พรอมต์/.test(text);
  const write = [...text.matchAll(new RegExp("\\b" + writing + "\\b([^.!?\\n]{0,80}?)\\b(?:prompt|brief|consignes?)\\b", "g"))]
    .some(match => !/\b(?:images?|photos?|videos?|flyers?|affiches?|medias?|visuels?)\b/.test(match[1]) || /^\s+pour\s+(?:cette?|une?|la|le|les|mes?|notre)\b/.test(match[1])) || /(?:写|撰写|เขียน).{0,40}(?:提示词|提示語|พรอมต์)/.test(text);
  const media = /\b(?:images?|photos?|videos?|visuels?|flyers?|affiches?|illustrations?|logos?|medias?|clips?|posters?|pictures?|imagen|bild|immagine|imagem|afbeelding)\b|图片|图像|海报|视频|รูป|ภาพ|วิดีโอ/.test(text);
  return noun && write && media;
}

function mediaType(text: string): "image" | "video" | null {
  const value = normalize(text);
  const video = /\b(?:videos?|clips?|films?|animation)\b|视频|วิดีโอ/.test(value);
  const image = /\b(?:images?|photos?|visuels?|flyers?|affiches?|illustrations?|logos?|posters?|pictures?|imagen|bild|immagine|imagem|afbeelding)\b|图片|图像|海报|รูป|ภาพ/.test(value);
  if (video && image && !/\b(?:video|clip)\b.{0,45}(?:a partir|depuis|from|avec une (?:image|photo)|using an? (?:image|photo))/.test(value)) return null;
  return video ? "video" : image ? "image" : null;
}

function singleFormat(text: string, kind: InrAssistantStudioDraft["mediaType"]): InrAssistantStudioDraft["format"] {
  const value = normalize(text), found = new Set<Exclude<InrAssistantStudioDraft["format"], null>>();
  if (/\b(?:square|carre(?:e)?s?)\b|\b1\s*:\s*1\b|正方形|สี่เหลี่ยมจัตุรัส/.test(value)) found.add("square");
  if (/\bportrait\b|\b4\s*:\s*5\b/.test(value)) found.add("portrait");
  if (/\bverticale?\b|竖版|แนวตั้ง/.test(value)) found.add(kind === "video" ? "story" : "portrait");
  if (/\b(?:story|stories)\b|\b9\s*:\s*16\b/.test(value)) found.add("story");
  if (/\b(?:landscape|paysage|horizontale?)\b|\b16\s*:\s*9\b|横版|แนวนอน/.test(value)) found.add("landscape");
  if (found.has("story") && found.has("portrait") && !/\bportrait\b|\b4\s*:\s*5\b/.test(value)) found.delete("portrait");
  return found.size === 1 ? [...found][0] : null;
}

function labelledPrompt(outside: string): string | null {
  const lines = outside.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^\s*(?:#{1,4}\s*)?(?:\*\*)?(?:prompt|brief|consignes?)(?:\s+(?:propose|proposé|recommande|recommandé|optimise|optimisé))?(?:\*\*)?\s*:\s*(.*)$/i);
    if (!match) continue;
    const content = match[1] ? [match[1]] : [];
    while (index + 1 < lines.length && (!lines[index + 1].trim() && !content.length)) index++;
    while (index + 1 < lines.length && lines[index + 1].trim() && !/^\s*(?:#{1,4}|\*\*|format|duree|durée)/i.test(lines[index + 1])) content.push(lines[++index]);
    return promptText(content.join("\n"));
  }
  return null;
}

/** Extracts a complete editable draft. No model offer or execution consent is required. */
export function deriveInrAssistantStudioDraft(userRequest: string, assistantReply: string): InrAssistantStudioDraft | null {
  if (!isInrAssistantStudioDraftRequest(userRequest) || typeof assistantReply !== "string" || assistantReply.length > 60000 || unsafeControls.test(assistantReply)) return null;
  const blocks = markdownBlocks(assistantReply);
  if (!blocks.valid) return null;
  const candidates = [...new Set(blocks.candidates.map(promptText).filter((value): value is string => Boolean(value)))];
  let prompt: string | null = candidates.length === 1 ? candidates[0] : null;
  if (candidates.length > 1) return null;
  if (!prompt) prompt = labelledPrompt(blocks.outside);
  if (!prompt && !blocks.outside.includes("\n")) {
    const candidate = promptText(blocks.outside);
    if (candidate && /^(?:cree|creez|create|generate|flyer|affiche|image|photo|portrait|illustration|poster|video|scene|plan|cinematic|realistic)\b|^(?:生成|图片|图像|海报|视频|ภาพ|รูป)/i.test(normalize(candidate))) prompt = candidate;
  }
  if (!prompt) return null;
  const kind = mediaType(userRequest) ?? mediaType(prompt);
  if (!kind) return null;
  const durationValues = [...new Set([...normalize(userRequest + "\n" + prompt).matchAll(/\b(\d{1,3})\s*(?:secondes?|seconds?|sec|s)\b/g)].map(match => Number(match[1])))];
  const durationSeconds = kind === "video" && durationValues.length === 1 && durationValues[0] >= 4 && durationValues[0] <= 30 ? durationValues[0] : null;
  return parseInrAssistantStudioDraft({
    version: 1, mediaType: kind, prompt,
    format: singleFormat(userRequest, kind) ?? singleFormat(prompt, kind) ?? singleFormat(blocks.outside, kind),
    durationSeconds,
  });
}
