import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

// Execute the production component with deterministic hook/DOM/network adapters.
// No browser, live account, external request, or payment is used by these contracts.
function clientHarness({ platform = "web", catalogueOrders = [], settingsMessages = null } = {}) {
  let current;
  let accountId = "account-a";
  let searchParams = new URLSearchParams();
  const actorAuthUserId = "actor";
  const storage = new Map();
  const listeners = new Map();
  const calls = [];
  const paymentTabs = [];
  const actions = [];
  let focusedId = null;
  const translate = (key, values) => settingsMessages
    ? settingsMessages[key] ?? key
    : `${key}${values ? ` ${JSON.stringify(values)}` : ""}`;
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    Suspense: "suspense",
    useState(initial) {
      const owner = current;
      const index = owner.index++;
      if (!owner.slots[index]) {
        const slot = { value: typeof initial === "function" ? initial() : initial };
        slot.set = (update) => {
          const next = typeof update === "function" ? update(slot.value) : update;
          if (!Object.is(next, slot.value)) { slot.value = next; owner.dirty = true; }
        };
        owner.slots[index] = slot;
      }
      const slot = owner.slots[index];
      return [slot.value, slot.set];
    },
    useRef(value) {
      const owner = current;
      const index = owner.index++;
      owner.slots[index] ??= { value: { current: value } };
      return owner.slots[index].value;
    },
    useId() {
      const owner = current;
      const index = owner.index++;
      owner.slots[index] ??= { value: `test-${index}` };
      return owner.slots[index].value;
    },
    useCallback(callback, deps) {
      const owner = current;
      const index = owner.index++;
      if (!sameDeps(owner.slots[index]?.deps, deps)) owner.slots[index] = { value: callback, deps };
      return owner.slots[index].value;
    },
    useEffect(callback, deps) {
      const owner = current;
      const index = owner.index++;
      const previous = owner.slots[index];
      if (!sameDeps(previous?.deps, deps)) {
        owner.effects.push(() => {
          previous?.cleanup?.();
          const slot = { deps, cleanup: undefined };
          owner.slots[index] = slot;
          slot.cleanup = callback();
        });
      }
    },
  };
  const walk = function* (node) {
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
    if (!node || typeof node !== "object" || !("type" in node)) return;
    yield node;
    yield* walk(node.props.children);
  };
  const dialogNode = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const attachRefs = (tree) => {
    for (const node of walk(tree)) {
      const ref = node.props.ref;
      if (!ref) continue;
      const element = node.type === "dialog" ? dialogNode : { focus: () => { focusedId = node.props.id; } };
      if (typeof ref === "function") ref(element);
      else ref.current = element;
    }
  };
  const render = (component, props = {}) => {
    const owner = { component, props, slots: [], effects: [], index: 0, dirty: true, tree: null };
    owner.render = () => {
      let renders = 0;
      do {
        assert.ok(++renders < 20, "hook adapter must settle");
        owner.dirty = false;
        owner.index = 0;
        current = owner;
        owner.tree = owner.component(owner.props);
        current = null;
        attachRefs(owner.tree);
        for (const effect of owner.effects.splice(0)) effect();
      } while (owner.dirty);
      return owner.tree;
    };
    owner.flush = async () => {
      for (let index = 0; index < 4; index++) {
        await new Promise((resolve) => setImmediate(resolve));
        if (owner.dirty) owner.render();
      }
    };
    owner.dispose = () => { for (const slot of owner.slots) slot?.cleanup?.(); };
    owner.render();
    return owner;
  };
  const modules = new Map();
  const response = (body, ok = true) => ({ ok, json: async () => body });
  const environment = {
    exports: {},
    URL,
    crypto: { randomUUID },
    document: { body: {} },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    window: {
      addEventListener(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); },
      removeEventListener(event, listener) { listeners.get(event)?.delete(listener); },
      open(url, target) {
        actions.push(["open", url, target]);
        const paymentTab = { opener: {}, closed: false, location: { href: url }, close() { this.closed = true; } };
        paymentTabs.push(paymentTab);
        return paymentTab;
      },
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (init?.method === "POST") { actions.push(["post", url]); return environment.checkout(url, init); }
      if (url === "/api/media-generation/quota") return response(environment.quota);
      if (/^\/api\/boutique\/(?:image|video)-credits\/orders\//.test(url)) return environment.readOrder(url, init);
      const packs = url === "/api/boutique/image-credits" ? modules.get("@/lib/boutique/imageCreditPacks").IMAGE_CREDIT_PACKS : modules.get("@/lib/boutique/videoCreditPacks").VIDEO_CREDIT_PACKS;
      assert.ok(["/api/boutique/image-credits", "/api/boutique/video-credits"].includes(url), `unexpected request: ${url}`);
      return response({ accountId, actorAuthUserId, canPurchase: true, packs: packs.map((pack) => ({ key: pack.key, available: true })), orders: catalogueOrders });
    },
    checkout: async () => response({ url: "https://checkout.stripe.com/c/pay/test" }),
    readOrder: async () => response({ order: { granted: false } }),
    quota: { quota: { unlimited: false, image: { remaining: 17, includedRemaining: 10, purchasedRemaining: 7, purchasedDebt: 2, purchasedHeld: 3 }, video: { remaining: 96, includedRemaining: 46, purchasedRemaining: 50, purchasedDebt: 0, purchasedHeld: 0 } } },
  };
  const require = (name) => {
    if (modules.has(name)) return modules.get(name);
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "react-dom") return { createPortal: (children) => jsx("portal", { children }) };
    if (name === "next-intl") return { useLocale: () => "fr-FR", useTranslations: () => translate };
    if (name === "next/navigation") return { useSearchParams: () => searchParams };
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name === "@/lib/clientSubscriptionBilling") return { detectClientBillingPlatform: () => platform };
    if (name === "@/lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_EVENT: "active-account" };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw new Error(`Unexpected component dependency: ${name}`);
  };
  const execute = (file) => {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.resolve(file), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(compiled, { ...environment, exports, require }, { filename: file });
    return exports;
  };
  for (const name of ["videoCreditPacks", "imageCreditPacks"]) modules.set(`@/lib/boutique/${name}`, execute(`lib/boutique/${name}.ts`));
  const components = execute("app/dashboard/_components/VideoCreditRecharge.tsx");
  modules.set("@/app/dashboard/_components/VideoCreditRecharge", components);
  const panel = (kind) => {
    const element = components[kind === "image" ? "ImageCreditPacksPanel" : "VideoCreditPacksPanel"]({});
    return render(element.type, element.props);
  };
  const find = (tree, predicate) => [...walk(tree)].find(predicate);
  const packButton = (owner, key) => find(find(owner.tree, (node) => node.type === "article" && node.key === key), (node) => node.type === "button");
  return { components, environment, calls, actions, storage, paymentTabs, render, panel, find, packButton, walk,
    rechargeReturn() {
      const page = execute("app/dashboard/boutique/recharges/page.tsx").default();
      const element = page.props.children;
      return render(element.type, element.props);
    },
    setSearchParams(value) { searchParams = new URLSearchParams(value); },
    focused: () => focusedId, dialog: dialogNode,
    changeAccount(next) { accountId = next; for (const listener of listeners.get("active-account") ?? []) listener(); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("image packs render image quantities and route payment through the image endpoint", async () => {
  const h = clientHarness({ catalogueOrders: [{ id: "order", pack_key: "image_20", request_key: "previous", images: 20, amount_ht_cents: 500, status: "paid", granted_at: "2026-10-11T12:00:00Z", held_images: 2, revoked_images: 0, dispute_revoked_images: 0, created_at: "2026-10-11T12:00:00Z" }] });
  const owner = h.panel("image");
  await owner.flush();
  assert.equal(h.calls[0].url, "/api/boutique/image-credits");
  const packs = [...h.walk(owner.tree)].filter((node) => node.type === "article");
  assert.deepEqual(packs.map((node) => node.key), ["image_20", "image_50", "image_100"]);
  for (const [index, images] of [20, 50, 100].entries()) assert.ok(JSON.stringify(packs[index]).includes(`\\"images\\":${images}`));
  assert.ok(JSON.stringify(owner.tree).includes("video_credit_disputed"), "history must read held_images");
  h.packButton(owner, "image_20").props.onClick();
  await owner.flush();
  const request = h.calls.find((call) => call.init?.method === "POST");
  assert.equal(request.url, "/api/boutique/image-credits/checkout");
  assert.deepEqual(Object.keys(JSON.parse(request.init.body)).sort(), ["accountId", "packKey", "requestKey"]);
  assert.equal(JSON.parse(request.init.body).accountId, "account-a");
  assert.equal(JSON.parse(request.init.body).packKey, "image_20");
  assert.deepEqual(h.actions[0], ["open", "about:blank", "_blank"]);
  assert.equal(h.actions[1][0], "post");
  assert.equal(h.paymentTabs[0].opener, null);
  assert.equal(h.paymentTabs[0].location.href, "https://checkout.stripe.com/c/pay/test");
  owner.dispose();
});

test("uncertain retries retain image request keys and preserve the existing video storage namespace", async () => {
  const h = clientHarness();
  const image = h.panel("image");
  await image.flush();
  h.environment.checkout = async () => { throw new Error("synthetic network loss"); };
  h.packButton(image, "image_20").props.onClick();
  await image.flush();
  const imageKey = "inrcy:image-credit-checkout:v1:account-a:actor:image_20";
  const requestKey = h.storage.get(imageKey);
  assert.ok(requestKey);
  assert.equal(h.paymentTabs[0].closed, true);
  h.environment.checkout = async () => ({ ok: true, json: async () => ({ url: "https://untrusted.example/checkout" }) });
  h.packButton(image, "image_20").props.onClick();
  await image.flush();
  const imagePosts = h.calls.filter((call) => call.init?.method === "POST");
  assert.equal(JSON.parse(imagePosts[0].init.body).requestKey, JSON.parse(imagePosts[1].init.body).requestKey);
  assert.equal(h.storage.get(imageKey), requestKey);
  assert.equal(h.paymentTabs[1].closed, true, "untrusted redirect must remain blocked");
  const videoKey = "inrcy:video-credit-checkout:v1:account-a:actor:video_50";
  const priorVideoRequest = randomUUID();
  h.storage.set(videoKey, priorVideoRequest);
  const video = h.panel("video");
  await video.flush();
  h.packButton(video, "video_50").props.onClick();
  await video.flush();
  const request = h.calls.filter((call) => call.init?.method === "POST").at(-1);
  assert.equal(request.url, "/api/boutique/video-credits/checkout");
  assert.equal(JSON.parse(request.init.body).requestKey, priorVideoRequest);
  assert.equal(h.storage.get(imageKey), requestKey);
  image.dispose(); video.dispose();
});

test("an old account checkout cannot navigate or unlock a newer account purchase", async () => {
  const h = clientHarness();
  const owner = h.panel("image");
  await owner.flush();
  const first = deferred();
  const second = deferred();
  let count = 0;
  h.environment.checkout = () => (++count === 1 ? first.promise : second.promise);
  h.packButton(owner, "image_20").props.onClick();
  h.changeAccount("account-b");
  await owner.flush();
  h.packButton(owner, "image_20").props.onClick();
  await owner.flush();
  first.resolve({ ok: true, json: async () => ({ url: "https://checkout.stripe.com/c/pay/old-account" }) });
  await owner.flush();
  assert.equal(h.paymentTabs[0].closed, true);
  assert.equal(h.paymentTabs[0].location.href, "about:blank");
  assert.equal(h.packButton(owner, "image_20").props.disabled, true, "old finally must not clear the new busy state");
  second.resolve({ ok: true, json: async () => ({ url: "https://checkout.stripe.com/c/pay/new-account" }) });
  await owner.flush();
  assert.equal(h.paymentTabs[1].closed, false);
  assert.equal(h.paymentTabs[1].location.href, "https://checkout.stripe.com/c/pay/new-account");
  assert.equal(h.packButton(owner, "image_20").props.disabled, false);
  const posts = h.calls.filter((call) => call.init?.method === "POST");
  assert.deepEqual(posts.map((call) => JSON.parse(call.init.body).accountId), ["account-a", "account-b"]);
  owner.dispose();
});

test("image balance reads only the image allowance, purchased debt and dispute hold", async () => {
  const h = clientHarness();
  const element = h.components.ImageCreditBalance();
  const owner = h.render(element.type, element.props);
  await owner.flush();
  const text = JSON.stringify(owner.tree);
  assert.ok(text.includes("media_credit_included") && text.includes('\\"images\\":10'));
  assert.ok(text.includes("media_credit_purchased") && text.includes('\\"images\\":7'));
  assert.ok(text.includes("image_credit_debt") && text.includes('\\"images\\":2'));
  assert.ok(text.includes("image_credit_held") && text.includes('\\"images\\":3'));
  assert.ok(!text.includes("video_credit_available"));
  assert.ok(!text.includes("image_credit_available") && !text.includes('\\"images\\":17'), "do not present a combined total as the monthly allowance");
  owner.dispose();
});

test("shared dialog starts on the requested kind, exposes keyboard tabs and resets on reopening", async () => {
  const h = clientHarness();
  assert.equal(h.components.VideoCreditRechargeButton, h.components.MediaCreditRechargeButton);
  const owner = h.render(h.components.MediaCreditRechargeButton, { mediaKind: "image" });
  const tabs = () => [...h.walk(owner.tree)].filter((node) => node.props.role === "tab");
  assert.deepEqual(tabs().map((node) => node.props["aria-selected"]), [false, true]);
  assert.deepEqual(tabs().map((node) => node.props.tabIndex), [-1, 0]);
  const dialog = h.find(owner.tree, (node) => node.type === "dialog");
  assert.ok(h.find(owner.tree, (node) => node.props.id === dialog.props["aria-labelledby"]));
  const tabPanel = () => h.find(owner.tree, (node) => node.props.role === "tabpanel");
  assert.equal(tabPanel().props["aria-labelledby"], tabs()[1].props.id);
  assert.equal(tabPanel().props.children.props.mediaKind, "image");
  let prevented = false;
  tabs()[1].props.onKeyDown({ key: "Home", preventDefault: () => { prevented = true; } });
  await owner.flush();
  assert.equal(prevented, true);
  assert.equal(tabs()[0].props["aria-selected"], true);
  assert.equal(h.focused(), tabs()[0].props.id);
  const trigger = h.find(owner.tree, (node) => node.type === "button" && node.props["aria-haspopup"] === "dialog");
  trigger.props.onClick();
  await owner.flush();
  assert.equal(h.dialog.open, true);
  assert.equal(tabs()[1].props["aria-selected"], true);
  assert.equal(tabPanel().props.children.props.mediaKind, "image");
  owner.dispose();
  const native = clientHarness({ platform: "ios" });
  const nativeOwner = native.render(native.components.MediaCreditRechargeButton, { mediaKind: "image" });
  assert.equal(nativeOwner.tree, null);
  assert.equal(native.calls.length, 0);
  nativeOwner.dispose();
});

test("tabs stay locked until the current checkout request completes", async () => {
  const h = clientHarness();
  const modal = h.render(h.components.MediaCreditRechargeButton, { mediaKind: "video" });
  const tabs = () => [...h.walk(modal.tree)].filter((node) => node.props.role === "tab");
  tabs()[1].props.onClick();
  await modal.flush();
  const panelElement = h.find(modal.tree, (node) => node.props.role === "tabpanel").props.children;
  const panel = h.render(panelElement.type, panelElement.props);
  await panel.flush();
  const checkout = deferred();
  h.environment.checkout = () => checkout.promise;
  h.packButton(panel, "image_20").props.onClick();
  await panel.flush(); await modal.flush();
  assert.ok(tabs().every((tab) => tab.props.disabled));
  tabs()[0].props.onClick();
  await modal.flush();
  assert.equal(tabs()[1].props["aria-selected"], true, "a tab change must not abandon the pending payment tab");
  h.dialog.close();
  h.find(modal.tree, (node) => node.type === "button" && node.props["aria-haspopup"] === "dialog").props.onClick();
  await modal.flush();
  assert.equal(tabs()[1].props["aria-selected"], true, "reopening must preserve the kind of a checkout still in flight");
  checkout.resolve({ ok: true, json: async () => ({ url: "https://checkout.stripe.com/c/pay/test" }) });
  await panel.flush(); await modal.flush();
  assert.ok(tabs().every((tab) => !tab.props.disabled));
  assert.equal(h.paymentTabs[0].closed, false);
  assert.equal(h.paymentTabs[0].location.href, "https://checkout.stripe.com/c/pay/test");
  panel.dispose(); modal.dispose();
});

test("image checkout return waits for confirmation, refreshes image credits and clears a cancelled notice", async () => {
  const messages = JSON.parse(fs.readFileSync(path.resolve("messages/fr-FR/settings.json"), "utf8"));
  const h = clientHarness({ settingsMessages: messages });
  h.setSearchParams("media=image&checkout=success&order=order%20image%2F1");
  const owner = h.rechargeReturn();
  await owner.flush();
  const status = () => h.find(owner.tree, (node) => node.props.role === "status");
  assert.equal(status().props.children[0], messages.video_credit_pending, "pending image payments need a translated message before fulfillment");
  assert.ok(h.find(owner.tree, (node) => node.type === h.components.ImageCreditPacksPanel));
  assert.ok(!h.find(owner.tree, (node) => node.type === h.components.VideoCreditPacksPanel));
  h.environment.readOrder = async () => ({ ok: true, json: async () => ({ order: { granted: true } }) });
  const refresh = h.find(status(), (node) => node.type === "button");
  assert.equal(refresh.props.children, messages.video_credit_refresh);
  refresh.props.onClick();
  await owner.flush();
  assert.equal(status().props.children[0], messages.image_credit_confirmed);
  assert.deepEqual(h.calls.map((call) => call.url), [
    "/api/boutique/image-credits/orders/order%20image%2F1",
    "/api/boutique/image-credits/orders/order%20image%2F1",
  ]);
  assert.ok(h.calls.every((call) => call.init.cache === "no-store"));
  h.setSearchParams("media=image&checkout=cancel&order=order%20image%2F1");
  owner.render();
  await owner.flush();
  assert.equal(status(), undefined, "an earlier success message must disappear when the return URL is cancelled");
  assert.equal(h.calls.length, 2, "cancellation must not request or grant another order");
  owner.dispose();
});

test("image checkout return shows a pending notice on network loss and ignores a response arriving after cancellation", async () => {
  const messages = JSON.parse(fs.readFileSync(path.resolve("messages/fr-FR/settings.json"), "utf8"));
  const h = clientHarness({ settingsMessages: messages });
  h.setSearchParams("media=image&checkout=success&order=order-image");
  h.environment.readOrder = async () => { throw new Error("synthetic order lookup network loss"); };
  const owner = h.rechargeReturn();
  await owner.flush();
  const status = () => h.find(owner.tree, (node) => node.props.role === "status");
  assert.equal(status().props.children[0], messages.video_credit_pending);
  const orderResponse = deferred();
  h.environment.readOrder = () => orderResponse.promise;
  h.find(status(), (node) => node.type === "button").props.onClick();
  await owner.flush();
  assert.equal(status(), undefined, "refresh removes the stale pending notice while verification is in flight");
  h.setSearchParams("media=image&checkout=cancel&order=order-image");
  owner.render();
  orderResponse.resolve({ ok: true, json: async () => ({ order: { granted: true } }) });
  await owner.flush();
  assert.equal(status(), undefined, "a late successful lookup must not overwrite the cancelled return");
  assert.equal(h.calls.length, 2);
  owner.dispose();
});
