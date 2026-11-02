/** Intent vocabulary only. Each executor still verifies the original instruction. */
export function inrAssistantStandardCommands(text: string): string[] | null {
  const media = /\b(?:medias?|mediatheque|images?|photos?|videos?|fichiers?|pieces? jointes?)\b/.test(text);
  if (media && /\b(?:import\w*|ajout\w*|enregistr\w*|sauvegard\w*)\b/.test(text) && /mediatheque|bibliotheque|piece jointe|fichier joint/.test(text) && !/gener\w*|creer|cree\b|\btags?\b|titre|metadonnee/.test(text)) return ["importMediaAttachment"];
  if (media && /\b(?:telecharg\w*|download|export\w*)\b/.test(text)) return ["prepareMediaDownload"];
  if (media && /\b(?:supprim\w*|effac\w*|delete)\b/.test(text) && !/publications?|posts?|canaux|brouillon/.test(text)) return ["applyMediaDeletion"];
  if (/\bidees?\b/.test(text) && /agent|publication|editorial/.test(text) && /\b(?:ajout\w*|retir\w*|supprim\w*|remplac\w*|reinitialis\w*|reordonn\w*|reorganis\w*|ordonn\w*|classe\w*|activ\w*|desactiv\w*|suspend\w*|mets|place)\b/.test(text)) return ["managePublicationIdeas"];
  if (/annuaire|inr.?search|inr.?badge|\bbadge\b/.test(text) && /\b(?:activ\w*|desactiv\w*)\b/.test(text) && !/\b(?:logo|nom|email|telephone|bouton|lien)\b/.test(text)) return ["setNativeChannelActivation"];
  if (/(?:google business|fiche google|profil google)/.test(text) && (/\b(?:modifi\w*|corrig\w*|mets|change\w*|remplac\w*)\b/.test(text) || /activit|categor/.test(text) && /ajout|retir|supprim/.test(text)) && /description|telephone|site|adresse|horaire|profil|fiche|activit|categor/.test(text) && !/avis|reponse|cta|partout/.test(text)) return ["applyGoogleBusinessProfileUpdate"];
  if (/\b(?:lien|url|adresse web)\b/.test(text) && /\b(?:public|profil|facebook|instagram|linkedin|threads|pinterest|youtube|tiktok|site|canal)\b/.test(text) && /\b(?:modifi\w*|change\w*|mets|remplac\w*|enregistr\w*)\b/.test(text) && !/cta|partout|publication|contenu/.test(text)) return ["updateChannelPublicUrl"];
  if (/\b(?:stats|statistiques|performances|statistique)\b/.test(text) || /\b(?:rapport|bilan)\b/.test(text) && /\bpdf\b/.test(text)) {
    if (/rapport|bilan|pdf/.test(text) && /\b(?:telecharg\w*|download|export\w*)\b/.test(text)) return ["prepareStatsReportDownload"];
    if (/\b(?:actualis\w*|rafraich\w*|synchronis\w*|refresh)\b/.test(text)) return ["refreshStatsSources"];
    if (/\b(?:envoi\w*|envoy\w*|send)\b/.test(text) && /rapport|bilan/.test(text)) return ["sendStatsReport"];
  }
  if (/\b(?:publications?|posts?|brouillons?|propositions?)\b/.test(text)) {
    if (/\b(?:supprim\w*|effac\w*|refus\w*|restaur\w*)\b/.test(text) && !/programm|planifi/.test(text)) return ["applyPublicationLifecycleAction"];
    if (/agent|prepar\w*|proposition/.test(text) && /\b(?:modifi\w*|corrig\w*|ajout\w*|retir\w*|selectionn\w*|enregistr\w*|sauvegard\w*)\b/.test(text)) return ["editPreparedPublication"];
  }
  return null;
}
