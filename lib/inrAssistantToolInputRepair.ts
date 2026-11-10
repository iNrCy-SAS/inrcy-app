import { AI_MEDIA_IMAGE_MODELS } from "./aiMediaModelCatalog.ts";
import { preparedAdsCalendarInstant } from "./adsPreparedCampaignSettings.ts";

type Call = { toolName: string; input: string };
type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const imageCatalogueKey = (value: string) => normalize(value).replace(/[\s._-]+/g, "");

/** One bounded syntactic repair, without a model request or any authority change.
 * The SDK must validate again, and the unchanged native executor checks consent,
 * ownership, current instructions, credits and idempotency. Never drops keys. */
export function repairInrAssistantToolInput<T extends Call>(call: T): T | null {
  if (!["generateMedia", "quoteMediaGeneration", "manageCrmContact", "prepareStudioPrompt", "runScreenCommand", "dispatchCampaignDraft"].includes(call.toolName) || typeof call.input !== "string" || call.input.length > 30_000) return null;
  let input: unknown;
  try { input = JSON.parse(call.input); } catch { return null; }
  if (!row(input)) return null;
  let changed = false;
  if (call.toolName === "runScreenCommand") {
    // Decode the envelope only. A field name, percentage, target, quote or
    // consent is never inferred: the real mounted schema validates it again.
    if (typeof input.patch === "string" && input.patch.length <= 18_000) {
      try { const patch: unknown = JSON.parse(input.patch); if (row(patch)) { input.patch = patch; changed = true; } } catch { /* Keep malformed input rejected. */ }
    }
  } else if (call.toolName === "dispatchCampaignDraft") {
    if (input.mode !== "schedule" || typeof input.timezone !== "string" || /^[+-]/.test(input.timezone) || typeof input.scheduledAt !== "string") return null;
    const local = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(input.scheduledAt);
    if (!local) return null;
    const minute = preparedAdsCalendarInstant(local[1], input.timezone);
    if (!minute) return null;
    input.scheduledAt = new Date(Date.parse(minute) + Number(local[2] ?? 0) * 1000 + Number((local[3] ?? "").padEnd(3, "0"))).toISOString();
    changed = true;
  } else if (call.toolName === "prepareStudioPrompt") {
    // Only canonical integer spelling in the native video range. In
    // particular, portrait/4:5 must not become story without user context.
    if (input.mediaType === "video" && typeof input.durationSeconds === "string" && /^(?:[4-9]|[12]\d|30)$/.test(input.durationSeconds)) {
      input.durationSeconds = Number(input.durationSeconds); changed = true;
    }
  } else if (call.toolName === "manageCrmContact") {
    if (input.action === "create" && input.contactId === "") { input.contactId = null; changed = true; }
    if (row(input.fields)) for (const [field, allowed] of Object.entries({ contactType: ["client", "prospect", "fournisseur", "partenaire", "autre"], category: ["particulier", "professionnel", "collectivite_publique"] })) {
      const value = input.fields[field];
      if (typeof value === "string" && allowed.includes(value.toLowerCase()) && value !== value.toLowerCase()) { input.fields[field] = value.toLowerCase(); changed = true; }
    }
  } else {
    if (input.mediaType === "image" && (input.durationSeconds === "None" || input.durationSeconds === "null" || input.durationSeconds === "")) { input.durationSeconds = null; changed = true; }
    if (call.toolName === "quoteMediaGeneration" && input.resultMode === "") { input.resultMode = null; changed = true; }
    if (typeof input.settings === "string" && input.settings.length <= 12_000) {
      try { const parsed: unknown = JSON.parse(input.settings); if (parsed === null || Array.isArray(parsed)) { input.settings = parsed; changed = true; } } catch { /* The native validator retains an invalid value. */ }
    }
    if (Array.isArray(input.settings)) for (const setting of input.settings) {
      if (!row(setting) || setting.field !== "imageEngine" || typeof setting.valueJson !== "string" || setting.valueJson.length > 200) continue;
      let value: unknown = setting.valueJson;
      // Only a known, finite image engine can be decoded a second time. Never
      // interprets a prompt, a reference, a consent flag or arbitrary field data.
      for (let depth = 0; depth < 2 && typeof value === "string"; depth++) { try { value = JSON.parse(value); } catch { break; } }
      if (typeof value !== "string") continue;
      // Separator spelling may identify exactly one current ID/label. Never
      // approximate an unknown name, nor choose among ambiguous catalogue keys.
      const matches = AI_MEDIA_IMAGE_MODELS.filter(model => imageCatalogueKey(model.id) === imageCatalogueKey(value as string) || imageCatalogueKey(model.label) === imageCatalogueKey(value as string));
      const engine = matches.length === 1 ? matches[0] : undefined;
      if (engine && setting.valueJson !== JSON.stringify(engine.id)) { setting.valueJson = JSON.stringify(engine.id); changed = true; }
    }
  }
  try { return changed ? { ...call, input: JSON.stringify(input) } : null; }
  catch { return null; }
}
