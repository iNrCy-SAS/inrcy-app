import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseMediaSoundtrackOptions } from "../../lib/mediaSoundtrackSelection.ts";

const source = readFileSync(new URL("../../app/dashboard/_components/MediaSoundtrackSelector.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("MediaSoundtrackSelector.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let registration: ts.CallExpression | undefined;
const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalInterface") registration = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(registration);
function actual<T>(index: number, deps: Record<string, unknown>): T { const compiled = ts.transpileModule(`(${registration!.arguments[index].getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, ""); return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as T; }
type Handler = { invoke: (value: string | null) => void | Promise<void>; matches: (state: unknown, value: string | null) => boolean };
const tracks = parseMediaSoundtrackOptions({ ok: true, soundtracks: [{ id: "native-song", label: "Musique native", description: "Catalogue iNrCy", durationSeconds: 24, audioPreview: "/api/booster/soundtracks/native-song/preview?v=24" }] });

test("the actual Booster soundtrack handlers choose only the native channel catalogue and await its controlled saved selection", async () => {
  let soundtrackId: string | null = null, open = false;
  const pending: Array<() => void> = [], choices = [{ id: null, disabled: false }, { id: "legacy-removed", disabled: true }, { id: tracks[0].id, disabled: false }];
  const deps = { disabled: false, loading: false, unavailableHint: "", inline: true, open: false, showUnavailableHint: false, assistantSoundtrackReady: true, selected: undefined, playingId: null, loadError: false, choices,
    openInlineList: () => pending.push(() => { open = true; }), close: () => pending.push(() => { open = false; }), pickChoice: (index: number) => pending.push(() => { soundtrackId = choices[index].id; }),
  };
  const handlers = actual<Record<string, Handler>>(2, deps);
  handlers.open.invoke(null); pending.splice(0).forEach(commit => commit()); assert.equal(handlers.open.matches({ open }, null), true);
  handlers.select.invoke("native-song"); assert.equal(handlers.select.matches({ soundtrackId }, "native-song"), false); pending.splice(0).forEach(commit => commit()); assert.equal(handlers.select.matches({ soundtrackId }, "native-song"), true);
  for (const value of ["invented", "legacy-removed", "https://foreign.test/audio.mp3", "javascript:alert(1)"]) assert.throws(() => handlers.select.invoke(value), value);
  handlers.select.invoke("auto"); pending.splice(0).forEach(commit => commit()); assert.equal(soundtrackId, null);
  assert.equal(actual<Record<string, Handler>>(2, { ...deps, assistantSoundtrackReady: false }).select, undefined, "native lock/unavailability cannot be bypassed");
  assert.equal(actual<boolean>(3, { assistantUiScope: undefined, assistantChannel: "facebook" }), false, "Agent auto-save consumers are not registered by this local Booster driver");
  assert.equal(actual<boolean>(3, { assistantUiScope: "booster", assistantChannel: "linkedin" }), false); assert.equal(actual<boolean>(3, { assistantUiScope: "booster", assistantChannel: "instagram" }), true);
  assert.equal(actual<boolean>(3, { assistantUiScope: "scheduled", assistantChannel: "facebook" }), true, "only the local scheduled-edit consumer explicitly opts in, never the immediate-saving Agent consumer");
});

test("the actual soundtrack playback handler requires real audio playback and a committed play event, never a fabricated URL", async () => {
  const audio = { paused: true }, playingRef = { current: null as string | null }; let denied = true;
  const handlers = actual<Record<string, Handler>>(2, { disabled: false, loading: false, unavailableHint: "", open: true, showUnavailableHint: false, inline: true, assistantSoundtrackReady: true, selected: tracks[0], playingId: "native-song", loadError: false,
    close: () => {}, audioRef: { current: audio }, playingRef, preview: async (track: { id: string }) => { assert.equal(track.id, "native-song"); playingRef.current = track.id; audio.paused = denied; }, stopPreview: () => { audio.paused = true; playingRef.current = null; },
  });
  await assert.rejects(async () => handlers.play.invoke(null), /playback_unconfirmed/); denied = false; playingRef.current = null; await handlers.play.invoke(null);
  assert.equal(handlers.play.matches({ playingId: "native-song", playbackActive: false }, null), false); assert.equal(handlers.play.matches({ playingId: "native-song", playbackActive: true }, null), true);
  handlers.stop.invoke(null); assert.equal(audio.paused, true); assert.equal(handlers.stop.matches({ playingId: null, playbackActive: false }, null), true);
});

test("the actual soundtrack retry waits for its fresh native load attempt and same scoped catalogue", () => {
  let attempt = 2; const loadedScopeRef = { current: "scope:facebook" };
  const deps = { disabled: false, loading: false, unavailableHint: "", open: true, showUnavailableHint: false, inline: true, assistantSoundtrackReady: false, selected: undefined, playingId: null, loadError: true, selectionLocked: false, loadAttempt: attempt, loadedScopeRef,
    close: () => {}, setLoadAttempt: (update: (value: number) => number) => { attempt = update(attempt); },
  };
  const retry = actual<Record<string, Handler>>(2, deps).retry; retry.invoke(null); assert.equal(loadedScopeRef.current, null); assert.equal(attempt, 3);
  assert.equal(retry.matches({ loadAttempt: 3, ready: false }, null), false); assert.equal(retry.matches({ loadAttempt: 2, ready: true }, null), false); assert.equal(retry.matches({ loadAttempt: 3, ready: true }, null), true);
  const snapshot = (catalogueLoaded: unknown, loadAttempt: number) => actual<Record<string, unknown>>(1, { open: true, showUnavailableHint: false, soundtrackId: null, playingId: null, playbackActive: false, loadAttempt, catalogueLoaded, scopeKey: "scope:facebook", loading: false, loadError: false, tracks, selectionLocked: false, disabled: false, unavailableHint: "" });
  assert.equal(snapshot({ scopeKey: "scope:facebook", attempt: 2 }, 3).ready, false); assert.equal(snapshot({ scopeKey: "other:instagram", attempt: 3 }, 3).ready, false); assert.equal(snapshot({ scopeKey: "scope:facebook", attempt: 3 }, 3).ready, true);
});
