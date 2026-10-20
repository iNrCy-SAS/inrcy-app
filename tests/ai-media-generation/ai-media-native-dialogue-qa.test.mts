import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { extractAiMediaPronunciationAliases } from "../../lib/aiMediaPronunciation.ts";
import { splitAiMediaSpokenScript } from "../../lib/aiMediaSpokenScript.ts";

import {
  auditAiMediaNativeDialogueClips,
  evaluateAiMediaNativeDialogue,
  tokenizeAiMediaNativeDialogue,
  type AiMediaNativeDialogueQaClip,
} from "../../lib/aiMediaNativeDialogueQa.ts";

const ROOT = process.cwd();

test("an exact explicit script split across clips is not rejected for a planned internal fragment", async () => {
  const script = "Notre outil facilite la création de contenus pour communiquer avec vos clients.";
  const lines = splitAiMediaSpokenScript(script, [8, 8]);
  assert.equal(lines.join(""), script);
  assert.equal(lines[0].trim(), "Notre outil facilite la création de");
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine: lines[0], transcript: lines[0] }).status, "rejected");
  const result = await auditAiMediaNativeDialogueClips({
    clips: lines.map((expectedLine, sceneIndex) => fakeClip({
      sceneIndex, expectedLine, expectedContinuation: lines.slice(sceneIndex + 1).some((line) => Boolean(line.trim())),
    })),
    transcribe: async (clip) => ({ text: clip.expectedLine }),
    confirm: async () => { assert.fail("The complete expected fragment is already conforming."); },
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.clips.map((clip) => clip.status), ["passed", "passed"]);
});

test("planned continuation never excuses missing words, changed values or an unexpected incomplete tail", () => {
  const expectedLine = "Notre offre ne comprend pas la livraison et coûte 50 euros pour";
  for (const transcript of [
    expectedLine.replace("la livraison ", ""),
    expectedLine.replace("50", "500"),
    expectedLine.replace("ne comprend pas", "comprend"),
    `${expectedLine} une`,
  ]) {
    const result = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, expectedContinuation: true });
    assert.equal(result.status, "rejected", transcript);
  }
  const finalFragment = evaluateAiMediaNativeDialogue({ sceneIndex: 1, expectedLine, transcript: expectedLine, expectedContinuation: false });
  assert.equal(finalFragment.status, "rejected");
  assert.ok(finalFragment.issues.includes("spoken_dialogue_incomplete"));
});

test("the requested phonetic spelling is accepted locally only with its explicit pronunciation alias", async () => {
  const expectedLine = "Je suis Océane et je représente iNrCy pour accompagner votre entreprise.";
  const transcript = expectedLine.replace("iNrCy", "inertie");
  const pronunciationAliases = extractAiMediaPronunciationAliases("iNrCy se prononce « inertie ».");
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript }).status, "rejected");
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, pronunciationAliases }).status, "passed");
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], pronunciationAliases,
    transcribe: async () => ({ text: transcript }),
    confirm: async () => { assert.fail("An explicitly correct pronunciation needs no second ASR."); },
  });
  assert.equal(result.status, "passed");
  assert.doesNotMatch(JSON.stringify(result), /iNrCy|inertie|pronunciationalias/);
  assert.equal(expectedLine, "Je suis Océane et je représente iNrCy pour accompagner votre entreprise.");
});

test("an explicit sound alias does not excuse a different name, wrong amount, negation or another proper name", () => {
  const expectedLine = "Avec iNrCy à Bordeaux, notre offre ne comprend pas la livraison et coûte 50 euros seulement.";
  const pronunciationAliases = extractAiMediaPronunciationAliases("Prononciation de iNrCy : « inertie ».");
  for (const transcript of [
    expectedLine.replace("iNrCy", "autre chose"),
    expectedLine.replace("iNrCy", "inertie").replace("50", "500"),
    expectedLine.replace("iNrCy", "inertie").replace("ne comprend pas", "comprend"),
    expectedLine.replace("iNrCy", "inertie").replace("Bordeaux", "Lyon"),
  ]) {
    const result = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, pronunciationAliases });
    assert.equal(result.status, "rejected");
    assert.ok(result.issues.includes("spoken_critical_value_mismatch"));
  }
  const irrelevantAlias = extractAiMediaPronunciationAliases("AutreNom se prononce « inertie ».");
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: expectedLine.replace("iNrCy", "inertie"), pronunciationAliases: irrelevantAlias }).status, "rejected");
});

test("documented French inertie spellings require an explicit sound guide and never change the script or transcript", async () => {
  const expectedLine = "Bonjour, je suis Océane. Avec CréaMotion, créez vos contenus, vos images et vos vidéos.";
  const pronunciationAliases = Object.freeze(extractAiMediaPronunciationAliases("CréaMotion se prononce « inertie ».").map(alias => Object.freeze(alias)));
  for (const spelling of ["inercie", "Inercy", "Inersie", "Inersy"]) {
    const transcript = expectedLine.replace("CréaMotion", spelling);
    const input = Object.freeze({ sceneIndex: 0, expectedLine, transcript, pronunciationAliases, language: "fr-FR" });
    assert.equal(evaluateAiMediaNativeDialogue(input).status, "passed");
    assert.equal(evaluateAiMediaNativeDialogue({ ...input, pronunciationAliases: undefined }).status, "rejected");
    assert.equal(evaluateAiMediaNativeDialogue({ ...input, language: "en" }).status, "rejected");
    assert.equal(evaluateAiMediaNativeDialogue({ ...input, pronunciationAliases: extractAiMediaPronunciationAliases("AutreMarque se prononce « inertie ».") }).status, "rejected");
    assert.equal(evaluateAiMediaNativeDialogue({ ...input, pronunciationAliases: [{ spelling: "CréaMotion", pronunciation: "inertiel" }] }).status, "rejected");
    assert.equal(input.expectedLine, expectedLine);
    assert.equal(input.transcript, transcript);
    const audited = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })], language: "fr", pronunciationAliases,
      transcribe: async () => ({ text: transcript }),
      confirm: async () => { assert.fail("A documented spelling of the explicitly requested sound needs no extra ASR."); },
    });
    assert.equal(audited.status, "passed");
    assert.doesNotMatch(JSON.stringify(audited), /CréaMotion|Iner[cs]|inercie|pronunciationalias/);
  }
});

test("an explicit French sound guide never excuses missing sounds, other names, amounts, negation or repetitions", () => {
  const expectedLine = "Avec CréaMotion à Bordeaux, notre offre ne comprend pas la livraison et coûte 50 euros seulement.";
  const pronunciationAliases = extractAiMediaPronunciationAliases("CréaMotion se prononce « inertie ».");
  const valid = expectedLine.replace("CréaMotion", "Inersie");
  for (const transcript of [
    ...["Insi", "Innoci", "Inersys", "Inerzia", "Inertiel", "Finersie", "Finercy", "AutreMarque"].map(name => expectedLine.replace("CréaMotion", name)),
    valid.replace("50", "500"), valid.replace("euros", "dollars"),
    valid.replace("ne comprend pas", "comprend"), valid.replace("Bordeaux", "Lyon"),
    valid.replace("Inersie", "Inersie Inersy"), `${valid} ${valid}`,
    valid.replace("Inersie", "Inercy").replace("50", "500"),
    valid.replace("Inersie", "Inercy").replace("ne comprend pas", "comprend"),
    valid.replace("Inersie", "Inercy").replace("Bordeaux", "Lyon"),
    valid.replace("Inersie", "Inercy Inercy"),
  ]) {
    assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, pronunciationAliases, language: "fr" }).status, "rejected", transcript);
  }
});

