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
    await expect(page.getByRole('heading', { name: 'Vérifiez votre boîte mail' })).toBeVisible();
    await expect(page.getByTestId('auth-resend-success')).toContainText('Réinitialisez votre mot de passe iNrCy');
    await expect(page.getByTestId('auth-resend-success')).toContainText('Adresse utilisée : invitee@example.com');
    await expect(page.getByTestId('auth-link-error')).toHaveCount(0);
  });

  test('expired invitation without an address lets the invitee request a new link', async ({ page }) => {
    let requestedEmail: string | null = null;
    await page.route('**/api/auth/resend-link', async (route) => {
      const request = route.request().postDataJSON();
      requestedEmail = request.email;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto('/auth/finish-invite?error_code=otp_expired&lang=fr', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('auth-link-error')).toBeVisible({ timeout: 15_000 });
    const resend = page.getByTestId('auth-resend-link');
    await expect(resend).toBeVisible();
    await expect(resend).toBeDisabled();
    await page.getByTestId('auth-resend-email').fill('invitee@example.com');
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect.poll(() => requestedEmail).toBe('invitee@example.com');
    await expect(page.getByText('Si ce compte existe, un nouveau lien sera envoyé à cette adresse.')).toBeVisible();
    await expect(page.getByTestId('auth-resend-success')).toBeVisible();
    await expect(page.getByTestId('auth-resend-success')).toContainText('Adresse utilisée : invitee@example.com');
  });

  test('expired invitation reports a provider resend error without showing a password form', async ({ page }) => {
    await page.route('**/api/auth/resend-link', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
    });
    await page.goto('/auth/finish-invite?error_code=otp_expired&email=invitee%40example.com&lang=fr', { waitUntil: 'domcontentloaded' });

    const resend = page.getByTestId('auth-resend-link');
    await expect(resend).toBeVisible({ timeout: 30_000 });
    await resend.click();
    await expect(page.getByText('Impossible d’envoyer un nouveau lien', { exact: false })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
});
