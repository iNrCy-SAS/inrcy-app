import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const route = read("app/api/booster/publish-now/route.ts");
const foundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const serverPreparation = read(
  "app/api/booster/publish-now/publishNow.server-preparation.ts",
);
const channelContext = read(
  "app/api/booster/publish-now/publishNow.channel-context.ts",
);
const asyncPublication = read("lib/boosterAsyncPublication.ts");
const statusRoute = read(
  "app/api/booster/publications/[publicationId]/status/route.ts",
);
const recoveryCron = read("app/api/cron/booster-publications/route.ts");

const branchDefinitions = [
  {
    name: "inr_search",
    start: 'if (ch === "inr_search")',
    end: 'if (ch === "site_web")',
    required: [
      "ensureSystemManagedInrSearch",
      "getInrSearchPublicStatus",
      "buildInrSearchPublicUrl",
      "setDelivery",
    ],
  },
  {
    name: "sites",
    start: 'if (ch === "site_web")',
    end: 'if (ch === "facebook")',
    required: [
      "const targetUrl = siteWebUrl",
      "pickCompleteChannelImageUrls",
      '.from("site_articles")',
      "setDelivery",
    ],
  },
  {
    name: "facebook",
    start: 'if (ch === "facebook")',
    end: 'if (ch === "instagram")',
    required: [
      "facebookPublishVideoToPage",
      "facebookPublishToPage",
      "pickCompleteChannelImageUrls",
      "setDelivery",
    ],
  },
  {
    name: "instagram",
    start: 'if (ch === "instagram")',
    end: 'if (ch === "linkedin")',
    required: [
      "instagramCreateVideoCheckpointWithTokenFallback",
      "instagramPollVideoCheckpointWithTokenFallback",
      "instagramPublishVideoCheckpointWithTokenFallback",
      "instagramPublishImagesBestEffortWithTokenFallback",
      "buildInstagramPublishTokenCandidates",
      "setDelivery",
    ],
  },
  {
    name: "linkedin",
    start: 'if (ch === "linkedin")',
    end: 'if (ch === "youtube_shorts")',
    required: [
      "linkedinPublishVideo",
      "linkedinPublishMultiImage",
      "linkedinPublishImage",
      "linkedinPublishText",
      "linkedinResharePost",
      "setDelivery",
    ],
  },
  {
    name: "youtube_shorts",
    start: 'if (ch === "youtube_shorts")',
    end: 'if (ch === "tiktok")',
    required: [
      "isYoutubeShortsIntegrationActive",
      "getYoutubeShortsAccessToken",
      "uploadYoutubeShort",
      "setDelivery",
    ],
  },
  {
    name: "tiktok",
    start: 'if (ch === "tiktok")',
    end: 'if (ch === "pinterest")',
    required: [
      "isTiktokIntegrationActive",
      "getTiktokAccessToken",
      "tiktokDirectPostVideoFileUpload",
      "tiktokDirectPostPhotos",
      "loadFirstAvailableTikTokVideo",
      "setDelivery",
    ],
  },
  {
    name: "pinterest",
    start: 'if (ch === "pinterest")',
    end: 'if (ch === "gmb")',
    required: [
      "getPinterestAccessToken",
      "createPinterestVideoPin",
      "createPinterestImagePin",
      "setDelivery",
    ],
  },
  {
    name: "gmb",
    start: 'if (ch === "gmb")',
    end: "const unsupportedChannelMessage =",
    required: [
      "getGmbToken",
      "gmbCreateLocalPost",
      "rebuildGoogleBusinessImages",
      "gmb_media_preflight_failed",
      "publishGoogleBusiness",
      "setDelivery",
    ],
  },
] as const;

const networkPublisherMarkers = [
  "facebookPublishVideoToPage",
  "facebookPublishToPage",
  "instagramCreateVideoCheckpointWithTokenFallback",
  "instagramPollVideoCheckpointWithTokenFallback",
  "instagramPublishVideoCheckpointWithTokenFallback",
  "instagramPublishImagesBestEffortWithTokenFallback",
  "linkedinPublishVideo",
  "linkedinPublishMultiImage",
  "linkedinPublishImage",
  "linkedinPublishText",
  "linkedinResharePost",
  "uploadYoutubeShort",
  "tiktokDirectPostVideoFileUpload",
  "tiktokDirectPostPhotos",
  "createPinterestVideoPin",
  "createPinterestImagePin",
  "gmbCreateLocalPost",
];