test("independent transcriptions with the documented alias still confirm a wrong amount", async () => {
  const expectedLine = "Avec CréaMotion, notre offre coûte 50 euros seulement.";
  const pronunciationAliases = extractAiMediaPronunciationAliases("CréaMotion se prononce « inertie ».");
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], language: "fr", pronunciationAliases,
    transcribe: async () => ({ text: expectedLine.replace("CréaMotion", "Inersy").replace("50", "500") }),
    confirm: async () => ({ text: expectedLine.replace("CréaMotion", "Inersie").replace("50", "500") }),
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.clips[0].confirmation, "rejected");
  assert.ok(result.clips[0].issues.includes("spoken_critical_value_mismatch"));
});

test("phonetic alias matching respects token boundaries and preserves unintended repetitions", () => {
  const pronunciationAliases = extractAiMediaPronunciationAliases("iNrCy se prononce « in er si ».");
  const expectedLine = "Découvrez iNrCy pour votre entreprise.";
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: "Découvrez in er si pour votre entreprise.", pronunciationAliases }).status, "passed");
  for (const transcript of [
    "Découvrez in er si in er si pour votre entreprise.",
    "Découvrez fin er si pour votre entreprise.",
  ]) assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, pronunciationAliases }).status, "rejected");
});

test("an explicit multiword pronunciation accepts ASR word joining without inferring a brand pronunciation", async () => {
  const expectedLine = "Notre module NovaDesk accompagne votre entreprise sur les moteurs de recherche.";
  const pronunciationAliases = Object.freeze(extractAiMediaPronunciationAliases("NovaDesk se prononce « Inner Search ».").map(alias => Object.freeze(alias)));
  for (const spelling of ["Inner Search", "InnerSearch", "INNERSEARCH"]) {
    const transcript = expectedLine.replace("NovaDesk", spelling);
    const input = Object.freeze({ sceneIndex: 0, expectedLine, transcript, pronunciationAliases, language: "fr" });
    const result = evaluateAiMediaNativeDialogue(input);
    assert.equal(result.status, "passed", spelling);
    assert.equal(result.metrics.expectedTokenCount, result.metrics.detectedTokenCount);
    assert.equal(evaluateAiMediaNativeDialogue({ ...input, pronunciationAliases: undefined }).status, "rejected");
    assert.equal(evaluateAiMediaNativeDialogue({ ...input, pronunciationAliases: [{ spelling: "AutreNom", pronunciation: "Inner Search" }] }).status, "rejected");
    assert.equal(input.transcript, transcript);
    const audit = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })], pronunciationAliases,
      transcribe: async () => ({ text: transcript }),
      confirm: async () => { assert.fail("Exact letters of the explicitly supplied sound guide need no additional ASR."); },
    });
    assert.equal(audit.status, "passed");
    assert.doesNotMatch(JSON.stringify(audit), /NovaDesk|Inner|pronunciationalias/);
  }
});

test("joining an explicit sound guide cannot remove sounds, swallow adjacent words or excuse critical changes", async () => {
  const expectedLine = "Avec NovaDesk à Bordeaux, notre offre ne comprend pas la livraison et coûte 50 euros seulement.";
  const pronunciationAliases = extractAiMediaPronunciationAliases("NovaDesk se prononce « Inner Search ».");
  const valid = expectedLine.replace("NovaDesk", "InnerSearch");
  for (const transcript of [
    ...["InSearch", "InnerSeach", "InnerSerch", "InnerSearchx", "InnerSearchà", "FinInnerSearch", "InnerSearch Inner Search"].map(name => expectedLine.replace("NovaDesk", name)),
    valid.replace("50", "500"), valid.replace("euros", "dollars"), valid.replace("ne comprend pas", "comprend"),
    valid.replace("Bordeaux", "Lyon"), `${valid} ${valid}`,
  ]) {
    assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, pronunciationAliases }).status, "rejected", transcript);
  }
  const rejected = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], pronunciationAliases,
    transcribe: async () => ({ text: valid.replace("50", "500") }),
    confirm: async () => ({ text: valid.replace("InnerSearch", "Inner Search").replace("50", "500") }),
  });
  assert.equal(rejected.status, "rejected");
  assert.ok(rejected.clips[0].issues.includes("spoken_critical_value_mismatch"));
});

test("joined pronunciation normalization stays bounded to short lexical guides", () => {
  const expectedLine = "Découvrez NovaDesk pour votre entreprise.";
  for (const pronunciation of ["Inner Search Studio Connect Plus", "The Rapist", "Sans Souci", "Dix Mille", "Lundi Matin", "Vingt Euros"]) {
    const pronunciationAliases = [{ spelling: "NovaDesk", pronunciation }];
    const transcript = expectedLine.replace("NovaDesk", pronunciation.replaceAll(" ", ""));
    assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, pronunciationAliases }).status, "rejected", pronunciation);
  }
});

test("real pitch ASR: Inner Search needs a declared pronunciation and never a product-specific guess", async () => {
  const expectedLine = "Depuis un seul espace, il diffuse sur douze canaux, dont Google et les réseaux sociaux. Notre module iNrSearch aide à accroître sa visibilité sur les moteurs d’intelligence artificielle.";
  const transcript = "Depuis un seul espace, il diffuse sur 12 canaux, dont Google et les réseaux sociaux. Notre module Inner Search aide à accroître sa visibilité sur les moteurs d'intelligence artificielle.";
  const unrelatedGuide = extractAiMediaPronunciationAliases("iNrCy se prononce « inertie ».");
  const undeclared = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], pronunciationAliases: unrelatedGuide,
    transcribe: async () => ({ text: transcript }), confirm: async () => ({ text: transcript }),
  });
  assert.equal(undeclared.status, "rejected");
  const pronunciationAliases = extractAiMediaPronunciationAliases("iNrSearch se prononce « Inner Search ».");
  for (const spokenName of ["Inner Search", "InnerSearch"]) {
    const result = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: transcript.replace("Inner Search", spokenName), pronunciationAliases });
    assert.equal(result.status, "passed");
    assert.equal(result.metrics.expectedCoverage, 1);
  }
});

test("real pitch ASR: a corrupt brand and verb are rejected, not repaired by a sound alias", async () => {
  const expectedLine = "Je suis Océane, cofondatrice et directrice générale. iNrCy rend la communication simple, rapide et accessible. Prenez un paysagiste. Difficile de préparer sa communication du haut d’un arbre !";
  const transcript = "Je suis Océane, cofondatrice et directrice générale. Inessire en la communication simple, rapide et accessible. Prenez un paysagiste. Difficile de préparer sa communication du haut d’un arbre.";
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], pronunciationAliases: extractAiMediaPronunciationAliases("iNrCy se prononce « inertie »."),
    transcribe: async () => ({ text: transcript }), confirm: async () => ({ text: transcript }),
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.clips[0].issues.includes("spoken_critical_value_mismatch"));
  assert.doesNotMatch(JSON.stringify(result), /Inessire|Océane|arbre/);
});

