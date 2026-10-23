import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { apiGET, asObject } from './helpers/api';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('booster api', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD sont requis');

  test('connected channels endpoint returns a valid shape', async ({ page }) => {
    await login(page);

    const res = await apiGET(page, '/api/booster/connected-channels');

    expect([200].includes(res.status), `HTTP ${res.status}\n${res.text}`).toBeTruthy();
    expect(res.contentType || '').toContain('application/json');
    const json = asObject(res.json);
    expect(json).toBeTruthy();
    expect(json).toHaveProperty('channels');

    const channels = asObject(json.channels);
    expect(typeof channels).toBe('object');

    // Site Web is the single website channel; the former inrcy_site alias
    // was retired when website connections were consolidated.
    const expectedChannels = [
      'site_web', 'inr_search', 'gmb', 'facebook', 'instagram', 'threads',
      'linkedin', 'tiktok', 'youtube_shorts', 'pinterest', 'x',
    ];
    expect(Object.keys(channels).sort()).toEqual([...expectedChannels].sort());
    for (const key of expectedChannels) {
      expect(typeof channels[key], `channels.${key}`).toBe('boolean');
    }
  });

  test('booster metrics endpoint returns expected keys', async ({ page }) => {
    await login(page);

    const res = await apiGET(page, '/api/booster/metrics?days=30');

    expect([200].includes(res.status), `HTTP ${res.status}\n${res.text}`).toBeTruthy();
    expect(res.contentType || '').toContain('application/json');
    const json = asObject(res.json);
    expect(json).toBeTruthy();

    expect(json).toHaveProperty('range_days');
    expect(json).toHaveProperty('publish');
    expect(json).toHaveProperty('review_mail');
    expect(json).toHaveProperty('promo_mail');
  });
});
