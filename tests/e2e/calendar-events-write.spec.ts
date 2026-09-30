import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';

type ApiPayload = {
  ok?: boolean;
  id?: string;
};

type EvaluateResult = {
  ok: boolean;
  status: number;
  text: string;
  json: ApiPayload | null;
};

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const allowWrites = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('calendar write api', () => {
  test.skip(!email || !password, 'E2E_EMAIL et E2E_PASSWORD sont requis');
  test.skip(!allowWrites, 'E2E_ALLOW_WRITES=true requis pour les tests en écriture');

  test('create then delete an agenda draft without confirmations or reminders', async ({ page }) => {
    await login(page);

    const start = new Date(Date.now() + 24 * 3600 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const created = await page.evaluate<EvaluateResult, { startIso: string; endIso: string }>(
      async ({ startIso, endIso }) => {
        const res = await fetch('/api/calendar/events', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            summary: 'E2E Agenda Test',
            description: 'Créé automatiquement par Playwright',
            location: 'iNrCy',
            start: startIso,
            end: endIso,
            allDay: false,
            // Keep CI CRUD isolated even if this account enables real confirmations.
            inrcy: { status: 'draft', reminders: { enabled: false } },
          }),
        });

        const text = await res.text();
        let json: ApiPayload | null = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }

        return {
          ok: res.ok,
          status: res.status,
          text,
          json,
        };
      },
      { startIso: start.toISOString(), endIso: end.toISOString() }
    );

    expect(created.ok, `POST failed: HTTP ${created.status}\n${created.text}`).toBeTruthy();
    expect(created.json?.ok).toBeTruthy();
    expect(created.json?.id).toBeTruthy();

    const eventId = String(created.json?.id || "");
    expect(eventId).toBeTruthy();

    const removed = await page.evaluate<EvaluateResult, { id: string }>(async ({ id }) => {
      const res = await fetch(`/api/calendar/events?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          accept: 'application/json',
        },
      });

      const text = await res.text();
      let json: ApiPayload | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }

      return {
        ok: res.ok,
        status: res.status,
        text,
        json,
      };
    }, { id: eventId });

    expect(removed.ok, `DELETE failed: HTTP ${removed.status}\n${removed.text}`).toBeTruthy();
    expect(removed.json?.ok).toBeTruthy();
  });
});
