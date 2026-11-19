import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium, webkit, type Page } from '@playwright/test';
import ts from 'typescript';

// Reuse the real, network-blocked React/CSS fixture without registering its tests.
const require = createRequire(import.meta.url);
const original = new URL('./studio-video-brief-speech-browser.test.mts', import.meta.url);
const source = readFileSync(original, 'utf8');
const ast = ts.createSourceFile('fixture.mts', source, ts.ScriptTarget.Latest, true);
const firstTest = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'test');
assert.ok(firstTest);
const prefix = source.slice(0, firstTest.getStart(ast)).replaceAll('import.meta.url', JSON.stringify(original.href))
  .replace('from "@playwright/test"', `from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}`)
  .replace('from "typescript"', `from ${JSON.stringify(pathToFileURL(require.resolve('typescript')).href)}`);
const compiled = ts.transpileModule(`${prefix}\nexport { mount };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { mount } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../outputs');
mkdirSync(output, { recursive: true });

async function waitForCommittedDialogueRows(page: Page, expected: Array<{ text: string; speaker?: string; characterIndex?: number }>) {
  // Native fill/select values can update before React commits the controlled rows.
  // Wait for the real component's published snapshot before the next input or measurement.
  await page.waitForFunction(expectedRows => {
    const fixture = window as unknown as { fixtureStudioInterfaces: Record<string, { snapshot: { rows: Array<{ text: string; speaker: string; characterId?: string }>; characters: Array<{ id: string; characterIndex: number }> } }> };
    const { rows, characters } = fixture.fixtureStudioInterfaces.studio_exact_dialogue.snapshot;
    return rows.length === expectedRows.length && expectedRows.every((row, index) =>
      rows[index].text === row.text && (!row.speaker || rows[index].speaker === row.speaker) &&
      (!row.characterIndex || characters.some(character => character.characterIndex === row.characterIndex && character.id === rows[index].characterId)));
  }, expected);
}

test('compact Exact rows keep two columns, real speech budget, controls and both replies visible on desktop and mobile', async () => {
  for (const browserType of [chromium, webkit]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const viewport of [{ width: 320, height: 720 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport }); const errors = await mount(page);
      await page.locator('select[id$="-engine"]').selectOption('kling:720p');
      await page.evaluate(() => {
        const fixture = window as unknown as { fixtureReferencePreparationEnabled: boolean; fixtureStudioInterfaces: Record<string, { handlers: Record<string, { invoke(value: string): void }> }> };
        fixture.fixtureReferencePreparationEnabled = true;
        fixture.fixtureStudioInterfaces.studio_free_form.handlers.select.invoke(JSON.stringify({ field: 'durationSeconds', value: 16 }));
      });
      for (const name of ['premiere.png', 'seconde.png']) {
        await page.locator('[data-media-role-add="character"]').click();
        await page.locator('[data-media-settings-dialog="images"] input[type="file"]').setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from('synthetic-local-image') });
        await page.locator('[data-media-settings-dialog="images"]').waitFor({ state: 'hidden' });
      }
      await page.locator('select[id$="-video-speech-mode"]').selectOption('characters');
      await page.locator('select[id$="-spoken-script-mode"]').selectOption('exact');
      const settings = await page.evaluate(() => {
        const exact = document.querySelector<HTMLElement>('[data-exact-dialogue-settings]')!, voice = document.querySelector<HTMLElement>('[data-video-audio-button]')!, frame = document.querySelector<HTMLElement>('[data-video-speech-frame]')!;
        const pick = (element: HTMLElement) => { const style = getComputedStyle(element), rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, top: rect.top, background: style.backgroundColor, border: style.border, radius: style.borderRadius, padding: style.padding, font: style.font, decoration: style.textDecoration }; };
        return { exact: pick(exact), voice: pick(voice), mainBlocks: frame.children.length, summaryChildren: exact.parentElement!.children.length, extraMainInfo: frame.querySelector('[id$="-spoken-script-count"], [id$="-spoken-script-budget"], .free-spokenScriptContent') !== null };
      });
      assert.equal(settings.mainBlocks, 1, 'only the three-menu controls and subtitles remain in the speech banner');
      assert.equal(settings.extraMainInfo, false); assert.equal(settings.summaryChildren, 1, 'no reply-count span remains beside Settings');
      const { top: exactTop, ...exactStyle } = settings.exact, { top: voiceTop, ...voiceStyle } = settings.voice;
      assert.deepEqual(exactStyle, voiceStyle, 'both Settings buttons have identical native sizing and appearance');
      if (viewport.width > 1100) assert.ok(Math.abs(exactTop - voiceTop) <= 1, 'Settings buttons align on desktop');
      await page.locator('[data-exact-dialogue-settings]').click();
      const dialog = page.locator('[data-exact-dialogue-dialog]'); await dialog.waitFor({ state: 'visible' });
      const emptyBudget = await dialog.locator('[data-exact-dialogue-budget]').innerText(); assert.doesNotMatch(emptyBudget, /0\s*\/\s*0|4[ ,.]?000/); assert.match(emptyBudget, /0\s*\/\s*30 mots/); assert.match(emptyBudget, /0\s*\/\s*300 caractères/);
      await page.evaluate(() => {
        const root = window as unknown as { fixtureStudioInterfaces: Record<string, { handlers: Record<string, { invoke(value: string | null): void }> }> };
        const exact = root.fixtureStudioInterfaces.studio_exact_dialogue.handlers.select;
        exact.invoke(JSON.stringify({ field: 'text', rowIndex: 0, value: 'Les feuilles brillent dans notre jardin.' }));
      });
      await waitForCommittedDialogueRows(page, [{ text: 'Les feuilles brillent dans notre jardin.' }]);
      await dialog.locator('[data-exact-dialogue-row] select').first().selectOption({ label: 'Personnage 1' });
      await waitForCommittedDialogueRows(page, [{ text: 'Les feuilles brillent dans notre jardin.', speaker: 'character', characterIndex: 1 }]);
      await dialog.locator('[data-exact-dialogue-add]').click();
      await dialog.locator('[data-exact-dialogue-row] textarea').nth(1).fill('Nous prenons soin de votre maison.');
      await waitForCommittedDialogueRows(page, [{ text: 'Les feuilles brillent dans notre jardin.', speaker: 'character', characterIndex: 1 }, { text: 'Nous prenons soin de votre maison.' }]);
      await dialog.locator('[data-exact-dialogue-row] select').nth(1).selectOption({ label: 'Personnage 2' });
      await waitForCommittedDialogueRows(page, [{ text: 'Les feuilles brillent dans notre jardin.', speaker: 'character', characterIndex: 1 }, { text: 'Nous prenons soin de votre maison.', speaker: 'character', characterIndex: 2 }]);
      const geometry = await dialog.evaluate(element => {
        const bound = element.getBoundingClientRect();
        const list = element.querySelector('ol')!;
        const listBound = list.getBoundingClientRect();
        return { colorScheme: getComputedStyle(element).colorScheme, height: bound.height, top: bound.top, bottom: bound.bottom, viewport: innerHeight, overflow: element.scrollWidth > element.clientWidth,
          listScroll: list.scrollHeight > list.clientHeight + 1, listTop: listBound.top, listBottom: listBound.bottom,
          rows: Array.from(element.querySelectorAll('[data-exact-dialogue-row]')).map(row => {
            const select = row.querySelector('select')!.getBoundingClientRect(), textarea = row.querySelector('textarea')!.getBoundingClientRect(), heading = row.querySelector('strong')!.getBoundingClientRect();
            return { top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom, selectLeft: select.left, selectWidth: select.width, textLeft: textarea.left, textWidth: textarea.width, textHeight: textarea.height, headingAbove: heading.bottom <= select.top + 1 };
          }), footerVisible: element.querySelector('footer')!.getBoundingClientRect().bottom <= bound.bottom + 1 };
      });
      assert.equal(geometry.colorScheme, "dark", "native Safari controls must retain readable dark styling"); assert.equal(geometry.overflow, false); assert.equal(geometry.listScroll, false); assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.viewport); assert.equal(geometry.footerVisible, true); assert.equal(geometry.rows.length, 2);
      for (const row of geometry.rows) { assert.ok(row.headingAbove); assert.ok(row.textLeft >= row.selectLeft + row.selectWidth); assert.ok(row.textHeight >= 52 && row.textHeight <= 62); assert.ok(row.textWidth >= 95); assert.ok(row.bottom - row.top <= (viewport.width <= 350 ? 128 : 120), JSON.stringify({viewport,geometry})); assert.ok(row.top >= geometry.listTop - 1 && row.bottom <= geometry.listBottom + 1, 'each reply and its controls remain entirely inside the visible list'); }
      // At 320px the actions move below the two columns; all controls still fit the viewport.
      // Include the mobile upper bound, which native font metrics can round to exactly 450px.
      assert.ok(viewport.width <= 520 ? geometry.height <= 450 : geometry.height < 400, `two compact replies fit without scrolling: ${JSON.stringify(geometry)}`);
      assert.equal(await dialog.locator('textarea').first().getAttribute('maxlength'), null);
      await dialog.locator('textarea').first().fill('x'.repeat(4100)); assert.equal((await dialog.locator('textarea').first().inputValue()).length, 4100);
      assert.equal(await dialog.locator('[data-exact-dialogue-budget]').getAttribute('data-invalid'), 'true');
      await dialog.locator('textarea').first().fill('Les feuilles brillent dans notre jardin.');
      await page.screenshot({ path: path.join(output, `studio-exact-dialogue-compact-${browserType.name()}-${viewport.width}x${viewport.height}.png`), fullPage: true });
      for (let index = 0; index < 10; index++) await dialog.locator('[data-exact-dialogue-add]').click();
      const full = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect(), list = element.querySelector('ol')!, header = element.querySelector('header')!.getBoundingClientRect(), footer = element.querySelector('footer')!.getBoundingClientRect();
        return { listScrolls: list.scrollHeight > list.clientHeight, headerVisible: header.top >= rect.top && header.bottom <= rect.bottom, footerVisible: footer.top >= rect.top && footer.bottom <= rect.bottom, inViewport: rect.top >= 0 && rect.bottom <= innerHeight };
      });
      assert.deepEqual(full, { listScrolls: true, headerVisible: true, footerVisible: true, inViewport: true }, 'long drafts scroll only the rows while header, budget and add control remain visible');
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
  }
});
