import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers/auth';
import { attachRuntimeErrorTracking } from './helpers/runtime';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

async function expectSettingsPanelUrl(page: Page, panel: string) {
  await expect
    .poll(
      () => {
        const url = new URL(page.url());
        return {
          pathname: url.pathname,
          panel: url.searchParams.get('panel'),
          panelSource: url.searchParams.get('panelSource'),
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      pathname: '/dashboard',
      panel,
      panelSource: 'settings',
    });
}

test.describe('settings pages', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD sont requis');

  test('profil page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/settings/profil', { waitUntil: 'domcontentloaded' });

    await expectSettingsPanelUrl(page, 'profil');
    await expect(page.getByText(/Mon profil/i).first()).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });

  test('contact page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/settings/contact', { waitUntil: 'domcontentloaded' });

    await expectSettingsPanelUrl(page, 'contact');
    await expect(page.getByText(/Nous contacter/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('a[href="tel:+33631260812"]')).toBeVisible();
    await expect(page.locator('a[href^="https://wa.me/33631260812?text="]')).toBeVisible();

    await runtime.expectNoErrors();
  });

  test('activite page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/settings/activite', { waitUntil: 'domcontentloaded' });

    await expectSettingsPanelUrl(page, 'activite');
    await expect(page.getByText(/Mon activité/i).first()).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });

  test('abonnement settings page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/settings/abonnement', { waitUntil: 'domcontentloaded' });

    await expectSettingsPanelUrl(page, 'abonnement');
    await expect(page.getByText(/Mon abonnement/i).first()).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });
});
