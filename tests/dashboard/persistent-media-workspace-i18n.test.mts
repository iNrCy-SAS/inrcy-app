import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import IntlMessageFormat from "intl-messageformat";
import ts from "typescript";
import * as mutations from "../../app/dashboard/booster/publier/persistentMediaWorkspaceMutations.ts";
import type usePersistentMediaWorkspace from "../../app/dashboard/booster/publier/usePersistentMediaWorkspace.ts";

type Translator = (key: string, values?: Record<string, string | number>) => string;
type State = { mediaType: "image"; status: "ready" | "uploading"; progress: number; position: number };
const code = ts.transpileModule(readFileSync(new URL("../../app/dashboard/booster/publier/usePersistentMediaWorkspace.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(translate?: Translator, states: Record<string, State> = {}) {
  let refIndex = 0;
  const nativeCalls: string[] = [];
  const modules: Record<string, unknown> = {
    react: {
      useState: (value: unknown) => [value, () => {}], useCallback: (callback: unknown) => callback, useEffect() {},
      useRef: (value: unknown) => ({ current: refIndex++ === 0 ? states : value }),
    },
    "@/lib/boosterMediaPipelineMissions": {},
    "@/lib/mediaWorkspaceClient": new Proxy({ isUniversalMediaWorkspaceEnabled: () => false }, {
      get(target, key: string) {
        if (key in target) return target[key as keyof typeof target];
        return () => { nativeCalls.push(key); throw new Error(`Unexpected media operation ${key}`); };
      },
    }),
    "@/lib/mediaWorkspaceTimeout": {}, "@/lib/universalMediaUploadClient": {},
    "./persistentMediaWorkspaceMutations": mutations,
  };
  const exported = {} as { default: typeof usePersistentMediaWorkspace };
  new Function("exports", "require", "window", code)(exported, (name: string) => {
    assert.ok(name in modules, `Unexpected localisation dependency ${name}`);
    return modules[name];
  }, { setTimeout: () => 0 });
  return { hook: exported.default({ creationMode: "manual", selectedChannels: [], translate }), nativeCalls };
}

test("standalone media workspace consumers retain their original French fallback", async () => {
  const { hook, nativeCalls } = fixture();
  await assert.rejects(hook.prepareAiMedia(), /La préparation IA est disponible uniquement dans le mode Créer avec iNrCy/);
  await assert.rejects(hook.preparePublicationMedia(), /Le workspace média persistant n’est pas activé/);
  assert.deepEqual(nativeCalls, []);
});

for (const locale of ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
  test(`media workspace errors and real upload progress use ${locale} without media requests`, async () => {
    const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}/booster.json`, import.meta.url), "utf8"));
    const translate: Translator = (key, values = {}) => {
      assert.equal(typeof messages[key], "string", `Missing workspace message ${locale}/${key}`);
      return String(new IntlMessageFormat(messages[key], locale).format(values));
    };
    const empty = fixture(translate);
    await assert.rejects(empty.hook.prepareAiMedia(), error => (error as Error).message === messages.persistent_ai_mode_required);
    await assert.rejects(empty.hook.preparePublicationMedia(), error => (error as Error).message === messages.persistent_disabled);
    for (const count of [1, 2]) for (const status of ["uploading", "ready"] as const) {
      const states = Object.fromEntries(Array.from({ length: count }, (_, index) => [`image-${index}`, {
        mediaType: "image" as const, status, progress: 37, position: index,
      }]));
      const h = fixture(translate, states), progress: Array<{ value: number; label: string }> = [];
      const settled = await h.hook.waitForIdle((value: number, label: string) => progress.push({ value, label }));
      const key = status === "ready" ? count > 1 ? "persistent_uploaded_many" : "persistent_uploaded_one"
        : count > 1 ? "persistent_upload_many" : "persistent_upload_one";
      assert.deepEqual(progress, [{ value: status === "ready" ? 100 : 37, label: translate(key, { progress: 37 }) }]);
      assert.equal(settled.length, count, "localisation preserves the settled media state");
      assert.deepEqual(h.nativeCalls, [], "localisation never uploads, generates, publishes or updates a workspace");
    }
    assert.deepEqual(empty.nativeCalls, []);
  });
}
