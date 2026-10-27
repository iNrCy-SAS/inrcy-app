/** Pure current-message intent shared by task tracking and media executors.
 * This is not an account, subscription, quota or source-media access check. */
export type InrAssistantMediaAction = "generate" | "modify";
export type InrAssistantMediaType = "image" | "video";

const IMAGE_SUBJECT = /\b(?:images?|photos?|visuels?|illustrations?|affiches?|flyers?|medias?|dessins?|logos?|logotipos?|pictures?|posters?|banners?|imagen(?:es)?|fotos?|fotografias?|ilustracion(?:es)?|carteles?|bild(?:er)?|abbildung(?:en)?|illustration(?:en)?|plakat(?:e)?|grafik(?:en)?)\b|图片|รูป/;
const VIDEO_SUBJECT = /\b(?:videos?|clips?|films?|animations?|filme?|peliculas?)\b|视频|วิดีโอ/;
const GENERATE_VERBS = "(?:cre(?:e|i)\\w*|creer|gener\\w*|fais|faire|faites|fass\\w*|realise\\w*|produi\\w*|dessin\\w*|anime\\w*|create|generate|make|produce|draw|design|crea(?:r(?:me)?|me|d|s|n)?|crees?|haz(?:me)?|haga(?:s|me)?|disena(?:r|me)?|erstell(?:e|en|st|t)?|erzeug(?:e|en|st|t)?|zeichn(?:e|en|est|et)?)";
const MODIFY_VERBS = "(?:modifi\\w*|retouch\\w*|corrig\\w*|remplac\\w*|retir\\w*|enlev\\w*|supprim\\w*|recadr\\w*|eclairci\\w*|assombri\\w*|ajout\\w*|mets|mettre|rends|rendre|ameliore\\w*|augment\\w*|redui\\w*|edit|modify|retouch|remove|replace|brighten|crop|add|modifica(?:r|me)?|edita(?:r|me)?|retoca(?:r|me)?|reemplaza(?:r)?|elimina(?:r)?|quita(?:r)?|recorta(?:r)?|anade|agrega(?:r)?|bearbeit(?:e|en)|ander(?:e|n)|entfern(?:e|en)|ersetz(?:e|en)|retuschier(?:e|en)|beschneid(?:e|en)|korrigier(?:e|en))";

