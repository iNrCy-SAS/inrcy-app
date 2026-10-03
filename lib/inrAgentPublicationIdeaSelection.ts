type IdeaRow = { idea_text: string };
type IdeaFocus = { source: string; subject: string };

/** Focus text is single-line, but a professional's saved idea may contain
 * line breaks. This must mirror the focus builder's subject normalization. */
export function inrAgentPublicationIdeaSubjectKey(value: unknown) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function matchingInrAgentPublicationIdeaRow<T extends IdeaRow>(
  rows: readonly T[],
  focusSubject: string,
): T | undefined {
  const exact = rows.find((row) => row.idea_text === focusSubject);
  if (exact) return exact;
  const key = inrAgentPublicationIdeaSubjectKey(focusSubject);
  return key ? rows.find((row) => inrAgentPublicationIdeaSubjectKey(row.idea_text) === key) : undefined;
}

/** Every rejected claim removes one candidate, even when its normalized focus
 * no longer matches any raw idea. A failed generation never marks it used. */
export async function claimFirstAvailableInrAgentIdea<F extends IdeaFocus>(args: {
  rows: readonly IdeaRow[];
  buildFocus: (ideas: string[]) => F | null;
  claim: (ideaText: string) => Promise<boolean>;
}): Promise<F | null> {
  let availableRows = [...args.rows];
  for (let attempt = 0; attempt < args.rows.length && availableRows.length; attempt += 1) {
    const candidate = args.buildFocus(availableRows.map((row) => row.idea_text));
    if (candidate?.source !== "professional_idea") break;
    const row = matchingInrAgentPublicationIdeaRow(availableRows, candidate.subject);
    if (!row) {
      availableRows = availableRows.slice(1);
      continue;
    }
    if (await args.claim(row.idea_text)) {
      // Keep the original text in the persisted focus: the DB consumption
      // trigger matches the idea text exactly, including line breaks.
      return { ...candidate, subject: row.idea_text };
    }
    availableRows = availableRows.filter((item) => item !== row);
  }
  return null;
}
