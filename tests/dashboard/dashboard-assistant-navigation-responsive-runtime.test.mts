import assert from "node:assert/strict";
import test from "node:test";
import { find, invoke, harness, type Props } from "./dashboard-assistant-runtime-harness.mts";
import { acknowledgeInrAssistantStudioDraft, INR_ASSISTANT_STUDIO_DRAFT_EVENT, type InrAssistantStudioDraftRequest } from "../../lib/inrAssistantStudioHandoff.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const scope = { actorUserId: "actor-a", accountId: "account-a" };
const draft = { version: 1, mediaType: "image", prompt: "Photo de notre atelier", format: null, durationSeconds: null };

async function withBrowser(width: number, run: (browser: EventTarget, storage: Map<string, string>) => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), {
    matchMedia: (query: string) => { assert.equal(query, "(max-width: 1100px)"); return { matches: width <= 1100 }; },
    sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  });
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
  try { await run(browser, storage); }
  finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function openedProvider() {
  const view = harness(true);
  const snapshot = () => {
    const tree = view.providerRender();
    return { controls: find(tree, node => Boolean(node.props.value)).props.value as Props, session: find(tree, node => node.props.actorUserId === "actor-a") };
  };
  (snapshot().controls.openAssistant as () => void)();
  return { view, snapshot };
}

for (const width of [320, 390, 768, 1100, 1101, 1440]) {
  for (const action of [
    { callback: "onInternalNavigate", args: ["/dashboard?panel=preferences"], destination: "/dashboard?panel=preferences" },
    { callback: "onOpenMediaLibrary", args: [], destination: "/dashboard/mediatheque" },
    { callback: "onHumanContact", args: ["Aide pour mes canaux"], destination: "/dashboard?panel=contact&panelSource=assistant" },
  ]) test(`${action.callback} reveals its destination at ${width}px and preserves the conversation`, async () => {
    await withBrowser(width, async () => {
      const { view, snapshot } = openedProvider();
      const before = snapshot();
      invoke(before.session, action.callback, ...action.args);
      await tick();
      assert.deepEqual(view.navigations, [action.destination]);
      const after = snapshot();
      assert.equal(after.controls.assistantOpen, width > 1100);
      assert.equal(after.session.key, before.session.key, "Navigation must not reset the conversation");
      if (width <= 1100) {
        assert.equal(after.controls.assistantActive, true);
        (after.controls.openAssistant as () => void)();
        assert.equal(snapshot().controls.assistantOpen, true, "The existing robot restores the same conversation");
      }
    });
  });
}

test("mobile navigation waits for unsaved-form acceptance and leaves a refused destination covered by the open chat", async () => {
  await withBrowser(390, async () => {
    const { view, snapshot } = openedProvider();
    view.deferNavigation();
    invoke(snapshot().session, "onInternalNavigate", "/dashboard/crm");
    assert.equal(snapshot().controls.assistantOpen, true);
    assert.deepEqual(view.navigations, []);
    view.releaseNavigation(false); await tick();
    assert.equal(snapshot().controls.assistantOpen, true);
    assert.deepEqual(view.navigations, []);
    view.deferNavigation();
    invoke(snapshot().session, "onInternalNavigate", "/dashboard/crm");
    view.releaseNavigation(true); await tick();
    assert.deepEqual(view.navigations, ["/dashboard/crm"]);
    assert.equal(snapshot().controls.assistantOpen, false);
  });
});

test("a late account switch or invalid destination never minimizes the mobile conversation", async () => {
  await withBrowser(390, async () => {
    const { view, snapshot } = openedProvider();
    for (const href of ["https://elsewhere.example", "//elsewhere.example/dashboard", "/dashboard/../../login", "/dashboard\\evil"]) invoke(snapshot().session, "onInternalNavigate", href);
    assert.deepEqual(view.navigations, []);
    assert.equal(snapshot().controls.assistantOpen, true);
    view.deferNavigation();
    invoke(snapshot().session, "onInternalNavigate", "/dashboard/crm");
    view.switchAccount(); view.releaseNavigation(true); await tick();
    assert.deepEqual(view.navigations, []);
    assert.equal(snapshot().controls.assistantOpen, true);
  });
});

for (const width of [390, 1440]) test(`an accepted draft in the mounted Studio preserves the expected assistant visibility at ${width}px`, async () => {
  await withBrowser(width, async browser => {
    browser.addEventListener(INR_ASSISTANT_STUDIO_DRAFT_EVENT, event => {
      (event as CustomEvent<InrAssistantStudioDraftRequest>).detail.result = Promise.resolve(true);
    });
    const { view, snapshot } = openedProvider();
    const insert = snapshot().session.props.onInsertStudioDraft as (value: unknown) => Promise<boolean>;
    assert.equal(await insert(draft), true);
    assert.equal(snapshot().controls.assistantOpen, width > 1100);
    assert.deepEqual(view.navigations, []);
  });
});

test("refused unsaved changes and rejected Studio insertion leave the mobile chat open", async () => {
  await withBrowser(390, async browser => {
    const { view, snapshot } = openedProvider();
    view.allowNavigation(false);
    const insert = snapshot().session.props.onInsertStudioDraft as (value: unknown) => Promise<boolean>;
    assert.equal(await insert(draft), false);
    assert.equal(snapshot().controls.assistantOpen, true);
    view.allowNavigation(true);
    browser.addEventListener(INR_ASSISTANT_STUDIO_DRAFT_EVENT, event => {
      (event as CustomEvent<InrAssistantStudioDraftRequest>).detail.result = Promise.resolve(false);
    });
    assert.equal(await insert(draft), false);
    assert.equal(snapshot().controls.assistantOpen, true);
    assert.deepEqual(view.navigations, []);
  });
});

for (const accepted of [true, false]) test(`routed Studio transfer ${accepted ? "stays minimized on success" : "restores the mobile chat on failure"}`, async () => {
  await withBrowser(390, async (_browser, storage) => {
    const { view, snapshot } = openedProvider();
    const insert = snapshot().session.props.onInsertStudioDraft as (value: unknown) => Promise<boolean>;
    const pending = insert(draft);
    await tick();
    const handoff = JSON.parse([...storage.values()][0]);
    assert.match(view.navigations[0], /^\/dashboard\/generer-media\?assistant_draft=/);
    assert.equal(snapshot().controls.assistantOpen, false);
    acknowledgeInrAssistantStudioDraft(scope, handoff.id, accepted);
    if (accepted) assert.equal(await pending, true);
    else await assert.rejects(pending, /studio_draft_unavailable/);
    assert.equal(snapshot().controls.assistantOpen, !accepted);
    assert.equal(storage.size, 0, "The consumed or failed handoff is removed");
  });
});
