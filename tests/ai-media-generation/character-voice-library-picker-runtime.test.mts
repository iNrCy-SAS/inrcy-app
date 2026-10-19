import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as voiceRules from "../../lib/aiMediaCharacterVoices.ts";

type Element = { type: string; props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Vocal ${id}`, duration_seconds: 5, size_bytes: 160_044,
  signed_url: `/api/media-library/items/${id}/content?token=test`, ...extra,
});

function harness(options: { items?: unknown[]; response?: Response; pending?: boolean } = {}) {
  const slots: Slot[] = []; const effects: Array<() => void> = [];
  let cursor = 0; let dirty = false; let tree: Element; let opened = 0; let closed = 0; let dismissals = 0;
  let disposed = false; let updatesAfterDispose = 0;
  const selections: string[] = []; const requests: Array<{ url: string; init: RequestInit }> = [];
  let finishFetch: ((response: Response) => void) | undefined;
  const dialog = { showModal: () => { opened++; }, close: () => { closed++; } };
  const react = {
    useId: () => "voice-library",
    useRef(initial: unknown) { const index = cursor++; slots[index] ||= { value: { current: initial } }; return slots[index].value; },
    useState(initial: unknown) {
      const index = cursor++; slots[index] ||= { value: initial };
      return [slots[index].value, (update: unknown) => {
        if (disposed) updatesAfterDispose++;
        slots[index].value = typeof update === "function" ? (update as (previous: unknown) => unknown)(slots[index].value) : update;
        dirty = true;
      }];
    },
    useEffect(callback: () => (() => void), deps: unknown[]) {
      const index = cursor++; const previous = slots[index];
      if (!previous?.deps || previous.deps.some((value, at) => value !== deps[at])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_components/MediaCharacterVoiceLibraryPicker.tsx", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const record = { exports: {} as { default: (props: unknown) => Element } };
  const require = (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: (type: string, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: string, props: Record<string, unknown>) => ({ type, props }) };
    if (id === "next-intl") return { useTranslations: () => (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key };
    if (id === "@/lib/aiMediaCharacterVoices") return voiceRules;
    if (id.endsWith(".module.css")) return { default: {} };
    throw new Error(`unexpected_library_picker_dependency:${id}`);
  };
  const fetch = async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return options.pending ? new Promise<Response>((resolve) => { finishFetch = resolve; })
      : options.response ?? Response.json({ ok: true, items: options.items ?? [item("own-vocal")] });
  };
  new Function("module", "exports", "require", "fetch", output)(record, record.exports, require, fetch);
  const render = () => {
    let count = 0;
    do {
      assert.ok(++count < 20); cursor = 0; dirty = false;
      tree = record.exports.default({ onClose: () => { dismissals++; }, onSelect: (id: string) => { selections.push(id); } });
      (tree.props.ref as { current: unknown }).current = dialog;
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
    elements, requests, selections, opened: () => opened, closed: () => closed, dismissals: () => dismissals,
    updatesAfterDispose: () => updatesAfterDispose,
    resolve(response: Response) { assert.ok(finishFetch); finishFetch(response); },
    async flush() { for (let count = 0; count < 4; count++) { await new Promise((resolve) => setImmediate(resolve)); if (dirty && !disposed) render(); } },
    trigger(element: Element, event: string) { (element.props[event] as () => void)(); if (dirty) render(); },
    dispose() { disposed = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("the real voice picker opens one labelled modal and requests only active account audio", async () => {
  const h = harness();
  assert.equal(h.opened(), 1);
  assert.equal(h.elements("dialog")[0].props["aria-labelledby"], h.elements("h3")[0].props.id);
  assert.equal(h.elements("p").some((element) => element.props.role === "status"), true);
  assert.equal(h.requests.length, 1);
  const request = h.requests[0]; const url = new URL(request.url, "https://app.invalid");
  assert.equal(url.searchParams.get("type"), "audio"); assert.equal(url.searchParams.get("includeAudio"), "true");
  assert.equal(url.searchParams.get("active"), "active"); assert.equal(request.init.credentials, "include");
  assert.equal(request.init.cache, "no-store"); assert.ok(request.init.signal instanceof AbortSignal);
  await h.flush();
  const audio = h.elements("audio")[0];
  assert.equal(audio.props.src, item("own-vocal").signed_url); assert.equal(audio.props.preload, "metadata");
  assert.equal(audio.props.controls, true); assert.match(String(audio.props["aria-label"]), /library_audio_preview:Vocal own-vocal/);
  assert.deepEqual(h.elements("small")[0].props.children, ["library_audio_duration", ": ", 0, ":", "05"]);
  h.trigger(h.elements("button").find((element) => element.props.children === "ai_generator_character_voice_library_confirm")!, "onClick");
  assert.deepEqual(h.selections, ["own-vocal"]);
  h.dispose(); assert.equal(h.closed(), 1); assert.equal(request.init.signal?.aborted, true);
});

test("the picker preserves numeric metadata and disables samples outside the 1–10 s / 3 MiB boundary", async () => {
  const h = harness({ items: [
    item("min", { duration_seconds: "1", size_bytes: String(voiceRules.AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES) }),
    item("max", { duration_seconds: 10 }), item("short", { duration_seconds: 0.9 }), item("long", { duration_seconds: 10.1 }),
    item("unknown", { duration_seconds: null }), item("large", { size_bytes: voiceRules.AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES + 1 }),
  ] });
  await h.flush();
  const buttons = h.elements("button").filter((element) => element.props.children === "ai_generator_character_voice_library_confirm");
  assert.deepEqual(buttons.map((button) => button.props.disabled), [false, false, true, true, true, true]);
  assert.equal(h.elements("small").filter((element) => element.props.children === "ai_generator_character_voice_library_duration_error").length, 4);
  h.dispose();
});

test("a preview error is visible for that vocal without silently replacing its library selection", async () => {
  const h = harness({ items: [item("first"), item("second", { signed_url: null })] }); await h.flush();
  assert.equal(h.elements("small").filter((element) => element.props.role === "alert").length, 1);
  h.trigger(h.elements("audio")[0], "onError");
  assert.equal(h.elements("small").filter((element) => element.props.role === "alert").length, 2);
  assert.deepEqual(h.selections, []);
  const first = h.elements("button").find((element) => element.props.children === "ai_generator_character_voice_library_confirm")!;
  assert.equal(first.props.disabled, false, "the server revalidates the original audio independently of browser preview");
  h.trigger(first, "onClick"); assert.deepEqual(h.selections, ["first"]); h.dispose();
});

test("a failed audio list exposes an accessible error instead of an empty compatible list", async () => {
  for (const response of [Response.json({ ok: false }, { status: 503 }), Response.json({ ok: true, items: null })]) {
    const h = harness({ response }); await h.flush();
    assert.equal(h.elements("p").find((element) => element.props.role === "alert")?.props.children, "ai_generator_character_voice_library_unavailable");
    assert.equal(h.elements("audio").length, 0); assert.deepEqual(h.selections, []); h.dispose();
  }
});

test("cancel and unmount close the modal and ignore late private audio responses", async () => {
  const h = harness({ pending: true });
  h.trigger(h.elements("dialog")[0], "onCancel"); assert.equal(h.dismissals(), 1);
  h.dispose(); assert.equal(h.requests[0].init.signal?.aborted, true); assert.equal(h.closed(), 1);
  h.resolve(Response.json({ ok: true, items: [item("previous-account")] })); await h.flush();
  assert.equal(h.updatesAfterDispose(), 0); assert.deepEqual(h.selections, []);
});
