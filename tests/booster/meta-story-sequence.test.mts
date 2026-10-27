import assert from "node:assert/strict";
import test from "node:test";
import { runMetaStorySequence, type MetaStorySequenceState, type MetaStoryNativeResult } from "../../lib/metaStorySequence.ts";

const colors = ["red","orange","yellow","green","blue"];
const sources = colors.map(color=>`account/media/${color}.png`);
const scopeKey = "account:checkpoint-uuid:instagram:remote-account:target-story";
const copy = <T,>(value:T):T => JSON.parse(JSON.stringify(value));
function harness(selected=sources) {
  let saved:unknown=null;
  let persistCount=0;
  const calls:Array<{source:string;index:number}>=[], snapshots:MetaStorySequenceState[]=[], events:string[]=[];
  const failures=new Map<number,"before"|"after">();
  let native:(source:string,index:number)=>Promise<MetaStoryNativeResult>=async(_source,index)=>({ok:true,remoteId:`remote-story-${index}`});
  const options={scopeKey,sources:selected,
    load:async()=>copy(saved),
    persist:async(state:MetaStorySequenceState)=>{
      persistCount++;events.push(`persist:${state.items.map(item=>item.status).join(",")}`);
      const failure=failures.get(persistCount);failures.delete(persistCount);
      if(failure==="before")throw Error("Synthetic checkpoint write failed");
      saved=copy(state);snapshots.push(copy(state));
      if(failure==="after")throw Error("Synthetic checkpoint acknowledgement lost");
    },
    publish:async(source:string,index:number)=>{calls.push({source,index});events.push(`publish:${index}`);return native(source,index);},
  };
  return {options,calls,snapshots,events,failures,
    setNative(value:typeof native){native=value},setSaved(value:unknown){saved=copy(value)},getSaved(){return copy(saved)},get persistCount(){return persistCount},
  };
}

test("five colored stories publish in source order, persist every native ID, and a completed replay has no effects",async()=>{
  const h=harness();const result=await runMetaStorySequence(h.options);
  assert.equal(result.ok,true);
  assert.deepEqual(h.calls,sources.map((source,index)=>({source,index})));
  assert.deepEqual(result.remoteIds,colors.map((_,index)=>`remote-story-${index}`));
  assert.equal(result.publishedCount,5);assert.equal(result.expectedCount,5);
  assert.deepEqual(result.state?.items.map(item=>item.status),Array(5).fill("published"));
  assert.equal(h.persistCount,11,"Initial queued checkpoint plus before/after checkpoints for every story");
  for(let index=0;index<5;index++){
    const dispatch=h.snapshots[1+2*index],published=h.snapshots[2+2*index];
    assert.equal(dispatch.items[index].status,"dispatching");
    assert.equal(published.items[index].remoteId,`remote-story-${index}`);
    assert.ok(h.events.indexOf(`publish:${index}`)>h.events.indexOf(`persist:${dispatch.items.map(item=>item.status).join(",")}`));
  }
  const before={calls:h.calls.length,persists:h.persistCount};
  const replay=await runMetaStorySequence(h.options);
  assert.equal(replay.ok,true);assert.deepEqual(replay.remoteIds,result.remoteIds);
  assert.equal(h.calls.length,before.calls);assert.equal(h.persistCount,before.persists);
});

test("a certain retryable failure resumes only the failed index and never republishes earlier colors",async()=>{
  const h=harness();h.setNative(async(_source,index)=>index===2?{ok:false,certainty:"not_published",retryable:true,error:"Image temporairement refusée avant publication"}:{ok:true,remoteId:`remote-story-${index}`});
  const partial=await runMetaStorySequence(h.options);
  assert.equal(partial.ok,false);assert.equal(partial.certainty,"not_published");assert.equal(partial.retryable,true);
  assert.equal(partial.publishedCount,2);assert.deepEqual(partial.state?.items.map(item=>item.status),["published","published","failed","queued","queued"]);
  h.setNative(async(_source,index)=>({ok:true,remoteId:`remote-story-${index}`}));
  const completed=await runMetaStorySequence(h.options);
  assert.equal(completed.ok,true);assert.equal(completed.publishedCount,5);
  assert.deepEqual(h.calls.map(call=>call.index),[0,1,2,2,3,4]);
});

test("a thrown native call is unknown, blocks later stories and can never be automatically replayed",async()=>{
  const h=harness();h.setNative(async(_source,index)=>{if(index===1)throw Error("Socket reset with PRIVATE TOKEN");return {ok:true,remoteId:`remote-story-${index}`}});
  const failed=await runMetaStorySequence(h.options);
  assert.equal(failed.ok,false);assert.equal(failed.certainty,"unknown");assert.equal(failed.retryable,false);
  assert.equal(failed.publishedCount,1);assert.equal(failed.state?.items[1].status,"unknown");assert.doesNotMatch(failed.error??"",/PRIVATE TOKEN/);
  const calls=h.calls.length;const replay=await runMetaStorySequence(h.options);
  assert.equal(replay.certainty,"unknown");assert.equal(replay.retryable,false);assert.equal(h.calls.length,calls);
});

