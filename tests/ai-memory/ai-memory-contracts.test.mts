import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("the additive migration keeps profile automation and scopes memory per account", () => {
  const migration = read("ops/sql/2026-09-04_ai_memory_and_channel_lengths.sql");

  assert.match(migration, /add column if not exists ai_web_length text/);
  assert.match(migration, /add column if not exists ai_social_length text/);
  assert.match(migration, /create table if not exists public\.business_ai_memories/);
  assert.match(migration, /account_id uuid primary key references public\.inrcy_accounts\(id\) on delete cascade/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /inrcy_can_access_account\(account_id\)/);
  assert.match(migration, /AI_MEMORY_POSTFLIGHT_FAILED: RLS inactive/);
  assert.match(migration, /case lower\(btrim\(coalesce\(ai_web_length, ''\)\)\)/);
  assert.match(migration, /case lower\(btrim\(coalesce\(ai_social_length, ''\)\)\)/);
  assert.doesNotMatch(migration, /drop\s+(?:table|column)\s/i);
});

test("Premium memory is gated on the server and hidden from Standard prompts", () => {
  const route = read("app/api/ai-memory/route.ts");
  const context = read("lib/boosterGenerationContext.ts");
  const profile = read("lib/aiGenerationProfile.ts");
  const memoryUi = read("app/dashboard/settings/_components/AiMemoryContent.tsx");
  const configurationUi = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");

  assert.match(route, /hasPremiumDashboardAccess\(edition\)/);
  assert.match(route, /mergeAiMemoryPremiumFields\(memory, currentMemoryResult\.data\?\.memory\)/);
  assert.match(context, /includePremium: hasPremiumDashboardAccess\(edition\)/);
  assert.match(profile, /includePremium: lengthEdition === "premium"/);
  assert.match(memoryUi, /edition = "standard"/);
  assert.equal((memoryUi.match(/disabled=\{!premiumEnabled\}/g) || []).length, 3);
  assert.doesNotMatch(memoryUi, /customInstructions/);
  assert.match(configurationUi, /edition = "standard"/);
  assert.match(configurationUi, /ai_custom_instructions: form\.forbiddenStyle\.trim\(\)/);
  assert.match(configurationUi, /function ContentLengthSelect/);
  assert.match(configurationUi, /const locked = premiumOption && !premiumAccess/);
  assert.match(configurationUi, /contentLengthPremiumPillStyle/);
});

test("profile, Business DNA and AI settings are three real full-page tools", () => {
  const menu = read("app/dashboard/_components/UserMenu.tsx");
  const drawer = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  const routing = read("app/dashboard/_hooks/useDashboardPanelRouting.ts");
  const dnaPage = read("app/dashboard/adn-entreprise/page.tsx");
  const profilePage = read("app/dashboard/mon-profil/page.tsx");
  const configurationPage = read("app/dashboard/configuration-ia/page.tsx");
  const profile = read("app/dashboard/settings/_components/ProfileAndActivityContent.tsx");
  const configuration = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");

  assert.match(menu, /closeAndOpen\("ai_memory"\)/);
  assert.doesNotMatch(drawer, /panel === "ai_memory"/);
  assert.match(routing, /name === "ai_memory" \|\| name === "ia"/);
  assert.match(routing, /"\/dashboard\/adn-entreprise"/);
  assert.match(routing, /"\/dashboard\/configuration-ia"/);
  assert.match(dnaPage, /data-business-dna-page/);
  assert.match(dnaPage, /<AiMemoryContent/);
  assert.match(dnaPage, /business-dna\.svg/);
  assert.match(profilePage, /data-profile-workspace-page/);
  assert.match(profilePage, /profile-workspace\.svg/);
  assert.match(configurationPage, /data-ai-configuration-page/);
  assert.match(configurationPage, /<AiConfigurationIcon/);
  assert.doesNotMatch(configurationPage, /ai-configuration\.svg/);
  assert.match(configurationPage, /<AiConfigurationContent/);
  assert.match(profile, /onOpenAiMemory/);
  assert.match(configuration, /tabParameters/);
  assert.match(configuration, /tabInstructions/);
  assert.doesNotMatch(read("app/dashboard/settings/_components/AiMemoryContent.tsx"), /<AiConfigurationContent/);
  assert.doesNotMatch(drawer, /panel === "ia"/);
});

