import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeInrAssistantStudioDraft, clearInrAssistantStudioDraft, INR_ASSISTANT_STUDIO_DRAFT_EVENT,
  inrAssistantStudioDraftHref, readInrAssistantStudioDraft, requestInrAssistantStudioDraft,
  stageInrAssistantStudioDraft, waitForInrAssistantStudioDraft, type InrAssistantStudioDraftRequest,
} from "../../lib/inrAssistantStudioHandoff.ts";
import { readInrAssistantResponse } from "../../lib/inrAssistantClientStream.ts";

const scope = { actorUserId: "actor-a", accountId: "account-a" };
const draft = { version: 1, mediaType: "video", prompt: "Un chat rouge joue dans un jardin ensoleillé.", format: "story", durationSeconds: 8 } as const;
function browser() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  const target = Object.assign(new EventTarget(), { sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  return { target, storage, restore() { if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window"); } };
}

test("free Studio transfer has an actor/account scope, short lifetime and only a random ID in its URL", () => {
  const view = browser();
  try {
    const staged = stageInrAssistantStudioDraft(scope, draft, 1000)!;
    assert.ok(staged);
    assert.deepEqual(readInrAssistantStudioDraft(scope, staged.id, 1000)?.draft, draft);
    assert.equal(readInrAssistantStudioDraft({ ...scope, accountId: "account-b" }, staged.id, 1000), null);
    assert.equal(readInrAssistantStudioDraft({ ...scope, actorUserId: "actor-b" }, staged.id, 1000), null);
    assert.equal(readInrAssistantStudioDraft(scope, staged.id, 999), null);
    assert.equal(readInrAssistantStudioDraft(scope, staged.id, 1000 + 15 * 60_000 + 1), null);
    assert.equal(inrAssistantStudioDraftHref(staged.id), "/dashboard/generer-media?assistant_draft=" + staged.id);
    assert.equal(inrAssistantStudioDraftHref("/api/generate?prompt=secret"), null);
    assert.ok(!inrAssistantStudioDraftHref(staged.id)!.includes("chat"));
    const newer = stageInrAssistantStudioDraft(scope, draft, 1001)!;
    clearInrAssistantStudioDraft(scope, staged.id);
    assert.ok(readInrAssistantStudioDraft(scope, newer.id, 1001), "An old completion must preserve the newer transfer");
    view.storage.set([...view.storage.keys()][0], JSON.stringify({ ...newer, draft: { ...draft, executeUrl: "/api/generate" } }));
    assert.equal(readInrAssistantStudioDraft(scope, newer.id, 1001), null);
  } finally { view.restore(); }
});

test("mounted Studio answers a free transfer; navigation acknowledgements must match actor, account and ID", async () => {
  const view = browser();
  try {
    const staged = stageInrAssistantStudioDraft(scope, draft)!;
    assert.equal(await requestInrAssistantStudioDraft(scope, staged.id), null);
    view.target.addEventListener(INR_ASSISTANT_STUDIO_DRAFT_EVENT, event => {
      const detail = (event as CustomEvent<InrAssistantStudioDraftRequest>).detail;
      assert.deepEqual(Object.keys(detail).sort(), ["accountId", "actorUserId", "id"]);
      detail.result = Promise.resolve(true);
    });
    assert.equal(await requestInrAssistantStudioDraft(scope, staged.id), true);
    let settled = false;
    const wait = waitForInrAssistantStudioDraft(scope, staged.id, 200).then(value => { settled = true; return value; });
    acknowledgeInrAssistantStudioDraft({ ...scope, accountId: "account-b" }, staged.id, true);
    acknowledgeInrAssistantStudioDraft({ ...scope, actorUserId: "actor-b" }, staged.id, true);
    await Promise.resolve(); assert.equal(settled, false);
    acknowledgeInrAssistantStudioDraft(scope, staged.id, true);
    assert.equal(await wait, true);
    clearInrAssistantStudioDraft(scope, staged.id);
    assert.equal(await requestInrAssistantStudioDraft(scope, staged.id), false);
  } finally { view.restore(); }
});

test("public stream only allows insertion with a valid data-only Studio draft", async () => {
  for (const streaming of [false, true]) {
    const response = (payload: unknown) => streaming ? new Response("data: " + JSON.stringify({ type: "result", payload }) + "\n\n", { headers: { "Content-Type": "text/event-stream" } }) : Response.json(payload);
    const valid = await readInrAssistantResponse(response({ message: "Votre prompt est prêt.", studioDraft: draft, insertStudioDraft: true }), () => {});
    assert.deepEqual(valid.payload?.studioDraft, draft); assert.equal(valid.payload?.insertStudioDraft, true);
    const invalid = await readInrAssistantResponse(response({ message: "Votre prompt est prêt.", studioDraft: { ...draft, callback: "/api/generate" }, insertStudioDraft: true }), () => {});
    assert.equal(invalid.payload?.studioDraft, undefined); assert.equal(invalid.payload?.insertStudioDraft, undefined);
  }
});
