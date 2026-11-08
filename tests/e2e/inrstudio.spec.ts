import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers/auth';
import { attachRuntimeErrorTracking } from './helpers/runtime';

const hasCredentials = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

/** Real authenticated page and React controls; media billing/provider requests never leave the browser. */
async function openStudio(page: Page, holdGeneration = false) {
  const credits = { unit: 'credit', limit: 1000, used: 0, reserved: 0, remaining: 1000 };
  let submissions = 0;
  let submittedBody: Record<string, unknown> | null = null;
  let releaseGeneration: () => void = () => {};
  const completion = new Promise<void>(resolve => { releaseGeneration = resolve; });
  await page.route('**/api/media-generation/quota', route => route.fulfill({
    json: { quota: {
      accountId: '10000000-0000-4000-8000-000000000099', edition: 'premium', unlimited: false,
      periodStart: null, resetAt: null, studioEnabled: true, creditsReady: true,
      videoLongFormPremiumRequired: false, videoMaxDurationSeconds: 30,
      videoAllowedDurationsSeconds: Array.from({ length: 27 }, (_, index) => index + 4),
      credits, image: { ...credits, unit: 'item' }, video: { ...credits, unit: 'second' },
    } },
  }));
  await page.route('**/api/media-generation/quote', route => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { quote: {
      totalCredits: 100, tariffVersion: 'e2e-no-billing', quoteId: 'e2e-no-provider-quote',
      modelLabel: 'Contrôle navigateur', engine: request.videoEngine || request.imageEngine,
      durationSeconds: request.durationSeconds || null, resolution: request.videoResolution || null, breakdown: [],
    }, credits: { remaining: 1000 } } });
  });
  await page.route('**/api/media-generation/generate', async route => {
    submissions += 1;
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    if (holdGeneration) await completion;
    await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({
      type: 'result', status: 400, payload: {
        ok: false, code: 'AI_MEDIA_INVALID_REQUEST', error: 'Contrôle navigateur terminé sans appel fournisseur.',
      },
    }) + '\n' });
  });
  await page.route('**/api/media-generation/status?**', route => route.fulfill({
    json: { ok: true, status: 'failed', code: 'AI_MEDIA_INVALID_REQUEST', error: 'Contrôle navigateur sans génération.' },
  }));
  await login(page);
  await page.goto('/dashboard/generer-media', { waitUntil: 'domcontentloaded' });
  const studio = page.getByRole('dialog', { name: 'Générer un média', exact: true });
  await expect(studio).toBeVisible();
  await studio.getByRole('radio', { name: 'Vidéo', exact: true }).check();
  await expect(studio.getByRole('combobox', { name: 'Personnages', exact: true })).toBeVisible();
  return { studio, releaseGeneration, submissionCount: () => submissions, submittedBody: () => submittedBody };
}

test.describe('iNrStudio creation controls without supplier billing', () => {
  test.skip(!hasCredentials, 'E2E_EMAIL et E2E_PASSWORD sont requis');

  test('voice settings fit their two options and stay available for an empty exact script', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);
    const { studio, submissionCount } = await openStudio(page);
    await studio.getByRole('combobox', { name: 'Paroles automatiques / Paroles exactes', exact: true }).selectOption('exact');
    await studio.getByRole('button', { name: 'Réglages', exact: true }).click();
    const voice = studio.getByRole('dialog', { name: 'Voix', exact: true });
    await expect(voice).toBeVisible();
    await expect(voice.getByRole('combobox')).toHaveCount(2);
    await expect(voice.getByRole('combobox', { name: 'Voix', exact: true })).toBeVisible();
    await expect(voice.getByRole('combobox', { name: 'Style de voix', exact: true })).toBeVisible();
    const bounds = await voice.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(500);
    expect(bounds!.height).toBeLessThan(300);
    await voice.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(voice).toBeHidden();
    await studio.getByRole('combobox', { name: 'Personnages', exact: true }).selectOption('characters');
    await expect(studio.getByRole('button', { name: 'Réglages', exact: true })).toHaveCount(0);
    await studio.getByRole('combobox', { name: 'Personnages', exact: true }).selectOption('voiceover');
    await expect(studio.getByRole('button', { name: 'Réglages', exact: true })).toBeEnabled();
    expect(submissionCount()).toBe(0);
    await runtime.expectNoErrors();
  });

  test('automatic durations have no montage duplicates and exclude the unqualified slow engine', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);
    const { studio, submissionCount } = await openStudio(page);
    const engine = studio.getByRole('combobox', { name: 'Moteur et qualité', exact: true });
    await expect(engine.locator('option[value^="wan3:"]')).toHaveCount(0);
    for (const retainedEngine of ['wan-flash', 'wan27']) {
      await expect(engine.locator(`option[value^="${retainedEngine}:"]`)).toHaveCount(2);
    }
    await engine.selectOption('grok-lite:720p');
    const duration = studio.getByRole('combobox', { name: 'Durée', exact: true });
    const labels = await duration.locator('option').allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every(label => !/sc[eè]ne|continuit[eé]|montage/i.test(label))).toBe(true);
    await duration.selectOption({ label: '30 secondes' });
    await expect(duration.locator('option:checked')).toHaveText('30 secondes');
    expect(submissionCount()).toBe(0);
    await runtime.expectNoErrors();
  });

  test('a pending video keeps an advancing estimated percentage and submits independent clips once', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);
    const controls = await openStudio(page, true);
    try {
      await controls.studio.getByRole('combobox', { name: 'Moteur et qualité', exact: true }).selectOption('grok-lite:720p');
      await controls.studio.getByRole('combobox', { name: 'Durée', exact: true }).selectOption({ label: '30 secondes' });
      await controls.studio.getByRole('textbox', { name: 'Consignes visuelles', exact: true }).fill('Une allée de jardin au soleil du matin. Mouvement de caméra lent, aucun texte dans l’image.');
      const authorization = controls.studio.locator('[data-media-final-authorization] input[type="checkbox"]');
      if (await authorization.count()) await authorization.check();
      const generate = controls.studio.getByRole('button', { name: 'Générer une vidéo', exact: true });
      await expect(generate).toBeEnabled();
      await generate.click();
      const percentage = controls.studio.locator('[data-media-creation-stage="progress"]').getByText(/^≈\s*\d+\s*%$/);
      await expect(percentage).toBeVisible();
      const initial = Number((await percentage.innerText()).match(/\d+/)![0]);
      await expect.poll(async () => Number((await percentage.innerText()).match(/\d+/)![0])).toBeGreaterThan(initial);
      expect(Number((await percentage.innerText()).match(/\d+/)![0])).toBeLessThanOrEqual(94);
      await expect.poll(controls.submissionCount).toBe(1);
      expect(controls.submittedBody()).toMatchObject({ creationMode: 'free', videoEngine: 'grok-lite', durationSeconds: 30, connectScenes: false });
    } finally {
      controls.releaseGeneration();
    }
    await expect(controls.studio.getByRole('button', { name: 'Générer une vidéo', exact: true })).toBeVisible();
    expect(controls.submissionCount()).toBe(1);
    await runtime.expectNoErrors();
  });
});
