import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { getActionablePublicationWarningCodes } from "../../app/dashboard/booster/publier/publicationMediaPool.ts";

const load = runtimeModules();
const require = createRequire(import.meta.url);
const sharedExports = {};
const sharedSource = ts.transpileModule(readFileSync(new URL("../../app/dashboard/booster/publier/publishModal.shared.tsx", import.meta.url), "utf8"), { fileName: "publishModal.shared.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new Function("exports", "require", sharedSource)(sharedExports, (id: string) => id.startsWith("@/") ? load(`${id.slice(2)}.ts`) : require(id));
const shared = sharedExports as typeof import("../../app/dashboard/booster/publier/publishModal.shared.tsx");
const source = ts.createSourceFile("PublishModal.tsx", readFileSync(new URL("../../app/dashboard/booster/publier/PublishModal.tsx", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
let reviewExpression: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "buildFinalReviewItems") reviewExpression = node.initializer;
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(reviewExpression);
const compiled = ts.transpileModule(`const build = ${reviewExpression.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const messages = JSON.parse(readFileSync(new URL("../../messages/fr-FR/booster.json", import.meta.url), "utf8")) as Record<string, string>;
const translate = (key: string, args: Record<string, unknown> = {}) => Object.entries(args).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), messages[key] || key);

/** Execute the actual modal review builder and its real duration policy. */
export function durationReviewItems(durationSeconds: number) {
  const scope = {
    selectedChannels: ["facebook", "gmb"], connected: { facebook: true, gmb: true },
    resolveChannelMediaMode: (channel: string) => channel === "gmb" ? "video" : "none",
    getReviewPostForChannel: () => ({ title: "Fixture", content: "Ready" }),
    getPublishImageKeysForChannel: () => [], images: [],
    instagramStoryEnabled: false, instagramPublicationPlacement: "classic", facebookStoryEnabled: false, facebookPublicationPlacement: "classic",
    videoFile: { name: "fixture.mp4", type: "video/mp4" }, videoDurationSeconds: durationSeconds, videoSourceMetadata: null,
    tiktokMaxVideoDurationSeconds: null, tiktokDurationLimitVerified: false, youtubeLongUploadsStatus: "unknown",
    getChannelPublicationRequirements: shared.getChannelPublicationRequirements,
    getLocalizedChannelPublicationRequirement: shared.getLocalizedChannelPublicationRequirement,
    getLocalizedChannelLabel: shared.getLocalizedChannelLabel, getActionablePublicationWarningCodes,
    videoVariantPreparationByChannel: {}, videoSettingsByChannel: {}, videoFormatByChannel: {},
    mediaPipelineCutoverEnabled: true, persistentMediaWorkspaceEnabled: false, persistentMediaStates: {},
    pinterestBoardId: "", tiktokReviewCurrent: false, runtimeT: translate, i18nT: translate,
  };
  return new Function(...Object.keys(scope), `${compiled}\nreturn build({});`)(...Object.values(scope)) as Array<{
    channel: string; label: string; blockers: string[]; blockerCodes: string[];
    mediaBlockers: string[]; mediaBlockerCodes: string[]; publishable: boolean;
  }>;
}
