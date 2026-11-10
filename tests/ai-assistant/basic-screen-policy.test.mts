import assert from "node:assert/strict";
import test from "node:test";
import { isInrAssistantScreenCommandAllowed } from "../../lib/inrAssistantScreenCommandPolicy.ts";
import { assistantToolsForEdition } from "../../lib/inrAssistantEditionPolicy.ts";
import { canOfferInrAssistantAutoContinuation, canResumeInrAssistantAfterUi } from "../../lib/inrAssistantAutoContinuation.ts";
import type { InrAssistantUiAction, InrAssistantUiResult } from "../../lib/inrAssistantUiActions.ts";
import { inrAssistantUiSteps, parseInrAssistantUiSteps } from "../../lib/inrAssistantUiTask.ts";
import { createInrAssistantReadBudget } from "../../lib/inrAssistantObjectives.ts";

test("Basic exposes manual screen and schedule tools without granting Premium command variants", () => {
  const tools = {runScreenCommand: {}, readScheduledPublications: {}, previewScheduledPublicationAction: {}, applyScheduledPublicationAction: {}, configureAgentAutomation: {}, sendIndividualMail: {}};
  assert.deepEqual(Object.keys(assistantToolsForEdition(tools,"basic")), ["runScreenCommand", "readScheduledPublications", "previewScheduledPublicationAction", "applyScheduledPublicationAction"]);
  for (const command of ["configure_video_retouch","select_video_source","save_video_retouch","optimize_media"]) assert.equal(isInrAssistantScreenCommandAllowed("basic",command),true);
  for (const command of ["configure_ads_draft","save_ads_draft","configure_mail_draft","send_mail_draft","export_document_pdf","prepare_document_mail","invented_command"]) assert.equal(isInrAssistantScreenCommandAllowed("basic",command),false);
});

test("global account actions retain their order after a form navigation without borrowing its revision",()=>{
  for(const [instruction,command] of [["Ouvre les statistiques puis télécharge mes données personnelles","download_account_export"],["Ouvre la médiathèque puis désactive les cookies statistiques","configure_cookie_consent"],["Ouvre la retouche image puis télécharge ma dernière facture d’abonnement","download_subscription_invoice"]]){
    const steps=inrAssistantUiSteps(instruction);assert.equal(steps.length,2,instruction);assert.equal(steps[0].command,"navigateApplication");assert.equal(steps[1].command,command);assert.equal(steps[1].afterStepId,undefined);assert.equal(steps[1].screen,undefined);assert.equal(parseInrAssistantUiSteps(steps)?.length,2);
  }
});

test("review pagination follows only the returned signed cursor and preserves all filters",()=>{
  const budget=createInrAssistantReadBudget(),base={query:"",replyStatus:"unanswered",rating:null,fromDate:null,toDate:null,orderBy:"updated"};
  assert.equal(budget.start("listGoogleReviews",{...base,cursor:"forged"},"all_reviews"),null);
  const first=budget.start("listGoogleReviews",{...base,cursor:null},"all_reviews")!;assert.ok(first);budget.finish(first,{ok:true,nextCursor:"signed_page_2"});
  assert.equal(budget.start("listGoogleReviews",{...base,rating:1,cursor:"signed_page_2"},"all_reviews"),null);
  const second=budget.start("listGoogleReviews",{...base,cursor:"signed_page_2"},"all_reviews")!;assert.ok(second);budget.finish(second,{ok:true,nextCursor:"signed_page_3"});
  assert.equal(budget.start("listGoogleReviews",{...base,cursor:"signed_page_2"},"all_reviews"),null);
  const third=budget.start("listGoogleReviews",{...base,cursor:"signed_page_3"},"all_reviews")!;assert.ok(third);budget.finish(third,{ok:true,nextCursor:null});assert.equal(budget.available("listGoogleReviews"),false);
});

const action: InrAssistantUiAction = {id:"view",type:"navigate",navigation:{destination:"studio",href:"/dashboard/generer-media",label:"iNr’Studio"}};
const result: InrAssistantUiResult = {actionId:"view",source:"browser_reported",status:"applied"};
test("automatic continuation has edition parity only for a durably saved unfinished authorized task", () => {
  const input = {edition:"basic" as const,taskSaved:true,outcome:"partial",remaining:2,uncertain:false,actions:[action]};
  for (const edition of ["basic", "standard", "premium", "founder"] as const) assert.equal(canOfferInrAssistantAutoContinuation({...input,edition}),true);
  for (const patch of [{taskSaved:false},{outcome:"completed"},{remaining:0},{uncertain:true},{needsHuman:true},{actions:[]}]) assert.equal(canOfferInrAssistantAutoContinuation({...input,...patch}),false);
  const paidCommand = {id:"paid",type:"command" as const,command:{command:"send_mail_draft" as const,selection:{kind:"mail" as const,id:"mail"},revision:"mail_1"}};
  assert.equal(canOfferInrAssistantAutoContinuation({...input,actions:[paidCommand]}),false,"Basic cannot borrow a Premium command when it resumes");
});

test("automatic continuation requires successful exact receipts and stops on new input, scope changes and limits", () => {
  const input = {offered:true,actions:[action],results:[result],hops:0,startedAt:1000,now:2000,current:true,draftPending:false};
  assert.equal(canResumeInrAssistantAfterUi(input),true);
  for (const patch of [{offered:false},{results:[]},{results:[{...result,actionId:"other"}]},{results:[{...result,status:"failed" as const}]},{results:[{...result,status:"cancelled" as const}]},{hops:24},{now:1_000_000},{current:false},{draftPending:true}]) assert.equal(canResumeInrAssistantAfterUi({...input,...patch}),false);
});
