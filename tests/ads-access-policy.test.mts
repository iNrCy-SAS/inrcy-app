import assert from "node:assert/strict";
import test from "node:test";
import { ADS_PUBLIC_CHANNELS, adsAccessAllowed, isAdsPublicChannel } from "../lib/adsAccessPolicy.ts";
import { ADS_CHANNELS } from "../lib/adsValidation.ts";

test("Google, Pinterest and ChatGPT Ads are available to Premium and Founder, without opening pilot channels", () => {
  assert.equal(ADS_CHANNELS.length, 7);
  assert.deepEqual(ADS_PUBLIC_CHANNELS, ["google", "pinterest", "openai"]);
  assert.deepEqual(ADS_CHANNELS.map(({ id }) => id).filter(isAdsPublicChannel), ["google", "pinterest", "openai"]);
  for (const edition of ["premium", "founder"] as const) {
    assert.equal(adsAccessAllowed(edition, false), true);
    for (const channel of ["google", "pinterest", "openai"] as const) assert.equal(adsAccessAllowed(edition, false, channel), true);
    for (const channel of ["meta", "linkedin", "tiktok", "x"] as const) assert.equal(adsAccessAllowed(edition, false, channel), false);
  }
});

test("Standard stays closed while the pilot administrator retains access to every channel", () => {
  assert.equal(adsAccessAllowed("standard", false), false);
  for (const channel of ["google", "pinterest", "meta", "linkedin", "tiktok", "x", "openai"] as const) {
    assert.equal(adsAccessAllowed("standard", false, channel), false);
    assert.equal(adsAccessAllowed("standard", true, channel), true);
  }
});
