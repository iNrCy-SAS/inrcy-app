import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { invoiceSubscriptionId } from "../../lib/stripeWebhookPayload.ts";

type Row = Record<string, unknown>;
function load<T>(file: string, modules: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as T };
  new Function("module", "exports", "require", "process", code)(loaded, loaded.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unmocked dependency ${name}`); return modules[name];
  }, { env: { STRIPE_SECRET_KEY: "fixture" } });
  return loaded.exports;
}
function fixture(options: { approved?: boolean; authenticated?: boolean; badStripeCustomer?: boolean; lookupFailure?: boolean } = {}) {
  const approved = { account_id: "business_second", auth_user_id: "payer", stripe_subscription_id: "sub_second", stripe_customer_id: "cus_second", plan: "Premium", monthly_price_eur: 58, billing_provider: "stripe" };
  const legacy = { stripe_subscription_id: "sub_first", stripe_customer_id: "cus_first", plan: "Standard", billing_provider: "stripe" };
  const reads: string[] = [], posts: Array<{ path: string; params: URLSearchParams }> = [];
  const deps = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => options.authenticated === false ? { errorResponse: Response.json({}, { status: 401 }) }
      : { user: { id: "payer" }, activeUserId: "business_second", errorResponse: null } },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from(table: string) {
      assert.equal(table, "subscriptions");
      const query = { select() { return query; }, eq(key: string, id: string) { assert.equal(key, "user_id"); assert.equal(id, "payer"); return query; },
        async maybeSingle() { return { data: legacy, error: null }; } }; return query;
    } } },
    "@/lib/accountBillingSubscriptionServer": { getApprovedAccountSubscription: async (account: string, actor: string) => {
      assert.equal(account, "business_second"); assert.equal(actor, "payer");
      if (options.lookupFailure) throw new Error("unavailable");
      return options.approved === false ? null : approved;
    } },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_: unknown, fallback: string) => fallback },
    "@/lib/stripeWebhookPayload": { invoiceSubscriptionId },
    "@/lib/stripeCheckoutPreflight": {}, "@/lib/accountSubscriptionPolicy": {},
    "@/lib/stripeRest": {
      getAppUrl: () => "https://app.invalid",
      stripeGet: async (path: string) => {
        reads.push(path);
        if (path === "/subscriptions/sub_second") return { id: "sub_second", customer: options.badStripeCustomer ? "cus_wrong" : "cus_second" };
        if (path.startsWith("/invoices?")) return { data: [
          { id: "in_second", subscription: "sub_second", total: 6960, status: "paid" },
          { id: "in_first", subscription: "sub_first", total: 6960, status: "paid" },
        ] };
        throw new Error("Unexpected Stripe read");
      },
      stripePost: async (path: string, params: URLSearchParams) => { posts.push({ path, params }); return { url: "https://billing.invalid" }; },
    },
  };
  return { approved, legacy, reads, posts, deps };
}
test("account summary uses the selected approved contract and keeps a private uncached response", async () => {
  const f = fixture(); const route = load<{ GET(): Promise<Response> }>("app/api/billing/account-subscription/route.ts", f.deps);
  const response = await route.GET();
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, accountId: "business_second", subscription: f.approved });
});
test("normal multicompte remains on its payer contract unless a protected contract is explicitly configured", async () => {
  const f = fixture({ approved: false }); const route = load<{ GET(): Promise<Response> }>("app/api/billing/account-subscription/route.ts", f.deps);
  assert.deepEqual(((await (await route.GET()).json()) as Row).subscription, f.legacy);
});
test("summary authentication and lookup errors fail closed", async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ lookupFailure: true }, 503]] as const) {
    const f = fixture(options); const route = load<{ GET(): Promise<Response> }>("app/api/billing/account-subscription/route.ts", f.deps);
    assert.equal((await route.GET()).status, status); assert.equal(f.reads.length, 0); assert.equal(f.posts.length, 0);
  }
});
test("invoice history filters the second establishment's exact contract", async () => {
  const f = fixture(); const route = load<{ GET(): Promise<Response> }>("app/api/billing/invoices/route.ts", f.deps);
  const response = await route.GET(); const body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.invoices.map((row: Row) => row.id), ["in_second"]);
  assert.equal(new URL(`https://stripe.invalid${f.reads[0]}`).searchParams.get("customer"), "cus_second");
});
test("portal ignores forged body IDs and verifies the current contract customer before creating a session", async () => {
  for (const badStripeCustomer of [false, true]) {
    const f = fixture({ badStripeCustomer }); const route = load<{ POST(req: Request): Promise<Response> }>("app/api/billing/portal/route.ts", f.deps);
    const response = await route.POST(new Request("https://app.invalid", { method: "POST", body: JSON.stringify({ customer: "cus_forged", accountId: "another" }) }));
    assert.equal(response.status, badStripeCustomer ? 500 : 200);
    assert.deepEqual(f.reads, ["/subscriptions/sub_second"]);
    if (badStripeCustomer) assert.equal(f.posts.length, 0);
    else { assert.equal(f.posts[0].path, "/billing_portal/sessions"); assert.equal(f.posts[0].params.get("customer"), "cus_second"); }
  }
});
test("client drops a response if the selected establishment changes during the request", async () => {
  let account = "business_first";
  let finish: (value: Response) => void = () => {};
  const promise = new Promise<Response>(resolve => { finish = resolve; });
  const code = ts.transpileModule(readFileSync(new URL("../../lib/accountBillingSubscriptionClient.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as { readCurrentAccountSubscription<T>(id: string): Promise<T | null> } };
  new Function("module", "exports", "require", "fetch", code)(loaded, loaded.exports,
    () => ({ resolveActiveBrowserUserId: () => account }), () => promise);
  const pending = loaded.exports.readCurrentAccountSubscription("payer");
  account = "business_second";
  finish(Response.json({ ok: true, accountId: "business_first", subscription: { plan: "Premium" } }));
  await assert.rejects(pending, /ACCOUNT_SUBSCRIPTION_SCOPE_CHANGED/);
});
