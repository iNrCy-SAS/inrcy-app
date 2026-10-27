import "server-only";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import { buildInstagramGraphUrl, type InstagramAuthMode } from "@/lib/instagramAuthMode";
import { isMetaAuthorizationError } from "@/lib/metaGraphErrorClassification";

export type MetaPhotoStoryNativeResult =
  | { ok: true; remoteId: string }
  | { ok: false; certainty: "not_published" | "unknown"; retryable: boolean; error: string; authorizationError?: boolean };

type Dependencies = { fetchImpl?: typeof fetch; sleepImpl?: (milliseconds: number) => Promise<void> };
type Context = { channel: "facebook" | "instagram"; remoteAccountId: string; accessToken: string; authMode?: InstagramAuthMode; imageUrl: string; deadlineAt?: number; signal?: AbortSignal };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const remoteId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,180}$/.test(value) ? value : "";

/** Publish exactly one native photo Story. Container/photo preparation never
 * publishes a Story; only its final POST is an irreversible remote operation. */
export async function publishMetaPhotoStory(args: Context, dependencies: Dependencies = {}): Promise<MetaPhotoStoryNativeResult> {
  let publishing = false;
  const deadlineAt = Math.min(args.deadlineAt || Infinity, Date.now() + 60_000);
  const call = dependencies.fetchImpl || fetch;
  const fail = (error: string, certainty: "not_published" | "unknown", retryable: boolean, authorizationError = false): MetaPhotoStoryNativeResult => ({ ok: false, error, certainty, retryable, authorizationError });
  const graph = (path: string) => args.channel === "instagram" ? buildInstagramGraphUrl(path, args.authMode) : buildMetaGraphUrl(path);
  const request = async (path: string, values: Record<string, string>, method: "GET" | "POST" = "POST") => {
    const body = new URLSearchParams({ ...values, access_token: args.accessToken });
    const remaining = deadlineAt - Date.now();
    if (remaining < 1_000) throw new Error("meta_story_deadline");
    const timeout = AbortSignal.timeout(Math.min(method === "GET" ? 15_000 : 45_000, remaining));
    const response = await call(`${graph(path)}${method === "GET" ? `?${body}` : ""}`, { method, cache: "no-store", signal: args.signal ? AbortSignal.any([args.signal, timeout]) : timeout, ...(method === "POST" ? { body } : {}) });
    const payload = record(await response.json().catch(() => null));
    const error = record(payload.error);
    return { response, payload, message: typeof error.message === "string" ? error.message.slice(0, 800) : "La Story n’a pas pu être publiée.", authorizationError: isMetaAuthorizationError({ ...error, httpStatus: response.status }) };
  };
  try {
    const image = new URL(args.imageUrl);
    if (!remoteId(args.remoteAccountId) || !args.accessToken || image.protocol !== "https:" || image.username || image.password) return fail("Les informations de la photo Story sont incomplètes.", "not_published", false);
    const prepared = await request(`${encodeURIComponent(args.remoteAccountId)}/${args.channel === "facebook" ? "photos" : "media"}`, args.channel === "facebook" ? { url: args.imageUrl, published: "false" } : { media_type: "STORIES", image_url: args.imageUrl });
    if (!prepared.response.ok || prepared.payload.error || prepared.payload.success === false) return fail(prepared.message, "not_published", true, prepared.authorizationError);
    const preparedId = remoteId(prepared.payload.id);
    if (!preparedId) return fail("La préparation de la photo Story n’a pas été confirmée.", "not_published", true);
    if (args.channel === "instagram") {
      let ready = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const state = await request(encodeURIComponent(preparedId), { fields: "status_code" }, "GET");
        if (!state.response.ok || state.payload.error || state.payload.success === false) return fail(state.message, "not_published", true, state.authorizationError);
        if (state.payload.status_code === "FINISHED") { ready = true; break; }
        if (["ERROR", "EXPIRED"].includes(String(state.payload.status_code))) return fail("Instagram a refusé la préparation de cette photo Story.", "not_published", true);
        if (state.payload.status_code === "PUBLISHED") return fail("La publication de ce conteneur Story doit être vérifiée dans Instagram.", "unknown", false);
        if (attempt < 4) await (dependencies.sleepImpl || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(1_000);
      }
      if (!ready) return fail("La photo Story est encore en préparation dans Instagram. Aucune nouvelle Story n’est confirmée.", "not_published", true);
    }
    if (args.signal?.aborted || Date.now() >= deadlineAt - 5_000) return fail("La préparation a atteint son délai. La Story n’a pas été publiée ; la séquence peut être reprise.", "not_published", true);
    publishing = true;
    const published = await request(`${encodeURIComponent(args.remoteAccountId)}/${args.channel === "facebook" ? "photo_stories" : "media_publish"}`, args.channel === "facebook" ? { photo_id: preparedId } : { creation_id: preparedId });
    const id = remoteId(args.channel === "facebook" ? published.payload.post_id : published.payload.id);
    if (!published.response.ok) {
      const certainRejection = !id && published.response.status >= 400 && published.response.status < 500 && published.response.status !== 408;
      return fail(published.message, certainRejection ? "not_published" : "unknown", certainRejection, published.authorizationError);
    }
    if (!id || published.payload.error || published.payload.success === false) return fail("La réponse de publication de la Story est incomplète. Vérifiez-la sur le réseau avant toute nouvelle tentative.", "unknown", false);
    return { ok: true, remoteId: id };
  } catch {
    return fail(publishing ? "La publication de la Story n’a pas encore pu être vérifiée. Vérifiez le réseau avant de réessayer." : "La photo Story n’a pas pu être préparée. Aucune Story n’a été publiée par cette tentative.", publishing ? "unknown" : "not_published", !publishing);
  }
}

