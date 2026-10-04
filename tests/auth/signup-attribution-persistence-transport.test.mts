import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

import { persistSignupAttributionOnce } from "../../lib/signupAttributionIdempotency.ts";
import { createSignupAttributionSnapshot } from "../../lib/signupAttribution.ts";

function loadPersistence(fetch: typeof globalThis.fetch) {
  const supabaseAdmin = createClient("https://example.invalid", "test-only-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const modules = new Map<string, unknown>([
    ["server-only", {}],
    ["@/lib/supabaseAdmin", { supabaseAdmin }],
    ["@/lib/signupAttributionIdempotency", { persistSignupAttributionOnce }],
  ]);
  const output = ts.transpileModule(readFileSync(new URL("../../lib/signupAttributionPersistence.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} as { persistSignupAttribution: typeof import("../../lib/signupAttributionPersistence.ts").persistSignupAttribution } };
  new Function("module", "exports", "require", output)(record, record.exports, (specifier: string) => {
    assert.ok(modules.has(specifier), `Dépendance non isolée : ${specifier}`);
    return modules.get(specifier);
  });
  return record.exports.persistSignupAttribution;
}

for (const concurrentWinner of [false, true]) {
  test(`l'insertion d'attribution utilise un tableau JSON sans HTTP 406 (${concurrentWinner ? "course perdue" : "nouveau compte"})`, async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const eventId = concurrentWinner ? "winning-event" : "browser-event";
    const persisted = { user_id: userId, event_id: eventId };
    const requests: Array<{ method: string; accept: string | null }> = [];
    let userReads = 0;
    const persist = loadPersistence(async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, "example.invalid");
      assert.equal(url.pathname, "/rest/v1/signup_attributions");
      const method = String(init?.method || "GET");
      const headers = new Headers(init?.headers);
      requests.push({ method, accept: headers.get("Accept") });
      // No explicit Accept means PostgREST's normal application/json array.
      assert.equal(headers.get("Accept") || "application/json", "application/json");
      if (method === "POST") {
        assert.match(headers.get("Prefer") || "", /resolution=ignore-duplicates/);
        assert.match(headers.get("Prefer") || "", /return=representation/);
        assert.equal(url.searchParams.get("on_conflict"), "user_id");
        const row = JSON.parse(String(init?.body));
        assert.equal(row.event_id, "browser-event");
        assert.equal(row.marketing_consent, false);
        assert.equal(row.meta_fbp, null);
        assert.equal(row.meta_fbc, null);
        return Response.json(concurrentWinner ? [] : [persisted], { status: 201 });
      }
      assert.equal(method, "GET");
      if (url.searchParams.has("user_id")) {
        userReads += 1;
        return Response.json(userReads > 1 ? [persisted] : []);
      }
      assert.equal(url.searchParams.get("event_id"), "eq.browser-event");
      return Response.json([]);
    });

    assert.deepEqual(await persist({
      userId,
      attribution: createSignupAttributionSnapshot({ eventId: "browser-event", marketingConsent: false }),
      browserMatch: { fbp: "not-consented", fbc: "not-consented", clientUserAgent: "not-consented" },
    }), { eventId });
    assert.equal(requests.filter((request) => request.method === "POST").length, 1);
    assert.equal(userReads, concurrentWinner ? 2 : 1);
  });
}
