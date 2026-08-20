import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const isCI = !!process.env.CI;
const hasE2ECredentials = Boolean(
  process.env.E2E_EMAIL && process.env.E2E_PASSWORD,
);
const authStatePath = 'playwright/.auth/e2e-user.json';

// These specs require a session but do not test the password form itself.
// They share the single state created by auth.setup.ts. authenticated.spec.ts
// deliberately stays in the public project so its three login scenarios still
// exercise the real form and refresh behavior.
const preauthenticatedSpecPattern =
  /(?:account-export|billing-account|billing-checkout|booster-actions|booster-api|booster-fideliser-pages|calendar-api|calendar-events-write|crm-api|crm-contacts-write|dashboard-modules|dashboard-panels|devis-create|documents-new-pages|facture-create|fideliser-actions|fideliser-api|generator-kpis|integrations|mails-api|mails-mocked|notifications-api|onboarding-flow|settings-pages|stripe-checkout)\.spec\.ts/;

// Si E2E_BASE_URL est fourni, on vise un environnement déjà déployé.
// Sinon, on démarre le serveur local.
const shouldStartWebServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },

  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Le serveur Next local et le même compte E2E supportent mal plusieurs flux
  // authentifiés concurrents. Sur une URL déjà déployée, deux workers restent sûrs.
  workers: isCI ? (shouldStartWebServer ? 1 : 2) : undefined,

  reporter: isCI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    // Les assertions E2E historiques ciblent l’interface française. Sans ce
    // réglage, Chromium envoie en-US et next-intl sélectionne l’anglais.
    locale: 'fr-FR',
    extraHTTPHeaders: {
      'Accept-Language': 'fr-FR,fr;q=0.9',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  webServer: shouldStartWebServer
    ? {
        command: isCI ? 'sh -c "if [ -f .next/BUILD_ID ]; then npm run start -- -p 3000; else npm run dev -- -p 3000; fi"' : 'npm run dev -- -p 3000',
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 300_000,
        env: {
          ...process.env,
          E2E_BYPASS_REQUIRED_SETUP: 'true',
        },
      }
    : undefined,

  projects: [
    ...(hasE2ECredentials
      ? [
          {
            name: 'auth-setup',
            testMatch: /auth\.setup\.ts/,
          },
        ]
      : []),
    {
      name: 'chromium',
      testIgnore: [/auth\.setup\.ts/, preauthenticatedSpecPattern],
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'chromium-authenticated',
      testMatch: preauthenticatedSpecPattern,
      dependencies: hasE2ECredentials ? ['auth-setup'] : [],
      use: {
        ...devices['Desktop Chrome'],
        ...(hasE2ECredentials ? { storageState: authStatePath } : {}),
      },
    },
  ],
});
