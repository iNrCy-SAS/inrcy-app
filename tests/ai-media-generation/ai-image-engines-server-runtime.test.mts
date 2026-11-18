import * as pendingVideo from "../../lib/aiMediaPendingVideo.ts";
import * as nativeQa from "../../lib/aiMediaNativeDialogueQa.ts";
import * as videoProviderTypes from "../../lib/aiVideoProviderTypes.ts";
import { loadNarrationPreparationRuntime } from "./narration-preparation-runtime.mjs";
import * as characterVoices from "../../lib/aiMediaCharacterVoices.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as imageRequest from "../../lib/aiMediaImageProviderRequest.ts";
import * as freePrompt from "../../lib/aiMediaFreeGenerationPrompt.ts";
import * as freeVoiceoverPolicy from "../../lib/aiMediaFreeVoiceoverPolicy.ts";
import * as sensitive from "../../lib/aiMediaSensitiveText.ts";
import * as agentVideoFallback from "../../lib/inrAgentVideoFallback.ts";
import * as publicErrors from "../../lib/aiMediaGenerationPublicErrors.ts";
import * as spokenScript from "../../lib/aiMediaSpokenScript.ts";
import * as pronunciation from "../../lib/aiMediaPronunciation.ts";
import * as globalConstraints from "../../lib/aiMediaGlobalConstraints.ts";

type RecordValue = Record<string, unknown>;
function compile(file: string, modules: Map<string, unknown>, quiet = false) {
  const filename = path.join(process.cwd(), file);
  const javascript = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const nativeRequire = createRequire(import.meta.url);
  const runtimeModule = { exports: {} };
  vm.runInThisContext(`(function(exports,require,module,console){${javascript}\n})`)(runtimeModule.exports, (id: string) => {
    if (modules.has(id)) return modules.get(id);
    if (id.startsWith("node:")) return nativeRequire(id);
    throw new Error(`unexpected_test_dependency:${id}`);
  }, runtimeModule, quiet ? { info() {}, warn() {}, error() {} } : console);
  return runtimeModule.exports as Record<string, (...args: never[]) => unknown>;
}

function realCapabilityGate() {
  return compile("lib/aiMediaImageProviderGateway.ts", new Map<string, unknown>([
    ["server-only", {}], ["./aiMediaCharacterVoices.ts", characterVoices], ["@/lib/aiMediaCharacterVoices", characterVoices], ["sharp", {}], ["ai", {}], ["@/lib/aiGatewayAccountGuard", {}],
    ["./aiMediaModelCatalog.ts", catalog], ["./aiMediaCreditsPricing.ts", pricing],
    ["./aiMediaBuffer.ts", {}], ["./aiMediaSensitiveText.ts", sensitive],
  ])).assertAiMediaGatewayImageInputs;
}

