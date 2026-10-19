import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as voiceRules from "../../lib/aiMediaCharacterVoices.ts";
import * as client from "../../lib/aiMediaCharacterVoiceClient.ts";
import type { CharacterVoiceRecording } from "../../lib/aiMediaCharacterVoiceRecorderClient.ts";

type Element = { type: string; props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const label = (suffix: string) => `ai_generator_character_voice_${suffix}`;

function harness() {
  const slots: Slot[] = []; const effects: Array<() => void> = []; const listeners = new Map<string, () => void>();
  const uploaded: FormData[] = []; const requests: RequestInit[] = []; const samples: unknown[] = []; const revoked: string[] = []; const deleted: string[] = [];
  let cursor = 0; let dirty = false; let tree!: Element; let mode: "ai" | "provided" = "ai"; let sample: unknown;
  let disabled = false; let beginCalls = 0; let cancelCalls = 0; let rejectRecorder = false;
  let completeRecording: ((recording: CharacterVoiceRecording) => void) | undefined;
  const busy = (value: boolean) => { disabled = value; dirty = true; };
  const react = {
    useId: () => "voice-test",
    useRef(initial: unknown) { const index = cursor++; slots[index] ||= { value: { current: initial } }; return slots[index].value; },
    useState(initial: unknown) { const index = cursor++; slots[index] ||= { value: initial }; return [slots[index].value, (update: unknown) => { slots[index].value = typeof update === "function" ? (update as (previous: unknown) => unknown)(slots[index].value) : update; dirty = true; }]; },
    useEffect(callback: () => (() => void), deps: unknown[]) {
      const index = cursor++; const previous = slots[index];
      if (!previous?.deps || previous.deps.some((value, at) => value !== deps[at])) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
    },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_components/MediaCharacterVoiceInput.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const moduleRecord = { exports: {} as { default: (props: unknown) => Element } };
  const require = (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: (type: string, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: string, props: Record<string, unknown>) => ({ type, props }) };
    if (id === "next-intl") return { useTranslations: () => (key: string) => key };
    if (id === "./MediaCharacterVoiceLibraryPicker") return { default: "library-picker" };
    if (id === "@/lib/aiMediaCharacterVoices") return voiceRules;
    if (id === "@/lib/aiMediaCharacterVoiceClient") return { ...client, deleteCharacterVoiceSample: async (value: { path: string }) => { deleted.push(value.path); } };
    if (id === "@/lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" };
    if (id === "@/lib/aiMediaCharacterVoiceRecorderClient") return {
      CharacterVoiceRecorderUnavailableError: class extends Error {},
      beginCharacterVoiceRecording(options: { onComplete: typeof completeRecording }) {
        beginCalls++; completeRecording = options.onComplete;
        return { session: { stop: () => completeRecording?.({ blob: new Blob(["recorded voice"], { type: "audio/webm" }), mimeType: "audio/webm", durationSeconds: 2 }), cancel: () => { cancelCalls++; } }, ready: rejectRecorder ? Promise.reject(new DOMException("Denied", "NotAllowedError")) : Promise.resolve() };
      },
    };
    if (id.endsWith(".module.css")) return { default: {} };
    throw new Error(`Unexpected voice component dependency ${id}`);
  };
  const browser = { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) };
  const fetch = async (_url: string, init: RequestInit) => {
    assert.equal(init.method, "POST"); assert.equal(init.credentials, "include"); requests.push(init); if (init.body instanceof FormData) uploaded.push(init.body);
    return Response.json({ ok: true, sample: { path: "account-owned-vocal.wav", name: "vocal.wav", mimeType: "audio/wav", durationSeconds: 2, sizeBytes: 64_044, libraryMediaId: "2a3c8e17-6388-4acd-91a8-b2b23fce872b" } });
  };
  const urls = { createObjectURL: () => "blob:recording-preview", revokeObjectURL: (value: string) => revoked.push(value) };
  new Function("module", "exports", "require", "window", "fetch", "URL", output)(moduleRecord, moduleRecord.exports, require, browser, fetch, urls);
  const render = () => {
    let count = 0;
    do {
      assert.ok(++count < 20); cursor = 0; dirty = false;
      tree = moduleRecord.exports.default({ mode, sample, disabled, onBusyChange: busy, onModeChange: (value: "ai" | "provided") => { mode = value; dirty = true; }, onSampleChange: (value: unknown) => { sample = value; samples.push(value); dirty = true; } });
      for (const effect of effects.splice(0)) effect();
    } while (dirty);
  };
  const elements = (type: string) => {
    const found: Element[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const element = value as Element; if (element.type === type) found.push(element); visit(element.props.children);
    };
    visit(tree); return found;
  };
  render();
  return {
    elements, uploaded, requests, samples, revoked, deleted, beginCalls: () => beginCalls, cancelCalls: () => cancelCalls, disabled: () => disabled,
    selectProvided() { (elements("select")[0].props.onChange as (event: unknown) => void)({ target: { value: "provided" } }); render(); },
    click(suffix: string) { const button = elements("button").find((item) => item.props.children === label(suffix)); assert.ok(button, `${suffix} is visible`); assert.ok(!button.props.disabled, `${suffix} is enabled`); (button.props.onClick as () => void)(); render(); },
    async flush() { for (let index = 0; index < 4; index++) { await new Promise((resolve) => setImmediate(resolve)); if (dirty) render(); } },
    denyMicrophone() { rejectRecorder = true; },
    setExternalBusy(value: boolean) { disabled = value; render(); },
    changeAccount() { listeners.get("account-change")?.(); if (dirty) render(); },
    selectLibrary(id: string) { (elements("library-picker")[0].props.onSelect as (id: string) => void)(id); render(); },
    closeLibrary() { (elements("library-picker")[0].props.onClose as () => void)(); render(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("a library voice reuses its identifier without asking for microphone or re-uploading the permanent audio", async () => {
  const h = harness(); h.selectProvided(); h.click("library");
  assert.equal(h.disabled(), true); assert.equal(h.elements("library-picker").length, 1);
  const mediaLibraryId = "2a3c8e17-6388-4acd-91a8-b2b23fce872b";
  h.selectLibrary(mediaLibraryId); await h.flush();
  assert.equal(h.beginCalls(), 0); assert.equal(h.uploaded.length, 0);
  assert.deepEqual(JSON.parse(String(h.requests[0].body)), { mediaLibraryId });
  assert.equal(h.elements("library-picker").length, 0); assert.equal(h.disabled(), false);
  assert.equal((h.samples.at(-1) as { libraryMediaId: string }).libraryMediaId, mediaLibraryId);
  h.dispose();
});

test("closing the library or changing account releases its UI lock without deleting a durable vocal", () => {
  const h = harness(); h.selectProvided(); h.click("library"); h.closeLibrary();
  assert.equal(h.disabled(), false); assert.equal(h.deleted.length, 0);
  h.click("library"); h.changeAccount();
  assert.equal(h.disabled(), false); assert.equal(h.elements("library-picker").length, 0);
  assert.equal(h.requests.length, 0); h.dispose();
});

test("voice starts as IA and adding a recording requests microphone only after explicit start", async () => {
  const h = harness(); assert.equal(h.elements("select")[0].props.value, "ai"); assert.equal(h.elements("button").length, 0);
  h.selectProvided(); h.click("upload"); assert.equal(h.beginCalls(), 0);
  h.click("record"); assert.equal(h.beginCalls(), 0);
  h.click("record_start"); await h.flush(); assert.equal(h.beginCalls(), 1); assert.equal(h.disabled(), true);
  h.click("record_stop"); assert.equal(h.elements("audio")[0].props.src, "blob:recording-preview"); assert.equal(h.uploaded.length, 0);
  h.click("record_use"); await h.flush();
  assert.equal(h.uploaded.length, 1); assert.equal(h.uploaded[0].get("source"), "recording"); assert.ok(h.uploaded[0].get("file") instanceof File);
  assert.equal(h.samples.length, 1); assert.equal(h.disabled(), false); assert.deepEqual(h.revoked, ["blob:recording-preview"]); h.dispose();
});

test("microphone denial exposes an accessible error and cancel releases the local operation", async () => {
  const h = harness(); h.selectProvided(); h.click("upload"); h.click("record"); h.denyMicrophone(); h.click("record_start"); await h.flush();
  assert.equal(h.elements("small").find((item) => item.props.role === "alert")?.props.children, label("record_denied"));
  assert.equal(h.disabled(), false); assert.equal(h.uploaded.length, 0); h.click("record_cancel"); h.dispose();
});

test("canceling an idle recording preserves another character's active operation lock", () => {
  const h = harness(); h.selectProvided(); h.click("upload"); h.click("record");
  h.setExternalBusy(true);
  assert.equal(h.elements("button").find((item) => item.props.children === label("record_start"))?.props.disabled, true);
  h.click("record_cancel");
  assert.equal(h.disabled(), true, "an idle recorder does not own the shared busy lock");
  assert.equal(h.beginCalls(), 0); assert.equal(h.requests.length, 0); h.dispose();
});

test("retry discards the old preview and unmount or account changes cancel active capture", async () => {
  const h = harness(); h.selectProvided(); h.click("upload"); h.click("record"); h.click("record_start"); await h.flush(); h.click("record_stop"); h.click("record_retry"); await h.flush();
  assert.equal(h.beginCalls(), 2); assert.deepEqual(h.revoked, ["blob:recording-preview"]); assert.equal(h.uploaded.length, 0);
  h.changeAccount(); assert.equal(h.cancelCalls(), 1); assert.equal(h.disabled(), false); h.dispose();
  const second = harness(); second.selectProvided(); second.click("upload"); second.click("record"); second.click("record_start"); await second.flush(); second.dispose(); assert.equal(second.cancelCalls(), 1);
});
