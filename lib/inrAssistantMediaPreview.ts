import { inrAssistantMaskQuotedText, inrAssistantUnquotedRequest, inrAssistantRequestClauses, inrAssistantClauseIsAdvice } from "./inrAssistantRequestClauses.ts";
import { hasInrAssistantDeferredApproval } from "./inrAssistantActionClause.ts";
type Copy = { label: string; keep: string; discard: string; keepRequest: string; discardRequest: string };
const COPY: Record<string, Copy> = {
  fr:{label:"Aperçu prêt, pas encore enregistré.",keep:"Conserver ce média",discard:"Écarter cet aperçu",keepRequest:"Enregistre cet aperçu dans mes médias.",discardRequest:"Écarte cet aperçu généré."},
  en:{label:"Preview ready, not saved yet.",keep:"Keep this media",discard:"Discard this preview",keepRequest:"Save this preview to my media.",discardRequest:"Discard this generated preview."},
  es:{label:"Vista previa lista, aún sin guardar.",keep:"Guardar este medio",discard:"Descartar esta vista previa",keepRequest:"Guarda esta vista previa en mis medios.",discardRequest:"Descarta esta vista previa generada."},
  it:{label:"Anteprima pronta, non ancora salvata.",keep:"Conserva questo media",discard:"Scarta questa anteprima",keepRequest:"Salva questa anteprima nei miei media.",discardRequest:"Scarta questa anteprima generata."},
  de:{label:"Vorschau bereit, noch nicht gespeichert.",keep:"Medium speichern",discard:"Vorschau verwerfen",keepRequest:"Speichere diese Vorschau in meinen Medien.",discardRequest:"Verwirf diese erstellte Vorschau."},
  nl:{label:"Voorbeeld gereed, nog niet opgeslagen.",keep:"Dit medium bewaren",discard:"Dit voorbeeld verwijderen",keepRequest:"Sla dit voorbeeld op in mijn media.",discardRequest:"Verwijder dit gegenereerde voorbeeld."},
  pt:{label:"Prévia pronta, ainda não guardada.",keep:"Guardar esta mídia",discard:"Descartar esta prévia",keepRequest:"Guarda esta prévia na minha biblioteca de mídia.",discardRequest:"Descarta esta prévia gerada."},
  th:{label:"ตัวอย่างพร้อมแล้ว ยังไม่ได้บันทึก",keep:"บันทึกสื่อนี้",discard:"ทิ้งตัวอย่างนี้",keepRequest:"บันทึกตัวอย่างนี้ในคลังสื่อของฉัน",discardRequest:"ทิ้งตัวอย่างที่สร้างนี้"},
  zh:{label:"预览已就绪，尚未保存。",keep:"保存此媒体",discard:"丢弃此预览",keepRequest:"将此预览保存到我的媒体库。",discardRequest:"丢弃此生成的预览。"},
};
export function inrAssistantMediaPreviewCopy(locale: string): Copy { return COPY[locale.toLowerCase().split(/[-_]/)[0]] || COPY.fr; }
/** Known localized button requests are explicit user choices, never a target or scope grant. */
export function isInrAssistantMediaPreviewButtonRequest(message: string, operation: "accept" | "discard"): boolean {
  const clean = inrAssistantMaskQuotedText(message).trim();
  return Object.values(COPY).some(copy => clean === (operation === "accept" ? copy.keepRequest : copy.discardRequest));
}

/** A refusal to publish or generate is separate from a current save decision.
 * This selects an intent only; the native tool still binds the exact owned job. */
export function isInrAssistantMediaPreviewDecisionRequest(message: string, operation: "accept" | "discard"): boolean {
  if (isInrAssistantMediaPreviewButtonRequest(message, operation)) return true;
  const current = inrAssistantUnquotedRequest(message);
  if (hasInrAssistantDeferredApproval(message) || /^(?:si|quand|lorsque|if|when|unless|imagine|suppose)\b/.test(current)) return false;
  const stems = operation === "accept" ? "(?:enregistr\\w*|sauvegard\\w*|conserv\\w*|accept\\w*|valid\\w*|save|keep|store)" : "(?:rejett\\w*|refus\\w*|jett\\w*|supprim\\w*|retir\\w*|ecart\\w*|abandon\\w*|discard|reject|remove)";
  if (new RegExp(`\\b(?:ne|n'|pas|jamais|sans|not|never|don't|do not)\\b.{0,45}\\b${stems}\\b|\\b${stems}\\s+(?:pas|jamais|not)\\b`).test(current)) return false;
  const verbs = {accept:"(?:enregistre(?:z|r)?|sauvegarde(?:z|r)?|conserve(?:z|r)?|accepte(?:z|r)?|valide(?:z|r)?|save|keep|store)",discard:"(?:rejette(?:z|r)?|refuse(?:z|r)?|jette(?:z|r)?|supprime(?:z|r)?|retire(?:z|r)?|ecarte(?:z|r)?|abandonne(?:z|r)?|discard|reject|remove)"};
  const affirmative = (clause: string, choice: "accept" | "discard") => !inrAssistantClauseIsAdvice(clause)
    && !/\b(?:demain|plus tard|pas maintenant|apres|avant|si|quand|lorsque|tomorrow|later|after|before|if|when)\b/.test(clause)
    && new RegExp(`^(?:(?:merci de|please|veuillez|peux-tu|pouvez-vous|can you|could you|je veux|je souhaite|je voudrais)\\s+)?${verbs[choice]}\\b`).test(clause)
    && /\b(?:brouillon|apercu|resultat|image|photo|video|media|creation|preview|draft)\b/.test(clause);
  const clauses=inrAssistantRequestClauses(message);
  return clauses.some(clause=>affirmative(clause,operation)) && !clauses.some(clause=>affirmative(clause,operation==="accept"?"discard":"accept"));
}

export type InrAssistantMediaPreviewReference = {status:"ready_to_save";draft:true;requestId:string;mediaId:string;mediaType?:"image"|"video";resultMode?:"save"|"preview"};
/** Recover only native identifiers, never a signed or private media URL. */
export function parseInrAssistantMediaPreviewReference(value:unknown):InrAssistantMediaPreviewReference|undefined {
  if(!value || typeof value!=="object" || Array.isArray(value))return;
  const row=value as Record<string,unknown>,media=row.media && typeof row.media==="object"?row.media as Record<string,unknown>:{};
  const mediaId=media.id??row.mediaId,kind=media.mediaType??row.mediaType;
  if(row.status!=="ready_to_save" || row.draft!==true || typeof row.requestId!=="string" || !/^[a-z0-9][a-z0-9_-]{7,179}$/i.test(row.requestId) || typeof mediaId!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(mediaId))return;
  return {status:"ready_to_save",draft:true,requestId:row.requestId,mediaId,...(kind==="image"||kind==="video"?{mediaType:kind}:{}),...(row.resultMode==="save"||row.resultMode==="preview"?{resultMode:row.resultMode}:{})};
}
