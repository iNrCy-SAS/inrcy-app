import "server-only";
import { getThreadsPublicationModeFailure, normalizeThreadsPublicationPreferences, type ThreadsPublicationMode, type ThreadsPublicationPreferences } from "./threadsPublicationPreferences";

export async function loadThreadsPublicationPreferences(
  supabase: { from: (...args: any[]) => any }, accountId: string,
): Promise<ThreadsPublicationPreferences> {
  const { data, error } = await supabase.from("pro_tools_configs").select("settings").eq("user_id", accountId).maybeSingle();
  if (error) throw Object.assign(new Error("Les formats de publication Threads ne peuvent pas être vérifiés pour le moment."), {
    code: "threads_publication_preferences_unavailable",
  });
  return normalizeThreadsPublicationPreferences(data?.settings?.threads?.publicationPreferences);
}

export async function getThreadsPublicationPreflightFailure(args: {
  supabase: { from: (...args: any[]) => any }; accountId: string;
  mode: ThreadsPublicationMode; hasMedia: boolean;
}): Promise<{ code: string; error: string; retryable: boolean } | null> {
  if (args.mode === "classic") return null;
  try {
    const preferences = await loadThreadsPublicationPreferences(args.supabase, args.accountId);
    return getThreadsPublicationModeFailure({ mode: args.mode, preferences, hasMedia: args.hasMedia });
  } catch {
    return { code: "threads_publication_preferences_unavailable", retryable: true,
      error: "Les formats de publication Threads ne peuvent pas être vérifiés pour le moment." };
  }
}
