import type { NativeChannelKey, NativeChannelMissingField, NativeChannelStates } from "@/lib/nativeChannelActivation";

const keys: NativeChannelKey[] = ["inrbadge", "inr_search", "inr_directory"];
const fields: NativeChannelMissingField[] = ["company", "contact", "profession", "city", "postalCode"];
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function normalizeNativeChannelStates(value: unknown): NativeChannelStates | null {
  const source = record(value);
  const states: Partial<NativeChannelStates> = {};
  for (const key of keys) {
    const node = record(source[key]);
    if (!["requested", "ready", "published", "pending", "allowed"].every(field => typeof node[field] === "boolean") || !Array.isArray(node.missingFields)) return null;
    if (!node.missingFields.every(field => fields.includes(field))) return null;
    // A malformed public flag must never expose the public actions.
    const published = node.allowed === true && node.requested === true && node.ready === true && node.published === true;
    states[key] = { requested: node.requested === true, ready: node.ready === true, published, pending: node.allowed === true && node.requested === true && !published, allowed: node.allowed === true, missingFields: node.missingFields };
  }
  return states as NativeChannelStates;
}

export type NativeChannelSnapshot = {
  accountId: string; states: NativeChannelStates; companyName: string; badgeUrl: string; searchSlug: string;
};

export function readNativeChannelSnapshot(value: unknown, accountId: string | null): NativeChannelSnapshot | null {
  const source = record(value);
  const states = normalizeNativeChannelStates(source.states);
  if (!accountId || source.ok !== true || source.accountId !== accountId || !states) return null;
  return { accountId, states, companyName: typeof source.companyName === "string" ? source.companyName : "", badgeUrl: states.inrbadge.published && typeof source.badgeUrl === "string" ? source.badgeUrl : "", searchSlug: typeof source.searchSlug === "string" ? source.searchSlug : "" };
}

