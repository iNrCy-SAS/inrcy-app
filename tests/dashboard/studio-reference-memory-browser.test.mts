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
async function loadFixture(realEnginePreference = false) {
  let selected = prefix;
  if (realEnginePreference) {
    selected = selected.replace('const fixture = `', 'add("app/dashboard/_hooks/useMediaEnginePreference.ts");\nconst fixture = `');
    const hookStub = selected.split("\n").find(line => line.includes("if(name.endsWith('useMediaEnginePreference'))")); assert.ok(hookStub);
    selected = selected.replace(hookStub, " if(name.endsWith('useMediaEnginePreference'))return require('app/dashboard/_hooks/useMediaEnginePreference.ts');");
  }
  const compiled = ts.transpileModule(`${selected}\nexport { mount };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`) as { mount: (page: Page) => Promise<string[]> };
}
const { mount } = await loadFixture();
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
      await page.locator('select[id$="-spoken-script-mode"]').selectOption("exact");
      assert.equal(await page.locator('select[id$="-video-speech-mode"]').inputValue(), "characters", "Exact preserves the restored character intention rather than inventing an offscreen narrator");
      assert.equal(await page.locator('select[id$="-video-voice-mode"]').inputValue(), "provided", "Exact retains each photo's supplied voice");
      await page.locator("[data-exact-dialogue-settings]").click();
      const exactDialog = page.locator("[data-exact-dialogue-dialog]"); await exactDialog.waitFor({ state: "visible" });
      assert.equal(await exactDialog.locator("[data-exact-dialogue-row] select").first().inputValue(), `character:${id(1)}`);
      assert.equal(await exactDialog.locator("textarea").first().inputValue(), "", "the default line never invents speech");
      await exactDialog.locator('textarea').first().fill('Bonjour David.');
      await exactDialog.locator('[data-exact-dialogue-add]').click();
      await exactDialog.locator('[data-exact-dialogue-row] select').nth(1).selectOption(`character:${id(2)}`);
      await exactDialog.locator('textarea').nth(1).fill('Bonjour Kathia.');
      await exactDialog.locator('[data-exact-dialogue-add]').click();
      await exactDialog.locator('textarea').nth(2).fill('Bienvenue à tous.');
      const readRows=()=>page.evaluate(()=>(window as unknown as {fixtureStudioInterfaces:Record<string,{snapshot:{rows:Array<{id:string;speaker:string;characterId?:string;text:string}>}}>}).fixtureStudioInterfaces.studio_exact_dialogue.snapshot.rows);
      const characterRows=await readRows();
      await exactDialog.locator(":scope > header > button").click();
      const speechChoice=page.locator('select[id$="-video-speech-mode"]'),voiceChoice=page.locator('select[id$="-video-voice-mode"]');
      assert.equal(await speechChoice.isDisabled(),false);assert.equal(await voiceChoice.isDisabled(),false);
      await voiceChoice.selectOption('ai');await voiceChoice.selectOption('provided');
      await speechChoice.selectOption('voiceover');assert.equal(await voiceChoice.inputValue(),'provided','changing the speaker mode preserves the independent voice source');
      await page.locator('[data-exact-dialogue-settings]').click();
      assert.ok((await readRows()).every(row=>row.speaker==='provided_voice'&&!row.characterId),'the dialog displays the effective narrator rather than dormant character labels');
      for(const select of await exactDialog.locator('[data-exact-dialogue-row] select').all())assert.equal(await select.isDisabled(),true);
      await exactDialog.locator('textarea').nth(1).fill('Kathia révisée.');
      await exactDialog.getByRole('button',{name:'Monter la réplique 3',exact:true}).click();
      await exactDialog.locator(':scope > header > button').click();
      await voiceChoice.selectOption('ai');await speechChoice.selectOption('characters');assert.equal(await voiceChoice.inputValue(),'ai');
      await page.locator('[data-exact-dialogue-settings]').click();
      assert.deepEqual((await readRows()).map(row=>[row.id,row.speaker,row.characterId,row.text]),[
        [characterRows[0].id,'character',id(1),'Bonjour David.'],[characterRows[2].id,'ai_voice',undefined,'Bienvenue à tous.'],[characterRows[1].id,'character',id(2),'Kathia révisée.'],
      ],'text and order edits retain dormant photo assignments through the narrator projection');
      await exactDialog.locator(':scope > header > button').click();await voiceChoice.selectOption('provided');
      await page.locator('select[id$="-spoken-script-mode"]').selectOption("automatic");
      await page.locator('select[id$="-spoken-script-mode"]').selectOption("exact");
      assert.equal(await page.locator('select[id$="-video-speech-mode"]').inputValue(), "characters");
      await page.locator('select[id$="-spoken-script-mode"]').selectOption("automatic");
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

