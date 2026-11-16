import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as dialogueSelection from '../../lib/inrAssistantStudioExactDialogue.ts';
import * as dialogueEditor from '../../lib/mediaExactDialogueEditor.ts';
import type { MediaExactDialogueCharacter, MediaExactDialogueRow } from '../../lib/mediaExactDialogueEditor.ts';
import { MEDIA_EXACT_DIALOGUE_MAX_ROWS } from '../../lib/mediaExactDialogueEditor.ts';
import { INR_ASSISTANT_STUDIO_EXACT_DIALOGUE_MAX_ROWS } from '../../lib/inrAssistantStudioExactDialogue.ts';

type Props = Record<string, unknown>;
type Element = { type: unknown; props: Props };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
type Entry = { snapshot: Props; enabled: boolean; locked: boolean; handlers: Record<string, { invoke(value: string | null): unknown; matches(snapshot: unknown, value: string | null): boolean }> };
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' && 'props' in tree ? [tree as Element, ...elements((tree as Element).props.children)] : [];
const encoded = (selection: unknown) => JSON.stringify(selection);

function harness(initialRows: MediaExactDialogueRow[] = [
  { id: 'line-a', speaker: 'ai_voice', text: 'Bonjour.' },
  { id: 'line-b', speaker: 'character', characterId: 'photo-b', text: 'Bienvenue.' },
], defaultSpeaker: 'ai_voice' | 'provided_voice' = 'ai_voice') {
  class NativeElement { isConnected = true; focus() {} }
  const slots: Slot[] = [], effects: Array<() => void> = [];
  let cursor = 0, dirty = false, tree: unknown, entry: Entry, pending: MediaExactDialogueRow[] | null = null, updates = 0;
  const dialog = { showModal() {}, close() {}, querySelector: () => ({ focus() {} }) };
  const props = { enabled: true, disabled: false, scopeKey: 'account-a', rows: structuredClone(initialRows), defaultSpeaker,
    characters: [{ id: 'photo-a', characterIndex: 1, referenceIndex: 0, name: 'Alex' }, { id: 'photo-b', characterIndex: 2, referenceIndex: 1, name: 'Léa' }] as MediaExactDialogueCharacter[],
    onChange(rows: MediaExactDialogueRow[]) { pending = rows; updates++; }, onOpenChange() {} };
  const effect = (callback: () => void | (() => void), deps: unknown[]) => {
    const slot = slots[cursor++] ||= {};
    if (!slot.deps || deps.length !== slot.deps.length || deps.some((value, index) => value !== slot.deps![index])) {
      slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; });
    }
  };
  const react = {
    useId: () => 'real-exact-dialogue', useEffect: effect, useLayoutEffect: effect,
    useRef(value: unknown) { return (slots[cursor++] ||= { value: { current: value } }).value; },
    useState(value: unknown) {
      const slot = slots[cursor++] ||= { value };
      return [slot.value, (next: unknown) => { const resolved = typeof next === 'function' ? (next as (previous: unknown) => unknown)(slot.value) : next; if (!Object.is(slot.value, resolved)) { slot.value = resolved; dirty = true; } }];
    },
  };
  const jsx = (type: unknown, nodeProps: Props) => {
    if (type === 'dialog' && nodeProps.ref) (nodeProps.ref as { current: unknown }).current = dialog;
    return { type, props: nodeProps || {} };
  };
  const imports: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-dom': { createPortal: (value: unknown) => value },
    'next-intl': { useTranslations: () => (key: string, values?: Props) => `${key}${values?.index ? `:${values.index}` : ''}` },
    './StudioExactDialogueEditor.module.css': { __esModule: true, default: new Proxy({}, { get: (_target, key) => key }) },
    '@/lib/inrAssistantStudioExactDialogue': dialogueSelection, '@/lib/mediaExactDialogueEditor': dialogueEditor,
    '../_hooks/useInrAssistantLocalInterface': { useInrAssistantLocalInterface(id: string, snapshot: Props, handlers: Entry['handlers'], enabled: boolean, locked: boolean) {
      assert.equal(id, 'studio_exact_dialogue'); entry = { snapshot, handlers, enabled, locked };
    } },
  };
  const file = 'app/dashboard/_components/StudioExactDialogueEditor.tsx';
  const output = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const record = { exports: {} as { default: (input: typeof props) => unknown } };
  new Function('module', 'exports', 'require', 'document', 'HTMLElement', output)(record, record.exports, (name: string) => { assert.ok(Object.hasOwn(imports, name), `Unexpected real dialogue dependency: ${name}`); return imports[name]; }, { body: {}, activeElement: null }, NativeElement);
  const component = record.exports.default;
  function render() {
    if (pending) { props.rows = pending; pending = null; }
    for (let count = 0; count < 12; count++) {
      cursor = 0; dirty = false; tree = component(props); effects.splice(0).forEach(callback => callback());
      if (!dirty) return;
    }
    throw new Error('Exact dialogue did not settle');
  }
  render();
  return {
    render, entry: () => entry, rows: () => props.rows, tree: () => tree, updates: () => updates,
    patch(value: Partial<typeof props>) { if (value.scopeKey && value.scopeKey !== props.scopeKey) pending = null; Object.assign(props, value); render(); },
    dispose() { for (const slot of slots) slot.cleanup?.(); },
  };
}

