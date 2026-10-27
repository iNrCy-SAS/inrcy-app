import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import { elements, find, invoke, harness, type Props } from "./dashboard-assistant-runtime-harness.mts";
import { getInrAssistantContextualHelp } from "../../lib/inrAssistantContextualHelp.ts";
import { getInrAssistantClientScreen } from "../../lib/inrAssistantClientContext.ts";

test("a prepared prompt offers free Studio insertion and never sends a generation request", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const studioDraft = { version: 1, mediaType: "video", prompt: "Une vidéo verticale de mon atelier en lumière naturelle.", format: "story", durationSeconds: 8 };
  globalThis.fetch = (async input => { requests.push(String(input)); return Response.json({ message: "Voici votre prompt.", studioDraft, accountId: "account-a" }); }) as typeof fetch;
  const view = harness();
  try {
    view.submit("Prépare un prompt pour une vidéo de mon atelier.");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.studioInsertions.length, 0);
    const button = find(view.render(), node => node.props["data-testid"] === "assistant-studio-draft");
    assert.equal((button.props.children as unknown[])[0], "Insert into iNrStudio — Video");
    invoke(button, "onClick"); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(view.studioInsertions, [studioDraft]);
    assert.ok(elements(view.render()).some(node => node.props.content === "Video prompt inserted; choose when to generate."));
    assert.deepEqual(requests, ["/api/assistant/chat"]);
    view.submit("Merci"); await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.studioInsertions.length, 1, "Restoring or continuing does not insert the prompt again");
  } finally { view.cleanup(); globalThis.fetch = original; }
});

test("server-confirmed free insertion runs after the chat controller releases and ignores late account changes", async () => {
  const original = globalThis.fetch;
  const studioDraft = { version: 1, mediaType: "image", prompt: "Un chat rouge sur fond blanc", format: null, durationSeconds: null };
  globalThis.fetch = (async () => Response.json({ message: "Je l’insère dans Studio.", studioDraft, insertStudioDraft: true, accountId: "account-a" })) as typeof fetch;
  const view = harness();
  let complete!: (value: boolean) => void;
  view.onStudioInsert(() => new Promise(resolve => { complete = resolve; }));
  try {
    view.submit("Oui"); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(view.studioInsertions, [studioDraft], "The freed controller must allow the authorized UI insertion");
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "Another request" } });
    assert.equal(find(view.render(), node => node.props.type === "submit").props.disabled, false, "Insertion does not keep the paid chat pending");
    view.switchAccount(); complete(true); await new Promise(resolve => setImmediate(resolve));
    assert.ok(!elements(view.render()).some(node => node.props.content === "Image prompt inserted; choose when to generate."));
  } finally { view.cleanup(); globalThis.fetch = original; }
});

test("legacy prompt replies retain a free insertion button and cancellation never claims success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ message: "> Un chat rouge sur fond blanc", accountId: "account-a" })) as typeof fetch;
  const view = harness();
  view.onStudioInsert(async () => false);
  try {
    view.submit("Écris un prompt pour une image de chat."); await new Promise(resolve => setImmediate(resolve));
    invoke(find(view.render(), node => node.props["data-testid"] === "assistant-studio-draft"), "onClick");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.studioInsertions[0]?.prompt, "Un chat rouge sur fond blanc");
    assert.ok(!elements(view.render()).some(node => node.props.content === "Image prompt inserted; choose when to generate."));
  } finally { view.cleanup(); globalThis.fetch = original; }
});

