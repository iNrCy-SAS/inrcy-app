/* eslint-disable @typescript-eslint/no-explicit-any -- Runtime authorization harnesses exercise actual server modules. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { isMetaChannelPilotEnabled } from "../../lib/metaChannelRollout.ts";
import * as editions from "../../lib/dashboardEdition.ts";
import { FULL_PRODUCT_REVIEWER_ACCOUNT_ID } from "../../lib/reviewerAccess.ts";
import * as reviewerAccess from "../../lib/reviewerAccess.ts";

function load(file: string, dependencies: Record<string, any> = {}): any {
  const source = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("exports", "require", source)(exports, (id: string) => {
    if (id === "server-only") return {};
    assert.ok(id in dependencies, `Unexpected import ${id}`);
    return dependencies[id];
  });
  return exports;
}
function fixture(actorRole: string | null, accountRole: string | null = actorRole, readError = false, actorId = FULL_PRODUCT_REVIEWER_ACCOUNT_ID) {
  const database = {
    auth: { getUser: async () => ({ data: { user: { id: actorId, user_metadata: { role: "admin" } } } }) },
    from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { role: actorRole }, error: readError ? { message: "Read failed" } : null }; } }),
  };
  const roles = load("lib/roles.ts", { "@/lib/supabaseServer": { createSupabaseServer: async () => database } });
  const response = { NextResponse: { json: (body: unknown, options: unknown) => ({ body, options }) } };
  const gate = load("lib/metaChannelRolloutServer.ts", {
    "next/server": response, "@/lib/roles": roles, "@/lib/metaChannelRollout": { META_DIRECT_CHANNELS_PUBLIC_ENABLED: false }, "@/lib/reviewerAccess": reviewerAccess,
  });
  const accountDatabase = { from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { role: accountRole }, error: readError ? { message: "Read failed" } : null }; } }) };
  const admin = load("lib/adminSecurity.ts", { "next/server": response, "@/lib/roles": roles });
  return { roles, gate, accountDatabase, admin };
}

test("REVIEWER opens the product pilot without any staff or admin authority", async () => {
  const { roles, gate, accountDatabase, admin } = fixture("reviewer");
  assert.deepEqual(await roles.getMyRole(), { role: "reviewer", isAdmin: false, isStaff: false, isReviewer: true, authUserId: FULL_PRODUCT_REVIEWER_ACCOUNT_ID });
  assert.equal(roles.isAdminRole("reviewer"), false);
  assert.equal(roles.isStaffRole("reviewer"), false);
  assert.equal(roles.isReviewerRole("reviewer"), true);
  assert.equal(isMetaChannelPilotEnabled(false, true), true);
  assert.equal(await gate.isMetaChannelPilotEnabledForActorAndAccount(accountDatabase, FULL_PRODUCT_REVIEWER_ACCOUNT_ID), true);
  const denial = await admin.requireAdminApi();
  assert.equal(denial.ok, false);
  assert.equal(denial.response.options.status, 403);
});

test("USER/staff cannot enter reviewer pilots, and reviewer does not authorize a USER active company", async () => {
  for (const [actor, account, expected] of [
    ["user", "reviewer", false], ["staff", "reviewer", false], ["reviewer", "user", false],
    ["reviewer", "admin", true], ["admin", "reviewer", true], ["admin", "admin", true],
  ] as const) {
    const { gate, accountDatabase } = fixture(actor, account);
    assert.equal(await gate.isMetaChannelPilotEnabledForActorAndAccount(accountDatabase, FULL_PRODUCT_REVIEWER_ACCOUNT_ID), expected, `${actor}/${account}`);
  }
  for (const [actorId, accountId, accountRole] of [
    ["unrelated-reviewer", FULL_PRODUCT_REVIEWER_ACCOUNT_ID, "reviewer"],
    [FULL_PRODUCT_REVIEWER_ACCOUNT_ID, "unrelated-reviewer", "reviewer"],
    [FULL_PRODUCT_REVIEWER_ACCOUNT_ID, "another-admin-account", "admin"],
    ["unrelated-reviewer", "unrelated-reviewer", "reviewer"],
  ] as const) {
    const { roles, gate, accountDatabase } = fixture("reviewer", accountRole, false, actorId);
    assert.equal((await roles.getMyRole()).isReviewer, true, "classification stays generic while pilot eligibility is narrow");
    assert.equal(await gate.isMetaChannelPilotEnabledForActorAndAccount(accountDatabase, accountId), false);
  }
  assert.equal(isMetaChannelPilotEnabled(false), true, "Public channel availability grants no reviewer/admin privileges");
});

test("Role read errors and user-editable metadata cannot grant reviewer or admin permissions", async () => {
  const denied = fixture("reviewer", "reviewer", true);
  assert.deepEqual(await denied.roles.getMyRole(), { role: null, isAdmin: false, isStaff: false, isReviewer: false, authUserId: FULL_PRODUCT_REVIEWER_ACCOUNT_ID });
  assert.equal(await denied.gate.isMetaChannelPilotEnabledForActorAndAccount(denied.accountDatabase, "account"), false);
  assert.equal((await fixture("user").roles.getMyRole()).isAdmin, false);
  assert.equal((await fixture("USER").roles.getMyRole()).role, null);
});

test("Reviewer role adds no company membership or global-account bypass", () => {
  const source = readFileSync(new URL("../../lib/multicompte/server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /reviewer|isReviewer|isAdmin/);
  assert.match(source, /\.eq\("auth_user_id", authUserId\)/);
  assert.match(source, /INRCY_ACCOUNT_ACCESS_DENIED/);
});

test("Full commercial tool access needs the exact approved account and reviewer role", async () => {
  const approved = FULL_PRODUCT_REVIEWER_ACCOUNT_ID;
  assert.equal(editions.resolveDashboardEditionForRole("premium", "reviewer", approved), "founder");
  for (const [role, accountId] of [["user", approved], ["admin", approved], ["reviewer", "another-account"], ["reviewer", undefined]] as const) {
    assert.equal(editions.resolveDashboardEditionForRole("premium", role, accountId), "premium");
  }
  for (const [accountRole, readError, expected] of [["reviewer", false, "founder"], ["user", false, "premium"], ["reviewer", true, "premium"]] as const) {
    const calls:string[]=[];
    const database={from:(table:string)=>{
      calls.push(table);
      const query={ select(){return this;},eq(){return this;},in(){return this;},async maybeSingle(){return table==="subscriptions"?{data:{plan:"Premium"},error:null}:{data:{role:accountRole},error:readError?{message:"Role denied"}:null};},then(resolve:(result:unknown)=>unknown){
        return Promise.resolve(table==="inrcy_account_members"?{data:[{account_id:approved,auth_user_id:approved,role:"owner"}],error:null}:table==="subscriptions"?{data:[{user_id:approved,plan:"Premium"}],error:null}:{data:[{user_id:approved,role:accountRole}],error:readError?{message:"Role denied"}:null}).then(resolve);
      }};return query;
    }};
    const server=load("lib/dashboardEditionServer.ts",{"next/server":{NextResponse:{}},"@/lib/dashboardEdition":editions,"@/lib/supabaseAdmin":{supabaseAdmin:database}});
    assert.equal(await server.getDashboardEditionForAuthUser(approved),expected);
    assert.equal(await server.getDashboardEditionForAccountId(approved),expected);
    assert.equal(calls.includes("profiles"),true);
  }
});

test("Ads pilot grants product testing to reviewer while admin APIs still deny it", async () => {
  for(const [role,expected] of [["reviewer",true],["admin",true],["user",false],["staff",false]] as const) {
    const base=fixture(role);
    const query={select(){return this;},eq(){return this;},async maybeSingle(){return {data:{role},error:null};}};
    const deps:Record<string,any>={
      "next/server":{NextResponse:{}},"@/lib/roles":base.roles,"@/lib/supabaseAdmin":{supabaseAdmin:{from:()=>query}},"@/lib/reviewerAccess":reviewerAccess,
      "@/lib/requireUser":{},"@/lib/oauthCrypto":{},"@/lib/metaGraphApi":{},"@/lib/metaGraphErrorClassification":{},
      "@/lib/metaBusinessAssets":{},"@/lib/adsGoogleApiError":{},"@/lib/dashboardEditionServer":{},"@/lib/adsAccessPolicy":{},
    };
    const ads=load("lib/adsServer.ts",deps);
    assert.equal(await ads.isAdsPilotAdmin(FULL_PRODUCT_REVIEWER_ACCOUNT_ID),expected);
    assert.equal(await ads.isAdsPilotAdmin("unrelated-reviewer"),role==="admin");
    assert.equal(await ads.isAdsPilotAdmin(FULL_PRODUCT_REVIEWER_ACCOUNT_ID,"another-company"),role==="admin");
    assert.equal((await base.admin.requireAdminApi()).ok,role==="admin");
  }
});
