import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { attachRuntimeErrorTracking } from './helpers/runtime';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('dashboard module routes', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD sont requis');

  test('crm page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/crm', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard\/crm/, { timeout: 30_000 });
    const crmPageMarker = page
      .getByRole('img', { name: /iNr.?CRM/i })
      .or(page.getByText(/Tableau CRM|iNr.?CRM|La centrale de tous vos contacts/i))
      .first();

    await expect(crmPageMarker).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });

  test('agenda page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/agenda', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard\/agenda/, { timeout: 30_000 });
    await expect(
      page.getByText(/Contact CRM|Ajouter au CRM|Agenda/i).first()
    ).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });

  test('devis page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/devis', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard\/devis/, { timeout: 30_000 });
    await expect(
      page.getByText(/Mes devis|Créer un devis/i).first()
    ).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });

  test('factures page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/factures', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard\/factures/, { timeout: 30_000 });
    await expect(
      page.getByText(/Mes factures|Créer une facture/i).first()
    ).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });

  test('mails page loads', async ({ page }) => {
    const runtime = attachRuntimeErrorTracking(page);

    await login(page);
    await page.goto('/dashboard/mails', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/dashboard\/mails/, { timeout: 30_000 });
    await expect(page.getByRole('img', { name: /iNr.?Send/i })).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('button', { name: /^Mails(?:\s|$)/i })
    ).toBeVisible({ timeout: 20_000 });

    await runtime.expectNoErrors();
  });
});
