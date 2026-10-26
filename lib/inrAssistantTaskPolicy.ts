export type InrAssistantTaskOutcome = "completed" | "partial" | "needs_input" | "processing" | "blocked" | "failed";
export type InrAssistantActionReceipt = { tool: string; ok: boolean; status: string; message: string; id?: string; draftId?: string; requestId?: string; scheduledActionId?: string; eventId?: string; recordId?: string; publicationId?: string; toolUrl?: string };
export type InrAssistantTaskState = {
  version: 1; instruction: string; actionRequestId: string; startedAt: string; expiresAt: string;
  outcome: InrAssistantTaskOutcome; requiredTools: string[]; receipts: InrAssistantActionReceipt[]; question: string;
};
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
  const t = inrAssistantRoutingText(message), result: string[] = [];
  if (/^(?:comment|pourquoi|explique|how|why|what|wie|como)\b/.test(t) || /\b(?:explique|explain|me dire)\b.{0,60}\b(?:comment|how|pourquoi|why)\b/.test(t)) return result;
  if (/\b(?:ne|sans|not|never)\b.{0,20}\b(?:modifi|cre|gener|publ|envoi)/.test(t)) return result;
  if (/\b(?:cree|creer|gener\w*|fais|make|create|draw)\b/.test(t) && /\b(?:image|photo|video|visuel|illustration|affiche|flyer|logo)\b/.test(t)) result.push("generateMedia");
  if (/\b(?:retouch\w*|recadr\w*|modify|edit|modifi\w*)\b/.test(t) && /\b(?:image|photo|visuel)\b/.test(t)) result.push("modifyMedia");
  const publication = /\b(?:publication|post|booster|publie|publier|publish)\b/.test(t);
  if (publication && /\b(?:publie\w*|publier|programme\w*|planifi\w*|schedule|publish|poste\w*)\b/.test(t)) result.push("executePublication");
  else if (publication && /\b(?:cree|creer|prepare\w*|redig\w*|ecri\w*|write|draft|propose\w*)\b/.test(t)) result.push("preparePublication");
  if (publication && /\b(?:corrig\w*|modifi\w*|edit|update)\b/.test(t)) result.push("editPublication");
  if (/\b(?:cta|ctas|bouton)\b|appels? a l.action/.test(t) && /\b(?:mets|mettre|configure\w*|fais|ajout\w*|set|use|change\w*|modifi\w*|appliqu\w*)\b/.test(t)) result.push("configureBusinessCta");
  if (/\b(?:adn|dna)\b/.test(t) && /\b(?:complet\w*|rempli\w*|analys\w*|enrich\w*)\b/.test(t)) result.push("startBusinessDnaAnalysis");
  else if (/\b(?:adn|dna|mission|entreprise|services)\b/.test(t) && /\b(?:modifi\w*|ajout\w*|mets|change\w*|enregistre\w*)\b/.test(t)) result.push("updateBusinessDna");
  if (/\b(?:ton|tone|style|vouvoiement|tutoiement|emoji|consignes|langue)\b/.test(t) && /\b(?:modifi\w*|ajout\w*|mets|passe|change\w*|configure\w*|regle\w*)\b/.test(t)) result.push("updateAiConfiguration");
  if (/\b(?:agent|automatisation)\b/.test(t) && /\b(?:configure\w*|active|desactive|regle\w*|programme\w*)\b/.test(t)) result.push("configureAgentAutomation");
  if (/\b(?:crm|contact|client|prospect)\b/.test(t) && /\b(?:ajout\w*|cree|modifi\w*|supprim\w*|retire|fusionn\w*|merge|delete)\b/.test(t)) result.push(/fusionn|merge/.test(t)?"mergeCrmContacts":"manageCrmContact");
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
  const done = new Set(task.receipts.filter(r=>r.ok && !["failed","unknown","partial","needs_instruction"].includes(r.status)).map(r=>r.tool));
  const remaining = task.requiredTools.filter(x=>!done.has(x));
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
  if (task.requiredTools.includes("generateMedia") && /\b(?:image|photo|visuel|video)\b/.test(t) && /sujet|format|souhait|brief/.test(question)) return `Crée ${answer}. ${task.instruction}`.slice(0,4000);
  if (task.requiredTools.includes("dispatchCampaignDraft") && /\b(?:envoie|envoyer|send|programme|schedule)\b/.test(t) && /@/.test(answer)) return `${answer} Cette demande concerne le brouillon de campagne mail préparé.`;
  if (task.requiredTools.includes("updateCalendarAppointment") && /\b\d{1,2}\s*(?:h|:[0-5]\d)/.test(t) && /heure|date|quand/.test(question)) return `Déplace mon rendez-vous dans mon agenda : ${answer}. ${task.instruction}`.slice(0,4000);
  return null;
}
export function inrAssistantTaskOutcome(required: string[], receipts: InrAssistantActionReceipt[], question: string): InrAssistantTaskOutcome {
  if (!required.length) return "completed";
  const achieved = (name: string) => receipts.some(r=>r.tool===name && r.ok && !["failed","unknown","partial","needs_instruction","needs_details","blocked","unavailable"].includes(r.status));
  if (required.every(achieved)) return receipts.some(r=>r.ok&&["queued","processing","running","ready_to_save"].includes(r.status))?"processing":"completed";
  if (receipts.some(r=>r.ok)) return "partial";
  if (/\?|pr[eé]cis|quel|indique|manqu|choisi/.test(question)) return "needs_input";
  return receipts.length ? "blocked" : "needs_input";
}
