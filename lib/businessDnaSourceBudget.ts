export type BusinessDnaBudgetSource = {
  key: string;
  label: string;
  status: string;
  content: string;
};

export function hasReadableBusinessDnaAnalysisSource(
  sources: BusinessDnaBudgetSource[],
): boolean {
  return sources.some(
    (source) => source.status === "analyzed" && Boolean(String(source.content || "").trim()),
  );
}

/**
 * Construit un contexte multicanal borné en tenant compte du coût réel de
 * JSON.stringify. Une première enveloppe équitable empêche un site très long
 * d'évincer les réseaux ; la marge restante favorise les sources officielles.
 */
export function buildBusinessDnaAnalysisSourcePayload(
  sources: BusinessDnaBudgetSource[],
  maxTotalChars = 52_000,
) {
  const priorities = [
    "website",
    "inrcy_site",
    "google_business",
    "inr_search",
    "facebook",
    "instagram",
    "linkedin",
    "youtube",
    "tiktok",
    "pinterest",
  ];
  const rank = (key: string) => {
    const index = priorities.indexOf(key);
    return index < 0 ? priorities.length : index;
  };
  const ordered = sources
    .filter((source) => source.status === "analyzed" && Boolean(source.content))
    .sort((left, right) => rank(left.key) - rank(right.key));
  if (!ordered.length) return [];

  const limit = Math.max(1_500, Math.floor(maxTotalChars));
  const payload = ordered.map((source) => ({
    source: source.key,
    label: source.label,
    content: "",
  }));
  const emptyPayloadLength = JSON.stringify(payload).length;
  let remainingEncodedChars = Math.max(0, limit - emptyPayloadLength);

  const encodedLength = (value: string) => Math.max(0, JSON.stringify(value).length - 2);
  const prefixForEncodedBudget = (value: string, budget: number) => {
    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (encodedLength(value.slice(0, middle)) <= budget) low = middle;
      else high = middle - 1;
    }
    return value.slice(0, low);
  };

  // 60 % du contexte est d'abord partagé équitablement : même avec dix
  // canaux, aucun réseau connecté n'est silencieusement privé d'analyse.
  const fairEncodedShare = Math.floor((remainingEncodedChars * 0.6) / ordered.length);
  for (let index = 0; index < ordered.length; index += 1) {
    const content = prefixForEncodedBudget(ordered[index].content, fairEncodedShare);
    payload[index].content = content;
    remainingEncodedChars -= encodedLength(content);
  }

  // La marge restante va ensuite aux sources les plus probantes, dans
  // l'ordre site officiel > Google Business > profils sociaux.
  for (let index = 0; index < ordered.length && remainingEncodedChars > 0; index += 1) {
    const current = payload[index].content;
    const currentCost = encodedLength(current);
    const expanded = prefixForEncodedBudget(
      ordered[index].content,
      currentCost + remainingEncodedChars,
    );
    const extraCost = Math.max(0, encodedLength(expanded) - currentCost);
    payload[index].content = expanded;
    remainingEncodedChars -= extraCost;
  }

  return payload.filter((source) => source.content);
}
