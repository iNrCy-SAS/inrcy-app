const ALLOWED_INLINE_TAGS = "strong|b|em|i|u";

export function escapeHtml(input: unknown) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeAllowedTag(tag: string) {
  const t = tag.toLowerCase();
  if (t === "b") return "strong";
  if (t === "i") return "em";
  return t;
}

function stripEscapedInlineTagArtifacts(input: string) {
  return String(input || "")
    .replace(new RegExp(`&lt;\\s*\\/?\\s*(${ALLOWED_INLINE_TAGS})(?:\\s+[^&]*?)?\\s*\\/?\\s*&gt;`, "gi"), "")
    .replace(new RegExp(`&amp;lt;\\s*\\/?\\s*(${ALLOWED_INLINE_TAGS})(?:\\s+[^&]*?)?\\s*\\/?\\s*&amp;gt;`, "gi"), "");
}

function normalizeGeneratedInlineTags(input: string) {
  return String(input || "")
    .replace(/<\s*(strong|b)\b[^>]*>/gi, "<strong>")
    .replace(/<\s*\/\s*(strong|b)\s*>/gi, "</strong>")
    .replace(/<\s*(em|i)\b[^>]*>/gi, "<em>")
    .replace(/<\s*\/\s*(em|i)\s*>/gi, "</em>")
    .replace(/<\s*u\b[^>]*>/gi, "<u>")
    .replace(/<\s*\/\s*u\s*>/gi, "</u>");
}

