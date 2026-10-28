import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Settings from "../../lib/inrAssistantSettingsTools.ts";
import * as commandRegistry from "../../lib/inrAssistantCommandRegistry.ts";
type Row = Record<string, unknown>;
type Definition = { execute(input: unknown): Promise<Row> };
function harness(options: { message?: string; edition?: "standard" | "premium" | "founder"; foreign?: boolean; partial?: boolean; unavailable?: boolean } = {}) {
  const records: Record<string, Row> = {
    calendar: { ok: true, selectedMailAccountId: "mail-a", sendConfirmationOnSave: false, reminderOffsetsMinutes: [1440, 120], accounts: [{ secret: "PRIVATE" }] },
    notifications: { preferences: { in_app_enabled: true, email_enabled: true, performance_enabled: false, action_enabled: true, information_enabled: true, digest_every_hours: 48, user_id: "PRIVATE_ACCOUNT" } },
    documents: { ok: true, settings: { quote: { validityDays: 30, mention: "Merci" }, invoice: { dueDays: 30 }, internalSecret: "PRIVATE" } },
    badge: { ok: true, settings: { phone: false, logo: true, threads: true, appointment: true, quote: false }, private: "PRIVATE" },
    studio: { ok: true, preferences: { version: 1, blocks: { "2": { saved: false, defaults: { format: "square", typology: "service" } }, "3": { defaults: { creativity: "faithful" } } } } },
    tiktok: { ok: true, tiktok: { access_token: "PRIVATE_TOKEN", defaults: { allowComments: true, allowDuo: true, commercialContent: "none", aiContent: false } } },
  };
  const calls: { target: string; method: string; body?: Row; request?: Request }[] = [];
  const route = (target: string) => ({
    GET: async () => { calls.push({ target, method: "GET" }); return Response.json(records[target], { status: options.unavailable ? 503 : 200 }); },
    ...Object.fromEntries(["PUT", "POST", "PATCH"].map(method => [method, async (request: Request) => {
      const body = await request.json() as Row; calls.push({ target, method, body, request });
      if (!options.partial) {
        if (target === "notifications") records[target].preferences = body;
        else if (target === "badge") records[target].settings = body.settings;
        else if (target === "calendar") Object.assign(records[target], body);
        else if (target === "studio") {
          const blocks = (records.studio.preferences as Row).blocks as Row;
          blocks[String(body.blockId)] = { saved: body.saved, defaults: body.defaults };
        } else if (target === "documents") {
          const settings = records.documents.settings as Row; const patch = body.settings as Row;
          for (const [key, value] of Object.entries(patch)) settings[key] = { ...settings[key] as Row, ...value as Row };
        }
      }
      return Response.json({ ok: true });
    }])),
  });
  const stubs: Record<string, unknown> = {
    "./inrAssistantCommandRegistry.ts": commandRegistry,
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.foreign ? "foreign" : "active", errorResponse: null }) },
    "@/app/api/calendar/settings/route": route("calendar"), "@/app/api/notifications/preferences/route": route("notifications"),
    "@/app/api/documents/settings/route": route("documents"), "@/app/api/inrbadge/settings/route": route("badge"),
    "@/app/api/media-generation/preferences/route": route("studio"), "@/app/api/integrations/tiktok/settings/route": route("tiktok"),
  };
  const code = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantSettingsTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Request, Response, Headers, URL, Map, console })((name: string) => { assert.ok(name in stubs, name); return stubs[name]; }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof Settings;
  const tools = runtime.createInrAssistantSettingsTools({ request: new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "session=synthetic", authorization: "Bearer synthetic" } }), accountId: "active", edition: options.edition ?? "premium", currentUserMessage: options.message ?? "Désactive les notifications par email." });
  return { tools: tools as unknown as Record<keyof typeof tools, Definition>, records, calls };
}
const change = (tool: string, quote: string, field: string, value: unknown) => ({ tool, instructionQuote: quote, changes: [{ field, value }] });

