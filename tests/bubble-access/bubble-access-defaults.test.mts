import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_BUBBLE_DEFAULT_ACCESS,
  buildBubbleAccessMap,
  createDefaultBubbleAccessRows,
  isBubbleEnabled,
} from "../../lib/bubbleAccess.ts";

test("TikTok, Pinterest et X sont actifs par défaut tandis que Site iNrCy reste en opt-in", () => {
  assert.equal(APP_BUBBLE_DEFAULT_ACCESS.tiktok, true);
  assert.equal(APP_BUBBLE_DEFAULT_ACCESS.pinterest, true);
  assert.equal(APP_BUBBLE_DEFAULT_ACCESS.x, true);
  assert.equal(APP_BUBBLE_DEFAULT_ACCESS.site_inrcy, false);

  const rows = createDefaultBubbleAccessRows("00000000-0000-0000-0000-000000000001");
  assert.equal(rows.find((row) => row.bubble_key === "tiktok")?.enabled, true);
  assert.equal(rows.find((row) => row.bubble_key === "pinterest")?.enabled, true);
  assert.equal(rows.find((row) => row.bubble_key === "site_inrcy")?.enabled, false);
});

test("TikTok reste forcé actif, tandis qu'une désactivation admin explicite de Pinterest reste respectée", () => {
  const accessMap = buildBubbleAccessMap([
    { bubble_key: "tiktok", enabled: false },
    { bubble_key: "pinterest", enabled: false },
  ]);

  assert.equal(accessMap.tiktok, true);
  assert.equal(accessMap.pinterest, false);
  assert.equal(isBubbleEnabled({ tiktok: false }, "tiktok"), true);
  assert.equal(isBubbleEnabled(undefined, "pinterest"), true);
});

test("Site iNrCy reste fermé sans ligne Supabase et ne s'ouvre qu'avec enabled=true", () => {
  const withoutRow = buildBubbleAccessMap([]);
  const disabledRow = buildBubbleAccessMap([{ bubble_key: "site_inrcy", enabled: false }]);
  const enabledRow = buildBubbleAccessMap([{ bubble_key: "site_inrcy", enabled: true }]);

  assert.equal(withoutRow.site_inrcy, false);
  assert.equal(disabledRow.site_inrcy, false);
  assert.equal(enabledRow.site_inrcy, true);
  assert.equal(isBubbleEnabled(undefined, "site_inrcy"), false);
});
