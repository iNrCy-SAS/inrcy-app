import { test, expect } from '@playwright/test';

test.describe('auth recovery flows', () => {
  test('forgot-password link is visible on login page', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('forgot-password')).toBeVisible();
  });

  test('set-password page shows expired-link message', async ({ page }) => {
    await page.goto('/set-password?error_code=otp_expired&mode=reset&lang=fr', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('auth-link-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Lien expiré' })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByTestId('auth-resend-link')).toHaveCount(0);
  });

  test('set-password page shows invalid-link message', async ({ page }) => {
    await page.goto('/set-password?error_description=invalid_token&mode=reset&lang=fr', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('auth-link-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test('expired invitation with an address offers a generic resend state', async ({ page }) => {
    await page.route('**/api/auth/resend-link', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto('/auth/finish-invite?error_code=otp_expired&email=invitee%40example.com&lang=fr', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('auth-link-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const resend = page.getByTestId('auth-resend-link');
    await expect(resend).toBeVisible();
    await resend.click();
    await expect(page.getByText('Si ce compte existe, un nouveau lien sera envoyé à cette adresse.')).toBeVisible();
  });

  test('expired invitation reports a provider resend error without showing a password form', async ({ page }) => {
    await page.route('**/api/auth/resend-link', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
    });
    await page.goto('/auth/finish-invite?error_code=otp_expired&email=invitee%40example.com&lang=fr', { waitUntil: 'domcontentloaded' });

    const resend = page.getByTestId('auth-resend-link');
    await expect(resend).toBeVisible({ timeout: 15_000 });
    await resend.click();
    await expect(page.getByText('Impossible d’envoyer un nouveau lien', { exact: false })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
});