export type MetaVideoStoryNativeResult = MetaPhotoStoryNativeResult;
type VideoContext = Omit<Context,"imageUrl"> & {
  videoUrl: string;
  tokenCandidates?: readonly {source?: string; accessToken: string}[];
  preparedId?: string;
  onPrepared?: (id: string | null) => Promise<void>;
  onPublishStarting?: () => Promise<void>;
};

/** Native video staging is reversible: an uploaded Facebook video or Instagram
 * container is not a published Story. The caller durably saves its prepared ID
 * and the imminent irreversible commit through the required callbacks. */
export async function publishMetaVideoStory(args: VideoContext, dependencies: Dependencies = {}): Promise<MetaVideoStoryNativeResult> {
  const deadlineAt=Math.min(args.deadlineAt??Infinity,Date.now()+60_000);
  const tokens=[args.accessToken];
  if(args.channel==="instagram"&&args.authMode!=="instagram_login"&&Array.isArray(args.tokenCandidates)){
    for(const candidate of args.tokenCandidates.slice(0,5))if(candidate&&typeof candidate.accessToken==="string"&&candidate.accessToken.trim()&&!tokens.includes(candidate.accessToken))tokens.push(candidate.accessToken);
  }
  let preparedId=args.preparedId;
  const onPrepared=typeof args.onPrepared==="function"?async(id:string|null)=>{
    const acknowledgement:unknown=await args.onPrepared!(id);
    if(acknowledgement!==undefined)throw new Error("meta_story_checkpoint_unconfirmed");
    preparedId=id??undefined;
  }:undefined;
  let result:MetaVideoStoryNativeResult={ok:false,certainty:"not_published",retryable:false,error:"Aucun jeton de publication valide n’a été fourni."};
  for(const accessToken of tokens){
    result=await publishMetaVideoStoryWithToken({...args,accessToken,preparedId,onPrepared,deadlineAt},dependencies);
    if(result.ok||result.certainty!=="not_published"||result.authorizationError!==true)return result;
  }
  return result;
}

