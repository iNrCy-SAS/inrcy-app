import { test, expect } from '@playwright/test';

test.describe('public flows', () => {
  test('login page loads and shows email/password fields', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('anonymous user is redirected to login when visiting dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    await expect(page).toHaveURL(/\/login/);
  });

  test('health endpoints behave as expected', async ({ request }) => {
    const health = await request.get('/api/health');
    const healthJson = await health.json();
    expect([200, 503]).toContain(health.status());
    expect(typeof healthJson.ok).toBe('boolean');
    expect(health.status()).toBe(healthJson.ok ? 200 : 503);
    expect(typeof healthJson.ts).toBe('string');

    const internal = await request.get('/api/health/internal');
    expect([401, 403]).toContain(internal.status());
  });

  test('CSP Report-Only header is present on dashboard route or redirect response', async ({ page }) => {
    const response = await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    const headers = response?.headers() || {};
    const cspReportOnly = headers['content-security-policy-report-only'];

    expect(cspReportOnly || '').not.toBe('');
    expect(cspReportOnly || '').toContain("default-src 'self'");
  });
});