test("a crash after publication but before its checkpoint leaves dispatching and blocks every replay",async()=>{
  const h=harness();h.failures.set(3,"before");
  const failed=await runMetaStorySequence(h.options);
  assert.equal(failed.ok,false);assert.equal(failed.certainty,"unknown");assert.equal(failed.retryable,false);
  assert.deepEqual(failed.remoteIds,["remote-story-0"],"The response retains the native confirmation already received");
  assert.equal((h.getSaved() as MetaStorySequenceState).items[0].status,"dispatching");
  const replay=await runMetaStorySequence(h.options);
  assert.equal(replay.certainty,"unknown");assert.equal(replay.state?.items[0].status,"unknown");
  assert.deepEqual(h.calls.map(call=>call.index),[0]);
  assert.equal((h.getSaved() as MetaStorySequenceState).items[0].status,"unknown");
});

test("a lost write acknowledgement can resume only after durable published evidence is loaded",async()=>{
  const h=harness();h.failures.set(3,"after");
  const failed=await runMetaStorySequence(h.options);assert.equal(failed.ok,false);assert.equal(h.calls.length,1);
  assert.equal((h.getSaved() as MetaStorySequenceState).items[0].status,"published");
  const replay=await runMetaStorySequence(h.options);assert.equal(replay.ok,true);
  assert.deepEqual(h.calls.map(call=>call.index),[0,1,2,3,4]);
});

test("failed reads, initial writes and dispatch writes have zero native effects",async()=>{
  const unreadable=harness();
  const result=await runMetaStorySequence({...unreadable.options,load:async()=>{throw Error("DB read failed")}});
  assert.equal(result.ok,false);assert.equal(unreadable.calls.length,0);assert.equal(unreadable.persistCount,0);
  for(const write of [1,2]){
    const h=harness();h.failures.set(write,"before");const failed=await runMetaStorySequence(h.options);
    assert.equal(failed.ok,false);assert.equal(h.calls.length,0);assert.equal(failed.retryable,false);
  }
  const nullAck=harness();
  assert.equal((await runMetaStorySequence({...nullAck.options,persist:async()=>null as never})).ok,false);
  assert.equal(nullAck.calls.length,0);
});

test("a failed persistence of a certain failure cannot reopen its stale dispatching checkpoint",async()=>{
  const h=harness();h.failures.set(3,"before");h.setNative(async()=>({ok:false,certainty:"not_published",retryable:true}));
  const failed=await runMetaStorySequence(h.options);assert.equal(failed.certainty,"unknown");assert.equal(failed.retryable,false);
  await runMetaStorySequence(h.options);assert.equal(h.calls.length,1);
});

test("order, source, account and target changes refuse the checkpoint before any new native operation",async()=>{
  const h=harness();await runMetaStorySequence(h.options);const calls=h.calls.length,persists=h.persistCount;
  for(const changed of [
    {...h.options,sources:[...sources].reverse()},
    {...h.options,sources:[sources[0],sources[1],"account/media/replacement.png",sources[3],sources[4]]},
    {...h.options,scopeKey:"other-account:checkpoint-uuid:instagram:remote-account:target-story"},
    {...h.options,scopeKey:"account:checkpoint-uuid:facebook:other-page:target-story"},
  ]){
    const failed=await runMetaStorySequence(changed);assert.equal(failed.ok,false);assert.equal(failed.retryable,false);
    assert.equal(h.calls.length,calls);assert.equal(h.persistCount,persists);
  }
});

test("malformed state, inconsistent item order, forged IDs and unknown fields all fail closed",async()=>{
  const h=harness();await runMetaStorySequence(h.options);const valid=h.getSaved() as MetaStorySequenceState;
  const missingId=copy(valid);delete missingId.items[0].remoteId;
  const duplicateId=copy(valid);duplicateId.items[1].remoteId=duplicateId.items[0].remoteId;
  const laterPublished=copy(valid);laterPublished.items[0]={index:0,source:sources[0],status:"queued"};
  const wrongIndex=copy(valid);wrongIndex.items[1].index=4;
  const wrongStatus=copy(valid) as unknown as {items:Array<{status:unknown;remoteId?:string}>};wrongStatus.items[0].status=["queued"];delete wrongStatus.items[0].remoteId;
  const calls=h.calls.length,persists=h.persistCount;
  for(const saved of [false,{},[],{...valid,version:2},{...valid,scopeKey:"forged"},missingId,duplicateId,laterPublished,wrongIndex,wrongStatus,{...valid,items:valid.items.slice(0,4)}]){
    h.setSaved(saved);const failed=await runMetaStorySequence(h.options);
    assert.equal(failed.ok,false);assert.equal(h.calls.length,calls);assert.equal(h.persistCount,persists);
  }
});

