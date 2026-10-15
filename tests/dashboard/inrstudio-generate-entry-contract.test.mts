import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  canSwitchInrStudioMediaType,
  isInrStudioTabUnavailable,
} from "../../lib/inrStudioModalPolicy.ts";
import {
  buildInrStudioReturnHref,
  type InrStudioHandoff,
  type InrStudioReturnedMedia,
} from "../../lib/inrStudioNavigation.ts";

const read = (relativePath: string) =>
  readFileSync(path.resolve(relativePath), "utf8");

const modalPath = "app/dashboard/_components/MediaGeneratorModal.tsx";
const studioClientPath = "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx";
const publishPath = "app/dashboard/booster/publier/PublishModal.tsx";
const parsedFiles = new Map<string, ts.SourceFile>();

function parsed(relativePath: string) {
  if (!parsedFiles.has(relativePath)) {
    parsedFiles.set(relativePath, ts.createSourceFile(relativePath, read(relativePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  }
  return parsedFiles.get(relativePath)!;
}

function findNode<T extends ts.Node>(source: ts.SourceFile, predicate: (node: ts.Node) => node is T) {
  let found: T | undefined;
  function visit(node: ts.Node) {
    if (!found && predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `Production node not found in ${source.fileName}`);
  return found;
}

function execute<T>(expression: ts.Expression, source: ts.SourceFile, context: Record<string, unknown>): T {
  const code = ts.transpileModule(`const run = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(context), `${code}; return run;`)(...Object.values(context)) as T;
}

// Run the real component closures, not a copy of their branching logic.
function handler<T>(relativePath: string, name: string, context: Record<string, unknown>): T {
  const source = parsed(relativePath);
  const declaration = findNode(source, (node): node is ts.VariableDeclaration =>
    ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
  let expression = declaration.initializer;
  assert.ok(expression);
  if (ts.isCallExpression(expression) && expression.expression.getText(source) === "useCallback") {
    expression = expression.arguments[0];
  }
  return execute<T>(expression, source, context);
}

test("un handoff Générer sans source garde Image et Vidéo disponibles", () => {
  assert.equal(canSwitchInrStudioMediaType("generate", true), true);
  assert.equal(
    isInrStudioTabUnavailable("generate", {
      hasExternalHandoff: true,
      hasSourceMedia: false,
    }),
    false
  );
});

test("un handoff Générer sans source grise Modifier et Retoucher", () => {
  for (const tab of ["modify", "retouch"] as const) {
    assert.equal(
      isInrStudioTabUnavailable(tab, {
        hasExternalHandoff: true,
        hasSourceMedia: false,
      }),
      true
    );
  }
  assert.equal(
    isInrStudioTabUnavailable("retouch", {
      hasExternalHandoff: true,
      hasSourceMedia: true,
    }),
    false
  );
});

test("Booster ouvre le générateur sans fabriquer de média source", () => {
  const publishModal = read(
    "app/dashboard/booster/publier/PublishModal.tsx"
  );
  const start = publishModal.indexOf("const openInrStudioGenerator");
  const end = publishModal.indexOf("const openInrStudioImageTool", start);
  const generatorEntry = publishModal.slice(start, end);

  assert.match(generatorEntry, /tab:\s*"generate"/);
  assert.match(generatorEntry, /origin:\s*"booster-publish"/);
  assert.doesNotMatch(generatorEntry, /source:\s*\{/);
  assert.match(generatorEntry, /openStudio\(href\)/);
});

test("le clic Générer de Booster transmet seulement le dernier sujet saisi", async () => {
  const requests: Record<string, unknown>[] = [];
  const opened: string[] = [];
  for (const idea of ["  Notre menu du dimanche  ", "Notre nouvelle prestation", " \n\t "]) {
    await handler<() => Promise<void>>(publishPath, "openInrStudioGenerator", {
      idea,
      mediaGenerationBrief: "Ancien titre et contenu commercial à ne pas importer",
      preparePublicationDraftForStudio: async () => ({ draftId: "current-draft", returnHref: "/dashboard?action=publish", videoDraft: null }),
      createInrStudioHandoff: async (input: Record<string, unknown>) => {
        requests.push(input);
        return { href: "test:studio-handoff" };
      },
      openStudio: (href: string) => { opened.push(href); },
      setImgError: () => { assert.fail("Un sujet valide ou vide doit ouvrir le Studio sans erreur"); },
    })();
  }
  assert.deepEqual(requests.map((input) => input.publicationBrief), ["Notre menu du dimanche", "Notre nouvelle prestation", ""]);
  assert.ok(requests.every((input) => input.tab === "generate" && input.origin === "booster-publish"));
  assert.deepEqual(opened, Array(3).fill("test:studio-handoff"));
});

test("le client transmet explicitement la présence de la source au modal", () => {
  const client = read(
    "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx"
  );
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");

  assert.match(
    client,
    /initialSourceAvailable=\{Boolean\(handoff\?\.source\)\}/
  );
  assert.match(
    modal,
    /disabled=\{locked \|\| hasPendingWork \|\| unavailable\}/
  );
  assert.match(
    modal,
    /canSwitchInrStudioMediaType\(studioTab, hasExternalHandoff\)/
  );
});

test("la création image et vidéo utilise seulement Libre sans retirer Modifier ou Retoucher", () => {
  const modal = read(modalPath);
  assert.doesNotMatch(modal, /<MediaGenerator\s|creationModeTabs|requestCreationMode/);
  assert.match(modal, /<MediaFreeGenerator[\s\S]*?source="studio"[\s\S]*?mediaType=\{kind\}/);
  assert.match(modal, /<MediaModifier/);
  assert.match(modal, /<MediaRetoucher/);
  assert.match(modal, /<MediaVideoRetoucher/);
});

test("le sujet Booster préremplit le prompt, avec priorité à une consigne explicite", () => {
  const base = { initialFreePrompt: "", source: "studio", origin: "booster", publicationBrief: "  Notre menu du dimanche  " };
  assert.equal(handler<string>(modalPath, "initialGenerationPrompt", base), "Notre menu du dimanche");
  assert.equal(handler<string>(modalPath, "initialGenerationPrompt", { ...base, source: "booster", origin: "menu" }), "Notre menu du dimanche");
  assert.equal(handler<string>(modalPath, "initialGenerationPrompt", { ...base, initialFreePrompt: "Ma consigne personnalisée" }), "Ma consigne personnalisée");
  assert.equal(handler<string>(modalPath, "initialGenerationPrompt", { ...base, initialFreePrompt: "   " }), "Notre menu du dimanche");
  assert.equal(handler<string>(modalPath, "initialGenerationPrompt", { ...base, publicationBrief: " \n\t " }), "");
  for (const origin of ["menu", "ads", "inragent", "inrsend"]) {
    assert.equal(handler<string>(modalPath, "initialGenerationPrompt", { ...base, origin }), "");
  }
});

test("une nouvelle ouverture reprend le dernier sujet sans écraser les éditions de la session ouverte", () => {
  const source = parsed(modalPath);
  const openingEffect = findNode(source, (node): node is ts.CallExpression =>
    ts.isCallExpression(node) && node.expression.getText(source) === "useLayoutEffect" &&
    Boolean(node.arguments[0]?.getText(source).includes("const newOpening = open && !openedRef.current")));
  const prompts: string[] = [];
  let session = 0;
  const openedRef = { current: false };
  const context = {
    openedRef, sessionVersionRef: { current: 0 }, setResetRequested() {},
    initialTab: "generate", initialFreeMediaType: "image", initialMediaType: "image",
    setStudioTab() {}, setFreeMediaType() {}, setVisitedFreeTypes() {}, setMediaTypeByTab() {}, setRetoucherDirty() {},
    setGenerationPrompt: (value: string) => { prompts.push(value); },
    setGenerationSession: (update: (current: number) => number) => { session = update(session); },
  };
  const run = (open: boolean, initialGenerationPrompt: string) =>
    execute<() => void>(openingEffect.arguments[0], source, { ...context, open, initialGenerationPrompt })();
  run(true, "Premier sujet");
  assert.deepEqual(prompts, ["Premier sujet"]);
  assert.equal(session, 1);
  run(true, "Sujet modifié ailleurs pendant la création");
  assert.deepEqual(prompts, ["Premier sujet"]);
  assert.equal(session, 1);
  run(false, "Deuxième sujet");
  run(true, "Deuxième sujet");
  assert.deepEqual(prompts, ["Premier sujet", "Deuxième sujet"]);
  assert.equal(session, 2);
});

test("Générer permet de changer Image/Vidéo sans abandonner Booster", () => {
  for (const initialMediaType of ["image", "video"] as const) {
    const target = initialMediaType === "image" ? "video" : "image";
    const changed: string[] = [];
    const context = {
      activeMediaType: initialMediaType,
      studioTab: "generate", hasExternalHandoff: true, imageOnly: false, locked: false, hasPendingWork: false,
      canSwitchInrStudioMediaType,
      setCloseConfirmOpen: () => { assert.fail("Changer le type ne doit pas abandonner le retour Booster"); },
      setFreeMediaType: (value: string) => { changed.push(value); },
      setVisitedFreeTypes: (update: (current: string[]) => string[]) => { assert.deepEqual(update([initialMediaType]), [initialMediaType, target]); },
      setMediaTypeByTab: () => { assert.fail("Une création ne doit pas utiliser l'état d'un autre outil"); },
    };
    handler<(value: string) => void>(modalPath, "requestMediaType", context)(target);
    assert.deepEqual(changed, [target]);
    for (const guard of [{ locked: true }, { hasPendingWork: true }, { imageOnly: target === "video" }]) {
      if ("imageOnly" in guard && !guard.imageOnly) continue;
      changed.length = 0;
      handler<(value: string) => void>(modalPath, "requestMediaType", { ...context, ...guard })(target);
      assert.deepEqual(changed, []);
    }
  }
});

test("un média accepté Libre ou Guidé revient et s'insère dans Booster en image comme en vidéo", async () => {
  const publishSource = parsed(publishPath);
  const insertionEffect = findNode(publishSource, (node): node is ts.CallExpression =>
    ts.isCallExpression(node) && node.expression.getText(publishSource) === "useEffect" &&
    Boolean(node.arguments[0]?.getText(publishSource).includes("if (!pendingStudioReturn?.item) return;")));
  const client = read(studioClientPath);
  assert.match(client, /acceptMode=\{handoff \? "insert" : "library"\}/);
  assert.match(read(modalPath), /<MediaFreeGenerator[\s\S]*?acceptMode=\{acceptMode\}[\s\S]*?onAccepted=\{onAccepted\}/);

  for (const creationMode of ["free", "guided"] as const) {
    for (const mediaType of ["image", "video"] as const) {
      for (const embedded of [false, true]) {
        const handoff: InrStudioHandoff = {
          version: 1, key: "studio-session", tab: "generate", origin: "booster-publish", createdAt: 1,
          returnHref: "/dashboard?action=publish&draft=42#media", returnKey: "generated-return", publicationBrief: "brief guidé",
          source: null, context: { draftId: "42" }, payload: null,
        };
        const item = { id: "accepted-media", media_type: mediaType, metadata: { creation_mode: creationMode } };
        const returned: InrStudioReturnedMedia[] = [];
        const events: string[] = [];
        const deliverReturnedMedia = handler<(item: Record<string, unknown>, action: string) => Promise<void>>(studioClientPath, "deliverReturnedMedia", {
          handoff, buildInrStudioReturnHref,
          onEmbeddedReturn: embedded ? async (result: InrStudioReturnedMedia) => { returned.push(result); events.push("returned"); } : undefined,
          onEmbeddedClose: embedded ? () => { events.push("close"); } : undefined,
          saveInrStudioReturn: (result: InrStudioReturnedMedia) => { returned.push(result); events.push("saved"); },
          clearInrStudioHandoff: async (key: string) => { assert.equal(key, handoff.key); events.push("clear"); },
          router: { replace: (href: string) => { assert.equal(href, buildInrStudioReturnHref(handoff)); events.push("navigate"); } },
        });
        await handler<(result: unknown) => Promise<void>>(studioClientPath, "returnAcceptedMedia", { handoff, deliverReturnedMedia })({ draft: false, item });
        assert.equal(returned.length, 1);
        assert.equal(returned[0].item, item);
        assert.equal(returned[0].action, "generate");
        assert.deepEqual(returned[0].context, { draftId: "42" });
        assert.equal(returned[0].returnKey, handoff.returnKey);
        assert.equal(returned[0].handoffKey, handoff.key);
        assert.deepEqual(events, embedded ? ["returned", "clear", "close"] : ["saved", "clear", "navigate"]);

        const inserted: unknown[] = [];
        let complete!: () => void;
        const completed = new Promise<void>((resolve) => { complete = resolve; });
        execute<() => void>(insertionEffect.arguments[0], publishSource, {
          pendingStudioReturn: returned[0], loadedPublicationDraftId: "42",
          inlineStudioReturnKeyRef: { current: embedded ? handoff.returnKey : "" },
          studioReturnApplyingKeyRef: { current: "" },
          addMediaLibrarySelection: async (items: unknown[], destination: unknown) => {
            assert.deepEqual(destination, { kind: "publication" }); inserted.push(...items); return true;
          },
          setImgError: (message: string) => { assert.fail(message); },
          setPendingStudioReturn: (result: unknown) => { assert.equal(result, null); },
          completeReturn: complete,
        })();
        await completed;
        assert.deepEqual(inserted, [item]);
      }
    }
  }
});
