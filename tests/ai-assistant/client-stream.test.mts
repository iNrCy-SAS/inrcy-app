import assert from "node:assert/strict";
import test from "node:test";
import { readInrAssistantResponse } from "../../lib/inrAssistantClientStream.ts";

const wire = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const activity = { id: "request_a-1", agent: "publications", label: "Préparation du contenu", status: "running" };
function response(text: string, chunkSize = 47) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

test("SSE accepts split UTF-8 frames and actual agent updates before its bounded final answer", async () => {
  const rows: unknown[] = [];
  const answer = "Réponse complète 🩷 ".repeat(4000);
  const result = await readInrAssistantResponse(response(": keepalive\r\n\r\n" + wire({ type: "activity", activity }) + wire({ type: "activity", activity: { ...activity, status: "completed" } }) + wire({ type: "result", payload: { message: answer, accountId: "active-account", memorySaved: true } })), value => rows.push(value));
  assert.deepEqual(rows, [activity, { ...activity, status: "completed" }]);
  assert.equal(result.failed, false);
  assert.equal(result.payload?.message, answer.slice(0, 60000));
  assert.equal(result.payload?.accountId, "active-account");
});

test("unsupported or malformed activity never invents a collaborator or blocks the final reply", async () => {
  const rows: unknown[] = [];
  const events = [
    { ...activity, agent: "administrator" }, { ...activity, status: "planned" },
    { ...activity, id: "x".repeat(101) }, { ...activity, label: "x".repeat(161) },
  ].map(item => wire({ type: "activity", activity: item })).join("");
  const result = await readInrAssistantResponse(response(events + "data: invalid-json\n\n" + wire({ type: "result", payload: { message: "Answer" } })), value => rows.push(value));
  assert.equal(rows.length, 0); assert.equal(result.payload?.message, "Answer");
});

test("legacy JSON errors and pending requests remain compatible without fake assistant content", async () => {
  const onActivity = () => assert.fail("JSON replies must not fabricate activities");
  const error = await readInrAssistantResponse(Response.json({ error: "Unavailable", code: "quota", requestId: "request-1" }, { status: 429 }), onActivity);
  assert.equal(error.failed, true); assert.equal(error.payload?.code, "quota");
  const pending = await readInrAssistantResponse(Response.json({ pending: true, memorySaved: true }, { status: 202 }), onActivity);
  assert.equal(pending.payload?.pending, true); assert.equal(pending.payload?.message, undefined);
  const ordinary = await readInrAssistantResponse(Response.json({ message: "Plain reply" }), onActivity);
  assert.equal(ordinary.payload?.message, "Plain reply");
});

test("SSE error events retain a public diagnostic reference even over a successful HTTP response", async () => {
  const result = await readInrAssistantResponse(response(wire({ type: "error", payload: { error: "Try later", code: "temporarily_unavailable", requestId: "request-7", privateField: "not returned" } })), () => {});
  assert.equal(result.failed, true); assert.equal(result.payload?.requestId, "request-7");
  assert.equal(JSON.stringify(result).includes("privateField"), false);
});

test("an interrupted or oversized stream fails visibly instead of silently claiming completion", async () => {
  await assert.rejects(() => readInrAssistantResponse(response(wire({ type: "activity", activity })), () => {}), /without a result/);
  await assert.rejects(() => readInrAssistantResponse(response("x".repeat(800001), 800001), () => {}), /too large/);
});
