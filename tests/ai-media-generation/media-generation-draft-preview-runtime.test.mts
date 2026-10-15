import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const id = "11111111-1111-4111-8111-111111111111";
function harness(options: { anonymous?: boolean; row?: Record<string, unknown> | null; dbError?: boolean; signError?: boolean } = {}) {
  const filters: unknown[] = []; const signatures: unknown[] = [];
  const row = options.row === undefined ? { id, bucket_name: "inrcy-pro-media", storage_path: "users/account-a/ai-generated/image/2026/10/media.jpg", source: "ai_media_generation_draft", is_active: false, upload_status: "uploaded", media_metadata: { draft_expires_at: new Date(Date.now()+60_000).toISOString() } } : options.row;
  const query = { select() { return query; }, eq(key: string,value: string) { filters.push([key,value]); return query; }, async maybeSingle() { return {data:row,error:options.dbError}; } };
  const modules = new Map<string,unknown>([
    ["next/server",{NextResponse:{json:(body:unknown,init:ResponseInit)=>Response.json(body,init)}}],
    ["@/lib/multicompte/server",{getCurrentInrcyAccountScope:async()=>options.anonymous ? null : {scope:{activeUserId:"account-a"}}}],
    ["@/lib/supabaseAdmin",{supabaseAdmin:{from(table:string){assert.equal(table,"pro_media_library");return query;}}}],
    ["@/lib/safeStorageSignedUrl",{createSafeStorageSignedUrl:async(...args:unknown[])=>{signatures.push(args);return options.signError ? null : `https://storage.invalid/fresh-${signatures.length}`;}}],
  ]);
  const output=ts.transpileModule(readFileSync(new URL("../../app/api/media-generation/drafts/[id]/content/route.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const record={exports:{} as {GET:(r:Request,c:{params:Promise<{id:string}>})=>Promise<Response>}};
  new Function("module","exports","require",output)(record,record.exports,(key:string)=>{assert.ok(modules.has(key),key);return modules.get(key);});
  return {filters,signatures,row,get:(mediaId=id)=>record.exports.GET(new Request("https://app.invalid/preview?accountId=account-b",{headers:{Range:"bytes=10-20"}}),{params:Promise.resolve({id:mediaId})})};
}
test("draft preview is authenticated, scoped and renewed on each read without mutations",async()=>{
  const denied=harness({anonymous:true});assert.equal((await denied.get()).status,401);assert.equal(denied.signatures.length,0);
  const h=harness(); const first=await h.get();const second=await h.get();
  assert.equal(first.status,307);assert.equal(second.status,307);assert.notEqual(first.headers.get("location"),second.headers.get("location"));
  assert.match(first.headers.get("cache-control")!,/private, no-store/);
  assert.deepEqual(h.filters,[["id",id],["user_id","account-a"],["id",id],["user_id","account-a"]]);
  assert.equal(h.signatures.length,2);
});
test("preview refuses removed, out-of-scope and non-generated drafts",async()=>{
  const base=harness().row!;
  for(const patch of [{bucket_name:"public"},{storage_path:"users/account-b/ai-generated/image/a.jpg"},{storage_path:"users/account-a/ai-generated/../../private.jpg"},{source:"workspace"},{upload_status:"removed"}]){
    const h=harness({row:{...base,...patch}});assert.ok([404,410].includes((await h.get()).status));assert.equal(h.signatures.length,0);
  }
  assert.equal((await harness({row:null}).get()).status,404);
  assert.equal((await harness().get("bad-id")).status,404);
});
test("transient reads fail explicitly without changing or deactivating a media",async()=>{
  assert.equal((await harness({dbError:true}).get()).status,503);
  assert.equal((await harness({signError:true}).get()).status,503);
  const base=harness().row!;
  assert.equal((await harness({row:{...base,media_metadata:{draft_expires_at:"2000-01-01"}}}).get()).status,307);
  assert.equal((await harness({row:{...base,source:"ai_media_generation",is_active:true,media_metadata:{draft_expires_at:"2000-01-01"}}}).get()).status,307);
});
