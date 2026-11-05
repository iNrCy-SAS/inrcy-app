import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

test("Basic personal credentials OAuth grants and paid transactions stay in their native personal handoffs", () => {
  const load = runtimeModules({ "./requireUser": { requireUser: async () => { assert.fail("A handoff capability review cannot authenticate or mutate"); } } });
  const runtime = load<typeof import("../../lib/inrAssistantAccountServiceTools.ts")>("lib/inrAssistantAccountServiceTools.ts");
  const tools = runtime.createInrAssistantAccountServiceTools({ request: new Request("https://example.invalid/api/assistant/chat"), accountId: "owned", actorUserId: "actor", currentUserMessage: "Lis mes services", supabase: { from() { assert.fail("The inventory cannot read or mutate a real account"); } } });
  for (const name of Object.keys(tools)) assert.doesNotMatch(name, /password|checkout|cancelSubscription|purchase|oauth|deleteAccount/i);
  const account = readFileSync(new URL("../../app/dashboard/settings/_components/AccountContent.tsx", import.meta.url), "utf8");
  assert.match(account, /currentPassword/); assert.match(account, /type="password"/); assert.match(account, /fetch\("\/api\/auth\/change-password"/);
  const oauth = readFileSync(new URL("../../app/dashboard/_components/GoogleOAuthConsentBanner.tsx", import.meta.url), "utf8");
  assert.match(oauth, /window\.location\.href = retryHref/); assert.match(oauth, /access_denied/);
  const subscription = readFileSync(new URL("../../app/dashboard/settings/_components/StandardSubscriptionContent.tsx", import.meta.url), "utf8");
  assert.match(subscription, /startSubscriptionCheckout/); assert.match(subscription, /openNativeSubscriptionManagement/);
});

test("Basic local files and microphone permissions keep their native personal selection without an assistant filesystem payload", () => {
  const dna = readFileSync(new URL("../../app/dashboard/settings/_components/AiMemoryContent.tsx", import.meta.url), "utf8"), profile = readFileSync(new URL("../../app/dashboard/settings/_components/ProfilContent.tsx", import.meta.url), "utf8");
  for (const source of [dna, profile]) { assert.match(source, /type="file"/); assert.match(source, /(?:event|e)\.target\.files|currentTarget\.files/); }
  const voice = readFileSync(new URL("../../app/dashboard/_components/MediaSubjectVoiceButton.tsx", import.meta.url), "utf8");
  assert.match(voice, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  const tools = readFileSync(new URL("../../lib/inrAssistantBusinessIdentityTools.ts", import.meta.url), "utf8");
  assert.match(tools, /logoPath déjà importé du compte/); assert.match(tools, /verifiedLogo\.ok/); assert.doesNotMatch(tools, /readFileSync|fs\.readFile|navigator\.mediaDevices/);
});
