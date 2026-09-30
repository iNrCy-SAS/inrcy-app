import assert from "node:assert/strict";
import test from "node:test";
import { adsAccessAllowed } from "../lib/adsAccessPolicy.ts";

test("Google and Pinterest are available to Premium and Founder, without opening pilot channels", () => {
  for (const edition of ["premium", "founder"] as const) {
    assert.equal(adsAccessAllowed(edition, false), true);
    for (const channel of ["google", "pinterest"] as const) assert.equal(adsAccessAllowed(edition, false, channel), true);
    for (const channel of ["meta", "linkedin", "tiktok", "x"] as const) assert.equal(adsAccessAllowed(edition, false, channel), false);
  }
});

test("Standard stays closed while the pilot administrator retains access to every channel", () => {
  assert.equal(adsAccessAllowed("standard", false), false);
  for (const channel of ["google", "pinterest", "meta", "linkedin", "tiktok", "x"] as const) {
    assert.equal(adsAccessAllowed("standard", false, channel), false);
    assert.equal(adsAccessAllowed("standard", true, channel), true);
  }
});