async function publishMetaVideoStoryWithToken(args: VideoContext, dependencies: Dependencies): Promise<MetaVideoStoryNativeResult> {
  let publishing = false;
  const deadlineAt = Math.min(args.deadlineAt ?? Infinity, Date.now()+60_000);
  const call = dependencies.fetchImpl || fetch;
  const fail = (error:string,certainty:"not_published"|"unknown",retryable:boolean,authorizationError=false):MetaVideoStoryNativeResult => ({ok:false,error,certainty,retryable,authorizationError});
  const hasBudget = () => !args.signal?.aborted && Date.now() < deadlineAt-5_000;
  const graph = (path:string) => args.channel === "instagram" ? buildInstagramGraphUrl(path,args.authMode) : buildMetaGraphUrl(path);
  const acknowledge = async (work:Promise<void>) => { const value:unknown=await work; if(value!==undefined)throw new Error("meta_story_checkpoint_unconfirmed"); };
  const request = async (url:string,init:RequestInit,commit=false) => {
    args.signal?.throwIfAborted();
    const remaining=deadlineAt-Date.now();
    if(remaining<1_000)throw new Error("meta_story_deadline");
    const timeout=AbortSignal.timeout(Math.min(init.method==="GET"?15_000:45_000,remaining));
    if(commit)publishing=true;
    const response=await call(url,{...init,cache:"no-store",redirect:"error",signal:args.signal?AbortSignal.any([args.signal,timeout]):timeout});
    const payload=record(await response.json().catch(()=>null)),error=record(payload.error);
    return {response,payload,message:typeof error.message==="string"?error.message.slice(0,800):"La Story vidéo n’a pas pu être publiée.",authorizationError:response.status<500&&response.status!==408&&isMetaAuthorizationError({...error,httpStatus:response.status})};
  };
  const graphRequest = (path:string,values:Record<string,string>,method:"GET"|"POST"="POST",commit=false) => {
    const body=new URLSearchParams({...values,access_token:args.accessToken});
    return request(`${graph(path)}${method==="GET"?`?${body}`:""}`,{method,...(method==="POST"?{body}:{})},commit);
  };
  try {
    const video=new URL(args.videoUrl);
    if(!["facebook","instagram"].includes(args.channel)||!remoteId(args.remoteAccountId)||typeof args.accessToken!=="string"||!args.accessToken.trim()||
      typeof args.videoUrl!=="string"||args.videoUrl.length>8192||/[\u0000-\u0020\u007f]/.test(args.videoUrl)||video.protocol!=="https:"||video.username||video.password||video.hash||
      args.authMode!==undefined&&!["facebook_login","instagram_login"].includes(args.authMode)||args.deadlineAt!==undefined&&!Number.isFinite(args.deadlineAt)||
      args.preparedId!==undefined&&!remoteId(args.preparedId)||typeof args.onPrepared!=="function"||typeof args.onPublishStarting!=="function") {
      return fail("Les informations ou le suivi durable de la Story vidéo sont incomplets.","not_published",false);
    }
    if(!hasBudget())return fail("Le délai disponible ne permet pas de préparer cette Story vidéo. Reprenez la même séquence.","not_published",true);
    let preparedId=args.preparedId||"";
    if(!preparedId){
      const prepared=await graphRequest(`${encodeURIComponent(args.remoteAccountId)}/${args.channel==="facebook"?"video_stories":"media"}`,args.channel==="facebook"?{upload_phase:"start"}:{media_type:"STORIES",video_url:args.videoUrl});
      if(!prepared.response.ok||prepared.payload.error||prepared.payload.success===false)return fail(prepared.message,"not_published",true,prepared.authorizationError);
      preparedId=remoteId(args.channel==="facebook"?prepared.payload.video_id:prepared.payload.id);
      if(!preparedId)return fail("La préparation de la Story vidéo n’a pas été confirmée.","not_published",true);
      if(args.channel==="facebook"){
        let upload:URL;
        try{upload=new URL(String(prepared.payload.upload_url||""))}catch{return fail("Facebook n’a pas confirmé une destination de transfert valide.","not_published",true)}
        if(upload.protocol!=="https:"||upload.hostname!=="rupload.facebook.com"||upload.port||upload.username||upload.password||upload.hash||!upload.pathname.startsWith("/video-upload/")||!upload.pathname.endsWith(`/${preparedId}`))return fail("La destination de transfert vidéo Facebook n’est pas autorisée.","not_published",false);
        const transferred=await request(upload.href,{method:"POST",headers:{Authorization:`OAuth ${args.accessToken}`,file_url:args.videoUrl}});
        if(!transferred.response.ok||transferred.payload.error||transferred.payload.success!==true)return fail(transferred.message,"not_published",true,transferred.authorizationError);
      }
      await acknowledge(args.onPrepared(preparedId));
    }
    if(args.channel==="instagram"){
      let ready=false;
      while(hasBudget()){
        const state=await graphRequest(encodeURIComponent(preparedId),{fields:"status_code"},"GET");
        if(!state.response.ok||state.payload.error||state.payload.success===false)return fail(state.message,"not_published",true,state.authorizationError);
        if(state.payload.status_code==="FINISHED"){ready=true;break}
        if(["ERROR","EXPIRED"].includes(String(state.payload.status_code))){
          await acknowledge(args.onPrepared(null));
          return fail("Instagram a refusé ou expiré la préparation de cette Story vidéo. Elle peut être préparée à nouveau.","not_published",true);
        }
        if(state.payload.status_code==="PUBLISHED")return fail("Ce conteneur Story a déjà été publié. Vérifiez Instagram avant toute nouvelle tentative.","unknown",false);
        const wait=Math.min(2_000,deadlineAt-Date.now()-5_000);
        if(wait<=0)break;
        await (dependencies.sleepImpl||((milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds))))(wait);
      }
      if(!ready)return fail("La Story vidéo est encore en préparation. Reprenez la même séquence pour vérifier son état sans la recréer.","not_published",true);
    }
    if(!hasBudget())return fail("Le délai disponible est atteint. La Story vidéo n’a pas été publiée et sa préparation reste réutilisable.","not_published",true);
    await acknowledge(args.onPublishStarting());
    if(!hasBudget())return fail("Le délai disponible est atteint avant l’envoi. Reprenez la même séquence.","not_published",true);
    const published=await graphRequest(`${encodeURIComponent(args.remoteAccountId)}/${args.channel==="facebook"?"video_stories":"media_publish"}`,args.channel==="facebook"?{upload_phase:"finish",video_id:preparedId}:{creation_id:preparedId},"POST",true);
    const id=remoteId(args.channel==="facebook"?published.payload.post_id:published.payload.id);
    if(!published.response.ok){
      const certain=!id&&published.payload.success!==true&&published.response.status>=400&&published.response.status<500&&published.response.status!==408;
      return fail(published.message,certain?"not_published":"unknown",certain,published.authorizationError);
    }
    if(published.payload.error||published.payload.success===false||(!id&&!(args.channel==="facebook"&&published.payload.success===true)))return fail("La réponse de publication de la Story vidéo est incomplète. Vérifiez le réseau avant toute reprise.","unknown",false);
    return {ok:true,remoteId:id||preparedId};
  }catch{
    return fail(publishing?"La publication de cette Story vidéo ne peut pas être confirmée. Vérifiez le réseau avant toute reprise.":"La Story vidéo n’a pas été publiée par cette tentative. Sa préparation pourra être reprise.",publishing?"unknown":"not_published",!publishing);
  }
}
