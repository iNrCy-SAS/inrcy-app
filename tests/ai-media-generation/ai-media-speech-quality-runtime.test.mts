import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import { extractAiMediaRequestedDialogue, hasNaturalAiMediaSpeechFlow, resolveAiMediaDialogueSequence } from "../../lib/aiMediaDialogue.ts";

const requireFromTest = createRequire(import.meta.url);
const lines = [
  "Le robot plante un rosier dans le jardin.",
  "Regardez le robot déposer doucement la terre.",
  "Le rosier trouve sa place dans le jardin.",
];
const replies = [
  "Ses gestes accompagnent doucement la plantation.",
  "Cette terre accueille maintenant les racines.",
  "Les fleurs entourent désormais ce rosier.",
];
const scripts = {
  8: "Le robot plante un rosier dans le jardin avec soin.",
  16: "Le robot plante un rosier dans le jardin avec soin. Ses gestes précis accompagnent chaque étape de la plantation du rosier.",
  24: "Le robot plante un rosier dans le jardin avec soin. Ses gestes précis accompagnent chaque étape de la plantation du rosier. Le rosier trouve ainsi sa place au milieu des autres fleurs du jardin.",
};

function runtime(duration: 8 | 16 | 24, generated: readonly unknown[]) {
  const calls: Array<{ input: string; system: string }> = [];
  const diagnostics: unknown[][] = [];
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load<T = Record<string, unknown>>(name: string): T {
    const filename = path.resolve(name);
    if (cache.has(filename)) return cache.get(filename)!.exports as T;
    const record = { exports: {} as Record<string, unknown> };
    cache.set(filename, record);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function("module", "exports", "require", "console", output)(record, record.exports, (specifier: string) => {
      if (specifier === "server-only") return {};
      if (specifier === "@/lib/aiGatewayClient") return { aiGenerateJSON: async (args: { input: string; system: string }) => {
        calls.push(args);
        const result = generated[Math.min(calls.length - 1, generated.length - 1)];
        if (result instanceof Error) throw result;
        return result;
      } };
      if (specifier.startsWith("node:")) return requireFromTest(specifier);
      const local = specifier.startsWith("@/lib/") ? path.resolve("lib", specifier.slice(6))
        : specifier.startsWith(".") ? path.resolve(path.dirname(filename), specifier) : null;
      if (!local) throw new Error(`unexpected_test_dependency:${specifier}`);
      return load(local.endsWith(".ts") ? local : `${local}.ts`);
    }, { ...console, warn: (...args: unknown[]) => diagnostics.push(args) });
    return record.exports as T;
  }
  const profile = load<typeof import("../../lib/aiGenerationProfile.ts")>("lib/aiGenerationProfile.ts")
    .buildNormalizedAiGenerationProfile({ business: { company_name: "Atelier Horizon", profession: "Jardinier" }, preferences: { language: "fr" } });
  const request = load<typeof import("../../lib/aiMediaGenerationContracts.ts")>("lib/aiMediaGenerationContracts.ts")
    .normalizeAiMediaGenerationRequest({ requestId: `speech-${duration}`, source: "studio", kind: "video", durationSeconds: duration,
      subjectSource: "custom", idea: "Un robot plante un rosier dans le jardin", withNarration: true, withText: false, textMode: "none" });
  const plan = load<typeof import("../../lib/aiMediaCreativePlan.ts")>("lib/aiMediaCreativePlan.ts")
    .buildAiMediaCreativePlan({ request, profile });
  plan.scenes = plan.scenes.map((scene, index) => ({ ...scene, spokenLine: lines[index]!, spokenReply: replies[index]! }));
  return { load, calls, diagnostics, args: { accountId: "test-account", request, profile, plan } };
}

function generatedCopy(duration: 8 | 16 | 24) {
  return {
    headline: "Le robot plante un rosier", cta: "Parlons de votre jardin",
    scenes: lines.slice(0, duration / 8).map((spokenLine, index) => ({
      eyebrow: "Au jardin", title: `Le rosier et le robot ${index + 1}`, body: "", spokenLine, spokenReply: replies[index]!,
    })),
  };
}

