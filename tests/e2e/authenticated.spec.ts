import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { attachRuntimeErrorTracking } from './helpers/runtime';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('authenticated flows', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD sont requis');

  test('user can sign in and reach dashboard', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page, { forceUi: true });

    await expect(page).toHaveURL(/\/dashboard/);

    await expect(
      page.getByText(/Votre cockpit iNrCy|Le Générateur est lancé|Générateur/i).first()
    ).toBeVisible({ timeout: 30_000 });

    await runtime.expectNoErrors();
  });

  test('session survives refresh on dashboard', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page, { forceUi: true });

    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    await expect(
      page.getByText(/Votre cockpit iNrCy|Le Générateur est lancé|Générateur/i).first()
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText(/CRM/i).first()).toBeVisible({ timeout: 15_000 });

    await runtime.expectNoErrors();
  });

  test('main dashboard modules render', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page, { forceUi: true });

    const standardModules = page.locator('[data-dashboard-standard-lower-blocks="true"]');
    const premiumModules = page.locator('[data-dashboard-premium-lower-blocks="true"]');

    await expect(
      page.locator(
        '[data-dashboard-standard-lower-blocks="true"], [data-dashboard-premium-lower-blocks="true"]',
      ),
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText(/STATS/i).first()).toBeVisible({ timeout: 15_000 });

    if (await standardModules.isVisible()) {
      await expect(page.getByTestId('standard-booster-publish')).toBeVisible();
      await expect(page.getByTestId('standard-agent-pilotage')).toBeVisible();
      await expect(page.getByTestId('standard-studio-open')).toBeVisible();
    } else {
      await expect(premiumModules).toBeVisible();
      await expect(page.getByText(/CRM/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/AGENDA|CALENDAR/i).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('premium-booster-publish')).toBeVisible();
      await expect(page.getByTestId('premium-studio-open')).toBeVisible();
    }

    await runtime.expectNoErrors();
  });
});
