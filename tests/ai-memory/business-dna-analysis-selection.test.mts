import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { parseBusinessDnaAnalysisSelection } from "../../lib/businessDnaAnalysisSelection.ts";
import * as safe from "../../lib/tsSafe.ts";
import * as windows from "../../lib/businessDnaRecentNews.ts";
import { withoutThreadsData } from "../../lib/stats/metaPilotData.ts";
import * as identity from "../../lib/professionalBusinessIdentity.ts";
import * as analysisErrors from "../../lib/businessDnaChannelAnalysisErrors.ts";
import * as websiteBudget from "../../lib/businessDnaWebsiteBudget.ts";

test("une absence de sélection garde l’analyse complète ; une liste vide demande les documents seuls", () => {
  assert.equal(parseBusinessDnaAnalysisSelection({}), undefined);
  assert.deepEqual(parseBusinessDnaAnalysisSelection({ selectedChannels: [] }), []);
  assert.deepEqual(parseBusinessDnaAnalysisSelection({ selectedChannels: ["site_web", "gmb", "youtube_shorts", "gmb"] }), ["website", "google_business", "youtube"]);
  for (const value of [null, [], { selectedChannels: null }, { selectedChannels: ["__proto__"] }, { selectedChannels: ["other-account"] }, { selectedChannels: Array(11).fill("gmb") }]) {
    assert.throws(() => parseBusinessDnaAnalysisSelection(value));
  }
});

function collectorHarness() {
  const code = readFileSync(new URL("../../lib/businessDnaChannelAnalysis.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${code}\nexport { discoverUsefulWebsiteLinks };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const nodeRequire = createRequire(import.meta.url);
  const calls: string[] = [];
  const states = Object.fromEntries(["site_web","gmb","facebook","instagram","threads","linkedin","x","tiktok","youtube_shorts","pinterest","inr_search"].map(key => [key, { connected: true, accountConnected: true, url: "https://example.test" }]));
  const known: Record<string, unknown> = {
    "@/lib/tsSafe": safe,
    "@/lib/professionalBusinessIdentity": identity,
    "@/lib/businessDnaChannelAnalysisErrors": analysisErrors,
    "@/lib/businessDnaWebsiteBudget": websiteBudget,
    "@/lib/businessDnaRecentNews": windows,
    "@/lib/stats/metaPilotData": { withoutThreadsData },
    "@/lib/channelConnectionState": { getChannelConnectionStates: async () => states },
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForAccount: async () => false },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => {
      assert.equal(table, "integrations");
      return { select: () => ({ eq: async (field: string, account: string) => { assert.equal(field,"user_id"); assert.equal(account,"account-test"); return { data: [], error: null }; } }) };
    } } },
  };
  const imported = new Set([...code.matchAll(/from "([^"]+)"/g)].map(match => match[1]));
  const loaded = { exports: {} as typeof import("../../lib/businessDnaChannelAnalysis.ts") & { discoverUsefulWebsiteLinks: (html: string, pageUrl: URL) => string[] } };
  new Function("module","exports","require",compiled)(loaded,loaded.exports,(name: string) => {
    if (name === "server-only") return {};
    if (name.startsWith("node:")) return nodeRequire(name);
    if (Object.hasOwn(known,name)) return known[name];
    assert(imported.has(name), "Unknown dependency " + name);
    return new Proxy({}, { get: (_target, key) => key === "__esModule" ? true : () => { calls.push(name + ":" + String(key)); throw new Error("A deselected provider was called"); } });
  });
  return { collect: loaded.exports.collectBusinessDnaChannelSources, discoverWebsiteLinks: loaded.exports.discoverUsefulWebsiteLinks, calls };
}

test("les mentions légales du site sont lues pour trouver les coordonnées explicites", () => {
  const h = collectorHarness();
  assert.deepEqual(h.discoverWebsiteLinks('<a href="/mentions-legales">Mentions</a><a href="/legal-notice">Legal</a><a href="/impressum">Impressum</a><a href="https://other.example/mentions-legales">Externe</a>', new URL("https://pro.example/")), [
    "https://pro.example/impressum", "https://pro.example/legal-notice", "https://pro.example/mentions-legales",
  ]);
});

test("des canaux exclus ne déclenchent aucune lecture fournisseur, même s’ils sont connectés", async () => {
  const h = collectorHarness();
  const result = await h.collect({ supabase: {}, userId:"account-test", businessProfile:{}, proToolsConfig:{}, selectedSourceKeys:[] });
  assert.deepEqual(result, []);
  assert.deepEqual(h.calls, []);
});

test("le collecteur conserve uniquement la source choisie avant tout appel externe", async () => {
  const h = collectorHarness();
  const result = await h.collect({ supabase:{}, userId:"account-test", businessProfile:{ business_description:"Entreprise locale" }, proToolsConfig:{}, companyName:"Entreprise locale", selectedSourceKeys:["inr_search"] });
  assert.deepEqual(result.map(item => item.key), ["inr_search"]);
  assert.equal(result[0].status,"analyzed");
  assert.deepEqual(h.calls, []);
});
