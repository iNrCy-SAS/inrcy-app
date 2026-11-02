export const INR_ASSISTANT_REFRESH_EVENT = "inrcy:assistant-mutation-confirmed";
export const INR_ASSISTANT_REFRESH_TOPICS = ["media", "agents", "settings", "channels", "stats", "business"] as const;
export type InrAssistantRefreshTopic = typeof INR_ASSISTANT_REFRESH_TOPICS[number];
export type InrAssistantRefresh = { accountId: string; turnId: string; topics: InrAssistantRefreshTopic[] };
type Receipt = { tool: string; ok: boolean; status: string };
const TOOLS: Record<string, InrAssistantRefreshTopic[]> = {
  updateMediaMetadata: ["media"], importMediaAttachment: ["media"], applyMediaDeletion: ["media"], generateMedia: ["media"], modifyMedia: ["media"], getMediaGeneration: ["media"],
  managePublicationIdeas: ["agents"], configureAgentAutomation: ["agents"], editPreparedPublication: ["agents"], applyPublicationLifecycleAction: ["agents"], preparePublication: ["agents"], executePublication: ["agents"], editPublication: ["agents"], applyScheduledPublicationAction: ["agents"], updateScheduledPublication: ["agents"], cancelScheduledPublication: ["agents"], retryScheduledPublication: ["agents"],
  updateToolSettings: ["settings", "channels"], setNativeChannelActivation: ["channels"], updateChannelPublicUrl: ["channels"], applyGoogleBusinessProfileUpdate: ["channels"], replyToGoogleReview: ["channels"],
  updateBusinessDna: ["business", "channels"], updateAiConfiguration: ["business", "settings"], configureBusinessCta: ["business", "channels"],
  refreshStatsSources: ["stats"], sendStatsReport: ["stats", "agents"],
};
const CONFIRMED = new Set(["saved", "saved_with_adjustments", "updated", "deleted", "deleted_locally", "cancelled_locally", "imported", "completed", "succeeded", "generated", "ready", "draft", "prepared", "pending_validation", "published", "scheduled", "cancelled", "confirmed", "sent", "restored", "refused", "already_processed", "already_configured", "previous_attempt_recorded", "success"]);
/** Project only confirmed native effects. No receipt text, URL, approval or business data leaves the server here. */
export function assistantRefreshTopics(receipts: readonly Receipt[]): InrAssistantRefreshTopic[] {
  return [...new Set(receipts.filter(receipt => receipt.ok && (CONFIRMED.has(receipt.status) || receipt.tool === "refreshStatsSources" && receipt.status === "read")).flatMap(receipt => TOOLS[receipt.tool] ?? []))];
}
export function parseInrAssistantRefresh(value: unknown): InrAssistantRefresh | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.accountId !== "string" || !data.accountId || data.accountId.length > 180 || typeof data.turnId !== "string" || !data.turnId || data.turnId.length > 180 || /[\u0000-\u001f]/.test(data.accountId + data.turnId) || !Array.isArray(data.topics) || !data.topics.length || data.topics.length > INR_ASSISTANT_REFRESH_TOPICS.length || data.topics.some(topic => !INR_ASSISTANT_REFRESH_TOPICS.includes(topic as InrAssistantRefreshTopic))) return null;
  return { accountId: data.accountId, turnId: data.turnId, topics: [...new Set(data.topics)] as InrAssistantRefreshTopic[] };
}
const dispatched = new Set<string>();
export function dispatchInrAssistantRefresh(value: unknown): boolean {
  const refresh = parseInrAssistantRefresh(value);
  if (!refresh || typeof window === "undefined") return false;
  const key = `${refresh.accountId}:${refresh.turnId}:${[...refresh.topics].sort().join(",")}`;
  if (dispatched.has(key)) return false;
  dispatched.add(key); if (dispatched.size > 200) dispatched.delete(dispatched.values().next().value!);
  window.dispatchEvent(new CustomEvent(INR_ASSISTANT_REFRESH_EVENT, { detail: refresh }));
  return true;
}
export type InrAssistantRefreshContext = { accountId: string; topics: InrAssistantRefreshTopic[]; canApply: () => boolean };
/** Coalesce native rereads, retain them during edits and reject stale async responses after account changes. */
export function subscribeInrAssistantRefresh(options: { target?: EventTarget; topics: readonly InrAssistantRefreshTopic[]; getAccountId: () => string | null; getRevision?: () => unknown; isBlocked: () => boolean; refresh: (context: InrAssistantRefreshContext) => Promise<boolean> }) {
  const target = options.target ?? window;
  let disposed = false, running = false;
  let pending: { accountId: string; topics: Set<InrAssistantRefreshTopic> } | null = null;
  const queue = (accountId: string, topics: InrAssistantRefreshTopic[]) => { if (pending?.accountId !== accountId) pending = { accountId, topics: new Set() }; topics.forEach(topic => pending!.topics.add(topic)); };
  const flush = async () => {
    if (disposed || running || !pending || options.isBlocked()) return;
    if (pending.accountId !== options.getAccountId()) { pending = null; return; }
    const current = pending, revision = options.getRevision?.(); pending = null; running = true;
    const canApply = () => !disposed && current.accountId === options.getAccountId() && !options.isBlocked() && revision === options.getRevision?.();
    let applied = false;
    try { applied = await options.refresh({ accountId: current.accountId, topics: [...current.topics], canApply }); } catch { /* Native views keep their previous data and their own retry controls. */ }
    running = false;
    if (!applied && !disposed && current.accountId === options.getAccountId()) queue(current.accountId, [...current.topics]);
    // Only a new event arriving during a successful read needs another pass.
    if ((applied || revision !== options.getRevision?.()) && pending && !disposed) void flush();
  };
  const listener = (event: Event) => {
    const data = parseInrAssistantRefresh((event as CustomEvent<unknown>).detail);
    if (!data || data.accountId !== options.getAccountId()) return;
    const topics = data.topics.filter(topic => options.topics.includes(topic));
    if (!topics.length) return;
    queue(data.accountId, topics); void flush();
  };
  target.addEventListener(INR_ASSISTANT_REFRESH_EVENT, listener);
  return { flush, dispose: () => { disposed = true; pending = null; target.removeEventListener(INR_ASSISTANT_REFRESH_EVENT, listener); } };
}