test("tool-specific help only fills the composer and follows navigation without losing the exchange", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ init, resolve }))) as typeof fetch;
  const options = { pathname: "/dashboard/stats", query: "token=PRIVATE" };
  const view = harness(false, undefined, undefined, options);
  const help = (pathname: string) => getInrAssistantContextualHelp(getInrAssistantClientScreen(pathname, new URLSearchParams()), "en-GB")!;
  try {
    let tree = view.render();
    const statsHelp = help(options.pathname);
    assert.equal(elements(find(tree, node => node.props["data-testid"] === "assistant-context-help").props.children as ReactNode).filter(node => node.type === "button").length, 3);
    invoke(find(tree, node => node.type === "button" && Array.isArray(node.props.children) && node.props.children[0] === statsHelp.suggestions[0]), "onClick");
    assert.equal(find(view.render(), node => node.type === "textarea").props.value, statsHelp.suggestions[0]);
    assert.equal(requests.length, 0, "Opening or choosing tool help must never start a model call or business action");
    view.submit("Explain these results");
    assert.equal(JSON.parse(String(requests[0].init?.body)).clientContext.screen.tool, "iNr’Stats");
    requests[0].resolve(Response.json({ message: "Your measured results", accountId: "account-a" }));
    await new Promise(resolve => setImmediate(resolve));
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "Keep my draft" } });
    options.pathname = "/dashboard/mediatheque";
    tree = view.render(false);
    tree = view.render(true);
    assert.ok(elements(tree).some(node => node.props.content === "Your measured results"));
    assert.equal(find(tree, node => node.type === "textarea").props.value, "Keep my draft");
    const mediaHelp = help(options.pathname);
    invoke(find(tree, node => node.type === "button" && node.props.children === mediaHelp.suggestions[0]), "onClick");
    assert.equal(find(view.render(), node => node.type === "textarea").props.value, mediaHelp.suggestions[0]);
    assert.equal(requests.length, 1, "Restoring from another tool must not automatically call the model");
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});
test("assistant submits user text without client model or plan and retries only on a user action", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ init, resolve }))) as typeof fetch;
  const view = harness();
  try {
    view.submit("Prepare a post");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init?.credentials, "include");
    assert.equal(new Headers(requests[0].init?.headers).get("Accept"), "text/event-stream");
    const initialBody = JSON.parse(String(requests[0].init?.body));
    assert.deepEqual(initialBody.messages, [{ role: "user", content: "Prepare a post" }]);
    assert.match(initialBody.turnId, /^[0-9a-f-]{36}$/i);
    assert.equal(find(view.render(), node => node.props.type === "submit").props.disabled, true);
    requests[0].resolve(Response.json({ error: "Please try later" }, { status: 503 }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1, "A failed paid request must not automatically retry");
    const retry = find(view.render(), node => node.type === "button" && node.props.children === "Retry");
    invoke(retry, "onClick");
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(String(requests[1].init?.body)).turnId, initialBody.turnId, "A retry must retain the same logical turn to avoid creating paid media twice");
    requests[1].resolve(Response.json({ message: "Here is a draft.", requestId: "request-2", accountId: "account-a" }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(view.render()).some(node => node.props.content === "Here is a draft."));
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("Collaboration only follows real streamed activity and keeps updating while the assistant is minimized", async () => {
  const originalFetch = globalThis.fetch;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    signal = init?.signal || undefined;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const emit = async (event: unknown) => {
    stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    await new Promise(resolve => setImmediate(resolve));
  };
  const view = harness();
  const rows = (tree: ReactNode) => elements(tree).filter(node => node.props["data-activity-id"]);
  try {
    view.submit("Prepare content and inspect the statistics");
    assert.equal(elements(view.render()).some(node => node.props["data-testid"] === "assistant-collaboration"), false, "A pending request alone must not invent a specialist");
    await new Promise(resolve => setImmediate(resolve));
    await emit({ type: "activity", activity: { id: "pub-1", agent: "publications", label: "Preparing draft", status: "running" } });
    await emit({ type: "activity", activity: { id: "guide_publications", agent: "publications", label: "Guide de l’outil consulté", status: "completed" } });
    await emit({ type: "activity", activity: { id: "guide_publications", agent: "publications", label: "Guide de l’outil consulté", status: "completed" } });
    let tree = view.render();
    assert.equal(rows(tree).length, 2, "Repeated guide events must appear once alongside the business operation"); assert.equal(rows(tree)[0].props["data-state"], "running");
    assert.ok(elements(tree).some(node => node.type === "img" && node.props.src === "/agent/agent-publications.webp"));
    const heading = find(tree, node => node.props["aria-controls"] === "inrcy-assistant-collaboration");
    assert.equal(heading.props["aria-expanded"], true);
    invoke(heading, "onClick");
    assert.equal(find(view.render(), node => node.props.id === "inrcy-assistant-collaboration").props.hidden, true);
    view.render(false);
    await emit({ type: "activity", activity: { id: "pub-1", agent: "publications", label: "Draft ready", status: "completed" } });
    await emit({ type: "activity", activity: { id: "stats-1", agent: "stats", label: "Reading measured data", status: "running" } });
    assert.equal(signal?.aborted, false, "Reducing the assistant must keep its collaboration alive");
    tree = view.render(true);
    assert.equal(rows(tree).length, 3, "Updates with the same id must update the original row");
    assert.equal(rows(tree)[0].props["data-state"], "completed");
    assert.ok(elements(tree).some(node => node.type === "img" && node.props.src === "/agent/agent-stats.webp"));
    await emit({ type: "activity", activity: { id: "stats-1", agent: "stats", label: "Data read", status: "completed" } });
    await emit({ type: "result", payload: { message: "Draft and statistics are ready", accountId: "account-a" } });
    tree = view.render();
    assert.ok(elements(tree).some(node => node.props.content === "Draft and statistics are ready"));
    assert.ok(rows(tree).every(node => node.props["data-state"] === "completed"));
    assert.equal(find(tree, node => node.props.type === "submit").props.disabled, true);
    invoke(find(tree, node => node.props["aria-label"] === "New"), "onClick");
    assert.equal(rows(view.render()).length, 0, "A new conversation must purge previous collaboration state");
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("streamed failures retain real collaboration status and diagnostics without an automatic retry", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    const events = [
      { type: "activity", activity: { id: "mail-1", agent: "emailing", label: "Preparing email draft", status: "blocked" } },
      { type: "error", payload: { error: "The draft needs your input", code: "needs_input", requestId: "request-mail-1", accountId: "account-a" } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  const view = harness();
  try {
    view.submit("Prepare an email"); await new Promise(resolve => setImmediate(resolve));
    const tree = view.render();
    assert.equal(requests, 1);
    assert.equal(find(tree, node => node.props["data-activity-id"] === "mail-1").props["data-state"], "blocked");
    assert.ok(elements(tree).some(node => node.type === "img" && node.props.src === "/agent/agent-campaigns.webp"));
    assert.equal(elements(tree).some(node => node.props.children === "request-mail-1"), false, "Keep diagnostic identifiers out of the customer conversation");
    assert.equal(elements(tree).some(node => node.props.children === "The draft needs your input"), false, "Do not display arbitrary stream error text");
    assert.equal(elements(tree).some(node => node.props.content), false, "An error must not create a fake assistant reply");
    assert.ok(find(tree, node => node.type === "button" && node.props.children === "Retry"));
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("late streamed activity from the previous establishment cannot enter the visible conversation", async () => {
  const originalFetch = globalThis.fetch;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
  const view = harness();
  try {
    view.submit("Inspect statistics"); await new Promise(resolve => setImmediate(resolve));
    view.switchAccount();
    for (const event of [
      { type: "activity", activity: { id: "old-stats", agent: "stats", label: "Previous account", status: "running" } },
      { type: "result", payload: { message: "Private old account reply", accountId: "account-a" } },
    ]) stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    await new Promise(resolve => setImmediate(resolve));
    const tree = view.render();
    assert.equal(elements(tree).some(node => node.props["data-activity-id"]), false);
    assert.equal(elements(tree).some(node => node.props.content === "Private old account reply"), false);
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("the robot toggles the panel and marks a reply unread only while minimized or closed", () => {
  const view = harness(true);
  const snapshot = () => {
    const tree = view.providerRender();
    const context = find(tree, node => Boolean(node.props.value)).props.value as Props;
    const session = find(tree, node => node.props.actorUserId === "actor-a");
    return { context, session };
  };
  const callControl = (context: Props, key: string) => (context[key] as () => void)();
  let current = snapshot();
  callControl(current.context, "toggleAssistant");
  current = snapshot();
  assert.equal(current.context.assistantOpen, true);
  invoke(current.session, "onPendingChange", true);
  current = snapshot();
  assert.equal(current.context.assistantPending, true);
  assert.equal(current.context.assistantBadgeState, null, "The badge stays hidden while the assistant is open");
  assert.match(String(current.context.assistantLabel), /Thinking/);
  invoke(current.session, "onReply");
  assert.equal(snapshot().context.assistantUnread, false);
  callControl(current.context, "toggleAssistant");
  current = snapshot();
  assert.equal(current.context.assistantOpen, false);
  assert.equal(current.context.assistantBadgeState, "pending");
  assert.equal(elements(view.providerRender()).some(node => node.props["data-testid"] === "assistant-restore"), false, "A minimized assistant returns to its original robot icon without an extra floating chip");
  invoke(current.session, "onReply");
  current = snapshot();
  assert.equal(current.context.assistantUnread, true);
  assert.equal(current.context.assistantBadgeState, "unread", "A ready reply takes precedence over the pending marker");
  callControl(current.context, "toggleAssistant");
  current = snapshot();
  assert.equal(current.context.assistantOpen, true);
  assert.equal(current.context.assistantUnread, false);
  assert.equal(current.context.assistantBadgeState, null);
  invoke(current.session, "onPendingChange", false);
  callControl(current.context, "toggleAssistant");
  current = snapshot();
  assert.equal(current.context.assistantBadgeState, "active", "A reduced idle conversation keeps a visible active marker");
  callControl(current.context, "toggleAssistant");
  current = snapshot();
  invoke(current.session, "close");
  current = snapshot();
  invoke(current.session, "onReply");
  current = snapshot();
  assert.equal(current.context.assistantOpen, false);
  assert.equal(current.context.assistantUnread, true);
});

test("internal links and media navigation keep the assistant open and respect the dirty-form guard", async () => {
  const view = harness(true);
  const snapshot = () => {
    const tree = view.providerRender();
    return {
      context: find(tree, node => Boolean(node.props.value)).props.value as Props,
      session: find(tree, node => node.props.actorUserId === "actor-a"),
    };
  };
  let current = snapshot();
  (current.context.openAssistant as () => void)();
  current = snapshot();
  const sessionKey = current.session.key;
  invoke(current.session, "onInternalNavigate", "/dashboard?action=channels");
  assert.deepEqual(view.navigations, ["/dashboard?action=channels"]);
  assert.equal(view.actions.navigationChecks, 1);
  assert.equal(snapshot().context.assistantOpen, true);
  assert.equal(snapshot().session.key, sessionKey, "Opening a tool must not remount the account-scoped conversation");
  view.allowNavigation(false);
  invoke(current.session, "onInternalNavigate", "/dashboard?help=1");
  assert.equal(view.navigations.length, 1, "A refused unsaved edit must keep the existing tool");
  assert.equal(snapshot().context.assistantOpen, true);
  view.allowNavigation(true);
  invoke(current.session, "onOpenMediaLibrary");
  assert.deepEqual(view.navigations, ["/dashboard?action=channels", "/dashboard/mediatheque"]);
  invoke(current.session, "onInternalNavigate", "/dashboard?panel=compte");
  assert.equal(view.navigations.at(-1), "/dashboard?panel=compte&panelSource=settings", "An explicit account link must not be closed by the old-URL protection");
  for (const href of ["https://elsewhere.example", "javascript:alert(1)", "//elsewhere.example/dashboard", "/dashboard/../../login", "/dashboard\\evil"]) invoke(current.session, "onInternalNavigate", href);
  assert.equal(view.navigations.length, 3, "Only dashboard destinations are handled by the internal callback");
  view.deferNavigation();
  invoke(current.session, "onInternalNavigate", "/dashboard/stats");
  view.switchAccount();
  view.releaseNavigation(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.navigations.length, 3, "An old conversation must not navigate after its establishment changed during confirmation");
});

test("tool links preserve the transcript and draft while the same assistant moves into and out of native Help", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ message: "[Ouvrir mes canaux](/dashboard?action=channels)", accountId: "account-a" })) as typeof fetch;
  const view = harness();
  let stopObserving: (() => void) | undefined;
  try {
    view.submit("How do I connect a channel?");
    await new Promise(resolve => setImmediate(resolve));
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "My next question" } });
    stopObserving = view.observePortalHost() as () => void;
    const nativeHelp = view.showNativeHelp();
    let tree = view.render();
    assert.equal(view.portalTarget(), nativeHelp);
    const reply = find(tree, node => node.props.content === "[Ouvrir mes canaux](/dashboard?action=channels)");
    invoke(reply, "onInternalNavigate", "/dashboard?action=channels");
    view.closeNativeHelp();
    tree = view.render();
    assert.deepEqual(view.navigations, ["/dashboard?action=channels"]);
    assert.equal(view.portalTarget(), view.body);
    assert.equal(view.actions.close + view.actions.minimize, 0);
    assert.equal(find(tree, node => node.type === "textarea").props.value, "My next question");
    assert.ok(elements(tree).some(node => node.props.content === reply.props.content));
  } finally { stopObserving?.(); view.cleanup(); globalThis.fetch = originalFetch; }
});

test("desktop position switches persist as a browser preference without losing a draft or pending reply", async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    signal = init?.signal || undefined;
    return new Promise<Response>(resolve => { resolveRequest = resolve; });
  }) as typeof fetch;
  const view = harness();
  try {
    assert.equal(find(view.render(), node => node.type === "dialog").props["data-position"], "right");
    view.submit("Prepare a post");
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "My next request" } });
    for (const [label, expected] of [["Move window to the left", "left"], ["Move window to the right", "right"], ["Move window to the left", "left"]]) {
      invoke(find(view.render(), node => node.props["aria-label"] === label), "onClick");
      const tree = view.render();
      assert.equal(find(tree, node => node.type === "dialog").props["data-position"], expected);
      assert.equal(find(tree, node => node.type === "textarea").props.value, "My next request");
      assert.equal(find(tree, node => node.props.type === "submit").props.disabled, true);
      assert.equal(signal?.aborted, false);
    }
    assert.equal(view.storage.get("inrcy_assistant_position_v1"), "left");
    resolveRequest(Response.json({ message: "The pending answer is ready", accountId: "account-a" }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(view.render()).some(node => node.props.content === "The pending answer is ready"));
    const nextSession = harness(false, view.storage);
    nextSession.restorePosition();
    assert.equal(find(nextSession.render(), node => node.type === "dialog").props["data-position"], "left");
    nextSession.cleanup();
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("minimizing preserves the pending reply and restoring preserves the composer draft", async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    signal = init?.signal || undefined;
    return new Promise<Response>(resolve => { resolveRequest = resolve; });
  }) as typeof fetch;
  const view = harness();
  try {
    view.submit("Prepare a post");
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "A follow-up draft" } });
    invoke(find(view.render(), node => node.props["aria-label"] === "Minimize"), "onClick");
    assert.equal(view.actions.minimize, 1);
    assert.equal(view.render(false), null, "Minimized chat must remove the modal and its backdrop");
    assert.equal(signal?.aborted, false, "Minimizing must keep the same request alive");
    resolveRequest(Response.json({ message: "The prepared content", accountId: "account-a" }));
    await new Promise(resolve => setImmediate(resolve));
    const restored = view.render(true);
    assert.ok(elements(restored).some(node => node.props.content === "The prepared content"));
    assert.equal(view.actions.replies, 1, "The reply notifies the provider even while the panel is minimized");
    assert.equal(find(restored, node => node.type === "textarea").props.value, "A follow-up draft");
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("human contact appears only after an explicit backend handoff and does not send email", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { resolve: (response: Response) => void }[] = [];
  globalThis.fetch = (() => new Promise<Response>(resolve => requests.push({ resolve }))) as typeof fetch;
  const view = harness();
  const contactButtons = () => elements(view.render()).filter(node => node.type === "button" && Array.isArray(node.props.children) && node.props.children[0] === "Contact team");
  try {
    assert.equal(contactButtons().length, 0, "The empty conversation must not have a permanent contact link");
    view.submit("Please help with my channel");
    requests[0].resolve(Response.json({ message: "Here are the steps", accountId: "account-a", needsHuman: false, handoffSummary: "Ignore this unrequested summary" }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(contactButtons().length, 0, "A normal reply must not add contact access");
    view.submit("This connection remains blocked");
    requests[1].resolve(Response.json({ message: "The team can investigate", accountId: "account-a", needsHuman: true, handoffSummary: "The channel connection remains blocked after following the steps." }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(contactButtons().length, 1);
    invoke(contactButtons()[0], "onClick");
    assert.deepEqual(view.handoffs, ["My request\nThis connection remains blocked\n\nThe channel connection remains blocked after following the steps."]);
    assert.equal(requests.length, 2, "Preparing the reviewed contact draft must not send email or call AI");
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("completed media renders its safe preview and media metadata is excluded from follow-up AI requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ init, resolve }))) as typeof fetch;
  const view = harness();
  try {
    view.submit("Create an image");
    requests[0].resolve(Response.json({ message: "Image ready", accountId: "account-a", media: { ok: true, status: "completed", requestId: "generation-a", media: { id: "media-a", mediaType: "image", url: "/api/media-library/media-a/content" } } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(view.render()).some(node => node.type === "img" && node.props.src === "/api/media-library/media-a/content"));
    view.submit("Describe its colors");
    const body = JSON.parse(String(requests[1].init?.body));
    assert.equal(body.messages[1].role, "assistant");
    assert.equal("media" in body.messages[1], false);
    assert.equal("turnId" in body.messages[0], false, "Turn metadata must not be repeated inside model history");
    assert.notEqual(body.turnId, JSON.parse(String(requests[0].init?.body)).turnId);
    requests[1].resolve(Response.json({ message: "Still processing", accountId: "account-a", media: { status: "ready_to_save", requestId: "generation-b", media: { mediaType: "video", url: "javascript:alert(1)" } } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements(view.render()).some(node => node.type === "video"), false, "An unfinished job must never be shown as a playable result");
    assert.equal(elements(view.render()).some(node => String(node.props.src || "").startsWith("javascript:")), false);
    assert.ok(elements(view.render()).some(node => node.props["data-media-status"] === "processing"));
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("a late assistant reply is discarded after the browser establishment changes", async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(resolve => { resolveRequest = resolve; })) as typeof fetch;
  const view = harness();
  try {
    view.submit("Private information from account A");
    view.switchAccount();
    resolveRequest(Response.json({ message: "Account A private reply", accountId: "account-a" }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements(view.render()).some(node => node.props.content === "Account A private reply"), false);
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("discarding an assistant session aborts its pending request", async () => {
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    signal = init?.signal || undefined;
    return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
  }) as typeof fetch;
  const view = harness();
  try {
    view.submit("Help me");
    assert.equal(signal?.aborted, false);
    view.cleanup();
    assert.equal(signal?.aborted, true);
    await new Promise(resolve => setImmediate(resolve));
  } finally { globalThis.fetch = originalFetch; }
});

test("reload restores a draft and interrupted media turn without automatic work or a new turn UUID", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ init, resolve }))) as typeof fetch;
  const view = harness();
  let restored: ReturnType<typeof harness> | undefined;
  try {
    view.submit("Create a video");
    const firstBody = JSON.parse(String(requests[0].init?.body));
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "My next private draft" } });
    view.render();
    view.cleanup();
    restored = harness(false, view.storage);
    const tree = restored.render();
    assert.equal(requests.length, 1, "Reload must not send AI requests or restart a paid media job");
    assert.equal(find(tree, node => node.type === "textarea").props.value, "My next private draft");
    assert.equal(find(tree, node => node.props.role === "alert").props.children !== undefined, true);
    assert.equal(find(tree, node => node.props.type === "submit").props.disabled, false, "An interrupted browser request must not restore an endless pending state");
    invoke(find(tree, node => node.type === "button" && node.props.children === "Retry"), "onClick");
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(String(requests[1].init?.body)).turnId, firstBody.turnId, "Explicit recovery must address the original media identity");
    assert.equal(JSON.parse(String(requests[1].init?.body)).conversationId, firstBody.conversationId, "The durable conversation identity must survive a browser reload too");
    requests[1].resolve(Response.json({ message: "The existing video was recovered", accountId: "account-a" }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(restored.render()).some(node => node.props.content === "The existing video was recovered"));
  } finally { requests[0]?.resolve(Response.json({ message: "Late old reply", accountId: "account-a" })); restored?.cleanup(); globalThis.fetch = originalFetch; }
});

test("a localization rerender must not restore the saved pending snapshot over the live conversation", async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(resolve => { resolveRequest = resolve; })) as typeof fetch;
  const view = harness();
  try {
    view.submit("Prepare a post");
    view.render();
    view.restoreSession();
    assert.equal(elements(view.render()).some(node => node.props.role === "alert"), false, "An already restored instance must never manufacture an interruption while its request is alive");
    resolveRequest(Response.json({ message: "Live answer", accountId: "account-a" }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(view.render()).some(node => node.props.content === "Live answer"));
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("session restoration rejects another actor/account and expired data; logout purges only its actor", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ message: "Private account A response", accountId: "account-a" })) as typeof fetch;
  const view = harness();
  try {
    view.submit("Private account A request");
    await new Promise(resolve => setImmediate(resolve));
    view.render();
    const key = [...view.storage.keys()].find(key => key.startsWith("inrcy_assistant_session_v1:"))!;
    assert.ok(key);
    for (const scope of [{ actorUserId: "actor-a", activeAccountId: "account-b" }, { actorUserId: "actor-b", activeAccountId: "account-a" }]) {
      const other = harness(false, view.storage, scope);
      assert.equal(elements(other.render()).some(node => node.props.content === "Private account A response"), false);
      other.cleanup();
    }
    const snapshot = JSON.parse(view.storage.get(key)!);
    view.storage.set(key, JSON.stringify({ ...snapshot, accountId: "account-b" }));
    const forged = harness(false, view.storage);
    assert.equal(elements(forged.render()).some(node => node.props.content === "Private account A response"), false);
    forged.cleanup();
    view.storage.set(key, JSON.stringify({ ...snapshot, updatedAt: Date.now() - 7 * 60 * 60 * 1000 }));
    const expired = harness(false, view.storage);
    assert.equal(elements(expired.render()).some(node => node.props.content === "Private account A response"), false);
    expired.cleanup();
    view.storage.set(key, JSON.stringify(snapshot));
    view.clearActorSessions("actor-a");
    assert.equal([...view.storage.keys()].some(key => key.startsWith("inrcy_assistant_session_v1:actor-a:")), false);
    assert.equal([...view.storage.keys()].some(key => key.startsWith("inrcy_assistant_session_v1:actor-b:")), true);
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("errors stay conversational while the hidden reference is preserved for a safe retry", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ init, resolve }))) as typeof fetch;
  const view = harness();
  try {
    view.submit("What is this error?");
    requests[0].resolve(Response.json({ error: "Public error with private details excluded from future context", code: "assistant_unavailable" }, { status: 503, headers: { "X-Request-Id": "dd122b0a-27a7-4a37-8cd3-3b97ab4c2f11" } }));
    await new Promise(resolve => setImmediate(resolve));
    const tree = view.render();
    assert.equal(elements(tree).some(node => node.props.className === "errorReference"), false);
    assert.equal(elements(tree).some(node => typeof node.props.children === "string" && /private details|dd122b0a|Reference:/.test(node.props.children)), false);
    assert.ok(elements(find(tree, node => node.props.role === "alert").props.children as ReactNode).some(node => node.type === "p" && /Your request is saved/.test(String(node.props.children))));
    invoke(find(view.render(), node => node.type === "button" && node.props.children === "Retry"), "onClick");
    const context = JSON.parse(String(requests[1].init?.body)).clientContext;
    assert.equal(context.source, "untrusted_client");
    assert.equal(context.screen.tool, "Booster");
    assert.equal(context.visibleError.requestId, "dd122b0a-27a7-4a37-8cd3-3b97ab4c2f11");
    assert.equal(context.visibleError.code, "assistant_unavailable");
    assert.equal("message" in context.visibleError, false);
    assert.equal(JSON.stringify(context).includes("private"), false);
    requests[1].resolve(Response.json({ message: "Recovered", accountId: "account-a" }));
    await new Promise(resolve => setImmediate(resolve));
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

const savedConversationId = "11111111-1111-4111-8111-111111111111";
const savedTurnId = "22222222-2222-4222-8222-222222222222";
const savedSummary = { id: savedConversationId, title: "Saved conversation", updatedAt: "2026-10-26T12:00:00Z" };

test("an empty reopened chat reads durable history and resumes a pending turn only after explicit retry", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { input: string; init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ input: String(input), init, resolve }))) as typeof fetch;
  const view = harness();
  try {
    view.render(); view.loadHistoryAutomatically();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input, "/api/assistant/history");
    assert.equal(requests[0].init?.credentials, "include");
    assert.equal(requests[0].init?.body, undefined);
    requests[0].resolve(Response.json({ available: true, conversations: [savedSummary], conversation: { id: savedConversationId, messages: [{ role: "user", content: "Create my pending video", turnId: savedTurnId }], pendingTurn: { turnId: savedTurnId } } }));
    await new Promise(resolve => setImmediate(resolve));
    let tree = view.render();
    assert.equal(requests.length, 1, "Reading an interrupted turn must never restart AI or paid work");
    assert.ok(elements(tree).some(node => node.props.children === "Create my pending video"));
    invoke(find(tree, node => node.type === "button" && node.props.children === "Retry"), "onClick");
    const body = JSON.parse(String(requests[1].init?.body));
    assert.equal(body.conversationId, savedConversationId);
    assert.equal(body.turnId, savedTurnId);
    tree = view.render();
    assert.equal(elements(tree).some(node => node.props["aria-label"] === "History"), false, "Durable memory must not add a visible history browser");
    requests[1].resolve(Response.json({ message: "Recovered the existing video", accountId: "account-a", conversationId: savedConversationId, memorySaved: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(view.render()).some(node => node.props.content === "Recovered the existing video"));
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("a late durable restore cannot overwrite new typing or expose the previous establishment's messages", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { resolve: (response: Response) => void }[] = [];
  globalThis.fetch = (() => new Promise<Response>(resolve => requests.push({ resolve }))) as typeof fetch;
  const view = harness();
  try {
    view.render(); view.loadHistoryAutomatically();
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "My fresh draft" } });
    requests[0].resolve(Response.json({ available: true, conversations: [savedSummary], conversation: { id: savedConversationId, messages: [{ role: "assistant", content: "Old stored reply" }] } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(find(view.render(), node => node.type === "textarea").props.value, "My fresh draft");
    assert.equal(elements(view.render()).some(node => node.props.content === "Old stored reply"), false);
    const second = harness();
    second.render(); second.loadHistoryAutomatically();
    second.switchAccount();
    requests[1].resolve(Response.json({ available: true, conversations: [savedSummary], conversation: { id: savedConversationId, messages: [{ role: "assistant", content: "Private old account message" }] } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements(second.render()).some(node => node.props.content === "Private old account message"), false);
    assert.equal(find(view.render(), node => node.type === "textarea").props.value, "My fresh draft");
    second.cleanup();
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("a new conversation never deletes the durable archive or adds a visible history browser", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { input: string; init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ input: String(input), init, resolve }))) as typeof fetch;
  const view = harness();
  try {
    view.submit("Current question");
    const originalId = JSON.parse(String(requests[0].init?.body)).conversationId;
    requests[0].resolve(Response.json({ message: "Current answer", accountId: "account-a", memorySaved: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements(view.render()).some(node => node.props["aria-label"] === "History"), false);
    invoke(find(view.render(), node => node.props["aria-label"] === "New"), "onClick");
    assert.equal(requests.length, 1, "New conversation must not DELETE or mutate the old history");
    view.submit("A fresh conversation");
    const newId = JSON.parse(String(requests[1].init?.body)).conversationId;
    assert.notEqual(newId, savedConversationId);
    assert.notEqual(newId, originalId);
    assert.match(newId, /^[0-9a-f-]{36}$/);
    requests[1].resolve(Response.json({ message: "Fresh answer", accountId: "account-a", memorySaved: false }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(view.render()).some(node => node.props.content === "Fresh answer"));
    assert.ok(elements(view.render()).some(node => node.props.className === "memoryNotice"));
    assert.equal(requests.some(request => request.init?.method === "DELETE"), false);
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("unavailable durable memory leaves the local chat and its draft usable", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({ available: false, conversations: [] }); }) as typeof fetch;
  const view = harness();
  try {
    view.render(); view.loadHistoryAutomatically();
    await new Promise(resolve => setImmediate(resolve));
    const tree = view.render();
    assert.equal(calls, 1);
    assert.ok(elements(tree).some(node => node.props.className === "memoryNotice"));
    invoke(find(tree, node => node.type === "textarea"), "onChange", { target: { value: "My question still works" } });
    assert.equal(find(view.render(), node => node.props.type === "submit").props.disabled, false);
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("HTTP 202 keeps the user turn without inventing an assistant answer or automatically retrying", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ init, resolve }))) as typeof fetch;
  const view = harness();
  try {
    view.submit("Recover my existing request");
    const first = JSON.parse(String(requests[0].init?.body));
    requests[0].resolve(Response.json({ pending: true, conversationId: first.conversationId, turnId: first.turnId, retryAfterSeconds: 5, memorySaved: true, requestId: "pending-request-123" }, { status: 202 }));
    await new Promise(resolve => setImmediate(resolve));
    const tree = view.render();
    assert.equal(requests.length, 1, "A pending server request must never trigger a second paid call automatically");
    assert.ok(elements(tree).some(node => node.props.children === "Recover my existing request"));
    assert.ok(elements(tree).some(node => node.props.children === "Your request is still in progress; retry manually"));
    assert.equal(elements(tree).some(node => typeof node.props.content === "string"), false, "202 is a status, not a fabricated assistant message");
    invoke(find(tree, node => node.type === "button" && node.props.children === "Retry"), "onClick");
    const retry = JSON.parse(String(requests[1].init?.body));
    assert.equal(retry.turnId, first.turnId);
    assert.equal(retry.conversationId, first.conversationId);
    requests[1].resolve(Response.json({ message: "The actual saved answer", accountId: "account-a", memorySaved: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(view.render()).some(node => node.props.content === "The actual saved answer"));
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("a 60K answer survives display and restoration while follow-up model input stays bounded", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { init?: RequestInit; resolve: (response: Response) => void }[] = [];
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ init, resolve }))) as typeof fetch;
  const view = harness();
  let restored: ReturnType<typeof harness> | undefined;
  try {
    const longAnswer = "A".repeat(60000);
    view.submit("Give me the full detailed answer");
    requests[0].resolve(Response.json({ message: longAnswer, accountId: "account-a", memorySaved: true }));
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(elements(view.render()).some(node => node.props.content === longAnswer));
    view.cleanup();
    restored = harness(false, view.storage);
    assert.ok(elements(restored.render()).some(node => node.props.content === longAnswer), "The display cache must not truncate the saved answer to the model-history limit");
    restored.submit("Continue from this answer");
    const body = JSON.parse(String(requests[1].init?.body));
    assert.equal(body.messages.find((row: { role: string }) => row.role === "assistant").content.length, 12000);
    assert.ok(new TextEncoder().encode(JSON.stringify(body.messages)).byteLength <= 20000);
    requests[1].resolve(Response.json({ message: "汉".repeat(60000), accountId: "account-a", memorySaved: true }));
    await new Promise(resolve => setImmediate(resolve));
    restored.submit("Continue once more");
    const unicodeBody = JSON.parse(String(requests[2].init?.body));
    assert.ok(new TextEncoder().encode(JSON.stringify(unicodeBody.messages)).byteLength <= 20000, "The request cap must measure UTF-8 bytes for non-Latin answers too");
    requests[2].resolve(Response.json({ message: "Done", accountId: "account-a", memorySaved: true }));
    await new Promise(resolve => setImmediate(resolve));
  } finally { restored?.cleanup(); globalThis.fetch = originalFetch; }
});
