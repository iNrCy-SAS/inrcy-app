import assert from "node:assert/strict";
import test from "node:test";
import { getAdsAdvertiserAccountUrl } from "../lib/adsAccountLinks.ts";

test("les liens de compte Ads ne sont construits qu’avec un identifiant publicitaire sûr", () => {
  assert.equal(
    getAdsAdvertiserAccountUrl("google", "654-707-5545"),
    "https://ads.google.com/aw/overview?ocid=6547075545",
  );
  assert.equal(
    getAdsAdvertiserAccountUrl("meta", "act_492163888244053"),
    "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=act_492163888244053",
  );
  assert.equal(getAdsAdvertiserAccountUrl("google", "6547075545&next=https://bad.example"), null);
  assert.equal(getAdsAdvertiserAccountUrl("meta", "javascript:alert(1)"), null);
});
