import test from "node:test";
import assert from "node:assert/strict";
import { detectNativePlatform, normalizeNativeOpenUrl } from "../../lib/nativeRuntime.ts";

test("native platform detection stays web-safe outside Capacitor", () => {
  assert.equal(detectNativePlatform(null), "web");
  assert.equal(detectNativePlatform({ isNativePlatform: () => false, getPlatform: () => "ios" }), "web");
  assert.equal(detectNativePlatform({ isNativePlatform: () => true, getPlatform: () => "ios" }), "ios");
  assert.equal(detectNativePlatform({ isNativePlatform: () => true, getPlatform: () => "android" }), "android");
});

test("app links are reduced to safe internal routes", () => {
  assert.equal(
    normalizeNativeOpenUrl("inrcy://auth/callback?code=abc", "https://app.inrcy.com"),
    "/auth/callback?code=abc",
  );
  assert.equal(
    normalizeNativeOpenUrl("com.inrcy.app://auth/callback?code=legacy", "https://app.inrcy.com"),
    "/auth/callback?code=legacy",
  );
  assert.equal(
    normalizeNativeOpenUrl("https://app.inrcy.com/dashboard?panel=contact", "https://app.inrcy.com"),
    "/dashboard?panel=contact",
  );
  assert.equal(normalizeNativeOpenUrl("https://example.com/dashboard", "https://app.inrcy.com"), null);
  assert.equal(normalizeNativeOpenUrl("inrcy://https://example.com", "https://app.inrcy.com"), null);
});
