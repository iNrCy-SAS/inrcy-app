import {
  expect,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

const DASHBOARD_URL = /\/dashboard(?:[/?#]|$)/;
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_RETRY_DELAYS_MS = [2_000, 5_000];
const TRANSIENT_LOGIN_ALERT =
  /connexion au serveur impossible|service momentan(?:e|é)ment indisponible/i;

type LoginOutcome =
  | { kind: 'dashboard' }
  | { kind: 'alert'; message: string }
  | { kind: 'timeout' };

async function waitForLoginOutcome(page: Page): Promise<LoginOutcome> {
  const alert = page.getByTestId('login-error');
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    if (DASHBOARD_URL.test(page.url())) {
      return { kind: 'dashboard' };
    }

    if (await alert.isVisible().catch(() => false)) {
      const message = (await alert.innerText()).trim();
      if (message) return { kind: 'alert', message };
    }

    await page.waitForTimeout(250);
  }

  return { kind: 'timeout' };
}

function isSupabaseLoginRequest(request: Request) {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configuredUrl) return false;

  try {
    const requestUrl = new URL(request.url());
    const supabaseUrl = new URL(configuredUrl);
    return (
      requestUrl.origin === supabaseUrl.origin &&
      requestUrl.pathname === '/auth/v1/token'
    );
  } catch {
    return false;
  }
}

export async function login(
  page: Page,
  options: { forceUi?: boolean } = {},
) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error('E2E_EMAIL et E2E_PASSWORD sont requis');
  }

  // Authenticated Playwright projects start from the storage state produced by
  // auth.setup.ts. Verify that state through the real dashboard middleware and
  // avoid one password grant per test (43 grants in the former CI run).
  if (!options.forceUi) {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    if (DASHBOARD_URL.test(page.url())) return;
  }

  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt += 1) {
    let authRequestFailure: string | null = null;
    let authResponseFailure: string | null = null;
    const onRequestFailed = (request: Request) => {
      if (isSupabaseLoginRequest(request)) {
        authRequestFailure = request.failure()?.errorText || 'échec réseau';
      }
    };
    const onResponse = (response: Response) => {
      if (!isSupabaseLoginRequest(response.request())) return;
      if (response.status() === 429 || response.status() >= 500) {
        authResponseFailure = `HTTP ${response.status()}`;
      }
    };

    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);

    let outcome: LoginOutcome;
    try {
      await page.goto('/login');
      await page.getByTestId('login-email').fill(email);
      await page.getByTestId('login-password').fill(password);
      await page.getByTestId('login-submit').click();
      outcome = await waitForLoginOutcome(page);
    } finally {
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    }

    if (outcome.kind === 'dashboard') {
      return;
    }

    const alertMessage = outcome.kind === 'alert' ? outcome.message : '';
    const isTransientFailure =
      authRequestFailure !== null ||
      authResponseFailure !== null ||
      TRANSIENT_LOGIN_ALERT.test(alertMessage);

    if (!isTransientFailure) {
      if (alertMessage) {
        throw new Error(`Connexion E2E refusée : ${alertMessage}`);
      }

      // Conserve le diagnostic Playwright historique (URL attendue/reçue) si la
      // page ne produit ni navigation ni message d'erreur exploitable.
      await expect(page).toHaveURL(DASHBOARD_URL, { timeout: 1 });
      return;
    }

    if (attempt === MAX_LOGIN_ATTEMPTS) {
      const detail = [alertMessage, authRequestFailure, authResponseFailure]
        .filter(Boolean)
        .join(' — ');
      throw new Error(
        `Connexion E2E impossible après ${MAX_LOGIN_ATTEMPTS} tentatives (indisponibilité réseau Supabase)${
          detail ? ` : ${detail}` : ''
        }`,
      );
    }

    await page.waitForTimeout(LOGIN_RETRY_DELAYS_MS[attempt - 1]);
  }
}
