type SelectionRecord = Record<string, unknown>;

export type GmbSelectionCandidate = { accountName: unknown; locationName: unknown };
export type GmbSelectionDiscovery = {
  complete: boolean;
  accounts: readonly { name: string }[];
  locations: readonly { name: string; accountName: string; title?: string; mapsUri?: string; addressLabel?: string }[];
};
export type VerifiedGmbSelection = { accountName: string; locationName: string; locationTitle: string | null; url: string };

const record = (value: unknown): SelectionRecord => value && typeof value === "object" && !Array.isArray(value) ? value as SelectionRecord : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const account = (value: unknown) => /^accounts\/[a-zA-Z0-9_-]+$/.test(text(value)) ? text(value) : null;

/** Only the exact saved account and resource can survive a fresh authorization. */
export function resolveVerifiedGmbSelection(candidate: GmbSelectionCandidate, discovery: GmbSelectionDiscovery): VerifiedGmbSelection | null {
  const accountName = account(candidate.accountName);
  const locationName = text(candidate.locationName);
  if (candidate.accountName !== accountName || candidate.locationName !== locationName) return null;
  if (!discovery.complete || !accountName || !/^locations\/[a-zA-Z0-9_-]+$/.test(locationName)) return null;
  if (!discovery.accounts.some(item => item.name === accountName)) return null;
  const selected = discovery.locations.find(item => item.accountName === accountName && item.name === locationName);
  if (!selected) return null;
  const locationTitle = text(selected.title) || null;
  const url = text(selected.mapsUri) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([locationTitle || locationName, selected.addressLabel].filter(Boolean).join(" "))}`;
  return { accountName, locationName, locationTitle, url };
}

const selectionKeys = [
  "location", "locationName", "locationTitle", "location_name", "location_id",
  "resource_id", "resource_label", "selectedLocationName", "selectedLocationId", "selected_location_id",
  "url", "page_url", "mapsUri", "mapsUrl", "account", "accountName", "account_name",
  "gmb_verification",
] as const;

function withoutSelection(value: unknown): SelectionRecord {
  const next = { ...record(value) };
  for (const key of selectionKeys) delete next[key];
  if (Object.hasOwn(next, "gmb")) {
    const nested = { ...record(next.gmb) };
    for (const key of selectionKeys) delete nested[key];
    next.gmb = nested;
  }
  return next;
}

/** Remove legacy aliases too: review/profile readers must not revive a cleared target. */
export function clearGmbSelectionMeta(meta: unknown, accountName: string | null = null): SelectionRecord {
  return { ...withoutSelection(meta), account: account(accountName), url: null };
}

export function clearGmbSelectionSettings(settings: unknown, accountName: string | null = null): SelectionRecord {
  return {
    ...withoutSelection(settings), configured: false, accountName: account(accountName),
    locationName: null, locationTitle: null, resource_id: null, resource_label: null, url: null,
  };
}
