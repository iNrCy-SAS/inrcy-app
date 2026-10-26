import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { resolveDashboardEdition, isApiRouteAllowedForEdition, isDashboardRouteAllowedForEdition, hasAgentAutomationAccess, hasPremiumDashboardAccess } from "../../lib/dashboardEdition.ts";
import { currentSubscriptionOffer, annualSubscriptionSavingRate } from "../../lib/subscriptionOffers.ts";
import { AI_MEDIA_MONTHLY_LIMITS, legacyAiMediaAmountToCredits } from "../../lib/aiMediaPlanLimits.ts";
import { assistantToolsForEdition, isBasicAssistantExecutionRequest } from "../../lib/inrAssistantEditionPolicy.ts";
import { canStartSubscriptionCheckout } from "../../lib/subscriptionCheckoutPolicy.ts";
import { isCheckoutReturnSynchronized } from "../../lib/subscriptionCheckoutReturn.ts";

test("Basic has the approved monthly/annual price and preserves the other offers",()=>{
 const basic=currentSubscriptionOffer("Basic");assert.equal(basic.monthlyPriceEur,29);assert.equal(basic.yearlyPriceEur,309);assert.equal(basic.taxBehavior,"exclusive");
 assert.ok(Math.abs(annualSubscriptionSavingRate(basic)-39/348)<1e-9);
 assert.equal(currentSubscriptionOffer("Standard").monthlyPriceEur,58);assert.equal(currentSubscriptionOffer("Premium").monthlyPriceEur,108);
});
test("all new trials keep Standard for 21 days, even with Basic selected for later",()=>{
 const source=fs.readFileSync("lib/trialSubscription.ts","utf8");assert.match(source,/NEW_ACCOUNT_EDITION = "standard"/);assert.match(source,/INRCY_TRIAL_DAYS", "21"/);
 assert.equal(resolveDashboardEdition({plan:"Trial",edition:"basic",production:true}),"standard");
 assert.equal(resolveDashboardEdition({plan:"Basic",edition:"premium",production:true}),"basic");
});
test("Basic has zero included media credits but can use the Studio with purchased credits",()=>{
 for(const [edition,expected] of [["basic",0],["standard",735],["premium",2530]] as const){const limit=AI_MEDIA_MONTHLY_LIMITS[edition];assert.equal(legacyAiMediaAmountToCredits("image",limit.image)+legacyAiMediaAmountToCredits("video",limit.video),expected);assert.equal(limit.studioEnabled,true);}
});
test("Basic permits manual tools and blocks every agent route and Premium tool",()=>{
 for(const route of ["/dashboard","/dashboard/generer-media","/dashboard/mediatheque","/dashboard/stats","/dashboard/e-reputation"]) assert.equal(isDashboardRouteAllowedForEdition(route,undefined,"basic"),true,route);
 for(const route of ["/dashboard/agent","/dashboard/agent/publications","/dashboard/agent/stats","/dashboard/ads","/dashboard/crm","/dashboard/agenda"]) assert.equal(isDashboardRouteAllowedForEdition(route,undefined,"basic"),false,route);
 for(const route of ["/api/agent/actions","/api/agent/actions/execute","/api/agent/settings","/api/crm/contacts","/api/ads/campaigns"]) assert.equal(isApiRouteAllowedForEdition(route,undefined,"basic"),false,route);
 assert.equal(isApiRouteAllowedForEdition("/api/booster/publish-now",undefined,"basic"),true);assert.equal(hasAgentAutomationAccess("basic"),false);assert.equal(hasPremiumDashboardAccess("basic"),false);
 assert.equal(hasAgentAutomationAccess("standard"),true);assert.equal(hasPremiumDashboardAccess("premium"),true);
});
test("Basic assistant is read-only, including tools introduced in the future",()=>{
 const all={readAppGuide:{},getAccountDiagnostics:{},recallPastDiscussions:{},readWorkspaceSection:{},generateMedia:{},updateBusinessDna:{},preparePublication:{},executePublication:{},unknownFutureAction:{}};
 assert.deepEqual(Object.keys(assistantToolsForEdition(all,"basic")),["readAppGuide","getAccountDiagnostics","recallPastDiscussions","readWorkspaceSection"]);
 assert.equal(assistantToolsForEdition(all,"standard"),all);
 assert.equal(isBasicAssistantExecutionRequest("Comment mettre mon site dans mes CTA ?"),false);
 assert.equal(isBasicAssistantExecutionRequest("Mets mon téléphone dans tous mes CTA"),true);
 assert.equal(isBasicAssistantExecutionRequest("Prépare une publication pour demain"),true);
 assert.equal(isBasicAssistantExecutionRequest("Aide-moi à connecter Facebook"),false);
});
test("Basic checkout can be selected during a trial without synchronizing access before payment",()=>{
 assert.equal(canStartSubscriptionCheckout({plan:"Trial",status:"trialing"},"Basic"),true);
 const row={plan:"Trial",app_edition:"standard",scheduled_plan:"Basic",status:"trialing",stripe_subscription_id:"sub_test",billing_cycle:"yearly",trial_end_at:"2026-11-01T00:00:00Z",next_renewal_date:"2026-11-01"};
 assert.equal(isCheckoutReturnSynchronized(row,{plan:"Basic",billingCycle:"yearly"}),true);
 assert.equal(resolveDashboardEdition({plan:row.plan,edition:row.app_edition,production:true}),"standard");
});