test("settings read exposes only the fixed public projection", async () => {
  const h = harness();
  for (const tool of ["calendar", "notifications", "badge", "studio", "tiktok"]) {
    const result = await h.tools.readToolSettings.execute({ tool });
    assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  }
  assert.equal(h.calls.some(call => call.method !== "GET"), false);
});
test("notification partial edit preserves unrelated disabled preferences and forwards authentication", async () => {
  const h = harness(); const input = change("notifications", "Désactive les notifications par email.", "email_enabled", false);
  const result = await h.tools.updateToolSettings.execute(input);
  assert.equal(result.status, "saved"); assert.equal((h.records.notifications.preferences as Row).performance_enabled, false);
  const write = h.calls.find(call => call.method === "PUT")!;
  assert.equal(write.body?.in_app_enabled, true); assert.equal(write.body?.user_id, undefined);
  assert.equal(write.request?.headers.get("cookie"), "session=synthetic"); assert.equal(write.request?.headers.get("authorization"), "Bearer synthetic");
  await h.tools.updateToolSettings.execute(input); assert.equal(h.calls.filter(call => call.method === "PUT").length, 1);
});
test("questions, negations and quoted old instructions never write", async () => {
  for (const message of ["Comment désactiver les notifications par email ?", "Ne modifie pas les notifications.", "Souviens-toi : « Désactive les notifications par email ».", "Explique comment modifier les notifications.", "Est-ce que je peux modifier les notifications ?", "Est-il possible de désactiver les notifications ?", "Si je change les notifications, que se passe-t-il ?"]) {
    const h = harness({ message }); const result = await h.tools.updateToolSettings.execute(change("notifications", message, "email_enabled", false));
    assert.equal(result.status, "needs_instruction"); assert.equal(h.calls.length, 0);
  }
});
test("polite requests directed at the assistant still authorize the requested setting", async () => {
  for (const message of ["Peux-tu désactiver les notifications par email ?", "Est-ce que tu peux modifier les notifications pour désactiver les emails ?"]) {
    const h = harness({ message });
    assert.equal((await h.tools.updateToolSettings.execute(change("notifications", message, "email_enabled", false))).status, "saved");
  }
});
test("foreign active account, unavailable source and offer restrictions fail closed", async () => {
  for (const options of [{ foreign: true }, { unavailable: true }]) {
    const h = harness(options); const result = await h.tools.updateToolSettings.execute(change("notifications", "Désactive les notifications par email.", "email_enabled", false));
    assert.equal(result.ok, false); assert.equal(h.calls.some(call => call.method !== "GET"), false);
  }
  const h = harness({ edition: "standard" });
  assert.equal((await h.tools.readToolSettings.execute({ tool: "calendar" })).ok, false);
  assert.equal((await h.tools.readToolSettings.execute({ tool: "documents" })).ok, false);
  assert.equal(h.calls.length, 0);
});
test("unknown/prototype fields, type confusion and guessed TikTok disclosures are refused", async () => {
  for (const [field, value] of [["user_id", "foreign"], ["__proto__.secret", true], ["email_enabled", "false"]]) {
    const h = harness(); assert.equal((await h.tools.updateToolSettings.execute(change("notifications", "Désactive les notifications par email.", field as string, value))).ok, false);
    assert.equal(h.calls.some(call => call.method !== "GET"), false);
  }
  const message = "Modifie TikTok pour les vidéos IA."; const h = harness({ message });
  assert.equal((await h.tools.updateToolSettings.execute(change("tiktok", message, "defaults.aiContent", true))).status, "confirmation_required");
});
test("Studio modifies one saved block and preserves its other criteria", async () => {
  const message = "Mets le format portrait dans iNrStudio pour mes images."; const h = harness({ message });
  const result = await h.tools.updateToolSettings.execute(change("studio", message, "2.format", "portrait"));
  assert.equal(result.status, "saved"); const write = h.calls.find(call => call.method === "PATCH")!;
  assert.equal(write.body?.blockId, 2); assert.equal((write.body?.defaults as Row).typology, "service");
  assert.equal((write.body?.defaults as Row).format, "portrait");
});
test("Badge preserves existing hidden toggles and documents use native partial settings", async () => {
  const quote = "Active mon téléphone sur iNrBadge."; const h = harness({ message: quote });
  assert.equal((await h.tools.updateToolSettings.execute(change("badge", quote, "phone", true))).status, "saved");
  assert.equal((h.calls.find(call => call.method === "PATCH")?.body?.settings as Row).threads, true);
  const message = "Mets la validité des devis à 45 jours."; const d = harness({ message, edition: "founder" });
  assert.equal((await d.tools.updateToolSettings.execute(change("documents", message, "quote.validityDays", 45))).status, "saved");
  assert.equal(((d.records.documents.settings as Row).quote as Row).mention, "Merci");
});
test("native normalized/refused values are reported as partial instead of falsely saved", async () => {
  const h = harness({ partial: true });
  assert.equal((await h.tools.updateToolSettings.execute(change("notifications", "Désactive les notifications par email.", "email_enabled", false))).status, "partial");
});
