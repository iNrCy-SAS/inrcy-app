import { NextResponse } from "next/server";
import { withApi } from "@/lib/observability/withApi";
import { requireUser } from "@/lib/requireUser";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const SENSITIVE_KEY_RE =
  /(^|_)(token|secret|password|cookie|authorization|api_key|apikey|private_key|client_secret|webhook_secret|signing_secret|smtp_pass|imap_pass|oauth)(_|$)/i;

const SENSITIVE_EXACT_KEYS = new Set([
  "access_token_enc",
  "refresh_token_enc",
  "id_token",
  "id_token_enc",
  "token_enc",
  "password_enc",
  "secret_enc",
  "provider_account_id",
  "resource_id",
  "provider_page_id",
  "provider_user_id",
  "stripe_customer_id",
  "stripe_subscription_id",
  "stripe_price_id",
  "template_key",
  "provider_message_id",
  "message_id",
  "origin_action",
  "idempotency_key",
]);

const SETTINGS_SAFE_KEYS = new Set([
  "timezone",
  "locale",
  "signature_enabled",
  "sender_name",
  "from_name",
  "reply_to",
  "daily_digest",
  "notifications",
  "sync_enabled",
  "imap",
  "smtp",
]);

type ExportBlock = {
  table: string;
  rows: unknown[];
  error?: string;
};

type QueryResult = { data?: unknown[] | null; error?: { message: string } | null };
type ExportQuery = PromiseLike<QueryResult> & {
  order: (_column: string, _options: { ascending: boolean }) => ExportQuery;
  limit: (_value: number) => ExportQuery;
};
type ExportSupabaseLike = {
  from: (_table: string) => {
    select: (_query: string) => {
      eq: (_column: string, _value: string) => ExportQuery;
    };
  };
};

function sanitizeScalar(key: string, value: unknown): unknown {
  if (value == null) return value;
  if (SENSITIVE_EXACT_KEYS.has(key) || SENSITIVE_KEY_RE.test(key)) return "[redacted]";
  return value;
}

function sanitizeSettings(value: unknown): unknown {
  const input = asRecord(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!SETTINGS_SAFE_KEYS.has(k)) continue;
    if (k === "imap" || k === "smtp") {
      const cfg = asRecord(v);
      out[k] = {
        host: typeof cfg.host === "string" ? cfg.host : null,
        port: typeof cfg.port === "number" ? cfg.port : null,
        secure: typeof cfg.secure === "boolean" ? cfg.secure : null,
        starttls: typeof cfg.starttls === "boolean" ? cfg.starttls : null,
      };
      continue;
    }
    out[k] = sanitizeDeep(v, k);
  }
  return out;
}

function sanitizeDeep(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, key));
  if (value && typeof value === "object") {
    const input = asRecord(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (k === "settings") {
        out[k] = sanitizeSettings(v);
        continue;
      }
      if (k === "meta") {
        out[k] = sanitizeDeep(v, k);
        continue;
      }
      out[k] = sanitizeDeep(sanitizeScalar(k, v), k);
    }
    return out;
  }
  return sanitizeScalar(key, value);
}

function sanitizeRow(table: string, row: unknown): unknown {
  const r = asRecord(row);
  if (table === "integrations") {
    return {
      id: r.id ?? null,
      user_id: r.user_id ?? null,
      provider: r.provider ?? null,
      category: r.category ?? null,
      product: r.product ?? null,
      account_email: r.account_email ?? null,
      display_name: r.display_name ?? null,
      status: r.status ?? null,
      expires_at: r.expires_at ?? null,
      scopes: Array.isArray(r.scopes) ? r.scopes : [],
      settings: sanitizeSettings(r.settings),
      meta: sanitizeDeep(r.meta),
      created_at: r.created_at ?? null,
      updated_at: r.updated_at ?? null,
      source: r.source ?? null,
      resource_label: r.resource_label ?? null,
    };
  }
  if (table === "subscriptions") {
    return {
      user_id: r.user_id ?? null,
      plan: r.plan ?? null,
      status: r.status ?? null,
      monthly_price_eur: r.monthly_price_eur ?? null,
      start_date: r.start_date ?? null,
      next_renewal_date: r.next_renewal_date ?? null,
      cancel_requested_at: r.cancel_requested_at ?? null,
      end_date: r.end_date ?? null,
      requested_plan: r.requested_plan ?? null,
      requested_at: r.requested_at ?? null,
      scheduled_plan: r.scheduled_plan ?? null,
      last_trial_reminder_d: r.last_trial_reminder_d ?? null,
      last_reminder_at: r.last_reminder_at ?? null,
      contact_email: r.contact_email ?? null,
      updated_at: r.updated_at ?? null,
      notes: r.notes ?? null,
    };
  }
  return sanitizeDeep(row);
}

