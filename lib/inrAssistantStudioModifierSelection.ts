import { AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS } from "./aiMediaGenerationContracts.ts";
export type InrAssistantStudioModifierSelection = { field: "instruction" | "sourceMediaId"; value: string } | { action: "clear_source" | "edit_instruction" };
export function parseInrAssistantStudioModifierSelection(value: string | null): InrAssistantStudioModifierSelection | null {
  if (!value || value.length > 8000) return null;
  if (value === "clear_source" || value === "edit_instruction") return { action: value };
  let input: unknown; try { input = JSON.parse(value); } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== 2 || typeof row.value !== "string") return null;
  if (row.field === "instruction" && row.value.length <= AI_MEDIA_MODIFICATION_INSTRUCTION_MAX_CHARS) return { field: row.field, value: row.value };
  return row.field === "sourceMediaId" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.value) ? { field: row.field, value: row.value } : null;
}
