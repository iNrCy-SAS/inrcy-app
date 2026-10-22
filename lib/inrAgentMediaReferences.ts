import { AI_MEDIA_INSPIRATION_MAX_COUNT } from "./aiMediaGenerationContracts.ts";

export const INR_AGENT_MEDIA_REFERENCES_KEY = "mediaGenerationReferences";
export const INR_AGENT_REFERENCE_BUCKET = "inrcy-pro-media";
export const INR_AGENT_REFERENCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type InrAgentMediaReferenceRole = "character" | "environment" | "product";
export type InrAgentMediaReference = {
  id: string;
  name: string;
  role: InrAgentMediaReferenceRole;
  usage: "required" | "inspiration";
};
export type InrAgentMediaReferences = {
  version: 1;
  items: InrAgentMediaReference[];
  authorized: boolean;
  /** Bound to the named automatic video engine, never inferred from image consent. */
  animationProviderConsent?: string | null;
};

export class InrAgentMediaReferenceError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export function emptyInrAgentMediaReferences(): InrAgentMediaReferences {
  return { version: 1, items: [], authorized: false, animationProviderConsent: null };
}

/** No URLs, binary image data, storage paths or client-supplied account IDs survive. */
export function parseInrAgentMediaReferences(value: unknown): InrAgentMediaReferences {
  if (value === undefined || value === null) return emptyInrAgentMediaReferences();
  if (typeof value !== "object" || Array.isArray(value)) throw new InrAgentMediaReferenceError("inr_agent_reference_invalid");
  const source = value as Record<string, unknown>;
  if (source.version !== 1 || !Array.isArray(source.items) || source.items.length > AI_MEDIA_INSPIRATION_MAX_COUNT) {
    throw new InrAgentMediaReferenceError("inr_agent_reference_invalid");
  }
  const ids = new Set<string>();
  const items = source.items.map((candidate): InrAgentMediaReference => {
    const item = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate as Record<string, unknown> : {};
    if (typeof item.id !== "string" || !INR_AGENT_REFERENCE_ID.test(item.id) || ids.has(item.id.toLowerCase()) ||
      !["character", "environment", "product"].includes(String(item.role)) ||
      !["required", "inspiration"].includes(String(item.usage))) {
      throw new InrAgentMediaReferenceError("inr_agent_reference_invalid");
    }
    ids.add(item.id.toLowerCase());
    return { id: item.id.toLowerCase(), name: typeof item.name === "string" ? item.name.replace(/\u0000/g, "").slice(0, 120) : "",
      role: item.role as InrAgentMediaReferenceRole, usage: item.usage as InrAgentMediaReference["usage"] };
  });
  if (items.filter((item) => item.role === "character" && item.usage === "required").length > 3) {
    throw new InrAgentMediaReferenceError("inr_agent_reference_too_many_characters");
  }
  return { version: 1, items, authorized: items.length > 0 && source.authorized === true,
    animationProviderConsent: items.length > 0 && typeof source.animationProviderConsent === "string"
      ? source.animationProviderConsent.slice(0, 40) : null };
}

export function inrAgentReferenceStoragePath(accountId: string, referenceId: string) {
  if (!INR_AGENT_REFERENCE_ID.test(accountId) || !INR_AGENT_REFERENCE_ID.test(referenceId)) {
    throw new InrAgentMediaReferenceError("inr_agent_reference_invalid");
  }
  return `users/${accountId.toLowerCase()}/agent-generation-references/${referenceId.toLowerCase()}.jpg`;
}

export function inrAgentReferencePreviewUrl(referenceId: string) {
  if (!INR_AGENT_REFERENCE_ID.test(referenceId)) return "";
  return `/api/agent/media-references?id=${encodeURIComponent(referenceId)}`;
}

export function inrAgentReferencesSignature(value: InrAgentMediaReferences) {
  return JSON.stringify([value.version, value.items.map(({ id, role, usage }) => [id, role, usage]), value.authorized,
    value.animationProviderConsent || null]);
}

export function blocksInrAgentReferenceFallback(result: { outcome: string; item?: unknown; referencesRequired?: boolean }) {
  return result.outcome === "reference_unavailable" || Boolean(result.referencesRequired && !result.item);
}
