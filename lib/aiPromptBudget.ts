type PromptPayloadValue = string | string[] | PromptPayloadRecord;

type PromptPayloadRecord = {
  [key: string]: PromptPayloadValue;
};

function compactPromptPayloadRecord(value: PromptPayloadRecord): PromptPayloadRecord {
  const result: PromptPayloadRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      if (item) result[key] = item;
      continue;
    }
    if (Array.isArray(item)) {
      const entries = item.filter(Boolean);
      if (entries.length) result[key] = entries;
      continue;
    }
    const nested = compactPromptPayloadRecord(item);
    if (Object.keys(nested).length) result[key] = nested;
  }
  return result;
}

function scalePromptPayloadRecord(
  value: PromptPayloadRecord,
  scale: number,
): PromptPayloadRecord {
  const result: PromptPayloadRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      const minimum = Math.min(item.length, 32);
      const length = Math.min(
        item.length,
        Math.max(minimum, Math.floor(item.length * scale)),
      );
      if (length > 0) result[key] = item.slice(0, length).trimEnd();
      continue;
    }
    if (Array.isArray(item)) {
      const itemCount = scale > 0
        ? Math.max(1, Math.floor(item.length * scale))
        : 0;
      if (itemCount <= 0) continue;
      const entries = item
        .slice(0, itemCount)
        .map((entry) => {
          const length = Math.min(
            entry.length,
            Math.max(Math.min(entry.length, 32), Math.floor(entry.length * scale)),
          );
          return entry.slice(0, length).trimEnd();
        })
        .filter(Boolean);
      if (entries.length) result[key] = entries;
      continue;
    }
    const nested = scalePromptPayloadRecord(item, scale);
    if (Object.keys(nested).length) result[key] = nested;
  }
  return result;
}

/**
 * Réduit proportionnellement un payload de contexte avant sa sérialisation.
 * La mesure porte sur le JSON réellement envoyé (échappements compris), ce qui
 * évite qu'un ADN riche en guillemets ou retours à la ligne contourne le budget.
 */
export function fitPromptPayloadToJsonBudget<T extends PromptPayloadRecord>(
  value: T,
  maxChars: number,
): T {
  const compact = compactPromptPayloadRecord(value);
  const limit = Math.max(2, Math.floor(maxChars));
  if (JSON.stringify(compact).length <= limit) return compact as T;

  let low = 0;
  let high = 1;
  let best: PromptPayloadRecord = {};
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (low + high) / 2;
    const candidate = scalePromptPayloadRecord(compact, middle);
    if (JSON.stringify(candidate).length <= limit) {
      best = candidate;
      low = middle;
    } else {
      high = middle;
    }
  }

  return best as T;
}
