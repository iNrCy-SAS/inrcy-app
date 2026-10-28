"use client";

import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { extractPublishMediaPreview } from "./agent.publish-preview";
import type { AgentPreparedAction, ChannelKey } from "./agent.types";

const pendingReads = new Map<string, Promise<AgentPreparedAction[]>>();

function identity(record: Record<string, unknown>) {
  const id = String(record.id || record.mediaId || record.media_id || "").trim();
  if (id) return `id:${id}`;
  const path = String(record.storagePath || record.storage_path || record.path || "").trim();
  return path ? `path:${String(record.bucket || "")}:${path}` : "";
}

/** Read a new URL for the same persisted media without replacing local text or selections. */
export async function recoverAgentMediaPreviewUrl({ accountId, actionId, channel, record, signal }: {
  accountId?: string | null;
  actionId: string;
  channel: ChannelKey | null;
  record: Record<string, unknown>;
  signal: AbortSignal;
}) {
  const mediaIdentity = identity(record);
  if (!accountId || !actionId || !mediaIdentity || signal.aborted || getActiveBrowserUserId() !== accountId) return null;
  let read = pendingReads.get(accountId);
  if (!read) {
    read = (async () => {
      const response = await fetch("/api/agent/actions", { method: "GET", cache: "no-store" });
      if (!response.ok) return [];
      const payload = await response.json() as { actions?: AgentPreparedAction[] };
      return Array.isArray(payload.actions) ? payload.actions : [];
    })();
    pendingReads.set(accountId, read);
    const clear = () => { if (pendingReads.get(accountId) === read) pendingReads.delete(accountId); };
    void read.then(clear, clear);
  }
  const actions = await read.catch(() => []);
  if (signal.aborted || getActiveBrowserUserId() !== accountId) return null;
  const action = actions.find(candidate => candidate.id === actionId);
  if (!action) return null;
  const media = extractPublishMediaPreview(action, channel).items.find(item => identity(item.record) === mediaIdentity);
  return media?.kind === "image" ? media.url : null;
}
