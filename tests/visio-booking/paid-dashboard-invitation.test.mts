import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { chromium } from "@playwright/test";
import * as policy from "../../lib/directSignupPolicy.ts";
import * as invoices from "../../lib/stripeWebhookPayload.ts";

const read = (file: string) => readFileSync(new URL("../../" + file, import.meta.url), "utf8");
const route = ts.transpileModule(read("app/api/dashboard/setup-intro/route.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const marker = { [policy.DIRECT_SIGNUP_METADATA_KEY]: { version: 1, entry: "basique", created_at: "2026-11-01T12:00:00Z" } };

function fixture() {
  const state = {
    direct: true, account: "owner", claimed: false, status: "active", subscription: "sub_test",
    invoice: { customer: "cus_test", subscription: "sub_test", status: "paid", amount_paid: 2900 },
    checks: 0,
  };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: Response },
    "@/lib/multicompte/server": { resolveActiveInrcyAccountId: async () => state.account },
    "@/lib/supabaseServer": { createSupabaseServer: () => ({ auth: { getUser: () => ({ data: {
      user: { id: "owner", email: "example@example.invalid", app_metadata: state.direct ? marker : {} },
    } }) } }) },
    "@/lib/directSignupPolicy": policy, "@/lib/stripeWebhookPayload": invoices,
    "@/lib/stripeRest": { stripeGet: async (path: string) => {
      const url = new URL(path, "https://api.stripe.com");
      assert.equal(url.pathname, "/invoices"); assert.equal(url.searchParams.get("subscription"), "sub_test");
      assert.equal(url.searchParams.get("customer"), "cus_test"); assert.equal(url.searchParams.get("status"), "paid");
      state.checks++;
      return { data: [state.invoice] };
    } },
    "@/lib/visioBookingToken": { createVisioBookingToken: ({ userId }: { userId: string }) => {
      assert.equal(userId, "owner"); return "synthetic-invitation";
    } },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => {
      if (table === "subscriptions") return { select: () => ({ eq: () => ({ maybeSingle: () => ({ data: {
        status: state.status, stripe_subscription_id: state.subscription, stripe_customer_id: "cus_test",
      } }) }) }) };
      assert.equal(table, "inrcy_accounts");
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => ({ data: { dashboard_setup_intro_seen_at: state.claimed ? "seen" : null } }) }) }),
        update: () => ({ eq: () => ({ is: () => ({ select: () => {
          const show = !state.claimed; state.claimed = true; return { data: show ? [{ id: state.account }] : [] };
        } }) }) }),
      };
    } } },
  };
  const output = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", route)(output, output.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), name); return modules[name];
  });
  const claim = async () => (await output.exports.POST(new Request("https://app.example.invalid/api/dashboard/setup-intro?success=1", {
    method: "POST", body: JSON.stringify({ accountId: state.account, paid: true }),
  }))).json();
  return { state, claim };
}

test("a browser return, unpaid account, zero invoice, or another subscription's payment never claims the invitation", async () => {
  const { state, claim } = fixture();
  for (const status of ["incomplete", "trialing", "past_due", "canceled"]) {
    state.status = status; assert.deepEqual(await claim(), { accountId: "owner", show: false });
  }
  assert.equal(state.checks, 0);
  state.status = "active"; state.invoice.amount_paid = 0;
  assert.equal((await claim()).show, false);
  state.invoice.amount_paid = 2900; state.invoice.status = "open";
  assert.equal((await claim()).show, false);
  state.invoice.status = "paid"; state.invoice.subscription = "sub_other";
  assert.equal((await claim()).show, false);
  state.invoice.subscription = "sub_test"; state.invoice.customer = "cus_other";
  assert.equal((await claim()).show, false);
  assert.equal(state.claimed, false);
  state.invoice.customer = "cus_test";
  const concurrent = await Promise.all([claim(), claim()]);
  assert.equal(concurrent.filter(r => r.show && r.bookingToken === "synthetic-invitation").length, 1);
  assert.equal(concurrent.filter(r => !r.show && !r.bookingToken).length, 1);
  const checks = state.checks;
  assert.deepEqual(await claim(), { accountId: "owner", show: false });
  assert.equal(state.checks, checks, "returning subscribers do not trigger another call to Stripe");
});

test("the trial and secondary establishment receive their existing welcome", async () => {
  for (const direct of [false, true]) {
    const { state, claim } = fixture();
    state.direct = direct; state.account = direct ? "secondary" : "owner";
    assert.deepEqual(await claim(), { accountId: state.account, show: true });
    assert.equal(state.checks, 0);
  }
});

test("paid dashboard reuses the booking dialogs, then continues after dismissal or an explicitly confirmed slot", async () => {
  const browser = await chromium.launch();
  try {
    for (const book of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const calls: string[] = [];
      await page.route("**/*", async request => {
        const path = new URL(request.request().url()).pathname;
        if (path === "/dashboard") return request.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><p>Dashboard</p>' });
        if (path === "/logo-inrcy.png") return request.fulfill({ status: 204 });
        calls.push(path);
        if (path.endsWith("/availability")) return request.fulfill({ json: { ok: true, days: [
          { label: "Lundi 23 novembre", slots: [{ start: "2026-11-23T09:00:00Z", label: "10:00" }] },
        ] } });
        assert.equal(path, "/api/public/visio-booking/book");
        assert.deepEqual(request.request().postDataJSON(), { token: "synthetic-private", start: "2026-11-23T09:00:00Z" });
        return request.fulfill({ json: { ok: true, booking: { dateLabel: "Lundi 23 novembre", timeLabel: "10:00" } } });
      });
      await page.goto("https://app.example.invalid/dashboard");
      await page.addStyleTag({ content: read("ops/wordpress-visio-booking/inrcy-visio-booking.css") });
      await page.addScriptTag({ content: read("ops/wordpress-visio-booking/inrcy-visio-booking.js") });
      await page.evaluate(() => {
        const host = document.createElement("inrcy-paid-booking") as HTMLElement & { open: (token: string, finish: () => void) => void };
        document.body.append(host);
        host.open("synthetic-private", () => { host.remove(); document.title = "Welcome"; });
      });
      await page.getByText("VOTRE ABONNEMENT EST ACTIF").waitFor();
      assert.equal(await page.getByText(/essai/i).count(), 0);
      assert.equal(await page.getByRole("dialog").count(), 1);
      assert.deepEqual(calls, []);
      if (book) {
        await page.getByRole("button", { name: "Réserver ma mise en route offerte" }).click();
        await page.getByRole("button", { name: "10:00" }).click();
        assert.equal(calls.length, 1);
        await page.getByRole("button", { name: "Confirmer ce rendez-vous" }).click();
        await page.getByRole("heading", { name: "C’est réservé !" }).waitFor();
        await page.getByRole("button", { name: "Terminer" }).click();
      } else await page.getByRole("button", { name: "Continuer dans l’application" }).click();
      assert.equal(await page.title(), "Welcome");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(await page.locator("#inrcy-visio-reopen").count(), 0);
      assert.equal(await page.evaluate(() => sessionStorage.length + localStorage.length), 0);
      assert.equal(calls.length, book ? 2 : 0);
      await page.close();
    }
  } finally { await browser.close(); }
});
