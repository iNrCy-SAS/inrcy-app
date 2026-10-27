import { createHash } from "node:crypto";

export type MetaStoryNativeResult =
  | { ok: true; remoteId: string }
  | { ok: false; certainty: "not_published" | "unknown"; retryable: boolean; error?: string };

type StoryItem = {
  index: number;
  source: string;
  status: "queued" | "dispatching" | "published" | "failed" | "unknown";
  remoteId?: string;
  retryable?: boolean;
  error?: string;
};
export type MetaStorySequenceState = { version: 1; fingerprint: string; items: StoryItem[] };
export type MetaStorySequenceResult = {
  ok: boolean;
  state?: MetaStorySequenceState;
  remoteIds: string[];
  publishedCount: number;
  expectedCount: number;
  certainty?: "not_published" | "unknown";
  retryable?: boolean;
  error?: string;
};
export type NativeResult = MetaStoryNativeResult;
export type SequenceState = MetaStorySequenceState;

const controls = /[\u0000-\u001f\u007f]/;
const validRemoteId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_:-]{1,300}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const clone = (state: MetaStorySequenceState): MetaStorySequenceState => ({ ...state, items: state.items.map(item => ({ ...item })) });
const errorText = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,500) : fallback;

function validSources(sources: readonly string[]): boolean {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 5) return false;
  return sources.every(source => typeof source === "string" && Boolean(source) && source.length <= 4096 && source === source.trim() && !controls.test(source));
}

function parseState(value: unknown, fingerprint: string, sources: readonly string[]): MetaStorySequenceState | null {
  try {
    if (!record(value) || Object.keys(value).some(key => !["version","fingerprint","items"].includes(key)) || value.version !== 1 || value.fingerprint !== fingerprint || !Array.isArray(value.items) || value.items.length !== sources.length) return null;
    const items: StoryItem[] = [], ids = new Set<string>();
    let unfinished = false;
    for (let index=0;index<sources.length;index++) {
      const item: unknown = value.items[index];
      if (!record(item) || Object.keys(item).some(key => !["index","source","status","remoteId","retryable","error"].includes(key)) || item.index !== index || item.source !== sources[index] || typeof item.status !== "string" || !["queued","dispatching","published","failed","unknown"].includes(item.status) ||
        item.error !== undefined && (typeof item.error !== "string" || item.error.length > 500 || controls.test(item.error))) return null;
      const status = item.status as StoryItem["status"];
      if (status === "published") {
        if (unfinished || !validRemoteId(item.remoteId) || ids.has(item.remoteId) || item.retryable !== undefined || item.error !== undefined) return null;
        ids.add(item.remoteId);
      } else {
        if (unfinished && status !== "queued" || item.remoteId !== undefined) return null;
        unfinished = true;
        if (status === "failed" ? typeof item.retryable !== "boolean" : status === "unknown" ? item.retryable !== false : item.retryable !== undefined || item.error !== undefined) return null;
      }
      items.push({ index, source:sources[index], status,
        ...(status === "published" ? {remoteId:item.remoteId as string} : {}),
        ...(status === "failed" || status === "unknown" ? {retryable:item.retryable as boolean,...(typeof item.error === "string" ? {error:item.error} : {})} : {}),
      });
    }
    return {version:1,fingerprint,items};
  } catch { return null; }
}

/** The caller must hold the existing publication/worker lease throughout this
 * function. The scope is server-owned and must include account, publication,
 * channel, remote account and target identity. Sources are immutable media
 * identities (for example Storage paths), in publication order. The caller
 * binds the corresponding currently validated Meta URLs inside publish().
 * A zero-based index is passed to the native publisher. No DB or API is used
 * here: durable reads/writes and the native publisher are injected by caller. */
