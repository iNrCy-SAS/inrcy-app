import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as retry from "../../lib/publicationStorySequenceRetry.ts";
import { isBoosterPublicationPendingStatus } from "../../lib/boosterPublicationStatus.ts";
import * as motionTiming from "../../lib/metaImageMotionTiming.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const modal = ts.createSourceFile("BoosterPublicationWorkflow.tsx", ["app/dashboard/booster/publier/PublishModal.tsx", "app/dashboard/booster/publier/publicationSubmission.ts", "app/dashboard/booster/publier/publicationSubmissionPayload.ts"].map(file => parse(file).text).join("\n"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX), editor = parse("app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx"), result = parse("app/dashboard/_components/PublishExecutionResultModal.tsx");
function find(source: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); };
  visit(source); assert.ok(found, "Required production expression"); return found;
}
function variable(source: ts.SourceFile, name: string): string {
  const declaration = find(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
  assert.ok(ts.isVariableDeclaration(declaration) && declaration.initializer); return declaration.initializer.getText(source);
}
function evaluate<T>(text: string, values: Record<string, unknown> = {}): T {
  const scope = { ...retry, ...motionTiming, isBoosterPublicationPendingStatus, require, exports: {}, ...values };
  const compiled = ts.transpileModule(`const value = (${text});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return new Function(...Object.keys(scope), compiled + "\nreturn value;")(...Object.values(scope));
}
function productionFunction<T>(source: ts.SourceFile, name: string, scope: Record<string, unknown> = {}): T {
  return evaluate(find(source, node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source).replace(/^export\s+/, ""), scope);
}
const getPublicationDestinationStatus = productionFunction<(entry: unknown) => string>(parse("app/dashboard/_components/PublishExecutionProgress.tsx"), "getPublicationDestinationStatus");
const submissionPayload = runtimeModules({ "../../_components/PublishExecutionProgress": { getPublicationDestinationStatus } })<typeof import("../../app/dashboard/booster/publier/publicationSubmissionPayload.ts")>("app/dashboard/booster/publier/publicationSubmissionPayload.ts");
const facebookRef = "10000000-0000-4000-8000-000000000001", instagramRef = "10000000-0000-4000-8000-000000000002";
const failed = { channel: "facebook", label: "Facebook", status: "failed", ok: false, retryable: true, story_sequence_resume_ref: facebookRef };
const partial = { channel: "instagram", label: "Instagram", status: "published_with_warning", ok: true, retryable: true, warning: "meta_placement_partial_failure", story_sequence_resume_ref: instagramRef };

test("retry transmits only valid server references for the selected failed or explicitly partial Meta Story sequences", () => {
  const summary = { entries: [failed, partial, { ...failed, channel: "gmb" }, { ...failed, channel: "threads" }] };
  assert.deepEqual(retry.buildStorySequenceResumeByChannel(summary, ["facebook"]), { facebook: facebookRef });
  assert.deepEqual(retry.buildStorySequenceResumeByChannel(summary, ["instagram", "facebook"]), { facebook: facebookRef, instagram: instagramRef });
  assert.equal(retry.buildStorySequenceResumeByChannel(summary, ["gmb", "threads"]), undefined);
  for (const entry of [{ ...failed, retryable: false }, { ...failed, retryable: undefined }, { ...failed, status: "processing" }, { ...partial, warning: null }, { ...failed, story_sequence_resume_ref: "https://example.test/private" }, { ...failed, story_sequence_resume_ref: " " + facebookRef }, { ...failed, ok: true, status: "published" }]) {
    assert.equal(retry.buildStorySequenceResumeByChannel({ entries: [entry] }, [entry.channel]), undefined);
  }
});

test("the real publication payload adds the checkpoint on retry and omits it for a normal new publication", () => {
  const dispatch = find(modal, node => ts.isCallExpression(node) && node.expression.getText(modal) === "trackEvent" && node.arguments[0]?.getText(modal) === '"publish"');
  assert.ok(ts.isCallExpression(dispatch) && ts.isObjectLiteralExpression(dispatch.arguments[1]));
  const property = dispatch.arguments[1].properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(modal) === "storySequenceResumeByChannel");
  assert.ok(property && ts.isPropertyAssignment(property));
  const build = (options: unknown, publishTargetChannels: string[]) => evaluate(property.initializer.getText(modal), { options, publishTargetChannels });
  assert.deepEqual(build({ retryPreviousSummary: { entries: [failed, partial] } }, ["instagram"]), { instagram: instagramRef });
  assert.equal(build(undefined, ["instagram", "facebook"]), undefined);
  assert.equal(build({}, ["facebook"]), undefined);
});

test("the current retry callback includes the partial Story channel and refuses a changed account or actor", async () => {
  const summary = { entries: [failed, partial, { channel: "site_web", ok: true, status: "published" }, { channel: "tiktok", ok: true, status: "processing" }] };
  const actorScope = { current: { actorUserId: "actor-a", accountId: "account-a" } };
  let browserAccount = "account-a";
  const isCurrentPublishScope = evaluate<() => boolean>(variable(modal, "isCurrentPublishScope"), { publicationActorScopeRef: actorScope, actorUserId: "actor-a", publishAccountId: "account-a", activeAccountId: "account-a", getActiveBrowserUserId: () => browserAccount });
  const calls: Array<{ channels: string[]; retryPreviousSummary: unknown }> = [];
  const callback = evaluate<() => Promise<void>>(variable(modal, "retryFailed"), { remainingRetryChannels: ["facebook", "instagram"], completedSummary: summary, latestPublicationSummaryRef: { current: summary }, isCurrentPublishScope, runPublish: async (value: typeof calls[number]) => { calls.push(value); }, preparedPostsByChannel: {}, options: undefined, tiktokPublicationSettings: null });
  await callback(); assert.deepEqual(calls[0].channels, ["facebook", "instagram"]); assert.equal(calls[0].retryPreviousSummary, summary);
  browserAccount = "account-b"; await callback(); assert.equal(calls.length, 1);
  browserAccount = "account-a"; actorScope.current.actorUserId = "actor-b"; await callback(); assert.equal(calls.length, 1);
});

test("retry summary and polling retain the partial checkpoint and clear it after a completed retry", () => {
  const merge = submissionPayload.mergeRetriedPublicationSummary;
  const first = merge(undefined, { entries: [{ ...partial, published_image_count: 3, expected_image_count: 5 }] }, "publication-a", ["instagram"]);
  assert.equal(first.entries[0].story_sequence_resume_ref, instagramRef); assert.equal(first.retryableFailureCount, 1);
  assert.deepEqual(retry.publicationStorySequenceCounts(first.entries[0]), { confirmed: 3, expected: 5 });
  const invalidCounts = merge(undefined, { entries: [{ ...partial, published_image_count: 6, expected_image_count: 5 }] }, "publication-a", ["instagram"]);
  assert.equal(retry.publicationStorySequenceCounts(invalidCounts.entries[0]), null);
  const second = merge(first, { entries: [{ ...partial, story_sequence_resume_ref: undefined, warning: null, retryable: false, status: "published" }] }, "publication-b", ["instagram"]);
  assert.equal(second.entries[0].story_sequence_resume_ref, undefined); assert.equal(second.retryableFailureCount, 0);
  const publicationChannelKey = productionFunction(result, "publicationChannelKey"), entryPublicationId = productionFunction(result, "entryPublicationId");
  const isPendingPublicationEntry = productionFunction(result, "isPendingPublicationEntry", { getPublicationDestinationStatus });
  const poll = productionFunction<(current: unknown, snapshot: unknown, id: string) => { entries: typeof partial[]; retryableFailureCount: number }>(result, "mergePublicationResultSnapshot", { publicationChannelKey, entryPublicationId, isPendingPublicationEntry, getPublicationDestinationStatus });
  const updated = poll({ publicationId: "publication-a", entries: [{ ...partial, status: "processing", warning_kind: "pending" }] }, { entries: [{ ...partial, published_image_count: 0, expected_image_count: 5 }] }, "publication-a");
  assert.equal(updated.entries[0].story_sequence_resume_ref, instagramRef); assert.equal(updated.retryableFailureCount, 1);
  assert.deepEqual(retry.publicationStorySequenceCounts(updated.entries[0]), { confirmed: 0, expected: 5 });
});

test("Validation keeps per-channel Reel and Story timing in all nine locales while Contents stays free of technical banners", () => {
  const options = parse("app/dashboard/booster/publier/components/PublishValidationChannelOptions.tsx");
  assert.doesNotMatch(editor.text, /data-meta-(?:reel|story)-image-notice|instagram_image_motion_notice|instagram_image_story_sequence_notice/);
  assert.match(editor.text, /data-meta-story-only-content/); assert.match(editor.text, /disabled=\{activeStoryOnly\}/);
  const interpolate=(message:string,values:Record<string,unknown>)=>message.replace(/\{(\w+)\}/g,(_,key)=>String(values[key]??'{'+key+'}'));
  const hint=(messages:Record<string,string>,channel:string,count:number,placement:string,story:boolean,mode="images",otherCount=count)=>{
    const props={facebookPublicationPlacement:placement,instagramPublicationPlacement:placement,facebookStoryEnabled:story,instagramStoryEnabled:story,facebookMediaMode:mode,instagramMediaMode:mode,facebookImageCount:channel==='facebook'?count:otherCount,instagramImageCount:channel==='instagram'?count:otherCount};
    const scope:Record<string,unknown>={props,channel,t:(key:string,values:Record<string,unknown>={})=>interpolate(messages[key]||key,values)};
    for(const name of ['facebook','placement','storyEnabled','imageCount','mode'])scope[name]=evaluate(variable(options,name),scope);
    return evaluate<string|undefined>(variable(options,'durationHint'),scope);
  };
  assert.equal(motionTiming.getMetaImageMotionDuration(1,"story"),4);assert.deepEqual([1,2,3,5].map(count=>motionTiming.getMetaImageMotionDuration(count,"reel")),[3,6,9,15]);
  for (const locale of ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const messages = JSON.parse(read(`messages/${locale}/booster.json`)) as Record<string, string>;
    assert.ok(messages.publication_reel_duration_hint.includes("{secondsPerImage}")&&messages.publication_reel_duration_hint.includes("{duration}"));assert.ok(messages.publication_story_duration_hint.includes("{secondsPerImage}"));
    assert.ok(messages.publication_stories_confirmed_count.includes("{confirmed}") && messages.publication_stories_confirmed_count.includes("{expected}"));
    for (const channel of ["facebook", "instagram"]) for(const count of [1,3,5]) for (const [placement, story, reelExpected, storyExpected] of [["story", false, false, true], ["reel", false, true, false], ["reel", true, true, true], ["classic", true, false, true]] as const) {
      const value=hint(messages,channel,count,placement,story)||'';
      if(reelExpected)assert.ok(value.includes(interpolate(messages.publication_reel_duration_hint,{secondsPerImage:3,duration:count*3})),locale+' '+channel+': selected image count determines Reel duration');
      if(storyExpected)assert.ok(value.includes(interpolate(messages.publication_story_duration_hint,{secondsPerImage:4})),locale+' '+channel+': each Story remains 4 seconds');
    }
    assert.ok(hint(messages,'facebook',3,'reel',true,'images',5)?.includes(interpolate(messages.publication_reel_duration_hint,{secondsPerImage:3,duration:9})));
    assert.ok(hint(messages,'instagram',5,'reel',true,'images',3)?.includes(interpolate(messages.publication_reel_duration_hint,{secondsPerImage:3,duration:15})));
    for(const mode of ["video","none"])for(const channel of ["facebook","instagram"])assert.equal(hint(messages,channel,5,"reel",true,mode),undefined);
    for(const channel of ["facebook","instagram"])assert.equal(hint(messages,channel,0,"reel",true),undefined);
  }
});

test("Validation receives per-channel selected image counts rather than the total pool count",()=>{
  const counts:Record<string,number[]>={facebook:[],instagram:[]};
  const visit=(node:ts.Node)=>{
    if(ts.isJsxAttribute(node)&&["facebookImageCount","instagramImageCount"].includes(node.name.getText(modal))&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression){
      const channel=node.name.getText(modal)==="facebookImageCount"?"facebook":"instagram";
      counts[channel].push(evaluate<number>(node.initializer.expression.getText(modal),{getPublishImageKeysForChannel:(key:string)=>Array.from({length:key==="facebook"?3:5},(_,index)=>`${key}-${index}`),images:Array.from({length:5})}));
    }
    ts.forEachChild(node,visit);
  };visit(modal);assert.deepEqual(counts,{facebook:[3],instagram:[5]});
});