test("the two length controls cover the requested channel families", () => {
  const configuration = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");
  const rules = read("lib/boosterChannelRules.ts");

  assert.match(configuration, /value=\{form\.webLength\}/);
  assert.match(configuration, /value=\{form\.socialLength\}/);
  assert.match(configuration, /CONTENT_LENGTH_VALUES/);
  assert.match(configuration, /aria-disabled=\{locked \|\| undefined\}/);
  assert.match(rules, /channel === "inrcy_site" \|\| channel === "site_web" \|\| channel === "inr_search"/);
  assert.match(rules, /isBoosterWebChannel\(channel\)[\s\S]*\? preferences\.webLength[\s\S]*: preferences\.socialLength/);
});

test("all three dedicated tools protect unsaved work independently", () => {
  const dnaPage = read("app/dashboard/adn-entreprise/page.tsx");
  const profilePage = read("app/dashboard/mon-profil/page.tsx");
  const configurationPage = read("app/dashboard/configuration-ia/page.tsx");
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  for (const page of [dnaPage, profilePage, configurationPage]) {
    assert.match(page, /useUnsavedExitGuard/);
    assert.match(page, /shouldBlock: hasUnsavedChanges/);
    assert.match(page, /requestNavigation/);
    assert.match(page, /onUnsavedChange=\{setHasUnsavedChanges\}/);
  }
  assert.doesNotMatch(dashboard, /variant=\{panel === "ai_memory"/);
});

test("channel analysis is private, bounded, cumulative and monthly limited", () => {
  const route = read("app/api/ai-memory/analyze-channels/route.ts");
  const collector = read("lib/businessDnaChannelAnalysis.ts");
  const budget = read("lib/businessDnaSourceBudget.ts");
  const policy = read("lib/aiGatewayPolicy.ts");
  const migration = read("ops/sql/2026-09-04_ai_memory_and_channel_lengths.sql");
  const ui = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

  assert.match(route, /collectBusinessDnaChannelSources/);
  assert.match(route, /consumeBusinessDnaAnalysisQuota/);
  assert.match(route, /refundBusinessDnaAnalysisQuota/);
  assert.match(route, /maxOutputTokens: 7_600/);
  assert.match(route, /JSON\.stringify\(ANALYSIS_RESPONSE_SCHEMA\.schema\)\.length \+ 900/);
  assert.match(route, /const sourceAndContextBudget = 68_000 - promptOnlySchemaReserve - 1_000/);
  assert.match(route, /premiumEnabled \? "renseigne les trois blocs stratégiques Premium/);
  assert.match(collector, /getPublicBusinessDnaSourceResults/);
  assert.match(collector, /const \{ content: _content, \.\.\.visible \} = source/);
  assert.doesNotMatch(collector, /reviewerName:/);
  assert.match(budget, /JSON\.stringify\(payload\)\.length/);
  assert.match(budget, /fairEncodedShare/);
  assert.match(policy, /"business-dna\.analyze"[\s\S]*maxOutputTokens: 8_000/);
  assert.match(migration, /\('standard', 4\)/);
  assert.match(migration, /\('premium', 16\)/);
  assert.match(migration, /for update/);
  assert.match(
    migration,
    /on conflict on constraint business_dna_analysis_monthly_usage_pkey do nothing/,
  );
  assert.doesNotMatch(migration, /on conflict \(account_id, period_start\) do nothing/);
  assert.match(ui, /mergeAiBusinessDnaAnalysis/);
  assert.match(ui, /analysisQuota\?\.remaining === 0/);
});

test("Business DNA rich text uses a safe visual toolbar instead of exposing markdown code", () => {
  const editor = read("app/dashboard/settings/_components/BusinessDnaRichTextEditor.tsx");
  const sanitizer = read("lib/businessDnaRichText.ts");

  assert.match(editor, /document\.execCommand/);
  assert.match(editor, /formatBold/);
  assert.match(editor, /formatList/);
  assert.match(editor, /label\?: string/);
  assert.match(editor, /\{label \? <span style=\{editorLabelStyle\}>\{label\}<\/span> : null\}/);
  assert.match(sanitizer, /ALLOWED_TAGS/);
  assert.match(sanitizer, /script\|style\|iframe\|object\|embed\|svg\|math/);
});

test("Business DNA keeps the compact profile foundation and inline service action", () => {
  const memoryUi = read("app/dashboard/settings/_components/AiMemoryContent.tsx");
  const editableTags = read("app/dashboard/settings/_components/EditableTags.tsx");

  assert.match(memoryUi, /foundationCardStyle/);
  assert.match(memoryUi, /foundationCompactHintStyle/);
  assert.match(memoryUi, /t\("foundationTitle"\)/);
  assert.match(memoryUi, /t\("baseServicesLabel"\)[\s\S]*?<EditableTags[\s\S]*?values=\{businessKnowledge\.services\}[\s\S]*?inlineAdd/);
  assert.doesNotMatch(memoryUi, /function FoundationValue/);
  assert.match(editableTags, /inlineAdd\?: boolean/);
  assert.match(editableTags, /\{inlineAdd && !adding/);
  assert.match(editableTags, /!inlineAdd && values\.length < maxItems/);
});

test("identity, values and brand vocabulary stay together in Business DNA", () => {
  const memoryUi = read("app/dashboard/settings/_components/AiMemoryContent.tsx");
  const configurationUi = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");
  const memory = read("lib/aiMemory.ts");

  assert.match(memoryUi, /type WorkspaceTab = "analysis" \| "activity" \| "audience" \| "local" \| "identity" \| "strategy"/);
  assert.match(memoryUi, /t\("tabIdentity"\)/);
  assert.doesNotMatch(memoryUi, /activeTab === "voice"/);
  assert.doesNotMatch(memoryUi, /configurationLink/);
  assert.match(memoryUi, /memoryTags\([\s\S]*?"preferredVocabulary"/);
  assert.match(memoryUi, /memoryTags\([\s\S]*?"forbiddenVocabulary"/);
  assert.match(memoryUi, /setField\("mission"/);
  assert.match(memoryUi, /"brandPersonality"/);
  assert.match(memoryUi, /"commitments"/);
  assert.doesNotMatch(configurationUi, /preferredVocabulary/);
  assert.doesNotMatch(configurationUi, /forbiddenVocabulary/);
  assert.match(memory, /mission_raison_d_etre/);
  assert.match(memory, /personnalite_de_marque/);
  assert.match(memory, /vocabulaire_a_privilegier/);
});

test("every shared writing generator loads the complete professional DNA context", () => {
  const context = read("lib/boosterGenerationContext.ts");
  const reviewReply = read("app/api/e-reputation/google/generate-reply/route.ts");
  const mailWriter = read("app/api/mails/generate-ai/route.ts");
  const templateWriter = read("lib/templateAiGeneration.ts");
  const boosterRoute = read("app/api/booster/generate/route.ts");

  assert.match(context, /from\("business_ai_memories"\)/);
  assert.match(context, /ai_memory: memory/);
  assert.match(context, /includePremium: hasPremiumDashboardAccess\(edition\)/);
  for (const generator of [reviewReply, mailWriter, templateWriter]) {
    assert.match(generator, /getAiProfessionalGenerationContext/);
    assert.match(generator, /buildAiWritingProfilePromptSection\(generationProfile\)/);
  }
  assert.match(boosterRoute, /getBoosterGenerationContext/);
});

test("the analysis separates the persistent DNA score from live loading progress", () => {
  const memoryUi = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

  assert.match(memoryUi, /data-dna-score-summary/);
  assert.match(memoryUi, /t\("scoreLabel"\)/);
  assert.match(memoryUi, /data-tooltip=\{t\("scoreHelp"\)\}/);
  assert.match(memoryUi, /\{analyzing \? \([\s\S]*?analysisProgress/);
  assert.doesNotMatch(memoryUi, /ADN · \{completionScore\}%/);
});

test("a failed memory load can be retried but can never overwrite data with the empty form", () => {
  const memoryUi = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

  assert.match(memoryUi, /const \[loaded, setLoaded\] = useState\(false\)/);
  assert.match(memoryUi, /loading \? \([\s\S]*: !loaded \? \(/);
  assert.match(memoryUi, /!loading && loaded &&/);
  assert.match(memoryUi, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
});