test("real pitch ASR: divergent wrong brand readings remain inconclusive and never become passed", async () => {
  const expectedLine = "Environ cent utilisateurs paient déjà pour iNrCy. Notre fiche Google affiche soixante-cinq avis, avec une note moyenne de cinq sur cinq. Leurs retours soulignent simplicité et temps gagné.";
  const first = "Environ 100 utilisateurs payent déjà pour In Reci. Notre fiche Google affiche 65 avis avec une note moyenne de 5 sur 5. Leurs retours soulignent simplicité et engagné.";
  const second = "Environ 100 utilisateurs paient déjà pour une récit. Notre fiche Google affiche 65 avis, avec une note moyenne de 5 sur 5. Le retour souligne simplicité et en gagné.";
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], pronunciationAliases: extractAiMediaPronunciationAliases("iNrCy se prononce « inertie »."),
    transcribe: async () => ({ text: first }), confirm: async () => ({ text: second }),
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.clips[0].issues, ["transcription_inconclusive"]);
  assert.equal(result.clips[0].confirmation, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /In Reci|récit|engagné|Google/);
});

test("independent audio proof may resolve one undeclared brand after two concordant, otherwise exact ASR reads", async () => {
  const expectedLine = "Depuis un seul espace, il diffuse sur douze canaux, dont Google et les réseaux sociaux. Notre module iNrSearch aide à accroître sa visibilité sur les moteurs d’intelligence artificielle.";
  const transcript = "Depuis un seul espace, il diffuse sur 12 canaux, dont Google et les réseaux sociaux. Notre module Inner Search aide à accroître sa visibilité sur les moteurs d'intelligence artificielle.";
  const clip = Object.freeze(fakeClip({ expectedLine, sourceStartSeconds: 16, durationSeconds: 15 }));
  const originalClip = { ...clip };
  const calls: string[] = [];
  const pronunciationAliases = Object.freeze([{ spelling: "iNrCy", pronunciation: "inertie" }]);
  const result = await auditAiMediaNativeDialogueClips({
    clips: [clip], pronunciationAliases,
    transcribe: async () => { calls.push("first"); return { text: transcript, model: "asr-test" }; },
    confirm: async () => { calls.push("second"); return { text: transcript, model: "asr-test" }; },
    verifyPronunciation: async (input, options) => {
      calls.push("audio-proof");
      assert.equal(input, clip);
      assert.equal(input.sourceStartSeconds, 16);
      assert.equal(input.durationSeconds, 15);
      assert.equal(options.language, "fr");
      assert.deepEqual(options.candidate, { expectedName: "iNrSearch", transcribedName: "inner search" });
      assert.equal("transcript" in options, false);
      assert.equal("expectedLine" in options, false);
      return { status: "verified", model: "audio-proof-test" };
    },
  });
  assert.deepEqual(calls, ["first", "second", "audio-proof"]);
  assert.equal(result.status, "passed");
  assert.equal(result.clips[0].confirmation, "passed");
  assert.equal(result.clips[0].pronunciationVerification, "verified");
  assert.equal(result.clips[0].metrics.expectedCoverage, 1);
  assert.equal(result.clips[0].metrics.bestWindowSimilarity, 1);
  assert.equal(result.clips[0].metrics.extraTokenCount, 0);
  assert.equal(result.model, "asr-test,audio-proof-test");
  assert.deepEqual(clip, originalClip);
  assert.deepEqual(pronunciationAliases, [{ spelling: "iNrCy", pronunciation: "inertie" }]);
  assert.doesNotMatch(JSON.stringify(result), /iNrSearch|inner search|Google|intelligence|pronunciationalias|video/);
});

test("targeted audio proof is generic and any equivalent spelling is scoped to that clip only", async () => {
  const expectedLine = "Le module NovaDesk accompagne votre entreprise pour publier les contenus rapidement.";
  const spoken = expectedLine.replace("NovaDesk", "Nova Desk");
  const clips = [fakeClip({ expectedLine }), fakeClip({ sceneIndex: 1, expectedLine })];
  const checked: number[] = [];
  const result = await auditAiMediaNativeDialogueClips({
    clips,
    transcribe: async () => ({ text: spoken }), confirm: async () => ({ text: spoken }),
    verifyPronunciation: async (clip, { candidate }) => {
      checked.push(clip.sceneIndex);
      assert.deepEqual(candidate, { expectedName: "NovaDesk", transcribedName: "nova desk" });
      return { status: clip.sceneIndex === 0 ? "verified" : "rejected" };
    },
  });
  assert.deepEqual(checked.sort(), [0, 1]);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.clips.map(clip => clip.status), ["passed", "rejected"]);
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: spoken }).status, "rejected");
});

test("missing, refused, inconclusive or failed phonetic proof never delivers a rejected brand", async () => {
  const expectedLine = "Le module NovaDesk accompagne votre entreprise pour publier les contenus rapidement.";
  const transcript = expectedLine.replace("NovaDesk", "Nova Desk");
  for (const proof of ["missing", "rejected", "unavailable", "error"] as const) {
    let proofCalls = 0;
    const result = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })],
      transcribe: async () => ({ text: transcript }), confirm: async () => ({ text: transcript }),
      ...(proof === "missing" ? {} : { verifyPronunciation: async () => {
        proofCalls++;
        if (proof === "error") throw new DOMException("Audio proof deadline", "TimeoutError");
        return { status: proof };
      } }),
    });
    assert.equal(proofCalls, proof === "missing" ? 0 : 1);
    assert.equal(result.status, proof === "missing" || proof === "rejected" ? "rejected" : "unavailable");
    assert.equal(result.clips[0].pronunciationVerification, proof === "missing" ? undefined : proof === "error" ? "unavailable" : proof);
    assert.doesNotMatch(JSON.stringify(result), /NovaDesk|nova desk|deadline/);
  }
});

test("a verifier is never allowed to override an explicit sound guide, even for a convincing ASR brand spelling", async () => {
  const expectedLine = "Le module NovaDesk accompagne votre entreprise pour publier les contenus rapidement.";
  for (const pronunciation of ["inertie", "Super Studio"]) {
    const result = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })], pronunciationAliases: [{ spelling: "novadesk", pronunciation }],
      transcribe: async () => ({ text: expectedLine.replace("NovaDesk", "Nova Desk") }),
      confirm: async () => ({ text: expectedLine.replace("NovaDesk", "Nova Desk") }),
      verifyPronunciation: async () => { assert.fail("An explicit sound guide is inviolable."); },
    });
    assert.equal(result.status, "rejected");
  }
});

