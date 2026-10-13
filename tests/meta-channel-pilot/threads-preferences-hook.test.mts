import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as preferences from "../../lib/threadsPublicationPreferences.ts";
import type { useThreadsChannel } from "../../app/dashboard/_hooks/channels/useThreadsChannel.ts";

type HookValue = ReturnType<typeof useThreadsChannel>;
const source = ts.transpileModule(fs.readFileSync("app/dashboard/_hooks/channels/useThreadsChannel.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const shell = JSON.parse(fs.readFileSync("messages/fr-FR/shell.json", "utf8"));

function channelRuntime(status: number, body: unknown) {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const requests: string[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  const localRequire = (id: string) => {
    if (id === "react") return {
      useState(initial: unknown) {
        const index = stateIndex++;
        if (states.length <= index) states.push(typeof initial === "function" ? (initial as () => unknown)() : initial);
        return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? (next as (current: unknown) => unknown)(states[index]) : next; }];
      },
      useRef(initial: unknown) {
        const index = refIndex++;
        return refs[index] ||= { current: initial };
      },
      useCallback: (callback: unknown) => callback,
      useEffect: () => undefined,
    };
    if (id === "next-intl") return { useTranslations: () => (key: string) => shell[key] || key };
    if (id === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => "reviewer-account" };
    if (id.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: true, activeAccountId: "reviewer-account" }) };
    if (id === "@/lib/threadsPublicationPreferences") return preferences;
    throw new Error("Unexpected hook dependency " + id);
  };
  const fetch = async (url: string, init?: RequestInit) => {
    assert.equal(url, "/api/integrations/threads/publication-preferences");
    const method = String(init?.method || "GET");
    requests.push(method);
    assert.equal(init?.credentials, "include");
    return method === "GET"
      ? Response.json(body, { status })
      : Response.json({ preferences: JSON.parse(String(init?.body)) });
  };
  const loaded = { exports: {} as { useThreadsChannel: typeof useThreadsChannel } };
  new Function("module", "exports", "require", "fetch", source)(loaded, loaded.exports, localRequire, fetch);
  const render = (): HookValue => {
    stateIndex = 0;
    refIndex = 0;
    return loaded.exports.useThreadsChannel({ panel: null });
  };
  return { render, requests };
}

test("disconnected Threads preferences explain the connection precondition and cannot send PATCH", async () => {
  const fixture = channelRuntime(409, {
    code: "threads_connection_required",
    preferences: { ghostEnabled: true, defaultMode: "ghost" },
  });
  await fixture.render().loadPublicationPreferences();
  const channel = fixture.render();
  assert.equal(channel.connection.connected, false);
  assert.equal(channel.preferencesLoading, false);
  assert.equal(channel.preferencesError, "Connectez Threads pour configurer les formats de publication.");
  assert.deepEqual(channel.publicationPreferences, preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
  assert.equal(await channel.savePublicationPreferences(), false);
  assert.deepEqual(fixture.requests, ["GET"], "the precondition remains a truthy guard against preference updates");
});

test("other failures remain load errors rather than being disguised as a connection precondition", async () => {
  for (const [status, code] of [[409, "other_precondition"], [403, "threads_connection_required"], [500, "threads_connection_required"]] as const) {
    const fixture = channelRuntime(status, { code });
    await fixture.render().loadPublicationPreferences();
    const channel = fixture.render();
    assert.equal(channel.preferencesError, shell.threads_publication_modes_load_error);
    assert.equal(await channel.savePublicationPreferences(), false);
    assert.deepEqual(fixture.requests, ["GET"]);
  }
});

test("connected settings still load enabled Ghost and can save through the existing PATCH path", async () => {
  const stored = { version: 1, ghostEnabled: true, defaultMode: "ghost" };
  const fixture = channelRuntime(200, { preferences: stored });
  await fixture.render().loadPublicationPreferences();
  const channel = fixture.render();
  assert.equal(channel.preferencesError, null);
  assert.deepEqual(channel.publicationPreferences, stored);
  assert.equal(await channel.savePublicationPreferences(), true);
  assert.deepEqual(fixture.requests, ["GET", "PATCH"]);
  assert.equal(fixture.render().preferencesNotice, shell.threads_publication_modes_saved);
  const english = JSON.parse(fs.readFileSync("messages/en-GB/shell.json", "utf8"));
  assert.equal(english.threads_publication_modes_connection_required, "Connect Threads to configure publication formats.");
});
