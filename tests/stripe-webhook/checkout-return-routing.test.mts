import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as routing from "../../lib/checkoutReturnRouting.ts";
import * as offers from "../../lib/subscriptionOffers.ts";

type Row = Record<string, unknown>;
type Element = { type: unknown; props: Row };
const jsx = (type: unknown, props: Row) => ({ type, props });
const intl = { getTranslations: async () => (key: string) => key, getLocale: async () => "fr-FR" };

function load<T>(path: string, modules: Record<string, unknown>, browser?: Row): T {
  const output = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const runtime = { exports: {} as T };
  new Function("module", "exports", "require", "window", output)(runtime, runtime.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`);
    return modules[name];
  }, browser);
  return runtime.exports;
}

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  return [node, ...elements(node.props.children)];
}

test("blocked and dashboard redirects retain only checkout waiting context, never arbitrary destinations or access flags", () => {
  const query = routing.checkoutReturnQuery(new URLSearchParams("checkout=success&billing=yearly&checkout_plan=Premium&status=active&redirect=https://evil.invalid"));
  assert.equal(query, "checkout=success&billing=yearly&checkout_plan=Premium");
  assert.equal(routing.blockedCheckoutReturnUrl(query), `/compte-bloque?${query}`);
  assert.equal(routing.dashboardCheckoutReturnUrl(query), `/dashboard?panel=abonnement&${query}`);
  assert.equal(routing.checkoutReturnQuery(new URLSearchParams("checkout=cancel&billing=yearly")), "");
  assert.equal(routing.blockedCheckoutReturnUrl("checkout=success&checkout_plan=Founder&billing=evil"), "/compte-bloque?checkout=success");
});

function blockedPage(status: string) {
  const redirects: string[] = [];
  const component = Symbol("BlockedBillingActions");
  const chain = { select() { return chain; }, eq(key: string, value: string) {
    assert.deepEqual([key, value], ["user_id", "owner-1"]); return chain;
  }, maybeSingle: async () => ({ data: { status, plan: "Standard", app_edition: "standard", stripe_customer_id: "cus_fixture" } }) };
  const page = load<{ default(props: Row): Promise<unknown> }>("app/compte-bloque/page.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next-intl/server": intl,
    "next/image": { default: "img" },
    "next/navigation": { redirect: (url: string) => { redirects.push(url); throw new Error("redirect"); } },
    "./compte-bloque.module.css": { default: {} },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => chain } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) } }) },
    "@/lib/dashboardEdition": { resolveDashboardEdition: () => "standard" },
    "./BlockedBillingActions": { default: component },
    "@/lib/checkoutReturnRouting": routing,
  });
  return { redirects, component, render: () => page.default({ searchParams: Promise.resolve({ checkout: "success", checkout_plan: "Premium", billing: "yearly", status: "active" }) }) };
}

test("forged checkout success keeps an expired account blocked and only shows synchronization controls", async () => {
  const page = blockedPage("trial_expired");
  const rendered = await page.render();
  assert.deepEqual(page.redirects, []);
  const actions = elements(rendered).find((node) => node.type === page.component)!;
  assert.equal(actions.props.status, "trial_expired");
  assert.equal(actions.props.checkoutPending, true);
});

test("only server-confirmed active access returns to the dashboard with the target still awaiting precise synchronization", async () => {
  const page = blockedPage("active");
  await assert.rejects(page.render(), /redirect/);
  assert.deepEqual(page.redirects, ["/dashboard?panel=abonnement&checkout=success&billing=yearly&checkout_plan=Premium"]);
});

test("blocked checkout polling refreshes read-only server state, stops after 30 seconds and exposes no new purchase", () => {
  const effects: Array<() => (() => void) | undefined> = [];
  let tick: (() => void) | undefined;
  let cleared = false;
  let refreshes = 0;
  const router = { refresh: () => { refreshes += 1; } };
  const actions = load<{ default(props: Row): unknown }>("app/compte-bloque/BlockedBillingActions.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react": { useState: (value: unknown) => [value, () => {}], useEffect: (effect: () => (() => void) | undefined) => effects.push(effect) },
    "next-intl": { useTranslations: () => (key: string) => key, useLocale: () => "fr-FR" },
    "next/navigation": { useRouter: () => router },
    "@/lib/subscriptionOffers": offers,
    "@/lib/clientSubscriptionBilling": { startSubscriptionCheckout: () => { throw new Error("purchase is forbidden during return polling"); } },
    "./compte-bloque.module.css": { default: {} },
  }, { setInterval: (callback: () => void, delay: number) => { assert.equal(delay, 1500); tick = callback; return 1; }, clearInterval: () => { cleared = true; } });
  const rendered = actions.default({ status: "trial_expired", edition: "standard", hasStripeCustomer: true, contactHref: "mailto:contact@example.invalid", checkoutPending: true });
  const buttons = elements(rendered).filter((node) => node.type === "button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.children, "actualiser_9d3b2a7d");
  const cleanup = effects[0]();
  while (!cleared && refreshes < 21) tick!();
  assert.equal(refreshes, 20);
  assert.equal(cleared, true);
  cleanup?.();
});

function recoveryFixture(edition: "standard" | "premium" = "premium", status = "canceled") {
  const state: unknown[] = [];
  let cursor = 0;
  const purchases: Row[] = [];
  const translations: Record<string, string> = { standard_tax_exclusive_short: "HT", standard_tax_inclusive_short: "TTC", standard_per_month: "mois", standard_per_year: "an" };
  const actions = load<{ default(props: Row): unknown }>("app/compte-bloque/BlockedBillingActions.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react": { useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    }, useEffect() {} },
    "next-intl": { useTranslations: () => (key: string) => translations[key] ?? key, useLocale: () => "fr-FR" },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/lib/subscriptionOffers": offers,
    "@/lib/clientSubscriptionBilling": { startSubscriptionCheckout: async (args: Row) => { purchases.push(args); return { platform: "web" }; } },
    "./compte-bloque.module.css": { default: {} },
  });
  return { purchases, render: () => {
    cursor = 0;
    return actions.default({ status, edition, hasStripeCustomer: true, contactHref: "mailto:contact@example.invalid" });
  } };
}

function offerButtons(rendered: unknown, plan: "Standard" | "Premium") {
  const article = elements(rendered).find((node) => node.type === "article" && node.props["aria-label"] === `iNrCy ${plan}`)!;
  assert.ok(article, `${plan} recovery offer must be available`);
  return elements(article).filter((node) => node.type === "button");
}

function contentText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(contentText).join("");
  if (value && typeof value === "object" && "props" in value) return contentText((value as Element).props.children);
  return "";
}

test("expired Premium recovery displays both current HT offers with percentage savings and independent cadences", async () => {
  const ui = recoveryFixture("premium", "trial_expired");
  const text = contentText(ui.render());
  assert.match(text, /58 € HT \/ mois/);
  assert.match(text, /628 € HT \/ an/);
  assert.match(text, /108 € HT \/ mois/);
  assert.match(text, /1\s168 € HT \/ an/);
  assert.match(text, /≈ −10\s?%/);
  assert.doesNotMatch(text, /TTC/);
  (offerButtons(ui.render(), "Standard")[1].props.onClick as () => void)();
  assert.equal(offerButtons(ui.render(), "Standard")[1].props["aria-pressed"], true);
  assert.equal(offerButtons(ui.render(), "Premium")[0].props["aria-pressed"], true);
  await (offerButtons(ui.render(), "Premium")[2].props.onClick as () => Promise<void>)();
  assert.equal(ui.purchases[0].plan, "Premium");
  assert.equal(ui.purchases[0].billingCycle, "monthly");
});

test("each recovery offer sends its own plan and cadence for former Standard and Premium accounts", async () => {
  for (const edition of ["standard", "premium"] as const) {
    for (const plan of ["Standard", "Premium"] as const) {
      for (const cycle of ["monthly", "yearly"] as const) {
        const ui = recoveryFixture(edition);
        if (cycle === "yearly") (offerButtons(ui.render(), plan)[1].props.onClick as () => void)();
        await (offerButtons(ui.render(), plan)[2].props.onClick as () => Promise<void>)();
        assert.equal(ui.purchases.length, 1);
        assert.equal(ui.purchases[0].plan, plan);
        assert.equal(ui.purchases[0].billingCycle, cycle);
      }
    }
  }
});
