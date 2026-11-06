/** Pinterest REST API v5 PinCreate/PinUpdate limits (description is not alt_text).
 * https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml */
export const PINTEREST_TITLE_MAX_LENGTH = 100;
export const PINTEREST_DESCRIPTION_MAX_LENGTH = 800;

export type PinterestTextIssue = {
  field: "title" | "description";
  length: number;
  limit: number;
  excess: number;
  code: "pinterest_title_too_long" | "pinterest_description_too_long";
  message: string;
};

/** JSON Schema maxLength counts Unicode code points, rather than UTF-16 units. */
export function countPinterestCharacters(value: string): number {
  return Array.from(value).length;
}

export function getPinterestTextIssues(title: string, description: string): PinterestTextIssue[] {
  const issues: PinterestTextIssue[] = [];
  for (const field of ["title", "description"] as const) {
    const length = countPinterestCharacters(field === "title" ? title : description);
    const limit = field === "title" ? PINTEREST_TITLE_MAX_LENGTH : PINTEREST_DESCRIPTION_MAX_LENGTH;
    if (length <= limit) continue;
    const excess = length - limit;
    const subject = field === "title" ? "Votre titre Pinterest" : "Votre description Pinterest";
    issues.push({
      field, length, limit, excess,
      code: field === "title" ? "pinterest_title_too_long" : "pinterest_description_too_long",
      message: `${subject} est trop ${field === "title" ? "long" : "longue"} de ${excess} caractère${excess === 1 ? "" : "s"}. Raccourcissez-${field === "title" ? "le" : "la"} pour enregistrer vos modifications.`,
    });
  }
  return issues;
}

export class PinterestTextValidationError extends Error {
  readonly issue: PinterestTextIssue;
  constructor(issue: PinterestTextIssue) {
    super(issue.message);
    this.name = "PinterestTextValidationError";
    this.issue = issue;
  }
}

/** Preserve the complete accepted copy; never truncate a professional's edits. */
export function preparePinterestPinText(title: unknown, description: unknown) {
  const normalizedTitle = String(title || "Publication iNrCy").replace(/\s+/g, " ").trim();
  const normalizedDescription = String(description || "").replace(/\r\n?/g, "\n").trim();
  const issue = getPinterestTextIssues(normalizedTitle, normalizedDescription)[0];
  if (issue) throw new PinterestTextValidationError(issue);
  return { title: normalizedTitle, description: normalizedDescription };
}