function serverHarness(providerFailure: boolean | Error = false, options: { logo?: Buffer | null; logoLayout?: RecordValue; composerFailure?: boolean | Error; composer?: (args: RecordValue) => Promise<Buffer>; providerImage?: Buffer; phone?: string; normalizedCanvas?: { width: number; height: number } } = {}) {
  const counts = { creative: 0, headline: 0, provider: 0, fallback: 0, branded: 0, saved: 0 };
  const providerCalls: RecordValue[] = [];
  const composerCalls: RecordValue[] = [];
  const contactCalls: RecordValue[] = [];
  const saved: RecordValue[] = [];
  const promptCalls: RecordValue[] = [];
  const plan = { companyName: "Atelier Test", headline: "Une création soignée", subline: "Objet original", cta: "",
    scenes: [{ eyebrow: "Atelier Test", title: "Une création soignée", body: "Objet original", visualBrief: "Objet sur une table", layout: "editorial" }] };
  const profile = { business: { companyName: "Atelier Test", phone: options.phone || "" }, preferences: {} };
  const logo = options.logo === undefined ? Buffer.from("synthetic-official-logo") : options.logo;
  const unused = ["./aiMediaDirectVideoPipeline.ts", "./aiMediaDirectAvatarDialogue.ts", "@/lib/aiMediaBusinessDna", "@/lib/aiMediaImageContactComposer", "@/lib/aiMediaGeneratedVideo", "@/lib/aiMediaVideoLayout",
    "@/lib/aiMediaVideoProviderContract", "@/lib/aiMediaVideoLocalQa", "@/lib/aiMediaReferenceTeam", "@/lib/aiMediaNarration", "@/lib/aiMediaNarrationAudio",
    "@/lib/aiMediaNativeDialogueQaGoogle", "@/lib/aiMediaDialogue", "@/lib/aiMediaGenerationSoundtracks", "@/lib/aiVideoProvider",
    "@/lib/aiVideoReliability", "@/lib/aiVideoProviderTypes", "@/lib/aiMediaGenerationQuotaPolicy", "@/lib/aiMediaVideoTimeline", "@/lib/aiMediaVideoTemporaryImages"];
  const modules = new Map<string, unknown>(unused.map(id => [id, {}]));
  const image = async (args: RecordValue) => {
    counts.provider += 1; providerCalls.push(args);
    if (providerFailure) throw providerFailure instanceof Error ? providerFailure : new Error("selected_provider_failed");
    const engine = args.imageEngine as catalog.AiMediaImageEngine;
    const references = args.identityReferences as Buffer[];
    return { kind: "image", provider: "vercel-ai-gateway", engine, upstreamProvider: catalog.getAiMediaImageModel(engine).provider,
      model: catalog.getAiMediaImageModel(engine).modelId, buffer: options.providerImage || Buffer.from("provider-output"), mediaType: "image/jpeg",
      referenceImagesCount: references.length + Number(Boolean(args.officialLogo)), identityReferenceImagesCount: 0, genericReferenceImagesCount: references.length,
      officialLogoIncluded: Boolean(args.officialLogo), warnings: [], usage: null };
  };
  const overrides: Array<[string, unknown]> = [
    ["./aiMediaPendingVideo.ts", pendingVideo],
    ["@/lib/aiMediaNativeDialogueQa", nativeQa],
    ["@/lib/aiVideoProviderTypes", videoProviderTypes],
    ["./aiMediaGlobalConstraints.ts", globalConstraints],
    ["./aiMediaSpokenScript.ts", spokenScript],
    ["./aiMediaPronunciation.ts", pronunciation],
    ["./inrAgentVideoFallback.ts", agentVideoFallback],
    ["./aiMediaGenerationPublicErrors.ts", publicErrors],
    ["server-only", {}], ["./aiMediaCharacterVoices.ts", characterVoices], ["@/lib/aiMediaCharacterVoices", characterVoices], ["sharp", {}],
    ["@/lib/aiGenerationProfile", { buildNormalizedAiGenerationProfile: () => profile }],
    ["@/lib/aiMediaBrandKit", { loadAiMediaBrandKit: async () => ({ colors: ["#112233", "#445566", "#778899"], hasOfficialPalette: true, logo, logoVersion: "test" }) }],
    ["@/lib/aiMediaFreeDnaContextServer", { loadAiMediaFreeDnaContext: async () => ({ coordonnees: { telephone: "01 23 45 67 89" }, liens: { site_web: "https://atelier.example/" }, informations_demandees: [] }) }],
    ["@/lib/aiMediaBrandRenderer", { composeAiMediaBrandedImage: async (args: RecordValue) => { counts.branded += 1; composerCalls.push(args); if (options.composer) return options.composer(args); if (options.composerFailure) throw options.composerFailure instanceof Error ? options.composerFailure : new Error("ai_media_required_logo_not_composed"); if (options.logoLayout) (args.onLogoLayout as ((layout: RecordValue) => void) | undefined)?.(options.logoLayout); return Buffer.from("locally-branded-output"); } }],
    ["@/lib/aiMediaImageContactComposer", { composeAiMediaContactImage: async (args: RecordValue) => { contactCalls.push(args); return Buffer.from("locally-contacted-output"); } }],
    ["@/lib/aiMediaCreativePlan", { buildAiMediaCreativePlan: () => plan }],
    ["@/lib/aiMediaCastingVariation", { chooseAiMediaCastingVariation: () => null }],
    ["@/lib/aiMediaCopywriter", { writeAiMediaHeadline: async () => { counts.headline += 1; return plan; } }],
    ["@/lib/aiMediaFreeGenerationPlan", { buildAiMediaFreeBasePlan: () => plan, prepareAiMediaFreeCreativePlan: async () => { counts.creative += 1; return plan; } }],
    ["@/lib/aiMediaFreeGenerationPrompt", freePrompt],
    ["@/lib/aiMediaFreeVoiceoverPolicy", freeVoiceoverPolicy],
    ["@/lib/aiGatewayAccountGuard", { AiGatewayAccountLimitError: class extends Error {}, AiGatewayGuardUnavailableError: class extends Error {} }],
    ["@/lib/aiGeneratedMediaRegistry", { getExistingGeneratedAiMedia: async () => null, saveGeneratedAiMedia: async (args: RecordValue) => { counts.saved += 1; saved.push(args); return { id: "test-media", media_type: "image" }; } }],
    ["@/lib/boosterGenerationContext", { getBoosterGenerationContext: async () => ({ profile: {}, business: {}, recentPublications: [], cacheSource: "test" }) }],
    ["@/lib/aiMediaGenerationContracts", contracts],
    ["@/lib/aiMediaModelCatalog", catalog],
    ["@/lib/aiMediaGateway", { generateAiMediaImage: image, generateAiMediaImageWithGoogle: async (args: RecordValue) => {
      if (args.imageEngine === "gemini") return image(args);
      counts.fallback += 1; throw new Error("unexpected_google_fallback");
    } }],
    ["@/lib/aiMediaImageProviderRequest", imageRequest],
    ["./aiMediaImageProviderGateway.ts", { assertAiMediaGatewayImageInputs: realCapabilityGate() }],
    ["@/lib/aiMediaIdentityReferences", { AiMediaIdentityReferenceValidationError: class extends Error {}, prepareAiMediaIdentityReferences: async (images: contracts.AiMediaInspirationImage[]) => ({ providerImages: images, buffers: images.map(() => Buffer.from("sanitized-image")) }) }],
    ["@/lib/aiMediaGenerationPrompt", { AI_MEDIA_PROMPT_VERSION: "test-version", buildAiMediaPrompt: (args: RecordValue) => { promptCalls.push(args); return "Compiled requested image prompt"; }, getAiMediaPromptOutputSpec: () => ({ kind: "image" }) }],
    ["@/lib/aiMediaNormalizer", { normalizeGeneratedAiImage: async (buffer: Buffer, canvas: { width: number; height: number }) => ({ kind: "image", buffer, mimeType: "image/jpeg", extension: "jpg", width: options.normalizedCanvas?.width || canvas.width, height: options.normalizedCanvas?.height || canvas.height, durationSeconds: null }) }],
    ["@/lib/aiMediaSensitiveText", sensitive],
    ["@/lib/aiMediaVisibleContact", { isAiMediaProfilePhoneDisplayRequested: () => Boolean(options.phone), cleanAiMediaProfilePhone: () => options.phone || "" }],
    ["@/lib/aiMediaCreditQuoteServer", { quoteAiMediaRequest: (_account: string, request: contracts.AiMediaGenerationRequest) => pricing.quoteAiMediaCredits({ ...request, inspirationImagesCount: request.inspirationImages.length }) }],
  ];
  for (const [id, moduleValue] of overrides) modules.set(id, moduleValue);
  modules.set("@/lib/aiMediaNarrationPreparation", loadNarrationPreparationRuntime(modules));
  const runtime = compile("lib/aiMediaGenerationServer.ts", modules, true) as unknown as { generateAndSaveAiMedia: (args: RecordValue) => Promise<unknown> };
  return { counts, providerCalls, composerCalls, contactCalls, promptCalls, saved, logo, generate: (request: contracts.AiMediaGenerationRequest, execution: RecordValue = {}) => runtime.generateAndSaveAiMedia({ accountId: "test-account", authUserId: "test-actor", jobId: "test-job", supabase: {}, request, ...execution }) };
}