test('the real Exact dialogue native bridge commits row text speaker add remove and order only after render on captured line and photo IDs', () => {
  const h = harness();
  try {
    let entry = h.entry();
    assert.equal(entry.enabled, true); assert.equal(entry.snapshot.open, false);
    assert.throws(() => entry.handlers.select.invoke(encoded({ field: 'text', rowIndex: 0, value: 'Salut.' })), /unavailable/);
    const open = entry.handlers.open; open.invoke(null); assert.equal(open.matches(entry.snapshot, null), false);
    h.render(); entry = h.entry(); assert.equal(open.matches(entry.snapshot, null), true);
    assert.equal(elements(h.tree()).filter(node => node.props['data-exact-dialogue-row']).length, 2);
    assert.equal(elements(h.tree()).filter(node => node.type === 'textarea').length, 2);
    const text = encoded({ field: 'text', rowIndex: 1, value: 'Texte exact : ne rien inventer !' }), edit = entry.handlers.select;
    edit.invoke(text); assert.equal(edit.matches(entry.snapshot, text), false);
    h.render(); entry = h.entry(); assert.equal(edit.matches(entry.snapshot, text), true);
    assert.equal(h.rows()[1].id, 'line-b'); assert.equal(h.rows()[0].text, 'Bonjour.');
    const speaker = encoded({ field: 'speaker', rowIndex: 0, value: 'character:0' });
    entry.handlers.select.invoke(speaker); h.render(); entry = h.entry();
    assert.deepEqual(h.rows()[0], { id: 'line-a', speaker: 'character', characterId: 'photo-a', text: 'Bonjour.' });
    assert.equal(entry.handlers.select.matches(entry.snapshot, speaker), true);
    assert.equal(entry.handlers.select.matches({ ...entry.snapshot, characters: [{ id: 'replacement', characterIndex: 1, referenceIndex: 0 }] }, speaker), false);
    const move = encoded({ field: 'move', rowIndex: 1, value: 'up' });
    entry.handlers.select.invoke(move); h.render(); entry = h.entry();
    assert.deepEqual(h.rows().map(row => row.id), ['line-b', 'line-a']);
    assert.equal(entry.handlers.select.matches(entry.snapshot, move), true);
    assert.equal(entry.handlers.select.matches({ ...entry.snapshot, rows: [...h.rows()].reverse() }, move), false, 'the same rows in a different order never acknowledge the requested move');
    assert.equal(entry.handlers.select.matches({ ...entry.snapshot, rows: h.rows().map(row => ({ ...row, id: `replacement-${row.id}` })) }, move), false);
    const add = encoded({ field: 'add' }); entry.handlers.select.invoke(add); h.render(); entry = h.entry();
    const added = h.rows()[2]; assert.equal(added.speaker, 'ai_voice'); assert.equal(added.text, ''); assert.ok(!['line-a', 'line-b'].includes(added.id));
    assert.equal(entry.handlers.select.matches(entry.snapshot, add), true);
    const remove = encoded({ field: 'remove', rowIndex: 2 }); entry.handlers.select.invoke(remove); h.render(); entry = h.entry();
    assert.deepEqual(h.rows().map(row => row.id), ['line-b', 'line-a']); assert.equal(entry.handlers.select.matches(entry.snapshot, remove), true);
    const close = entry.handlers.close; close.invoke(null); assert.equal(close.matches(entry.snapshot, null), false);
    h.render(); assert.equal(close.matches(h.entry().snapshot, null), true);
  } finally { h.dispose(); }
});

