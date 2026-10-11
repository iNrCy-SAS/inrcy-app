type DocumentText = { heading: string; text: string };
const OMITTED = "\n[… extrait limité …]\n";

function excerpt(text: string, limit: number) {
  if (text.length <= limit) return text;
  if (limit <= OMITTED.length + 2) return text.slice(0, limit);
  const usable = limit - OMITTED.length;
  const head = Math.ceil(usable * 0.7);
  return text.slice(0, head) + OMITTED + text.slice(-(usable - head));
}

/** Répartit la limite réelle (JSON compris si demandé) entre les documents.
 * Le dernier fichier reste représenté même si le premier est très long. */
export function fitBusinessDnaDocuments(
  documents: DocumentText[], limit: number,
  measure: (text: string) => number = (text) => text.length,
) {
  if (!documents.length || limit <= 0) return "";
  const render = (share: number) => documents.map((document) =>
    `${document.heading}\n${excerpt(document.text, share)}`,
  ).join("\n\n");
  let low = 0;
  let high = Math.max(...documents.map((document) => document.text.length));
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(render(middle)) <= limit) low = middle;
    else high = middle - 1;
  }
  const result = render(low);
  // Les budgets normaux couvrent largement les en-têtes. Borne également un
  // budget artificiellement minuscule sans produire un JSON hors limite.
  if (measure(result) <= limit) return result;
  let end = Math.min(limit, result.length);
  while (end && measure(result.slice(0, end)) > limit) end--;
  return result.slice(0, end);
}

export function fitBusinessDnaReferenceDocumentSource(content: string, encodedBudget: number) {
  const sections = Array.from(content.matchAll(/(^|\n\n)(\[Document fourni \d+ — [^\n]*\])\n/g));
  if (!sections.length) {
    let low = 0;
    let high = content.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (JSON.stringify(content.slice(0, middle)).length - 2 <= encodedBudget) low = middle;
      else high = middle - 1;
    }
    return content.slice(0, low);
  }
  const documents = sections.map((section, index) => ({
    heading: section[2],
    text: content.slice((section.index ?? 0) + section[0].length,
      sections[index + 1]?.index ?? content.length).trim(),
  }));
  return fitBusinessDnaDocuments(documents, encodedBudget, (value) => JSON.stringify(value).length - 2);
}