function request(engine: catalog.AiMediaImageEngine, options: RecordValue = {}) {
  return contracts.normalizeAiMediaGenerationRequest({ requestId: "image-engines-server-test", source: "studio", kind: "image", operation: "generate",
    creationMode: "guided", inputMode: "essential", subjectSource: "custom", idea: "Un objet artisanal original sur une table.", format: "landscape",
    imageEngine: engine, textMode: "none", withText: false, logoMode: "visible", modificationSourceWidth: 840, modificationSourceHeight: 1200, ...options });
}
const ref = () => ({ mimeType: "image/png", data: "A".repeat(88), role: "product", usage: "required" }) as contracts.AiMediaInspirationImage;
async function withCredentials(run: () => Promise<void>) {
  const original = process.env.AI_GATEWAY_API_KEY; process.env.AI_GATEWAY_API_KEY = "synthetic-test";
  try { await run(); } finally { if (original === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = original; }
}

const nativeLogoEngines = ["openai", "gemini", "flux", "grok"] as const;
function assertNativeLogo(h: ReturnType<typeof serverHarness>) {
  assert.equal(h.providerCalls[0].officialLogo, h.logo, "The actual saved asset must reach the image provider");
  const metadata = h.saved[0].metadata as { gateway: RecordValue; provenance: RecordValue };
  assert.equal(metadata.gateway.official_logo_included, true);
  assert.equal(metadata.gateway.local_logo_composition_applied, false);
  assert.equal(metadata.gateway.logo_application_method, "provider_reference");
  assert.equal(metadata.provenance.logo_application_method, "provider_reference");
  assert.equal(metadata.provenance.official_logo_source, "account_profile");
  assert.equal(metadata.provenance.official_logo_reference_sha256, createHash("sha256").update(h.logo!).digest("hex"));
  assert.equal(metadata.provenance.official_logo_reference_version, "test");
  assert.equal(metadata.provenance.exact_logo_applied, false, "A supplied reference is not proof of exact pixels in the result");
  assert.equal(metadata.provenance.local_logo_composition_applied, false);
  assert.equal(metadata.provenance.image_logo_layout, undefined);
  assert.equal(metadata.provenance.official_logo_sha256, undefined);
  assert.equal(metadata.provenance.logo_version_applied, null);
  assert.equal(h.promptCalls[0].hasLogo, true);
  assert.equal(h.promptCalls[0].logoComposedLocally, false);
  assert.doesNotMatch(String(h.providerCalls[0].prompt), /ZONE RÉSERVÉE AU LOGO FINAL|Ne pas dessiner, imiter, réinterpréter ni inventer de logo/);
  assert.equal(h.counts.provider, 1); assert.equal(h.counts.fallback, 0); assert.equal(h.counts.saved, 1);
}

for (const engine of nativeLogoEngines) {
  for (const withText of [false, true]) {
    test(`${engine}: guided images send the real logo to the selected provider while ${withText ? "preserving exact copy separately" : "keeping the generated result intact"}`, async () => {
      await withCredentials(async () => {
        const h = serverHarness();
        await h.generate(request(engine, { withText, textMode: withText ? "ai" : "none" }));
        assertNativeLogo(h);
        assert.deepEqual(h.providerCalls[0].identityReferences, []);
        assert.equal(h.composerCalls.length, withText ? 1 : 0);
        if (withText) {
          assert.equal(h.composerCalls[0].logo, null);
          assert.equal(h.composerCalls[0].requireLogo, false);
          assert.equal(h.composerCalls[0].logoMode, "none");
          assert.equal(h.composerCalls[0].withText, true);
        } else assert.deepEqual((h.saved[0].media as RecordValue).buffer, Buffer.from("provider-output"));
        const metadata = h.saved[0].metadata as { gateway: RecordValue };
        assert.equal(metadata.gateway.engine, engine);
        assert.equal(metadata.gateway.reference_images_count, 1);
      });
    });
  }
}

test("checked ADN supplies the existing profile logo on all four compatible engines without changing the free request", async () => {
  await withCredentials(async () => {
    for (const engine of nativeLogoEngines) {
      const h = serverHarness(false, { composerFailure: new Error("ai_media_logo_no_safe_placement") });
      const input = request(engine, { creationMode: "free", useBusinessDna: true,
        freePrompt: "Une équipe de nettoyage au travail dans un bureau lumineux." });
      const original = structuredClone(input);
      await h.generate(input);
      assert.deepEqual(input, original);
      assert.equal(input.logoMode, "none", "The inactive guided control does not suppress an ADN logo");
      assertNativeLogo(h);
      assert.equal(h.composerCalls.length, 0, "There is no post-generation logo placement or pixel rejection");
      assert.deepEqual((h.saved[0].media as RecordValue).buffer, Buffer.from("provider-output"));
      const provenance = (h.saved[0].metadata as { provenance: RecordValue }).provenance;
      assert.equal(provenance.business_dna_requested, true);
      assert.equal(provenance.business_dna_used, true);
      const context = h.promptCalls[0].businessDnaContext as { coordonnees: RecordValue; liens: RecordValue };
      assert.equal(context.coordonnees.telephone, "01 23 45 67 89");
      assert.equal(context.liens.site_web, "https://atelier.example/");
    }
  });
});

test("explicit logo placement stays in the creative request instead of adding a reserved local rectangle", async () => {
  await withCredentials(async () => {
    for (const engine of nativeLogoEngines) {
      const h = serverHarness();
      await h.generate(request(engine, { creationMode: "free", useBusinessDna: false, format: "square",
        freePrompt: "Une affiche avec le logo du profil en bas à gauche. N’invente pas un nouveau logo." }));
      assertNativeLogo(h);
      assert.equal(h.composerCalls.length, 0);
      assert.equal(h.promptCalls[0].request && (h.promptCalls[0].request as contracts.AiMediaGenerationRequest).freePrompt?.includes("en bas à gauche"), true);
      assert.equal((h.saved[0].metadata as { provenance: RecordValue }).provenance.business_dna_used, undefined);
    }
  });
});

test("a logo reference uses one of the selected engine's slots and fails before billing when the total exceeds its capacity", async () => {
  await withCredentials(async () => {
    for (const engine of nativeLogoEngines) {
      const maximum = catalog.getAiMediaImageModel(engine).maxReferenceImages;
      for (const overLimit of [false, true]) {
        const h = serverHarness(); let billable = 0;
        const photoCount = maximum - 1 + Number(overLimit);
        const input = request(engine, { creationMode: "free", useBusinessDna: true,
          freePrompt: "Une photographie présentant tous les produits fournis.",
          inspirationImages: Array.from({ length: photoCount }, ref) });
        const run = h.generate(input, { onBillableWorkStarted: () => { billable++; } });
        if (overLimit) {
          await assert.rejects(run, /au maximum.*logo compris/);
          assert.equal(billable, 0); assert.equal(h.counts.creative, 0); assert.equal(h.counts.provider, 0); assert.equal(h.counts.saved, 0);
        } else {
          await run; assertNativeLogo(h);
          assert.equal((h.providerCalls[0].identityReferences as Buffer[]).length, photoCount);
          assert.equal((h.saved[0].metadata as { gateway: RecordValue }).gateway.reference_images_count, maximum);
          assert.equal(billable, 1);
          assert.equal(h.composerCalls.length, 0);
        }
      }
    }
  });
});

test("Recraft refuses an effective account-logo reference before billing and never substitutes another engine or a local overlay", async () => {
  await withCredentials(async () => {
    for (const controls of [
      { creationMode: "free", useBusinessDna: true, freePrompt: "Une affiche pour notre atelier." },
      { creationMode: "free", useBusinessDna: false, freePrompt: "Ajoute mon logo officiel à cette illustration." },
      { creationMode: "guided", logoMode: "visible" },
    ]) {
      const h = serverHarness(); let billable = 0;
      await assert.rejects(h.generate(request("recraft", controls), { onBillableWorkStarted: () => { billable++; } }), /Recraft.*fichier de votre logo/);
      assert.equal(billable, 0); assert.equal(h.counts.creative, 0); assert.equal(h.counts.headline, 0);
      assert.equal(h.counts.provider, 0); assert.equal(h.counts.fallback, 0); assert.equal(h.counts.saved, 0); assert.equal(h.composerCalls.length, 0);
    }
  });
});

test("Recraft still creates images when no account logo is used", async () => {
  await withCredentials(async () => {
    for (const controls of [
      { creationMode: "free", useBusinessDna: false, freePrompt: "Une illustration originale." },
      { creationMode: "free", useBusinessDna: true, freePrompt: "Une création sans logo et sans charte." },
      { creationMode: "free", useBusinessDna: true, freePrompt: "Crée un nouveau logo pour mon entreprise." },
    ]) {
      const h = serverHarness(); await h.generate(request("recraft", controls));
      assert.equal(h.counts.provider, 1); assert.equal(h.counts.saved, 1);
      assert.equal(h.providerCalls[0].officialLogo, null); assert.equal(h.composerCalls.length, 0);
    }
  });
});

test("explicit exclusions, source-logo preservation and another owner's logo never inject the profile asset", async () => {
  await withCredentials(async () => {
    for (const useBusinessDna of [false, true]) {
      for (const freePrompt of ["Une photographie sans notre logo.", "Une photographie sans logos.", "Retire le logo.", "Supprime les logos.", "Enlève le logo.",
        "Une affiche avec le logo de mon client.", "Une affiche avec le logo joint de mon client.", "Conserve le logo de la photo et change le décor."]) {
        const h = serverHarness();
        await h.generate(request("gemini", { creationMode: "free", useBusinessDna, freePrompt, inspirationImages: [ref()] }));
        assert.equal(h.providerCalls[0].officialLogo, null, freePrompt);
        assert.equal((h.providerCalls[0].identityReferences as Buffer[]).length, 1);
        assert.equal(h.composerCalls.length, 0);
        const metadata = h.saved[0].metadata as { provenance: RecordValue; gateway: RecordValue };
        assert.equal(metadata.provenance.exact_logo_applied, false);
        assert.equal(metadata.provenance.official_logo_reference_sha256, undefined);
        assert.equal(metadata.gateway.official_logo_included, false);
      }
    }
  });
});

test("unchecked ADN does not add hidden logo, palette, business context or a provider reference", async () => {
  await withCredentials(async () => {
    for (const engine of [...nativeLogoEngines, "recraft"] as const) {
      const h = serverHarness();
      await h.generate(request(engine, { creationMode: "free", useBusinessDna: false, useBrandColors: true, logoMode: "visible",
        freePrompt: "Une équipe de nettoyage au travail dans un bureau lumineux." }));
      assert.equal(h.providerCalls[0].officialLogo, null); assert.equal(h.composerCalls.length, 0);
      assert.equal(h.promptCalls[0].hasLogo, false); assert.equal(h.promptCalls[0].logoComposedLocally, false);
      assert.deepEqual(h.promptCalls[0].brandColors, []); assert.equal(h.promptCalls[0].businessDnaContext, undefined);
      assert.equal((h.saved[0].metadata as { provenance: RecordValue }).provenance.business_dna_requested, false);
    }
  });
});

test("a missing optional account logo is not invented and an explicit missing asset fails before billable work", async () => {
  await withCredentials(async () => {
    const optional = serverHarness(false, { logo: null });
    await optional.generate(request("gemini", { creationMode: "free", useBusinessDna: true, freePrompt: "Une photographie d’un jardin fleuri." }));
    assert.equal(optional.providerCalls[0].officialLogo, null);
    assert.match(String(optional.providerCalls[0].prompt), /Aucun fichier de logo officiel.*ne pas en inventer/);
    for (const input of [
      request("gemini", { creationMode: "free", freePrompt: "Une affiche avec le logo du profil." }),
      request("gemini", { operation: "modify", aiInstruction: "Remplace le logo par mon logo enregistré dans le Profil.", inspirationImages: [{ ...ref(), role: "inspiration", usage: "inspiration" }] }),
    ]) {
      const h = serverHarness(false, { logo: null }); let billable = 0;
      await assert.rejects(h.generate(input, { onBillableWorkStarted: () => { billable++; } }), /logo enregistré.*Profil.*absent ou illisible/);
      assert.equal(billable, 0); assert.equal(h.counts.creative, 0); assert.equal(h.counts.provider, 0); assert.equal(h.counts.saved, 0);
    }
  });
});

test("Modify sends its source canvas and the separate official asset to the same selected provider without a local logo pass", async () => {
  await withCredentials(async () => {
    for (const engine of nativeLogoEngines) {
      const h = serverHarness();
      await h.generate(request(engine, { operation: "modify", aiInstruction: "Remplace le faux logo par le logo du profil en haut au centre, conserve le reste.",
        inspirationImages: [{ ...ref(), role: "inspiration", usage: "inspiration" }] }));
      assertNativeLogo(h);
      assert.equal(h.providerCalls[0].operation, "modify");
      assert.deepEqual(h.providerCalls[0].identityReferences, [Buffer.from("sanitized-image")]);
      assert.equal(h.providerCalls[0].size, "848x1200");
      assert.equal((h.saved[0].media as RecordValue).width, 840);
      assert.equal((h.saved[0].media as RecordValue).height, 1200);
      assert.equal(h.composerCalls.length, 0); assert.equal(h.counts.headline, 0);
    }
  });
});

test("Modify preserves source marks or removes them without attaching an unrelated profile logo", async () => {
  await withCredentials(async () => {
    for (const aiInstruction of ["Éclaircis la photographie.", "Retire mon logo.", "Conserve mon logo et change le fond.", "Ne remplace pas mon logo.", "Ajoute le logo du profil de mon client.", "Crée un nouveau logo pour mon entreprise."]) {
      const h = serverHarness();
      await h.generate(request("gemini", { operation: "modify", aiInstruction, inspirationImages: [{ ...ref(), role: "inspiration", usage: "inspiration" }] }));
      assert.equal(h.providerCalls[0].officialLogo, null, aiInstruction); assert.equal(h.composerCalls.length, 0);
    }
  });
});

test("exact phone composition remains independent from the logo integrated by the image provider", async () => {
  await withCredentials(async () => {
    for (const engine of nativeLogoEngines) {
      const h = serverHarness(false, { phone: "06 31 26 08 12", normalizedCanvas: { width: 840, height: 1200 } });
      await h.generate(request(engine, { format: "portrait", withText: true, textMode: "ai", aiInstruction: "Ajoute mon téléphone et mon logo en bas à droite." }));
      assertNativeLogo(h);
      assert.equal(h.contactCalls.length, 1); assert.equal(h.composerCalls.length, 0);
      assert.equal(h.contactCalls[0].phone, "06 31 26 08 12");
      assert.equal(h.contactCalls[0].officialLogo, null); assert.equal(h.contactCalls[0].requireLogo, false); assert.equal(h.contactCalls[0].logoMode, "none");
      assert.equal(h.contactCalls[0].width, 840); assert.equal(h.contactCalls[0].height, 1200);
      const metadata = h.saved[0].metadata as { provenance: RecordValue; gateway: RecordValue };
      assert.equal(metadata.provenance.exact_contact_composition_applied, true);
      assert.equal(metadata.gateway.profile_phone_applied, true);
      assert.deepEqual((h.saved[0].media as RecordValue).buffer, Buffer.from("locally-contacted-output"));
    }
  });
});

test("an independent exact-copy composition failure cannot trigger another image provider or save a false success", async () => {
  await withCredentials(async () => {
    const h = serverHarness(false, { composerFailure: true });
    await assert.rejects(h.generate(request("gemini", { withText: true, textMode: "ai", aiInstruction: "Ajoute une accroche et mon logo." })), /ai_image_exact_copy_composition_failed/);
    assert.equal(h.providerCalls[0].officialLogo, h.logo);
    assert.equal(h.composerCalls[0].logo, null);
    assert.equal(h.counts.provider, 1); assert.equal(h.counts.fallback, 0); assert.equal(h.counts.saved, 0);
  });
});

test("a provider safety refusal never changes supplier or saves another image", async () => {
  await withCredentials(async () => {
    const error = new Error("Your request was rejected by the safety system.");
    const h = serverHarness(error); const input = request("openai", { logoMode: "none" }); input.imageEngine = undefined;
    await assert.rejects(h.generate(input), value => value === error);
    assert.equal(h.counts.provider, 1); assert.equal(h.counts.fallback, 0); assert.equal(h.counts.saved, 0);
  });
});

test("the server locks cancellation once before the first billable plan or image request", async () => {
  await withCredentials(async () => {
    for (const creationMode of ["guided", "free"] as const) {
      const h = serverHarness(); let locks = 0;
      await h.generate(request("grok", { creationMode, freePrompt: creationMode === "free" ? "Photographie d'une tasse sans logo." : undefined }), {
        onBillableWorkStarted: () => { locks++; assert.equal(h.counts.creative, 0); assert.equal(h.counts.headline, 0); assert.equal(h.counts.provider, 0); },
      });
      assert.equal(locks, 1); assert.equal(h.counts.provider, 1); assert.equal(h.counts.saved, 1);
    }
    const h = serverHarness(); const controller = new AbortController();
    await assert.rejects(h.generate(request("grok", { creationMode: "free", freePrompt: "Photographie d'une tasse." }), {
      signal: controller.signal, onBillableWorkStarted: () => controller.abort(new DOMException("Preparation cancelled", "AbortError")),
    }), { name: "AbortError" });
    assert.equal(h.counts.creative, 0); assert.equal(h.counts.provider, 0); assert.equal(h.counts.saved, 0);
  });
});
