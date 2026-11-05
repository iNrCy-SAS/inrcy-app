/** Finite browser-only form values. No selector, URL or callback name. */
export function parseInrAssistantShellSelection(value: string | null): { field: string; value: string } | null {
  if (typeof value !== "string" || value.length > 13000) return null;
  try {
    const row: unknown = JSON.parse(value);
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const item = row as Record<string, unknown>;
    if (Object.keys(item).length !== 2 || typeof item.field !== "string" || typeof item.value !== "string") return null;
    return { field: item.field, value: item.value };
  } catch { return null; }
}