test("invalid or repeated native IDs are uncertain rather than false completed stories",async()=>{
  for(const native of [{ok:true,remoteId:""},{ok:true},{ok:false,certainty:"not_published"}]){
    const h=harness();h.setNative(async()=>native as MetaStoryNativeResult);
    const failed=await runMetaStorySequence(h.options);assert.equal(failed.ok,false);assert.equal(failed.certainty,"unknown");assert.equal(failed.retryable,false);
    await runMetaStorySequence(h.options);assert.equal(h.calls.length,1);
  }
  const h=harness();h.setNative(async()=>({ok:true,remoteId:"same-native-id"}));
  const failed=await runMetaStorySequence(h.options);assert.equal(failed.publishedCount,1);assert.equal(failed.state?.items[1].status,"unknown");
  await runMetaStorySequence(h.options);assert.equal(h.calls.length,2);
});

test("terminal certain failures remain terminal and malformed source lists never load or persist",async()=>{
  const h=harness();h.setNative(async()=>({ok:false,certainty:"not_published",retryable:false,error:"Permission refusée"}));
  const failed=await runMetaStorySequence(h.options);assert.equal(failed.retryable,false);assert.equal(failed.certainty,"not_published");
  await runMetaStorySequence(h.options);assert.equal(h.calls.length,1);
  for(const selected of [[],[...sources,"account/media/sixth.png"],[""],["file\u0000.png"],[" spaced.png"]]){
    let touched=0;
    const invalid=await runMetaStorySequence({scopeKey,sources:selected,load:async()=>{touched++;return null},persist:async()=>{touched++},publish:async()=>{touched++;return {ok:true,remoteId:"forbidden"}}});
    assert.equal(invalid.ok,false);assert.equal(touched,0);
  }
});

test("persistence callbacks cannot mutate the runner state or its source order",async()=>{
  const h=harness();const persist=h.options.persist;
  const completed=await runMetaStorySequence({...h.options,persist:async state=>{await persist(state);state.items.reverse();state.fingerprint="mutated";state.items[0].source="mutated"}});
  assert.equal(completed.ok,true);assert.deepEqual(h.calls.map(call=>call.source),sources);
  assert.deepEqual(completed.state?.items.map(item=>item.source),sources);
});

test("even simultaneous resumptions of an old dispatching checkpoint never call the publisher",async()=>{
  const h=harness();await runMetaStorySequence(h.options);h.setSaved(h.snapshots[1]);
  const calls=h.calls.length;
  const results=await Promise.all([runMetaStorySequence(h.options),runMetaStorySequence(h.options)]);
  assert.ok(results.every(result=>!result.ok&&result.certainty==="unknown"&&result.retryable===false));
  assert.equal(h.calls.length,calls);
});

test("an exhausted budget leaves pending items queued and resumes without duplicating confirmed stories",async()=>{
  const h=harness();
  const paused=await runMetaStorySequence({...h.options,canStartWork:()=>h.calls.length<2});
  assert.equal(paused.ok,false);assert.equal(paused.certainty,"not_published");assert.equal(paused.retryable,true);
  assert.equal(paused.publishedCount,2);assert.equal(h.persistCount,5);
  assert.deepEqual(paused.state?.items.map(item=>item.status),["published","published","queued","queued","queued"]);
  assert.deepEqual(h.getSaved(),paused.state);
  const completed=await runMetaStorySequence({...h.options,canStartWork:()=>true});
  assert.equal(completed.ok,true);assert.deepEqual(h.calls.map(call=>call.index),[0,1,2,3,4]);
  for(const canStartWork of [()=>false,()=>{throw Error("Budget unavailable")}]){
    const fresh=harness();const stopped=await runMetaStorySequence({...fresh.options,canStartWork});
    assert.equal(stopped.certainty,"not_published");assert.equal(stopped.retryable,true);assert.equal(fresh.calls.length,0);
    assert.ok(fresh.snapshots.every(state=>state.items.every(item=>item.status==="queued")));
  }
  const unknown=harness();await runMetaStorySequence(unknown.options);unknown.setSaved(unknown.snapshots[1]);
  const stopped=await runMetaStorySequence({...unknown.options,canStartWork:()=>false});
  assert.equal(stopped.certainty,"unknown");assert.equal(stopped.retryable,false,"A budget guard must not reopen an old ambiguous dispatch");
});
