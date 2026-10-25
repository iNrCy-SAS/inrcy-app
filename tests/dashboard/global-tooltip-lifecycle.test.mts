import assert from "node:assert/strict";
import test from "node:test";
import { createInrcyTooltipController, type InrcyTooltipState } from "../../lib/inrcyTooltip.ts";

/** Minimal local DOM, with actual mutation batching and owned listener/timer
 * lifecycles. No browser, application session, network or framework mock. */
function localDom() {
  type LocalEvent = { target: LocalElement; relatedTarget?: LocalElement; pointerType?: string; key?: string; defaultPrevented: boolean; stopped: boolean; preventDefault: () => void; stopImmediatePropagation: () => void };
  type Mutation = { type: string; target: LocalElement | { nodeType: number; parentElement: LocalElement }; attributeName?: string; oldValue?: string | null; addedNodes: LocalElement[] };
  class Events {
    listeners = new Map<string, Set<(_event: LocalEvent) => void>>();
    addEventListener(type: string, callback: (_event: LocalEvent) => void) { const set = this.listeners.get(type) ?? new Set(); set.add(callback); this.listeners.set(type, set); }
    removeEventListener(type: string, callback: (_event: LocalEvent) => void) { this.listeners.get(type)?.delete(callback); }
    dispatch(type: string, target: LocalElement, detail: Partial<LocalEvent> = {}) {
      const event: LocalEvent = { target, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...detail };
      for (const callback of this.listeners.get(type) ?? []) { callback(event); if (event.stopped) break; }
      return event;
    }
    countListeners() { return [...this.listeners.values()].reduce((total, set) => total + set.size, 0); }
  }

  const observers: LocalObserver[] = [];
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const frames = new Map<number, () => void>();
  const win = Object.assign(new Events(), {
    matchMedia: () => ({ matches: true }), location: { href: "https://local.invalid/dashboard" },
    setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    requestAnimationFrame: (callback: () => void) => { const id = ++nextTimer; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  });

  class LocalElement {
    nodeType = 1;
    tagName: string;
    attributes = new Map<string, string>();
    children: LocalElement[] = [];
    parentElement: LocalElement | null = null;
    ownerDocument: typeof doc;
    ownText = "";
    constructor(tag: string) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; }
    get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join(""); }
    get isConnected(): boolean { return doc.documentElement.contains(this); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    hasAttribute(name: string) { return this.attributes.has(name); }
    setAttribute(name: string, value: string) { const oldValue = this.getAttribute(name); this.attributes.set(name, value); enqueue({ type: "attributes", target: this, attributeName: name, oldValue, addedNodes: [] }); }
    removeAttribute(name: string) { if (!this.hasAttribute(name)) return; const oldValue = this.getAttribute(name); this.attributes.delete(name); enqueue({ type: "attributes", target: this, attributeName: name, oldValue, addedNodes: [] }); }
    setText(value: string) { this.ownText = value; enqueue({ type: "characterData", target: { nodeType: 3, parentElement: this }, addedNodes: [] }); }
    append(child: LocalElement) { child.parentElement = this; this.children.push(child); enqueue({ type: "childList", target: this, addedNodes: [child] }); }
    contains(child: LocalElement | null): boolean { return child === this || this.children.some((element) => element.contains(child)); }
    matches(selector: string): boolean {
      return selector.split(",").some((part) => {
        let clause = part.trim();
        const not = clause.match(/:not\((.+)\)$/u);
        if (not) { if (this.matches(not[1])) return false; clause = clause.slice(0, not.index); }
        const descendant = clause.match(/^(\w+) (\w+)$/u);
        if (descendant) return this.tagName.toLowerCase() === descendant[2] && Boolean(this.parentElement?.closest(descendant[1]));
        const tag = clause.match(/^[\w-]+/u)?.[0];
        if (tag && tag !== this.tagName.toLowerCase()) return false;
        return [...clause.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/gu)].every((match) => this.hasAttribute(match[1]) && (match[2] === undefined || this.getAttribute(match[1]) === match[2]));
      });
    }
    closest<T = LocalElement>(selector: string): T | null { return (this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null) as T | null; }
    querySelectorAll(selector: string): LocalElement[] { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
    getBoundingClientRect() { return { left: 100, top: 100, right: 140, bottom: 130, width: 40, height: 30 }; }
  }

  const doc = Object.assign(new Events(), { defaultView: win }) as Events & { defaultView: typeof win; body: LocalElement; documentElement: LocalElement; querySelectorAll: (_selector: string) => LocalElement[]; getElementById: (_id: string) => LocalElement | null };
  doc.documentElement = new LocalElement("html");
  doc.body = new LocalElement("body");
  doc.documentElement.append(doc.body);
  doc.querySelectorAll = (selector) => [...(doc.documentElement.matches(selector) ? [doc.documentElement] : []), ...doc.documentElement.querySelectorAll(selector)];
  doc.getElementById = (id) => doc.querySelectorAll("[id]").find((element) => element.getAttribute("id") === id) ?? null;

  class LocalObserver {
    callback: (_mutations: MutationRecord[]) => void;
    root: LocalElement | null = null;
    filter: string[] = [];
    kinds = new Set<string>();
    queued: Mutation[] = [];
    constructor(callback: (_mutations: MutationRecord[]) => void) { this.callback = callback; observers.push(this); }
    observe(root: LocalElement, options: { attributeFilter: string[]; attributes?: boolean; childList?: boolean; characterData?: boolean }) {
      this.root = root; this.filter = options.attributeFilter;
      this.kinds = new Set(["attributes", "childList", "characterData"].filter((kind) => options[kind as "attributes" | "childList" | "characterData"]));
    }
    disconnect() { this.root = null; this.queued = []; }
    takeRecords() { const records = this.queued; this.queued = []; return records as unknown as MutationRecord[]; }
  }
  Object.assign(win, { MutationObserver: LocalObserver });
  function enqueue(mutation: Mutation) {
    for (const observer of observers) {
      const target = mutation.target.nodeType === 1 ? mutation.target as LocalElement : mutation.target.parentElement;
      if (observer.kinds.has(mutation.type) && observer.root?.contains(target) && (mutation.type !== "attributes" || observer.filter.includes(mutation.attributeName!))) observer.queued.push(mutation);
    }
  }
  function flushMutations() {
    for (let pass = 0; pass < 20; pass += 1) {
      const pending = observers.filter((observer) => observer.root && observer.queued.length);
      if (!pending.length) return;
      pending.forEach((observer) => observer.callback(observer.takeRecords()));
    }
    assert.fail("Tooltip mutation handling must settle without a loop");
  }
  function button(title: string, text = "⚙") { const button = new LocalElement("button"); button.setAttribute("title", title); button.ownText = text; doc.body.append(button); return button; }
  function controller() {
    const changes: (InrcyTooltipState | null)[] = [];
    const controller = createInrcyTooltipController({ document: doc as unknown as Document, onChange: (state) => { changes.push(state); }, getBubble: () => null });
    return { ...controller, changes };
  }
  function hover(element: LocalElement) { doc.dispatch("pointerover", element, { pointerType: "mouse" }); [...timers.values()].forEach((callback) => callback()); timers.clear(); }
  return { doc, win, timers, frames, button, controller, flushMutations, hover };
}

