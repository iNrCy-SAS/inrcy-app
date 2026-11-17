import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from '@playwright/test';
import ts from 'typescript';

// Run the real UI and quote hook; the controlled quote endpoint never contacts
// a provider, authenticates an account or creates a billable generation.
const require = createRequire(import.meta.url);
const original = new URL('./studio-video-brief-speech-browser.test.mts', import.meta.url);
const source = readFileSync(original, 'utf8');
const ast = ts.createSourceFile('fixture.mts', source, ts.ScriptTarget.Latest, true);
const firstTest = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'test');
assert.ok(firstTest);
let prefix = source.slice(0, firstTest.getStart(ast));
assert.ok(prefix.includes('add("app/dashboard/_components/MediaFreeGenerator.tsx");'));
prefix = prefix
  .replace('add("app/dashboard/_components/MediaFreeGenerator.tsx");', 'stubNames.delete("../_hooks/useMediaCreditQuote"); add("app/dashboard/_hooks/useMediaCreditQuote.ts"); add("app/dashboard/_components/MediaFreeGenerator.tsx");')
  .replace('resolved.startsWith("app/dashboard/_components/")', 'resolved.startsWith("app/dashboard/_components/") || resolved.startsWith("app/dashboard/_hooks/")')
  .replace('unlimited:true,', 'unlimited:window.fixtureUnlimited!==false,')
  .replace("MediaCreditRechargeButton:()=>{throw Error('No credit purchase is available in this fixture')}", "MediaCreditRechargeButton:()=>React.createElement('button',{type:'button',disabled:true},'Recharger')")
  .replace('window.fetch=(url,init)=>{', `window.fetch=(url,init)=>{
    if(url==='/api/media-generation/quote') {
      window.quoteRequests??=[];window.quoteRequests.push(JSON.parse(init.body));
      const sequence=window.quoteRequests.length;
      return new Promise(resolve=>setTimeout(()=>resolve(Response.json({ok:true,
        quote:{totalCredits:87,quoteId:'quote-'+sequence,tariffVersion:'test',modelLabel:'Gemini Omni',engine:'omni',durationSeconds:8,resolution:'720p',breakdown:[]},
        credits:{remaining:10000},creditsReady:true})),250));
    }`)
  .replaceAll('import.meta.url', JSON.stringify(original.href))
  .replace('from "@playwright/test"', `from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}`)
  .replace('from "typescript"', `from ${JSON.stringify(pathToFileURL(require.resolve('typescript')).href)}`);
const compiled = ts.transpileModule(`${prefix}\nexport { mount };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { mount } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

for (const unlimited of [true, false]) {
  test(`Omni quote stays confirmed at every valid visual keystroke for ${unlimited ? 'admin unlimited' : 'normal credited'} accounts`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.addInitScript(value => { (window as unknown as { fixtureUnlimited: boolean }).fixtureUnlimited = value; }, unlimited);
      const errors = await mount(page);
      await page.locator('select[id$="-engine"]').selectOption('omni:720p');
      const prompt = page.getByLabel('Consignes visuelles', { exact: true });
      const action = page.locator('[data-media-primary-action]');
      const quote = page.locator('[data-media-credit-details]');
      const short = 'fais moi une video de plusieurs';
      const full = 'fais moi une video de plusieurs personnes dans une agence de communication qui discute de notre application iNertie !';
      assert.equal(short.length, 31); assert.equal(full.length, 117);
      await prompt.fill(short);
      await page.waitForFunction(() => document.querySelector('[data-media-credit-details]')?.getAttribute('data-confirmed') === 'true');
      assert.equal(await action.isDisabled(), false);
      const initialRequests = await page.evaluate(() => {
        const fixture = window as unknown as { quoteRequests: unknown[]; quoteTypingDisables: unknown[]; quoteTypingObserver: MutationObserver };
        fixture.quoteTypingDisables = [];
        fixture.quoteTypingObserver = new MutationObserver(changes => {
          for (const change of changes) if (change.attributeName === 'disabled' && change.oldValue === null) fixture.quoteTypingDisables.push(document.querySelector<HTMLTextAreaElement>('textarea[id$="-prompt"]')?.value.length);
        });
        fixture.quoteTypingObserver.observe(document.querySelector('[data-media-primary-action]')!, { attributes: true, attributeOldValue: true, attributeFilter: ['disabled'] });
        return fixture.quoteRequests.length;
      });
      for (const target of [full, `${full} `, `${full} ${'x'.repeat(382)}`]) {
        const current = await prompt.inputValue();
        await prompt.pressSequentially(target.slice(current.length), { delay: 2 });
        assert.equal(await prompt.inputValue(), target);
        assert.equal(await action.isDisabled(), false, `${target.length} valid characters remain generatable during typing`);
        assert.equal(await quote.getAttribute('data-confirmed'), 'true');
        assert.match(await quote.locator('summary').innerText(), /Coût de la génération/);
      }
      assert.equal((await prompt.inputValue()).length, 500);
      // Read after the quote debounce and the controlled response duration: an
      // accidental later refresh must also fail the assertion.
      await page.waitForTimeout(450);
      const proof = await page.evaluate(() => {
        const fixture = window as unknown as { quoteRequests: Array<Record<string, unknown>>; quoteTypingDisables: unknown[]; quoteTypingObserver: MutationObserver; studioRequests: unknown[]; networkCalls: number };
        fixture.quoteTypingObserver.disconnect();
        return { requests: fixture.quoteRequests, disabledAtLengths: fixture.quoteTypingDisables, generations: fixture.studioRequests.length, externalCalls: fixture.networkCalls };
      });
      assert.deepEqual(proof.disabledAtLengths, [], 'no keystroke temporarily disables Generate');
      assert.equal(proof.requests.length, initialRequests, 'visual typing does not trigger another quote');
      assert.ok(proof.requests.every(request => !Object.hasOwn(request, 'freePrompt')), 'Omni pricing receives only price-affecting fields');
      assert.equal(proof.generations, 0); assert.equal(proof.externalCalls, 0);
      await prompt.pressSequentially('x');
      assert.equal((await prompt.inputValue()).length, 501);
      assert.equal(await action.isDisabled(), true);
      const limit = page.locator('[id$="-visual-brief-error"][role="alert"]');
      assert.equal(await limit.isVisible(), true, 'the real 500-character limit has a visible explanation');
      assert.match(await limit.innerText(), /500/);
      await prompt.press('Backspace');
      await page.waitForFunction(() => document.querySelector('[data-media-credit-details]')?.getAttribute('data-confirmed') === 'true');
      assert.equal(await action.isDisabled(), false, 'returning to 500 restores Generate after quote confirmation');
      assert.equal(await quote.getAttribute('data-confirmed'), 'true');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}