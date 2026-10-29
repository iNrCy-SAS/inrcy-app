import { isInrDirectoryEnabled } from "./inrDirectorySettings.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function withMissingDefaults(value: unknown, defaults: Record<string, unknown>) {
  const previous = record(value);
  if (Object.keys(defaults).every((key) => Object.hasOwn(previous, key))) return previous;
  return { ...defaults, ...previous };
}

/**
 * Called only by NEW-account provisioning, including an interrupted signup's
 * recovery. Missing flags are explicit opt-outs; existing choices and older
 * published pages are never converted into the newer readiness contract.
 */
export function withNewAccountNativeChannelDefaults(value: unknown): Record<string, unknown> {
  if (value != null && (typeof value !== "object" || Array.isArray(value))) {
    throw new Error("INRCY_NATIVE_CHANNEL_DEFAULTS_INVALID_SETTINGS");
  }
  const root = record(value);
  const badge = record(root.inrBadge);
  const search = record(root.inrSearch);
  const directory = record(root.inrDirectory);
  const legacySearchPublished = search.activationVersion !== 1 && search.enabled === true
    && typeof search.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/iu.test(search.slug) && search.slug.length <= 120;
  // Capture this before supplying Search defaults: old accounts inherited the
  // directory opt-in from their public Search page unless explicitly disabled.
  const legacyDirectoryIncluded = directory.activationVersion !== 1 && isInrDirectoryEnabled(root);
  const legacyBadgeRequested = badge.activationVersion !== 1
    && (badge.enabled === true || (badge.enabled === undefined && legacySearchPublished));
  const nextBadge = legacyBadgeRequested ? badge : withMissingDefaults(root.inrBadge, { enabled: false, activationVersion: 1 });
  const nextDirectory = legacyDirectoryIncluded ? directory : withMissingDefaults(root.inrDirectory, { enabled: false, activationVersion: 1 });
  const nextSearch = legacySearchPublished ? search : withMissingDefaults(root.inrSearch, {
    enabled: false, activationRequested: false, activationVersion: 1,
  });
  const next = { ...root };
  let changed = false;
  if (nextBadge !== badge) { next.inrBadge = nextBadge; changed = true; }
  if (nextDirectory !== directory) { next.inrDirectory = nextDirectory; changed = true; }
  if (nextSearch !== search) { next.inrSearch = nextSearch; changed = true; }
  return changed ? next : root;
}
