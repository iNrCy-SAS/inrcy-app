import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as historyPolicy from "../../app/dashboard/mails/_lib/mailboxHistoryPreload.ts";
import * as composePolicy from "../../app/dashboard/mails/_lib/mailboxComposeCampaign.foundations.ts";
import { normalizeRecipientEmails } from "../../lib/crmRecipients.ts";
import type { useMailboxHistory } from "../../app/dashboard/mails/_hooks/useMailboxHistory.ts";
import type { useMailboxCrmRecipients } from "../../app/dashboard/mails/_hooks/useMailboxCrmRecipients.ts";
import type { useMailboxPublicationMedia } from "../../app/dashboard/mails/_hooks/useMailboxPublicationMedia.ts";

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Hook<P, R> = (props: P) => R;

// Runs the real hook bodies with React's persistent slot/dependency semantics.
// Network, browser events and timers are local fakes; no service is contacted.
function hookHarness<P, R>(name: string, initialProps: P, dependencies: Record<string, unknown>, globals: Record<string, unknown>) {
  const slots: Slot[] = [];
  let cursor = 0, dirty = false, props = initialProps;
  let value!: R;
  const effects: Array<() => void> = [], layouts: Array<() => void> = [];
  const changed = (previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) =>
    !previous || !next || previous.length !== next.length || next.some((item, index) => !Object.is(item, previous[index]));
  const effect = (queue: Array<() => void>) => (callback: () => (() => void) | void, deps?: readonly unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (!changed(slot.deps, deps)) return;
    slot.deps = deps;
    queue.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; });
  };
  const memo = (factory: () => unknown, deps?: readonly unknown[]) => {
    const slot = slots[cursor++] ??= {};
    if (changed(slot.deps, deps)) { slot.value = factory(); slot.deps = deps; }
    return slot.value;
  };
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (next: unknown) => {
        const updated = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(updated, slot.value)) { slot.value = updated; dirty = true; }
      }];
    },
    useRef(initial: unknown) { return (slots[cursor++] ??= { value: { current: initial } }).value; },
    useMemo: memo,
    useCallback: (callback: unknown, deps?: readonly unknown[]) => memo(() => callback, deps),
    useEffect: effect(effects), useLayoutEffect: effect(layouts),
    useEffectEvent(callback: (...args: unknown[]) => unknown) {
      const slot = slots[cursor++] ??= {}; slot.value = callback;
      return (...args: unknown[]) => (slot.value as typeof callback)(...args);
    },
  };
  const translate = (key: string) => key;
  const provided = { ...dependencies, react, "next-intl": { useTranslations: () => translate } };
  function loadModule(moduleName: string): { exports: Record<string, Hook<P, R>> } {
    const source = readFileSync(new URL(`../../app/dashboard/mails/_hooks/${moduleName}.ts`, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const loaded = { exports: {} as Record<string, Hook<P, R>> };
    new Function("module", "exports", "require", ...Object.keys(globals), code)(loaded, loaded.exports, (id: string) => {
      if (id === "./useMailboxPublicationVideo") return loadModule("useMailboxPublicationVideo").exports;
      assert.ok(id in provided, `unexpected dependency: ${id}`);
      return provided[id as keyof typeof provided];
    }, ...Object.values(globals));
    return loaded;
  }
  const moduleRecord = loadModule(name);
  function render() {
    cursor = 0; dirty = false;
    value = moduleRecord.exports[name](props);
    layouts.splice(0).forEach(run => run());
    effects.splice(0).forEach(run => run());
    return value;
  }
  function flush() { for (let i = 0; dirty && i < 20; i++) render(); assert.equal(dirty, false, "hook must settle"); return value; }
  return { render, flush, get current() { return value; }, setProps(next: P) { props = next; render(); return flush(); }, unmount() { slots.forEach(slot => slot.cleanup?.()); } };
}

function browserFakes() {
  let serial = 0;
  const timers = new Map<number, { run: () => void; delay: number }>();
  const schedule = (run: () => void, delay: number) => { timers.set(++serial, { run, delay }); return serial; };
  const cancel = (id: number) => timers.delete(id);
  const events = () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    return { listeners, addEventListener(type: string, listener: (event: unknown) => void) { const set = listeners.get(type) || new Set(); set.add(listener); listeners.set(type, set); }, removeEventListener(type: string, listener: (event: unknown) => void) { listeners.get(type)?.delete(listener); } };
  };
  const window = { ...events(), setTimeout: schedule, clearTimeout: cancel };
  const document = { ...events(), visibilityState: "visible" };
  return { window, document, timers, setTimeout: schedule, clearTimeout: cancel, requestAnimationFrame: (run: () => void) => run(), console: { error() {} } };
}

