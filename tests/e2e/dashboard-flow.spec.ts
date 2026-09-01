import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { attachRuntimeErrorTracking } from './helpers/runtime';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('dashboard access', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD requis');

  test('user reaches dashboard and sees main modules', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);

    await expect(page).toHaveURL(/dashboard/, { timeout: 20000 });

    // Vérifie présence modules clés
    await expect(
      page.getByText(/crm|agenda|devis|factures|mails/i).first()
    ).toBeVisible({ timeout: 15000 });

    // Vérifie qu’il y a du contenu interactif
    await expect(
      page.locator('main').locator('a, button').first()
    ).toBeVisible({ timeout: 15000 });

    await runtime.expectNoErrors();
  });
});
