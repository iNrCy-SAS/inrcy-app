import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildSupabaseEmailRedirectUrl,
  readAuthEmailLinkParams,
} from "../../lib/authEmailLinks.ts";

test("Supabase email redirect targets stay query-free", () => {
  assert.equal(
    buildSupabaseEmailRedirectUrl(
      "https://app.inrcy.com/",
      "/auth/finish-invite?lang=fr#ignored",
      "fr",
    ),
    "https://app.inrcy.com/auth/finish-invite/fr",
  );
});

test("every supported site language survives in a query-free auth path", () => {
  for (const language of ["fr", "en", "es", "it", "de", "nl", "pt"]) {
    const redirect = buildSupabaseEmailRedirectUrl(
      "https://app.inrcy.com",
      "/auth/finish-invite",
      language,
    );
    const url = new URL(redirect);
    assert.equal(url.pathname, `/auth/finish-invite/${language}`);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
  }
});

test("well-formed invitation links keep their token and language", () => {
  const params = new URLSearchParams(
    "lang=fr&token_hash=abcdefghijklmnopqrstuvwxyz012345&type=invite",
  );

  assert.deepEqual(readAuthEmailLinkParams(params), {
    tokenHash: "abcdefghijklmnopqrstuvwxyz012345",
    language: "fr",
    recoveredMalformedQuery: false,
  });
});

test("already-sent links recover token_hash from the malformed lang value", () => {
  for (const language of ["fr", "en", "es", "it", "de", "nl", "pt"]) {
    const params = new URLSearchParams(
      `lang=${language}?token_hash=abcdefghijklmnopqrstuvwxyz012345&type=invite`,
    );

    assert.deepEqual(readAuthEmailLinkParams(params), {
      tokenHash: "abcdefghijklmnopqrstuvwxyz012345",
      language,
      recoveredMalformedQuery: true,
    });
  }
});

test("all invitation and recovery senders use the query-free builder", () => {
  for (const sourcePath of [
    "app/api/public/trial-signup/route.ts",
    "app/api/auth/resend-link/route.ts",
    "app/api/admin/create-trial/route.ts",
    "app/login/page.tsx",
  ]) {
    const source = readFileSync(sourcePath, "utf8");
    assert.match(source, /buildSupabaseEmailRedirectUrl/);
    assert.doesNotMatch(source, /(?:inviteRedirectUrl|resetUrl)\.searchParams\.set\("lang"/);
  }
});

test("localized invite and reset routes feed their path locale into the auth flow", () => {
  const proxy = readFileSync("proxy.ts", "utf8");
  const invitePage = readFileSync(
    "app/auth/finish-invite/[language]/page.tsx",
    "utf8",
  );
  const resetPage = readFileSync(
    "app/auth/finish-reset/[language]/page.tsx",
    "utf8",
  );

  assert.match(proxy, /finish-\(\?:invite\|reset\)\\\/\(\[\^\/\]\+\)/);
  assert.match(invitePage, /initialLanguage=\{language\}/);
  assert.match(resetPage, /initialLanguage=\{language\}/);
});

test("public email images opt out of the application same-origin resource policy", () => {
  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /source: "\/signature-client\.png"/);
  assert.match(config, /source: "\/email\/:path\*"/);
  assert.match(config, /Cross-Origin-Resource-Policy", value: "cross-origin"/);
  assert.match(config, /Access-Control-Allow-Origin", value: "\*"/);
  assert.match(config, /email\/\|signature-client\\\\\.png\$/);
});

test("new registration alerts default to the account mailbox", () => {
  const source = readFileSync("app/api/admin/new-user-alert/route.ts", "utf8");
  assert.match(
    source,
    /process\.env\.INRCY_NEW_USER_ALERT_EMAIL \|\| "compte@inrcy\.com"/,
  );
  assert.doesNotMatch(source, /contact@inrcy\.com/);
});