function applyInlineSiteFormattingToEscaped(input: string) {
  let out = String(input || "");
  const allowedTagRegex = new RegExp(`&lt;(${ALLOWED_INLINE_TAGS})&gt;([\\s\\S]*?)&lt;\\/\\1&gt;`, "gi");

  // Restore only complete, balanced inline tags. Broken/orphan tags are removed below,
  // so they can never appear on the public site as literal "<strong>" text.
  for (let i = 0; i < 8; i += 1) {
    const before = out;
    out = out.replace(allowedTagRegex, (_match, tag, inner) => {
      const safeTag = normalizeAllowedTag(String(tag || ""));
      return `<${safeTag}>${inner}</${safeTag}>`;
    });
    if (out === before) break;
  }

  // Keep backward compatibility with generated Markdown content.
  out = out.replace(/\*\*\*([^*\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");

  return stripEscapedInlineTagArtifacts(out);
}

function decodeBasicHtmlEntities(input: string) {
  return String(input || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'");
}

export function sanitizeBoosterSiteText(input: unknown) {
  let text = decodeBasicHtmlEntities(String(input ?? ""))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  text = normalizeGeneratedInlineTags(text)
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(div|p|li|h[1-6])\b[^>]*>/gi, "")
    .replace(new RegExp(`<\\s*\\/?\\s*(?!strong\\b|em\\b|u\\b)[a-z][^>]*>`, "gi"), "")
    .replace(new RegExp(`<\\s*\\/?\\s*(${ALLOWED_INLINE_TAGS})(?:\\s+[^>]*?)?\\s*\\/?\\s*>`, "gi"), (tag) => {
      const match = String(tag).match(/^<\s*(\/?)\s*(strong|b|em|i|u)\b/i);
      if (!match) return "";
      const slash = match[1] ? "/" : "";
      const safeTag = normalizeAllowedTag(match[2]);
      return `<${slash}${safeTag}>`;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  // Remove orphan allowed tags by simulating a very small inline-tag stack.
  const tokens: string[] = [];
  const stack: Array<{ tag: string; index: number }> = [];
  const parts = text.split(/(<\/?(?:strong|em|u)>)/gi);
  for (const part of parts) {
    const open = part.match(/^<(strong|em|u)>$/i);
    const close = part.match(/^<\/(strong|em|u)>$/i);
    if (open) {
      stack.push({ tag: open[1].toLowerCase(), index: tokens.length });
      tokens.push(`<${open[1].toLowerCase()}>`);
    } else if (close) {
      const tag = close[1].toLowerCase();
      const last = stack[stack.length - 1];
      if (last?.tag === tag) {
        stack.pop();
        tokens.push(`</${tag}>`);
      }
      // Mismatched/extra closing tag is dropped.
    } else {
      tokens.push(part);
    }
  }
  for (const leftover of stack) tokens[leftover.index] = "";

  // Internal blank lines belong to the professional's authored layout.
  // Only trim the outer envelope; do not compact the content itself.
  return tokens.join("").trim();
}

export function siteTextToEditableHtml(input: unknown) {
  const raw = sanitizeBoosterSiteText(input);
  if (!raw.trim()) return "";

  return applyInlineSiteFormattingToEscaped(escapeHtml(raw)).replace(/\n/g, "<br />");
}

export function editableHtmlToSiteText(input: unknown) {
  let html = String(input ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/<\s*(strong|b)\b[^>]*>/gi, "%%INRCY_STRONG_OPEN%%")
    .replace(/<\s*\/\s*(strong|b)\s*>/gi, "%%INRCY_STRONG_CLOSE%%")
    .replace(/<\s*(em|i)\b[^>]*>/gi, "%%INRCY_EM_OPEN%%")
    .replace(/<\s*\/\s*(em|i)\s*>/gi, "%%INRCY_EM_CLOSE%%")
    .replace(/<\s*u\b[^>]*>/gi, "%%INRCY_U_OPEN%%")
    .replace(/<\s*\/\s*u\s*>/gi, "%%INRCY_U_CLOSE%%")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(div|p|li|h[1-6])[^>]*>/gi, "")
    .replace(/<[^>]*>/g, "");

  html = decodeBasicHtmlEntities(html)
    .replace(/%%INRCY_STRONG_OPEN%%/g, "<strong>")
    .replace(/%%INRCY_STRONG_CLOSE%%/g, "</strong>")
    .replace(/%%INRCY_EM_OPEN%%/g, "<em>")
    .replace(/%%INRCY_EM_CLOSE%%/g, "</em>")
    .replace(/%%INRCY_U_OPEN%%/g, "<u>")
    .replace(/%%INRCY_U_CLOSE%%/g, "</u>")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();

  return sanitizeBoosterSiteText(html);
}

export function renderBoosterSiteInlineHtml(input: unknown) {
  const raw = sanitizeBoosterSiteText(input);
  if (!raw) return "";

  return applyInlineSiteFormattingToEscaped(escapeHtml(raw).replace(/\r\n/g, "\n"))
    .replace(/\n/g, "<br />");
}

export function renderBoosterSiteContentHtml(input: unknown) {
  const raw = sanitizeBoosterSiteText(input);
  if (!raw) return "";

  // A single safe paragraph with explicit <br> nodes preserves every line
  // break, including several intentionally blank lines. Splitting on \n{2,}
  // used to lose the exact spacing before the website embed rendered it.
  return `<p>${renderBoosterSiteInlineHtml(raw)}</p>`;
}

export function stripSiteTextFormattingForEditor(input: unknown) {
  return decodeBasicHtmlEntities(String(input ?? ""))
    .replace(new RegExp(`<\\/?\\s*(${ALLOWED_INLINE_TAGS})[^>]*>`, "gi"), "")
    .replace(new RegExp(`&lt;\\/?\\s*(${ALLOWED_INLINE_TAGS})[^&]*?&gt;`, "gi"), "")
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, "$1")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1$2")
    .replace(/\*{1,3}/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Remove site-only formatting without rewriting the professional's layout.
 * Internal blank lines and horizontal spacing are intentionally preserved so
 * manual edits made in Booster reach social channels as authored.
 */
export function stripSiteTextFormattingPreserveLayout(input: unknown) {
  return decodeBasicHtmlEntities(String(input ?? ""))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(div|p|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(div|p|li|h[1-6])\b[^>]*>/gi, "")
    .replace(new RegExp(`<\\/?\\s*(${ALLOWED_INLINE_TAGS})[^>]*>`, "gi"), "")
    .replace(new RegExp(`&lt;\\/?\\s*(${ALLOWED_INLINE_TAGS})[^&]*?&gt;`, "gi"), "")
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, "$1")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1$2")
    .replace(/\*{1,3}/g, "")
    .trim();
}

export function stripSiteTextFormatting(input: unknown) {
  return stripSiteTextFormattingForEditor(input).trim();
}
