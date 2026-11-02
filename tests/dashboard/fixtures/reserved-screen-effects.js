const sources = window.bundledSources, loaded = {};
window.errors = [];
window.addEventListener("error", e => window.errors.push(e.message));
window.calls = [];
window.replaces = [];
window.confirmations = [];
window.allowConfirm = true;
window.account = "account-a";
window.job = { id: "job-a", status: "running", result: {}, createdAt: "2026-11-02T00:00:00Z" };
window.serverMemory = { mission: "Saved mission" };
const translate = key => key;
const search = new URLSearchParams(window.scenario === "request" ? "request=request-a" : window.scenario === "new" ? "action=new&summary=Linked draft" : "");
const router = { replace: url => {
  window.replaces.push(url);
  if (window.scenario === "request") search.delete("request");
} };
const noop = () => {};
const unexpected = () => { throw Error("Unexpected side effect"); };
const review = id => ({ id: "google:locations/a/reviews/" + id, reviewName: "locations/a/reviews/" + id, name: "Client " + id, rating: 5, date: "01/11/2026", status: "À répondre", comment: "Review " + id, live: true, replyable: true });
function load(name, from = "") {
  if (name === "next-intl") return { useTranslations: () => translate, useLocale: () => "fr-FR" };
  if (name === "next/navigation") return { useRouter: () => router, useSearchParams: () => search };
  if (name === "@/lib/inrcyDialog") return { confirmInrcy: async options => { window.confirmations.push(options); return window.allowConfirm; } };
  if (name === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => window.account };
  if (name === "@/lib/browserModuleSnapshotCache") return { MODULE_SNAPSHOT_KEYS: { agendaMonth: () => "month", agendaContacts: "contacts", agendaSettings: "settings", eReputationGoogle: "reviews" }, readModuleSnapshot: () => null, writeModuleSnapshot: noop };
  if (name.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: true }) };
  if (name.endsWith("DashboardAssistantScreenContext")) return { useInrAssistantScreen: noop };
  if (name.endsWith("useUnsavedExitGuard")) return { useUnsavedExitGuard: noop };
  if (name === "@/lib/userFacingErrors") return { getClientUserFacingApiError: async () => "Error", getClientUserFacingErrorMessage: () => "Error" };
  if (name === "@/lib/boosterGenerationContextClient") return { invalidateBoosterGenerationContextClient: async () => true };
  if (name === "@/lib/publicProfileRefreshClient") return { refreshPublicProfileDependents: async () => true };
  if (name === "@/lib/universalMediaUploadClient") return { uploadFileToPreparedStorageIntent: unexpected };
  if (name.startsWith("@/")) name = name.slice(2);
  else if (name.startsWith(".")) {
    const parts = from.split("/"); parts.pop();
    for (const part of name.split("/")) { if (part === "..") parts.pop(); else if (part !== ".") parts.push(part); }
    name = parts.join("/");
  }
  if (!sources[name] && sources[name + ".ts"]) name += ".ts";
  if (!sources[name]) return { __esModule: true, default: () => null }; // Unmounted view-only imports.
  if (loaded[name]) return loaded[name].exports;
  const m = loaded[name] = { exports: {} };
  new Function("require", "module", "exports", sources[name])(n => load(n, name), m, m.exports);
  return m.exports;
}
const ok = payload => ({ ok: true, json: async () => payload });
window.fetch = async (url, options = {}) => {
  window.calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
  if (url === "/api/calendar/settings") return new Promise(resolve => { window.resolveSettings = () => resolve(ok({ accounts: [], selectedMailAccountId: "mail-a", reminderOffsetsMinutes: [] })); });
  if (url.startsWith("/api/crm/contacts")) return ok({ contacts: [] });
  if (url.startsWith("/api/calendar/events")) return ok({ ok: true, events: [], appointmentRequests: window.scenario === "request" ? [{ id: "request-a", summary: "Request", start: "2026-11-02T09:00:00Z", end: "2026-11-02T10:00:00Z", inrcy: { inrBadgeAppointmentRequest: { clientName: "Client A" } } }] : [] });
  if (url.startsWith("/api/e-reputation/google")) return new Promise(resolve => { window.resolveReviews = () => resolve(ok({ connected: true, configured: true, locationName: "location-a", reviews: [{ reviewId: "a", name: "locations/a/reviews/a", reviewer: { displayName: "Client a" }, starRating: "FIVE", comment: "Updated review" }, { reviewId: "b", name: "locations/a/reviews/b", reviewer: { displayName: "Client b" }, starRating: "FIVE", comment: "Review b" }], totalReviewCount: 2 })); });
  if (url === "/api/ai-memory/analyze-channels") return ok({ accountId: window.account, job: window.scenario === "poll" ? window.job : null, channels: [] });
  if (url === "/api/ai-memory") {
    if (options.method === "PUT") window.serverMemory = { ...window.serverMemory, ...JSON.parse(options.body).memory };
    return ok({ accountId: window.account, memory: window.serverMemory, businessKnowledge: {}, strategyEnabled: true });
  }
  throw Error("Unexpected fetch " + url);
};
const React = load("react"), Component = load(window.screenFile).default;
const props = window.screenName === "reviews" ? { reviews: [review("a"), review("b")], reviewsReady: true, reviewsError: null, gmbReady: true, locationName: "location-a", totalReviewCount: 2 } : {};
window.root = load("react-dom/client").createRoot(document.getElementById("root"));
window.root.render(React.createElement(Component, props));
