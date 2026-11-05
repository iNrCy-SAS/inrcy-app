import { inrAssistantClauseIsAdvice, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";
export const INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES = {
  detailedDescription: "dna_text_description", mission: "dna_text_mission", offersAndArguments: "dna_text_offers", keyArguments: "dna_text_arguments",
  proofsAndObjections: "dna_text_proofs", objectionResponses: "dna_text_responses", editorialStrategy: "dna_text_strategy", campaignCalendar: "dna_text_calendar",
} as const;
export type InrAssistantBusinessRichTextField = keyof typeof INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES;
export const INR_ASSISTANT_BUSINESS_RICH_TEXT_FIELDS = Object.keys(INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES) as InrAssistantBusinessRichTextField[];
export const INR_ASSISTANT_BUSINESS_RICH_TEXT_FORMATS = ["bold", "italic", "heading", "list", "remove_format"] as const;
export type InrAssistantBusinessRichTextFormat = typeof INR_ASSISTANT_BUSINESS_RICH_TEXT_FORMATS[number];
export type InrAssistantBusinessRichTextEdit = { format: InrAssistantBusinessRichTextFormat; selectionText: string | null; wholeField: boolean };
const fieldWords: Record<InrAssistantBusinessRichTextField, RegExp> = { detailedDescription: /description|presentation/, mission: /mission|raison d.etre/, offersAndArguments: /offres?|gammes?|prix/, keyArguments: /arguments?|benefices? clients?/, proofsAndObjections: /preuves?|garanties?/, objectionResponses: /objections?|reponses?/, editorialStrategy: /(?:ligne|piliers?|strategie).{0,20}editoria|editorial (?:strategy|line)/, campaignCalendar: /calendrier|calendar/ };
const formats: Record<InrAssistantBusinessRichTextFormat, RegExp> = { bold: /\ben gras\b|\bbold\b/, italic: /\ben italique\b|\bitalic\b/, heading: /(?:en|comme|en tant que) (?:un )?titre|\bheading\b/, list: /(?:en|sous forme de) (?:une )?liste|\bpuces\b|\bbullet/, remove_format: /(?:retire\w*|enleve\w*|supprime\w*|remove|clear).{0,35}(?:mise en forme|formatage|formatting|format)/ };
export function parseInrAssistantBusinessRichTextEdit(value: unknown): InrAssistantBusinessRichTextEdit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || !INR_ASSISTANT_BUSINESS_RICH_TEXT_FORMATS.includes(row.format as InrAssistantBusinessRichTextFormat) || typeof row.wholeField !== "boolean"
    || (row.wholeField ? row.selectionText !== null : typeof row.selectionText !== "string" || !row.selectionText.trim() || row.selectionText.length > 5000)) return null;
  return { format: row.format as InrAssistantBusinessRichTextFormat, selectionText: row.selectionText as string | null, wholeField: row.wholeField };
}
export function isInrAssistantBusinessRichTextRequest(message: string, field?: InrAssistantBusinessRichTextField, edit?: InrAssistantBusinessRichTextEdit) {
  const text = inrAssistantUnquotedRequest(message);
  if (inrAssistantClauseIsAdvice(text) || /\b(?:si|if|quand|when|apres|avant|demain|later|sans|not|never)\b|\bne\b.{0,50}\bpas\b/.test(text)
    || !/\badn\b|\bdna\b/.test(text) || !/\b(?:mets|mettez|formate\w*|applique\w*|retire\w*|enleve\w*|supprime\w*|make|set|remove)\b/.test(text)) return false;
  if (field ? !fieldWords[field].test(text) : !Object.values(fieldWords).some(pattern => pattern.test(text))) return false;
  if (!edit) return Object.values(formats).some(pattern => pattern.test(text));
  return formats[edit.format].test(text) && (edit.wholeField ? /\btout\b|\btoute\b|\bentier\w*\b|\ball\b|\bwhole\b/.test(text) : Boolean(edit.selectionText && message.includes(edit.selectionText)));
}