const counts = (publications = 0) => ({ mails: 0, factures: 0, devis: 0, publications, recoltes: 0, offres: 0, informations: 0, suivis: 0, enquetes: 0, propulsions: 0, fidelisations: 0, stats: 0 });
const response = (payload: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => payload, text: async () => "offline" });
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

function historyHarness(snapshot: unknown = null) {
  const browser = browserFakes();
  const pages: Array<{ url: URL; resolve: (value: ReturnType<typeof response>) => void }> = [];
  let cacheReads = 0, countRequests = 0;
  const hook = hookHarness<Parameters<typeof useMailboxHistory>[0], ReturnType<typeof useMailboxHistory>>("useMailboxHistory", { metaPilotEnabled: true }, {
    "@/lib/metaChannelUiAccess": { filterMetaPilotItems: (items: unknown[]) => items },
    "@/lib/browserModuleSnapshotCache": { MODULE_SNAPSHOT_KEYS: { inrSendDefault: "history" }, readModuleSnapshot: () => { cacheReads++; return snapshot ? { data: snapshot } : null; }, writeModuleSnapshot() {} },
    "@/lib/profileVersioning": { PROFILE_VERSION_EVENT: "profile-version" },
    "../_lib/mailboxPhase1": { MAILBOX_PAGE_SIZE: 20, emptyFolderCounts: counts, normalizeFolderCounts: (value: unknown) => value },
    "../_lib/mailboxHistoryPreload": historyPolicy,
  }, { ...browser, fetch: (value: string) => {
    const url = new URL(value, "https://local.test");
    if (url.searchParams.has("countsOnly")) { countRequests++; return Promise.resolve(response({ countsIncluded: true, folderCounts: counts(1), draftFolderCounts: counts() })); }
    return new Promise<ReturnType<typeof response>>(resolve => pages.push({ url, resolve }));
  } });
  return { hook, browser, pages, get cacheReads() { return cacheReads; }, get countRequests() { return countRequests; } };
}

test("history keeps server hydration empty, restores once, then forces the initial revalidation", async () => {
  const h = historyHarness({ items: [{ id: "cached" }], page: 1, total: 1, hasMore: false, folderCounts: counts(1), draftFolderCounts: counts() });
  const first = h.hook.render();
  assert.deepEqual(first.items, []);
  assert.equal(h.pages.length, 0);
  h.hook.flush();
  assert.equal(h.cacheReads, 1);
  assert.equal(h.hook.current.items[0].id, "cached");
  assert.equal(h.pages.length, 1);
  h.pages[0].resolve(response({ error: "temporary failure" }, false));
  await settle(); h.hook.flush();
  assert.equal(h.hook.current.items[0].id, "cached");
  assert.equal(h.hook.current.folderCounts.publications, 1);
  assert.equal(h.hook.current.loading, false);
  h.hook.unmount();
});

test("history ignores a late response from the previous search and mailbox filter", async () => {
  const h = historyHarness(); h.hook.render(); h.hook.flush();
  h.hook.current.setHistoryQuery("current"); h.hook.current.setFilterAccountId("mailbox-b"); h.hook.flush();
  assert.equal(h.pages.length, 2);
  assert.equal(h.pages[1].url.searchParams.get("q"), "current");
  assert.equal(h.pages[1].url.searchParams.get("filterAccountId"), "mailbox-b");
  h.pages[0].resolve(response({ items: [{ id: "obsolete" }], page: 1, total: 1 }));
  await settle(); h.hook.flush();
  assert.equal(h.hook.current.items.length, 0);
  h.pages[1].resolve(response({ items: [{ id: "current" }], page: 1, total: 1 }));
  await settle(); h.hook.flush();
  assert.equal(h.hook.current.items[0].id, "current");
  assert.equal(h.hook.current.selectedId, "current");
  h.hook.unmount();
});

