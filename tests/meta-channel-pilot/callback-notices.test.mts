import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES, DEFAULT_THREADS_PUBLICATION_PREFERENCES } from "../../lib/threadsPublicationPreferences.ts";

type RecordLike = Record<string, unknown>;
type RenderNode = { type: unknown; props: RecordLike };
const require = createRequire(import.meta.url);
let query = new URLSearchParams();
let pilot = true;
let locale = "fr-FR";
const replacements: string[] = [];
const modules = new Map<string, RecordLike>();
const jsx = (type: unknown, props: RecordLike): unknown => {
  if (typeof type === "function" && ["MetaOAuthCallbackNotice", "StatusMessage"].includes(type.name)) return type(props);
  return { type, props };
};
function load(relative: string): RecordLike {
  const file = path.resolve(relative);
  if (modules.has(file)) return modules.get(file)!;
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} as RecordLike };
  modules.set(file, loaded.exports);
  const localRequire = (id: string): unknown => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id === "react") return { useEffect: () => undefined, useId: () => "callback-test", useRef: (initial: unknown) => ({ current: initial }), useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => undefined] };
    if (id === "next/navigation") return { useSearchParams: () => query, useRouter: () => ({ replace: (url: string) => { replacements.push(url); }, push: () => undefined }) };
    if (id === "next-intl") return { useLocale: () => locale, useTranslations: () => (key: string) => (JSON.parse(fs.readFileSync("messages/" + locale + "/shell.json", "utf8")) as Record<string, string>)[key] || key };
    if (id === "next/image") return { __esModule: true, default: "img" };
    if (id.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: pilot }) };
    if (id.endsWith("DashboardUnsavedNavigationProvider")) return { useDashboardUnsavedNavigation: () => ({ requestNavigation: (callback: () => void) => callback() }) };
    if (id.endsWith("DashboardFluxBubble") || id.endsWith("GoogleOAuthConsentBanner")) return { __esModule: true, default: "channel-component" };
    if (id.endsWith(".css")) return {};
    if (id === "server-only") return {};
    if (!id.startsWith(".") && !id.startsWith("@/")) return require(id);
    const base = id.startsWith("@/") ? path.resolve(id.slice(2)) : path.resolve(path.dirname(file), id);
    const target = [base, base + ".ts", base + ".tsx"].find(candidate => fs.existsSync(candidate));
    assert.ok(target, "missing module " + id);
    return load(target);
  };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, localRequire);
  modules.set(file, loaded.exports);
  return loaded.exports;
}
const getNotice = load("app/dashboard/_hooks/channels/metaOAuthCallbackNotice.ts").getMetaOAuthCallbackNotice as (params: URLSearchParams, provider: string, language: string, fallback: string) => string | null;
const ChannelsModal = load("app/dashboard/_components/DashboardChannelsModal.tsx").default as (props: RecordLike) => RenderNode;
const ThreadsSettings = load("app/dashboard/_components/ThreadsPublicationSettings.tsx").default as (props: RecordLike) => RenderNode | null;
const Notice = load("app/dashboard/_components/MetaOAuthCallbackNotice.tsx").default as (props: RecordLike) => RenderNode | null;
function scene(provider: string, connection: RecordLike) {
  return ChannelsModal({ items: [{ key: provider, name: provider, bubbleStatus: connection.connected ? "connected" : "available", bubbleStatusText: connection.connected ? "Connecté" : "À connecter", connection, onConfigure() {} }], initialSelectedKey: provider, onClose() {} });
}
function nodes(value: unknown): RenderNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const node = value as RenderNode;
  return [node, ...nodes(node.props?.children)];
}
function renderedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(renderedText).join("");
  if (!value || typeof value !== "object") return "";
  const node = value as RenderNode;
  return node.props?.["aria-hidden"] ? "" : renderedText(node.props?.children);
}
function alerts(value: unknown): string[] {
  return nodes(value).filter(node => node.props?.role === "alert").map(node => renderedText(node));
}
const instagramFailure = "La connexion Instagram n’a pas pu être finalisée. Réessayez.";
const threadsFailure = "La connexion Threads n’a pas pu être finalisée. Réessayez.";
const instagramConnection = { connected: false, accountConnected: false, instagramAuthMode: "facebook_login" };
const threadsConnection = { connected: false, requiresUpdate: false, connectionStatus: "disconnected", username: "", profileUrl: "" };

test("Instagram direct callback failures are visible while the account and Facebook profile step are disconnected", () => {
  pilot = true; locale = "fr-FR";
  query = new URLSearchParams({ panel: "instagram", linked: "instagram", ok: "0", ig_login: "direct", error: "meta_save_rpc_failed", message: "save_meta_direct_connection RPC failed" });
  const before = structuredClone(instagramConnection);
  assert.deepEqual(alerts(scene("instagram", instagramConnection)), [instagramFailure]);
  assert.deepEqual(instagramConnection, before, "feedback never changes account or profile state");
});