for (const duration of [8, 16, 24] as const) {
  test(`la voix off ${duration} s garde sa phrase entière et son budget réel`, async () => {
    const env = runtime(duration, [{ script: scripts[duration] }]);
    const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
    assert.equal(result?.script, scripts[duration]);
    assert.equal(result?.source, "ai");
    assert.equal(env.calls.length, 1);
    assert.equal(JSON.parse(env.calls[0]!.input).adn_de_l_entreprise, null, "la voix d'un sujet libre ne reçoit pas les services de l'ADN");
    const count = scripts[duration].split(/\s+/u).length;
    assert.equal(result.wordCount, count);
    assert.ok(count / (120 / 60) <= duration - 1, "le budget tient au débit conversationnel demandé avec une seconde finale");
  });

  test(`le dialogue ${duration} s conserve ${duration / 8} actes distincts liés au brief`, async () => {
    const copy = generatedCopy(duration);
    const env = runtime(duration, [copy]);
    env.args.request.teamVideoSpeechMode = "characters";
    const result = await env.load<typeof import("../../lib/aiMediaCopywriter.ts")>("lib/aiMediaCopywriter.ts").writeAiMediaHeadline(env.args);
    assert.equal(env.calls.length, 1);
    assert.deepEqual(result.scenes.map((scene) => scene.spokenLine), lines.slice(0, duration / 8));
    assert.equal(new Set(result.scenes.flatMap((scene) => [scene.spokenLine, scene.spokenReply])).size, duration / 4);
    assert.ok(result.scenes.every((scene) => scene.spokenLine.split(/\s+/u).length <= 14));
  });

  test(`le secours voix off ${duration} s conserve un brief rédigé sans collage ni coupe`, async () => {
    const env = runtime(duration, [new Error("offline")]);
    env.args.request.idea = scripts[duration];
    env.args.plan.headline = "";
    env.args.plan.scenes = env.args.plan.scenes.map((scene) => ({ ...scene, spokenLine: "", title: "", body: "" }));
    const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
    assert.equal(result?.script, scripts[duration]);
    assert.equal(result?.source, "safe_fallback");
    assert.equal(env.calls.length, 3);
  });
}

const ceramicQuote = "Je façonne chaque pièce à la main, pour embellir votre quotidien.";
const ceramicBrief = `Dans un atelier de céramique lumineux, une céramiste adulte imaginaire façonne un vase sur son tour, puis regarde la caméra et dit naturellement en français : « ${ceramicQuote} » Garder cette phrase entière et synchroniser ses lèvres. Une seule scène continue, aucune voix off, aucun écran, aucune tablette, aucun texte incrusté.`;

test("régression QA personnage : la citation noText est verrouillée sans rédaction IA ni modification visuelle", async () => {
  const env = runtime(8, [new Error("aucun appel attendu")]);
  env.args.request.idea = ceramicBrief;
  env.args.request.aiInstruction = ceramicBrief;
  env.args.request.teamVideoSpeechMode = "characters";
  env.args.request.withNarration = false;
  env.args.plan.scenes[0]!.spokenLine = "Dans un atelier de céramique lumineux";
  const visualBefore = env.args.plan.scenes.map((scene) => scene.visualBrief);
  const result = await env.load<typeof import("../../lib/aiMediaCopywriter.ts")>("lib/aiMediaCopywriter.ts").writeAiMediaHeadline(env.args);
  assert.equal(env.calls.length, 0);
  assert.equal(result.scenes[0]!.spokenLine, ceramicQuote);
  assert.equal(result.scenes[0]!.spokenReply, "");
  assert.equal(result.scenes[0]!.title, "");
  assert.deepEqual(result.scenes.map((scene) => scene.visualBrief), visualBefore);
  assert.deepEqual(extractAiMediaRequestedDialogue(ceramicBrief), [ceramicQuote]);
  assert.deepEqual(extractAiMediaRequestedDialogue(`${ceramicBrief}\n${ceramicBrief}`), [ceramicQuote]);
  assert.deepEqual(extractAiMediaRequestedDialogue(`Elle dit : « ${ceramicQuote} » Puis elle répète et dit : « ${ceramicQuote} »`), [ceramicQuote, ceramicQuote]);
  assert.deepEqual(resolveAiMediaDialogueSequence({ scenes: env.args.plan.scenes, headline: "", language: "fr", requestedSpeech: ceramicBrief }), [ceramicQuote]);
});

