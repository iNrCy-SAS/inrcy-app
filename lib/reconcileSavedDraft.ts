function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Apply server normalization to unchanged fields while retaining edits made
 * after submission. Arrays and files are atomic; nested JSON fields (notably
 * richText) are reconciled independently so unrelated enrichments survive. */
export function reconcileSavedDraft<T>(submitted: T, current: T, persisted: T): T {
  if (Object.is(current, submitted)) return persisted;
  if (isPlainRecord(submitted) && isPlainRecord(current) && isPlainRecord(persisted)) {
    const result: Record<string, unknown> = { ...persisted };
    for (const key of new Set([...Object.keys(submitted), ...Object.keys(current)])) {
      result[key] = reconcileSavedDraft(submitted[key], current[key], persisted[key]);
    }
    return result as T;
  }
  if (Array.isArray(submitted) && Array.isArray(current) && JSON.stringify(current) === JSON.stringify(submitted)) {
    return persisted;
  }
  return current;
}
