import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as websiteCompatibility from "../../lib/siteWebChannel.ts";

const source = readFileSync(new URL("../../app/dashboard/mails/_lib/mailboxPhase1.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
const loaded = { exports: {} as Record<string, (...args: any[]) => any> };
const dependencies: Record<string, unknown> = {
  "@/lib/siteWebChannel": websiteCompatibility,
  react: {},
  "../mails.module.css": { default: new Proxy({}, { get: (_target, key) => key }) },
  "@/lib/mailDeliveryErrors": { getUserFacingMailError: () => "" },
  "@/lib/publicationErrorFrench": { getFrenchPublicationErrorMessage: (_channel: string, message: string, fallback: string) => message || fallback },
  "@/lib/boosterVideoSettings": { isBoosterVideoChannelKey: () => false, getDefaultChannelVideoSettings: () => ({}), normalizeChannelVideoSettings: () => ({}) },
  "@/lib/boosterImageDecision": { getBoosterImageSafetyBackgroundMode: () => "color" },
};
vm.runInNewContext(compiled, {
  module: loaded, exports: loaded.exports,
  require: (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  },
});
const mailbox = loaded.exports;

test("historical website failures remain visible after the channel name changes", () => {
  const payload = { channels: ["inrcy_site"], results: { inrcy_site: { ok: false, error: "failed" } } };
  const statuses = mailbox.getPublicationChannelStatuses(payload);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].key, "site_web");
  assert.equal(statuses[0].failed, true);
  assert.equal(statuses[0].result.error, "failed");
});

test("a current website result wins over a legacy result independently of insertion order", () => {
  const payload = { channels: ["inrcy_site", "site_web"], results: { inrcy_site: { ok: false }, site_web: { ok: true } } };
  const statuses = mailbox.getPublicationChannelStatuses(payload);
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].failed, false);
  assert.equal(statuses[0].result.ok, true);
});

test("historical website content is retained when no current website post exists", () => {
  const payload = { channels: ["inrcy_site"], postByChannel: { inrcy_site: { title: "Historical title", content: "Historical text" } } };
  const posts = mailbox.extractChannelPublications(payload);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].key, "site_web");
  assert.equal(posts[0].parts.title, "Historical title");
  assert.equal(posts[0].parts.content, "Historical text");
});

test("the current website content wins when the legacy post was inserted first", () => {
  const payload = { channels: ["inrcy_site", "site_web"], postByChannel: { inrcy_site: { title: "Old title", content: "Old text" }, site_web: { title: "Current title", content: "Current text" } } };
  const posts = mailbox.extractChannelPublications(payload);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].parts.title, "Current title");
  assert.equal(posts[0].parts.content, "Current text");
});
