export type BusinessDnaRichText = {
  detailedDescription: string;
  offersAndArguments: string;
  proofsAndObjections: string;
  editorialStrategy: string;
};

export const EMPTY_BUSINESS_DNA_RICH_TEXT: BusinessDnaRichText = {
  detailedDescription: "",
  offersAndArguments: "",
  proofsAndObjections: "",
  editorialStrategy: "",
};

const ALLOWED_TAGS = new Set([
  "strong",
  "b",
  "em",
  "i",
  "u",
  "br",
  "div",
  "p",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
]);

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const point = Number(code);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : "";
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function formatInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/___([^_\n]+?)___/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+?)_/g, "$1<em>$2</em>");
}

export function businessDnaTextToHtml(value: string) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (!listType || !listItems.length) return;
    blocks.push(`<${listType}>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  for (const line of lines) {
    const unordered = /^\s*[-•]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const nextType = unordered ? "ul" : "ol";
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered?.[1] || ordered?.[1] || "").trim());
      continue;
    }
    flushList();
    const heading2 = /^\s*##\s+(.+)$/.exec(line);
    const heading3 = /^\s*###\s+(.+)$/.exec(line);
    if (heading3) blocks.push(`<h3>${formatInlineMarkdown(heading3[1])}</h3>`);
    else if (heading2) blocks.push(`<h2>${formatInlineMarkdown(heading2[1])}</h2>`);
    else blocks.push(line.trim() ? `<div>${formatInlineMarkdown(line)}</div>` : "<div><br></div>");
  }
  flushList();
  return sanitizeBusinessDnaRichHtml(blocks.join(""));
}

export function sanitizeBusinessDnaRichHtml(value: string, maxLength = 7_000) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|svg|math|link|meta)[^>]*\/?\s*>/gi, "")
    .replace(/<\s*(\/?)\s*([a-z0-9]+)(?:\s[^>]*)?>/gi, (_match, closing: string, rawTag: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";
      if (tag === "br") return "<br>";
      const normalized = tag === "b" ? "strong" : tag === "i" ? "em" : tag;
      return closing ? `</${normalized}>` : `<${normalized}>`;
    })
    .slice(0, Math.max(0, maxLength))
    .trim();
}

export function businessDnaHtmlToPlainText(value: string) {
  return decodeEntities(
    sanitizeBusinessDnaRichHtml(value)
      .replace(/<\s*br\s*>/gi, "\n")
      .replace(/<\s*li\s*>/gi, "• ")
      .replace(/<\s*\/\s*li\s*>/gi, "\n")
      .replace(/<\s*\/\s*(div|p|h2|h3|ul|ol)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeBusinessDnaPlainText(value: unknown, maxLength = 5_000) {
  const raw = String(value ?? "").replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  const withoutHtml = /<\/?[a-z][^>]*>/i.test(raw)
    ? businessDnaHtmlToPlainText(raw)
    : raw;
  return withoutHtml
    .replace(/^\s*#{1,3}\s+/gm, "")
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, "$1")
    .replace(/___([^_\n]+?)___/g, "$1")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+?)_/g, "$1$2")
    .trim()
    .slice(0, maxLength);
}

export function normalizeBusinessDnaRichText(
  value: unknown,
  fallback: Partial<BusinessDnaRichText> = {},
): BusinessDnaRichText {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalizeField = (key: keyof BusinessDnaRichText) => {
    const direct = String(source[key] ?? "").trim();
    if (direct) return sanitizeBusinessDnaRichHtml(direct);
    const fallbackText = String(fallback[key] ?? "").trim();
    return fallbackText ? businessDnaTextToHtml(fallbackText) : "";
  };
  return {
    detailedDescription: normalizeField("detailedDescription"),
    offersAndArguments: normalizeField("offersAndArguments"),
    proofsAndObjections: normalizeField("proofsAndObjections"),
    editorialStrategy: normalizeField("editorialStrategy"),
  };
}
