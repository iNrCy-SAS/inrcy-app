import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import ts from "typescript";
import type { StudioReferenceMemory } from "../../lib/studioReferences.ts";

// Reuse the real React/CSS fixture, with its tests unregistered and all network blocked.
const require = createRequire(import.meta.url);
const original = new URL("./studio-video-brief-speech-browser.test.mts", import.meta.url);
const source = readFileSync(original, "utf8"), ast = ts.createSourceFile("fixture.mts", source, ts.ScriptTarget.Latest, true);
const firstTest = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "test");
assert.ok(firstTest);
const prefix = source.slice(0, firstTest.getStart(ast)).replaceAll("import.meta.url", JSON.stringify(original.href))
  .replace('from "@playwright/test"', `from ${JSON.stringify(pathToFileURL(require.resolve("@playwright/test")).href)}`)
  .replace('from "typescript"', `from ${JSON.stringify(pathToFileURL(require.resolve("typescript")).href)}`);
const compiled = ts.transpileModule(`${prefix}\nexport { mount };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { mount } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`) as { mount: (page: Page) => Promise<string[]> };
const id = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`;

test("real Studio remembers photos and their dedicated voices across fresh sessions and forgets only the default on desktop and mobile", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1460, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.route("**/*", route => route.abort());
      const errors = await mount(page);
      const initialEngine = await page.evaluate(() => (window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { videoEngine?: string } }> }).fixtureStudioInterfaces.studio_free_form.snapshot.videoEngine);
      await page.evaluate(() => (window as unknown as { fixtureRoot: { render(value: null): void } }).fixtureRoot.render(null));
      await page.locator("[data-media-tools]").waitFor({ state: "detached" });
      const memory: StudioReferenceMemory = { version: 1, references: [
        { id: id(1), mediaLibraryId: id(11), role: "character", usage: "required", characterName: "David", voiceMode: "provided" },
        { id: id(2), mediaLibraryId: id(12), role: "character", usage: "required", characterName: "Kathia", voiceMode: "provided" }],
        voices: [{ id: id(3), libraryMediaId: id(13), target: { referenceId: id(1) }, gender: "male" },
          { id: id(4), libraryMediaId: id(14), target: { referenceId: id(2) }, gender: "female" }], activeNarrationVoiceId: null };
      await page.evaluate((saved: StudioReferenceMemory) => {
        type LocalWindow = Window & { fixtureReferencePreparationEnabled: boolean; fixtureReferencePng: string;
          fixtureSavedMemory: { memory: StudioReferenceMemory | null; gets: number; puts: number; deletes: number; voices: number };
          fixtureDelayMemory: boolean; fixtureResolveMemory?: () => void;
          renderStudio(prompt: string, kind: string): void };
        const state = window as unknown as LocalWindow, priorFetch = window.fetch;
        state.fixtureReferencePreparationEnabled = true; state.fixtureSavedMemory = { memory: saved, gets: 0, puts: 0, deletes: 0, voices: 0 };
        window.fetch = async (input, init = {}) => {
          const url = String(input), storage = state.fixtureSavedMemory;
          if (url === "/api/media-generation/references") {
            if (new Headers(init.headers).get("X-Inrcy-Account-Id") !== "fixture") throw new Error("Missing original professional");
            if (init.method === "PUT") { storage.puts++; storage.memory = JSON.parse(String(init.body)) as StudioReferenceMemory; }
            else if (init.method === "DELETE") { storage.deletes++; storage.memory = null; }
            else { storage.gets++; if (state.fixtureDelayMemory) await new Promise<void>(resolve => { state.fixtureResolveMemory = resolve; }); }
            return Response.json({ ok: true, accountId: "fixture", memory: storage.memory, unavailableMediaIds: [],
              media: storage.memory?.references.map(reference => ({ id: reference.mediaLibraryId, media_type: "image", mime_type: "image/png", title: "Portrait",
                original_file_name: "portrait.png", signed_url: `/__local-studio-memory/${reference.mediaLibraryId}`, size_bytes: 80, width: 2, height: 2, duration_seconds: null })) ?? [] });
          }
          if (url.startsWith("/__local-studio-memory/")) return new Response(Uint8Array.from(atob(state.fixtureReferencePng), character => character.charCodeAt(0)), { headers: { "content-type": "image/png" } });
          if (url === "/api/media-generation/voice-reference" && init.method === "POST") {
            if (new Headers(init.headers).get("X-Inrcy-Account-Id") !== "fixture") throw new Error("Missing voice professional");
            const libraryMediaId = JSON.parse(String(init.body)).mediaLibraryId as string;
            storage.voices++;
            const voice = storage.memory?.voices.find(voice => voice.libraryMediaId === libraryMediaId), target = voice?.target;
            const character = target && target !== "narration" ? storage.memory?.references.find(reference => reference.id === target.referenceId) : undefined;
            return Response.json({ ok: true, sample: { path: `_studio-voice-references/fixture__fresh-${storage.voices}.wav`, name: `${character?.characterName || "Vocal"}.wav`, mimeType: "audio/wav", durationSeconds: 7, sizeBytes: 224044, libraryMediaId } });
          }
          return priorFetch(input, init);
        };
        state.renderStudio("Présente notre activité avec nos personnages habituels.", "image");
      }, memory);
      const update = page.locator("[data-reference-memory-remember]"), forget = page.locator("[data-reference-memory-forget]");
      await forget.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const state = window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { loaded?: boolean; busy?: boolean } }> };
        const memory = state.fixtureStudioInterfaces.studio_reference_memory?.snapshot; return memory?.loaded && !memory.busy;
      });
      const assertNamesAndNumbers = async () => {
        const thumbnails = page.locator("[data-media-reference-thumbnails]");
        assert.equal(await thumbnails.locator("[role=listitem]").count(), 2);
        for (const [index, name] of [[1, "David"], [2, "Kathia"]] as const) {
          const thumbnail = thumbnails.locator(`[data-character-index="${index}"]`);
          assert.equal(await thumbnail.getByText(name, { exact: true }).isVisible(), true);
          assert.match(await thumbnail.locator("button").getAttribute("aria-label") || "", new RegExp(`Personnage ${index}.*${name}`));
          assert.equal(await thumbnail.locator(".free-mediaCharacterCaption > span").first().textContent(), String(index));
        }
      };
      assert.equal(await update.textContent(), "Mettre à jour"); assert.equal(await update.isDisabled(), true); await assertNamesAndNumbers();
      await page.evaluate(() => (window as unknown as { fixtureRoot: { render(value: null): void } }).fixtureRoot.render(null));
      await page.locator("[data-media-tools]").waitFor({ state: "detached" });
      await page.evaluate(() => (window as unknown as { renderStudio(prompt: string, kind: string): void }).renderStudio("Notre duo présente son métier.", "video"));
      await page.waitForFunction(() => {
        const memory = (window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { loaded?: boolean; busy?: boolean } }> }).fixtureStudioInterfaces.studio_reference_memory?.snapshot;
        return memory?.loaded && !memory.busy;
      });
      await assertNamesAndNumbers();
      assert.equal(await page.locator('select[id$="-spoken-script-mode"]').inputValue(), "automatic");
      assert.equal(await page.locator('select[id$="-video-speech-mode"]').inputValue(), "characters");
      assert.equal(await page.locator('select[id$="-video-voice-mode"]').inputValue(), "provided");
      assert.equal(await page.evaluate(() => (window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { videoEngine?: string } }> }).fixtureStudioInterfaces.studio_free_form.snapshot.videoEngine), initialEngine, "restored voices never change the effective video provider");
      const bindings = await page.evaluate(() => {
        const state = window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { profiles?: unknown[]; characters?: unknown[] } }>; studioRequests: unknown[]; fixtureSavedMemory: { voices: number } };
        return { profiles: state.fixtureStudioInterfaces.studio_voice_pool.snapshot.profiles, characters: state.fixtureStudioInterfaces.studio_voice_pool.snapshot.characters,
          requests: state.studioRequests.length, voices: state.fixtureSavedMemory.voices };
      });
      assert.equal(bindings.requests, 0); assert.equal(bindings.voices, 4);
      assert.equal(bindings.profiles?.length, 2); assert.match(JSON.stringify(bindings.profiles), new RegExp(id(1))); assert.match(JSON.stringify(bindings.characters), /David.*Kathia/);
      await page.locator("[data-voice-pool-settings]").click();
      const pool = page.locator('dialog[data-media-settings-dialog="voices"]'); await pool.waitFor({ state: "visible" });
      assert.equal(await pool.getByRole("tab", { name: /David\.wav/ }).isVisible(), true); assert.equal(await pool.getByRole("tab", { name: /Kathia\.wav/ }).isVisible(), true);
      assert.equal(await pool.locator("[data-character-name-input]").inputValue(), "David");
      await pool.getByRole("tab", { name: /Kathia\.wav/ }).click(); assert.equal(await pool.locator("[data-character-name-input]").inputValue(), "Kathia");
      await pool.locator(":scope > header > button").click();
      const checkboxes = page.locator("[data-media-final-authorization] input[type=checkbox]");
      for (const checkbox of await checkboxes.all()) assert.equal(await checkbox.isChecked(), false);
      await forget.click(); await page.waitForFunction(() => !document.querySelector("[data-reference-memory-forget]"));
      assert.equal(await update.textContent(), "Mémoriser"); await assertNamesAndNumbers();
      await update.click(); await forget.waitFor({ state: "visible" });
      const writes = await page.evaluate(() => (window as unknown as { fixtureSavedMemory: { puts: number; deletes: number; memory: StudioReferenceMemory } }).fixtureSavedMemory);
      assert.equal(writes.puts, 1); assert.equal(writes.deletes, 1); assert.deepEqual(writes.memory, memory);
      await page.evaluate(() => (window as unknown as { fixtureRoot: { render(value: null): void } }).fixtureRoot.render(null));
      await page.locator("[data-media-tools]").waitFor({ state: "detached" });
      await page.evaluate(() => (window as unknown as { renderStudio(prompt: string, kind: string): void }).renderStudio("Une nouvelle création avec les mêmes personnages.", "video"));
      await forget.waitFor({ state: "visible" });
      await page.waitForFunction(() => (window as unknown as { fixtureSavedMemory: { voices: number } }).fixtureSavedMemory.voices === 6);
      await assertNamesAndNumbers();
      assert.equal(await page.locator("[data-studio-reference-memory]").evaluate(element => element.getBoundingClientRect().height <= 22), true, "memory controls remain a compact header action");
      for (const explicitMode of ["silent", "voiceover"]) {
        await page.evaluate(() => (window as unknown as { fixtureRoot: { render(value: null): void } }).fixtureRoot.render(null));
        await page.locator("[data-media-tools]").waitFor({ state: "detached" });
        await page.evaluate(() => {
          const state = window as unknown as { fixtureDelayMemory: boolean; fixtureResolveMemory?: () => void; renderStudio(prompt: string, kind: string): void };
          state.fixtureDelayMemory = true; state.fixtureResolveMemory = undefined; state.renderStudio("Préserver mon choix audio explicite.", "video");
        });
        await page.waitForFunction(() => Boolean((window as unknown as { fixtureResolveMemory?: () => void }).fixtureResolveMemory));
        await page.locator('select[id$="-video-speech-mode"]').selectOption(explicitMode);
        await page.evaluate(() => (window as unknown as { fixtureResolveMemory: () => void }).fixtureResolveMemory());
        await page.waitForFunction(() => {
          const memory = (window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { loaded?: boolean; busy?: boolean } }> }).fixtureStudioInterfaces.studio_reference_memory?.snapshot;
          return memory?.loaded && !memory.busy;
        });
        assert.equal(await page.locator('select[id$="-video-speech-mode"]').inputValue(), explicitMode, "late saved defaults preserve an explicit current choice");
        await assertNamesAndNumbers();
      }
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});
