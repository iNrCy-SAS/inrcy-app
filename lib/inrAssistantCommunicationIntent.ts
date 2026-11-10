import { hasInrAssistantDeferredApproval } from "./inrAssistantActionClause.ts";
import { inrAssistantClauseIsAdvice, inrAssistantRequestClauses, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";

export type InrAssistantCommunicationIntent = {
  campaignDraft: boolean;
  campaignDraftEdit: boolean;
  campaignAudiencePreview: boolean;
  campaignDeliveryRead: boolean;
  individualHistoryRead: boolean;
  individualHistoryAllPages: boolean;
};

/** Routing and task vocabulary only. No field, recipient or consent is inferred;
 * native executors must still authorize the exact original current message. */
export function readInrAssistantCommunicationIntent(message: string): InrAssistantCommunicationIntent {
  const result: InrAssistantCommunicationIntent = {
    campaignDraft: false, campaignDraftEdit: false, campaignAudiencePreview: false,
    campaignDeliveryRead: false, individualHistoryRead: false, individualHistoryAllPages: false,
  };
  const prepare = "(?:prepar\\w*|cree\\w*|creer|redig\\w*|compose\\w*|ecris|ecrire|gener\\w*|draft|write|create|prepare)";
  const edit = "(?:modifi\\w*|corrig\\w*|remplac\\w*|chang\\w*|ajout\\w*|retir\\w*|mets|update|edit)";
  const read = "(?:lis|lire|consulte\\w*|montre\\w*|affiche\\w*|verifi\\w*|regarde\\w*|resume\\w*|indique\\w*|donne\\w*|read|show|check|list)";
  const denied = (clause: string, verbs: string) => new RegExp(`(?:\\b(?:ne|pas|jamais|sans|not|never|without|do not)\\b|\\bn'|don't).{0,40}\\b${verbs}\\b|\\b${verbs}\\b.{0,16}\\b(?:pas|jamais|not|never|rien|nothing)\\b`).test(clause);
  const deferred = hasInrAssistantDeferredApproval(message) || /^(?:si|quand|lorsque|if|when|unless)\b/.test(inrAssistantUnquotedRequest(message));
  for (const clause of inrAssistantRequestClauses(message)) {
    if (inrAssistantClauseIsAdvice(clause) || /^(?:si|quand|lorsque|if|when|unless|imagin\w*|suppos\w*)\b/.test(clause)) continue;
    const mail = /\b(?:(?:e-?)?mails?|courriels?|newsletters?|inr.?send|outgoing)\b/.test(clause);
    const campaign = /\b(?:campagnes?|campaigns?|newsletters?|propulser|fideliser)\b/.test(clause)
      || mail && /\b(?:valoriser|recolter|offrir|informer|suivre|enqueter)\b/.test(clause);
    const advertisingOnly = /\bads\b|publicit|sponsoris|\b(?:google|meta|facebook|instagram|linkedin|pinterest|chatgpt|openai|budget|depens\w*|cout\w*|spend|spent|impressions?|clics?|conversions?|roas|cpa|preflight)\b/.test(clause) && !mail;
    const reading = new RegExp(`\\b${read}\\b`).test(clause) && !denied(clause, read);
    const knowledgeRead = reading || /\b(?:quel\w*|combien|ou en est)\b/.test(clause);
    if (campaign && !advertisingOnly && knowledgeRead && /\b(?:statuts?|etat|compteurs?|livraisons?|delivery|acceptedbyprovider)\b/.test(clause)) result.campaignDeliveryRead = true;
    if (mail && reading && /\b(?:historique|history|envoyes?|sent|outgoing)\b/.test(clause) && !/\b(?:recus?|inbox|incoming)\b/.test(clause)) {
      result.individualHistoryRead = true;
      if (/\b(?:tout|tous|toutes|integral\w*|complet\w*)\b|\bpages? suivantes?\b|\bchaque page\b/.test(clause)) result.individualHistoryAllPages = true;
    }
    if (!campaign || advertisingOnly || deferred || /\b(?:si|quand|lorsque|if|when|unless)\b/.test(clause)) continue;
    const preview = /\b(?:apercu|audience|preview)\b/.test(clause)
      && new RegExp(`\\b(?:${prepare}|montre\\w*|affiche\\w*|verifi\\w*|show|check)\\b`).test(clause)
      && !denied(clause, "(?:prepar\\w*|apercu|preview|montre\\w*|affiche\\w*|verifi\\w*|show|check)");
    if (preview) result.campaignAudiencePreview = true;
    const editing = new RegExp(`\\b${edit}\\b`).test(clause) && !denied(clause, edit)
      && /\b(?:brouillons?|objet|sujet|texte|corps|message|destinataires?|drafts?|subject|body)\b/.test(clause);
    if (editing) result.campaignDraftEdit = true;
    if (!preview && !editing && new RegExp(`\\b${prepare}\\b`).test(clause) && !denied(clause, prepare)) result.campaignDraft = true;
  }
  return result;
}