test("un complément de lieu ne devient pas une phrase parlée grâce aux déterminants", () => {
  assert.equal(hasNaturalAiMediaSpeechFlow("Dans un atelier de céramique lumineux", "fr"), false);
  assert.equal(hasNaturalAiMediaSpeechFlow("Dans un atelier lumineux, elle façonne chaque pièce à la main.", "fr"), true);
  assert.equal(hasNaturalAiMediaSpeechFlow(ceramicQuote, "fr"), true);
});

test("la citation parlée ne doit pas être imposée au texte visible ni réécrite par le copywriter", async () => {
  const env = runtime(8, [{
    headline: "La céramique prend forme", cta: "Découvrez la céramique",
    scenes: [{ eyebrow: "À l’atelier", title: "La céramique prend forme", body: "Chaque vase prend forme à la main.",
      spokenLine: "La céramiste façonne un vase dans son atelier.", spokenReply: "Chaque geste accompagne doucement la création du vase." }],
  }]);
  env.args.request.idea = ceramicBrief;
  env.args.request.teamVideoSpeechMode = "characters";
  env.args.request.textMode = "ai";
  env.args.request.withText = true;
  const result = await env.load<typeof import("../../lib/aiMediaCopywriter.ts")>("lib/aiMediaCopywriter.ts").writeAiMediaHeadline(env.args);
  assert.equal(env.calls.length, 1);
  assert.equal(result.scenes[0]!.spokenLine, ceramicQuote);
  assert.equal(result.headline, "La céramique prend forme");
  assert.equal(JSON.parse(env.calls[0]!.input).adn_de_l_entreprise, null);
  assert.ok(!JSON.stringify(JSON.parse(env.calls[0]!.input).termes_obligatoires_exacts).includes(ceramicQuote.replace(/\.$/u, "")));
});

test("une citation parlée incompatible avec le budget échoue avant appel, sans substitution ni coupe", async () => {
  const env = runtime(8, [new Error("aucun appel attendu")]);
  env.args.request.idea = `La céramiste dit : « ${ceramicQuote} ${ceramicQuote} »`;
  env.args.request.teamVideoSpeechMode = "characters";
  await assert.rejects(() => env.load<typeof import("../../lib/aiMediaCopywriter.ts")>("lib/aiMediaCopywriter.ts").writeAiMediaHeadline(env.args), /ai_media_exact_dialogue_unfit/u);
  assert.equal(env.calls.length, 0);
});

test("les listes non ponctuées, fragments internes et répétitions restent refusés", () => {
  for (const value of [
    "Qualité écoute proximité savoir-faire service accompagnement confiance simplicité.",
    "Le robot apporte doucement le rosier avec. Nous préparons ensemble la terre du jardin.",
    "Le robot plante un rosier près de votre.",
    "Le robot plante un rosier. Le robot plante un rosier !",
  ]) assert.equal(hasNaturalAiMediaSpeechFlow(value, "fr"), false, value);
  assert.equal(hasNaturalAiMediaSpeechFlow(scripts[24], "fr"), true);
});

test("les refus voix off déclenchent une réécriture sans tronquer le brouillon", async () => {
  for (const invalid of [
    "Qualité écoute proximité savoir-faire service accompagnement confiance simplicité.",
    "Le robot plante un rosier près de votre.",
    `${scripts[8]} Nous préparons ensuite chaque détail de la plantation.`,
    "Nos boulangers préparent du pain frais chaque matin.",
  ]) {
    const env = runtime(8, [{ script: invalid }, { script: scripts[8] }]);
    env.args.profile.business.services.push("Nos boulangers préparent du pain frais chaque matin.");
    const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
    assert.equal(result?.script, scripts[8]);
    assert.equal(env.calls.length, 2, invalid);
    assert.equal(JSON.parse(env.calls[1]!.input).brouillon_rejete_a_ne_pas_reprendre, invalid);
  }
});

