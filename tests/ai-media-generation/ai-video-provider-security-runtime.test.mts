import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
import {createDownload} from "ai";
import * as pending from "../../lib/aiMediaPendingVideo.ts";
import type * as Heygen from "../../lib/aiVideoHeygenApi.ts";
import type * as Kling from "../../lib/aiVideoKlingApi.ts";
function load<T>(file:string):T{
 const source=readFileSync(new URL("../../lib/"+file,import.meta.url),"utf8");
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const result={exports:{}};new Function("module","exports","require",js)(result,result.exports,(id:string)=>{
  if(id==="server-only")return {};if(id==="node:timers/promises")return {setTimeout:async()=>{}};
  if(id==="./aiMediaPendingVideo.ts")return pending;throw new Error("Unexpected security fixture dependency");
 });return result.exports as T;
}
const heygen=load<typeof Heygen>("aiVideoHeygenApi.ts");const kling=load<typeof Kling>("aiVideoKlingApi.ts");

test("provider credentials stay on fixed HTTPS API origins and API requests refuse redirects",async()=>{
 const seen:string[]=[];
 const h=heygen.createHeygenApiClient({apiKey:"synthetic-heygen-secret",fetch:async(url,init)=>{
  seen.push(String(url));assert.equal(new URL(String(url)).origin,"https://api.heygen.com");assert.equal(init?.redirect,"error");
  assert.equal((init?.headers as Record<string,string>)["X-Api-Key"],"synthetic-heygen-secret");
  return Response.json({data:[]});
 }});
 await assert.rejects(h.publicVoices("fr"),/voice_unavailable/);
 const k=kling.createKlingApiClient({apiKey:"synthetic-kling-secret",fetch:async(url,init)=>{
  seen.push(String(url));assert.equal(new URL(String(url)).origin,"https://api-singapore.klingai.com");assert.equal(init?.redirect,"error");
  assert.equal((init?.headers as Record<string,string>).Authorization,"Bearer synthetic-kling-secret");
  return Response.json({code:0,data:[]});
 }});
 assert.equal(await k.findVideo("own-task"),null);
 for(const id of ["../elsewhere","https://attacker.invalid","a/b","a".repeat(181)]){await assert.rejects(h.getVideo(id));await assert.rejects(k.findVideo(id));}
 assert.equal(seen.length,2);
});

test("HeyGen downloads never receive its API key and oversized media is stopped before reading its payload",async()=>{
 let cancelled=false;let calls=0;
 const h=heygen.createHeygenApiClient({apiKey:"synthetic-never-forward",fetch:async(_url,init)=>{
  calls++;assert.equal(init?.headers,undefined);assert.equal(init?.redirect,"error");
  return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-length":String(129*1024*1024)}});
 }});
 await assert.rejects(h.downloadVideo("https://resource2.heygen.ai/result.mp4"),/response_size_invalid/);
 assert.equal(calls,1);assert.equal(cancelled,true);
 for(const url of ["https://127.0.0.1/a","https://heygen.ai.attacker.invalid/a","http://resource2.heygen.ai/a","https://user:secret@heygen.ai/a"]){await assert.rejects(h.downloadVideo(url),/video_url_invalid/);}
 assert.equal(calls,1);
});

test("chunked Kling JSON is stopped and cancelled as soon as its byte limit is exceeded",async()=>{
 let pulls=0,cancelled=false;
 const k=kling.createKlingApiClient({apiKey:"synthetic",fetch:async()=>new Response(new ReadableStream({
  pull(controller){pulls++;controller.enqueue(new Uint8Array(262144));if(pulls===100)controller.close();},
  cancel(){cancelled=true;},
 }))});
 await assert.rejects(k.findVideo("own-task"),/response_invalid/);
 assert.equal(cancelled,true);assert.ok(pulls<10,"the client must not accumulate the whole 25MB response");
});

test("declared oversized Kling JSON is cancelled before decoding",async()=>{
 let cancelled=false;
 const k=kling.createKlingApiClient({apiKey:"synthetic",fetch:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-length":"1000001"}})});
 await assert.rejects(k.findVideo("own-task"),/response_invalid/);assert.equal(cancelled,true);
});

test("the installed video downloader blocks private targets and revalidates a redirect without sending credentials",async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_url,init)=>{calls++;assert.equal(init?.headers,undefined);assert.equal(init?.redirect,"manual");return new Response(null,{status:302,headers:{location:"http://127.0.0.1/private"}});};
 try{
  const download=createDownload({maxBytes:16});
  for(const url of ["http://127.0.0.1/a","https://192.168.1.1/a","https://169.254.169.254/a","https://[::1]/a","https://localhost/a"]){await assert.rejects(download({url:new URL(url)}));}
  assert.equal(calls,0);await assert.rejects(download({url:new URL("https://cdn.example.invalid/video.mp4")}));assert.equal(calls,1);
 }finally{globalThis.fetch=previous;}
});