test('the real Exact dialogue native bridge refuses unavailable speakers limits locks and late account acknowledgments without external effects', () => {
  assert.equal(INR_ASSISTANT_STUDIO_EXACT_DIALOGUE_MAX_ROWS, MEDIA_EXACT_DIALOGUE_MAX_ROWS);
  const h = harness();
  try {
    h.entry().handlers.open.invoke(null); h.render(); let entry = h.entry();
    const count = h.updates();
    for (const selection of [{ field: 'speaker', rowIndex: 0, value: 'character:2' }, { field: 'remove', rowIndex: 7 }, { field: 'text', rowIndex: 0, value: 'x'.repeat(4000) }, { field: 'move', rowIndex: 0, value: 'up' }, { field: 'text', rowIndex: 0, value: 'Changed', consent: true }]) assert.throws(() => entry.handlers.select.invoke(encoded(selection)));
    assert.equal(h.updates(), count, 'invalid actions cannot partially alter the draft');
    const text = encoded({ field: 'text', rowIndex: 0, value: 'La même personne.' });
    entry.handlers.select.invoke(text); h.render(); entry = h.entry(); const action = entry.handlers.select;
    assert.equal(action.matches(entry.snapshot, text), true);
    assert.equal(action.matches({ ...entry.snapshot, scopeKey: 'account-b' }, text), false);
    assert.equal(action.matches({ ...entry.snapshot, locked: true }, text), false);
    h.patch({ disabled: true }); entry = h.entry(); assert.equal(entry.locked, true);
    for (const method of ['open', 'close', 'select']) assert.throws(() => entry.handlers[method].invoke(method === 'select' ? text : null));
    h.patch({ disabled: false, rows: Array.from({ length: 12 }, (_, index) => ({ id: `row-${index}`, speaker: 'ai_voice' as const, text: '' })) });
    entry = h.entry(); assert.throws(() => entry.handlers.select.invoke(encoded({ field: 'add' })), /limit/);
    h.patch({ scopeKey: 'account-b', rows: [] }); entry = h.entry();
    assert.equal(entry.snapshot.open, false); assert.equal(action.matches(entry.snapshot, text), false);
    assert.deepEqual(h.rows(), []);
  } finally { h.dispose(); }
});

test('the real Exact editor preserves an explicitly selected personal narrator without a photo or an AI replacement', () => {
  const h = harness([], 'provided_voice');
  try {
    h.patch({ characters: [] });
    h.entry().handlers.open.invoke(null); h.render(); let entry = h.entry();
    assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].speaker, 'provided_voice'); assert.equal(h.rows()[0].text, '');
    const id = h.rows()[0].id;
    const text = encoded({ field: 'text', rowIndex: 0, value: 'Une voix réelle déjà choisie.' });
    entry.handlers.select.invoke(text); h.render(); entry = h.entry();
    assert.equal(entry.handlers.select.matches(entry.snapshot, text), true);
    assert.deepEqual(h.rows()[0], { id, speaker: 'provided_voice', text: 'Une voix réelle déjà choisie.' });
    const speaker = encoded({ field: 'speaker', rowIndex: 0, value: 'provided_voice' });
    entry.handlers.select.invoke(speaker); h.render(); entry = h.entry();
    assert.equal(entry.handlers.select.matches(entry.snapshot, speaker), true);
    assert.equal(h.rows()[0].characterId, undefined);
    assert.equal(elements(h.tree()).some(node => node.type === 'option' && node.props.value === 'provided_voice'), true);
  } finally { h.dispose(); }
});