function currentText(message: string): string {
  return message.slice(0, 4_000)
    .replace(/```[\s\S]*?(?:```|$)|`[^`]*`|«[^»]*»|"[^"]*"|“[^”]*”|„[^“]*“|「[^」]*」|^>.*$/gm, " ")
    .replace(/(^|[\s:([{])'[^'\n]+'(?=$|[\s.,;:!?)\]}])/gm, "$1 ")
    .normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();
}

/** A media used as context/source is not the requested output (for example a
 * publication with an existing image, or a prompt written for that image). */
function requestedMediaSubject(value: string, mediaType: InrAssistantMediaType, artifactIndex?: number): { index: number } | null {
  const subjects = new RegExp((mediaType === "video" ? VIDEO_SUBJECT : IMAGE_SUBJECT).source, "g");
  for (const subject of value.matchAll(subjects)) {
    const index = subject.index!;
    const before = value.slice(Math.max(0, index - 130), index);
    const after = value.slice(index + subject[0].length);
    const referenceDescription = /\b(?:existing|provided|uploaded|attached|selected|previous|vorhanden\w*|hochgeladen\w*|beigefugt\w*|existante?s?|fournie?s?|jointe?s?|selectionnee?s?|existente?s?|adjunta?s?)\s*$/.test(before) ||
      /^\s+(?:existante?s?|fournie?s?|jointe?s?|selectionnee?s?|de reference|de la mediatheque|en piece jointe|existing|provided|uploaded|attached|selected|existente?s?|adjunta?s?|vorhanden\w*|hochgeladen\w*)\b/.test(after) ||
      /^\s+(?:que j'ai|que nous avons|que vous avez)\s+(?:fournie?s?|jointe?s?|ajoutee?s?|chargee?s?|selectionnee?s?)\b/.test(after);
    const referenceContext = /\b(?:pour|avec|depuis|de|sur|utilisant|using|with|for|from|of|on|para|con|desde|mit|fur|aus|von|a partir de|a l'aide de)\s+(?:cette?|ces|mon|ma|mes|notre|nos|votre|vos|ton|ta|tes|la|le|les|this|that|these|those|my|our|your|the|esta?s?|este?s?|estos|mis?|tus?|nuestr[oa]s?|dies(?:e|er|es|em|en)|mein(?:e|er|es|em|en)?|dein(?:e|er|es|em|en)?)\s+(?:(?!(?:une?|des?|an?|some|new|nouvelle?|ein(?:e|en)?|una?)\b)[\p{L}-]+\s+){0,3}$/u.test(before);
    // Even an indefinite medium can introduce a free prompt's intended use:
    // "Crée pour une image un prompt". A later new flyer/image remains eligible.
    const promptContext = artifactIndex !== undefined && index < artifactIndex &&
      /\b(?:pour|for|para|fur)\s+(?:une?|des?|la|le|les|an?|the|some|ein(?:e|en)?|una?|el|los|las)\s+(?:[\p{L}-]+\s+){0,2}$/u.test(before);
    if (!referenceDescription && !referenceContext && !promptContext) return { index };
  }
  return null;
}

function mediaActionClauses(value: string): string[] {
  // Split coordination only when another directive follows. "Image et logo"
  // remains one output request; "image puis ajoute un contact" has two objects.
  const nextAction = `(?:(?:ne|do not|don't|no|nicht)\\s+)?(?:(?:tu|vous|you)\\s+)?(?:${GENERATE_VERBS}|${MODIFY_VERBS}|prepar\\w*|redig\\w*|ecri\\w*|envoi\\w*|publi\\w*|planifi\\w*|prepare|write|send|publish|update|schedule)`;
  return value.split(new RegExp(`(?:[;.!?]\\s*|\\b(?:puis|ensuite|then|luego|despues|dann)\\b\\s*|\\b(?:et|and|y|und|mais|but|pero|aber)\\s+(?=${nextAction}\\b))`, "g"))
    .map(clause => clause.trim()).filter(Boolean);
}

function hasNonMediaEditObject(value: string): boolean {
  const article = "(?:(?:le|la|les|un|une|des|du|mon|ma|mes|notre|nos|votre|vos|son|sa|ses|ce|cette|ces|the|a|an|my|our|your|this|that|el|los|las|un|una|mi|su|ein|eine|einen|den|die|das|mein|meine)\\s+)*";
  const foreignObject = "(?:(?:crm\\s+)?contacts?|clients?|prospects?|factures?|devis|campagnes?|campaigns?|emails?|mails?|publications?|posts?|evenements?|events?|taches?|tasks?|rendez.vous|tags?|etiquettes?|categories?|abonnements?|subscriptions?|comptes?|accounts?|contactos?|clientes?|facturas?|campanas?|kontakt\\w*|kund\\w*|rechnung\\w*|kampagn\\w*)";
  const businessObject = new RegExp(`\\b${MODIFY_VERBS}\\b\\s+(?:(?:me|nous|please|bitte)\\s+)?${article}${foreignObject}\\b|\\b(?:a|dans|to|into|in|zu)\\s+${article}${foreignObject}\\b`).test(value);
  // Business words may be the actual text drawn onto an explicitly named image.
  const visualDestination = new RegExp(`\\b(?:sur|dans|on|onto|in|auf|en)\\s+${article}(?:${IMAGE_SUBJECT.source})`).test(value);
  return businessObject && !visualDestination;
}

function isWholeMediaRemoval(value: string): boolean {
  const verb = "(?:supprim\\w*|retir\\w*|enlev\\w*|effac\\w*|remove|delete|elimina\\w*|quita\\w*|entfern\\w*|losch\\w*)";
  const article = "(?:(?:le|la|les|un|une|des|ce|cet|cette|ces|mon|ma|mes|tous|toutes|the|a|an|this|that|these|those|my|our|your|esta?|este|estos|las?|los?|una?|mis?|dies(?:e|er|es|em|en)|ein(?:e|en)?|das|die|den)\\s+|l')*";
  const file = new RegExp(`\\b${verb}\\b\\s+(?:(?:moi|me|nous|please)\\s+)?${article}(?:fichiers?|files?|datei(?:en)?|archivos?)\\b`).test(value);
  if (file) return true;
  const media = new RegExp(`\\b${verb}\\b\\s+(?:(?:moi|me|nous|please)\\s+)?${article}(${IMAGE_SUBJECT.source}|${VIDEO_SUBJECT.source})`).exec(value);
  if (!media) return false;
  const after = value.slice(media.index + media[0].length);
  const visualContainer = new RegExp(`\\b(?:dans|sur|de|in|on|from|en|aus|von|auf)\\s+${article}(?:${IMAGE_SUBJECT.source})`).test(after);
  if (visualContainer) return false;
  // A source-bound instruction may remove a logo drawn in an image. Removing
  // the logo asset from the library is a separate native file action.
  return !/^logos?\b/.test(media[1]) || /mediatheque|bibliotheque|library|biblioteca|mediathek/.test(after);
}

/** Tracking must require a media subject before interpreting a generic edit verb.
 * The edit executor itself can also receive an explicit, separately verified source ID. */
export function hasInrAssistantMediaSubject(message: string, mediaType: InrAssistantMediaType = "image"): boolean {
  return typeof message === "string" && (mediaType === "video" ? VIDEO_SUBJECT : IMAGE_SUBJECT).test(currentText(message));
}

/** Only the current server-supplied message can request a paid action.
 * A bare confirmation or text quoted by the user never becomes an instruction. */
export function permitsInrAssistantMediaAction(message: string, action: InrAssistantMediaAction, mediaType: InrAssistantMediaType = "image"): boolean {
  if (typeof message !== "string" || !["generate", "modify"].includes(action) || !["image", "video"].includes(mediaType) || action === "modify" && mediaType === "video" || /^(?:assistant|system|systeme|user|utilisateur)\s*:/im.test(message.slice(0, 4_000))) return false;
  const value = currentText(message);
  if (!value || /^(?:comment|pourquoi|ou|how|where|what|wie|warum|wo|was|como|por que|donde|cual)\b/.test(value) ||
    /\b(?:expliqu\w*|comprendr\w*|savoir|explain|teach|erklar\w*|versteh\w*|wissen|explic\w*|ensen\w*|saber|aprender)\b/.test(value) ||
    /\b(?:montr\w*|show|zeig\w*|mostr\w*|muestr\w*|dis|dire|tell|decir\w*|dime)\b.{0,60}\b(?:comment|how|wie|como|si|ob|whether|if)\b/.test(value) ||
    /\b(?:puis.je|dois.je|(?:je|on) (?:peux|peut|dois|doit)|can i|should i|kann ich|soll ich|kann man|darf ich|puedo|debo|podemos)\b/.test(value) ||
    /^est.ce que (?:tu|vous) (?:peux|pouvez|sais|savez)\b/.test(value) ||
    /^(?:hier|autrefois|yesterday|earlier|gestern|fruher|damals|ayer|antes|si je|si on|si tu|if i|if we|if you|wenn ich|wenn du|falls ich|si yo|imagine que|suppose que)\b/.test(value) ||
    /^(?:le bouton|the button|der button|die schaltflache|el boton|message d.erreur|error message|fehlermeldung|mensaje de error)\b/.test(value) ||
    /^(?:voici\b.{0,35}\b(?:texte|citation|exemple|historique)|here is\b.{0,35}\b(?:quote|example|transcript)|historique|transcript|conversation history)\b/.test(value)) return false;

  return mediaActionClauses(value).some(clause => permitsMediaClause(clause, action, mediaType));
}

function permitsMediaClause(value: string, action: InrAssistantMediaAction, mediaType: InrAssistantMediaType): boolean {
  const editingProduct = /\b(?:fais|faire|faites|cree\w*|create|make)\s+(?:(?:moi|me|nous|please)\s+)?(?:une?|la|des?|an?|the|some)\s+(?:retouches?|modifications?|corrections?|ameliorations?|recadrages?|edits?|retouch(?:ing)?|crops?)\b/.test(value);
  if (action === "generate" && editingProduct) return false;
  // Asking for a prompt/brief is different from requesting the media described by it.
  const artifact = /\b(?:prompts?|briefs?|instructions?|consignes?|anweisungen?|instrucciones?)\b/.exec(value);
  const subject = action === "generate"
    ? requestedMediaSubject(value, mediaType, artifact?.index)
    : (mediaType === "video" ? VIDEO_SUBJECT : IMAGE_SUBJECT).exec(value);
  if (artifact && (!subject || artifact.index < subject.index)) return false;

  const verbs = action === "generate" ? GENERATE_VERBS : MODIFY_VERBS;
  const negative = "(?:ne|sans|pas|jamais|not|never|don't|do not|no|nunca|sin|nicht|kein(?:e|en|er|es|em)?|niemals)";
  if (new RegExp(`\\b${negative}\\b.{0,80}\\b${verbs}\\b|\\b${verbs}\\b.{0,24}\\b(?:pas|jamais|not|never|no|nunca|nicht|kein\\w*|niemals)\\b`).test(value) ||
    /\b(?:je ne (?:veux|souhaite|voudrais)|i (?:do not|don't) (?:want|need)|no (?:quiero|necesito))\b/.test(value)) return false;

  const direct = new RegExp(`(?:^|[.!?;,:]\\s*|\\b(?:et|puis|ensuite|please|stp|y|luego|despues|bitte|und|dann)\\s+)\\s*${verbs}\\b|\\b(?:(?:peux|pourrais|voudrais)[- ]tu|(?:pouvez|pourriez|voudriez)[- ]vous|tu (?:peux|pourrais)|vous (?:pouvez|pourriez)|je (?:veux|souhaite|voudrais) que (?:tu|vous)|j.aimerais que (?:tu|vous)|j.ai besoin que (?:tu|vous)|(?:can|could|would) you|i want you to|i would like you to|(?:puedes|podrias)(?: tu)?|(?:quiero|me gustaria|necesito) que)\\s+(?:(?:me|nous|please|por favor)\\s+)?${verbs}\\b`).test(value)
    || new RegExp(`\\b(?:(?:kannst|konntest|wurdest) du|(?:konnen|konnten|wurden) sie)\\b.{0,120}\\b${verbs}\\b`).test(value);
  if (action === "modify") return (direct || editingProduct) && !hasNonMediaEditObject(value) && !isWholeMediaRemoval(value);

  const needText = value.replace(/\bj'ai besoin d'/g, "j'ai besoin de ");
  const need = /\b(?:je (?:veux|souhaite|voudrais)|j.aimerais|j.ai besoin de|i (?:want|need)|i would like|quiero|necesito|me gustaria|ich mochte|ich will|ich brauche|ich hatte gern(?:e)?|ich wunsche mir)\s+(?:(?:une?|des?|an?|the|some|new|nouvelle?s?|belles?|beau|ein|eine|einen|neues?|neuen|un|una|unos|unas|nueva?s?|nuevo?s?)\s+)*(?:images?|photos?|videos?|visuels?|illustrations?|affiches?|flyers?|medias?|clips?|pictures?|logos?|logotipos?|posters?|banners?|imagen(?:es)?|fotos?|fotografias?|ilustracion(?:es)?|carteles?|bild(?:er)?|plakat(?:e)?|grafik(?:en)?)\b/.test(needText);
  return (direct || need) && Boolean(subject);
}
