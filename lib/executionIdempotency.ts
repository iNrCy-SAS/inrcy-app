type JsonRecord = Record<string, unknown>;

type SupabaseLike = {
  from: (table: string) => any;
};

export type ExecutionIdempotencyStatus = "running" | "completed" | "failed" | "expired";

export type ExecutionIdempotencyLock = {
  id: string;
  user_id: string;
  scope: string;
  idempotency_key: string;
  status: ExecutionIdempotencyStatus;
  result: JsonRecord | null;
  metadata: JsonRecord | null;
  locked_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ExecutionIdempotencyAcquireResult =
  | { state: "acquired"; lock: ExecutionIdempotencyLock | null; unavailable?: false }
  | { state: "completed"; lock: ExecutionIdempotencyLock; unavailable?: false }
  | { state: "running"; lock: ExecutionIdempotencyLock; unavailable?: false }
  | { state: "unavailable"; lock: null; unavailable: true; error: string };

const EXECUTION_IDEMPOTENCY_SELECT =
  "id,user_id,scope,idempotency_key,status,result,metadata,locked_at,completed_at,failed_at,expires_at,created_at,updated_at";

function isMissingTableError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    error?.code === "PGRST205" ||
    message.includes("execution_idempotency_locks")
  );
}

export function cleanExecutionIdempotencyKey(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, ":")
    .slice(0, 180);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function lockExpired(lock: ExecutionIdempotencyLock, nowMs = Date.now()) {
  const expiresAt = Date.parse(String(lock.expires_at || ""));
  return Number.isFinite(expiresAt) && expiresAt <= nowMs;
}

function normalizeLock(row: unknown): ExecutionIdempotencyLock | null {
  const record = asRecord(row);
  const id = String(record.id || "");
  const userId = String(record.user_id || "");
  const scope = String(record.scope || "");
  const key = String(record.idempotency_key || "");
  const status = String(record.status || "running") as ExecutionIdempotencyStatus;
  if (!id || !userId || !scope || !key) return null;
  return {
    id,
    user_id: userId,
    scope,
    idempotency_key: key,
    status,
    result: asRecord(record.result),
    metadata: asRecord(record.metadata),
    locked_at: String(record.locked_at || "") || null,
    completed_at: String(record.completed_at || "") || null,
    failed_at: String(record.failed_at || "") || null,
    expires_at: String(record.expires_at || "") || null,
    created_at: String(record.created_at || "") || null,
    updated_at: String(record.updated_at || "") || null,
  };
}

async function fetchExecutionIdempotencyLock(args: {
  supabase: SupabaseLike;
  userId: string;
  scope: string;
  idempotencyKey: string;
}) {
  const { data, error } = await args.supabase
    .from("execution_idempotency_locks")
    .select(EXECUTION_IDEMPOTENCY_SELECT)
    .eq("user_id", args.userId)
    .eq("scope", args.scope)
    .eq("idempotency_key", args.idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return normalizeLock(data);
}

async function tryRecoverExecutionIdempotencyLock(args: {
  supabase: SupabaseLike;
  lock: ExecutionIdempotencyLock;
  metadata: JsonRecord;
  ttlMs: number;
}) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + args.ttlMs).toISOString();
  const previousMetadata = asRecord(args.lock.metadata);
  const baseUpdate = {
    status: "running",
    metadata: {
      ...previousMetadata,
      ...args.metadata,
      ...(previousMetadata.publicationId
        ? { publicationId: previousMetadata.publicationId }
        : {}),
      recoveredAt: nowIso,
      previousStatus: args.lock.status,
    },
    locked_at: nowIso,
    failed_at: null,
    expires_at: expiresAt,
    updated_at: nowIso,
  };

  const query = args.supabase
    .from("execution_idempotency_locks")
    .update(baseUpdate)
    .eq("id", args.lock.id)
    .select(EXECUTION_IDEMPOTENCY_SELECT);

  const { data, error } =
    args.lock.status === "running"
      ? await query.lt("expires_at", nowIso).maybeSingle()
      : await query.in("status", ["failed", "expired"]).maybeSingle();

  if (error) throw error;
  return normalizeLock(data);
}

