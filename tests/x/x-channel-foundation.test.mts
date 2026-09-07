import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  X_CHANNEL_CAPABILITIES,
  X_POST_MAX_IMAGES,
  getXPostTextMetrics,
  normalizeXChannelKey,
  shortenGeneratedXPost,
  validateXPostText,
} from "../../lib/xChannel.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("X uses one canonical key and accepts legacy Twitter names only as input aliases", () => {
  assert.equal(normalizeXChannelKey("x"), "x");
  assert.equal(normalizeXChannelKey("Twitter"), "x");
  assert.equal(normalizeXChannelKey("twitter_x"), "x");
  assert.equal(normalizeXChannelKey("instagram"), null);
  assert.equal(X_CHANNEL_CAPABILITIES.key, "x");
  assert.equal(X_CHANNEL_CAPABILITIES.supportsReels, false);
  assert.equal(X_CHANNEL_CAPABILITIES.supportsStories, false);
});

test("X text validation uses the official weighted counter", () => {
  const withUrl = getXPostTextMetrics("Découvrez notre offre https://example.com/une-url-tres-longue");
  assert.ok(withUrl.weightedLength < withUrl.text.length);
  assert.equal(validateXPostText("Bonjour X !").valid, true);
  const tooLong = validateXPostText("a".repeat(281));
  assert.equal(tooLong.valid, false);
  assert.equal(tooLong.code, "x_text_too_long");
});

test("generated X copy is shortened at a complete sentence boundary", () => {
  const first = "Une première phrase utile et complète.";
  const result = shortenGeneratedXPost(`${first} ${"Une suite beaucoup trop longue ".repeat(30)}`);
  assert.equal(result, first);
  assert.equal(validateXPostText(result).valid, true);
  assert.match(result, /[.!?…]$/);
});

test("X publishing foundation is fail-closed and exposes the provider contract", () => {
  assert.equal(X_POST_MAX_IMAGES, 4);
  const source = read("lib/xPublish.ts");
  assert.match(source, /POST[\s\S]*\/2\/tweets/);
  assert.match(source, /media_ids/);
  assert.match(source, /made_with_ai/);
  assert.match(source, /provider_status_unknown/);
  assert.match(source, /retryable:\s*false/);
  assert.match(source, /\/2\/media\/upload/);
  const publishNow = read("app/api/booster/publish-now/route.ts");
  assert.match(
    publishNow,
    /getFrenchPublicationErrorMessage\(\s*"x",\s*xError\.message,/,
  );
});

test("OAuth X binds the PKCE verifier to the exact state", () => {
  const oauth = read("lib/xOAuth.ts");
  const start = read("app/api/integrations/x/start/route.ts");
  const callback = read("app/api/integrations/x/callback/route.ts");
  assert.match(oauth, /stateDigest:\s*digestXOAuthState\(stateB64\)/);
  assert.match(oauth, /payload\.stateDigest\s*!==\s*digestXOAuthState\(stateB64\)/);
  assert.match(start, /code_challenge_method:\s*"S256"/);
  assert.match(start, /isAppBubbleEnabledForUser/);
  assert.match(callback, /offline_access_missing/);
  assert.match(callback, /withCurrentConnectionVersion\("channel:x"/);
});

test("X disconnect revokes encrypted OAuth credentials before local deletion", () => {
  const oauth = read("lib/xOAuth.ts");
  const disconnect = read("app/api/integrations/x/disconnect/route.ts");
  assert.match(oauth, /X_REVOKE_URL\s*=\s*`\$\{X_API_ORIGIN\}\/2\/oauth2\/revoke`/);
  assert.match(oauth, /tryDecryptToken\(input\.refreshTokenEnc/);
  assert.match(oauth, /new URLSearchParams\(\{ token, client_id: clientId \}\)/);
  assert.doesNotMatch(oauth, /console\.(?:log|warn|error)\([^)]*token/i);
  assert.match(disconnect, /select\("id,access_token_enc,refresh_token_enc"\)/);
  assert.match(disconnect, /await revokeXTokensBestEffort\([\s\S]*?await supabaseAdmin[\s\S]*?\.delete\(\)/);
});
