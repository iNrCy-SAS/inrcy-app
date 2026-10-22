import "server-only";
import { AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS, type AiMediaInspirationImage } from "./aiMediaGenerationContracts.ts";
import {
  INR_AGENT_MEDIA_REFERENCES_KEY, INR_AGENT_REFERENCE_BUCKET, InrAgentMediaReferenceError,
  inrAgentReferenceStoragePath, parseInrAgentMediaReferences, type InrAgentMediaReferences,
} from "./inrAgentMediaReferences.ts";

type StorageClient = {
  storage: { from: (bucket: string) => { download: (path: string) => Promise<{
    data: Blob | null; error: unknown;
  }> } };
};
type ReferenceClient = StorageClient & {
  from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => {
    eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{
      data: { metadata?: Record<string, unknown> | null } | null; error: unknown;
    }> };
  } } };
};

export async function downloadInrAgentReferences(args: {
  supabase: StorageClient; accountId: string; references: InrAgentMediaReferences;
}): Promise<AiMediaInspirationImage[]> {
  let characterIndex = 0;
  const indexed = args.references.items.map((item) => ({ ...item,
    characterIndex: item.role === "character" && item.usage === "required" ? ++characterIndex as 1 | 2 | 3 : undefined }));
  return Promise.all(indexed.map(async (item) => {
    const response = await args.supabase.storage.from(INR_AGENT_REFERENCE_BUCKET)
      .download(inrAgentReferenceStoragePath(args.accountId, item.id));
    if (response.error || !response.data || !response.data.size || response.data.size > AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS * 3 / 4) {
      throw new InrAgentMediaReferenceError("inr_agent_reference_unavailable");
    }
    const data = Buffer.from(await response.data.arrayBuffer());
    if (data.length < 48 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
      throw new InrAgentMediaReferenceError("inr_agent_reference_unavailable");
    }
    return { mimeType: "image/jpeg" as const, data: data.toString("base64"), name: item.name,
      role: item.role, usage: item.usage, ...(item.characterIndex ? { characterIndex: item.characterIndex } : {}) };
  }));
}

export async function loadInrAgentMediaReferences(args: { supabase: unknown; accountId: string }) {
  const supabase = args.supabase as ReferenceClient;
  const { data, error } = await supabase.from("inr_agent_automation_settings").select("metadata")
    .eq("user_id", args.accountId).eq("automation_key", "publish").maybeSingle();
  // A failed read must never silently launch an unreferenced generation.
  if (error) throw new InrAgentMediaReferenceError("inr_agent_reference_settings_unavailable");
  const references = parseInrAgentMediaReferences(data?.metadata?.[INR_AGENT_MEDIA_REFERENCES_KEY]);
  if (references.items.length && !references.authorized) {
    throw new InrAgentMediaReferenceError("inr_agent_reference_authorization_required");
  }
  const images = await downloadInrAgentReferences({ supabase, accountId: args.accountId, references });
  return { references, images };
}
