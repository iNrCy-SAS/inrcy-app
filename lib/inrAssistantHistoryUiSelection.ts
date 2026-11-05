type Row = Record<string, unknown>;
const object = (value: string | null): Row | null => {
  if (typeof value !== "string" || value.length > 1200) return null;
  try { const result: unknown = JSON.parse(value); return result && typeof result === "object" && !Array.isArray(result) ? result as Row : null; } catch { return null; }
};
const keys = (row: Row, fields: string[]) => Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field));
export type InrAssistantPlanningDaySelection = { day: string; direction: -1 | 1 };
export function parseInrAssistantPlanningDaySelection(value: string | null): InrAssistantPlanningDaySelection | null {
  const row = object(value);
  return row && keys(row, ["day", "direction"]) && typeof row.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && (row.direction === -1 || row.direction === 1)
    ? { day: row.day, direction: row.direction } : null;
}
export type InrAssistantPlanningFilterSelection = { filter: "publications" | "stats" | "campaigns"; enabled: boolean };
export function parseInrAssistantPlanningFilterSelection(value: string | null): InrAssistantPlanningFilterSelection | null {
  const row = object(value);
  return row && keys(row, ["filter", "enabled"]) && ["publications", "stats", "campaigns"].includes(String(row.filter)) && typeof row.enabled === "boolean"
    ? { filter: row.filter as InrAssistantPlanningFilterSelection["filter"], enabled: row.enabled } : null;
}
export type InrAssistantSendHistorySelection = { field: "boxView"; value: "sent" | "drafts" } | { field: "page"; value: number | "previous" | "next" } | { field: "item"; value: string };
export function parseInrAssistantSendHistorySelection(value: string | null): InrAssistantSendHistorySelection | null {
  const row = object(value);
  if (!row || !keys(row, ["field", "value"])) return null;
  if (row.field === "boxView" && (row.value === "sent" || row.value === "drafts")) return { field: row.field, value: row.value };
  if (row.field === "page" && Number.isInteger(row.value) && Number(row.value) >= 1 && Number(row.value) <= 100) return { field: row.field, value: Number(row.value) };
  if (row.field === "page" && (row.value === "previous" || row.value === "next")) return { field: row.field, value: row.value };
  if (row.field === "item" && typeof row.value === "string" && /^(?:inr-agent-(?:action|scheduled):)?[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.value)) return { field: row.field, value: row.value };
  return null;
}
export function parseInrAssistantPlanningItemSelection(value: string | null): { id: string; action: "open_content" | "actions" | "channels"; open: boolean | null } | null {
  if (typeof value !== "string" || value.length > 300) return null;
  let input: unknown; try { input = JSON.parse(value); } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || typeof row.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.id)
    || !["open_content", "actions", "channels"].includes(String(row.action)) || (row.action === "open_content" ? row.open !== null : typeof row.open !== "boolean")) return null;
  return { id: row.id, action: row.action as "open_content" | "actions" | "channels", open: row.open as boolean | null };
}