async function fetchUserTable(
  supabase: ExportSupabaseLike,
  table: string,
  userId: string,
  opts?: { limit?: number; orderBy?: string; desc?: boolean }
): Promise<ExportBlock> {
  try {
    let q = supabase.from(table).select("*").eq("user_id", userId);
    if (opts?.orderBy) q = q.order(opts.orderBy, { ascending: !opts.desc });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) return { table, rows: [], error: "Impossible de récupérer cette partie de vos données pour le moment." };
    return { table, rows: (data ?? []).map((row) => sanitizeRow(table, row)) };
  } catch (_e: unknown) {
    return { table, rows: [], error: "Impossible de récupérer cette partie de vos données pour le moment." };
  }
}

export const GET = withApi(async () => {
  const { supabase, user, authUserId, accountScope, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  if (!accountScope) {
    return NextResponse.json({ error: "Contexte établissement indisponible." }, { status: 500 });
  }
  const exportSupabase = supabase as unknown as ExportSupabaseLike;

  // Minimal set: add more tables if/when schema evolves.
  const tables: Array<{ table: string; opts?: { limit?: number; orderBy?: string; desc?: boolean } }> = [
    { table: "profiles" },
    { table: "business_profiles" },
    { table: "integrations" },
    { table: "doc_saves", opts: { limit: 5000, orderBy: "created_at", desc: true } },
    { table: "stats_cache", opts: { limit: 5000, orderBy: "created_at", desc: true } },
    { table: "agenda_events", opts: { limit: 1000, orderBy: "start_at" } },
    { table: "crm_contacts", opts: { limit: 5000, orderBy: "created_at", desc: true } },
    { table: "send_items", opts: { limit: 5000, orderBy: "created_at", desc: true } },
    { table: "inrsend_history_files", opts: { limit: 5000, orderBy: "created_at", desc: true } },
    { table: "subscriptions" },
    { table: "loyalty_ledger", opts: { limit: 5000, orderBy: "created_at", desc: true } },
    { table: "loyalty_balance" },
    { table: "boutique_orders", opts: { limit: 2000, orderBy: "created_at", desc: true } },
    { table: "pro_tools_configs" },
    { table: "publications", opts: { limit: 2000, orderBy: "created_at", desc: true } },
    { table: "publication_deliveries", opts: { limit: 5000, orderBy: "created_at", desc: true } },
    { table: "site_articles", opts: { limit: 5000, orderBy: "created_at", desc: true } },
    // app_events can be very large; keep a bounded recent slice.
    { table: "app_events", opts: { limit: 2000, orderBy: "created_at", desc: true } },
  ];

  const accountIds = Array.from(new Set(accountScope.accounts.map((account) => account.id)));
  const businessTables = tables.filter((table) => table.table !== "subscriptions");
  const businessBlocks = await Promise.all(
    businessTables.map(async (table) => {
      const scopedBlocks = await Promise.all(
        accountIds.map((accountId) => fetchUserTable(exportSupabase, table.table, accountId, table.opts)),
      );
      return {
        table: table.table,
        rows: scopedBlocks.flatMap((block) => block.rows),
        ...(scopedBlocks.some((block) => block.error)
          ? { error: "Une partie de ces données n’a pas pu être récupérée." }
          : {}),
      } satisfies ExportBlock;
    }),
  );
  const subscriptionBlock = await fetchUserTable(exportSupabase, "subscriptions", authUserId);
  const blocks = [...businessBlocks, subscriptionBlock];

  const payload = {
    exported_at: new Date().toISOString(),
    user: {
      id: authUserId,
      email: user.email ?? null,
      created_at: asRecord(user)["created_at"] ?? null,
    },
    establishments: accountScope.accounts.map((account) => ({
      id: account.id,
      display_name: account.displayName,
      role: account.role,
      is_default: account.isDefault,
    })),
    data: blocks,
  };

  const fname = `inrcy-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename=\"${fname}\"`,
      "cache-control": "no-store",
    },
  });
}, { route: "/api/account/export" });
