import type { ThreadsPublicationMode, ThreadsPublicationPreferences } from "@/lib/threadsPublicationPreferences";

export function getThreadsPublicationModeIssue(mode: ThreadsPublicationMode, preferences: ThreadsPublicationPreferences, loading: boolean, failed: boolean) {
  if (mode !== "ghost") return null;
  if (loading) return "threads_ghost_preferences_loading" as const;
  if (failed) return "threads_ghost_preferences_error" as const;
  return preferences.ghostEnabled ? null : "threads_ghost_disabled" as const;
}

// Project the current mode without altering the image pool or channel mapping.
export function getEffectiveThreadsMediaMode<T extends "images" | "video" | "none">(channel: string, mode: ThreadsPublicationMode, mediaMode: T): T | "none" {
  return channel === "threads" && mode === "ghost" ? "none" : mediaMode;
}
