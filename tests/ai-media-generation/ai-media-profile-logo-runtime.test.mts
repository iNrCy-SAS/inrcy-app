import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import * as profileLogo from "../../lib/profileLogo.ts";
import * as videoLayout from "../../lib/aiMediaVideoLayout.ts";
import * as textIntegrity from "../../lib/aiMediaTextIntegrity.ts";
import { getAiMediaFreeBrandPolicy, isAiMediaProfileLogoApplicationRequested } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import type { AiMediaBrandKit } from "../../lib/aiMediaBrandKit.ts";
import type { composeAiMediaBrandedImage } from "../../lib/aiMediaBrandRenderer.ts";

type Row = Record<string, unknown>;
function load<T>(file: string, mocks: Map<string, unknown>): T {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const runtime = { exports: {} };
  const nativeRequire = createRequire(import.meta.url);
  new Function("module", "exports", "require", compiled)(runtime, runtime.exports, (id: string) => {
    if (mocks.has(id)) return mocks.get(id);
    if (id.startsWith("node:")) return nativeRequire(id);
    throw new Error(`unexpected_dependency:${id}`);
  });
  return runtime.exports as T;
}

async function fixtureLogo() {
  return sharp({ create: { width: 100, height: 60, channels: 4, background: "#dd0000" } })
    .composite([{ input: await sharp({ create: { width: 50, height: 60, channels: 4, background: "#0000dd" } }).png().toBuffer(), left: 50, top: 0 }])
    .png().toBuffer();
}

function kitHarness(profile: Row | null, buffer: Buffer | null, readError = false) {
  const reads: Array<{ bucket: string; path: string }> = [];
  const queries: Array<[string, unknown]> = [];
  const runtime = load<{ loadAiMediaBrandKit: (args: { accountId: string; profile: Row | null; requireFreshLogo?: boolean }) => Promise<AiMediaBrandKit> }>("lib/aiMediaBrandKit.ts", new Map<string, unknown>([
    ["server-only", {}], ["sharp", sharp], ["@/lib/profileLogo", profileLogo],
    ["@/lib/safeStorageSignedUrl", { createSafeStorageSignedUrl: async () => null }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: {
      from(table: string) {
        assert.equal(table, "profiles");
        return { select(columns: string) {
          assert.equal(columns, "logo_path,logo_url");
          return { eq(column: string, value: unknown) {
            queries.push([column, value]);
            return { maybeSingle: async () => ({ data: profile, error: readError ? { message: "unavailable" } : null }) };
          } };
        } };
      },
      storage: { from(bucket: string) { return { download: async (path: string) => {
        reads.push({ bucket, path });
        return { data: buffer ? new Blob([new Uint8Array(buffer)]) : null, error: buffer ? null : { message: "missing" } };
      } }; } },
    } }],
  ]));
  return { reads, queries, load: (cached: Row | null = null, strict = true) => runtime.loadAiMediaBrandKit({ accountId: "account-a", profile: cached, requireFreshLogo: strict }) };
}

test("the current account profile overrides a stale cached logo and supplies decoded pixels", async () => {
  const original = await fixtureLogo();
  const h = kitHarness({ logo_path: "account-a/current.png", logo_url: "/api/public/logo?path=account-a%2Fcurrent.png&v=current-version" }, original);
  const kit = await h.load({ logo_path: "account-a/old.png" });
  assert.deepEqual(h.queries, [["user_id", "account-a"]]);
  assert.deepEqual(h.reads, [{ bucket: "logos", path: "account-a/current.png" }]);
  assert.equal(kit.logoVersion, "current-version");
  assert.equal(kit.logoPath, "account-a/current.png");
  assert.ok(kit.logo);
  const expected = await sharp(original).raw().toBuffer();
  assert.deepEqual(await sharp(kit.logo).raw().toBuffer(), expected);
});

test("foreign and traversal logo paths never reach privileged storage", async () => {
  for (const logo_path of ["account-b/logo.png", "account-a/../account-b/logo.png", "account-a/%2e%2e/account-b/logo.png", "account-a/..\\account-b\\logo.png"]) {
    const h = kitHarness({ logo_path }, await fixtureLogo());
    const kit = await h.load();
    assert.equal(kit.logo, null, logo_path);
    assert.deepEqual(h.reads, [], logo_path);
  }
});

