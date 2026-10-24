import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

type RenderNode = { type: unknown; props: Record<string, unknown> };
type Access = { viewerIsAdmin: boolean; actorUserId: string; activeAccountId: string; metaPilotEnabled: boolean };
const compile = (file: string) => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type: unknown, props: Record<string, unknown>): RenderNode => ({ type, props });

function renderViewerAccess(viewerIsAdmin: boolean, viewerMetaPilotEnabled: boolean) {
  const activeAccountId = "reviewer-account";
  let browserAccountId = activeAccountId;
  let state: string | undefined;
  let effect: (() => void | (() => void)) | undefined;
  const listeners = new Map<string, () => void>();
  const window = {
    addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
    removeEventListener: (event: string) => listeners.delete(event),
  };
  const localRequire = (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react") return {
      createContext: (value: unknown) => ({ Provider: "AccessProvider", value }),
      useContext: (context: { value: unknown }) => context.value,
      useState: (initial: string) => { state ??= initial; return [state, (next: string) => { state = next; }]; },
      useEffect: (next: () => void | (() => void)) => { effect ??= next; },
      useMemo: (factory: () => unknown) => factory(),
    };
    if (id === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => browserAccountId };
    if (id === "@/lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_EVENT: "account-changed" };
    throw new Error("Unexpected provider dependency " + id);
  };
  const loaded = { exports: {} as { default: (props: unknown) => RenderNode } };
  new Function("module", "exports", "require", "window", compile("app/dashboard/_components/DashboardViewerAccessProvider.tsx"))(loaded, loaded.exports, localRequire, window);
  const render = () => loaded.exports.default({ viewerIsAdmin, viewerMetaPilotEnabled, actorUserId: "authenticated-actor", activeAccountId, children: "tools" }).props.value as Access;
  const initial = render();
  const cleanup = effect?.();
  return {
    initial, render,
    switchBrowserAccount(id: string) {
      browserAccountId = id;
      listeners.get("account-changed")?.();
      return render();
    },
    cleanup: () => { if (typeof cleanup === "function") cleanup(); },
    listeners,
  };
}

test("REVIEWER can use the Meta tools without receiving Admin UI permissions", () => {
  const reviewer = renderViewerAccess(false, true);
  assert.deepEqual(reviewer.initial, { viewerIsAdmin: false, actorUserId: "authenticated-actor", activeAccountId: "reviewer-account", metaPilotEnabled: true });
  assert.equal(reviewer.switchBrowserAccount("ordinary-account").metaPilotEnabled, false, "stale reviewer props cannot expose pilot tools on another browser account");
  assert.equal(reviewer.switchBrowserAccount("reviewer-account").metaPilotEnabled, true);
  assert.equal(reviewer.render().viewerIsAdmin, false);
  reviewer.cleanup();
  assert.equal(reviewer.listeners.size, 0);
});

test("USER remains hidden and Admin loses access while an account switch awaits trusted server props", () => {
  const user = renderViewerAccess(false, false);
  assert.equal(user.initial.metaPilotEnabled, false);
  assert.equal(user.switchBrowserAccount("ordinary-account").metaPilotEnabled, false);
  assert.equal(user.switchBrowserAccount("reviewer-account").metaPilotEnabled, false);
  user.cleanup();
  const admin = renderViewerAccess(true, true);
  assert.equal(admin.initial.viewerIsAdmin, true);
  assert.deepEqual(admin.switchBrowserAccount("ordinary-account"), { viewerIsAdmin: false, actorUserId: "authenticated-actor", activeAccountId: "reviewer-account", metaPilotEnabled: false });
  admin.cleanup();
});

test("reviewer tooling edition stays distinct from the commercial Premium subscription", () => {
  const localRequire = (id: string) => {
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (id === "react") return {
      createContext: (value: unknown) => ({ Provider: "EditionProvider", value }),
      useContext: (context: { value: unknown }) => context.value,
    };
    throw new Error("Unexpected edition dependency " + id);
  };
  const loaded = { exports: {} as { default: (props: unknown) => RenderNode } };
  new Function("module", "exports", "require", compile("app/dashboard/_components/DashboardEditionProvider.tsx"))(loaded, loaded.exports, localRequire);
  const reviewer = loaded.exports.default({ edition: "founder", subscriptionEdition: "premium", children: "tools" });
  assert.equal(reviewer.props.value, "founder");
  assert.equal((reviewer.props.children as RenderNode).props.value, "premium");
  const regular = loaded.exports.default({ edition: "standard", children: "tools" });
  assert.equal((regular.props.children as RenderNode).props.value, "standard", "ordinary accounts retain their subscription edition");
});