test("history shares a pending page request and cleans up browser listeners and recovery timers", async () => {
  const h = historyHarness(); h.hook.render(); h.hook.flush();
  const first = h.hook.current.loadHistory({ force: true });
  const second = h.hook.current.loadHistory({ force: true });
  assert.equal(h.pages.length, 1);
  h.pages[0].resolve(response({ items: [{ id: "one" }], page: 1, total: 1 }));
  await Promise.all([first, second]); await settle(); h.hook.flush();
  assert.equal(h.countRequests, 1);
  assert.ok(h.browser.timers.size > 0);
  h.hook.unmount();
  assert.equal(h.browser.timers.size, 0);
  for (const target of [h.browser.window, h.browser.document]) for (const listeners of target.listeners.values()) assert.equal(listeners.size, 0);
});

test("CRM loads lazily and retains case-insensitive recipients, filters and stored contact hints", async () => {
  let calls = 0, recipientText = "CLIENT@example.test";
  const props: Parameters<typeof useMailboxCrmRecipients>[0] = { composeOpen: false, to: recipientText, setTo: next => { recipientText = typeof next === "function" ? next(recipientText) : next; }, composeRecipientHints: [{ email: "other@example.test", contact_id: "saved", display_name: "Saved" }] };
  const hook = hookHarness<Parameters<typeof useMailboxCrmRecipients>[0], ReturnType<typeof useMailboxCrmRecipients>>("useMailboxCrmRecipients", props, {
    "../_lib/mailboxPhase25": { normalizeEmails: normalizeRecipientEmails },
    "../_lib/mailboxComposeCampaign.foundations": composePolicy,
  }, { ...browserFakes(), fetch: async () => { calls++; return response({ contacts: [
    { id: "client", first_name: "Alice", email: "client@example.test", postal_code: "97400", category: "particulier", contact_type: "client", important: true },
    { id: "prospect", company_name: "Prospect", email: "other@example.test", postal_code: "75008", category: "professionnel", contact_type: "prospect", important: false },
  ] }); } });
  hook.render(); hook.flush(); assert.equal(calls, 0);
  hook.setProps({ ...props, composeOpen: true }); await settle(); hook.flush();
  assert.equal(calls, 1); assert.equal(hook.current.selectedCrmCount, 1);
  hook.current.setCrmDepartment("974"); hook.current.setCrmImportantOnly(true); hook.flush();
  assert.deepEqual(hook.current.filteredContacts.map(contact => contact.id), ["client"]);
  assert.equal(hook.current.crmRecipientsByEmail.get("client@example.test")?.contact_id, "client");
  assert.equal(hook.current.composeRecipientHintsByEmail.get("other@example.test")?.contact_id, "saved");
  hook.current.toggleEmailInTo("client@example.test"); assert.equal(recipientText, "");
  hook.setProps({ ...props, composeOpen: false }); hook.setProps({ ...props, composeOpen: true });
  assert.equal(calls, 1); hook.unmount();
});

test("CRM reports the existing localized load failure and releases its loading state", async () => {
  const hook = hookHarness<Parameters<typeof useMailboxCrmRecipients>[0], ReturnType<typeof useMailboxCrmRecipients>>("useMailboxCrmRecipients", { composeOpen: false, to: "", setTo() {}, composeRecipientHints: [] }, {
    "../_lib/mailboxPhase25": { normalizeEmails: normalizeRecipientEmails }, "../_lib/mailboxComposeCampaign.foundations": composePolicy,
  }, { ...browserFakes(), fetch: async () => response(null, false) });
  hook.render(); await hook.current.loadCrmContacts(); hook.flush();
  assert.equal(hook.current.crmError, "contacts_load_failed"); assert.equal(hook.current.crmLoading, false); hook.unmount();
});

