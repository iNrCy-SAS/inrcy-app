import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { attachRuntimeErrorTracking } from './helpers/runtime';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('integrations', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD sont requis');

  test('channel integrations open from the dashboard cockpit', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Connecter', exact: true }).click();
    const channels = page.getByRole('dialog', { name: /^Mes canaux/ });
    await expect(channels).toBeVisible({ timeout: 20_000 });

    await expect(
      channels.getByText(/Google Business|Google|Instagram|Facebook|LinkedIn/i).first()
    ).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });
});