test("audio proof requires two concordant readings of the same isolated span, not merely high sentence similarity", async () => {
  const expectedLine = "Notre module NovaDesk permet de préparer facilement tous vos contenus et de les diffuser sur plusieurs canaux pour faire connaître votre entreprise et partager vos dernières nouveautés auprès de tous vos clients.";
  for (const [first, second] of [
    [expectedLine.replace("NovaDesk", "Nova Desk"), expectedLine.replace("NovaDesk", "Nouveau Desk")],
    [expectedLine.replace("NovaDesk", "Nova Desk"), expectedLine.replace("NovaDesk", "Nova Desks")],
    [expectedLine.replace("NovaDesk", "Nova Desk"), expectedLine.replace("NovaDesk", "Nova Desk").replace("préparer", "créer")],
  ]) {
    const result = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })],
      transcribe: async () => ({ text: first }), confirm: async () => ({ text: second }),
      verifyPronunciation: async () => { assert.fail("Divergent wrong reads are not phonetic evidence."); },
    });
    assert.notEqual(result.status, "passed");
    assert.equal(result.clips[0].pronunciationVerification, undefined);
  }
  const unconfirmed = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], transcribe: async () => ({ text: expectedLine.replace("NovaDesk", "Nova Desk") }),
    verifyPronunciation: async () => { assert.fail("One read is insufficient."); },
  });
  assert.equal(unconfirmed.status, "unavailable");
});

test("audio proof cannot repair numbers, negations, calendar values, units, names, word order, repetitions or other words", async () => {
  const expectedLine = "Notre module NovaDesk à Bordeaux ne comprend pas la livraison et coûte 50 euros depuis le premier septembre pour accompagner votre entreprise.";
  const candidate = expectedLine.replace("NovaDesk", "Nova Desk");
  for (const transcript of [
    candidate.replace("50", "500"), candidate.replace("euros", "dollars"), candidate.replace("ne comprend pas", "comprend"),
    candidate.replace("septembre", "octobre"), candidate.replace("premier", "deuxième"), candidate.replace("Bordeaux", "Lyon"),
    candidate.replace("accompagner", "aider"), candidate.replace("votre entreprise", "entreprise votre"),
    candidate.replace("la livraison", "livraison"), candidate.replace("la livraison", "la belle livraison"),
    candidate.replace("Nova Desk", "Nova Desk Nova Desk"), `${candidate} Votre entreprise.`,
  ]) {
    const result = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })], transcribe: async () => ({ text: transcript }), confirm: async () => ({ text: transcript }),
      verifyPronunciation: async () => { assert.fail(`Cannot relax another defect: ${transcript}`); },
    });
    assert.equal(result.status, "rejected", transcript);
    assert.equal(result.clips[0].pronunciationVerification, undefined);
  }
});

test("phonetic evidence must reject an extra lexical word inside an ambiguous multiword brand span", async () => {
  const expectedLine = "Notre module NovaDesk accompagne votre entreprise avec des contenus de qualité.";
  const transcript = expectedLine.replace("NovaDesk", "Nova Desk rend");
  let proofCalls = 0;
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })],
    transcribe: async () => ({ text: transcript }), confirm: async () => ({ text: transcript }),
    verifyPronunciation: async (_, { candidate }) => {
      proofCalls++;
      assert.deepEqual(candidate, { expectedName: "NovaDesk", transcribedName: "nova desk rend" });
      return { status: "rejected" };
    },
  });
  assert.equal(proofCalls, 1);
  assert.equal(result.status, "rejected");
  assert.equal(result.clips[0].pronunciationVerification, "rejected");
});

test("audio-proof candidates exclude common words, acronyms, grammatical and critical spans, and ambiguous multiple brands", async () => {
  const line = "Notre module NovaDesk accompagne votre entreprise pour publier les contenus rapidement.";
  const pairs = [
    [line.replace("NovaDesk", "Bordeaux"), line.replace("NovaDesk", "Bord Eau")],
    [line.replace("NovaDesk", "NASA"), line.replace("NovaDesk", "Nassa")],
    [line.replace("NovaDesk", "Nova2Desk"), line.replace("NovaDesk", "Nova Desk")],
    [line.replace("NovaDesk", "notre"), line.replace("NovaDesk", "votre")],
    [line, line.replace("NovaDesk", "la nouvelle")],
    [line, line.replace("NovaDesk", "sans souci")],
    [line, line.replace("NovaDesk", "dix mille")],
    [line, line.replace("NovaDesk", "lundi matin")],
    [line, line.replace("NovaDesk", "dix euros")],
    [line, line.replace("NovaDesk", "Nova Desk Studio Connect Plus")],
    [line.replace("NovaDesk", "NovaDesk UltraCloud"), line.replace("NovaDesk", "Nova Desk Ultra Cloud")],
    [line.replace("NovaDesk", "NovaDesk NovaDesk"), line.replace("NovaDesk", "Nova Desk Nova Desk")],
  ];
  for (const [expectedLine, transcript] of pairs) {
    const result = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })], transcribe: async () => ({ text: transcript }), confirm: async () => ({ text: transcript }),
      verifyPronunciation: async () => { assert.fail(`Not a bounded brand candidate: ${transcript}`); },
    });
    assert.equal(result.clips[0].pronunciationVerification, undefined);
    // A harmless ordinary ASR variation may pass existing checks, but must never
    // obtain an invented pronunciation equivalence through this new mechanism.
    if (expectedLine.includes("NovaDesk")) assert.equal(result.status, "rejected", transcript);
  }
});

test("audio proof never suppresses inter-clip repetition or confirms a clip that already passed", async () => {
  const previousLine = "Votre entreprise évolue plus facilement.";
  const expectedLine = "Notre module NovaDesk accompagne votre entreprise avec des contenus de qualité.";
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine: previousLine }), fakeClip({ sceneIndex: 1, expectedLine })],
    transcribe: async clip => ({ text: clip.sceneIndex === 0 ? previousLine : `${expectedLine.replace("NovaDesk", "Nova Desk")} Plus facilement.` }),
    confirm: async clip => ({ text: clip.sceneIndex === 0 ? previousLine : `${expectedLine.replace("NovaDesk", "Nova Desk")} Plus facilement.` }),
    verifyPronunciation: async () => { assert.fail("Inter-clip repetition remains a defect."); },
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.clips[1].issues.includes("spoken_dialogue_repeated"));
  const passed = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], transcribe: async clip => ({ text: clip.expectedLine }),
    verifyPronunciation: async () => { assert.fail("No extra proof is needed for conforming speech."); },
  });
  assert.equal(passed.status, "passed");
});

test("caller cancellation interrupts the targeted audio proof and never becomes an accepted clip", async () => {
  const controller = new AbortController();
  const expectedLine = "Notre module NovaDesk accompagne votre entreprise avec des contenus de qualité.";
  const transcript = expectedLine.replace("NovaDesk", "Nova Desk");
  await assert.rejects(auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], signal: controller.signal,
    transcribe: async () => ({ text: transcript }), confirm: async () => ({ text: transcript }),
    verifyPronunciation: async (_, { signal }) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      return { status: "verified" };
    },
  }), { name: "AbortError" });
});