function mediaHarness() {
  const props: Parameters<typeof useMailboxPublicationMedia>[0] = { detailsOpen: false, detailsItem: null, detailsEditMode: false, detailsChannelEntries: [], activeDetailsChannelEntry: null, setDetailsActionError() {} };
  const hook = hookHarness<Parameters<typeof useMailboxPublicationMedia>[0], ReturnType<typeof useMailboxPublicationMedia>>("useMailboxPublicationMedia", props, {
    "@/lib/boosterVideoTransformClient": {}, "@/lib/boosterVideoTransforms": {}, "@/lib/imageInteractions": {},
    "../_lib/mailboxPhase1": { normalizeChannelKey: (key: string) => key.toLowerCase(), buildPublicationDefaultTransform: () => ({ fit: "contain" }) },
    "../../booster/publier/publishModal.shared": {},
    "../_lib/mailboxPublicationVideo.foundations": { normalizeBoosterChannelKeyForVideo: (key: string) => key.toLowerCase() },
  }, browserFakes());
  hook.render(); hook.flush(); return { hook, props };
}
type ImageMap = ReturnType<typeof useMailboxPublicationMedia>["publicationEditImagesByChannel"];
type VideoMap = ReturnType<typeof useMailboxPublicationMedia>["publicationEditVideoByChannel"];
const imageAsset = (key: string, selected = true): ImageMap[string]["assets"][number] => ({
  key, selected, name: `${key}.png`, type: "image/png", previewUrl: `https://media.test/${key}.png`,
  sourceUrl: null, file: null,
  transform: { fit: "contain", zoom: 1, offsetX: 0, offsetY: 0, blurBackground: false },
});
const videoState = (previewUrl: string, sourceVideo: VideoMap[string]["sourceVideo"] = null): VideoMap[string] => ({
  file: null, previewUrl, name: "video.mp4", type: "video/mp4", size: 100, duration: null,
  sourceMetadata: null, sourceVideo, transformedVariants: [], format: "original", adaptationMode: "safe_frame",
});

test("media state preserves edits across background hydration and only resets after leaving edit mode", () => {
  const { hook, props } = mediaHarness();
  const images: ImageMap = { facebook: { assets: [imageAsset("edited")] } };
  const videos: VideoMap = { facebook: videoState("edited-video") };
  hook.current.setPublicationEditImagesByChannel(images); hook.current.setPublicationEditVideoByChannel(videos); hook.flush();
  const editing = { ...props, detailsOpen: true, detailsItem: { id: "post", source: "app_events" } as NonNullable<typeof props.detailsItem>, detailsEditMode: true };
  hook.setProps(editing);
  assert.equal(hook.current.publicationEditImagesByChannel, images); assert.equal(hook.current.publicationEditVideoByChannel, videos);
  hook.setProps({ ...editing, detailsChannelEntries: [] });
  assert.equal(hook.current.publicationEditImagesByChannel, images);
  hook.setProps({ ...editing, detailsEditMode: false });
  assert.deepEqual(hook.current.publicationEditImagesByChannel, {}); assert.deepEqual(hook.current.publicationEditVideoByChannel, {});
  hook.unmount();
});

test("media selection and reorder remain per-channel, including Pinterest's single image selection", () => {
  const { hook } = mediaHarness();
  const assets = [imageAsset("a"), imageAsset("b", false), imageAsset("c")];
  hook.current.setPublicationEditImagesByChannel({ facebook: { assets }, pinterest: { assets }, instagram: { assets } }); hook.flush();
  const untouched = hook.current.publicationEditImagesByChannel.instagram;
  hook.current.togglePublicationImage("pinterest", "b"); hook.flush();
  assert.deepEqual(hook.current.publicationEditImagesByChannel.pinterest.assets.filter(item => item.selected).map(item => item.key), ["b"]);
  hook.current.movePublicationImage("facebook", "c", -1); hook.flush();
  assert.deepEqual(hook.current.publicationEditImagesByChannel.facebook.assets.map(item => item.key), ["c", "a", "b"]);
  assert.equal(hook.current.publicationEditImagesByChannel.instagram, untouched);
  hook.unmount();
});

