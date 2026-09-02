import type { InrAgentFrequency } from "@/lib/inrAgentSettings";

export type InrAgentMonthlyFrequency = Extract<
  InrAgentFrequency,
  "monthly" | "biweekly" | "three_times_monthly"
>;

const DEFAULT_MONTH_DAYS: Record<1 | 2 | 3, number[]> = {
  1: [10],
  2: [10, 20],
  3: [10, 20, 30],
};

export function inrAgentMonthlyDateCount(frequency: unknown): 0 | 1 | 2 | 3 {
  const value = String(frequency || "")
    .trim()
    .toLowerCase();
  if (value === "three_times_monthly" || value === "3 fois par mois") return 3;
  if (
    value === "biweekly" ||
    value === "2 fois par mois" ||
    value === "tous les 15 jours"
  )
    return 2;
  if (
    value === "monthly" ||
    value === "1 fois par mois" ||
    value === "chaque mois"
  )
    return 1;
  return 0;
}

export function normalizeInrAgentMonthDays(
  value: unknown,
  frequency: unknown,
): number[] {
  const count = inrAgentMonthlyDateCount(frequency);
  if (!count) return [];

  const raw = Array.isArray(value) ? value : [];
  const normalized = raw
    .map((day) => Math.min(31, Math.max(1, Math.floor(Number(day)) || 0)))
    .filter(
      (day, index, list) =>
        day >= 1 && list.findIndex((candidate) => candidate === day) === index,
    )
    .slice(0, count);

  for (const fallback of DEFAULT_MONTH_DAYS[count]) {
    if (normalized.length >= count) break;
    if (!normalized.includes(fallback)) normalized.push(fallback);
  }
  for (let day = 1; normalized.length < count && day <= 31; day += 1) {
    if (!normalized.includes(day)) normalized.push(day);
  }

  return normalized.slice(0, count).sort((a, b) => a - b);
}

export function effectiveInrAgentMonthDays(
  year: number,
  month: number,
  monthDays: readonly number[],
) {
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return Array.from(
    new Set(monthDays.map((day) => Math.min(lastDay, Math.max(1, day)))),
  ).sort((a, b) => a - b);
}

export function isInrAgentScheduledMonthDay(
  local: { year: number; month: number; day: number },
  monthDays: readonly number[],
) {
  return effectiveInrAgentMonthDays(local.year, local.month, monthDays).includes(
    local.day,
  );
}

export function inrAgentMonthlyOccurrenceIndex(
  local: { year: number; month: number; day: number },
  monthDays: readonly number[],
) {
  const effectiveDays = effectiveInrAgentMonthDays(
    local.year,
    local.month,
    monthDays,
  );
  const exact = effectiveDays.indexOf(local.day);
  if (exact >= 0) return exact;
  const next = effectiveDays.findIndex((day) => day > local.day);
  return next < 0 ? Math.max(0, effectiveDays.length - 1) : Math.max(0, next - 1);
}
