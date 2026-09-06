export const BUSINESS_DNA_RECENT_NEWS_DAYS = 30;

export type BusinessDnaRecentWindow = {
  start: string;
  end: string;
};

export function buildBusinessDnaRecentWindow(
  now: Date = new Date(),
): BusinessDnaRecentWindow {
  const endTimestamp = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const startTimestamp =
    endTimestamp - BUSINESS_DNA_RECENT_NEWS_DAYS * 24 * 60 * 60 * 1_000;
  return {
    start: new Date(startTimestamp).toISOString(),
    end: new Date(endTimestamp).toISOString(),
  };
}

export function businessDnaPublicationTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 10_000_000_000 ? numeric : numeric * 1_000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isBusinessDnaPublicationInWindow(
  value: unknown,
  window: BusinessDnaRecentWindow,
) {
  const timestamp = businessDnaPublicationTimestamp(value);
  if (timestamp === null) return false;
  return timestamp >= Date.parse(window.start) && timestamp <= Date.parse(window.end);
}