test("critical prices, times and negations cannot pass on high overall word overlap", () => {
  const pairs = [
    ["Notre offre est disponible pour 50 euros seulement.", "Notre offre est disponible pour 500 euros seulement."],
    ["Retrouvez notre équipe samedi à 10 heures.", "Retrouvez notre équipe samedi à 18 heures."],
    ["Nous sommes ouverts tous les jours sauf le dimanche.", "Nous sommes ouverts tous les jours le dimanche."],
    ["Notre offre ne comprend pas la livraison.", "Notre offre comprend la livraison."],
    ["Retrouvez notre équipe samedi à 10 heures.", "Retrouvez notre équipe dimanche à 10 heures."],
    ["Retrouvez notre équipe à Bordeaux pour préparer votre prochain projet.", "Retrouvez notre équipe à Lyon pour préparer votre prochain projet."],
  ];
  for (const [expectedLine, transcript] of pairs) {
    const result = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, language: "fr" });
    assert.equal(result.status, "rejected", transcript);
    assert.ok(result.issues.includes("spoken_critical_value_mismatch"));
    assert.ok(!JSON.stringify(result).includes(transcript));
  }
});

test("ASR written French and English numbers are equivalent to figures", () => {
  for (const [language, expectedLine, transcript] of [
    ["fr", "Notre offre coûte 50 euros seulement.", "Notre offre coûte cinquante euros seulement."],
    ["fr", "Notre offre coûte 500 euros seulement.", "Notre offre coûte cinq cents euros seulement."],
    ["fr", "Notre offre coûte 49,90 euros seulement.", "Notre offre coûte quarante-neuf virgule quatre-vingt-dix euros seulement."],
    ["fr", "Notre offre coûte 1 500 euros seulement.", "Notre offre coûte mille cinq cents euros seulement."],
    ["fr", "Retrouvez notre équipe à 10 heures.", "Retrouvez notre équipe à dix heures."],
    ["en", "Our offer costs 50 dollars today.", "Our offer costs fifty dollars today."],
  ]) assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, language }).status, "passed", transcript);
});

test("French first ordinals match ASR abbreviations while preserving their value and gender", () => {
  for (const [expectedLine, transcript] of [
    ["Notre lancement a eu lieu le premier septembre 2026.", "Notre lancement a eu lieu le 1er septembre 2026."],
    ["Notre lancement a eu lieu le premier septembre 2026.", "Notre lancement a eu lieu le 1ᵉʳ septembre 2026."],
    ["Notre première cliente rejoint notre réseau.", "Notre 1re cliente rejoint notre réseau."],
    ["Notre Première cliente rejoint notre réseau.", "Notre 1ère cliente rejoint notre réseau."],
    ["Le Premier septembre marque notre lancement.", "Le 1er septembre marque notre lancement."],
  ]) {
    const input = Object.freeze({ sceneIndex: 0, expectedLine, transcript, language: "fr-FR" });
    assert.equal(evaluateAiMediaNativeDialogue(input).status, "passed", transcript);
    assert.equal(evaluateAiMediaNativeDialogue({ ...input, expectedLine: transcript, transcript: expectedLine }).status, "passed", expectedLine);
    assert.equal(input.expectedLine, expectedLine);
    assert.equal(input.transcript, transcript);
  }
});

test("French first-ordinal typography cannot excuse another ordinal, cardinal, amount, year, month or name", () => {
  const expectedLine = "Le lancement du premier septembre 2026 à Bordeaux coûte 50 euros seulement.";
  for (const transcript of [
    expectedLine.replace("premier", "deuxième"), expectedLine.replace("premier", "2e"),
    expectedLine.replace("premier", "1"), expectedLine.replace("premier", "première"),
    expectedLine.replace("premier", "1err"), expectedLine.replace("50", "500"),
    expectedLine.replace("2026", "2025"), expectedLine.replace("septembre", "octobre"),
    expectedLine.replace("Bordeaux", "Lyon"),
  ]) {
    const result = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript, language: "fr" });
    assert.equal(result.status, "rejected", transcript);
    assert.ok(result.issues.includes("spoken_critical_value_mismatch"), transcript);
  }
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: expectedLine.replace("premier", "1er"), language: "en" }).status, "rejected");
});

test("French date typography and an explicit pronunciation alias combine without another transcription", async () => {
  const expectedLine = "Depuis le premier septembre 2026, CréaMotion accompagne votre entreprise.";
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], language: "fr",
    pronunciationAliases: extractAiMediaPronunciationAliases("CréaMotion se prononce « inertie »."),
    transcribe: async () => ({ text: expectedLine.replace("premier", "1er").replace("CréaMotion", "Inersie") }),
    confirm: async () => { assert.fail("The same ordinal and explicit sound already match without a second ASR."); },
  });
  assert.equal(result.status, "passed");
});

function fakeClip(overrides: Partial<AiMediaNativeDialogueQaClip> = {}): AiMediaNativeDialogueQaClip {
  return {
    sceneIndex: 0,
    buffer: Buffer.from("video"),
    mediaType: "video/mp4",
    durationSeconds: 8,
    sourceStartSeconds: 0,
    expectedLine: "Votre projet avance avec une méthode claire.",
    ...overrides,
  };
}

test("a near-complete transcript is independently confirmed without relaxing dialogue validation", async () => {
  const expectedLine = "Nous accompagnons votre projet avec une écoute attentive et des conseils personnalisés.";
  const initial = "Nous accompagnons votre projet avec une écoute attentive et des conseils";
  for (const outcome of ["complete", "still-cut", "unavailable"] as const) {
    let confirmations = 0;
    const result = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })],
      transcribe: async () => ({ text: initial, model: "offline-asr" }),
      confirm: async () => {
        confirmations++;
        if (outcome === "unavailable") throw new Error("QA deadline");
        return { text: outcome === "complete" ? expectedLine : initial, model: "offline-asr" };
      },
    });
    assert.equal(confirmations, 1);
    assert.equal(result.status, outcome === "complete" ? "passed" : outcome === "still-cut" ? "rejected" : "unavailable");
    assert.equal(result.clips[0].confirmation, outcome === "complete" ? "passed" : outcome === "still-cut" ? "rejected" : "unavailable");
    if (outcome === "still-cut") assert.ok(result.clips[0].issues.includes("spoken_dialogue_incomplete"));
    if (outcome === "unavailable") assert.deepEqual(result.clips[0].issues, ["transcription_unavailable"]);
    assert.doesNotMatch(JSON.stringify(result), /personnalisés|attentive|"transcript"/);
  }
});

test("a second independent listen must confirm missing critical values, repetitions or silence", async () => {
  const expectedLine = "Notre offre ne comprend pas la livraison et reste disponible pour 50 euros seulement.";
  for (const transcript of [
    "Notre offre comprend la livraison et reste disponible pour 50 euros seulement.",
    "Notre offre ne comprend pas la livraison et reste disponible pour 500 euros seulement.",
    `${expectedLine} ${expectedLine}`,
    "Notre offre ne comprend",
    "",
  ]) {
    let confirmations = 0;
    const checked = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })], transcribe: async () => ({ text: transcript }),
      confirm: async () => { confirmations++; return { text: transcript }; },
    });
    assert.equal(confirmations, 1);
    assert.equal(checked.status, "rejected"); assert.equal(checked.clips[0].confirmation, "rejected");
  }
});

