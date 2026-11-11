import assert from "node:assert/strict";
import test from "node:test";
import { quoteAiMediaCredits } from "../../lib/aiMediaCreditsPricing.ts";
import { createInrAssistantMediaQuote, hasInrAssistantMediaQuoteAdvice, independentInrAssistantMediaQuoteAdvice, matchInrAssistantMediaQuote, parseInrAssistantMediaQuote, renderInrAssistantMediaQuote } from "../../lib/inrAssistantMediaQuote.ts";
import { createNativeMediaQuoteFixture } from "./helpers/media-quote-runtime.mts";

const request="Donne-moi le devis exact en crédits pour une image carrée d’un vélo bleu sans texte, avec FLUX.2 Pro. Ne génère rien, ne réserve aucun crédit, n’enregistre rien et conserve le formulaire Studio ouvert.";
const payload={kind:"image",imageEngine:"flux",format:"square",inspirationImagesCount:0,withNarration:false};
const quote=createInrAssistantMediaQuote(quoteAiMediaCredits(payload),payload,0)!;

test("native pricing evidence binds tariff axes and preserves zero or unknown balance, without creative prompt matching",()=>{
  assert.ok(quote);assert.equal(quote.totalCredits,5);assert.equal(quote.availableCredits,0);
  assert.equal(matchInrAssistantMediaQuote(quote,request).matches,true);
  assert.equal(matchInrAssistantMediaQuote(quote,request.replace("vélo bleu","atelier rouge")).matches,true);
  assert.equal(matchInrAssistantMediaQuote(quote,request.replace("FLUX.2 Pro",'"FLUX.2 Pro"')).matches,true);
  assert.equal(matchInrAssistantMediaQuote(quote,request+" À partir de l’image jointe.").matches,false);
  assert.equal(matchInrAssistantMediaQuote(quote,request+" Avec les images de référence jointes.").matches,false);
  assert.equal(matchInrAssistantMediaQuote(quote,request+" Avec les images jointes.").matches,false);
  const referencedPayload={...payload,inspirationImagesCount:1};
  const referenced=createInrAssistantMediaQuote(quoteAiMediaCredits(referencedPayload),referencedPayload,50)!;
  assert.equal(matchInrAssistantMediaQuote(referenced,request+" À partir de l’image jointe.").matches,false,"An unbounded source mention is not evidence of its count");
  assert.equal(matchInrAssistantMediaQuote(referenced,request+" Avec 1 image de référence.").matches,true);
  assert.match(renderInrAssistantMediaQuote(quote),/5 crédits média|5\*\* crédits média/);assert.match(renderInrAssistantMediaQuote(quote),/Crédits disponibles : 0/);
  const unknown=createInrAssistantMediaQuote(quoteAiMediaCredits(payload),payload,null)!;
  assert.match(renderInrAssistantMediaQuote(unknown),/non communiqué/);
  assert.equal(createInrAssistantMediaQuote({...quoteAiMediaCredits(payload),engine:"openai"},payload,50),null);
  assert.equal(parseInrAssistantMediaQuote({...quote,totalCredits:NaN}),null);
  assert.equal(parseInrAssistantMediaQuote({...quote,source:"model_prediction"}),null);
});

test("wrong engine, shape, duration, resolution or reference count never validates the requested quote",()=>{
  for(const changed of [request.replace("FLUX.2 Pro","Gemini Image"),request.replace("carrée","paysage"),request.replace("image carrée","vidéo carrée"),request.replace("sans texte","sans texte avec 1 image de référence")])
    assert.equal(matchInrAssistantMediaQuote(quote,changed).matches,false,changed);
  const videoPayload={kind:"video",videoEngine:"grok-lite",format:"story",durationSeconds:8,videoResolution:"720p",inspirationImagesCount:0,withNarration:false,creationMode:"free"};
  const video=createInrAssistantMediaQuote(quoteAiMediaCredits(videoPayload),videoPayload,50)!;
  assert.ok(video);assert.equal(matchInrAssistantMediaQuote(video,"Donne le devis d’une vidéo verticale de 8 secondes avec Grok Imagine Lite en 720p.").matches,true);
  assert.equal(parseInrAssistantMediaQuote({...video,resolution:"480p"}),null);
  assert.equal(parseInrAssistantMediaQuote({...video,resolution:"768p"}),null);
  assert.equal(matchInrAssistantMediaQuote(video,"Donne le devis d’une vidéo verticale de 10 secondes avec Grok Imagine Lite en 720p.").matches,false);
  assert.equal(matchInrAssistantMediaQuote(video,"Donne le devis d’une vidéo verticale de 8 secondes avec Grok Imagine Lite en 1080p.").matches,false);
  assert.equal(matchInrAssistantMediaQuote(video,"Donne le devis d’une vidéo verticale de 8 secondes avec Grok Imagine Lite en 720p avec narration.").matches,false);
});

test("independent advice survives while provider claims about native pricing are excluded",()=>{
  assert.equal(hasInrAssistantMediaQuoteAdvice(request),false);
  assert.equal(hasInrAssistantMediaQuoteAdvice(request+" Puis explique quel moteur utiliser pour du texte lisible."),true);
  assert.equal(hasInrAssistantMediaQuoteAdvice("Quel est le coût d’une image carrée avec FLUX.2 Pro ?"),false);
  assert.equal(hasInrAssistantMediaQuoteAdvice(request+" Et quel moteur privilégier pour du texte lisible ?"),true);
  assert.equal(matchInrAssistantMediaQuote(quote,request+" Et quel moteur privilégier, OpenAI Image ou Gemini Image ?").matches,true);
  const advice=independentInrAssistantMediaQuoteAdvice("Je n’ai pas encore le devis exact. Il indique 5 crédits mais je ne peux pas les confirmer. Pour du texte lisible, OpenAI Image est une option à comparer dans Studio.");
  assert.match(advice,/texte lisible/);assert.doesNotMatch(advice,/devis|crédits|confirmer/);
});

test("real MediaTools and native server pricing expose only the validated public quote and never generate or save",async()=>{
  const h=createNativeMediaQuoteFixture(request,0);
  const input={mediaType:"image" as const,prompt:"Une photo de mon atelier rouge",format:"square" as const,durationSeconds:null,settings:[{field:"imageEngine",valueJson:'"flux"'}],resultMode:null};
  const result=await h.tool.execute(input,{toolCallId:"native-quote",messages:[]});
  assert.equal(result.ok,true);assert.equal(result.status,"quoted");assert.equal(result.quote?.engine,"flux");assert.equal(result.quote?.format,"square");assert.equal(result.quote?.totalCredits,5);assert.equal(result.quote?.availableCredits,0);
  assert.deepEqual(h.calls.map(call=>call.stage),["access","quota","quote"]);assert.equal(h.calls[2].body?.freePrompt,input.prompt);
  const publicOutput=await h.tool.toModelOutput!({toolCallId:"native-quote",input,output:result});
  assert.doesNotMatch(JSON.stringify(publicOutput),/quoteId|fixture-active-account|private|signed_url|freePrompt/);
});
