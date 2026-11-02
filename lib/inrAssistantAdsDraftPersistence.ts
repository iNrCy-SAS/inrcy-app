import { parseAdsCampaignInput, type AdsCampaignInput } from "./adsValidation.ts";
import { adsDraftContentKey, adsDraftBaselineHash } from "./adsDraftVersion.ts";
export { adsDraftContentKey, adsDraftBaselineKey } from "./adsDraftVersion.ts";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Only native draft endpoints. Never publish, prepare remote resources or retry
 * an uncertain write automatically. A saved ID alone is insufficient evidence. */
export async function persistVerifiedAdsDraft(options: { draft: AdsCampaignInput; savedId: string | null; baselineKey?: string | null; idempotencyKey: string; isCurrent: () => boolean; fetch?: typeof fetch }) {
  const parsed = parseAdsCampaignInput(options.draft, { purpose: "draft" });
  if (!parsed.draft) throw new Error(parsed.error || "Vérifiez le brouillon publicitaire.");
  const draft = parsed.draft;
  if (options.savedId && !options.baselineKey) throw new Error("Rouvrez le brouillon enregistré pour vérifier sa version avant de le modifier.");
  const expectedDraftHash = options.savedId ? await adsDraftBaselineHash(options.baselineKey!) : undefined;
  const request = async (url: string, init?: RequestInit) => {
    if (!options.isCurrent()) throw new Error("La campagne ou le compte actif a changé.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await (options.fetch ?? fetch)(url, { ...init, signal: controller.signal, cache: "no-store" });
      const body: unknown = await response.json();
      if (!options.isCurrent()) throw new Error("La campagne ou le compte actif a changé. Vérifiez le brouillon enregistré avant de recommencer.");
      if (!response.ok) throw new Error(typeof object(body).error === "string" ? String(object(body).error) : "Le brouillon n’a pas pu être vérifié.");
      return object(body);
    } finally { clearTimeout(timer); }
  };
  const saved = object((await request("/api/ads/campaigns", { method: "POST", headers: { "Content-Type": "application/json", ...(!options.savedId ? { "Idempotency-Key": options.idempotencyKey } : {}) }, body: JSON.stringify({ ...draft, ...(options.savedId ? { id: options.savedId, expectedDraftHash } : {}) }) })).campaign);
  if (typeof saved.id !== "string" || !UUID.test(saved.id) || saved.status !== "draft" || options.savedId && saved.id !== options.savedId) throw new Error("L’enregistrement du brouillon exact n’a pas été confirmé.");
  const confirmed = object((await request(`/api/ads/campaigns/${saved.id}`, { method: "GET" })).campaign);
  const verified = parseAdsCampaignInput(confirmed.draft, { purpose: "draft" });
  if (confirmed.id !== saved.id || confirmed.status !== "draft" || confirmed.provider !== draft.provider || confirmed.published_at || !verified.draft || adsDraftContentKey(verified.draft) !== adsDraftContentKey(draft)) throw new Error("Le contenu enregistré ne correspond plus à ce brouillon. Vérifiez le suivi avant de recommencer.");
  return { id: saved.id, draft: verified.draft };
}
