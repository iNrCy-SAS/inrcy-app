import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import sharp from "sharp";
import ts from "typescript";

import {
  cleanAiMediaProfilePhone,
  isAiMediaProfilePhoneDisplayRequested,
} from "../../lib/aiMediaVisibleContact.ts";

function loadContactComposer() {
  const filename = path.join(process.cwd(), "lib/aiMediaImageContactComposer.ts");
  const transpiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const commonJsModule = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "sharp") return sharp;
    throw new Error(`unexpected_test_dependency:${specifier}`);
  };
  const factory = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {${transpiled}\n})`,
    { filename: "aiMediaImageContactComposer.runtime.cjs" },
  ) as (
    exports: Record<string, unknown>,
    require: (specifier: string) => unknown,
    module: { exports: Record<string, unknown> },
    filename: string,
    dirname: string,
  ) => void;
  factory(
    commonJsModule.exports,
    localRequire,
    commonJsModule,
    filename,
    path.dirname(filename),
  );
  return commonJsModule.exports.composeAiMediaContactImage as (args: {
    input: Buffer;
    width: number;
    height: number;
    headline: string;
    phone: string;
    officialLogo: Buffer;
    logoMode: "visible";
    brandColors: string[];
  }) => Promise<Buffer>;
}

test("le téléphone du profil n'est composé que sur demande explicite", () => {
  assert.equal(
    isAiMediaProfilePhoneDisplayRequested(
      "Mets le téléphone du pro sur l'image, de façon élégante.",
    ),
    true,
  );
  assert.equal(
    isAiMediaProfilePhoneDisplayRequested(
      "Ajoute notre numéro de téléphone au visuel.",
    ),
    true,
  );
  assert.equal(
    isAiMediaProfilePhoneDisplayRequested(
      "Ne pas afficher le téléphone sur cette image.",
    ),
    false,
  );
  assert.equal(
    isAiMediaProfilePhoneDisplayRequested(
      "N’affiche pas le téléphone sur cette image.",
    ),
    false,
  );
  assert.equal(
    isAiMediaProfilePhoneDisplayRequested("Mets mon numéro sur l’image."),
    true,
  );
  assert.equal(
    isAiMediaProfilePhoneDisplayRequested(
      "Inscris le 06 12 34 56 78 sur le visuel.",
    ),
    true,
  );
  assert.equal(
    isAiMediaProfilePhoneDisplayRequested(
      "Crée une ambiance chaleureuse et lumineuse.",
    ),
    false,
  );
  assert.equal(
    isAiMediaProfilePhoneDisplayRequested(
      "Ajoute un téléphone portable dans la main du personnage.",
    ),
    false,
  );
});

test("seul un numéro plausible réellement enregistré peut être affiché", () => {
  assert.equal(cleanAiMediaProfilePhone("01 23 45 67 89"), "01 23 45 67 89");
  assert.equal(
    cleanAiMediaProfilePhone("Tél. : +33 (0)1 23 45 67 89"),
    "+33 (0)1 23 45 67 89",
  );
  assert.equal(cleanAiMediaProfilePhone("123"), "");
  assert.equal(cleanAiMediaProfilePhone("contact indisponible"), "");
});

test("le compositeur exact produit un JPEG complet dans les quatre formats", async () => {
  const composeAiMediaContactImage = loadContactComposer();
  const input = await sharp({
    create: {
      width: 640,
      height: 640,
      channels: 3,
      background: "#94a3b8",
    },
  })
    .jpeg()
    .toBuffer();
  const logo = Buffer.from(
    '<svg width="180" height="70" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="70" rx="12" fill="#fff"/><text x="22" y="46" font-family="Arial" font-size="32" fill="#111827">AGIRA</text></svg>',
  );

  for (const [width, height] of [
    [1080, 1080],
    [1080, 1350],
    [1080, 1920],
    [1920, 1080],
  ] as const) {
    const output = await composeAiMediaContactImage({
      input,
      width,
      height,
      headline: "La peinture dans une école à Guyancourt",
      phone: "01 23 45 67 89",
      officialLogo: logo,
      logoMode: "visible",
      brandColors: ["#21b8ef", "#8b5cf6", "#e94aa5"],
    });
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, height);
    assert.ok(output.byteLength > 10_000);
  }
});
