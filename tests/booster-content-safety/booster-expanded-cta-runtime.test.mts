import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { AI_CTA_CHANNELS, normalizeAiChannelCtaMap, resolveAiChannelCtaMap } from "../../lib/aiChannelCtaPreferences.ts";
import { BOOSTER_LINK_CTA_ACTIONS } from "../../lib/boosterCtaActions.ts";
import type * as Preferences from "../../lib/boosterCtaPreferences.ts";
import type * as Cta from "../../lib/boosterCta.ts";
import type * as Google from "../../lib/googleBusiness.ts";

const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);
function runtime() {
  const requests: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const cache = new Map<string, { exports: unknown }>();
  function load<T>(relative: string): T {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file)!.exports as T;
    const moduleRecord = { exports: {} }; cache.set(file, moduleRecord);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = (name: string): unknown => {
      if (name === "@/lib/googleStats" || name === "@/lib/googleBusinessLocations") return {};
      if (name.startsWith("@/") || name.startsWith(".")) {
        const target = name.startsWith("@/") ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(file), name);
        const resolved = [target, `${target}.ts`, `${target}.tsx`].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
        assert.ok(resolved, name); return load(resolved);
      }
      return nativeRequire(name);
    };
    const fetch = async (_url: unknown, options: RequestInit) => {
      requests.push({ method: options.method || "GET", payload: JSON.parse(String(options.body)) });
      return new Response(JSON.stringify({ name: "accounts/123/locations/456/localPosts/789" }), { status: 200 });
    };
    new Function("require", "module", "exports", "fetch", code)(require, moduleRecord, moduleRecord.exports, fetch);
    return moduleRecord.exports as T;
  }
  return { requests, preferences: load<typeof Preferences>("lib/boosterCtaPreferences.ts"), cta: load<typeof Cta>("lib/boosterCta.ts"), google: load<typeof Google>("lib/googleBusiness.ts") };
}

test("every CTA channel accepts the four added link intents and keeps the selected destination through serialization", () => {
  const h = runtime();
  for (const { key } of AI_CTA_CHANNELS) {
    for (const [choice, action] of Object.entries(BOOSTER_LINK_CTA_ACTIONS)) {
      const saved = normalizeAiChannelCtaMap({ [key]: { choice, mode: "website", label: "", url: `https://business.example/${choice}`, phone: "" } });
      assert.equal(saved[key]?.choice, choice, `${key}/${choice}`);
      const post = h.preferences.applySafePreferredCta({ channel: key, post: { title: "Notre service", content: "Découvrez notre activité." }, defaults: { preferredWebsiteUrl: "https://other.example/", preferredWebsiteLabel: "", siteWebUrl: "", phone: "0612345678", preferredCta: "site", channelCtas: saved }, preserveExplicit: false });
      const reloaded = JSON.parse(JSON.stringify(post));
      const normalized = h.cta.normalizeBoosterPostCtaForChannel(key, reloaded);
      assert.equal(normalized.ctaAction, action);assert.equal(normalized.ctaUrl, `https://business.example/${choice}`);
      assert.ok(h.preferences.getSupportedPreferredCtasForChannel(key).includes(choice as Preferences.BoosterPreferredCta));
      if (key === "gmb") assert.deepEqual(h.cta.getBoosterGmbCallToAction(normalized), { actionType: action, url: normalized.ctaUrl });
      else assert.ok(h.cta.buildBoosterMessage(key, normalized).includes(String(normalized.ctaUrl)), `${key} must retain its actual link in the published copy`);
    }
  }
});

test("Google create and edit requests send the explicit native CTA action to the provider", async () => {
  const h = runtime();
  for (const [choice, actionType] of Object.entries(BOOSTER_LINK_CTA_ACTIONS)) {
    const callToAction = h.cta.getBoosterGmbCallToAction({ ctaMode: "website", cta: choice, ctaUrl: `https://business.example/${choice}`, ctaAction: actionType });
    await h.google.gmbCreateLocalPost({ accessToken: "fixture-token", accountName: "accounts/123", locationName: "locations/456", summary: "Texte factuel.", callToAction });
    await h.google.gmbPatchLocalPost({ accessToken: "fixture-token", localPostName: "accounts/123/locations/456/localPosts/789", summary: "Texte modifié.", callToAction });
    for (const request of h.requests.slice(-2)) assert.deepEqual(request.payload.callToAction, { actionType, url: `https://business.example/${choice}` });
  }
  assert.deepEqual(h.requests.map(request => request.method), ["POST", "PATCH", "POST", "PATCH", "POST", "PATCH", "POST", "PATCH"]);
});

test("a booking/order action never borrows the profile homepage or survives a different explicit CTA selection", () => {
  const h = runtime();
  const defaults = { preferredWebsiteUrl: "https://business.example/", preferredWebsiteLabel: "", siteWebUrl: "", phone: "0612345678", preferredCta: "site" as const };
  const invalid = { title: "Un service", content: "Notre activité.", ctaMode: "website", cta: "Réserver", ctaAction: "BOOK", ctaUrl: "" };
  assert.equal(h.cta.getBoosterGmbCallToAction(invalid, { websiteUrl: defaults.preferredWebsiteUrl, phone: defaults.phone }), null);
  assert.equal(h.preferences.buildSafePreferredCtaPatch({ channel: "gmb", choice: "reserver", post: { ...invalid, ctaAction: "", ctaUrl: "" }, defaults }).ctaMode, "none");
  const changed = h.preferences.buildSafePreferredCtaPatch({ channel: "gmb", choice: "site", post: { ...invalid, ctaUrl: "https://business.example/book" }, defaults });
  assert.equal(changed.ctaAction, "");
  assert.deepEqual(h.cta.getBoosterGmbCallToAction(changed), { actionType: "LEARN_MORE", url: "https://business.example/" });
  const unfinished = resolveAiChannelCtaMap({ gmb: { choice: "reserver", mode: "website", url: "" } }, defaults);
  assert.equal(unfinished.gmb?.choice, "none", "An unfinished explicit action cannot be silently replaced by a default");
});
