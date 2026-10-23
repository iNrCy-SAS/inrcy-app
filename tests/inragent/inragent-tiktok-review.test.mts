import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runtimeModules } from "./runtime-module-loader.mts";
import {
  createInrAgentTiktokValidationSession,
  resolveReusableInrAgentTiktokSettings,
} from "../../lib/inrAgentTiktokValidationSession.ts";

const client = readFileSync(new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("AgentClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the actual small UI functions without mounting the page, accessing an
// account or invoking a publication/generation endpoint.
function uiFunction(name: string, context: Record<string, unknown> = {}) {
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(declaration, `Missing UI function ${name}`);
  const javascript = ts.transpileModule(`${declaration.getText(source)}\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return Function(...Object.keys(context), javascript)(...Object.values(context));
}

const signatureFor = uiFunction("agentTiktokReviewSignature");
const candidateFor = uiFunction("agentTiktokReviewCandidate");
const action = {
  id: "publication-one", updatedAt: "2030-10-20T12:00:00Z", title: "Publication",
  summary: "Sujet", previewText: "Texte", imageAssets: [{ id: "image-original", url: "https://media.test/original.jpg" }],
  payload: { postByChannel: { tiktok: { content: "Texte TikTok" } },
    imagesByChannel: { tiktok: [{ id: "image-tiktok", url: "https://media.test/tiktok.jpg" }] } },
};
const creatorInfo = { accountKey: "creator-one", username: "@inrcy", displayName: "iNrCy",
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE"], commentDisabled: false,
  duetDisabled: false, stitchDisabled: false, maxVideoDurationSeconds: 180 };
const settings = { privacyLevel: "PUBLIC_TO_EVERYONE", allowComments: false, allowDuo: false, allowStitch: false,
  commercialContent: "none" as const, aiContent: true, photoAutoMusic: false, musicUsageConfirmed: true };

test("la revue est liée à l’action, au contenu, aux médias et aux canaux consultables", () => {
  const signature = signatureFor(action, ["tiktok", "facebook"]);
  assert.equal(signatureFor(structuredClone(action), ["facebook", "tiktok"]), signature);
  for (const change of [
    { id: "publication-two" }, { updatedAt: "2030-10-20T12:01:00Z" }, { previewText: "Modifié" },
    { payload: { ...action.payload, postByChannel: { tiktok: { content: "Nouveau texte" } } } },
    { payload: { ...action.payload, imagesByChannel: { tiktok: [{ id: "new", url: "https://media.test/new.jpg" }] } } },
    { imageAssets: [{ id: "new", url: "https://media.test/new.jpg" }] },
  ]) assert.notEqual(signatureFor({ ...action, ...change }, ["tiktok", "facebook"]), signature);
  assert.notEqual(signatureFor(action, ["tiktok"]), signature);
  assert.equal(signatureFor(null, []), null);
});

test("une revue locale fonctionne sans session globale et une modification exige une nouvelle revue", () => {
  const signature = signatureFor(action, ["tiktok"]);
  const session = createInrAgentTiktokValidationSession({ settings, creatorInfo, now: 1_000 });
  const review = { signature, session };
  assert.equal(candidateFor({ signature, review, session: null }), session);
  assert.equal(candidateFor({ signature: "changed", review, session }), null,
    "Session reuse must never mask a changed publication");
  assert.equal(candidateFor({ signature: "another-publication", session }), session,
    "Explicit optional session reuse remains available for the next publication");
});

test("la revue locale conserve le contrôle du compte, des capacités, du consentement et de l’expiration", () => {
  const signature = signatureFor(action, ["tiktok"]);
  const session = createInrAgentTiktokValidationSession({ settings, creatorInfo, now: 1_000 });
  const candidate = candidateFor({ signature, review: { signature, session }, session: null });
  const args = { session: candidate, creatorInfo, mediaType: "images" as const, now: 2_000 };
  assert.ok(resolveReusableInrAgentTiktokSettings(args));
  assert.equal(resolveReusableInrAgentTiktokSettings({ ...args, creatorInfo: { ...creatorInfo, accountKey: "other-account" } }), null);
  assert.equal(resolveReusableInrAgentTiktokSettings({ ...args, creatorInfo: { ...creatorInfo, commentDisabled: true } }), null);
  assert.equal(resolveReusableInrAgentTiktokSettings({ ...args, now: session.expiresAt }), null);
  assert.equal(resolveReusableInrAgentTiktokSettings({ ...args, session: { ...session, settings: { ...settings, musicUsageConfirmed: false } } }), null);
});

test("la case ouvre uniquement les réglages pour une revue, sans intention de diffusion", () => {
  const requests: unknown[] = [];
  uiFunction("reviewAgentTiktokSettings", { openAgentTiktokSettings: (value: unknown) => requests.push(value) })();
  assert.deepEqual(requests, [{ kind: "review" }]);
  assert.match(client, /<TiktokReviewCheckbox[\s\S]*?checked=\{tiktokReviewCurrent\}[\s\S]*?onReview=\{reviewAgentTiktokSettings\}/);
  assert.match(client, /<TiktokPublicationSettingsModal[\s\S]*?showPreview=\{false\}[\s\S]*?allowSessionReuse/);
  assert.doesNotMatch(client, /className=\{styles\.tiktokSessionBanner\}/);
});

test("valider les réglages depuis la case mémorise la revue sans publier ni programmer", async () => {
  const signature = signatureFor(action, ["tiktok"]);
  let reviews: Record<string, unknown> = {};
  let globalSession: unknown = "unchanged";
  const forbidExecution = () => assert.fail("A review checkbox must never publish, schedule or change channel selection");
  const validate = uiFunction("validateAgentTiktokSettings", {
    pendingTiktokValidation: { kind: "review", actionId: action.id, reviewSignature: signature },
    selectedPreparedAction: action, tiktokCurrentReviewSignature: signature,
    createInrAgentTiktokValidationSession,
    setTiktokPublicationReviews: (update: (current: typeof reviews) => typeof reviews) => { reviews = update(reviews); },
    setTiktokValidationSession: (value: unknown) => { globalSession = value; },
    setTiktokSettingsOpen: () => {}, setPendingTiktokValidation: () => {},
    savePublicationChannelSelection: forbidExecution, updateActionStatus: forbidExecution,
    confirmRobotPlannedPublication: forbidExecution, scheduleValidatedPublication: forbidExecution,
    executeImmediateAgentPublicationAfterSchedule: forbidExecution,
  });
  await validate(settings, { rememberForSession: false, creatorInfo });
  assert.equal(globalSession, null);
  assert.equal((reviews[action.id] as { signature: string }).signature, signature);
});

test("la réutilisation locale vérifie à nouveau le créateur avant de renvoyer les réglages", async () => {
  const signature = signatureFor(action, ["tiktok"]);
  const session = createInrAgentTiktokValidationSession({ settings, creatorInfo });
  let reads = 0;
  let invalidations = 0;
  const context = {
    selectedPreparedAction: action, tiktokCurrentReviewSignature: signature,
    tiktokCurrentReview: { signature, session }, tiktokValidationSession: null,
    agentTiktokReviewCandidate: candidateFor, tiktokSessionCheckInFlightRef: { current: false },
    tiktokReviewSignatureRef: { current: signature }, tiktokPublishMediaType: "images",
    tiktokPublishVideoDurationSeconds: null, resolveReusableInrAgentTiktokSettings,
    readCurrentTiktokCreatorInfo: async () => { reads += 1; return creatorInfo; },
    setTiktokSessionCheckState: () => {}, setTiktokPublicationReviews: () => {},
    setTiktokValidationSession: () => { invalidations += 1; },
  };
  assert.ok(await uiFunction("resolveAgentTiktokSessionSettings", context)());
  assert.equal(reads, 1);
  assert.equal(invalidations, 0);

  const switchedAccount = { ...context,
    readCurrentTiktokCreatorInfo: async () => ({ ...creatorInfo, accountKey: "different" }) };
  assert.equal(await uiFunction("resolveAgentTiktokSessionSettings", switchedAccount)(), null);
  assert.equal(invalidations, 1);
});

test("une modification pendant la vérification du compte rend le résultat inutilisable", async () => {
  const signature = signatureFor(action, ["tiktok"]);
  const session = createInrAgentTiktokValidationSession({ settings, creatorInfo });
  const signatureRef = { current: signature };
  const resolve = uiFunction("resolveAgentTiktokSessionSettings", {
    selectedPreparedAction: action, tiktokCurrentReviewSignature: signature,
    tiktokCurrentReview: { signature, session }, tiktokValidationSession: null,
    agentTiktokReviewCandidate: candidateFor, tiktokSessionCheckInFlightRef: { current: false },
    tiktokReviewSignatureRef: signatureRef, setTiktokSessionCheckState: () => {},
    readCurrentTiktokCreatorInfo: async () => { signatureRef.current = "modified-during-check"; return creatorInfo; },
  });
  assert.equal(await resolve(), null);
});

test("une revue ouverte sur une ancienne version ne peut pas valider un contenu modifié", async () => {
  let notices = 0;
  const validate = uiFunction("validateAgentTiktokSettings", {
    pendingTiktokValidation: { kind: "review", actionId: action.id, reviewSignature: "old-version" },
    selectedPreparedAction: action, tiktokCurrentReviewSignature: "new-version",
    setTiktokSettingsOpen: () => {}, setPendingTiktokValidation: () => {},
    showNotice: () => { notices += 1; }, i18nT: (key: string) => key,
    setTiktokPublicationReviews: () => assert.fail("An outdated review cannot be retained"),
  });
  await validate(settings, { rememberForSession: true, creatorInfo });
  assert.equal(notices, 1);
});

test("le bouton de validation d’une programmation détachée impose aussi une revue TikTok", async () => {
  const requests: unknown[] = [];
  let creatorChecks = 0;
  const validate = uiFunction("saveScheduledEditAtExistingDate", {
    scheduledEditSession: { action: { automationKey: "publish", actionType: "publication", targetTool: "booster" },
      scheduledAction: { scheduledAt: "2030-10-20T12:00:00Z" } },
    validationScheduleState: "idle", selectedPublicationUsesTiktok: true,
    tiktokSessionCheckInFlightRef: { current: false },
    resolveAgentTiktokSessionSettings: async () => { creatorChecks += 1; return null; },
    openAgentTiktokSettings: (request: unknown) => requests.push(request),
    setValidationScheduleState: () => assert.fail("Must obtain the TikTok review before saving"),
  });
  await validate();
  assert.equal(creatorChecks, 1);
  assert.deepEqual(requests, [{ kind: "save_existing_edit" }]);
});

test("l’édition programmée conserve les réglages TikTok réellement revus dans son payload", async () => {
  const load = runtimeModules();
  const { scheduledEditUpdateFromAction } = load<typeof import("../../app/dashboard/agent/_lib/agent.schedule.ts")>("app/dashboard/agent/_lib/agent.schedule.ts");
  const scheduledAction = { id: "scheduled-one" };
  const sourceAction = { ...action, automationKey: "publish", actionType: "publication", targetTool: "booster",
    targetChannels: ["tiktok"], payload: { ...action.payload, selectedChannels: ["tiktok"] } };
  const before = structuredClone(sourceAction);
  const writes: Array<Record<string, unknown>> = [];
  const save = uiFunction("saveScheduledEditPublication", {
    scheduledEditSession: { action: sourceAction, scheduledAction }, scheduledEditUpdateFromAction,
    asRecord: (value: unknown) => value && typeof value === "object" ? value : null,
    patchScheduledAction: async (_id: string, body: Record<string, unknown>) => { writes.push(body); return scheduledAction; },
    applySavedScheduledEdit: () => {}, refreshScheduledActions: async () => {},
  });
  await save([{ channel: "tiktok", scheduledAt: "2030-10-20T12:00:00Z" }], settings);
  assert.equal(writes.length, 1);
  const payload = writes[0].payload as { tiktokPublicationSettings: unknown; publishPayload: { tiktokPublicationSettings: unknown } };
  assert.deepEqual(payload.tiktokPublicationSettings, settings);
  assert.deepEqual(payload.publishPayload.tiktokPublicationSettings, settings);
  assert.deepEqual(sourceAction, before);
});
