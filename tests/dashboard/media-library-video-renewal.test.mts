import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type VideoTarget = { error?: { code: number }; currentTime: number; paused?: boolean; ended?: boolean; seeking?: boolean; readyState?: number; duration?: number; play?: () => Promise<void> };
type VideoEventHandler = (event: { currentTarget: VideoTarget }) => void;
type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> & { src: string; onPlay: VideoEventHandler; onPause: VideoEventHandler; onError: VideoEventHandler; onStalled: VideoEventHandler; onLoadedMetadata: VideoEventHandler }; key?: string | number };
const original = "/api/media-library/items/09d5eae9-afbd-44bb-b37a-1e92f1a32310/content?token=test-token";
function harness(initialSource = original, controls = true) {
  let slots: unknown[] = [], cursor = 0, previousKey: string | number | undefined;
  const react = {
    createElement(type: Element["type"], props: Record<string, unknown>) { const { key, ...rest } = props; return { type, props: rest, key }; },
    useState(initial: unknown) { const i = cursor++, mountedSlots = slots; if (!(i in mountedSlots)) mountedSlots[i] = initial; return [mountedSlots[i], (value: unknown) => { mountedSlots[i] = value; }]; },
    useRef(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
  };
  const javascript = ts.transpileModule(readFileSync(new URL("../../app/dashboard/mediatheque/MediaLibraryVideo.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} as { default: (props: Record<string, unknown>) => Element } };
  const jsx = (type: Element["type"], props: Record<string, unknown>, key?: string | number) => ({ type, props, key });
  new Function("module", "exports", "require", "window", "HTMLMediaElement", javascript)(loaded, loaded.exports, (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx };
    throw new Error(`Unexpected video dependency: ${name}`);
  }, { location: { origin: "https://app.inrcy.com" } }, { HAVE_METADATA: 1, HAVE_FUTURE_DATA: 3 });
  return { render(src = initialSource) {
    const wrapper = loaded.exports.default({ src, controls, playsInline: true, unavailableLabel: "Aperçu indisponible" });
    if (wrapper.key !== previousKey) { slots = []; previousKey = wrapper.key; }
    cursor = 0;
    return (wrapper.type as (props: Record<string, unknown>) => Element)(wrapper.props);
  } };
}

test("an expired redirect renews the authenticated source once and resumes position and play intent", async () => {
  const h = harness();
  const first = h.render();
  assert.equal(first.type, "video"); assert.equal(first.props.src, original);
  const failedVideo = { error: { code: 2 }, currentTime: 91, paused: false, ended: false };
  first.props.onPlay({ currentTarget: failedVideo });
  first.props.onError({ currentTarget: failedVideo });
  first.props.onError({ currentTarget: failedVideo });
  const renewed = h.render();
  assert.equal(renewed.type, "video"); assert.equal(renewed.key, 1);
  assert.equal(renewed.props.src, original + "&playbackRetry=1");
  assert.equal(renewed.props.controls, true); assert.equal(renewed.props.playsInline, true);
  let plays = 0;
  const restored = { currentTime: 0, duration: 180, play: async () => { plays++; } };
  renewed.props.onLoadedMetadata({ currentTarget: restored });
  await Promise.resolve();
  assert.equal(restored.currentTime, 91); assert.equal(plays, 1);
  renewed.props.onError({ currentTarget: failedVideo });
  const unavailable = h.render();
  assert.equal(unavailable.type, "span"); assert.equal(unavailable.props.role, "status");
  assert.equal(unavailable.props.children, "Aperçu indisponible");
});

test("a paused video stays paused and changing the source resets the bounded renewal", () => {
  const h = harness(); const first = h.render();
  first.props.onError({ currentTarget: { error: { code: 4 }, currentTime: 20, paused: true, ended: false } });
  const renewed = h.render(); let plays = 0;
  const video = { currentTime: 0, duration: 90, play: async () => { plays++; } };
  renewed.props.onLoadedMetadata({ currentTarget: video });
  assert.equal(video.currentTime, 20); assert.equal(plays, 0);
  const other = h.render(original.replace("09d5eae9", "19d5eae9"));
  assert.equal(other.key, 0); assert.doesNotMatch(other.props.src, /playbackRetry/);
});

test("foreign provider URLs and decode failures never cause a retry", () => {
  for (const [src, code] of [["https://foreign.example/expired.mp4", 2], [original, 3]] as const) {
    const h = harness(src); h.render().props.onError({ currentTarget: { error: { code }, currentTime: 0, paused: true, ended: false } });
    assert.equal(h.render().type, "span");
  }
});

test("a stalled paused seek renews the stable source once without restarting playback", () => {
  const h = harness(), first = h.render();
  first.props.onPlay({ currentTarget: { currentTime: 18, paused: false } });
  const stalled = { currentTime: 40, paused: true, seeking: true, readyState: 1 };
  first.props.onStalled({ currentTarget: stalled });
  first.props.onStalled({ currentTarget: stalled });
  first.props.onError({ currentTarget: stalled });

  const renewed = h.render();
  assert.equal(renewed.props.src, original + "&playbackRetry=1");
  const restored = { currentTime: 0, duration: 50, play: async () => assert.fail("a paused seek must stay paused") };
  renewed.props.onLoadedMetadata({ currentTarget: restored });
  assert.equal(restored.currentTime, 40);
  renewed.props.onStalled({ currentTarget: stalled });
  assert.equal(h.render().props.src, renewed.props.src);
});

test("a stall during playback resumes only while the user has not paused", async () => {
  for (const pauseAfterRetry of [false, true]) {
    const h = harness(), first = h.render();
    first.props.onStalled({ currentTarget: { currentTime: 8, paused: false, readyState: 2 } });
    const renewed = h.render();
    assert.equal(renewed.props.src, original + "&playbackRetry=1");
    let plays = 0;
    const restored = { currentTime: 0, duration: 20, play: async () => { plays++; } };
    first.props.onPause({ currentTarget: restored }); // Old element leaving must not cancel the new playback.
    if (pauseAfterRetry) renewed.props.onPause({ currentTarget: restored });
    renewed.props.onLoadedMetadata({ currentTarget: restored });
    await Promise.resolve();
    assert.equal(restored.currentTime, 8);
    assert.equal(plays, pauseAfterRetry ? 0 : 1);
  }
});

test("passive, initial and foreign stalls do not reload a video", () => {
  const stalledSeek = { currentTime: 15, paused: true, seeking: true, readyState: 1 };
  for (const [src, controls, currentTarget] of [
    [original, false, stalledSeek],
    [original, true, { ...stalledSeek, seeking: false }],
    [original, true, { ...stalledSeek, readyState: 3 }],
    [original, true, { ...stalledSeek, readyState: 0 }],
    [original, true, { currentTime: 0, paused: false, readyState: 1 }],
    ["https://foreign.example/expired.mp4", true, stalledSeek],
  ] as const) {
    const h = harness(src, controls);
    h.render().props.onStalled({ currentTarget });
    assert.equal(h.render().props.src, src);
  }
});

test("stale events from the retried video cannot alter the next source", () => {
  const h = harness(), first = h.render();
  first.props.onStalled({ currentTarget: { currentTime: 8, paused: false, readyState: 1 } });
  const renewed = h.render();
  const nextSrc = original.replace("09d5eae9", "19d5eae9");
  h.render(nextSrc);
  renewed.props.onError({ currentTarget: { currentTime: 8, paused: false, error: { code: 2 } } });
  assert.equal(h.render(nextSrc).props.src, nextSrc);
});
