import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as voiceRules from "../../lib/aiMediaCharacterVoices.ts";
import * as optimization from "../../lib/mediaLibraryOptimizationPolicy.ts";

type Element = { type: string | ((props: unknown) => Element); props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: `Vocal ${id}`, duration_seconds: 5, size_bytes: 160_044, media_type: "audio",
  bucket_name: "inrcy-pro-media", storage_path: `users/active-account/audio/2026/${id}.wav`, mime_type: "audio/wav",
  tags: ["voix"], created_at: "2026-10-19T12:00:00Z", width: null, height: null,
  signed_url: `/api/media-library/items/${id}/content?token=test`, ...extra,
});

function harness(options: { items?: unknown[]; response?: Response; pending?: boolean; compact?: boolean; visual?: boolean } = {}) {
  const slots: Slot[] = []; const effects: Array<() => void> = [];
  let cursor = 0; let dirty = false; let tree: Element; let dismissals = 0; let open = true;
  let disposed = false; let updatesAfterDispose = 0;
  const selections: unknown[] = []; const requests: Array<{ url: string; init: RequestInit; resolve?: (response: Response) => void }> = [];
  const listeners = new Map<string, () => void>();
  const document = { activeElement: null as FakeElement | null };
  class FakeElement {
    focusCount = 0;
    focus() { this.focusCount++; document.activeElement = this; }
    querySelector() { return searchElement; }
    querySelectorAll() { return [searchElement, confirmElement]; }
    getClientRects() { return [{}]; }
  }
  const searchElement = new FakeElement(); const confirmElement = new FakeElement(); const previousFocus = new FakeElement();
  document.activeElement = previousFocus;
  const react = {
    useId: () => "voice-library",
    useRef(initial: unknown) { const index = cursor++; slots[index] ||= { value: { current: initial } }; return slots[index].value; },
    useState(initial: unknown) {
      const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      return [slots[index].value, (update: unknown) => {
        if (disposed) updatesAfterDispose++;
        const value = typeof update === "function" ? (update as (previous: unknown) => unknown)(slots[index].value) : update;
        if (value !== slots[index].value) { slots[index].value = value; dirty = true; }
      }];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = cursor++; const previous = slots[index];
      if (!previous?.deps || previous.deps.some((value, at) => value !== deps[at])) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useMemo: (callback: () => unknown) => callback(),
    useEffect(callback: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++; const previous = slots[index];
      if (!previous?.deps || previous.deps.some((value, at) => value !== deps[at])) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  const translate = (key: string, values?: { name?: string }) => values?.name ? `${key}:${values.name}` : key;
  const jsx = { jsx: (type: Element["type"], props: Record<string, unknown>) => ({ type, props }), jsxs: (type: Element["type"], props: Record<string, unknown>) => ({ type, props }) };
  const browser = { innerWidth: options.compact ? 390 : 1440, addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) };
  const fetch = async (url: string, init: RequestInit) => {
    const request: typeof requests[number] = { url, init }; requests.push(request);
    return options.pending ? new Promise<Response>((resolve) => { request.resolve = resolve; })
      : options.response ?? Response.json({ ok: true, items: options.items ?? [item("own-vocal")] });
  };
  const load = (filename: string, extra: Record<string, unknown> = {}) => {
    const output = ts.transpileModule(readFileSync(new URL(`../../${filename}`, import.meta.url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const record = { exports: {} as { default: (props: unknown) => Element } };
    const require = (id: string) => {
      if (id in extra) return extra[id];
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return jsx;
      if (id === "next-intl") return { useTranslations: () => translate, useLocale: () => "fr-FR" };
      if (id === "@/lib/aiMediaCharacterVoices") return voiceRules;
      if (id === "@/lib/mediaLibraryOptimizationPolicy") return optimization;
      if (id === "@/lib/userFacingErrors") return { getLocalizedErrorMessage: (_error: unknown, _locale: string, fallback: string) => fallback };
      throw new Error(`unexpected_library_picker_dependency:${id}`);
    };
    new Function("module", "exports", "require", "fetch", "window", "document", "HTMLElement", output)(record, record.exports, require, fetch, browser, document, FakeElement);
    return record.exports.default;
  };
  const library = load("app/dashboard/_components/MediaLibraryPickerModal.tsx");
  const wrapper = load("app/dashboard/_components/MediaCharacterVoiceLibraryPicker.tsx", { "./MediaLibraryPickerModal": { __esModule: true, default: library } });
  const close = () => { dismissals++; };
  const wrapperTree = wrapper({ onClose: close, onSelect: (id: string) => selections.push(id) });
  const render = () => {
    let count = 0;
    do {
      assert.ok(++count < 20); cursor = 0; dirty = false;
      tree = library(options.visual ? { open, onClose: close, onConfirm: (items: unknown[]) => selections.push(items) } : { ...wrapperTree.props, open });
      const attachRefs = (value: unknown) => {
        if (Array.isArray(value)) { value.forEach(attachRefs); return; }
        if (!value || typeof value !== "object" || !("props" in value)) return;
        const element = value as Element;
        if (element.props.ref) (element.props.ref as { current: unknown }).current = new FakeElement();
        attachRefs(element.props.children);
      };
      if (tree) attachRefs(tree);
      for (const effect of effects.splice(0)) effect();
    } while (dirty);
  };
  const elements = (type?: string) => {
    const found: Element[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const element = value as Element; if (!type || element.type === type) found.push(element); visit(element.props.children);
    };
    visit(tree); return found;
  };
  render();
  return {
    elements, requests, selections, wrapperTree, dismissals: () => dismissals, updatesAfterDispose: () => updatesAfterDispose,
    searchElement, confirmElement, previousFocus, document,
    rows: () => elements().filter((element) => Boolean(element.props["data-media-library-item"])),
    resolve(index: number, response: Response) { assert.ok(requests[index].resolve); requests[index].resolve!(response); },
    async flush() { for (let count = 0; count < 4; count++) { await new Promise((resolve) => setImmediate(resolve)); if (dirty && !disposed) render(); } },
    trigger(element: Element, event: string, argument?: unknown) { const result = (element.props[event] as (argument?: unknown) => unknown)(argument); if (dirty) render(); return result; },
    setOpen(value: boolean) { open = value; render(); },
    dispose() { disposed = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}

const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join("")
  : value && typeof value === "object" && "props" in value ? text((value as Element).props.children)
    : typeof value === "string" || typeof value === "number" ? String(value) : "";

const confirm = (h: ReturnType<typeof harness>) => h.elements("button").find((element) => text(element) === "ai_generator_character_voice_library_confirm")!;

test("the character voice button opens the existing full library picker with a locked Vocal filter", async () => {
  const h = harness();
  assert.equal(h.wrapperTree.props.accept, "audio"); assert.equal(h.wrapperTree.props.multiple, false); assert.equal(h.wrapperTree.props.maxSelection, 1);
  assert.equal(h.wrapperTree.props.closeOnConfirm, false);
  const dialog = h.elements("div").find((element) => element.props["data-media-library-picker"] !== undefined)!;
  assert.equal(dialog.props.role, "dialog"); assert.equal(dialog.props["aria-labelledby"], h.elements("h2")[0].props.id);
  assert.equal(h.elements("select")[0].props.value, "audio"); assert.equal(h.elements("select")[0].props.disabled, true);
  assert.deepEqual(h.elements("option").map((element) => element.props.value), ["audio"]);
  assert.equal(text(h.elements("option")[0]), "ai_generator_character_voice_library_filter");
  assert.equal(h.searchElement.focusCount, 1);
  const params = new URL(h.requests[0].url, "https://app.invalid").searchParams;
  assert.equal(params.get("type"), "audio"); assert.equal(params.get("includeAudio"), "true"); assert.equal(params.get("active"), "active");
  assert.equal(h.requests[0].init.credentials, "include"); assert.equal(h.requests[0].init.cache, "no-store");
  await h.flush(); assert.equal(h.rows().length, 1);
  assert.equal(h.elements("audio")[0].props.preload, "metadata"); assert.equal(h.elements("audio")[0].props.src, item("own-vocal").signed_url);
  assert.ok(text(h.rows()[0]).includes("0:05")); assert.ok(text(h.rows()[0]).includes("unit_kilobytes"));
  h.trigger(h.rows()[0], "onClick"); assert.equal(confirm(h).props.disabled, false);
  await h.trigger(confirm(h), "onClick"); await h.flush();
  assert.deepEqual(h.selections, ["own-vocal"]);
  assert.equal(h.dismissals(), 0, "onSelect closes the voice picker and starts an upload; a second onClose would release its busy lock"); h.dispose();
});

test("the full Vocal list is searchable and only one compatible audio can be returned to its character", async () => {
  const h = harness({ items: [item("first"), item("second"), item("visual", { media_type: "image" })] }); await h.flush();
  assert.equal(h.rows().length, 2);
  h.trigger(h.elements("input")[0], "onChange", { target: { value: "ma voix" } }); await h.flush();
  assert.equal(new URL(h.requests.at(-1)!.url, "https://app.invalid").searchParams.get("q"), "ma voix");
  h.trigger(h.rows()[0], "onClick"); h.trigger(h.rows()[1], "onClick");
  assert.deepEqual(h.rows().map((row) => row.props["aria-pressed"]), [false, true]);
  await h.trigger(confirm(h), "onClick"); assert.deepEqual(h.selections, ["second"]); h.dispose();
});

test("visual library callers keep their visual-only default even if the endpoint returns audio", async () => {
  const h = harness({ visual: true, items: [item("voice"), item("image", { media_type: "image" }), item("video", { media_type: "video" })] }); await h.flush();
  const params = new URL(h.requests[0].url, "https://app.invalid").searchParams;
  assert.equal(params.get("type"), "visual"); assert.equal(params.has("includeAudio"), false);
  assert.deepEqual(h.rows().map((row) => row.props["data-media-library-item"]), ["image", "video"]);
  assert.equal(h.elements("option").some((element) => element.props.value === "audio"), false); assert.equal(h.elements("audio").length, 0);
  h.trigger(h.rows()[0], "onClick");
  await h.trigger(h.elements("button").find((element) => text(element) === "picker_add")!, "onClick");
  assert.equal((h.selections[0] as Array<{ media_type: string }>)[0].media_type, "image");
  assert.equal(h.dismissals(), 1, "visual callers keep the existing close-on-confirm behavior"); h.dispose();
});

test("incompatible vocals remain in the library with an accessible reason and cannot be selected", async () => {
  const h = harness({ items: [item("one", { duration_seconds: "1" }), item("ten", { duration_seconds: 10, size_bytes: voiceRules.AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES }),
    item("long", { duration_seconds: 10.1 }), item("short", { duration_seconds: 0.9 }), item("unknown", { duration_seconds: null }), item("large", { size_bytes: voiceRules.AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES + 1 })] }); await h.flush();
  assert.deepEqual(h.rows().map((row) => Boolean(row.props["aria-disabled"])), [false, false, true, true, true, true]);
  h.trigger(h.rows()[2], "onClick"); assert.equal(confirm(h).props.disabled, true); assert.deepEqual(h.selections, []);
  assert.equal(text(h.elements("div").find((element) => element.props.role === "alert")), "ai_generator_character_voice_library_duration_error");
  const description = h.rows()[2].props["aria-describedby"];
  assert.ok(h.elements("small").some((element) => element.props.id === description)); h.dispose();
});

test("audio playback clicks and Space are independent of row selection while Escape stays local to the picker", async () => {
  const h = harness(); await h.flush();
  const playerWrapper = h.elements("span").find((element) => element.props.onClick && element.props.onKeyDown)!;
  let stopped = 0;
  h.trigger(playerWrapper, "onClick", { stopPropagation: () => stopped++ });
  h.trigger(playerWrapper, "onKeyDown", { key: " ", stopPropagation: () => stopped++ });
  h.trigger(playerWrapper, "onKeyDown", { key: "Tab", stopPropagation: () => stopped++ });
  assert.equal(stopped, 2); assert.deepEqual(h.selections, []); assert.equal(confirm(h).props.disabled, true);
  const dialog = h.elements("div").find((element) => element.props.role === "dialog")!;
  let prevented = 0;
  h.trigger(dialog, "onKeyDown", { key: "Escape", stopPropagation: () => stopped++, preventDefault: () => prevented++ });
  assert.equal(h.dismissals(), 1); assert.equal(prevented, 1); assert.equal(stopped, 3); h.dispose();
});

test("the responsive library keeps the Vocal filter, custom confirmation and keyboard focus inside its own dialog", async () => {
  const h = harness({ compact: true }); await h.flush();
  assert.equal(h.elements("select")[0].props.value, "audio"); assert.ok(confirm(h));
  const dialog = h.elements("div").find((element) => element.props.role === "dialog")!;
  h.document.activeElement = h.confirmElement;
  let prevented = false;
  h.trigger(dialog, "onKeyDown", { key: "Tab", shiftKey: false, stopPropagation() {}, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.document.activeElement, h.searchElement);
  h.setOpen(false); assert.equal(h.document.activeElement, h.previousFocus); h.dispose();
});

test("a preview failure is explicit without changing the selected library identity", async () => {
  const h = harness(); await h.flush(); h.trigger(h.elements("audio")[0], "onError");
  assert.equal(text(h.elements("small").find((element) => element.props.role === "alert")), "apercu_indisponible_d0ce704a");
  h.trigger(h.rows()[0], "onClick"); await h.trigger(confirm(h), "onClick"); assert.deepEqual(h.selections, ["own-vocal"]); h.dispose();
});

test("closing or replacing a search aborts old requests and ignores a late previous-account response", async () => {
  const h = harness({ pending: true });
  h.trigger(h.elements("input")[0], "onChange", { target: { value: "nouveau" } });
  assert.equal(h.requests[0].init.signal?.aborted, true);
  h.resolve(1, Response.json({ ok: true, items: [item("new-result")] })); await h.flush();
  h.resolve(0, Response.json({ ok: true, items: [item("old-result")] })); await h.flush();
  assert.deepEqual(h.rows().map((row) => row.props["data-media-library-item"]), ["new-result"]);
  h.trigger(h.elements("input")[0], "onChange", { target: { value: "autre" } }); h.dispose();
  h.resolve(2, Response.json({ ok: true, items: [item("old-account")] })); await h.flush();
  assert.equal(h.updatesAfterDispose(), 0); assert.equal(h.requests[2].init.signal?.aborted, true); assert.deepEqual(h.selections, []);
});
