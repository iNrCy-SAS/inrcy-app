import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeAiMediaGeneratorPreferences } from "../../lib/aiMediaGenerationPreferences.ts";
import { inrAgentEditorialRetryDecision } from "../../lib/inrAgentEditorialRetryPolicy.ts";

type RecordValue = Record<string, unknown>;
type Media = { id: string; mediaType: "image"; kind: "image"; source: string; librarySource: string; storagePath: string };

const filename = "app/api/agent/actions/prepare-publish/route.ts";
const route = ts.createSourceFile(filename, readFileSync(new URL(`../../${filename}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const post = route.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "POST");
assert.ok(post && ts.isFunctionDeclaration(post) && post.body);
const quotaStart = post.body.statements.findIndex((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(route) === "quotaReservation"));
assert.notEqual(quotaStart, -1);
// Execute the production orchestration from credit reservation to its final
// return/finally. Authentication/context helpers have already resolved above
// this boundary; only network/provider/DB dependencies are replaced below.
const body = post.body.statements.slice(quotaStart).map((node) => node.getText(route)).join("\n");
const compiled = ts.transpileModule(`async function run(){${body}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(options: { refusedCredits?: boolean; failedSnapshot?: boolean; failedPart?: number; mediaFailureOutcome?: string; failedText?: boolean; failedPersistence?: boolean; existingAssets?: Media[] } = {}) {
  const events: string[] = [];
  const generated = new Map<string, { item: Media; request: string }>();
  const mediaCalls: RecordValue[] = [];
  const textCalls: RecordValue[] = [];
  const credits = { reserved: 0, committed: 0, rolledBack: 0 };
  let failedPart = false;
  let metadata: RecordValue = { editorialPlan: true };
  let storedAction: RecordValue | null = null;
  let fallbackAssets = options.existingAssets || [];
  let fallbackIndex = 0;
  const proMedia = (id: string): Media => ({ id, mediaType: "image", kind: "image", source: "ai_media_generation", librarySource: "pro_media_library", storagePath: `account/${id}.jpg` });
  const supabase = {
    from(table: string) {
      let patch: RecordValue = {};
      const filters = new Map<string, unknown>();
      const query = {
        update(value: RecordValue) { patch = value; return this; },
        insert(value: RecordValue) { patch = value; return this; },
        select() { return this; },
        eq(key: string, value: unknown) { filters.set(key, value); return this; },
        async maybeSingle() {
          if (table === "inr_agent_actions") {
            assert.equal(filters.get("user_id"), "account"); assert.equal(filters.get("id"), "slot-1");
            assert.equal(filters.get("status"), "executing");
            events.push("snapshot");
            if (options.failedSnapshot) return { error: { message: "snapshot_failed" }, data: null };
            metadata = structuredClone(patch.metadata as RecordValue);
            return { error: null, data: { id: "slot-1" } };
          }
          return { data: { usage_count: 0 }, error: null };
        },
        async single() {
          events.push("persist");
          if (options.failedPersistence) return { data: null, error: { message: "persist_failed" } };
          assert.equal(filters.get("user_id"), "account");
          storedAction = structuredClone({ id: "slot-1", ...patch });
          return { data: storedAction, error: null };
        },
        then(resolve: (value: { data: null; error: null }) => unknown) { return Promise.resolve(resolve({ data: null, error: null })); },
      };
      return query;
    },
  };
  const defaultPreferences = normalizeAiMediaGeneratorPreferences({});
  async function run(overrides: RecordValue = {}) {
    fallbackIndex = 0;
    const scope: Record<string, unknown> = {
      createHash, randomUUID, normalizeAiMediaGeneratorPreferences,
      supabase, supabaseAdmin: supabase, userId: "account", quotaAccountId: "account", actorUserId: "actor",
      isAdmin: false, isCron: true, automaticMediaKind: "image", requestedImageCount: 3, videoDurationSeconds: undefined,
      automation: { useImageBank: fallbackAssets.length > 0, preferredMediaSource: fallbackAssets.length ? "media_library" : "ai_generation", studioMediaPreferencePercent: 100, planningHorizonDays: 15, validationMode: "manual", frequency: "weekly", imageRequired: true },
      editorialTarget: { id: "slot-1", metadata: structuredClone(metadata), plan: { criteriaSignature: "criteria-1", scheduledFor: "2026-10-05T10:00:00Z", sequence: 1, channels: ["facebook"], theme: "realisations" } },
      studioMediaPreferences: defaultPreferences, idea: "Cuisine : présenter le plan puis les finitions", agentTheme: "realisations", boosterTheme: "realisation",
      runtimeFocus: { focusKey: "focus-1" }, business: {}, profile: {}, businessProfession: {}, recentPublications: [], earlierEditorialAngles: [], ctaDefaults: {}, agentTone: "professional",
      prefersExistingVideo: false, instantMediaMix: null, youtubeDisabledForImage: false, channels: ["facebook"], autoDisabledChannels: [],
      routeStartedAt: Date.now(), mediaSelectionMs: 0, imagePreparationMs: 0, videoPreparationMs: 0, aiGenerationMs: 0, persistenceMs: 0, generationContextMs: 0,
      professionalContextSource: "database", publicationsContextSource: "database", IMAGE_BANK_DIVERSIFICATION_RATE: 0,
      NextResponse: { json: (value: unknown, init?: { status?: number }) => ({ status: init?.status || 200, body: value }) },
      console: { info() {}, warn() {} },
      asRecord: (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value : {},
      computeBoosterAiCredits: (value: { mediaType: string; imagesForAI: unknown[] }) => value.mediaType === "video" ? 3 : value.imagesForAI.length ? 2 : 1,
      reserveInrAgentEditorialCredits: async ({ credits: amount, idempotencyKey }: { credits: number; idempotencyKey: string }) => {
        events.push("reserve-credits"); assert.equal(amount, 2); assert.equal(idempotencyKey, "slot-1");
        if (options.refusedCredits) return { errorResponse: { status: 429 }, reservation: null };
        credits.reserved++; return { reservation: { state: "reserved" }, errorResponse: null };
      },
      commitAiCredits: async (reservation: { state: string } | null) => { if (reservation?.state === "reserved") { credits.committed++; reservation.state = "committed"; events.push("commit"); } },
      rollbackAiCredits: async (reservation: { state: string } | null) => { if (reservation?.state === "reserved") { credits.rolledBack++; reservation.state = "rolled_back"; events.push("rollback"); } },
      loadRecentMediaUsage: async () => ({ proMediaIds: new Set(), imageBankIds: new Set(), storageKeys: new Set() }),
      buildMediaDiversificationTrace: () => ({}),
      pickDiversifiedMedia: async () => ({ media: fallbackAssets[fallbackIndex++] || null, diversificationTrace: {}, proCandidate: null, imageBankCandidate: null }),
      getMediaSourceKey: (source: string, path: string) => `${source}:${path}`,
      generateInrAgentMedia: async (args: RecordValue) => {
        assert.ok(metadata.editorialMediaGeneration, "snapshot must persist before any media generation");
        assert.equal(events.at(0), "reserve-credits");
        mediaCalls.push(structuredClone({ ...args, supabase: undefined }));
        const key = String(args.generationRequestId);
        const request = JSON.stringify([args.idea, args.theme, args.variantSeed, args.studioPreferences, args.videoDurationSeconds]);
        const cached = generated.get(key);
        if (cached) { assert.equal(request, cached.request, "retry must preserve each part's inputs"); events.push("media-replayed"); return { item: cached.item, outcome: "generated", kind: "image" }; }
        if (!failedPart && options.failedPart !== undefined && key.endsWith(`:part:${options.failedPart}`)) { failedPart = true; events.push("media-failed"); return { item: null, outcome: options.mediaFailureOutcome || "generation_failed", kind: "image" }; }
        const item = proMedia(`image-${generated.size + 1}`); generated.set(key, { item, request }); events.push("media-generated");
        return { item, outcome: "generated", kind: "image" };
      },
      generatedPickerItemToAgentMedia: ({ item }: { item: Media }) => item,
      getRecentMediaTrace: () => ({}), isRecentlyUsedMediaRow: () => false, isValidJobForSector: () => true,
      shouldUseFastAgentMediaContext: () => true,
      prepareAgentSelectedImageForAI: async (asset: Media) => { events.push(`vision:${asset.id}`); return [{ id: asset.id }]; },
      buildAgentSelectedMediaContext: () => ({}), channelMediaReadiness: () => ({}), channelMediaAdaptation: () => ({}),
      videoAiContextReferenceAliases: () => ({}),
      generateBoosterPosts: async (args: RecordValue) => {
        events.push("text"); textCalls.push(args);
        if (options.failedText) throw new Error("text_failed");
        return { versions: { facebook: { title: "Notre cuisine", content: "Découvrez les détails de notre cuisine.", cta: "Contactez-nous", hashtags: [] } }, recoveredChannels: [] };
      },
      applySafePreferredCta: ({ post }: { post: unknown }) => post,
      boosterToAgentChannel: { facebook: "facebook" }, inrAgentChannelToBoosterPublishChannel: (channel: string) => channel,
      buildPreviewText: () => "Aperçu", themeLabels: { realisations: "Réalisations" }, buildSummary: () => "Trois images",
      requiresManualValidation: () => true, getExecutionPolicy: () => "manual", getInitialStatus: () => "pending_validation",
      rowToInrAgentAction: (value: unknown) => value,
      ...overrides,
    };
    return new Function(...Object.keys(scope), `${compiled}\nreturn run();`)(...Object.values(scope)) as Promise<{ status: number; body: RecordValue }>;
  }
  return { run, events, credits, generated, mediaCalls, textCalls, proMedia, setFallback: (assets: Media[]) => { fallbackAssets = assets; }, get metadata() { return metadata; }, get storedAction() { return storedAction; } };
}

test("le flux réel réserve les crédits avant les médias et analyse/persiste les trois images", async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(h.generated.size, 3);
  assert.deepEqual(h.events.slice(0, 2), ["reserve-credits", "snapshot"]);
  assert.equal(h.textCalls[0].skipMediaVisionAnalysis, false);
  assert.equal((h.textCalls[0].imagesForAI as unknown[]).length, 3);
  assert.equal((h.storedAction?.image_assets as unknown[]).length, 3);
  assert.equal(((h.storedAction?.payload as RecordValue).mediaAssets as unknown[]).length, 3);
  assert.equal(h.credits.committed, 1); assert.equal(h.credits.rolledBack, 0);
  assert.ok(h.events.indexOf("commit") > h.events.indexOf("persist"));
});

test("un carrousel partiel restitue les crédits texte puis réutilise les parties réussies", async () => {
  const h = harness({ failedPart: 1 });
  assert.equal((await h.run()).status, 503);
  assert.equal(h.generated.size, 2); assert.equal(h.textCalls.length, 0); assert.equal(h.storedAction, null);
  assert.equal(h.credits.rolledBack, 1); assert.equal(h.credits.committed, 0);
  const changedPreferences = normalizeAiMediaGeneratorPreferences({ blocks: { 2: { format: "square" } } });
  assert.equal((await h.run({ idea: "Le profil a changé depuis la première tentative", studioMediaPreferences: changedPreferences, runtimeFocus: { focusKey: "focus-changed" }, agentTheme: "conseils" })).status, 200);
  assert.equal(h.generated.size, 3); assert.equal(h.events.filter((event) => event === "media-replayed").length, 2);
  assert.equal(h.credits.committed, 1); assert.equal(h.credits.rolledBack, 1);
  assert.equal(h.mediaCalls[0].idea, h.mediaCalls[3].idea);
  assert.deepEqual(h.mediaCalls[0].studioPreferences, h.mediaCalls[3].studioPreferences);
  assert.equal(h.mediaCalls[0].theme, h.mediaCalls[3].theme);
});

test("un refus de crédits ou un snapshot non enregistré ne génère aucun média", async () => {
  const refused = harness({ refusedCredits: true });
  assert.equal((await refused.run()).status, 429);
  assert.deepEqual(refused.events, ["reserve-credits"]); assert.equal(refused.generated.size, 0);
  const snapshot = harness({ failedSnapshot: true });
  await assert.rejects(snapshot.run(), /editorial_media_snapshot_unavailable/);
  assert.equal(snapshot.generated.size, 0); assert.equal(snapshot.credits.rolledBack, 1);
});

test("une erreur texte ou de persistance restitue la réservation exactement une fois", async () => {
  const text = harness({ failedText: true });
  await assert.rejects(text.run(), /text_failed/);
  assert.equal(text.generated.size, 3); assert.equal(text.credits.rolledBack, 1); assert.equal(text.credits.committed, 0);
  const persist = harness({ failedPersistence: true });
  assert.equal((await persist.run()).status, 500);
  assert.equal(persist.credits.rolledBack, 1); assert.equal(persist.credits.committed, 0);
});

test("la reprise conserve les sources bibliothèque initiales même si de nouveaux médias apparaissent", async () => {
  const asset: Media = { id: "owned-initial", mediaType: "image", kind: "image", source: "pro_media_library", librarySource: "pro_media_library", storagePath: "account/owned.jpg" };
  const h = harness({ failedPart: 1, existingAssets: [asset] });
  assert.equal((await h.run()).status, 503);
  h.setFallback([h.proMedia("new-library-1"), h.proMedia("new-library-2")]);
  assert.equal((await h.run()).status, 200);
  assert.equal((h.storedAction?.image_assets as Media[])[0].id, "owned-initial");
  assert.deepEqual(h.mediaCalls.map((call) => String(call.generationRequestId).split(":part:")[1]), ["1", "2", "1", "2"]);
  assert.equal(h.mediaCalls[1].variantSeed, h.mediaCalls[3].variantSeed);
});

test("un quota média épuisé après une première image reste une attente quota pour le cron", async () => {
  const h = harness({ failedPart: 1, mediaFailureOutcome: "quota_reached" });
  const response = await h.run();
  assert.equal(response.status, 429);
  const retry = inrAgentEditorialRetryDecision({ error: response.body.error, attempts: 1, nowMs: 0 });
  assert.equal(retry.quotaLimited, true);
  assert.equal(retry.retryAt, new Date(6 * 60 * 60 * 1000).toISOString());
  assert.equal(h.credits.rolledBack, 1); assert.equal(h.textCalls.length, 0);
});

function retryCoordinatorHarness(options: { readFailure?: boolean; concurrentCompletion?: boolean } = {}) {
  const serverFile = "lib/inrAgentEditorialPlanServer.ts";
  const ast = ts.createSourceFile(serverFile, readFileSync(new URL(`../../${serverFile}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "prepareNextInrAgentEditorialSlot");
  assert.ok(declaration);
  const code = ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const snapshot = { signature: "snapshot-1", idea: "Cuisine", existingAssets: [], theme: "realisations" };
  let row: RecordValue = { id: "slot-1", status: "draft", payload: {}, metadata: { editorialPlan: true, editorialState: "queued" } };
  const patches: RecordValue[] = [];
  const supabase = {
    from(table: string) {
      assert.equal(table, "inr_agent_actions");
      let patch: RecordValue | null = null;
      const filters = new Map<string, unknown>();
      const validateScope = () => { assert.equal(filters.get("id"), "slot-1"); assert.equal(filters.get("user_id"), "account"); };
      const apply = () => {
        validateScope();
        if (patch && row.status === filters.get("status")) { patches.push(structuredClone(patch)); row = { ...row, ...structuredClone(patch) }; }
      };
      return {
        select() { return this; }, eq(key: string, value: unknown) { filters.set(key, value); return this; }, order() { return this; },
        async limit() { assert.equal(filters.get("user_id"), "account"); return { data: [structuredClone(row)], error: null }; },
        update(value: RecordValue) { patch = value; return this; },
        async maybeSingle() {
          validateScope();
          if (patch) { assert.equal(filters.get("status"), "draft"); apply(); return { data: { id: "slot-1" }, error: null }; }
          if (options.readFailure) return { data: null, error: new Error("metadata_read_failed") };
          return { data: structuredClone(row), error: null };
        },
        then(resolve: (value: { error: null }) => unknown) { assert.equal(filters.get("status"), "executing"); apply(); return Promise.resolve(resolve({ error: null })); },
      };
    },
  };
  const scope = {
    EDITORIAL_ACTION_SELECT: "id,status,metadata,payload", inrAgentEditorialRetryDecision,
    asRecord: (value: unknown) => value && typeof value === "object" ? value : {},
    cleanText: (value: unknown, length: number) => String(value || "").trim().slice(0, length),
    errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    buildInternalCronHeaders: () => ({}), rowEditorialPlan: () => ({}),
    fetch: async () => {
      row.metadata = { ...(row.metadata as RecordValue), editorialMediaGeneration: snapshot };
      if (options.concurrentCompletion) row.status = "pending_validation";
      return { ok: false, status: 503, text: async () => JSON.stringify({ error: "Préparation temporairement indisponible" }) };
    },
  };
  const execute = new Function(...Object.keys(scope), `${code}\nreturn prepareNextInrAgentEditorialSlot;`)(...Object.values(scope));
  return { run: () => execute({ supabase, userId: "account", origin: "https://app.example", now: new Date("2026-09-30T12:00:00Z") }), patches, snapshot, get row() { return row; } };
}

test("le coordinateur de reprise conserve le snapshot écrit après la prise du créneau", async () => {
  const h = retryCoordinatorHarness();
  assert.equal((await h.run()).status, "retry");
  assert.equal(h.row.status, "draft");
  assert.deepEqual((h.row.metadata as RecordValue).editorialMediaGeneration, h.snapshot);
  assert.equal((h.row.metadata as RecordValue).editorialState, "retry");
  assert.equal(h.patches.length, 2);
});

test("le coordinateur n'écrase ni un snapshot illisible ni une action terminée concurremment", async () => {
  const unreadable = retryCoordinatorHarness({ readFailure: true });
  await assert.rejects(unreadable.run(), /metadata_read_failed/);
  assert.equal(unreadable.patches.length, 1);
  assert.deepEqual((unreadable.row.metadata as RecordValue).editorialMediaGeneration, unreadable.snapshot);
  const completed = retryCoordinatorHarness({ concurrentCompletion: true });
  assert.equal((await completed.run()).status, "contended");
  assert.equal(completed.patches.length, 1); assert.equal(completed.row.status, "pending_validation");
});
