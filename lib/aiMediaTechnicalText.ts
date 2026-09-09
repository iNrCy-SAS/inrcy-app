/** High-confidence rendering metadata, not ordinary words such as "palette". */
const TECHNICAL_MARKERS = /#[\da-f]{6}\b|#[\da-f]{3}\b|\b(?:rgb|hsl)a?\(\s*[\d.%\s,\/+-]+\)|\b(?:SUJET IMMUTABLE|CONSIGNE PRIORITAIRE|NO VISUAL TEXT|light\/material-accents|PARAMS)\s*[:=]/gi;

export function hasAiMediaTechnicalText(value: unknown): boolean {
  TECHNICAL_MARKERS.lastIndex = 0;
  return TECHNICAL_MARKERS.test(String(value ?? ""));
}

/** Preserve only literal copy explicitly requested, never a visual direction. */
export function isAiMediaTechnicalCopyAllowed(
  value: unknown,
  request: { textKeywords: readonly string[]; aiInstruction: string },
): boolean {
  const text = String(value ?? "").trim();
  if (!hasAiMediaTechnicalText(text)) return true;
  const exactCopy = [
    ...request.textKeywords,
    ...Array.from(
      request.aiInstruction.matchAll(
        /(?:affich\w*|[ée]cri\w*|inscri\w*|dire|dis|prononc\w*|write|display|say)\s*(?:exactement|exactly)?\s*:?\s*[«"]([^»"]+)[»"]/gi,
      ),
      (match) => match[1],
    ),
  ];
  return exactCopy.some((literal) => literal.trim() === text);
}

/** Keep the scene role and its anti-recitation guard inside the hard budget. */
export function fitAiMediaSceneDirection(value: string, maximum = 700): string {
  const guard = "Directives visuelles uniquement : appliquer sans les afficher ni les réciter.";
  const normalized = value.replace(/\s+/g, " ").trim();
  const budget = Math.max(0, maximum - guard.length - 1);
  const direction = normalized.length <= budget
    ? normalized
    : normalized.slice(0, budget + 1).replace(/\s+\S*$/, "").slice(0, budget).trim();
  return [direction, guard].filter(Boolean).join(" ");
}