export async function acquireExecutionIdempotencyLock(args: {
  supabase: SupabaseLike;
  userId: string;
  scope: string;
  idempotencyKey: string;
  metadata?: JsonRecord;
  ttlMs?: number;
}): Promise<ExecutionIdempotencyAcquireResult> {
  const idempotencyKey = cleanExecutionIdempotencyKey(args.idempotencyKey);
  if (!idempotencyKey) return { state: "acquired", lock: null };

  const now = new Date();
  const nowIso = now.toISOString();
  const ttlMs = Math.max(60_000, Number(args.ttlMs || 30 * 60 * 1000));
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const metadata = asRecord(args.metadata);

  try {
    const { data, error } = await args.supabase
      .from("execution_idempotency_locks")
      .upsert(
        {
          user_id: args.userId,
          scope: args.scope,
          idempotency_key: idempotencyKey,
          status: "running",
          metadata,
          locked_at: nowIso,
          expires_at: expiresAt,
          updated_at: nowIso,
        },
        {
          onConflict: "user_id,scope,idempotency_key",
          ignoreDuplicates: true,
        },
      )
      .select(EXECUTION_IDEMPOTENCY_SELECT);

    if (error) throw error;
    // PostgREST returns an empty array when ON CONFLICT DO NOTHING wins.
    // maybeSingle() on a mutation requests a singular response and converts
    // that expected zero-row result into a noisy PGRST116/406.
    const inserted = Array.isArray(data) ? data[0] : data;
    if (inserted) return { state: "acquired", lock: normalizeLock(inserted) };

    const existing = await fetchExecutionIdempotencyLock({
      supabase: args.supabase,
      userId: args.userId,
      scope: args.scope,
      idempotencyKey,
    });

    if (!existing) {
      return {
        state: "unavailable",
        lock: null,
        unavailable: true,
        error: "Verrou idempotence introuvable après conflit unique.",
      };
    }
    if (existing.status === "completed") return { state: "completed", lock: existing };

    const canRecover =
      existing.status === "failed" ||
      existing.status === "expired" ||
      (existing.status === "running" && lockExpired(existing, now.getTime()));

    if (canRecover) {
      const recovered = await tryRecoverExecutionIdempotencyLock({
        supabase: args.supabase,
        lock: existing,
        metadata,
        ttlMs,
      });
      if (recovered) return { state: "acquired", lock: recovered };
    }

    return { state: "running", lock: existing };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Idempotence indisponible.";
    if (isMissingTableError(error as { code?: string; message?: string })) {
      console.warn("[idempotency] execution_idempotency_locks table missing", error);
      return { state: "unavailable", lock: null, unavailable: true, error: message };
    }
    console.warn("[idempotency] lock acquisition failed", error);
    return { state: "unavailable", lock: null, unavailable: true, error: message };
  }
}

export async function completeExecutionIdempotencyLock(args: {
  supabase: SupabaseLike;
  lockId?: string | null;
  result: JsonRecord;
  metadata?: JsonRecord;
}) {
  if (!args.lockId) return;
  const nowIso = new Date().toISOString();
  const { error } = await args.supabase
    .from("execution_idempotency_locks")
    .update({
      status: "completed",
      result: asRecord(args.result),
      metadata: asRecord(args.metadata),
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", args.lockId);
  if (error) console.warn("[idempotency] lock completion failed", error);
}

/**
 * Strict completion for durable commit boundaries. Callers must stop and
 * retry when this write cannot be verified, otherwise an expired `running`
 * key could authorize the same external action again.
 */
export async function completeExecutionIdempotencyLockOrThrow(args: {
  supabase: SupabaseLike;
  lockId?: string | null;
  result: JsonRecord;
  metadata?: JsonRecord;
}) {
  if (!args.lockId) return;
  const nowIso = new Date().toISOString();
  const { data, error } = await args.supabase
    .from("execution_idempotency_locks")
    .update({
      status: "completed",
      result: asRecord(args.result),
      metadata: asRecord(args.metadata),
      completed_at: nowIso,
      failed_at: null,
      updated_at: nowIso,
    })
    .eq("id", args.lockId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("execution_idempotency_lock_missing");
}

export async function failExecutionIdempotencyLock(args: {
  supabase: SupabaseLike;
  lockId?: string | null;
  error: string;
  result?: JsonRecord;
  metadata?: JsonRecord;
}) {
  if (!args.lockId) return;
  const nowIso = new Date().toISOString();
  const { error } = await args.supabase
    .from("execution_idempotency_locks")
    .update({
      status: "failed",
      result: {
        ...asRecord(args.result),
        error: args.error,
      },
      metadata: asRecord(args.metadata),
      failed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", args.lockId);
  if (error) console.warn("[idempotency] lock failure update failed", error);
}

export function buildCompletedExecutionResponse(lock: ExecutionIdempotencyLock) {
  return {
    ...asRecord(lock.result),
    ok: asRecord(lock.result).ok !== false,
    idempotent: true,
    idempotencyKey: lock.idempotency_key,
    idempotencyLockId: lock.id,
  };
}

export function buildRunningExecutionResponse(lock: ExecutionIdempotencyLock) {
  return {
    ok: false,
    idempotent: true,
    idempotencyPending: true,
    code: "execution_already_running",
    idempotencyKey: lock.idempotency_key,
    idempotencyLockId: lock.id,
    retryAfterSeconds: 60,
    message:
      "Cette action programmée est déjà en cours de traitement. iNrCy attend le résultat pour éviter un doublon.",
  };
}