test("two fresh conforming listens can clear an initial mistaken brand transcription", async () => {
  const expectedLine = "Je suis Océane et je représente iNrCy pour accompagner votre entreprise.";
  const initial = "Je suis Océane et je représente inertie pour accompagner votre entreprise.";
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: initial }).status, "rejected");
  let confirmations = 0;
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })],
    transcribe: async () => ({ text: initial }),
    confirm: async () => { confirmations++; return { text: expectedLine }; },
  });
  assert.equal(confirmations, 2);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.clips[0].issues, []);
  assert.equal(result.clips[0].confirmation, "passed");
  assert.doesNotMatch(JSON.stringify(result), /Océane|iNrCy|inertie/);
});

test("a first critical mismatch followed by a conforming read needs one final blind adjudication", async () => {
  const expectedLine = "Notre module NovaDesk ne comprend pas la livraison et coûte 50 euros pour accompagner votre entreprise.";
  for (const incorrect of [
    expectedLine.replace("50", "500"),
    expectedLine.replace("ne comprend pas", "comprend"),
    expectedLine.replace("NovaDesk", "SuperCloud"),
  ]) {
    for (const finalRead of ["conforming", "wrong", "unavailable"] as const) {
      const calls: string[] = [];
      const result = await auditAiMediaNativeDialogueClips({
        clips: [fakeClip({ expectedLine })],
        transcribe: async () => { calls.push("first"); return { text: incorrect }; },
        confirm: async (_, options) => {
          assert.deepEqual(Object.keys(options).sort(), ["language", "signal"]);
          calls.push("blind");
          if (calls.length === 2) return { text: expectedLine };
          if (finalRead === "unavailable") throw new DOMException("Shared QA deadline", "TimeoutError");
          return { text: finalRead === "conforming" ? expectedLine : incorrect };
        },
        verifyPronunciation: async () => { assert.fail("Critical adjudication and phonetic proof cannot both run."); },
      });
      assert.deepEqual(calls, ["first", "blind", "blind"]);
      assert.equal(result.status, finalRead === "conforming" ? "passed" : "unavailable");
      assert.equal(result.clips[0].confirmation, finalRead === "conforming" ? "passed" : "unavailable");
      if (finalRead !== "conforming") {
        assert.deepEqual(result.clips[0].issues, [finalRead === "wrong" ? "transcription_inconclusive" : "transcription_unavailable"]);
      }
      assert.doesNotMatch(JSON.stringify(result), /NovaDesk|SuperCloud|livraison|deadline/);
    }
  }
});

test("the final critical-value adjudication shares cancellation and cannot extend an expired audio budget", async () => {
  const expectedLine = "Notre offre ne comprend pas la livraison et coûte 50 euros seulement.";
  const controller = new AbortController();
  let reads = 0;
  await assert.rejects(auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], signal: controller.signal,
    transcribe: async (_, { signal }) => {
      assert.equal(signal, controller.signal);
      reads++;
      return { text: expectedLine.replace("50", "500") };
    },
    confirm: async (_, { signal }) => {
      assert.equal(signal, controller.signal);
      reads++;
      if (reads === 3) controller.abort(new DOMException("Shared audio deadline", "TimeoutError"));
      return { text: expectedLine };
    },
    verifyPronunciation: async () => { assert.fail("Only one three-read path is allowed."); },
  }), { name: "TimeoutError" });
  assert.equal(reads, 3);
});

test("two rejected but contradictory transcripts are inconclusive instead of confirming one another", async () => {
  const expectedLine = "Notre offre ne comprend pas la livraison et reste disponible pour 50 euros seulement.";
  for (const [first, second] of [
    [expectedLine.replace("50", "500"), expectedLine.replace("50", "5000")],
    [expectedLine.replace("50", "500"), expectedLine.replace("ne comprend pas", "comprend")],
    ["Une toute autre histoire commence ici.", "Les mots changent pour un voyage différent."],
    ["", "Une toute autre histoire commence ici."],
  ]) {
    assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: first }).status, "rejected");
    assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: second }).status, "rejected");
    const result = await auditAiMediaNativeDialogueClips({
      clips: [fakeClip({ expectedLine })],
      transcribe: async () => ({ text: first }), confirm: async () => ({ text: second }),
    });
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.clips[0].issues, ["transcription_inconclusive"]);
    assert.equal(result.clips[0].confirmation, "unavailable");
    if (first) assert.ok(!JSON.stringify(result).includes(first));
  }
});

test("a confirmed defect tolerates ASR typography and a small noncritical transcript variation", async () => {
  const expectedLine = "Notre offre reste disponible pour votre entreprise au tarif de 50 euros seulement.";
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })],
    transcribe: async () => ({ text: expectedLine.replace("50", "500") }),
    confirm: async () => ({ text: "Notre offre reste disponible pour votre entreprise au tarif de cinq cents euros seulement ici." }),
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.clips[0].issues.includes("spoken_critical_value_mismatch"));
  assert.equal(result.clips[0].confirmation, "rejected");
});

test("an unchecked rejection is unavailable and passing clips never request confirmation", async () => {
  const unconfirmed = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip()], transcribe: async () => ({ text: "" }),
  });
  assert.equal(unconfirmed.status, "unavailable");
  assert.deepEqual(unconfirmed.clips[0].issues, ["transcription_unavailable"]);
  const passed = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip()], transcribe: async (clip) => ({ text: clip.expectedLine }),
    confirm: async () => { assert.fail("Conforming audio does not need another ASR call."); },
  });
  assert.equal(passed.status, "passed");
});

test("caller cancellation still interrupts an ambiguous-dialogue confirmation", async () => {
  const controller = new AbortController();
  const expectedLine = "Nous accompagnons votre projet avec une écoute attentive et des conseils personnalisés.";
  await assert.rejects(auditAiMediaNativeDialogueClips({
    clips: [fakeClip({ expectedLine })], signal: controller.signal,
    transcribe: async () => ({ text: expectedLine.replace(" personnalisés.", "") }),
    confirm: async () => { controller.abort(); throw new DOMException("cancelled", "AbortError"); },
  }), { name: "AbortError" });
});

test("la QA accepte la réplique complète malgré ponctuation, accents et une petite variation ASR", () => {
  assert.deepEqual(
    tokenizeAiMediaNativeDialogue("L’équipe prend rendez-vous."),
    ["l", "equipe", "prend", "rendez", "vous"],
  );
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Votre projet avance avec une méthode claire.",
    transcript: "Votre projet avance avec une méthode très claire.",
    language: "fr",
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.issues, []);
  assert.ok(result.metrics.expectedCoverage >= 0.95);
});

test("la QA compare aussi les dialogues chinois et thaï sans espaces", () => {
  assert.deepEqual(tokenizeAiMediaNativeDialogue("让您的项目顺利推进。"), [
    "让", "您", "的", "项", "目", "顺", "利", "推", "进",
  ]);
  assert.equal(
    evaluateAiMediaNativeDialogue({
      sceneIndex: 0,
      expectedLine: "让您的项目顺利推进。",
      transcript: "让您的项目顺利推进。",
      language: "zh",
    }).status,
    "passed",
  );
  assert.equal(
    evaluateAiMediaNativeDialogue({
      sceneIndex: 0,
      expectedLine: "เราพร้อมดูแลโครงการของคุณ",
      transcript: "เราพร้อมดูแลโครงการของคุณ",
      language: "th",
    }).status,
    "passed",
  );
});