test("une répétition interne de voix off ne remplit pas artificiellement les 16 secondes", async () => {
  const env = runtime(16, [{ script: `${scripts[8]} ${scripts[8]}` }, { script: scripts[16] }]);
  const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
  assert.equal(result?.script, scripts[16]);
  assert.equal(env.calls.length, 2);
});

test("une réplique hors sujet ou dupliquée par une réponse est réécrite avant adaptation", async () => {
  for (const failure of ["off-topic", "duplicate-reply"] as const) {
    const invalid = generatedCopy(16);
    if (failure === "off-topic") invalid.scenes[0]!.spokenLine = "Nos boulangers préparent du pain frais chaque matin.";
    else invalid.scenes[0]!.spokenReply = invalid.scenes[1]!.spokenLine;
    const env = runtime(16, [invalid, generatedCopy(16)]);
    env.args.request.teamVideoSpeechMode = "characters";
    const result = await env.load<typeof import("../../lib/aiMediaCopywriter.ts")>("lib/aiMediaCopywriter.ts").writeAiMediaHeadline(env.args);
    assert.equal(env.calls.length, 2);
    assert.deepEqual(result.scenes.map((scene) => scene.spokenLine), lines.slice(0, 2));
  }
});

test("le secours réutilise une phrase entière du brief si les trois écritures sont rejetées", async () => {
  const env = runtime(8, [{ headline: "Une solution complète", cta: "Contactez-nous", scenes: [] }]);
  env.args.request.teamVideoSpeechMode = "characters";
  env.args.plan.scenes[0]!.spokenLine = "Oui";
  env.args.plan.scenes[0]!.body = "";
  env.args.plan.scenes[0]!.title = "Rosier";
  const result = await env.load<typeof import("../../lib/aiMediaCopywriter.ts")>("lib/aiMediaCopywriter.ts").writeAiMediaHeadline(env.args);
  assert.equal(result.scenes[0]!.spokenLine, env.args.request.idea);
  assert.equal(hasNaturalAiMediaSpeechFlow(result.scenes[0]!.spokenLine, "fr"), true);
  assert.equal(env.calls.length, 3);
});

const croissantsBrief = "Dans une boulangerie chaleureuse, un boulanger adulte sort une fournée de croissants dorés du four puis les pose sur le comptoir. Une voix off française naturelle invite à venir les déguster au petit déjeuner. Aucun prix ni promotion inventé. Une seule phrase complète, pas de liste de mots.";

test("régression QA8s : le secours prononce l'invitation demandée et garde le contexte sans doublon", async () => {
  const env = runtime(8, [new Error("provider secret-token private-prompt")]);
  env.args.request.idea = croissantsBrief;
  env.args.request.requestId = "b42017e2-0b95-418e-b4e9-3e30659f5a9c";
  env.args.plan.headline = "Croissants dorés";
  env.args.plan.cta = "Venez les déguster";
  env.args.plan.scenes = [{ ...env.args.plan.scenes[0]!, spokenLine: "Les croissants dorés sortent du four pour votre petit déjeuner.", body: "", title: "" }];
  const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
  assert.equal(result?.source, "safe_fallback");
  assert.equal(result?.script, "Les croissants dorés sortent du four pour votre petit déjeuner : venez les déguster.");
  assert.equal(result.wordCount, 14);
  assert.equal((result.script.match(/petit déjeuner/gu) || []).length, 1);
  assert.equal(hasNaturalAiMediaSpeechFlow(result.script, "fr"), true);
  assert.ok(result.wordCount / (120 / 60) <= 7);
  const diagnostics = JSON.stringify(env.diagnostics);
  assert.doesNotMatch(diagnostics, /secret-token|private-prompt|b42017e2|croissants dorés|test-account/u);
  assert.equal(env.diagnostics.length, 4);
  assert.match(diagnostics, /generation_error/u);
  assert.match(diagnostics, /grounded_local_copy/u);
});

