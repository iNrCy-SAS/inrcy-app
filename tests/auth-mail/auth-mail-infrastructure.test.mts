import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

test("Auth webhooks verify raw bodies before processing payloads", async () => {
  const supabaseRoute = await source("app/api/webhooks/supabase-auth-email/route.ts");
  const resendRoute = await source("app/api/webhooks/resend-auth-email/route.ts");
  assert.ok(supabaseRoute.indexOf("const rawBody = await request.text()") < supabaseRoute.indexOf("const payload = parseSupabaseAuthEmailHookPayload"));
  assert.ok(resendRoute.indexOf("const rawBody = await request.text()") < resendRoute.indexOf("const event = normalizeResendAuthEvent"));
  assert.match(supabaseRoute, /SEND_EMAIL_HOOK_SECRET/);
  assert.match(supabaseRoute, /status === 429[\s\S]*"Retry-After": "60"/);
  assert.match(supabaseRoute, /status === 503[\s\S]*"Retry-After": "5"/);
  assert.match(supabaseRoute, /headers: retryHeaders\(failure\.status\)/);
  assert.match(resendRoute, /RESEND_WEBHOOK_SECRET/);
  assert.doesNotMatch(supabaseRoute, /console\.(?:info|error)\([^\n]*recipient/i);
  assert.doesNotMatch(resendRoute, /console\.(?:info|error)\([^\n]*recipient/i);
});

test("migration is service-only, idempotent and has a leased alert outbox", async () => {
  const migration = await source("supabase/migrations/20260914221305_auth_email_delivery_tracking.sql");
  assert.match(migration, /auth_email_deliveries[\s\S]*enable row level security/i);
  assert.match(migration, /revoke all on public\.auth_email_deliveries from public, anon, authenticated/i);
  assert.match(migration, /primary key[\s\S]*svix_id|svix_id text primary key/i);
  assert.match(migration, /on conflict \(svix_id\) do nothing/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /delivery\.status_rank[\s\S]*greatest\(delivery\.status_rank, p_status_rank\)/i);
  assert.doesNotMatch(migration, /\braw_payload\s+(?:text|jsonb)|\btoken_hash\s+(?:text|varchar)|\btoken\s+(?:text|varchar)/i);
});

test("existing signup and resend routes remain Supabase-only to prevent duplicate mail", async () => {
  for (const relativePath of [
    "app/api/public/trial-signup/route.ts",
    "app/api/auth/resend-link/route.ts",
  ]) {
    const route = await source(relativePath);
    assert.doesNotMatch(route, /from ["']resend["']|new Resend|resend\.emails\.send/);
  }
});

test("the official signature and provider SDKs are pinned in dependencies", async () => {
  const packageJson = JSON.parse(await source("package.json")) as {
    dependencies?: Record<string, string>;
  };
  assert.match(packageJson.dependencies?.resend || "", /^\^6\./);
  assert.match(packageJson.dependencies?.standardwebhooks || "", /^\^1\./);
});