test("la QA refuse une phrase coupée avant son complément", () => {
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 1,
    expectedLine: "On peut prendre rendez-vous et parler de votre projet.",
    transcript: "On peut prendre rendez-vous et parler de",
    language: "fr",
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.issues.includes("spoken_dialogue_incomplete"));
});

test("la QA refuse la répétition du début de la réplique", () => {
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 2,
    expectedLine: "Votre projet entre aujourd'hui dans de bonnes mains.",
    transcript: "Votre projet entre. Votre projet entre. Votre projet entre.",
    language: "fr",
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.issues.includes("spoken_dialogue_repeated"));
  assert.ok(result.issues.includes("spoken_dialogue_mismatch"));
  assert.equal(result.metrics.repeatCount, 3);
});

test("la QA refuse une courte fin répétée même sous le seuil de tolérance ASR", () => {
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 1,
    expectedLine: "Créez vos stories et vos reels plus facilement.",
    transcript: "Créez vos stories et vos reels plus facilement. Plus facilement.",
    language: "fr",
  });
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.issues, ["spoken_dialogue_repeated"]);
  assert.equal(result.metrics.extraTokenCount, 2);
  assert.equal(result.metrics.repeatCount, 2);
});

test("la QA refuse un seul mot bégayé sans rejeter une répétition voulue dans le script", () => {
  const unexpected = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Découvrez notre nouvelle solution.",
    transcript: "Découvrez notre notre nouvelle solution.",
    language: "fr",
  });
  assert.equal(unexpected.status, "rejected");
  assert.deepEqual(unexpected.issues, ["spoken_dialogue_repeated"]);
  assert.equal(unexpected.metrics.repeatCount, 2);

  const expectedLine = "C'est très très simple pour vos clients.";
  const intended = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine,
    transcript: expectedLine,
    language: "fr",
  });
  assert.equal(intended.status, "passed");
  const additional = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine,
    transcript: "C'est très très très simple pour vos clients.",
    language: "fr",
  });
  assert.equal(additional.status, "rejected");
  assert.ok(additional.issues.includes("spoken_dialogue_repeated"));
});

test("la QA respecte les répétitions du script mais refuse toute occurrence supplémentaire", () => {
  const expectedLine = "Publiez plus facilement et partagez plus facilement.";
  const exact = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine,
    transcript: expectedLine,
    language: "fr",
  });
  assert.equal(exact.status, "passed");
  assert.equal(exact.metrics.repeatCount, 1);

  const extra = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine,
    transcript: `${expectedLine} Plus facilement.`,
    language: "fr",
  });
  assert.equal(extra.status, "rejected");
  assert.deepEqual(extra.issues, ["spoken_dialogue_repeated"]);
  assert.equal(extra.metrics.repeatCount, 2);
});

test("la QA refuse aussi une phrase entière rejouée avec de petites variations de transcription", () => {
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Découvrez nos nouvelles créations pour votre entreprise.",
    transcript: "Découvrez nos nouvelles créations pour votre entreprise. Découvrez de nouvelles créations pour votre entreprise.",
    language: "fr",
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.issues.includes("spoken_dialogue_repeated"));
});

test("la QA refuse une improvisation sans rapport et une piste sans parole", () => {
  const mismatch = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Découvrez une méthode claire pour votre entreprise.",
    transcript: "Alors on s'y met toi ?",
    language: "fr",
  });
  assert.equal(mismatch.status, "rejected");
  assert.ok(mismatch.issues.includes("spoken_dialogue_mismatch"));

  const missing = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Découvrez une méthode claire pour votre entreprise.",
    transcript: "",
    language: "fr",
  });
  assert.equal(missing.status, "rejected");
  assert.deepEqual(missing.issues, ["spoken_dialogue_missing"]);
});

test("l'orchestrateur isole les actes de 8 s et transmet sourceStartSeconds", async () => {
  const cumulativeBuffer = Buffer.from("same-cumulative-video");
  const clips = [
    fakeClip({ sceneIndex: 0, buffer: cumulativeBuffer, sourceStartSeconds: 0 }),
    fakeClip({ sceneIndex: 1, buffer: cumulativeBuffer, sourceStartSeconds: 8 }),
    fakeClip({ sceneIndex: 2, buffer: cumulativeBuffer, sourceStartSeconds: 16 }),
  ];
  const starts: number[] = [];
  const result = await auditAiMediaNativeDialogueClips({
    clips,
    language: "fr",
    transcribe: async (clip) => {
      starts.push(clip.sourceStartSeconds || 0);
      return { text: clip.expectedLine, model: "gemini-test" };
    },
  });
  assert.deepEqual(starts.sort((a, b) => a - b), [0, 8, 16]);
  assert.equal(result.status, "passed");
  assert.equal(result.model, "gemini-test");
  assert.deepEqual(result.clips.map((clip) => clip.status), ["passed", "passed", "passed"]);
});

test("l'orchestrateur refuse une réplique ou une fin précédente ajoutée dans un autre acte", async () => {
  const previousLine = "Votre entreprise évolue plus facilement.";
  const currentLine = "Créez vos contenus et partagez vos nouveautés avec tous vos clients.";
  for (const repeatedFragment of ["Votre entreprise évolue.", "Plus facilement."]) {
    const clips = [
      fakeClip({ sceneIndex: 1, expectedLine: currentLine, sourceStartSeconds: 8 }),
      fakeClip({ sceneIndex: 0, expectedLine: previousLine }),
    ];
    const transcript = `${currentLine} ${repeatedFragment}`;
    // Chaque phrase n'est dite qu'une fois dans ce clip; seule la comparaison
    // avec l'acte précédent peut constater la répétition.
    assert.equal(evaluateAiMediaNativeDialogue({
      sceneIndex: 1,
      expectedLine: currentLine,
      transcript,
    }).status, "passed");
    const result = await auditAiMediaNativeDialogueClips({
      clips,
      transcribe: async (clip) => ({ text: clip.sceneIndex === 1 ? transcript : previousLine }),
      confirm: async (clip) => ({ text: clip.sceneIndex === 1 ? transcript : previousLine }),
    });
    assert.equal(result.status, "rejected");
    assert.deepEqual(result.clips.map((clip) => clip.sceneIndex), [0, 1]);
    assert.equal(result.clips[0]?.status, "passed");
    assert.deepEqual(result.clips[1]?.issues, ["spoken_dialogue_repeated"]);
    assert.equal(result.clips[1]?.metrics.repeatCount, 2);
    assert.equal(JSON.stringify(result).includes("facilement"), false);
    assert.equal(JSON.stringify(result).includes("detectedTokens"), false);
  }
});

