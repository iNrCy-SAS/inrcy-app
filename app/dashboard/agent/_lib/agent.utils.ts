
export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function toggleItem<T extends string>(items: T[], item: T) {
  return items.includes(item)
    ? items.filter((current) => current !== item)
    : [...items, item];
}

export function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function firstSafeString(...values: unknown[]): string {
  for (const value of values) {
    const candidate = safeString(value);
    if (candidate) return candidate;
  }
  return "";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isInrAgentEditorialPreparationRunning(
  action:
    | {
        status?: unknown;
        payload?: Record<string, unknown> | null;
      }
    | null
    | undefined,
) {
  return Boolean(
    action?.status === "executing" &&
      asRecord(action.payload?.editorialPlan),
  );
}

export function jsonClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}
