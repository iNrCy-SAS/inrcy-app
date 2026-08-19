import { test, expect } from '@playwright/test';

test.describe('auth recovery flows', () => {
  test('forgot-password link is visible on login page', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByTestId('forgot-password')).toBeVisible();
  });

  test('set-password page shows expired-link message', async ({ page }) => {
    await page.goto('/set-password?error_code=otp_expired&mode=reset');

    await expect(page.getByTestId('auth-link-error')).toBeVisible({ timeout: 15_000 });
  });

  test('set-password page shows invalid-link message', async ({ page }) => {
    await page.goto('/set-password?error_description=invalid_token&mode=reset');

    await expect(page.getByTestId('auth-link-error')).toBeVisible({ timeout: 15_000 });
  });
});