test("l'orchestrateur conserve une expression commune prévue dans plusieurs actes", async () => {
  const clips = [
    fakeClip({ sceneIndex: 0, expectedLine: "Votre entreprise évolue plus facilement." }),
    fakeClip({ sceneIndex: 1, expectedLine: "Avec notre outil, publiez vos nouveautés plus facilement." }),
  ];
  const result = await auditAiMediaNativeDialogueClips({
    clips,
    transcribe: async (clip) => ({ text: clip.expectedLine }),
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.clips.map((clip) => clip.issues), [[], []]);
});

test("an apparent repetition across clips also requires confirmation and can be cleared by a fresh listen", async () => {
  const previousLine = "Votre entreprise évolue plus facilement.";
  const currentLine = "Créez vos contenus et partagez vos nouveautés avec tous vos clients.";
  const clips = [fakeClip({ expectedLine: previousLine }), fakeClip({ sceneIndex: 1, expectedLine: currentLine })];
  for (const confirmed of [false, true]) {
    const calls: number[] = [];
    const result = await auditAiMediaNativeDialogueClips({
      clips,
      transcribe: async (clip) => ({ text: clip.sceneIndex === 0 ? previousLine : `${currentLine} Plus facilement.` }),
      ...(confirmed ? { confirm: async (clip: AiMediaNativeDialogueQaClip) => {
        calls.push(clip.sceneIndex);
        return { text: clip.expectedLine };
      } } : {}),
    });
    assert.equal(result.status, confirmed ? "passed" : "unavailable");
    assert.deepEqual(calls, confirmed ? [1] : []);
    assert.equal(result.clips[1].confirmation, confirmed ? "passed" : "unavailable");
  }
});

test("an ASR hallucination in an earlier clip cannot manufacture a repetition in the next clip", async () => {
  const previousLine = "Bienvenue dans notre atelier.";
  const currentLine = "Découvrez notre nouvelle solution.";
  const firstHallucination = `${previousLine} Clients.`;
  const clips = [fakeClip({ expectedLine: previousLine }), fakeClip({ sceneIndex: 1, expectedLine: currentLine })];
  const confirmed: number[] = [];
  const result = await auditAiMediaNativeDialogueClips({
    clips,
    transcribe: async (clip) => ({ text: clip.sceneIndex === 0 ? firstHallucination : `Clients, ${currentLine}` }),
    confirm: async (clip) => { confirmed.push(clip.sceneIndex); return { text: clip.expectedLine }; },
  });
  assert.equal(result.clips[1].status, "passed");
  assert.ok(!confirmed.includes(1));
});

test("unexpected speech on a silent clip must be heard twice before rejection", async () => {
  const clip = fakeClip({ expectedLine: "", expectSilence: true });
  for (const second of ["Bonjour encore.", ""]) {
    let confirmations = 0;
    const result = await auditAiMediaNativeDialogueClips({
      clips: [clip], transcribe: async () => ({ text: "Bonjour encore." }),
      confirm: async () => { confirmations++; return { text: second }; },
    });
    assert.equal(confirmations, 1);
    assert.equal(result.status, second ? "rejected" : "passed");
    assert.ok(!JSON.stringify(result).includes("Bonjour"));
  }
});

test("l'orchestrateur refuse un seul mot rejoué à la jonction de deux actes", async () => {
  const clips = [
    fakeClip({ sceneIndex: 0, expectedLine: "Nous accueillons tous vos clients." }),
    fakeClip({ sceneIndex: 1, expectedLine: "Découvrez notre nouvelle solution." }),
  ];
  const result = await auditAiMediaNativeDialogueClips({
    clips,
    transcribe: async (clip) => ({
      text: clip.sceneIndex === 0
        ? clip.expectedLine
        : "Clients, découvrez notre nouvelle solution.",
    }),
    confirm: async () => ({ text: "Clients, découvrez notre nouvelle solution." }),
  });
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.clips[1]?.issues, ["spoken_dialogue_repeated"]);
});

test("un rejet prime sur une transcription indisponible, sans exposer le transcript", async () => {
  const result = await auditAiMediaNativeDialogueClips({
    clips: [
      fakeClip({ sceneIndex: 0 }),
      fakeClip({ sceneIndex: 1 }),
    ],
    transcribe: async (clip) => {
      if (clip.sceneIndex === 1) throw new Error("google unavailable");
      return { text: "Une phrase complètement différente.", model: "gemini-test" };
    },
    confirm: async () => ({ text: "Une phrase complètement différente.", model: "gemini-test" }),
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.clips[1]?.status, "unavailable");
  assert.equal("transcript" in result, false);
  assert.equal(JSON.stringify(result).includes("phrase complètement différente"), false);
});

test("l'adaptateur Google découpe réellement les sorties cumulées avant transcription", () => {
  const source = readFileSync(
    path.join(ROOT, "lib/aiMediaNativeDialogueQaGoogle.ts"),
    "utf8",
  );
  assert.match(source, /"-ss",\s*String\(sourceStartSeconds\)/);
  assert.match(source, /"-t",\s*String\(args\.clip\.durationSeconds\)/);
  assert.match(source, /sourcePathByBuffer = new Map<Buffer, Promise<string>>\(\)/);
  assert.match(source, /store: false/);
  assert.match(source, /const DEFAULT_MODEL = "gemini-3\.5-flash-lite"/);
  assert.doesNotMatch(source, /gemini-2\.5-flash-lite/);
  assert.match(source, /reportQaFailure\("extract", error\)/);
  assert.match(source, /reportQaFailure\("transcribe", error\)/);
  assert.match(source, /const DEFAULT_TIMEOUT_MS = 8_000/);
  assert.match(source, /const deadlineAt = Date\.now\(\) \+ timeoutMs/);
  assert.match(source, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(source, /AbortSignal\.any\(\[args\.signal, deadlineSignal\]\)/);
  assert.match(source, /timeoutMs: remainingTimeoutMs\(\)/);
  assert.match(source, /maxRetries: 0/);
  assert.match(source, /N'invente, ne corrige, ne complète et ne résume aucun mot/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^)]*transcript/i);
});

test("régression audio réel : le décor récité à la place de la citation est rejeté", () => {
  const result = evaluateAiMediaNativeDialogue({
    sceneIndex: 0,
    expectedLine: "Je façonne chaque pièce à la main, pour embellir votre quotidien.",
    transcript: "Dans un atelier de céramique lumineux",
    language: "fr",
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.metrics.expectedTokenCount, 11);
  assert.equal(result.metrics.detectedTokenCount, 6);
  assert.equal(result.metrics.expectedCoverage, 0);
  assert.deepEqual(result.issues, ["spoken_dialogue_mismatch"]);
});

test("un acte sans voix off prévue refuse une parole improvisée ou répétée", async () => {
  const silent = fakeClip({ sceneIndex: 1, expectedLine: "", expectSilence: true });
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 1, expectedLine: "", transcript: "", expectSilence: true }).status, "passed");
  assert.equal(evaluateAiMediaNativeDialogue({ sceneIndex: 1, expectedLine: "", transcript: "Bonjour encore.", expectSilence: true }).status, "rejected");
  const result = await auditAiMediaNativeDialogueClips({
    clips: [fakeClip(), silent],
    transcribe: async (clip) => ({ text: clip.sceneIndex === 0 ? clip.expectedLine : "" }),
  });
  assert.equal(result.status, "passed");
});
