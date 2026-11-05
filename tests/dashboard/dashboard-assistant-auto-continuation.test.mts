import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./dashboard-assistant-runtime-harness.mts";
import { runInrAssistantUiActions } from "../../lib/inrAssistantUiActions.ts";
import { getInrAssistantNavigation } from "../../lib/inrAssistantUiCommands.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const action = {id:"open_studio",type:"navigate" as const,navigation:getInrAssistantNavigation("studio")!};

test("a real Basic Session resumes a saved task after confirmed UI receipts without a Continue click", async () => {
  const previous=globalThis.fetch,view=harness(),events:string[]=[];
  let chats=0;
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(String(url).endsWith("/ui-results")) { events.push(body.action==="claim"?"claim":"receipt");return Response.json({ok:true}); }
    chats++;events.push(chats===1?"start":"continue");
    if(chats===1)return Response.json({accountId:"account-a",message:"Ouverture demandée",uiActions:[action],uiReceiptToken:"signed",autoContinueAfterUi:true,taskProgress:{outcome:"partial",completed:[],remaining:["ouvrir Studio","appliquer le cadrage"]}});
    assert.equal(body.taskIntent,"continue");
    assert.equal(body.autoContinueAfterUi,undefined,"The scheduling hint cannot be supplied as authority");
    return Response.json({accountId:"account-a",message:"Le résultat final a été relu.",outcome:"completed"});
  };
  view.onUiActions((actions,onResult,beforeAction)=>runInrAssistantUiActions(actions,{isCurrent:()=>true,navigate:async()=>{events.push("mounted");return true;},command:async()=>assert.fail(),onResult,beforeAction}));
  try { view.submit("Ouvre Studio puis applique le cadrage demandé");await tick();await tick();assert.equal(chats,2);assert.deepEqual(events,["start","claim","mounted","receipt","continue"]); }
  finally { view.cleanup();globalThis.fetch=previous; }
});

test("a failed native action or failed receipt never triggers an automatic next request", async()=>{
  const previous=globalThis.fetch;
  try {
    for(const successfulAction of [false,true]){
      const view=harness();let chats=0;
      globalThis.fetch=async(url,init)=>{
        if(String(url).endsWith("/ui-results")){const body=JSON.parse(String(init?.body));return Response.json({ok:body.action==="claim"},{status:body.action==="claim"?200:503});}
        chats++;return Response.json({accountId:"account-a",message:"Ouverture",uiActions:[action],uiReceiptToken:"signed",autoContinueAfterUi:true,taskProgress:{outcome:"partial",completed:[],remaining:["étape restante"]}});
      };
      view.onUiActions((actions,onResult,beforeAction)=>runInrAssistantUiActions(actions,{isCurrent:()=>true,navigate:async()=>successfulAction,command:async()=>assert.fail(),onResult,beforeAction}));
      try{view.submit("Ouvre Studio puis continue");await tick();await tick();assert.equal(chats,1);}
      finally{view.cleanup();}
    }
  }finally{globalThis.fetch=previous;}
});
