export const BUSINESS_DNA_MAX_WEBSITE_PAGES = 8;
export const BUSINESS_DNA_MAX_WEBSITE_SOURCE_CHARS = 16_000;

const MAX_PAGE_URL_CHARS = 512;
const PAGE_SEPARATOR = "\n\n";

export type BusinessDnaWebsiteDocument = {
  url: string;
  text: string;
};

function balancedTextBudgets(lengths: number[], totalBudget: number) {
  const budgets = lengths.map(() => 0);
  let remaining = Math.max(0, Math.floor(totalBudget));
  let active = lengths
    .map((_length, index) => index)
    .filter((index) => lengths[index] > 0);

  // Max-min fairness: every page receives the same initial allowance. Short
  // pages release their unused share, which is then split between the other
  // pages instead of being handed wholesale to the home page.
  while (active.length && remaining > 0) {
    const share = Math.floor(remaining / active.length);
    if (share === 0) {
      for (let index = 0; index < remaining; index += 1) {
        budgets[active[index]] += 1;
      }
      break;
    }

    const completed = active.filter(
      (index) => lengths[index] - budgets[index] <= share,
    );
    if (completed.length) {
      const completedSet = new Set(completed);
      for (const index of completed) {
        const granted = lengths[index] - budgets[index];
        budgets[index] += granted;
        remaining -= granted;
      }
      active = active.filter((index) => !completedSet.has(index));
      continue;
    }

    for (const index of active) {
      budgets[index] += share;
      remaining -= share;
    }
    for (let index = 0; index < remaining; index += 1) {
      budgets[active[index]] += 1;
    }
    break;
  }

  return budgets;
}

/**
 * Builds one bounded website source while reserving representation for the
 * home page and every successfully fetched useful page (up to eight total).
 */
export function buildBalancedBusinessDnaWebsiteContent(
  documents: BusinessDnaWebsiteDocument[],
  maxChars = BUSINESS_DNA_MAX_WEBSITE_SOURCE_CHARS,
) {
  const limit = Math.max(0, Math.floor(maxChars));
  if (!limit) return "";

  const seenUrls = new Set<string>();
  const selected: BusinessDnaWebsiteDocument[] = [];
  for (const document of documents) {
    const url = String(document.url || "").trim();
    const text = String(document.text || "").trim();
    if (!url || seenUrls.has(url)) continue;
    // Keep the home page marker even when its extracted body is empty, but
    // omit empty discovered pages that would carry no useful evidence.
    if (selected.length > 0 && !text) continue;
    seenUrls.add(url);
    selected.push({ url: url.slice(0, MAX_PAGE_URL_CHARS), text });
    if (selected.length === BUSINESS_DNA_MAX_WEBSITE_PAGES) break;
  }
  if (!selected.length) return "";

  const headers = selected.map((document) => `PAGE ${document.url}\n`);
  const fixedChars = headers.reduce((sum, header) => sum + header.length, 0)
    + PAGE_SEPARATOR.length * Math.max(0, selected.length - 1);
  const availableTextChars = Math.max(0, limit - fixedChars);
  const textBudgets = balancedTextBudgets(
    selected.map((document) => document.text.length),
    availableTextChars,
  );

  return selected
    .map((document, index) => `${headers[index]}${document.text.slice(0, textBudgets[index])}`)
    .join(PAGE_SEPARATOR)
    .slice(0, limit);
}
