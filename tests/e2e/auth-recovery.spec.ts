import { test, expect } from '@playwright/test';

test.describe('auth recovery flows', () => {
  for (const { mode, type, path, button } of [
    { mode: 'invite', type: 'invite', path: '/auth/finish-invite', button: 'Créer mon mot de passe' },
    { mode: 'reset', type: 'recovery', path: '/auth/finish-reset', button: 'Réinitialiser mon mot de passe' },
  ] as const) {
    test(`${mode} link is consumed only when the final password form is submitted`, async ({ page }) => {
      const tokenHash = 'a'.repeat(64);
      const requests: Array<Record<string, unknown>> = [];
      await page.route('**/api/auth/finish-password', async (route) => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, user_id: 'verified-user', email: 'invitee@example.com' }),
        });
      });
      await page.goto(`${path}?token_hash=${tokenHash}&type=${type}&email=invitee%40example.com&lang=fr`, {
        waitUntil: 'domcontentloaded',
      });

      const passwordInputs = page.locator('input[autocomplete="new-password"]');
      await expect(passwordInputs).toHaveCount(2, { timeout: 30_000 });
      expect(requests).toHaveLength(0);
      await page.getByRole('dialog', { name: 'Consentement cookies' }).getByRole('button', { name: 'Refuser' }).click();
      await passwordInputs.nth(0).fill('SecurePass9!');
      await passwordInputs.nth(1).fill('SecurePass9!');
      await page.getByRole('button', { name: button }).click();

      await expect.poll(() => requests.length).toBe(1);
      expect(requests[0]).toMatchObject({
        mode,
        type,
        token_hash: tokenHash,
        email: 'invitee@example.com',
        password: 'SecurePass9!',
      });
      expect(requests[0]).not.toHaveProperty('phase');
      await expect(page).toHaveURL(/\/login\?lang=fr/, { timeout: 15_000 });
    });
  }

  test('expired OTP is reported after final submit, without consuming it on page load', async ({ page }) => {
    const requests: Array<Record<string, unknown>> = [];
    await page.route('**/api/auth/finish-password', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'auth_link_invalid' }),
      });
    });
    await page.goto(`/auth/finish-invite?token_hash=${'b'.repeat(64)}&type=invite&email=invitee%40example.com&lang=fr`, {
      waitUntil: 'domcontentloaded',
    });

    const passwordInputs = page.locator('input[autocomplete="new-password"]');
    await expect(passwordInputs).toHaveCount(2, { timeout: 30_000 });
    expect(requests).toHaveLength(0);
    await page.getByRole('dialog', { name: 'Consentement cookies' }).getByRole('button', { name: 'Refuser' }).click();
    await passwordInputs.nth(0).fill('SecurePass9!');
    await passwordInputs.nth(1).fill('SecurePass9!');
    await page.getByRole('button', { name: 'Créer mon mot de passe' }).click();

    await expect.poll(() => requests.length).toBe(1);
    await expect(page.getByRole('heading', { name: 'Lien expiré' })).toBeVisible();
    await expect(page.getByTestId('auth-resend-link')).toBeVisible();
    await expect(passwordInputs).toHaveCount(0);
  });

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
