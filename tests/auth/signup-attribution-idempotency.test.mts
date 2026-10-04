import assert from "node:assert/strict";
import test from "node:test";

import {
  persistSignupAttributionOnce,
  type SignupAttributionStore,
} from "../../lib/signupAttributionIdempotency.ts";

type Row = { user_id: string; event_id: string; capi_status: string; campaign: string };
const duplicateEvent = (constraint = "signup_attributions_event_id_unique") =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
  });

function storeFor(userId: string, rows: Map<string, Row>) {
  const writes: string[] = [];
  const leads: string[] = [];
  const store: SignupAttributionStore = {
    async findByUserId(id) { return rows.get(id) || null; },
    async findByEventId(id) { return [...rows.values()].find((row) => row.event_id === id) || null; },
    async insertIfAbsent(eventId) {
      writes.push(eventId);
      if (rows.has(userId)) return null;
      if ([...rows.values()].some((row) => row.event_id === eventId)) throw duplicateEvent();
      const row = { user_id: userId, event_id: eventId, capi_status: "pending", campaign: "new-campaign" };
      rows.set(userId, row);
      leads.push(eventId);
      return row;
    },
  };
  return { store, writes, leads };
}

test("un nouvel utilisateur conserve l'identifiant partagé Pixel/CAPI", async () => {
  const rows = new Map<string, Row>();
  const { store, leads } = storeFor("new-user", rows);
  assert.deepEqual(await persistSignupAttributionOnce({ userId: "new-user", eventId: "browser-event" }, store), {
    eventId: "browser-event",
  });
  assert.deepEqual(leads, ["browser-event"]);
  assert.equal(rows.get("new-user")?.campaign, "new-campaign");
});

test("un event_id réutilisé ne déplace pas l'attribution et ne perd pas le nouveau Lead", async () => {
  const first = { user_id: "first-user", event_id: "shared-event", capi_status: "sent", campaign: "first-campaign" };
  const rows = new Map([[first.user_id, first]]);
  const { store, writes, leads } = storeFor("second-user", rows);
  const result = await persistSignupAttributionOnce({ userId: "second-user", eventId: "shared-event" }, store);

  assert.deepEqual(result, { eventId: "inrcy-lead-second-user" });
  assert.deepEqual(writes, ["inrcy-lead-second-user"]);
  assert.deepEqual(leads, ["inrcy-lead-second-user"]);
  assert.deepEqual(rows.get("first-user"), first);
  assert.equal(rows.get("second-user")?.campaign, "new-campaign");

  rows.get("second-user")!.capi_status = "sent";
  assert.deepEqual(await persistSignupAttributionOnce({ userId: "second-user", eventId: "shared-event" }, store), result);
  assert.equal(rows.get("second-user")?.capi_status, "sent");
  assert.equal(writes.length, 1);
  assert.equal(leads.length, 1);
});

for (const constraint of ["signup_attributions_event_id_unique", "meta_conversion_events_event_id_key"]) {
  test(`une collision concurrente ${constraint} est reprise avec l'identifiant du compte`, async () => {
    const rows = new Map<string, Row>();
    const { store, leads } = storeFor("second-user", rows);
    const insert = store.insertIfAbsent;
    store.insertIfAbsent = async (eventId) => {
      if (eventId === "racing-event") throw duplicateEvent(constraint);
      return insert(eventId);
    };
    assert.deepEqual(await persistSignupAttributionOnce({ userId: "second-user", eventId: "racing-event" }, store), {
      eventId: "inrcy-lead-second-user",
    });
    assert.deepEqual(leads, ["inrcy-lead-second-user"]);
  });
}

test("une requête concurrente du même compte conserve le résultat gagnant sans réinitialiser sent", async () => {
  const winner = { user_id: "same-user", event_id: "winning-event", capi_status: "sent", campaign: "winner" };
  const rows = new Map<string, Row>();
  const { store, leads } = storeFor("same-user", rows);
  const insert = store.insertIfAbsent;
  store.insertIfAbsent = async (eventId) => {
    rows.set(winner.user_id, winner);
    return insert(eventId);
  };
  assert.deepEqual(await persistSignupAttributionOnce({ userId: "same-user", eventId: "losing-event" }, store), {
    eventId: "winning-event",
  });
  assert.equal(rows.get("same-user")?.capi_status, "sent");
  assert.deepEqual(leads, []);
});

test("un identifiant navigateur absent utilise un identifiant stable par compte", async () => {
  const { store, leads } = storeFor("new-user", new Map());
  assert.deepEqual(await persistSignupAttributionOnce({ userId: "new-user", eventId: "" }, store), {
    eventId: "inrcy-lead-new-user",
  });
  assert.deepEqual(leads, ["inrcy-lead-new-user"]);
});

test("les erreurs de base réelles restent visibles et ne provoquent pas de réessais aveugles", async () => {
  for (const error of [
    Object.assign(new Error("permission denied"), { code: "42501" }),
    duplicateEvent("unrelated_unique_constraint"),
  ]) {
    const { store } = storeFor("new-user", new Map());
    let attempts = 0;
    store.insertIfAbsent = async () => { attempts += 1; throw error; };
    await assert.rejects(persistSignupAttributionOnce({ userId: "new-user", eventId: "browser-event" }, store), error);
    assert.equal(attempts, 1);
  }
});

test("un conflit sur l'identifiant de repli échoue sans toucher à un autre compte", async () => {
  const { store } = storeFor("new-user", new Map());
  let attempts = 0;
  store.insertIfAbsent = async () => { attempts += 1; throw duplicateEvent(); };
  await assert.rejects(persistSignupAttributionOnce({ userId: "new-user", eventId: "browser-event" }, store), /duplicate key/);
  assert.equal(attempts, 2);
});
