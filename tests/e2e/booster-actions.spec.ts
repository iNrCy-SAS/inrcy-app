import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('booster actions', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD requis');

  test('booster publish modal has actionable UI elements', async ({ page }) => {
    // A fresh authenticated session still needs a cookie choice. Handle the
    // real dialog even if it hydrates just before a wizard interaction.
    const cookieConsent = page.getByRole('dialog', { name: 'Consentement cookies', exact: true });
    await page.addLocatorHandler(cookieConsent, async () => {
      await cookieConsent.getByRole('button', { name: 'Refuser', exact: true }).click();
      await expect(cookieConsent).toBeHidden();
    });

    await login(page);

    // /dashboard/booster redirects intentionally to the dashboard modal layer.
    await page.goto('/dashboard?action=publish', {
      waitUntil: 'domcontentloaded',
    });

    await expect(page).toHaveURL(/\/dashboard\?.*action=publish/);
    const wizard = page.locator('[data-publish-wizard]');
    await expect(wizard).toBeVisible({ timeout: 20_000 });
    await expect(wizard.getByRole('button', { name: 'Préparation', exact: true })).toHaveAttribute('aria-current', 'step');

    const automatic = wizard.getByTestId('booster-creation-mode-ai');
    const manual = wizard.getByTestId('booster-creation-mode-manual');
    await expect(automatic).toBeVisible();
    await expect(manual).toBeVisible();
    await expect(automatic).toHaveAttribute('aria-checked', 'false');
    await expect(manual).toHaveAttribute('aria-checked', 'false');
    await expect(wizard.getByRole('button', { name: 'Continuer', exact: true })).toBeDisabled();

    await automatic.click();
    await expect(automatic).toHaveAttribute('aria-checked', 'true');
    await expect(manual).toHaveAttribute('aria-checked', 'false');
    await manual.click();
    await expect(manual).toHaveAttribute('aria-checked', 'true');
    await expect(automatic).toHaveAttribute('aria-checked', 'false');
  });
});
