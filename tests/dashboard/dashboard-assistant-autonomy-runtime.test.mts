import assert from "node:assert/strict";
import test from "node:test";
import { elements, find, invoke, harness } from "./dashboard-assistant-runtime-harness.mts";
import { getInrAssistantNavigation } from "../../lib/inrAssistantUiCommands.ts";
const tick = () => new Promise(resolve => setImmediate(resolve));

test("a fresh navigation receipt opens the actual destination once and never replays from saved history", async () => {
  const original = globalThis.fetch, storage = new Map<string, string>();
  globalThis.fetch = (async () => Response.json({ message: "Ouverture demandée", accountId: "account-a", navigation: getInrAssistantNavigation("crm") })) as typeof fetch;
  const view = harness(false, storage);
  try {
    view.submit("Ouvre mon CRM"); await tick(); view.render();
    assert.deepEqual(view.navigations, ["/dashboard/crm"]);
    const restored = harness(false, storage);
    try { restored.render(); assert.deepEqual(restored.navigations, []); } finally { restored.cleanup(); }
  } finally { view.cleanup(); globalThis.fetch = original; }
});

test("native PDF reports the browser outcome and never announces a failed download as complete", async () => {
  const original = globalThis.fetch;
  const command = { command: "export_document_pdf", selection: { kind: "invoice", id: "invoice-1" } };
  globalThis.fetch = (async () => Response.json({ message: "PDF demandé", accountId: "account-a", uiCommand: command })) as typeof fetch;
  const view = harness(); view.onScreenCommand(async () => false);
  try {
    view.submit("Télécharge le PDF"); await tick();
    assert.deepEqual(view.screenCommands, [command]);
    const text = elements(view.render()).map(node => node.props.content || "").join(" ");
    assert.match(text, /could not be downloaded/);
    assert.doesNotMatch(text, /download started/);
  } finally { view.cleanup(); globalThis.fetch = original; }
});

test("a late account switch suppresses both navigation and PDF commands", async () => {
  const original = globalThis.fetch;
  let complete!: (value: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(resolve => { complete = resolve; })) as typeof fetch;
  const view = harness();
  try {
    view.submit("Ouvre la facture et télécharge le PDF"); view.switchAccount();
    complete(Response.json({ message: "Action demandée", accountId: "account-a", navigation: getInrAssistantNavigation("invoices"), uiCommand: { command: "export_document_pdf", selection: { kind: "invoice", id: "invoice-1" } } }));
    await tick(); assert.deepEqual(view.navigations, []); assert.deepEqual(view.screenCommands, []);
  } finally { view.cleanup(); globalThis.fetch = original; }
});

test("the progress button sends a typed status check without relaunching or replacing a draft", async () => {
  const original = globalThis.fetch, bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ message: "Traitement en cours", accountId: "account-a", taskProgress: { outcome: "processing", completed: ["Contact créé"], remaining: ["Média en traitement"] } }); }) as typeof fetch;
  const view = harness();
  try {
    view.submit("Crée le contact et son image"); await tick();
    const button = () => find(view.render(), node => node.type === "button" && node.props.children === "Check progress");
    assert.equal(bodies.length, 1);
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "Brouillon à garder" } });
    assert.equal(button().props.disabled, true);
    invoke(find(view.render(), node => node.type === "textarea"), "onChange", { target: { value: "" } });
    invoke(button(), "onClick"); await tick();
    assert.equal(bodies.length, 2); assert.equal(bodies[1].taskIntent, "check_status");
    assert.notEqual(bodies[0].turnId, bodies[1].turnId);
  } finally { view.cleanup(); globalThis.fetch = original; }
});
