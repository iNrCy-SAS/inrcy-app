import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runTransientPostgrestRead } from "./supabaseTransientRetry.ts";

/** Inspect only the same account, kind and frozen request before any retry. */
export async function getInrAgentPreviousMediaJob(accountId: string, requestKey: string, kind: "image" | "video" = "video") {
  const { data, error } = await runTransientPostgrestRead<{ id: string; status: string; error_code: string | null; request_fingerprint: string }>(() => supabaseAdmin
    .from("ai_media_generation_jobs").select("id,status,error_code,request_fingerprint")
    .eq("account_id", accountId).eq("request_key", requestKey).eq("media_kind", kind).maybeSingle());
  if (error) throw new Error("inr_agent_previous_job_read_unavailable", { cause: error });
  return data ? { id: String(data.id), status: String(data.status), errorCode: data.error_code ? String(data.error_code) : null, requestFingerprint: String(data.request_fingerprint) } : null;
}
