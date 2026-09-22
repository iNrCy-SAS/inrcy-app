import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const requireFromTest = createRequire(import.meta.url);

function createRuntime(generatedCopy?: Record<string, unknown>) {
  const gatewayCalls: Array<Record<string, unknown>> = [];
  const cache = new Map<string, { exports: Record<string, unknown> }>();

  function load<T = Record<string, unknown>>(name: string): T {
    const filename = path.resolve(name);
    const cached = cache.get(filename);
    if (cached) return cached.exports as T;
    const record = { exports: {} as Record<string, unknown> };
    cache.set(filename, record);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    new Function("module", "exports", "require", output)(
      record,
      record.exports,
      (specifier: string) => {
        if (specifier === "server-only") return {};
        if (specifier === "@/lib/aiGatewayClient") {
          return {
            aiGenerateJSON: async (args: Record<string, unknown>) => {
              gatewayCalls.push(args);
              return generatedCopy;
            },
          };
        }
        if (specifier.startsWith("node:")) return requireFromTest(specifier);
        const local = specifier.startsWith("@/lib/")
          ? path.resolve("lib", specifier.slice("@/lib/".length))
          : specifier.startsWith(".")
            ? path.resolve(path.dirname(filename), specifier)
            : null;
        if (!local) throw new Error(`unexpected_test_dependency:${specifier}`);
        return load(local.endsWith(".ts") ? local : `${local}.ts`);
      }
    );
    return record.exports as T;
  }

  return { load, gatewayCalls };
}

function buildFixture(brief: string, generatedCopy?: Record<string, unknown>) {
  const env = createRuntime(generatedCopy);
  const profile = env
    .load<typeof import("../../lib/aiGenerationProfile.ts")>(
      "lib/aiGenerationProfile.ts"
    )
    .buildNormalizedAiGenerationProfile({
      business: {
        company_name: "iNrCy",
        profession: "Communication numérique",
        city: "Arras",
      },
      preferences: { language: "fr" },
    });
  const request = env
    .load<typeof import("../../lib/aiMediaGenerationContracts.ts")>(
      "lib/aiMediaGenerationContracts.ts"
    )
    .normalizeAiMediaGenerationRequest({
      requestId: `commercial-${brief.length}`,
      source: "studio",
      kind: "image",
      subjectSource: "custom",
      idea: brief,
      textMode: "ai",
      withText: true,
      imagePurpose: "flyer",
      inspirationImages: [],
    });
  const plan = env
    .load<typeof import("../../lib/aiMediaCreativePlan.ts")>(
      "lib/aiMediaCreativePlan.ts"
    )
    .buildAiMediaCreativePlan({ request, profile });
  return { ...env, profile, request, plan };
}

test("les variantes d'offres gardent noms, fiscalité et périodicité sans coupe", () => {
  const fixtures = [
    {
      brief:
        "deux packs : Standard à 58 € HT par mois et Premium à 108 € HT par mois",
      expected: [
        "Standard",
        "Premium",
        "58 € HT par mois",
        "108 € HT par mois",
      ],
    },
    {
      brief:
        "Comparez nos formules Essentiel à 29,90 € TTC / mois et Pro à 49,90 € TTC / mois.",
      expected: [
        "Essentiel",
        "Pro",
        "29,90 € TTC / mois",
        "49,90 € TTC / mois",
      ],
    },
    {
      brief:
        "Nos offres : starter à 19 euros hors taxes par mois ou business à 39 euros hors taxes par mois.",
      expected: [
        "starter",
        "business",
        "19 euros hors taxes par mois",
        "39 euros hors taxes par mois",
      ],
    },
  ] as const;

  for (const fixture of fixtures) {
    const { load, request, profile, plan } = buildFixture(fixture.brief);
    const deck = [plan.headline, plan.subline, plan.cta].join(" ");
    const protectedTerms = load<
      typeof import("../../lib/aiMediaTextIntegrity.ts")
    >("lib/aiMediaTextIntegrity.ts").collectAiMediaProtectedTerms({
      request,
      profile,
    });
    for (const expected of fixture.expected) {
      assert.match(deck, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"));
      assert.ok(
        protectedTerms.some((term) => term.toLocaleLowerCase() === expected.toLocaleLowerCase()),
        `terme commercial protégé manquant : ${expected}`
      );
    }
    assert.doesNotMatch(deck, /(?:\.{3}|…)\s*$/u);
  }
});

test("le compositeur reçoit la sous-ligne réellement validée par le copywriter", async () => {
  const brief =
    "deux packs : Standard à 58 € HT par mois et Premium à 108 € HT par mois";
  const validatedBody =
    "Deux choix : Standard 58 € HT par mois, Premium 108 € HT par mois.";
  const generated = {
    headline: "Standard ou Premium",
    cta: "Comparez les deux packs",
    scenes: [
      {
        eyebrow: "Deux packs mensuels",
        title: "Standard ou Premium",
        body: validatedBody,
        spokenLine: "Comparez nos deux packs mensuels dès aujourd'hui.",
        spokenReply: "Choisissez celui qui correspond à vos besoins.",
      },
    ],
  };
  const fixture = buildFixture(brief, generated);
  assert.notEqual(fixture.plan.subline, validatedBody);

  const result = await fixture
    .load<typeof import("../../lib/aiMediaCopywriter.ts")>(
      "lib/aiMediaCopywriter.ts"
    )
    .writeAiMediaHeadline({
      accountId: "commercial-copy-test",
      request: fixture.request,
      profile: fixture.profile,
      plan: fixture.plan,
    });

  assert.equal(result.subline, validatedBody);
  assert.equal(result.scenes[0]?.body, validatedBody);
  assert.equal(fixture.gatewayCalls.length, 1);
  assert.equal(fixture.gatewayCalls[0]?.maxOutputTokens, 1_024);
  assert.equal(fixture.gatewayCalls[0]?.timeoutMs, 30_000);
  assert.equal(typeof fixture.gatewayCalls[0]?.deadlineAt, "number");
});
