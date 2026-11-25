import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const trackerSource = readFileSync(new URL("../../app/dashboard/_components/LastActiveTracker.tsx", import.meta.url), "utf8");
const trackerModule = ts.transpileModule(trackerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function tracker(responses: Response[]) {
  const browserWindow = Object.assign(new EventTarget(), { setInterval: () => 1, clearInterval: () => {} });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const requests: Array<{ url: string; method?: string }> = [];
  const output = { exports: {} as { default: () => null } };
  let cleanup: (() => void) | undefined;

  new Function("module", "exports", "require", "window", "document", "fetch", trackerModule)(
    output, output.exports,
    (name: string) => {
      assert.equal(name, "react");
      return { useEffect(effect: () => () => void) { cleanup = effect(); } };
    },
    browserWindow, document,
    async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method });
      return responses.shift() ?? Response.json({ ok: true });
    },
  );

  return {
    requests,
    focus: () => browserWindow.dispatchEvent(new Event("focus")),
    mount() {
      output.exports.default();
      assert.ok(cleanup);
      return cleanup;
    },
  };
}

function flushActivityRequest() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("each dashboard mount records activity even right after a different account", async () => {
  const client = tracker([Response.json({ ok: true }), Response.json({ ok: true })]);
  const unmountFirstAccount = client.mount();
  client.focus();
  await flushActivityRequest();
  client.focus();
  assert.deepEqual(client.requests, [{ url: "/api/profile/last-active", method: "POST" }]);

  unmountFirstAccount();
  const unmountSecondAccount = client.mount();
  await flushActivityRequest();
  assert.equal(client.requests.length, 2);
  unmountSecondAccount();
});

test("dashboard activity can retry after HTTP errors and unsuccessful writes", async () => {
  const client = tracker([
    Response.json({ ok: false }, { status: 403 }),
    Response.json({ ok: false }),
    Response.json({ ok: true }),
  ]);
  const unmount = client.mount();

  for (let attempts = 1; attempts <= 3; attempts += 1) {
    await flushActivityRequest();
    assert.equal(client.requests.length, attempts);
    client.focus();
  }

  assert.equal(client.requests.length, 3);
  unmount();
});