test("la description seule est réécrite quand l'invitation est explicitement demandée", async () => {
  const env = runtime(8, [
    { script: "Les croissants dorés sortent du four pour votre petit déjeuner." },
    { script: "Venez déguster les croissants dorés qui sortent du four pour votre petit déjeuner." },
  ]);
  env.args.request.idea = croissantsBrief;
  const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
  assert.equal(result?.source, "ai");
  assert.equal(env.calls.length, 2);
  assert.match(result!.script, /^Venez déguster/u);
  assert.match(JSON.stringify(env.diagnostics), /requested_invitation_missing/u);
});

test("une interdiction d'inviter ne devient jamais une invitation ajoutée", async () => {
  const script = "Les croissants dorés sortent du four pour votre petit déjeuner.";
  const env = runtime(8, [{ script }]);
  env.args.request.idea = "Les croissants dorés sortent du four. La voix off n’invite pas à venir les déguster.";
  const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
  assert.equal(result?.script, script);
  assert.equal(result?.source, "ai");
  assert.equal(JSON.parse(env.calls[0]!.input).invitation_orale_prioritaire, null);
});

const floristBrief = "Dans l’atelier lumineux d’une fleuriste adulte, suivez la création d’un bouquet champêtre : elle choisit des fleurs, compose les couleurs puis noue un ruban. Une voix off française chaleureuse raconte ce soin artisanal et invite à offrir une attention personnalisée. Deux belles phrases liées, originales, complètes, adaptées aux seize secondes. Aucun prix, promotion ni service inventé. Pas d’écran ni de tablette.";

test("régression réelle16s : Offrez est une invitation et trois virgules réparties ne sont pas une liste", async () => {
  const script = "Dans son atelier lumineux, la fleuriste choisit les fleurs, compose les couleurs et noue soigneusement le ruban d’un bouquet champêtre. Offrez une attention personnalisée, façonnée avec soin.";
  const env = runtime(16, [{ script }]);
  env.args.request.idea = floristBrief;
  const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
  assert.equal(result?.script, script);
  assert.equal(result?.source, "ai");
  assert.equal(result?.wordCount, 27);
  assert.equal(env.calls.length, 1);
  assert.equal(hasNaturalAiMediaSpeechFlow("Qualité du service, proximité des équipes, écoute du client, confiance au quotidien.", "fr"), false);
});

test("le secours16s relie deux faits et une seule invitation, sans répéter celle-ci", async () => {
  const env = runtime(16, [new Error("offline")]);
  env.args.request.idea = floristBrief;
  env.args.plan.headline = "Bouquet champêtre";
  env.args.plan.cta = "Offrir une attention personnalisée";
  env.args.plan.scenes = [
    { ...env.args.plan.scenes[0]!, spokenLine: "Elle choisit chaque fleur pour composer un bouquet champêtre.", body: "", title: "" },
    { ...env.args.plan.scenes[1]!, spokenLine: "Puis elle noue le ruban, dernier geste de cette création.", body: "", title: "" },
  ];
  const result = await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
  assert.equal(result?.source, "safe_fallback");
  assert.match(result!.script, /bouquet|fleur/u);
  assert.match(result!.script, /invitons à offrir une attention personnalisée/u);
  assert.equal((result!.script.match(/invitons/gu) || []).length, 1);
  assert.ok(result!.wordCount >= 20 && result!.wordCount <= 30);
  assert.equal(result!.script.split(/[.!?]+/u).filter((sentence) => sentence.trim()).length, 2);
  assert.equal(hasNaturalAiMediaSpeechFlow(result!.script, "fr"), true);
});

for (const duration of [8, 16, 24] as const) {
  test(`le plafond voix off ${duration}s réserve une seconde au débit demandé sans remplissage forcé`, async () => {
    const env = runtime(duration, [{ script: scripts[duration] }]);
    await env.load<typeof import("../../lib/aiMediaNarration.ts")>("lib/aiMediaNarration.ts").writeAiMediaNarration(env.args);
    const limits = env.calls[0]!.system.match(/exactement (\d+) mots.*?entre (\d+) et (\d+) mots/u);
    assert.ok(limits);
    const target = Number(limits[1]);
    const maximum = Number(limits[3]);
    assert.ok(target / 2 >= duration * 0.8);
    assert.ok(maximum / 2 <= duration - 1);
  });
}
