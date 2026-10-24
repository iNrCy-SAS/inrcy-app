import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  WORKSPACE_AI_PRIMARY_FAMILY_BUDGET_MS,
  WORKSPACE_AI_SECONDARY_FAMILY_BUDGET_MS,
  buildWorkspaceAiFamilyDiagnostic,
  getWorkspaceAiMediaType,
  resolveWorkspaceAiFamilyWithinBudget,
  workspaceAiFamilyBudget,
} from "../../lib/workspaceAiMixedConsumption.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("le contrat IA représente indépendamment cinq images et une vidéo", () => {
  assert.equal(getWorkspaceAiMediaType({ imageCount: 5, hasVideo: true }), "mixed");
  assert.equal(getWorkspaceAiMediaType({ imageCount: 5, hasVideo: false }), "images");
  assert.equal(getWorkspaceAiMediaType({ imageCount: 0, hasVideo: true }), "video");
  assert.equal(getWorkspaceAiMediaType({ imageCount: 0, hasVideo: false }), "none");

  assert.deepEqual(
    buildWorkspaceAiFamilyDiagnostic({
      requestedCount: 5,
      resolvedCount: 4,
      failures: [
        {
          code: "workspace_ai_image_upload_pending",
          message: "Une image est encore en préparation.",
          mediaId: "image-5",
        },
      ],
    }),
    {
      state: "partial",
      requestedCount: 5,
      resolvedCount: 4,
      code: "workspace_ai_image_upload_pending",
      message: "Une image est encore en préparation.",
      failures: [
        {
          code: "workspace_ai_image_upload_pending",
          message: "Une image est encore en préparation.",
          mediaId: "image-5",
        },
      ],
    },
  );
});

test("une famille secondaire hors budget ne supprime pas la famille prête", async () => {
  const [images, video] = await Promise.all([
    resolveWorkspaceAiFamilyWithinBudget({
      family: "images",
      task: Promise.resolve(["image-ready"]),
      budgetMs: 250,
    }),
    resolveWorkspaceAiFamilyWithinBudget({
      family: "video",
      task: new Promise<never>(() => undefined),
      budgetMs: 50,
    }),
  ]);

  assert.deepEqual(images, { ok: true, value: ["image-ready"] });
  assert.equal(video.ok, false);
  if (!video.ok) {
    assert.equal(video.failure.code, "workspace_ai_video_deadline_exceeded");
    assert.match(video.failure.message, /ignoré pour cette génération/);
  }
});

test("les budgets par famille préservent la fenêtre serveur 30/45 secondes", () => {
  assert.equal(WORKSPACE_AI_PRIMARY_FAMILY_BUDGET_MS, 10_000);
  assert.equal(WORKSPACE_AI_SECONDARY_FAMILY_BUDGET_MS, 4_000);
  assert.equal(
    workspaceAiFamilyBudget({
      family: "images",
      preferredFamily: "images",
      remainingMs: 45_000,
    }),
    10_000,
  );
  assert.equal(
    workspaceAiFamilyBudget({
      family: "video",
      preferredFamily: "images",
      remainingMs: 45_000,
    }),
    4_000,
  );
  assert.equal(
    workspaceAiFamilyBudget({
      family: "images",
      preferredFamily: "images",
      remainingMs: 6_500,
    }),
    500,
  );
  assert.equal(
    workspaceAiFamilyBudget({
      family: "images",
      preferredFamily: "images",
      remainingMs: 0,
    }),
    50,
  );
});

test("le resolver conserve le choix par famille et Booster active les références mixtes", () => {
  const consumption = read("lib/mediaWorkspaceConsumption.ts");
  const resolverStart = consumption.indexOf(
    "export async function resolveWorkspaceAiConsumption",
  );
  const resolverEnd = consumption.indexOf(
    "export async function syncPublicationWorkspaceContext",
    resolverStart,
  );
  const resolver = consumption.slice(resolverStart, resolverEnd);

  assert.match(resolver, /\.filter\(\(item\) => item\.mediaType === "image"\)[\s\S]*\.slice\(0, MAX_AI_IMAGE_COUNT\)/);
  assert.match(resolver, /media\.find\(\(item\) => item\.mediaType === "video"\)/);
  assert.match(resolver, /allowMixedMedia\?: boolean/);
  assert.match(
    resolver,
    /params\.allowMixedMedia === true \|\| params\.preferredMediaType !== "video"/,
  );
  assert.match(
    resolver,
    /params\.allowMixedMedia === true \|\| params\.preferredMediaType !== "images"/,
  );
  assert.match(resolver, /Promise\.all\(\[/);
  assert.match(resolver, /allowPartialMediaForAi: true/);
  assert.match(resolver, /imagesForAI,[\s\S]*videoForAI,[\s\S]*diagnostics:/);
  assert.doesNotMatch(resolver, /media\[0\]/);

  const generation = read("app/api/booster/generate/route.ts");
  assert.match(
    generation,
    /resolveWorkspaceAiConsumption\(\{[\s\S]*preferredMediaType: mediaType,[\s\S]*deadlineAt:/,
  );
  assert.match(generation, /allowMixedMedia: true/);
  assert.match(generation, /const workspaceHasImages = workspaceMedia\.imagesForAI\.length > 0/);
  assert.match(generation, /const workspaceHasVideo = Boolean\(workspaceMedia\.videoForAI\)/);
  assert.match(
    generation,
    /const workspaceHasUsableFamily =[\s\S]*workspaceHasImages \|\| workspaceHasVideo/,
  );
  assert.match(
    generation,
    /strictMediaCutover &&[\s\S]*mediaWorkspaceExpected &&[\s\S]*!workspaceHasUsableFamily/,
  );
  assert.doesNotMatch(
    generation,
    /!expectedWorkspaceFamilyReady/,
  );
  assert.match(
    generation,
    /useImagesForAI: workspaceHasImages,[\s\S]*imagesForAI: workspaceMedia\.imagesForAI,[\s\S]*videoForAI: workspaceVideoForBody/,
  );
  assert.match(
    generation,
    /buildVideoGenerationInstructions\(videoForAI, imagesForAI\.length\)/,
  );
  assert.match(
    generation,
    /generateSharedBoosterPosts\(\{[\s\S]*channels,[\s\S]*\[\.\.\.videoFrameImagesForAI, \.\.\.imagesForAI\]/,
  );
  assert.equal(
    generation.match(/generationResult = await generateSharedBoosterPosts\(/g)?.length,
    1,
  );
});