// Inspect direct dispatch branches rather than the first textual channel
// condition: a channel-specific eligibility guard is not a publisher branch.
const ast = ts.createSourceFile("route.ts", route, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const dispatchLoops: ts.ForOfStatement[] = [];
function visit(node: ts.Node) {
  if (ts.isForOfStatement(node) && node.expression.getText(ast) === "selected"
    && ts.isVariableDeclarationList(node.initializer) && node.initializer.declarations.length === 1
    && node.initializer.declarations[0].name.getText(ast) === "ch") dispatchLoops.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(dispatchLoops.length, 1, "The per-destination dispatch loop must remain unambiguous");
const loopBody = dispatchLoops[0].statement;
assert.ok(ts.isBlock(loopBody));
function channelOf(node: ts.IfStatement): string | null {
  const condition = node.expression;
  return ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && ts.isIdentifier(condition.left) && condition.left.text === "ch" && ts.isStringLiteral(condition.right)
    ? condition.right.text : null;
}
function dispatchBranch(node: ts.Statement): node is ts.IfStatement {
  return ts.isIfStatement(node) && channelOf(node) !== null && ts.isBlock(node.thenStatement)
    && ts.isContinueStatement(node.thenStatement.statements.at(-1)!);
}
const dispatchTries = loopBody.statements.filter(ts.isTryStatement).filter(node => node.tryBlock.statements.some(statement => dispatchBranch(statement) && channelOf(statement) === "inr_search"));
assert.equal(dispatchTries.length, 1, "The publication try block must remain unambiguous");
const dispatchTry = dispatchTries[0];
const dispatchBranches = dispatchTry.tryBlock.statements.filter(dispatchBranch);
const branchChannel = (name: string) => name === "sites" ? "site_web" : name;
function dispatchBody(name: string) {
  const branches = dispatchBranches.filter(node => channelOf(node) === branchChannel(name));
  assert.equal(branches.length, 1, `missing or duplicate publication branch: ${name}`);
  return branches[0].getText(ast);
}

test("the final publish-now route keeps one ordered explicit branch per supported destination", () => {
  let previousIndex = -1;
  for (const branch of branchDefinitions) {
    const index = dispatchBranches.findIndex(node => channelOf(node) === branchChannel(branch.name));
    assert.ok(index > previousIndex, `branch out of order or missing: ${branch.name}`);
    assert.equal(dispatchBranches.filter(node => channelOf(node) === branchChannel(branch.name)).length, 1);
    previousIndex = index;
  }
});

test("every channel branch retains its required prechecks, publisher and durable delivery update", () => {
  for (const branch of branchDefinitions) {
    const body = dispatchBody(branch.name);
    for (const marker of branch.required) {
      assert.ok(body.includes(marker), `${branch.name} lost required marker: ${marker}`);
    }
    assert.match(body, /results\[ch\]/, `${branch.name} must persist an in-memory result`);
    assert.match(body, /continue;/, `${branch.name} must terminate its own dispatch branch`);
  }
});

test("network publishers remain isolated inside their own channel branches", () => {
  const ownership: Record<string, string[]> = {
    facebook: ["facebookPublishVideoToPage", "facebookPublishToPage"],
    instagram: [
      "instagramCreateVideoCheckpointWithTokenFallback",
      "instagramPollVideoCheckpointWithTokenFallback",
      "instagramPublishVideoCheckpointWithTokenFallback",
      "instagramPublishImagesBestEffortWithTokenFallback",
    ],
    linkedin: [
      "linkedinPublishVideo",
      "linkedinPublishMultiImage",
      "linkedinPublishImage",
      "linkedinPublishText",
      "linkedinResharePost",
    ],
    youtube_shorts: ["uploadYoutubeShort"],
    tiktok: ["tiktokDirectPostVideoFileUpload", "tiktokDirectPostPhotos"],
    pinterest: ["createPinterestVideoPin", "createPinterestImagePin"],
    gmb: ["gmbCreateLocalPost"],
  };

  for (const branch of dispatchBranches) {
    const channel = channelOf(branch)!;
    const body = branch.getText(ast);
    const allowed = new Set(ownership[channel] || []);
    for (const publisher of networkPublisherMarkers) {
      if (allowed.has(publisher)) continue;
      assert.doesNotMatch(
        body,
        new RegExp(`\\b${publisher}\\b`),
        `${channel} unexpectedly invokes ${publisher}`,
      );
    }
  }
  const outsideDispatch = dispatchTry.tryBlock.statements.filter(statement => !dispatchBranches.includes(statement as ts.IfStatement)).map(statement => statement.getText(ast)).join("\n") + (dispatchTry.catchClause?.getText(ast) || "");
  for (const publisher of networkPublisherMarkers) assert.doesNotMatch(outsideDispatch, new RegExp(`\\b${publisher}\\b`), `${publisher} escaped its explicit publication branch`);
});

test("the per-channel catch and unsupported fallback always produce terminal durable state", () => {
  const dispatchLoop = sliceBetween(
    route,
    "for (const ch of selected)",
    "if (internalAsyncDispatch)",
  );
  assert.match(dispatchLoop, /code:\s*"unsupported_channel"/);
  assert.match(dispatchLoop, /retryable:\s*false/);
  assert.match(dispatchLoop, /catch \(e: unknown\)/);
  assert.match(dispatchLoop, /await setDelivery\(ch, \{ status: "failed", error: msg \}\)/);
  assert.match(dispatchLoop, /raw_error:/);
});

test("the extracted modules remain bounded by their intended responsibilities", () => {
  for (const source of [foundations, channelContext]) {
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /\bsupabaseAdmin\b/);
    assert.doesNotMatch(source, /\bNextResponse\b/);
    assert.doesNotMatch(source, /\bafter\s*\(/);
  }
  assert.doesNotMatch(serverPreparation, /["\']use client["\']/);
  assert.match(serverPreparation, /from "@\/lib\/supabaseAdmin"/);
  assert.doesNotMatch(serverPreparation, /facebookPublishToPage/);
  assert.doesNotMatch(serverPreparation, /instagramPublishPhotoWithTokenFallback/);
  assert.doesNotMatch(serverPreparation, /instagramPublishImagesBestEffortWithTokenFallback/);
  assert.doesNotMatch(serverPreparation, /linkedinPublishText/);
  assert.doesNotMatch(serverPreparation, /tiktokDirectPostPhotos/);
  assert.doesNotMatch(serverPreparation, /uploadYoutubeShort/);
  assert.doesNotMatch(serverPreparation, /createPinterestImagePin/);
  assert.doesNotMatch(serverPreparation, /gmbCreateLocalPost/);
});

test("async status, recovery and aggregate finalization stay connected to publish-now", () => {
  assert.match(route, /updateAsyncChannelEvent\(/);
  assert.match(route, /finalizeAsyncPublicationIfReady\(/);
  assert.match(asyncPublication, /export async function finalizeAsyncPublicationIfReady/);
  assert.match(asyncPublication, /export async function readAsyncPublicationStatus/);
  assert.match(statusRoute, /readAsyncPublicationStatus\(/);
  assert.match(recoveryCron, /BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS/);
  assert.match(recoveryCron, /MAX_ASYNC_DISPATCH_ATTEMPTS/);
  assert.match(recoveryCron, /async_dispatch_exhausted/);
  assert.match(recoveryCron, /\/api\/booster\/publish-now/);
  assert.match(recoveryCron, /buildInternalCronHeaders\(/);
});

test("the dispatch loop preserves semantic channel isolation and safe provider fallback", () => {
  const dispatchLoop = sliceBetween(
    route,
    "for (const ch of selected)",
    "if (internalAsyncDispatch)",
  );
  assert.match(dispatchLoop, /const preflightFailure = preflightFailuresByChannel\[ch\]/);
  assert.match(dispatchLoop, /if \(preflightFailure\)/);
  assert.match(dispatchLoop, /continue/);
  assert.match(dispatchLoop, /ch === "site_web"/);
  assert.match(dispatchLoop, /if \(ch === "tiktok"\)/);
  assert.match(route, /resp\.safeTextFallback === true/);
  assert.doesNotMatch(route, /preparePublicationVariants\(true\)/);
});
