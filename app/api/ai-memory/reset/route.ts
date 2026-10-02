import { NextResponse } from "next/server";

import {
  EMPTY_AI_MEMORY,
  normalizeAiMemory,
  type AiMemory,
  type AiMemoryReferenceDocument,
} from "@/lib/aiMemory";
import { invalidateBoosterGenerationContext } from "@/lib/boosterGenerationContext";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const RESETTABLE_TABS = new Set([
  "analysis",
  "documents",
  "profile",
  "activity",
  "audience",
  "local",
  "identity",
  "news",
  "strategy",
  "all",
]);
const DOCUMENT_BUCKETS = new Set(["inrcy-ai-documents", "inrcy-pro-media"]);

function ownedDocumentPath(accountId: string, path: string) {
  return path.startsWith(`users/${accountId}/ai-memory-documents/`) &&
    !path.includes("..") && !/[\u0000-\u001f]/.test(path);
}

function resetMemoryForTab(memory: AiMemory, tab: string): AiMemory {
  switch (tab) {
    case "activity":
      return normalizeAiMemory({
        ...memory,
        detailedDescription: "",
        specialties: [],
        richText: { ...memory.richText, detailedDescription: "" },
      }, { includePremium: true });
    case "audience":
      return normalizeAiMemory({ ...memory, targetAudiences: [], customerNeeds: [] }, { includePremium: true });
    case "identity":
      return normalizeAiMemory({
        ...memory,
        mission: "",
        differentiators: [],
        values: [],
        brandPersonality: [],
        commitments: [],
        preferredVocabulary: [],
        forbiddenVocabulary: [],
      }, { includePremium: true });
    case "news":
      return normalizeAiMemory({
        ...memory,
        recentNewsItems: [],
        recentNewsUpdatedAt: "",
        recentNewsWindowStart: "",
        recentNewsWindowEnd: "",
        recentNewsSourceKeys: [],
      }, { includePremium: true });
    case "strategy":
      return normalizeAiMemory({
        ...memory,
        offersAndArguments: "",
        keyArguments: "",
        proofsAndObjections: "",
        objectionResponses: "",
        editorialStrategy: "",
        campaignCalendar: "",
        richText: {
          ...memory.richText,
          offersAndArguments: "",
          proofsAndObjections: "",
          editorialStrategy: "",
        },
      }, { includePremium: true });
    default:
      return memory;
  }
}

async function removeReferenceDocuments(accountId: string, documents: AiMemoryReferenceDocument[]) {
  let latestMemory: AiMemory | null = null;
  for (const document of documents) {
    // Never trust a client-supplied path: it must be a stored document owned by
    // the active account before either its JSON record or Storage object moves.
    if (!DOCUMENT_BUCKETS.has(document.bucket) || !ownedDocumentPath(accountId, document.path)) {
      throw new Error("Document de référence non autorisé.");
    }
    const { data, error } = await supabaseAdmin.rpc(
      "inrcy_remove_ai_memory_reference_document",
      { p_account_id: accountId, p_document_id: document.id },
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.result_status !== "removed") {
      throw new Error("Le document n’a pas pu être supprimé.");
    }
    latestMemory = normalizeAiMemory(row.result_memory, { includePremium: true });
    const removed = row.result_document as { bucket?: unknown; path?: unknown } | null;
    const bucket = String(removed?.bucket || "");
    const path = String(removed?.path || "");
    if (!DOCUMENT_BUCKETS.has(bucket) || !ownedDocumentPath(accountId, path)) {
      throw new Error("Référence de stockage non autorisée.");
    }
    const { error: storageError } = await supabaseAdmin.storage.from(bucket).remove([path]);
    if (storageError) console.warn("[ai-memory/reset] orphan document cleanup deferred", { accountId, path });
  }
  return latestMemory;
}

export async function POST(request: Request) {
  const { supabase, activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const tab = String(body?.tab || "");
  if (!RESETTABLE_TABS.has(tab)) {
    return NextResponse.json({ error: "Onglet iNrADN invalide." }, { status: 400 });
  }

  try {
    const { data: memoryRow, error: memoryError } = await supabase
      .from("business_ai_memories")
      .select("memory")
      .eq("account_id", activeUserId)
      .maybeSingle();
    if (memoryError) throw memoryError;

    let memory = normalizeAiMemory(memoryRow?.memory, { includePremium: true });
    if (tab === "documents" || tab === "all") {
      memory = (await removeReferenceDocuments(activeUserId, memory.referenceDocuments)) || memory;
    }
    if (tab === "all") {
      memory = EMPTY_AI_MEMORY;
      const { error } = await supabase
        .from("business_ai_memories")
        .upsert(
          { account_id: activeUserId, schema_version: 1, memory },
          { onConflict: "account_id" },
        );
      if (error) throw error;
    } else if (tab !== "documents") {
      memory = resetMemoryForTab(memory, tab);
      if (tab !== "analysis" && tab !== "profile") {
        const { error } = await supabase
          .from("business_ai_memories")
          .upsert(
            { account_id: activeUserId, schema_version: 1, memory },
            { onConflict: "account_id" },
          );
        if (error) throw error;
      }
    } else if (!memoryRow) {
      // Documents may be reset before the account has ever saved DNA data.
      // Persist the empty, account-owned row instead of returning a no-op.
      const { error } = await supabase
        .from("business_ai_memories")
        .upsert(
          { account_id: activeUserId, schema_version: 1, memory },
          { onConflict: "account_id" },
        );
      if (error) throw error;
    }

    if (tab === "profile" || tab === "all") {
      const { error } = await supabase
        .from("profiles")
        .update({
          contact_email: null,
          first_name: null,
          last_name: null,
          phone: null,
          company_legal_name: null,
          hq_zip: null,
          hq_city: null,
          logo_path: null,
          logo_url: null,
        })
        .eq("user_id", activeUserId);
      if (error) throw error;
    }

    if (tab === "activity" || tab === "all") {
      const { error } = await supabase
        .from("business_profiles")
        .update({ sector: null, business_description: "", services: [] })
        .eq("user_id", activeUserId);
      if (error) throw error;
    }
    if (tab === "audience" || tab === "all") {
      const { error } = await supabase
        .from("business_profiles")
        .update({ customer_typologies: [] })
        .eq("user_id", activeUserId);
      if (error) throw error;
    }
    if (tab === "local" || tab === "all") {
      const { error } = await supabase
        .from("business_profiles")
        .update({ intervention_zones: [], opening_days: "", opening_hours: "" })
        .eq("user_id", activeUserId);
      if (error) throw error;
    }
    if (tab === "identity" || tab === "all") {
      const { error } = await supabase
        .from("business_profiles")
        .update({ strengths: [] })
        .eq("user_id", activeUserId);
      if (error) throw error;
    }

    await invalidateBoosterGenerationContext(activeUserId, "professional");
    return NextResponse.json({ ok: true, tab, memory }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[ai-memory/reset] failed", { accountId: activeUserId, tab, message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "La réinitialisation a échoué. Réessayez dans un instant." }, { status: 500 });
  }
}
