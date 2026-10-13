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
    quota: { quota: { unlimited: false, creditsReady: true, credits: { unit: "credit", remaining: 700, includedRemaining: 500, purchasedRemaining: 200, purchasedDebt: 20, purchasedHeld: 30 }, image: { remaining: 17, includedRemaining: 10, purchasedRemaining: 7, purchasedDebt: 2, purchasedHeld: 3 }, video: { remaining: 96, includedRemaining: 46, purchasedRemaining: 50, purchasedDebt: 0, purchasedHeld: 0 } } },
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

test("four shared credit packs replace the image catalogue while legacy image history remains visible", async () => {
  const h = clientHarness({ catalogueOrders: [{ id: "order", mediaKind: "image", pack_key: "image_20", request_key: "previous", images: 20, credits: 140, heldCredits: 14, amount_ht_cents: 500, status: "paid", granted_at: "2026-10-11T12:00:00Z", created_at: "2026-10-11T12:00:00Z" }] });
  const owner = h.panel("image"); await owner.flush();
  assert.equal(h.calls[0].url, "/api/boutique/video-credits");
  const packs = [...h.walk(owner.tree)].filter((node) => node.type === "article");
  assert.deepEqual(packs.map((node) => node.key), ["video_50", "video_100", "video_200", "video_500"]);
  for (const [index, credits] of [500,1000,2000,5000].entries()) {
    const label=h.find(packs[index],(node)=>node.type==="strong").props.children;
    assert.equal(label,'media_credit_quantity '+JSON.stringify({credits}));
    const price=h.find(packs[index],(node)=>node.type==="span").props.children;
    assert.equal(price[0],new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format([19,35,65,155][index]));
  }
  assert.ok(JSON.stringify(owner.tree).includes("video_credit_disputed"), "shared history uses normalized heldCredits from an old image order");
  h.packButton(owner, "video_50").props.onClick(); await owner.flush();
  const request=h.calls.find((call)=>call.init?.method==="POST");
  assert.equal(request.url,"/api/boutique/video-credits/checkout");
  assert.deepEqual(Object.keys(JSON.parse(request.init.body)).sort(),["accountId","packKey","requestKey"]);
  assert.equal(JSON.parse(request.init.body).accountId,"account-a");assert.equal(JSON.parse(request.init.body).packKey,"video_50");
  assert.deepEqual(h.actions[0],["open","about:blank","_blank"]);assert.equal(h.actions[1][0],"post");
  assert.equal(h.paymentTabs[0].opener,null);assert.equal(h.paymentTabs[0].location.href,"https://checkout.stripe.com/c/pay/test");owner.dispose();
});

test("shared pack retries retain scoped request keys and preserve the original video checkout namespace", async () => {
  const h=clientHarness();const common=h.panel("image");await common.flush();
  h.environment.checkout=async()=>{throw new Error("synthetic network loss");};h.packButton(common,"video_50").props.onClick();await common.flush();
  const key="inrcy:video-credit-checkout:v1:account-a:actor:video_50",requestKey=h.storage.get(key);assert.ok(requestKey);assert.equal(h.paymentTabs[0].closed,true);
  h.environment.checkout=async()=>({ok:true,json:async()=>({url:"https://untrusted.example/checkout"})});h.packButton(common,"video_50").props.onClick();await common.flush();
  const posts=h.calls.filter((call)=>call.init?.method==="POST");assert.equal(JSON.parse(posts[0].init.body).requestKey,JSON.parse(posts[1].init.body).requestKey);assert.equal(h.storage.get(key),requestKey);assert.equal(h.paymentTabs[1].closed,true);
  const otherKey="inrcy:video-credit-checkout:v1:account-a:actor:video_100",prior=randomUUID();h.storage.set(otherKey,prior);
  const other=h.panel("video");await other.flush();h.packButton(other,"video_100").props.onClick();await other.flush();
  const request=h.calls.filter((call)=>call.init?.method==="POST").at(-1);assert.equal(request.url,"/api/boutique/video-credits/checkout");assert.equal(JSON.parse(request.init.body).requestKey,prior);assert.equal(h.storage.get(key),requestKey);common.dispose();other.dispose();
});

