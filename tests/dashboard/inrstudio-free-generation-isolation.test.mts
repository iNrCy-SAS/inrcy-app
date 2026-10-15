import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const source = read("app/dashboard/_components/MediaFreeGenerator.tsx");
const parsed = ts.createSourceFile(
  "MediaFreeGenerator.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);

// Execute the actual UI handlers, with only their external closures stubbed.
// No network, provider call, React renderer or copy of production control flow.
function handler(name: string, context: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      expression = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expression, `Missing UI handler: ${name}`);
  const code = ts.transpileModule(`const run = ${expression.getText(parsed)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(context), `${code}; return run;`)(
    ...Object.values(context),
  ) as () => Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function resultContext() {
  const events: string[] = [];
  const sequence = { current: 0 };
  const operationInFlight = { current: false };
  const result = { draft: true, item: { id: "draft-for-account-a" } };
  return {
    events, sequence, operationInFlight, result,
    operationLocked: false,
    busy: false,
    canRecover: false,
    recoveryIncompatible: false,
    instanceId: "free-test",
    setActiveSettingsTab: (value: string) => { events.push(`tab:${value}`); },
    setActiveAttempt: () => { events.push("attempt-snapshot"); },
    window: { requestAnimationFrame(callback: () => void) { callback(); } },
    document: { getElementById(id: string) { return { focus() { events.push(`focus:${id}`); } }; } },
    creditQuote: { authorization: { expectedCredits: 160, creditTariffVersion: "test", creditQuoteId: "confirmed" } },
    enginePreference: { videoEngine: "omni", imageEngine: "openai" },
    videoResolution: "720p",
    useBusinessDna: false,
    videoModel: { provider: "google" },
    setCreationScreen: (value: boolean) => { events.push(`creation:${value}`); },
    setFinishing: (value: boolean) => { events.push(`finishing:${value}`); },
    setSavingToLibrary: (value: boolean) => { events.push(`saving:${value}`); },
    setActionError: (value: string) => { events.push(`error:${value}`); },
    onResultChange: () => { events.push("result-parent"); },
    onAccepted: async () => { events.push("accepted-parent"); },
    reset: () => { events.push("reset"); },
    MediaGenerationAccountChangedError: class extends Error {},
    t: (key: string) => key,
  };
}

test("le parcours unique garde ses brouillons image/vidéo et ne lit aucun réglage Guidé", () => {
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  assert.match(source, /const \[prompt, setPrompt\] = useState\(initialPrompt\)/);
  assert.match(source, /const effectivePrompt = \[prompt\.trim\(\), requiredPromptSuffix\.trim\(\)\]/);
  assert.match(source, /const \[references, setReferences\] = useState<Reference\[\]>\(\[\]\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|loadPreferences|savePreferences|publicationBrief|from ["']\.\/MediaGenerator["']/);
  assert.match(source, /useMediaGeneration\(\)/);
  assert.match(source, /void loadQuota\(\)/);
  assert.doesNotMatch(modal, /<MediaGenerator\s|creationModeTabs|requestCreationMode/);
  assert.match(modal, /visitedFreeTypes\.map\(\(kind\) =>/);
  assert.match(modal, /<Activity key=\{kind\} mode=\{freeMediaType === kind/);
  assert.match(modal, /<MediaFreeGenerator[\s\S]*?mediaType=\{kind\}/);
});

test("un changement de compte invalide aussi les formulaires Libre masqués", () => {
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const accountReset = modal.slice(modal.indexOf("const resetGenerationSession"), modal.indexOf("const handleResultChange"));
  assert.match(accountReset, /setGenerationSession\(\(value\) => value \+ 1\)/);
  assert.match(accountReset, /setVisitedFreeTypes\(\[initialFreeMediaType\]\)/);
  assert.match(accountReset, /ACTIVE_INRCY_ACCOUNT_EVENT/);
  assert.match(modal, /<div key=\{generationSession\}/);
  const localReset = source.slice(source.indexOf("const clearAccountState"), source.indexOf("const resetConsent"));
  assert.match(localReset, /sequence\.current \+= 1/);
  for (const call of ['setPrompt("")', "setUseBusinessDna(false)", "setReferences([])", "setIdentityConsent(false)", "setTeamConsent(false)", 'setSpeechMode("voiceover")']) {
    assert.ok(localReset.includes(call), `Le changement de compte doit effacer ${call}`);
  }
  assert.match(localReset, /return \(\) => \{\s*sequence\.current \+= 1/);
});

test("un résultat accepté tardivement ne revient pas dans un autre compte ou une session fermée", async () => {
  const context = resultContext();
  const pending = deferred<typeof context.result>();
  const run = handler("handleAccept", { ...context, acceptDraft: () => pending.promise });
  const request = run();
  assert.equal(context.operationInFlight.current, true);
  context.sequence.current += 1; // Account event or Activity/unmount cleanup.
  context.events.length = 0;
  pending.resolve(context.result);
  await request;
  assert.deepEqual(context.events, []);
});

test("une erreur de validation obsolète ne pollue pas la nouvelle session", async () => {
  const context = resultContext();
  const pending = deferred<typeof context.result>();
  const run = handler("handleAccept", { ...context, acceptDraft: () => pending.promise });
  const request = run();
  context.sequence.current += 1;
  context.events.length = 0;
  pending.reject(new Error("ancienne requête"));
  await request;
  assert.deepEqual(context.events, []);
});

test("éditer après un résultat conserve le brouillon et n'engage aucune génération", async () => {
  const context = resultContext();
  const run = handler("handleEdit", { ...context,
    discardDraft: () => assert.fail("Changer d'onglet ne doit pas supprimer le média"),
    generate: () => assert.fail("Changer d'onglet ne doit pas lancer la génération"),
  });
  await run();
  assert.deepEqual(context.events, ["tab:prompt", "focus:free-test-prompt"]);
  assert.equal(context.result.item.id, "draft-for-account-a");
  assert.equal(context.operationInFlight.current, false);
});

test("éditer le prompt pendant une opération verrouillée ne change ni onglet ni résultat", async () => {
  const context = resultContext();
  const run = handler("handleEdit", { ...context, operationLocked: true });
  await run();
  assert.deepEqual(context.events, []);
  assert.equal(context.result.item.id, "draft-for-account-a");
  assert.equal(context.operationInFlight.current, false);
});

test("un arrêt refusé pendant finalisation ne masque pas l'écran partagé", async () => {
  for (const cancelled of [false, true]) {
    const context = resultContext();
    const run = handler("handleConfirmGenerationStop", {
      ...context,
      setStopConfirmOpen: (open: boolean) => context.events.push(`stop-dialog:${open}`),
      cancelGeneration: () => cancelled,
    });
    await run();
    assert.deepEqual(context.events, cancelled ? ["stop-dialog:false", "error:", "creation:false"] : ["stop-dialog:false"]);
  }
});

test("récupérer Libre ne dépend pas d'un devis et ne supprime ni ne régénère le média", async () => {
  const context = resultContext();
  const run = handler("handleRecoverResult", {
    ...context, canRecover: true, canGenerate: false,
    retryRecovery: async () => { context.events.push("recover-existing-request"); return context.result; },
    generate: () => assert.fail("La récupération ne doit pas générer"),
    discardDraft: () => assert.fail("La récupération ne doit pas supprimer"),
  });
  await run();
  assert.deepEqual(context.events, ["error:", "recover-existing-request"]);
  assert.equal(context.operationInFlight.current, false);
});

test("une récupération Libre devenue obsolète ne modifie pas le nouveau compte", async () => {
  const context = resultContext();
  const pending = deferred<typeof context.result>();
  const run = handler("handleRecoverResult", { ...context, canRecover: true, retryRecovery: () => pending.promise });
  const request = run();
  context.sequence.current += 1;
  context.events.length = 0;
  pending.reject(new Error("Ancienne récupération"));
  await request;
  assert.deepEqual(context.events, []);
});

test("abandonner Libre clôture seulement une tentative absente et conserve un résultat engagé", async () => {
  for (const recovered of [null, { draft: true, item: { id: "engaged-draft" } }]) {
    const context = resultContext();
    const run = handler("handleAbandonRecovery", {
      ...context, canRecover: true,
      cancelRecovery: async () => { context.events.push("cancel-existing-request"); return recovered; },
      generate: () => assert.fail("Abandonner ne doit pas générer"),
      discardDraft: () => assert.fail("Abandonner ne doit pas supprimer un média"),
    });
    await run();
    assert.deepEqual(context.events, recovered ? ["error:", "cancel-existing-request"] : ["error:", "cancel-existing-request", "creation:false"]);
    assert.equal(context.operationInFlight.current, false);
  }
});

test("un résultat incompatible ne peut être récupéré ni abandonné depuis ce contexte", async () => {
  for (const name of ["handleRecoverResult", "handleAbandonRecovery"]) {
    const context = resultContext();
    const run = handler(name, {
      ...context, canRecover: true, recoveryIncompatible: true,
      retryRecovery: () => assert.fail("La récupération incompatible appartient au Studio général"),
      cancelRecovery: () => assert.fail("Un contexte incompatible ne doit pas abandonner la tentative"),
      generate: () => assert.fail("Le média ne doit pas être régénéré"),
      discardDraft: () => assert.fail("Le brouillon payé doit être conservé"),
    });
    await run();
    assert.deepEqual(context.events, []);
    assert.equal(context.operationInFlight.current, false);
    assert.equal(context.result.item.id, "draft-for-account-a");
  }
});

test("le double clic Accepter ne promeut le média et ne rappelle le parent qu’une fois", async () => {
  const context = resultContext();
  const pending = deferred<typeof context.result>();
  let accepts = 0;
  const run = handler("handleAccept", {
    ...context, acceptDraft: () => { accepts += 1; return pending.promise; },
  });
  const request = run();
  await run();
  pending.resolve(context.result);
  await request;
  assert.equal(accepts, 1);
  assert.deepEqual(context.events, ["finishing:true", "error:", "result-parent", "accepted-parent", "finishing:false"]);
  assert.equal(context.operationInFlight.current, false);
});

test("Libre peut enregistrer un média sans le renvoyer vers le flux d’insertion", async () => {
  const context = resultContext();
  const pending = deferred<typeof context.result>();
  const run = handler("handleSaveToLibrary", {
    ...context,
    acceptDraft: () => pending.promise,
  });

  const request = run();
  assert.equal(context.operationInFlight.current, true);
  pending.resolve(context.result);
  await request;

  assert.deepEqual(context.events, [
    "finishing:true",
    "saving:true",
    "error:",
    "result-parent",
    "saving:false",
    "finishing:false",
  ]);
  assert.equal(context.operationInFlight.current, false);
});

test("Libre exige les deux critères choisis sans imposer un personnage", () => {
  assert.match(source, /const ROLES = \["character", "environment", "product", "inspiration"\] as const/);
  assert.match(source, /role: undefined,\s*usage: undefined/);
  assert.doesNotMatch(source, /role: "character",\s*usage: "required"/);
  assert.match(source, /const referenceCriteriaIncomplete = references\.some\(/);
  assert.match(source, /!referenceCriteriaIncomplete/);
  const usageMenu = source.slice(source.indexOf('aria-label={t("ai_generator_free_reference_usage"'), source.indexOf("{roleLimitExceeded"));
  assert.match(source, /ai_generator_free_reference_role_placeholder/);
  assert.match(usageMenu, /ai_generator_free_reference_usage_placeholder/);
  assert.match(usageMenu, /value=\{reference\.usage \?\? ""\}\s*disabled=\{locked\}/);
  assert.match(usageMenu, /<option value="required">/);
  assert.match(usageMenu, /<option value="inspiration">/);
  assert.match(source, /reference\.role === "character" && reference\.usage === "required"/);
  assert.match(source, /\(!identityRequired \|\| identityConsent\)/);
  assert.match(source, /\(!teamConsentRequired \|\| teamConsent\)/);
  assert.match(source, /onBusyChange=\{setVoiceBusy\}/);
  assert.match(source, /readOnly=\{voiceBusy\}/);
  assert.match(source, /maxLength=\{maxUserPromptLength\}/);
});

test("les commandes UI Libre transmettent le son choisi sans fuite des paramètres voix off", async () => {
  assert.match(source, /kind === "video" && speechMode === "voiceover" && withNarration/);
  assert.match(source, /\["voiceover", "characters"\] as const/);
  for (const sound of ["voiceover", "characters", "none"] as const) {
    const context = resultContext();
    const requests: Record<string, unknown>[] = [];
    const references = [{ role: "product", usage: "inspiration", data: "example", mimeType: "image/png" }];
    const run = handler("handleGenerate", {
      ...context, result: null, canGenerate: true,
      setStopConfirmOpen() {}, setIdentityConsent() {}, setTeamConsent() {},
      generate: async (request: Record<string, unknown>) => { requests.push(request); },
      discardDraft: async () => {},
      prompt: "  Mon scénario libre  ", effectivePrompt: "Mon scénario libre", source: "studio", kind: "video", format: "story", fixedFormat: undefined, duration: 16, sceneMode: "single",
      withMusic: false, effectiveWithNarration: sound === "voiceover", voice: "male", voiceVariant: "Charon",
      speechMode: sound === "none" ? "voiceover" : sound,
      references, referencesForRequest: (value: unknown) => value,
      personReferences: [], identityRequired: false, identityConsent: false,
      teamConsentRequired: false, teamConsent: false, referenceSetId: { current: "refs-session-a" },
      MediaGenerationCancelledError: class extends Error {},
    });
    await run();
    assert.ok(context.events.includes("creation:true"));
    assert.equal(context.events.includes("creation:false"), false);
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.creationMode, "free");
    assert.equal(request.freePrompt, "Mon scénario libre");
    assert.equal(request.teamVideoSpeechMode, sound === "none" ? "voiceover" : sound);
    assert.equal(request.withNarration, sound === "voiceover");
    assert.equal(request.narrationVoice, sound === "voiceover" ? "male" : undefined);
    assert.equal(request.narrationVoiceVariant, sound === "voiceover" ? "Charon" : undefined);
    assert.equal(request.withMusic, false);
    assert.equal(request.inspirationImages, references);
    assert.equal(request.durationSeconds, 16);
  }
});

test("l'ADN facultatif transmet uniquement le choix explicite pour les images et vidéos", async () => {
  for (const kind of ["image", "video"] as const) {
    for (const useBusinessDna of [false, true]) {
      const requests: Record<string, unknown>[] = [];
      const context = resultContext();
      await handler("handleGenerate", {
        ...context, result: null, canGenerate: true, useBusinessDna,
        setStopConfirmOpen() {}, setIdentityConsent() {}, setTeamConsent() {},
        generate: async (request: Record<string, unknown>) => { requests.push(request); },
        discardDraft: async () => {},
        effectivePrompt: "Mon scénario libre", source: "studio", kind,
        format: "square", fixedFormat: undefined, duration: 8, sceneMode: "single",
        withMusic: false, effectiveWithNarration: false, voice: "female", voiceVariant: "Kore",
        speechMode: "voiceover", references: [], referencesForRequest: (value: unknown) => value,
        personReferences: [], identityRequired: false, identityConsent: false,
        teamConsentRequired: false, teamConsent: false, referenceSetId: { current: "" },
        MediaGenerationCancelledError: class extends Error {},
      })();
      assert.equal(requests.length, 1);
      assert.equal(requests[0].useBusinessDna, useBusinessDna);
      assert.equal(requests[0].freePrompt, "Mon scénario libre");
      assert.equal(requests[0].creationMode, "free");
      assert.equal(requests[0].useBrandColors, false);
      assert.equal(requests[0].logoMode, "none");
      assert.deepEqual(requests[0].textKeywords, []);
    }
  }
});

test("un échec Libre conserve l'autorisation de la même demande, un succès la renouvelle", async () => {
  for (const shouldFail of [true, false]) {
    const context = resultContext();
    const consentChanges: string[] = [];
    const run = handler("handleGenerate", {
      ...context,
      result: null,
      canGenerate: true,
      setStopConfirmOpen() {},
      setIdentityConsent(value: boolean) { consentChanges.push(`identity:${value}`); },
      setTeamConsent(value: boolean) { consentChanges.push(`team:${value}`); },
      generate: async () => {
        if (shouldFail) throw new Error("Contrôle audio refusé");
      },
      discardDraft: async () => {},
      prompt: "Une scène avec des personnages qui parlent",
      effectivePrompt: "Une scène avec des personnages qui parlent",
      source: "studio",
      kind: "video",
      format: "story",
      fixedFormat: undefined,
      duration: 16,
      sceneMode: "single",
      withMusic: false,
      effectiveWithNarration: false,
      voice: "female",
      voiceVariant: "Kore",
      speechMode: "characters",
      references: [{ role: "character", usage: "required", data: "test", mimeType: "image/png" }],
      referencesForRequest: (value: unknown) => value,
      personReferences: [{ role: "character", usage: "required" }],
      identityRequired: true,
      identityConsent: true,
      teamConsentRequired: false,
      teamConsent: false,
      referenceSetId: { current: "same-references" },
      MediaGenerationCancelledError: class extends Error {},
    });
    await run();
    assert.equal(context.operationInFlight.current, false);
    assert.deepEqual(consentChanges, shouldFail ? [] : ["identity:false", "team:false"]);
    if (shouldFail) assert.ok(context.events.includes("error:Contrôle audio refusé"));
  }
});

test("les rejets de voix native exposent une cause utile sans transcript", () => {
  const route = read("app/api/media-generation/generate/route.ts");
  const publicErrors = read("lib/aiMediaGenerationPublicErrors.ts");
  const server = read("lib/aiMediaGenerationServer.ts");
  assert.match(route, /classifyAiMediaGenerationError/);
  assert.match(publicErrors, /AI_MEDIA_VIDEO_NATIVE_SPEECH_REJECTED/);
  assert.match(publicErrors, /spoken_dialogue_missing/);
  assert.match(publicErrors, /spoken_dialogue_repeated/);
  assert.match(publicErrors, /spoken_dialogue_incomplete/);
  assert.match(publicErrors, /spoken_dialogue_mismatch/);
  assert.match(server, /nativeDialogueQa\?\.clips\.flatMap\(\(clip\) => clip\.issues\)/);
  assert.doesNotMatch(server.slice(server.indexOf("const issues = characterDialogueProviderFallback"), server.indexOf("const nativeVoiceoverQa")), /clip\.transcript/);
});