export async function runMetaStorySequence(options: {
  scopeKey: string;
  sources: readonly string[];
  load: () => Promise<unknown>;
  persist: (state: MetaStorySequenceState) => Promise<void>;
  publish: (source: string, index: number) => Promise<MetaStoryNativeResult>;
  canStartWork?: () => boolean;
}): Promise<MetaStorySequenceResult> {
  const sources = Array.isArray(options.sources) ? [...options.sources] : [];
  const expectedCount = sources.length;
  let state: MetaStorySequenceState | undefined;
  const result = (fields: Pick<MetaStorySequenceResult,"ok"> & Partial<MetaStorySequenceResult>): MetaStorySequenceResult => {
    const remoteIds = state?.items.flatMap(item => item.status === "published" && item.remoteId ? [item.remoteId] : []) ?? [];
    return {...fields,...(state ? {state:clone(state)} : {}),remoteIds,publishedCount:remoteIds.length,expectedCount};
  };
  if (typeof options.scopeKey !== "string" || !options.scopeKey || options.scopeKey.length > 2048 || options.scopeKey !== options.scopeKey.trim() || controls.test(options.scopeKey) || !validSources(sources)) {
    return result({ok:false,certainty:"not_published",retryable:false,error:"La séquence doit contenir de une à cinq images et un périmètre de publication valide."});
  }
  const fingerprint = createHash("sha256").update(JSON.stringify([options.scopeKey,sources])).digest("hex");
  let saved: unknown;
  try { saved = await options.load(); }
  catch { return result({ok:false,certainty:"unknown",retryable:false,error:"Impossible de lire l’avancement des stories. Aucun nouvel envoi n’a été tenté."}); }
  const persist = async () => {
    // Only a fulfilled void acknowledgement counts as durable confirmation.
    // A null/false DB result must never silently authorize a native call.
    const acknowledgement: unknown = await options.persist(clone(state!));
    if (acknowledgement !== undefined) throw new Error("Story checkpoint was not acknowledged");
  };
  if (saved === null || saved === undefined) {
    state = {version:1,fingerprint,items:sources.map((source,index)=>({index,source,status:"queued"}))};
    try { await persist(); }
    catch { return result({ok:false,certainty:"not_published",retryable:false,error:"L’avancement des stories ne peut pas être enregistré. Aucun nouvel envoi n’a été tenté."}); }
  } else {
    state = parseState(saved,fingerprint,sources) ?? undefined;
    if (!state) return result({ok:false,certainty:"unknown",retryable:false,error:"L’avancement enregistré ne correspond pas à ces images ou à ce compte. Vérifiez les stories avant toute nouvelle tentative."});
  }
  for (let index=0;index<state.items.length;index++) {
    const item = state.items[index];
    if (item.status === "published") continue;
    if (item.status === "dispatching") {
      state.items[index] = {...item,status:"unknown",retryable:false,error:"Une tentative précédente a pu publier cette story. Vérifiez son état avant de reprendre."};
      try { await persist(); } catch { /* The saved dispatching checkpoint also blocks replay. */ }
      return result({ok:false,certainty:"unknown",retryable:false,error:state.items[index].error});
    }
    if (item.status === "unknown" || item.status === "failed" && !item.retryable) return result({ok:false,certainty:item.status === "unknown"?"unknown":"not_published",retryable:false,error:item.error ?? "Cette story doit être vérifiée avant de reprendre."});
    let canStart = true;
    try { canStart = options.canStartWork ? options.canStartWork() === true : true; } catch { canStart = false; }
    if (!canStart) return result({ok:false,certainty:"not_published",retryable:true,error:"Le délai de cette tentative est atteint. Reprenez la même séquence pour terminer les Stories restantes."});
    state.items[index] = {index,source:sources[index],status:"dispatching"};
    try { await persist(); }
    catch { return result({ok:false,certainty:"unknown",retryable:false,error:"La tentative ne peut pas être enregistrée. Aucun nouvel envoi n’a été tenté."}); }
    let native: MetaStoryNativeResult;
    try { native = await options.publish(sources[index],index); }
    catch { native = {ok:false,certainty:"unknown",retryable:false,error:"Le résultat de l’envoi de cette story est inconnu. Vérifiez-la avant toute nouvelle tentative."}; }
    if (record(native) && native.ok === true && validRemoteId(native.remoteId) && !state.items.some(previous=>previous.status === "published" && previous.remoteId === native.remoteId)) {
      state.items[index] = {index,source:sources[index],status:"published",remoteId:native.remoteId};
      try { await persist(); }
      catch { return result({ok:false,certainty:"unknown",retryable:false,error:"Une story a été publiée mais son enregistrement n’a pas été confirmé. Aucun autre envoi n’a été tenté."}); }
      continue;
    }
    const failure = record(native) && native.ok === false ? native : null;
    const certain = failure?.certainty === "not_published" && typeof failure.retryable === "boolean";
    const retryable = certain && failure?.retryable === true;
    const error = errorText(failure?.error,certain ? "Cette story n’a pas été publiée." : "Le résultat de cette story est inconnu. Vérifiez-la avant toute nouvelle tentative.");
    state.items[index] = {index,source:sources[index],status:certain?"failed":"unknown",retryable,error};
    try { await persist(); }
    catch { return result({ok:false,certainty:"unknown",retryable:false,error:"L’état de cette tentative ne peut pas être confirmé. Vérifiez la story avant de reprendre."}); }
    return result({ok:false,certainty:certain?"not_published":"unknown",retryable,error});
  }
  return result({ok:true});
}
