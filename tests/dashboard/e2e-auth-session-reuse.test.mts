import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

const config = read('playwright.config.ts');
const authSetup = read('tests/e2e/auth.setup.ts');
const authHelper = read('tests/e2e/helpers/auth.ts');
const loginPage = read('app/login/page.tsx');
const gitignore = read('.gitignore');
const ciWorkflow = read('.github/workflows/ci.yml');
const proxy = read('proxy.ts');

test('E2E authenticated specs reuse one setup session', () => {
  assert.match(config, /name: 'auth-setup'/);
  assert.match(config, /name: 'chromium-authenticated'/);
  assert.match(config, /storageState: authStatePath/);
  assert.match(config, /dependencies: hasE2ECredentials \? \['auth-setup'\]/);
  assert.match(authSetup, /storageState\(\{ path: E2E_AUTH_STATE_PATH \}\)/);
});

test('the auth helper verifies a preloaded dashboard before password login', () => {
  assert.match(authHelper, /if \(!options\.forceUi\)/);
  assert.match(authHelper, /page\.goto\('\/dashboard'/);
  assert.match(authHelper, /if \(DASHBOARD_URL\.test\(page\.url\(\)\)\) return/);
});

test('the auth helper ignores Next route-announcer alerts and waits for the real login error', () => {
  assert.match(authHelper, /getByTestId\('login-error'\)/);
  assert.doesNotMatch(authHelper, /getByRole\('alert'\)\.first/);
  assert.match(authHelper, /if \(message\) return \{ kind: 'alert', message \}/);
  assert.match(loginPage, /data-testid="login-error"/);
});

test('the generated session never enters source control or CI artifacts', () => {
  assert.match(gitignore, /\/playwright\/\.auth\//);
  assert.doesNotMatch(config, /test-results\/.*auth/i);
});

test('GitHub E2E runs the exact production build instead of a compiling dev server', () => {
  assert.match(ciWorkflow, /name: Upload Next\.js build[\s\S]*?name: next-build-\$\{\{ github\.sha \}\}/);
  assert.match(ciWorkflow, /path: \|[\s\S]*?\.next[\s\S]*?!\.next\/cache/);
  assert.match(ciWorkflow, /name: Download Next\.js build[\s\S]*?path: \.next/);
  assert.match(config, /command: isCI \? 'npm run start -- -p 3000' : 'npm run dev -- -p 3000'/);
  assert.doesNotMatch(config, /if \[ -f \.next\/BUILD_ID \]/);
  assert.match(proxy, /requestHostname === "localhost"/);
  assert.match(proxy, /process\.env\.NODE_ENV === "production" && !isLocalProductionHost/);
});