test("Threads callback failure remains visible during and after an independent status check", () => {
  pilot = true; locale = "fr-FR";
  query = new URLSearchParams({ panel: "threads", linked: "threads", ok: "0", error: "meta_request_failed", message: "Meta request failed" });
  const channel = {
    connection: threadsConnection, loading: true, busy: false, notice: null, error: null,
    publicationPreferences: CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES,
    preferencesLoading: true, preferencesSaving: false, preferencesNotice: null,
    preferencesError: null as string | null,
    connectThreads() {}, disconnectThreads() {},
    updatePublicationPreferences() {}, savePublicationPreferences() {}, loadPublicationPreferences() {},
  };
  const before = structuredClone(channel.connection);
  assert.deepEqual(alerts(scene("threads", { ...channel.connection, loading: channel.loading })), [threadsFailure]);
  channel.loading = false;
  assert.deepEqual(alerts(scene("threads", { ...channel.connection, loading: channel.loading })), [threadsFailure]);
  channel.preferencesLoading = false;
  channel.publicationPreferences = DEFAULT_THREADS_PUBLICATION_PREFERENCES;
  assert.deepEqual(alerts([scene("threads", channel.connection), ThreadsSettings({ channel })]), [threadsFailure], "a successful formats check cannot clear OAuth feedback");
  channel.publicationPreferences = CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES;
  channel.preferencesError = "Impossible de charger les formats Threads. Ghost reste indisponible.";
  assert.deepEqual(alerts([scene("threads", channel.connection), ThreadsSettings({ channel })]), [threadsFailure, channel.preferencesError], "the formats error is separate from the persistent OAuth error");
  assert.deepEqual(channel.connection, before);
});

test("safe callback explanations remain readable, and credentials, markup and dumps use the localized fallback", () => {
  const params = new URLSearchParams({ panel: "threads", linked: "threads", ok: "0", error: "meta_request_failed" });
  params.set("message", "Connexion interrompue. Réessayez depuis ce panneau.");
  assert.equal(getNotice(params, "threads", "fr", threadsFailure), "Connexion interrompue. Réessayez depuis ce panneau.");
  const professionalRequired = "La connexion directe nécessite un compte Instagram professionnel ou Creator.";
  params.set("panel", "instagram"); params.set("linked", "instagram"); params.set("ig_login", "direct"); params.set("message", professionalRequired);
  assert.equal(getNotice(params, "instagram", "fr", instagramFailure), professionalRequired);
  params.set("panel", "threads"); params.set("linked", "threads");
  for (const message of ["https://graph.threads.com/me?access_token=FAKE_SECRET", "<script>fake()</script>", "client_secret=" + "a".repeat(32), "Bearer FAKE_SECRET", "Raw " + "a".repeat(501)]) {
    params.set("message", message);
    assert.equal(getNotice(params, "threads", "en", "Safe English fallback."), "Safe English fallback.");
  }
});

test("a later successful callback clears the previous alert even if stale error parameters remain", () => {
  pilot = true; locale = "fr-FR";
  for (const provider of ["instagram", "threads"]) {
    query = new URLSearchParams({ panel: provider, linked: provider, ok: "0", ig_login: "direct", error: "meta_request_failed", message: "Meta request failed" });
    assert.equal(alerts(Notice({ provider })).length, 1);
    query.set("ok", "1");
    assert.equal(Notice({ provider }), null);
    query = new URLSearchParams({ panel: provider });
    assert.equal(Notice({ provider }), null);
  }
});

test("callback feedback never leaks between providers or replaces the existing Facebook Instagram journey", () => {
  const params = new URLSearchParams({ panel: "instagram", linked: "instagram", ok: "0", error: "fb_error", message: "Legacy Facebook feedback" });
  assert.equal(getNotice(params, "instagram", "fr", instagramFailure), null, "Facebook callbacks retain their existing handlers");
  params.set("ig_login", "direct"); params.set("linked", "threads");
  assert.equal(getNotice(params, "instagram", "fr", instagramFailure), null);
  params.set("panel", "threads"); params.set("linked", "facebook");
  assert.equal(getNotice(params, "threads", "fr", threadsFailure), null);
});

test("direct-provider callback feedback stays hidden after pilot access is removed", () => {
  pilot = false; locale = "fr-FR";
  for (const provider of ["instagram", "threads"]) {
    query = new URLSearchParams({ panel: provider, linked: provider, ok: "0", ig_login: "direct", message: "Meta request failed" });
    assert.equal(Notice({ provider }), null);
  }
  assert.equal(ThreadsSettings({ channel: { connection: threadsConnection } }), null);
  pilot = true;
});

test("closing channel bubbles removes callback failure and direct-login markers while preserving unrelated URL settings", () => {
  pilot = true;
  query = new URLSearchParams({ panel: "instagram", linked: "instagram", ok: "0", ig_login: "direct", error: "meta_save_rpc_failed", message: "Meta request failed", lang: "fr" });
  replacements.length = 0;
  const useRouting = load("app/dashboard/_hooks/useDashboardPanelRouting.ts").useDashboardPanelRouting as () => { closePanel: () => void };
  useRouting().closePanel();
  assert.equal(replacements.length, 1);
  const destination = new URL(replacements[0], "https://app.example");
  for (const key of ["panel", "linked", "ok", "ig_login", "error", "message"]) assert.equal(destination.searchParams.has(key), false);
  assert.equal(destination.searchParams.get("lang"), "fr");
  query = destination.searchParams;
  assert.equal(Notice({ provider: "instagram" }), null);
});
