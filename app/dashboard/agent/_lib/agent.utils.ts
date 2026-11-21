
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
      asRecord(action.payload?.editorialPlan) &&
      safeString(asRecord(action.payload?.editorialPlan)?.state).toLowerCase() !== "ready",
  );
}

export function inrAgentEditorialPreparationState(
  action:
    | {
        automationKey?: unknown;
        actionType?: unknown;
        status?: unknown;
        lastError?: unknown;
        executionPolicy?: unknown;
        validationRequired?: unknown;
        payload?: Record<string, unknown> | null;
      }
    | null
    | undefined,
): "queued" | "generating" | "retry" | "scheduling_retry" | "failed" | null {
  if (action?.automationKey !== "publish" || action.actionType !== "publication") return null;
  if (action.status === "prepared" && action.executionPolicy === "automatic_after_settings"
    && action.validationRequired === false && safeString(action.lastError)) return "scheduling_retry";
  const editorialPlan = asRecord(action.payload?.editorialPlan);
  if (!editorialPlan) return null;
  if (action.status === "failed") return "failed";
  if (safeString(editorialPlan.state).toLowerCase() === "ready") return null;
  if (action.status === "executing") return "generating";
  if (action.status !== "draft") return null;
  // Retries keep the draft status; the public action already carries their error.
  return safeString(action.lastError) ? "retry" : "queued";
}

export function isInrAgentEditorialPreparationWaitingForCron(
  action:
    | {
        automationKey?: unknown;
        actionType?: unknown;
        status?: unknown;
        payload?: Record<string, unknown> | null;
      }
    | null
    | undefined,
) {
  if (
    action?.automationKey !== "publish" ||
    action.actionType !== "publication" ||
    action.status !== "draft"
  ) {
    return false;
  }

  const editorialPlan = asRecord(action.payload?.editorialPlan);
  const editorialState = safeString(editorialPlan?.state).toLowerCase();
  return ["draft", "queued", "retry"].includes(editorialState);
}

export function jsonClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}