for (const clear of ["empty", "remove"] as const) {
  test(`React ${clear === "empty" ? "empty title" : "removed title"} removes stale tooltip and injected accessible name`, () => {
    const dom = localDom();
    const button = dom.button("Réglages");
    const controller = dom.controller();
    assert.equal(button.getAttribute("aria-label"), "Réglages");
    if (clear === "empty") button.setAttribute("title", ""); else button.removeAttribute("title");
    dom.flushMutations();
    assert.equal(button.hasAttribute("data-inrcy-tooltip-managed"), false);
    assert.equal(button.hasAttribute("aria-label"), false);
    dom.hover(button);
    assert.deepEqual(controller.changes, []);
    controller.destroy();
    assert.equal(button.getAttribute("title"), clear === "empty" ? "" : null);
  });
}

test("one React batch can replace data-tooltip and title without losing the new label", () => {
  const dom = localDom(); const button = dom.button("Ancien");
  button.setAttribute("data-tooltip", "Créer"); button.setAttribute("data-tooltip-description", "Une publication.");
  const controller = dom.controller(); dom.hover(button);
  button.removeAttribute("data-tooltip"); button.removeAttribute("data-tooltip-description"); button.setAttribute("title", "Nouveau");
  dom.flushMutations();
  assert.equal(controller.changes.at(-1)?.label, "Nouveau");
  assert.equal(controller.changes.at(-1)?.description, undefined);
  assert.equal(button.getAttribute("aria-label"), "Nouveau");
  controller.destroy();
});