test("an old account checkout cannot navigate or unlock a newer account purchase", async () => {
  const h = clientHarness();
  const owner = h.panel("image");
  await owner.flush();
  const first = deferred();
  const second = deferred();
  let count = 0;
  h.environment.checkout = () => (++count === 1 ? first.promise : second.promise);
  h.packButton(owner, "video_50").props.onClick();
  h.changeAccount("account-b");
  await owner.flush();
  h.packButton(owner, "video_50").props.onClick();
  await owner.flush();
  first.resolve({ ok: true, json: async () => ({ url: "https://checkout.stripe.com/c/pay/old-account" }) });
  await owner.flush();
  assert.equal(h.paymentTabs[0].closed, true);
  assert.equal(h.paymentTabs[0].location.href, "about:blank");
  assert.equal(h.packButton(owner, "video_50").props.disabled, true, "old finally must not clear the new busy state");
  second.resolve({ ok: true, json: async () => ({ url: "https://checkout.stripe.com/c/pay/new-account" }) });
  await owner.flush();
  assert.equal(h.paymentTabs[1].closed, false);
  assert.equal(h.paymentTabs[1].location.href, "https://checkout.stripe.com/c/pay/new-account");
  assert.equal(h.packButton(owner, "video_50").props.disabled, false);
  const posts = h.calls.filter((call) => call.init?.method === "POST");
  assert.deepEqual(posts.map((call) => JSON.parse(call.init.body).accountId), ["account-a", "account-b"]);
  owner.dispose();
});

test("images and videos read one credit allowance with purchased debt and dispute hold", async () => {
 const h=clientHarness();const element=h.components.ImageCreditBalance(),owner=h.render(element.type,element.props);await owner.flush();
 const labels=[...h.walk(owner.tree)].filter((node)=>node.type==="dd").map((node)=>node.props.children);
 assert.deepEqual(labels,['media_credit_quantity '+JSON.stringify({credits:500}),'media_credit_quantity '+JSON.stringify({credits:200})]);
 const paragraphs=[...h.walk(owner.tree)].filter((node)=>node.type==="p").map((node)=>node.props.children);
 assert.ok(paragraphs.includes('media_credit_debt '+JSON.stringify({credits:20})));assert.ok(paragraphs.includes('media_credit_held '+JSON.stringify({credits:30})));
 assert.ok(!JSON.stringify(owner.tree).includes('image_credit_quantity'));owner.dispose();
});

test("the recharge dialog presents the same media catalogue from either kind and remains accessible", async () => {
 const h=clientHarness();assert.equal(h.components.VideoCreditRechargeButton,h.components.MediaCreditRechargeButton);
 const owner=h.render(h.components.MediaCreditRechargeButton,{mediaKind:"image"});
 const dialog=h.find(owner.tree,(node)=>node.type==="dialog");assert.ok(h.find(owner.tree,(node)=>node.props.id===dialog.props["aria-labelledby"]));
 assert.equal([...h.walk(owner.tree)].filter((node)=>node.props.role==="tab").length,0);
 assert.ok(h.find(owner.tree,(node)=>typeof node.type==="function"&&node.props.mediaKind==="video"));
 const trigger=h.find(owner.tree,(node)=>node.type==="button"&&node.props["aria-haspopup"]==="dialog");trigger.props.onClick();await owner.flush();assert.equal(h.dialog.open,true);owner.dispose();
 const native=clientHarness({platform:"ios"}),nativeOwner=native.render(native.components.MediaCreditRechargeButton,{mediaKind:"image"});assert.equal(nativeOwner.tree,null);assert.equal(native.calls.length,0);nativeOwner.dispose();
});

test("the recharge dialog close action stays locked until the current checkout completes", async () => {
 const h=clientHarness(),modal=h.render(h.components.MediaCreditRechargeButton,{mediaKind:"video"});
 const panelElement=h.find(modal.tree,(node)=>typeof node.type==="function"&&node.props.mediaKind==="video"),panel=h.render(panelElement.type,panelElement.props);await panel.flush();
 const checkout=deferred();h.environment.checkout=()=>checkout.promise;h.packButton(panel,"video_50").props.onClick();await panel.flush();await modal.flush();
 const close=()=>h.find(modal.tree,(node)=>node.type==="button"&&node.props["aria-label"]==="video_credit_close");assert.equal(close().props.disabled,true);
 checkout.resolve({ok:true,json:async()=>({url:"https://checkout.stripe.com/c/pay/test"})});await panel.flush();await modal.flush();assert.equal(close().props.disabled,false);assert.equal(h.paymentTabs[0].closed,false);assert.equal(h.paymentTabs[0].location.href,"https://checkout.stripe.com/c/pay/test");panel.dispose();modal.dispose();
});

test("image checkout return waits for confirmation, refreshes image credits and clears a cancelled notice", async () => {
  const messages = JSON.parse(fs.readFileSync(path.resolve("messages/fr-FR/settings.json"), "utf8"));
  const h = clientHarness({ settingsMessages: messages });
  h.setSearchParams("media=image&checkout=success&order=order%20image%2F1");
  const owner = h.rechargeReturn();
  await owner.flush();
  const status = () => h.find(owner.tree, (node) => node.props.role === "status");
  assert.equal(status().props.children[0], messages.video_credit_pending, "pending image payments need a translated message before fulfillment");
  assert.ok(h.find(owner.tree, (node) => node.type === h.components.VideoCreditPacksPanel));
  assert.ok(!h.find(owner.tree, (node) => node.type === h.components.ImageCreditPacksPanel));
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
