function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Preserve the previous opt-in until the professional edits the new channel. */
export function isInrDirectoryEnabled(settings: unknown): boolean {
  const root = record(settings);
  const directory = record(root.inrDirectory);
  if (typeof directory.enabled === "boolean") return directory.enabled;
  const legacy = record(root.inrSearch);
  return legacy.enabled === true && Boolean(legacy.slug)
    && (typeof legacy.directoryEnabled === "boolean" ? legacy.directoryEnabled : true);
}

export function getInrDirectoryUrl() {
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return `${window.location.origin}/annuaire`;
  }
  return "https://inrcy.com/annuaire/";
}