test("an explicit logo cannot fall back to stale data after profile failure, deletion, missing bytes or corruption", async () => {
  const cached = { logo_path: "account-a/cached.png" };
  for (const [profile, bytes, readError] of [
    [null, await fixtureLogo(), true],
    [null, await fixtureLogo(), false],
    [{ logo_path: "account-a/current.png" }, null, false],
    [{ logo_path: "account-a/current.png" }, Buffer.from("not-an-image"), false],
  ] as const) {
    const h = kitHarness(profile, bytes, readError);
    const kit = await h.load(cached);
    assert.equal(kit.logo, null);
    assert.equal(kit.logoVersion, null);
    if (!profile) assert.deepEqual(h.reads, []);
  }
});

test("profile ownership and explicit edit semantics do not substitute another brand's logo", () => {
  for (const prompt of ["Utilise le logo du profil.", "Remplace le faux logo par mon logo enregistré dans Profil.", "Ajoute le logo du profil en haut au centre. N’invente pas un nouveau logo.", "Utilise le logo officiel de mon entreprise."]) {
    assert.equal(isAiMediaProfileLogoApplicationRequested(prompt, "Atelier Test"), true, prompt);
    assert.equal(getAiMediaFreeBrandPolicy(prompt, "Atelier Test", true).useLogo, true, prompt);
  }
  for (const prompt of ["Ajoute le logo du profil de mon client.", "Utilise le logo du profil de Nike.", "Ajoute le logo officiel de Nike.", "Ajoute le logo de mon partenaire.", "Conserve mon logo.", "Ne remplace pas mon logo.", "Crée un nouveau logo pour mon entreprise."]) {
    assert.equal(isAiMediaProfileLogoApplicationRequested(prompt, "Atelier Test"), false, prompt);
  }
});

test("the final image contains the actual logo pixels at the requested position, without changing its canvas", async () => {
  const runtime = load<{ composeAiMediaBrandedImage: typeof composeAiMediaBrandedImage }>("lib/aiMediaBrandRenderer.ts", new Map<string, unknown>([
    ["server-only", {}], ["sharp", sharp], ["@/lib/aiMediaVideoLayout", videoLayout], ["@/lib/aiMediaTextIntegrity", textIntegrity],
  ]));
  const input = await sharp({ create: { width: 840, height: 1200, channels: 3, background: "#00bb00" } }).png().toBuffer();
  const args: Parameters<typeof composeAiMediaBrandedImage>[0] = {
    input, width: 840, height: 1200, logo: await fixtureLogo(), requireLogo: true,
    colors: ["#dd0000", "#0000dd", "#00bb00"], companyName: "Synthetic fixture", visualStyle: "clean", logoMode: "discreet",
    logoPlacement: { horizontal: "center", vertical: "top", size: "large" }, withText: false,
    scene: { eyebrow: "", title: "", body: "", spokenLine: "", spokenReply: "", visualBrief: "", layout: "editorial" },
  };
  const composed = await runtime.composeAiMediaBrandedImage(args);
  const pixels = await sharp(composed).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(pixels.info.width, 840); assert.equal(pixels.info.height, 1200);
  const pixel = (x: number, y: number) => [...pixels.data.subarray((y * 840 + x) * 3, (y * 840 + x) * 3 + 3)];
  const red = pixel(395, 85); const blue = pixel(445, 85); const background = pixel(50, 1000);
  assert.ok(red[0] > 190 && red[1] < 30 && red[2] < 30, `real left half: ${red}`);
  assert.ok(blue[0] < 30 && blue[1] < 30 && blue[2] > 190, `real right half: ${blue}`);
  assert.ok(background[0] < 30 && background[1] > 160 && background[2] < 30);
  await assert.rejects(runtime.composeAiMediaBrandedImage({ ...args, logo: Buffer.from("corrupt") }), /required_logo_not_composed/);
  await assert.rejects(runtime.composeAiMediaBrandedImage({ ...args, logo: null }), /required_logo_not_composed/);
});
