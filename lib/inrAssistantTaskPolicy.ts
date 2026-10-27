import { hasInrAssistantMediaSubject, permitsInrAssistantMediaAction } from "./inrAssistantMediaIntent.ts";
import { isInrAssistantStudioDraftRequest } from "./inrAssistantStudioDraft.ts";

export type InrAssistantTaskOutcome = "completed" | "partial" | "needs_input" | "processing" | "blocked" | "failed";
export type InrAssistantActionReceipt = { tool: string; ok: boolean; status: string; message: string; id?: string; draftId?: string; requestId?: string; scheduledActionId?: string; eventId?: string; recordId?: string; publicationId?: string; toolUrl?: string };
export type InrAssistantTaskState = {
  version: 1; instruction: string; actionRequestId: string; startedAt: string; expiresAt: string;
  outcome: InrAssistantTaskOutcome; requiredTools: string[]; requiredCalls?: Record<string, number>; receipts: InrAssistantActionReceipt[]; question: string;
};
export const INR_ASSISTANT_MAX_TRACKED_ACTIONS = 24;
const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Schema vocabulary only; executors independently authorize the original request. */
export function inrAssistantRoutingText(text: string): string {
  return normalize(text).replace(/\bcall.to.action\b/g, "cta")
    .replace(/\b(?:publicacion(?:es)?|beitrage?|beitrag|bijdrage|pubblicazioni?|publicacoes|veroffentlichung)\b/g, "publication")
    .replace(/\b(?:crea|crear|erstelle|erstellen|creare|cria|criar|maak|create)\b/g, "cree")
    .replace(/\b(?:publica|publicar|veroffentliche|pubblica|publish)\b/g, "publie")
    .replace(/\b(?:programa|programar|plane|planen|schedule)\b/g, "programme")
    .replace(/\b(?:telefono|telefon|phone)\b/g, "telephone")
    .replace(/\b(?:sitio web|webseite|website)\b/g, "site web")
    .replace(/\b(?:imagen(?:es)?|immagine|bild(?:er)?|imagem|afbeelding)\b/g, "image")
    .replace(/\b(?:boton|button|schaltflache)\b/g, "bouton")
    .replace(/\b(?:alle|todos|todas|all)\b/g, "tous").replace(/\b(?:canales|kanale|channels)\b/g, "canaux");
}
/** Business goals, distinct from their prerequisite reads. */
export function inrAssistantRequiredTools(message: string): string[] {
  if (isInrAssistantStudioDraftRequest(message)) return [];
  const normalized = inrAssistantRoutingText(message.replace(/```[\s\S]*?(?:```|$)|«[^»]*»|"[^"]*"|^>.*$/gm," ")).trim();
  if (/^(?:comment|pourquoi|explique|how|why|what|wie|como)\b/.test(normalized) || /\b(?:explique|explain|me dire)\b.{0,60}\b(?:comment|how|pourquoi|why)\b/.test(normalized)) return [];
  const clauseStart = "(?:(?:ne|not|never|do not)\\s+|n['’]|don't\\s+)?(?:ajout\\w*|cree\\w*|creer|gener\\w*|modifi\\w*|retouch\\w*|prepar\\w*|redig\\w*|publie\\w*|poste\\w*|envoi\\w*|configure\\w*|mets|renomm\\w*|archive\\w*|retrouv\\w*|recherch\\w*|consulte\\w*|verifi\\w*|create|generate|prepare|add|edit|publish|send|find|read)\\b";
  const clauses = normalized.split(new RegExp(`(?:\\s+(?:et\\s+(?:puis\\s+)?|puis\\s+|ensuite\\s+|and\\s+(?:then\\s+)?|then\\s+)|[,;.!?]\\s+)(?=${clauseStart})`, "i"));
  const mediaContext = hasInrAssistantMediaSubject(message, "image") || hasInrAssistantMediaSubject(message, "video");
  const required: string[] = [];
  let previousWasMail = false;
  for (const clause of clauses) {
    // Only an explicit object pronoun can inherit the immediately preceding
    // campaign. This is tracking vocabulary; executors still receive the exact
    // original request and independently verify its instruction and recipients.
    const mailPronoun = /^(?:envoi\w*|diffuse\w*|modifi\w*|corrig\w*|change\w*)(?:-(?:le|la|les)\b|\s+(?:le|la|les)(?=\s+(?:a|au|aux|pour|demain|maintenant)\b|[.!?;,:]|$))|^(?:send|edit|update)\s+(?:it|them)\b/.test(clause.trim());
    const inferredMail: boolean = previousWasMail && mailPronoun;
    required.push(...requiredToolsForClause(inferredMail ? `${clause} — campagne mail` : clause, mediaContext));
    const target = clause.match(/\b(?:campagnes?|e-?mails?|newsletters?|images?|photos?|videos?|visuels?|logos?|flyers?|affiches?|publications?|posts?|crm|contacts?|clients?|prospects?|devis|factures?|agenda|rendez.vous|rdv)\b/);
    previousWasMail = target ? /^(?:campagnes?|e-?mails?|newsletters?)$/.test(target[0]) && !/publicit|\bads\b/.test(clause) : inferredMail;
  }
  return [...new Set(required)];
}
function requiredToolsForClause(message: string, mediaContext: boolean): string[] {
  const t = inrAssistantRoutingText(message), result: string[] = [];
  if (/^(?:comment|pourquoi|explique|how|why|what|wie|como)\b/.test(t) || /\b(?:explique|explain|me dire)\b.{0,60}\b(?:comment|how|pourquoi|why)\b/.test(t)) return result;
  if (/^(?:ne\b|n['’]|not\b|never\b|don't\b|do not\b)/.test(t.trim()) || /\b(?:ne|sans|not|never)\b.{0,20}\b(?:modifi|cre|gener|publ|envoi)/.test(t)) return result;
  if (permitsInrAssistantMediaAction(message, "generate", "image") || permitsInrAssistantMediaAction(message, "generate", "video")) result.push("generateMedia");
  if (hasInrAssistantMediaSubject(message, "image") && permitsInrAssistantMediaAction(message, "modify")) result.push("modifyMedia");
  if (mediaContext && /\b(?:tags?|titre|metadata|metadonnees|archive\w*|renomm\w*)\b/.test(t) && /\b(?:ajout\w*|mets|modifi\w*|renomm\w*|archive\w*|masqu\w*|retire\w*|add|rename|update)\b/.test(t)) result.push("updateMediaMetadata");
  const publication = /\b(?:publication|post|booster|publie|publier|publish)\b/.test(t);
  const publicationObject = /\b(?:publication|post|booster)\b/.test(t);
  const publicationPurpose = /\b(?:pour|afin de|avant de|a)\s+(?:publier|poster|diffuser)\b/.test(t);
  if (publication && !publicationPurpose && /\b(?:publie\w*|publier|programme\w*|planifi\w*|schedule|publish|poste\w*)\b/.test(t)) result.push("executePublication");
  else if (publication && (!publicationPurpose || publicationObject) && /\b(?:cree|creer|prepare\w*|redig\w*|ecri\w*|write|draft|propose\w*)\b/.test(t)) result.push("preparePublication");
  if (publicationObject && /\b(?:corrig\w*|modifi\w*|edit|update)\b/.test(t)) result.push("editPublication");
  if (/\b(?:cta|ctas|bouton)\b|appels? a l.action/.test(t) && /\b(?:mets|mettre|configure\w*|fais|ajout\w*|set|use|change\w*|modifi\w*|appliqu\w*)\b/.test(t)) result.push("configureBusinessCta");
  if (/\b(?:adn|dna)\b/.test(t) && /\b(?:complet\w*|rempli\w*|analys\w*|enrich\w*)\b/.test(t)) result.push("startBusinessDnaAnalysis");
  else if (/\b(?:adn|dna|mission|entreprise|services)\b/.test(t) && /\b(?:modifi\w*|ajout\w*|mets|change\w*|enregistre\w*)\b/.test(t)) result.push("updateBusinessDna");
  if (/\b(?:ton|tone|style|vouvoiement|tutoiement|emoji|consignes|langue)\b/.test(t) && /\b(?:modifi\w*|ajout\w*|mets|passe|change\w*|configure\w*|regle\w*)\b/.test(t)) result.push("updateAiConfiguration");
  if (/\b(?:agent|automatisation)\b/.test(t) && /\b(?:configure\w*|active|desactive|regle\w*|programme\w*)\b/.test(t)) result.push("configureAgentAutomation");
  const crmTarget = /\b(?:crm|contacts?|clients?|prospects?)\b/.exec(t);
  const otherObject = /\b(?:images?|photos?|videos?|visuels?|logos?|flyers?|affiches?|publications?|posts?|campagnes?|e-?mails?|newsletters?|devis|factures?|agenda|rendez.vous|rdv)\b/.exec(t);
  if (crmTarget && (!otherObject || crmTarget.index < otherObject.index) && /\b(?:ajout\w*|cree|modifi\w*|supprim\w*|retire|fusionn\w*|add|update|merge|delete)\b/.test(t)) result.push(/fusionn|merge/.test(t)?"mergeCrmContacts":"manageCrmContact");
  if (/\b(?:mail|email|campagne|newsletter)\b/.test(t) && !/publicit|\bads\b/.test(t)) {
    if (/\b(?:envoie|envoyer|diffuse|send|programme|schedule)\b/.test(t)) result.push("dispatchCampaignDraft");
    else if (/\b(?:modifi\w*|corrig\w*|change\w*)\b/.test(t)) result.push("updateCampaignDraft");
    else if (/\b(?:prepare\w*|cree|redige|ecris)\b/.test(t)) result.push("prepareCampaignEmail");
  }
  if (/\b(?:agenda|rendez.vous|rdv|calendar)\b/.test(t)) {
    if (/\b(?:annule|annuler|supprime|cancel)\b/.test(t)) result.push("cancelCalendarAppointment");
    else if (/\b(?:modifi\w*|deplac\w*|report\w*|change\w*)\b/.test(t)) result.push("updateCalendarAppointment");
    else if (/\b(?:prepare\w*|cree|ajoute|planifie)\b/.test(t)) result.push("prepareCalendarAppointment");
  }
  if (/\b(?:ads|publicitaire|publicite)\b/.test(t)) result.push(/\b(?:pause|arret|arrete|suspend|budget|supprime|reprend)\b/.test(t)?"manageAdvertisingCampaign":"prepareAdvertisingCampaign");
  return [...new Set(result)];
}
/** A transcript is never a grant. Only server-stored, scoped, recent pending work qualifies. */
export function continueInrAssistantTask(current: string, task: InrAssistantTaskState | null | undefined, now = Date.now()): string | null {
  if (!task || task.version !== 1 || !["needs_input","partial"].includes(task.outcome) || !Number.isFinite(Date.parse(task.expiresAt)) || !Number.isFinite(Date.parse(task.startedAt)) || Date.parse(task.expiresAt) <= now || Date.parse(task.startedAt) > now || current.length > 1800) return null;
  const answer = current.trim(), t = normalize(answer);
  if (!answer || /```|^>|[«»]|\b(?:annule|stop|arrete|oublie|ignore|autre|different|ne|pas|jamais|not|never|cancel)\b|mot de passe|password|token|cle api|api.?key/.test(t)) return null;
  if (/^(?:comment|pourquoi|explique|how|why|what|qui|quel|quand|ou)\b/.test(t)) return null;
  const previous = inrAssistantRoutingText(task.instruction), question = inrAssistantRoutingText(task.question);
  const remaining = task.requiredTools.filter(name=>!inrAssistantGoalCompleted(name, task.receipts, task.requiredCalls));
  if (isInrAssistantAffirmation(answer) && task.outcome === "needs_input" &&
    /(?:voulez|souhaitez|puis.je|dois.je|would you|should i|shall i)/.test(question) && /(?:lanc|gener|creer|create|generate)/.test(question) &&
    task.requiredTools.includes("generateMedia") && !task.receipts.some(receipt => ["generateMedia", "modifyMedia"].includes(receipt.tool)) &&
    (permitsInrAssistantMediaAction(task.instruction, "generate", "image") || permitsInrAssistantMediaAction(task.instruction, "generate", "video"))) return task.instruction;
  if (/^(?:continue|reprends|termine|poursuis|oui[, ]+continue|oui[, ]+termine)\b/.test(t) && task.outcome === "partial" && remaining.length) return task.instruction;
  if (task.requiredTools.includes("configureBusinessCta") && /\b(?:telephone|tel|numero|site|website|web)\b/.test(t) && /\b(?:cta|ctas|canaux|partout)\b/.test(previous)) {
    if (/\b(?:telephone|tel|numero)\b/.test(t) === /\b(?:site|website|web)\b/.test(t)) return null;
    const scope = /\b(?:tous|toutes|partout|all)\b/.test(t) ? "tous mes canaux" : /\b(?:tous|toutes|partout|all)\b/.test(previous) ? "tous mes canaux" : (task.instruction.match(/\b(?:Facebook|Instagram|LinkedIn|Google|TikTok|YouTube|Pinterest|Threads|Twitter)\b/gi)??[]).join(", ");
    if (!scope) return null;
    return `Configure mes CTA avec mon ${/\b(?:telephone|tel|numero)\b/.test(t)?"téléphone":"site web"} dans ${scope}. Précision actuelle : ${answer}`;
  }
  if (task.requiredTools.includes("updateAiConfiguration") && /ton|tone|style|tutoiement|vouvoiement/.test(previous) && /ton|tone|style|souhait|choisi/.test(question) && !/\b(?:publie|envoie|cree|supprime|ajoute|mets|programme)\b/.test(t)) return `Modifie le ton de mes contenus et ma configuration IA : ${answer}`;
  if (task.requiredTools.some(x=>["startBusinessDnaAnalysis","updateBusinessDna"].includes(x)) && /\b(?:mission|description|services|prestations|valeurs)\b/.test(question) && !/\b(?:publie|envoie|supprime|programme)\b/.test(t)) {
    const field = question.match(/\b(?:mission|description|services|prestations|valeurs)\b/)![0];
    return `Modifie l’ADN de mon entreprise, ${field} : ${answer}`;
  }
  if (task.requiredTools.includes("executePublication") && /\b(?:demain|aujourd.hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{4}-\d{2}-\d{2})\b/.test(t) && /\b\d{1,2}\s*(?:h|:[0-5]\d)/.test(t)) return `Programme ma publication. ${answer} ${task.instruction}`.slice(0,4000);
  if (task.requiredTools.includes("generateMedia") && /sujet|format|souhait|brief/.test(question)) {
    if (isInrAssistantAffirmation(answer) || /\b(?:publie|envoie|supprime|execute|programme|contact|crm)\b/.test(t)) return null;
    const format = /^(?:format\s+)?(?:carre|square|portrait|paysage|landscape|story|vertical|horizontal)[.!\s]*$/.test(t);
    if (format && /format/.test(question)) return `${task.instruction}\nFormat choisi : ${answer}`.slice(0,4000);
    if (/\b(?:image|photo|visuel|video)\b/.test(t)) return `Crée ${answer}. ${task.instruction}`.slice(0,4000);
    if (/sujet|brief/.test(question) && answer.length >= 3 && answer.length <= 800) return `${task.instruction}\nSujet précisé par le professionnel : « ${answer.replace(/[«»]/g, "")} »`.slice(0,4000);
  }
  if (task.requiredTools.includes("dispatchCampaignDraft") && /\b(?:envoie|envoyer|send|programme|schedule)\b/.test(t) && /@/.test(answer)) return `${answer} Cette demande concerne le brouillon de campagne mail préparé.`;
  if (task.requiredTools.includes("updateCalendarAppointment") && /\b\d{1,2}\s*(?:h|:[0-5]\d)/.test(t) && /heure|date|quand/.test(question)) return `Déplace mon rendez-vous dans mon agenda : ${answer}. ${task.instruction}`.slice(0,4000);
  return null;
}
export function isInrAssistantAffirmation(value: string): boolean {
  return /^(?:oui|oui[, ]+(?:vas.y|lance(?:.la|.le)?|cree(?:.la|.le)?|confirme|d.accord)|ok|d.accord|vas.y|yes|yes[, ]+(?:please|go ahead)|si|ja)[.!\s]*$/.test(normalize(value.trim()));
}
export function inrAssistantRequiredCalls(message: string): Record<string, number> {
  const text = inrAssistantRoutingText(message);
  const match = text.match(/\b(\d{1,6}|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|two|three|four|five)\s+(?:nouveaux?\s+)?(?:contacts?|clients?|prospects?)(?:\s+crm)?\b/);
  const numbers: Record<string, number> = {deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,two:2,three:3,four:4,five:5};
  const count = match ? numbers[match[1]] ?? Number(match[1]) : 1;
  return count > 1 && inrAssistantRequiredTools(message).includes("manageCrmContact") ? { manageCrmContact: count } : {};
}
/** Refuse oversized work before exposing a mutating tool, including on resume. */
export function inrAssistantTaskTrackingLimit(requiredTools: string[], requiredCalls: Record<string, number> = {}): string | null {
  const tracked = new Set(requiredTools);
  // Publishing can save a draft before dispatch; its native receipt also needs
  // to survive a partial task so a continuation cannot prepare it a second time.
  if (tracked.has("executePublication")) tracked.add("preparePublication");
  const counts = [...tracked].map(name => requiredCalls[name] ?? 1);
  return counts.some(count => !Number.isSafeInteger(count) || count < 1) || counts.reduce((total, count) => total + count, 0) > INR_ASSISTANT_MAX_TRACKED_ACTIONS
    ? `Cette demande dépasse la limite de suivi de ${INR_ASSISTANT_MAX_TRACKED_ACTIONS} actions. Répartissez-la en plusieurs demandes plus petites avant de lancer les opérations. Aucune nouvelle action n’a été lancée.` : null;
}
const confirmedReceipt = (receipt: InrAssistantActionReceipt) => receipt.ok && !["failed","unknown","partial","needs_instruction","needs_details","blocked","unavailable"].includes(receipt.status);
const receiptRecordId = (receipt: InrAssistantActionReceipt) => receipt.id ?? receipt.recordId ?? receipt.eventId ?? receipt.draftId;
/** Keep every distinct confirmation, not the last N events. Repeated failures
 * or retries must never push an earlier saved record out of private task state. */
export function compactInrAssistantTaskReceipts(receipts: InrAssistantActionReceipt[], requiredTools: string[], requiredCalls: Record<string, number> = {}): InrAssistantActionReceipt[] {
  const confirmed = new Map<string, InrAssistantActionReceipt>();
  const unconfirmed = new Map<string, InrAssistantActionReceipt>();
  for (const receipt of receipts) {
    if (confirmedReceipt(receipt)) {
      const identity = receiptRecordId(receipt) ?? receipt.requestId ?? receipt.scheduledActionId ?? receipt.publicationId ?? "single";
      confirmed.set(`${receipt.tool}:${identity}`, receipt);
    } else unconfirmed.set(receipt.tool, receipt);
  }
  const result = [...confirmed.values()];
  for (const [name, receipt] of unconfirmed) {
    if (!inrAssistantGoalCompleted(name, result, requiredCalls) && (requiredTools.includes(name) || !result.some(item => item.tool === name))) result.push(receipt);
  }
  return result;
}
export function inrAssistantGoalCompleted(name: string, receipts: InrAssistantActionReceipt[], requiredCalls: Record<string, number> = {}): boolean {
  const successful = receipts.filter(receipt => receipt.tool === name && confirmedReceipt(receipt));
  const count = requiredCalls[name] ?? 1;
  if (count <= 1) return successful.length > 0;
  return new Set(successful.flatMap(receipt => { const id = receiptRecordId(receipt); return id ? [id] : []; })).size >= count;
}
export function inrAssistantTaskOutcome(required: string[], receipts: InrAssistantActionReceipt[], question: string, requiredCalls: Record<string, number> = {}): InrAssistantTaskOutcome {
  if (!required.length) return "completed";
  const achieved = (name: string) => inrAssistantGoalCompleted(name, receipts, requiredCalls);
  if (required.every(achieved)) return receipts.some(r=>r.ok&&["queued","processing","running","ready_to_save"].includes(r.status))?"processing":"completed";
  if (receipts.some(r=>r.ok)) return "partial";
  if (/\?|pr[eé]cis|quel|indique|manqu|choisi/.test(question)) return "needs_input";
  return receipts.length ? "blocked" : "needs_input";
}