test("video removal and unchanged uploaded sources preserve other channels and avoid an upload", async () => {
  const { hook } = mediaHarness();
  const sourceVideo = { name: "original.mp4", type: "video/mp4", size: 100, publicUrl: "https://media.test/original.mp4" };
  const other = videoState("other", sourceVideo);
  hook.current.setPublicationEditVideoByChannel({ facebook: videoState("selected", sourceVideo), instagram: other }); hook.flush();
  assert.equal(await hook.current.ensurePublicationEditVideoUploaded("facebook", hook.current.publicationEditVideoByChannel.facebook), sourceVideo);
  hook.current.removePublicationVideo("facebook"); hook.flush();
  assert.equal(hook.current.publicationEditVideoByChannel.facebook.removed, true);
  assert.equal(hook.current.publicationEditVideoByChannel.facebook.previewUrl, "");
  assert.equal(hook.current.publicationEditVideoByChannel.instagram, other);
  hook.unmount();
});

test("Mailbox mounts each controller once and keeps Studio navigation and server actions at the page boundary", () => {
  const client = readFileSync(new URL("../../app/dashboard/mails/MailboxClient.tsx", import.meta.url), "utf8");
  for (const name of ["useMailboxHistory", "useMailboxCrmRecipients", "useMailboxPublicationMedia"]) assert.equal((client.match(new RegExp(`${name}\\(`, "g")) || []).length, 1);
  assert.match(client, /useInrStudioSession\(/); assert.match(client, /async function saveChannelPublication/); assert.match(client, /async function doSend/);
});
for (const outcome of ["empty", "error"]) test(`CRM opening with an ${outcome} result settles without automatic retries and retries on the next opening`, async () => {
  let calls = 0;
  const props: Parameters<typeof useMailboxCrmRecipients>[0] = { composeOpen: false, to: "", setTo() {}, composeRecipientHints: [] };
  const hook = hookHarness<Parameters<typeof useMailboxCrmRecipients>[0], ReturnType<typeof useMailboxCrmRecipients>>("useMailboxCrmRecipients", props, {
    "../_lib/mailboxPhase25": { normalizeEmails: normalizeRecipientEmails }, "../_lib/mailboxComposeCampaign.foundations": composePolicy,
  }, { ...browserFakes(), fetch: async () => { calls++; return response({ contacts: [] }, outcome !== "error"); } });
  hook.render(); hook.setProps({ ...props, composeOpen: true }); await settle(); hook.flush();
  hook.setProps({ ...props, composeOpen: true, to: "edited@example.test" }); await settle(); hook.flush();
  assert.equal(calls, 1); assert.equal(hook.current.crmLoading, false);
  hook.setProps({ ...props, composeOpen: false }); hook.setProps({ ...props, composeOpen: true }); await settle(); hook.flush();
  assert.equal(calls, 2); hook.unmount();
});

test("history gate changes do not rehydrate the initial cache or reset the current mailbox context", async () => {
  const h = historyHarness({ items: [{ id: "cached" }], page: 1, total: 1, hasMore: false, folderCounts: counts(1), draftFolderCounts: counts() });
  h.hook.render(); h.hook.flush();
  h.hook.current.setHistoryQuery("edited search"); h.hook.current.setFilterAccountId("account-b"); h.hook.flush();
  h.hook.setProps({ metaPilotEnabled: false }); h.hook.setProps({ metaPilotEnabled: false });
  assert.equal(h.cacheReads, 1); assert.equal(h.hook.current.historyQuery, "edited search"); assert.equal(h.hook.current.filterAccountId, "account-b");
  h.pages[0].resolve(response({ items: [{ id: "old" }], page: 1, total: 1 })); await settle(); h.hook.flush();
  assert.notEqual(h.hook.current.items[0]?.id, "old"); h.hook.unmount();
});
