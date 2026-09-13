import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireExecutionIdempotencyLock,
  type ExecutionIdempotencyLock,
} from "../../lib/executionIdempotency.ts";
import {
  createStorageSignErrorDiagnostic,
  isMissingStorageObjectError,
  isStorageClientError,
  isTransientStorageError,
} from "../../lib/storageSignedUrlError.ts";
import { guardedFetch } from "../../lib/supabaseClient.ts";

type QueryResult = { data: unknown; error: unknown };

function lockRow(
  overrides: Partial<ExecutionIdempotencyLock> = {},
): ExecutionIdempotencyLock {
  return {
    id: "lock-1",
    user_id: "user-1",
    scope: "publish",
    idempotency_key: "request-1",
    status: "running",
    result: null,
    metadata: null,
    locked_at: "2026-09-14T10:00:00.000Z",
    completed_at: null,
    failed_at: null,
    expires_at: "2099-09-14T10:30:00.000Z",
    created_at: "2026-09-14T10:00:00.000Z",
    updated_at: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

function scriptedSupabase(results: QueryResult[]) {
  const remaining = [...results];
  const calls: Array<Record<string, unknown>> = [];

  function nextResult() {
    const result = remaining.shift();
    assert.ok(result, "unexpected Supabase query");
    return result;
  }

  const supabase = {
    from(table: string) {
      const call: Record<string, unknown> = { table, filters: [] };
      calls.push(call);
      const query = {
        upsert(value: unknown, options: unknown) {
          call.operation = "upsert";
          call.value = value;
          call.options = options;
          return query;
        },
        update(value: unknown) {
          call.operation = "update";
          call.value = value;
          return query;
        },
        select(value: string) {
          call.select = value;
          return query;
        },
        eq(column: string, value: unknown) {
          (call.filters as unknown[]).push(["eq", column, value]);
          return query;
        },
        lt(column: string, value: unknown) {
          (call.filters as unknown[]).push(["lt", column, value]);
          return query;
        },
        in(column: string, value: unknown) {
          (call.filters as unknown[]).push(["in", column, value]);
          return query;
        },
        maybeSingle() {
          return Promise.resolve(nextResult());
        },
        then<TResult1 = QueryResult, TResult2 = never>(
          onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(nextResult()).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
  };

  return { supabase, calls, remaining };
}

test("l'acquisition idempotente insère sans générer de conflit unique", async () => {
  const inserted = lockRow();
  const fake = scriptedSupabase([{ data: [inserted], error: null }]);

  const result = await acquireExecutionIdempotencyLock({
    supabase: fake.supabase,
    userId: "user-1",
    scope: "publish",
    idempotencyKey: "request-1",
  });

  assert.equal(result.state, "acquired");
  assert.equal(result.lock?.id, "lock-1");
  assert.equal(fake.calls[0]?.operation, "upsert");
  assert.deepEqual(fake.calls[0]?.options, {
    onConflict: "user_id,scope,idempotency_key",
    ignoreDuplicates: true,
  });
  assert.equal(fake.remaining.length, 0);
});

test("un doublon ignoré relit le verrou terminé sans 23505", async () => {
  const completed = lockRow({
    status: "completed",
    result: { ok: true },
    completed_at: "2026-09-14T10:05:00.000Z",
  });
  const fake = scriptedSupabase([
    { data: [], error: null },
    { data: completed, error: null },
  ]);

  const result = await acquireExecutionIdempotencyLock({
    supabase: fake.supabase,
    userId: "user-1",
    scope: "publish",
    idempotencyKey: "request-1",
  });

  assert.equal(result.state, "completed");
  assert.equal(result.lock.id, "lock-1");
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(fake.calls[1]?.filters, [
    ["eq", "user_id", "user-1"],
    ["eq", "scope", "publish"],
    ["eq", "idempotency_key", "request-1"],
  ]);
});

test("un doublon expiré conserve la récupération conditionnelle existante", async () => {
  const expired = lockRow({
    status: "running",
    expires_at: "2000-01-01T00:00:00.000Z",
  });
  const recovered = lockRow({ expires_at: "2099-01-01T00:00:00.000Z" });
  const fake = scriptedSupabase([
    { data: [], error: null },
    { data: expired, error: null },
    { data: recovered, error: null },
  ]);

  const result = await acquireExecutionIdempotencyLock({
    supabase: fake.supabase,
    userId: "user-1",
    scope: "publish",
    idempotencyKey: "request-1",
    metadata: { source: "test" },
  });

  assert.equal(result.state, "acquired");
  assert.equal(fake.calls[2]?.operation, "update");
  assert.match(JSON.stringify(fake.calls[2]?.filters), /"lt","expires_at"/);
});

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("guardedFetch ne mutualise que les GET exacts vers auth/v1/user", async () => {
  const originalFetch = globalThis.fetch;
  const pending = deferredResponse();
  const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method || "GET").toUpperCase(),
      body: init?.body,
    });
    return pending.promise;
  }) as typeof fetch;

  try {
    const first = guardedFetch("https://project.supabase.co/auth/v1/user?source=a");
    const second = guardedFetch("https://project.supabase.co/auth/v1/user?source=b", {
      method: "GET",
    });
    assert.equal(calls.length, 1);

    pending.resolve(new Response("ok", { status: 200 }));
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    assert.notEqual(firstResponse, secondResponse);
    assert.equal(await firstResponse.text(), "ok");
    assert.equal(await secondResponse.text(), "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("guardedFetch ne fusionne ni PUT auth/user ni les sous-routes", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: String(init?.method || "GET").toUpperCase(),
      body: init?.body,
    });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    await Promise.all([
      guardedFetch("https://project.supabase.co/auth/v1/user", { method: "GET" }),
      guardedFetch("https://project.supabase.co/auth/v1/user", {
        method: "PUT",
        body: '{"password":"new-value"}',
      }),
      guardedFetch("https://project.supabase.co/auth/v1/user/identities", {
        method: "GET",
      }),
    ]);

    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(({ method }) => method).sort(), ["GET", "GET", "PUT"]);
    assert.equal(calls.find(({ method }) => method === "PUT")?.body, '{"password":"new-value"}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("les 401/403 des méthodes non-GET exactes invalident aussi la session", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent(event: Event) {
        events.push(event.type);
        return true;
      },
    },
  });
  globalThis.fetch = (async () => new Response(null, { status: 403 })) as typeof fetch;

  try {
    await guardedFetch("https://project.supabase.co/auth/v1/user", { method: "PUT" });
    assert.deepEqual(events, ["inrcy:auth-session-invalid"]);

    await guardedFetch("https://project.supabase.co/auth/v1/user/identities", {
      method: "DELETE",
    });
    assert.deepEqual(events, ["inrcy:auth-session-invalid"]);
  } finally {
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
    await guardedFetch("https://project.supabase.co/auth/v1/user", { method: "PUT" });
    globalThis.fetch = originalFetch;
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("les erreurs Storage missing, invalides et transitoires restent distinctes", () => {
  assert.equal(isMissingStorageObjectError({ status: 404, code: "InvalidRequest" }), true);
  assert.equal(isMissingStorageObjectError({ status: 400, statusCode: "NoSuchKey" }), true);
  assert.equal(isMissingStorageObjectError({ status: 400, code: "NoSuchBucket" }), true);
  assert.equal(isMissingStorageObjectError({ status: 400, code: "not_found" }), true);
  assert.equal(isMissingStorageObjectError({ status: 400, message: "Object not found" }), true);
  assert.equal(isMissingStorageObjectError({ status: 400, code: "InvalidRequest" }), false);
  assert.equal(isStorageClientError({ status: 400, code: "InvalidRequest" }), true);
  assert.equal(isTransientStorageError({ status: 429 }), true);
  assert.equal(isTransientStorageError({ statusCode: "503" }), true);
  assert.equal(isTransientStorageError({ status: 400, code: "InvalidRequest" }), false);
});

test("le diagnostic Storage est stable et n'expose aucune donnée brute", () => {
  const input = {
    error: {
      status: 400,
      statusCode: "InvalidRequest",
      message: "bad token=secret for clients/private-name.png",
    },
    bucket: "private-clients",
    path: "client@example.com/private-name.png",
  };
  const first = createStorageSignErrorDiagnostic(input);
  const second = createStorageSignErrorDiagnostic(input);
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    status: 400,
    code: "InvalidRequest",
    object_fingerprint: first.object_fingerprint,
  });
  assert.match(first.object_fingerprint, /^[a-f0-9]{20}$/);
  assert.doesNotMatch(serialized, /private-clients|client@example|private-name|token|secret/i);
});