test("cleanup drains a title cleared in the current commit before restoring attributes", () => {
  const dom = localDom(); const button = dom.button("Réglages"); const controller = dom.controller();
  button.setAttribute("title", "");
  controller.destroy(); // No MutationObserver delivery between commit and cleanup.
  assert.equal(button.getAttribute("title"), "");
  assert.equal(button.hasAttribute("aria-label"), false);
  assert.equal(button.hasAttribute("data-inrcy-tooltip-managed"), false);
});

test("StrictMode setup/cleanup/setup restores titles and owns exactly one listener set", () => {
  const dom = localDom(); const button = dom.button("Réglages"); const first = dom.controller();
  dom.hover(button); assert.ok(dom.frames.size > 0);
  first.destroy();
  assert.equal(button.getAttribute("title"), "Réglages"); assert.equal(button.hasAttribute("aria-label"), false);
  assert.equal(dom.doc.countListeners(), 0); assert.equal(dom.win.countListeners(), 0);
  assert.equal(dom.timers.size, 0); assert.equal(dom.frames.size, 0);
  const second = dom.controller(); const listeners = dom.doc.countListeners();
  first.destroy(); // Cleanup must also be idempotent after a subsequent setup.
  assert.equal(dom.doc.countListeners(), listeners); assert.equal(dom.doc.documentElement.hasAttribute("data-inrcy-tooltips-ready"), true);
  dom.hover(button); assert.equal(second.changes.filter(Boolean).length, 1);
  second.destroy(); assert.equal(dom.doc.countListeners(), 0);
});

test("visible button text replaces an injected icon label when React changes its content", () => {
  const dom = localDom(); const button = dom.button("Ouvrir le planning"); const controller = dom.controller();
  assert.equal(button.getAttribute("aria-label"), "Ouvrir le planning");
  button.setAttribute("aria-describedby", "temporary-tooltip");
  button.setText("Planning"); dom.flushMutations();
  assert.equal(button.hasAttribute("aria-label"), false); assert.equal(button.getAttribute("aria-description"), "Ouvrir le planning");
  button.removeAttribute("aria-describedby");
  assert.equal(button.getAttribute("aria-description"), "Ouvrir le planning");
  button.setText("▦"); dom.flushMutations();
  assert.equal(button.getAttribute("aria-label"), "Ouvrir le planning"); assert.equal(button.hasAttribute("aria-description"), false);
  controller.destroy();
});

test("application-owned accessible labels survive updates and cleanup", () => {
  const dom = localDom(); const button = dom.button("Description du canal"); button.setAttribute("aria-label", "Nom existant");
  const controller = dom.controller();
  assert.equal(button.getAttribute("aria-label"), "Nom existant");
  button.setAttribute("aria-label", "Nouveau nom"); button.setAttribute("title", "Nouvelle description"); dom.flushMutations();
  assert.equal(button.getAttribute("aria-label"), "Nouveau nom");
  assert.equal(button.getAttribute("aria-description"), "Nouvelle description");
  controller.destroy(); assert.equal(button.getAttribute("aria-label"), "Nouveau nom"); assert.equal(button.hasAttribute("aria-description"), false);
});

test("pointerdown and click dismiss tooltip without cancelling or stopping application clicks", () => {
  const dom = localDom(); const button = dom.button("Réglages"); const controller = dom.controller(); dom.hover(button);
  let calls = 0; const applicationClick = () => { calls += 1; }; dom.doc.addEventListener("click", applicationClick);
  const down = dom.doc.dispatch("pointerdown", button, { pointerType: "mouse" });
  const click = dom.doc.dispatch("click", button);
  assert.equal(down.defaultPrevented, false); assert.equal(down.stopped, false);
  assert.equal(click.defaultPrevented, false); assert.equal(click.stopped, false); assert.equal(calls, 1);
  assert.equal(controller.changes.at(-1), null);
  dom.doc.removeEventListener("click", applicationClick); controller.destroy();
});
