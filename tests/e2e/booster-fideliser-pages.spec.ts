import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { attachRuntimeErrorTracking } from './helpers/runtime';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('booster and fideliser pages', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD sont requis');

  test('booster publish modal loads from dashboard', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard?action=publish', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard\?.*action=publish/, { timeout: 30_000 });
    await expect(page.locator('[data-publish-wizard]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('booster-creation-mode-panel')).toBeVisible();

    await runtime.expectNoErrors();
  });

  test('legacy booster route redirects to dashboard publish modal', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/booster?action=publish', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard\?.*action=publish/, { timeout: 30_000 });
    await expect(page.locator('[data-publish-wizard]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('booster-creation-mode-panel')).toBeVisible();
  });

  test('fideliser page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/fideliser', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard\/fideliser/, { timeout: 30_000 });
    await expect(
      page.getByText(/Fidéliser|Informer|newsletter/i).first()
    ).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });
});