test("real stored engine hydration keeps the DOM selection, effective provider and quote eligibility consistent with remembered voices", async () => {
  const suppliedVoiceReason = (JSON.parse(readFileSync(new URL("../../messages/fr-FR/media.json", import.meta.url), "utf8")) as Record<string, string>).ai_generator_character_voice_engine_required;
  const { mount: mountRealPreference } = await loadFixture(true);
  const browser = await chromium.launch({ headless: true });
  try {
    for (const preference of [null, { videoEngine: "wan27", videoResolution: "1080p", imageEngine: "openai" }]) {
      const page = await browser.newPage({ viewport: { width: 1460, height: 900 } });
      if (preference) await page.addInitScript(value => localStorage.setItem("inrcy:media-engines:v1:fixture", JSON.stringify(value)), preference);
      const errors = await mountRealPreference(page), expectedEngine = preference?.videoEngine || "omni", expectedResolution = preference?.videoResolution || "720p";
      await page.waitForFunction(engine => (window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { videoEngine?: string } }> }).fixtureStudioInterfaces.studio_free_form.snapshot.videoEngine === engine, expectedEngine);
      const storedBefore = await page.evaluate(() => localStorage.getItem("inrcy:media-engines:v1:fixture"));
      await page.evaluate(() => (window as unknown as { fixtureRoot: { render(value: null): void } }).fixtureRoot.render(null));
      await page.locator("[data-media-tools]").waitFor({ state: "detached" });
      await page.evaluate(() => {
        type FixtureState = Window & { fixtureReferencePreparationEnabled: boolean; fixtureReferencePng: string; renderStudio(prompt: string, kind: string): void };
        const state = window as unknown as FixtureState, prior = window.fetch;
        const id = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, "0")}`;
        const memory: StudioReferenceMemory = { version: 1, references: [
          { id: id(1), mediaLibraryId: id(11), role: "character", usage: "required", characterName: "David", voiceMode: "provided" },
          { id: id(2), mediaLibraryId: id(12), role: "character", usage: "required", characterName: "Kathia", voiceMode: "provided" }],
          voices: [{ id: id(3), libraryMediaId: id(13), target: { referenceId: id(1) }, gender: "male" },
            { id: id(4), libraryMediaId: id(14), target: { referenceId: id(2) }, gender: "female" }], activeNarrationVoiceId: null };
        state.fixtureReferencePreparationEnabled = true;
        window.fetch = async (input, init = {}) => {
          const url = String(input);
          if (url === "/api/media-generation/references") return Response.json({ ok: true, accountId: "fixture", memory, unavailableMediaIds: [],
            media: memory.references.map(reference => ({ id: reference.mediaLibraryId, media_type: "image", mime_type: "image/png", original_file_name: "portrait.png", title: null,
              signed_url: `/__local-stored-engine/${reference.mediaLibraryId}`, size_bytes: 80, width: 2, height: 2, duration_seconds: null })) });
          if (url.startsWith("/__local-stored-engine/")) return new Response(Uint8Array.from(atob(state.fixtureReferencePng), character => character.charCodeAt(0)), { headers: { "content-type": "image/png" } });
          if (url === "/api/media-generation/voice-reference" && init.method === "POST") {
            const libraryMediaId = JSON.parse(String(init.body)).mediaLibraryId as string;
            return Response.json({ ok: true, sample: { path: `_studio-voice-references/fixture__${libraryMediaId}.wav`, name: "vocal.wav", mimeType: "audio/wav", durationSeconds: 7, sizeBytes: 224044, libraryMediaId } });
          }
          return prior(input, init);
        };
        state.renderStudio("Notre duo présente son activité.", "video");
      });
      await page.locator("[data-media-tools]").waitFor({ state: "visible" });
      await page.waitForFunction(() => { const state = (window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { loaded?: boolean; busy?: boolean } }> }).fixtureStudioInterfaces.studio_reference_memory.snapshot; return state.loaded && !state.busy; });
      const readState = () => page.evaluate(() => {
        const state = window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { videoEngine?: string } }>; studioQuotes: Array<{ videoEngine: string; enabled: boolean }>; studioRequests: unknown[] };
        const select = document.querySelector<HTMLSelectElement>('[data-media-engine-controls] select[id$="-engine"]')!;
        return { effective: state.fixtureStudioInterfaces.studio_free_form.snapshot.videoEngine, dom: select.value, label: select.selectedOptions[0]?.textContent,
          disabled: select.selectedOptions[0]?.disabled, quote: state.studioQuotes.at(-1), generationCalls: state.studioRequests.length,
          title: select.title, notices: [...document.querySelectorAll('[data-media-engine-controls] [role="status"]')].map(element => element.textContent || ""),
          selectable: [...select.options].filter(option => !option.disabled).map(option => option.value), stored: localStorage.getItem("inrcy:media-engines:v1:fixture") };
      });
      const restored = await readState();
      assert.equal(restored.effective, expectedEngine); assert.equal(restored.dom, `${expectedEngine}:${expectedResolution}`, "the browser must display the effective engine rather than its first surviving option");
      assert.equal(restored.quote?.videoEngine, expectedEngine); assert.equal(restored.quote?.enabled, Boolean(preference));
      assert.equal(restored.disabled, !preference); assert.equal(restored.stored, storedBefore); assert.equal(restored.generationCalls, 0);
      assert.equal(restored.notices.some(notice => notice.includes(suppliedVoiceReason)), !preference);
      assert.equal(restored.title.includes(suppliedVoiceReason), !preference);
      for (const value of restored.selectable) assert.match(value, /^(?:wan27|kling):/);
      assert.ok(restored.label?.includes(preference ? "Wan 2.7" : "Gemini Omni"));
      if (!preference) {
        await page.locator('[data-media-engine-controls] select[id$="-engine"]').selectOption("kling:720p");
        await page.waitForFunction(() => (window as unknown as { studioQuotes: Array<{ enabled: boolean }> }).studioQuotes.at(-1)?.enabled === true);
        const explicit = await readState(); assert.equal(explicit.effective, "kling"); assert.equal(explicit.dom, "kling:720p"); assert.equal(explicit.quote?.videoEngine, "kling");
        assert.ok(!explicit.notices.some(notice => notice.includes(suppliedVoiceReason))); assert.ok(!explicit.title.includes(suppliedVoiceReason));
        assert.equal(explicit.generationCalls, 0, "selecting a compatible engine never starts a paid generation");
      } else {
        await page.getByLabel("Consignes visuelles", { exact: true }).fill("");
        await page.waitForFunction(() => (window as unknown as { studioQuotes: Array<{ enabled: boolean }> }).studioQuotes.at(-1)?.enabled === false);
        const emptyBrief = await readState(); assert.equal(emptyBrief.effective, "wan27"); assert.equal(emptyBrief.dom, "wan27:1080p");
        assert.equal(emptyBrief.quote?.enabled, false, "an empty brief prevents a quote without invalidating the compatible engine");
        assert.ok(!emptyBrief.notices.some(notice => notice.includes(suppliedVoiceReason))); assert.equal(emptyBrief.generationCalls, 0);
      }
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});
