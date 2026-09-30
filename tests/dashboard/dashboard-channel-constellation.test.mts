import assert from "node:assert/strict";
import test from "node:test";
import { CHANNEL_BUBBLE_EDGE, getChannelSceneLayout } from "../../app/dashboard/_components/dashboard-channel-presentation.ts";

const sizes: Array<[number, number]> = [];
for (let width = 1000; width <= 1920; width += 20) {
  for (let height = 430; height <= 1000; height += 10) sizes.push([width, height]);
}
sizes.push([1920, 1000], [1587, 551], [1000, 430]);

test("constellation keeps all 12 satellites apart, including maximum motion, and protects the centre", () => {
  for (const [width, height] of sizes) {
    const layout = getChannelSceneLayout(width, height);
    assert.equal(layout.slots.length, 12);
    const circles = [...layout.slots, { x: width / 2, y: layout.centerY, size: layout.centerSize }];
    for (let index = 0; index < circles.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < circles.length; otherIndex += 1) {
        const circle = circles[index];
        const other = circles[otherIndex];
        // Relative motion is bounded by hypot(12,16) = 20px, for any phase.
        const minimumGap = Math.hypot(circle.x - other.x, circle.y - other.y) - (circle.size + other.size) / 2 - 20;
        assert.ok(minimumGap >= 23.9, `${width}x${height}, circles ${index}/${otherIndex}: ${minimumGap}px`);
      }
    }
  }
});

test("constellation protects both side arrows, centred vertically with the selected bubble", () => {
  for (const [width, height] of sizes) {
    const layout = getChannelSceneLayout(width, height);
    assert.equal(layout.centerY, height / 2);
    assert.equal(layout.arrowOffset, layout.centerSize / 2 + 42);
    assert.equal(layout.arrowSize, 44);
    assert.equal(layout.arrowGap, 20);
    assert.ok(!("infoTop" in layout) && !("infoWidth" in layout) && !("infoHeight" in layout));
    for (const direction of [-1, 1]) {
      const arrowX = width / 2 + direction * layout.arrowOffset;
      assert.ok(arrowX - layout.arrowSize / 2 > 0 && arrowX + layout.arrowSize / 2 < width);
      for (const slot of layout.slots) {
        const minimumGap = Math.hypot(slot.x - arrowX, slot.y - layout.centerY) - (slot.size + layout.arrowSize) / 2 - 10;
        assert.ok(minimumGap >= 24, `${width}x${height}: arrow ${direction} gap ${minimumGap}px`);
      }
    }
  }
});

test("constellation keeps legible diameters and every floating circle within the scene", () => {
  for (const [width, height] of sizes) {
    for (const slot of getChannelSceneLayout(width, height).slots) {
      assert.ok(slot.size >= 90, `${width}x${height}: diameter ${slot.size}`);
      assert.ok(slot.x - slot.size / 2 - 6 >= CHANNEL_BUBBLE_EDGE - 6 - 0.01);
      assert.ok(width - slot.x - slot.size / 2 - 6 >= CHANNEL_BUBBLE_EDGE - 6 - 0.01);
      assert.ok(slot.y - slot.size / 2 - 8 >= CHANNEL_BUBBLE_EDGE - 8 - 0.01);
      assert.ok(height - slot.y - slot.size / 2 - 8 >= CHANNEL_BUBBLE_EDGE - 8 - 0.01);
    }
  }
});

test("constellation is deterministic and genuinely irregular, not shuffled grid cells", () => {
  for (const [width, height] of [[1000, 430], [1587, 551], [1920, 800]]) {
    const first = getChannelSceneLayout(width, height);
    assert.deepEqual(first, getChannelSceneLayout(width, height));
    assert.ok(new Set(first.slots.map((slot) => Math.round(slot.x / 10))).size >= 9, "x positions should not align in columns");
    assert.ok(new Set(first.slots.map((slot) => Math.round(slot.y / 10))).size >= 8, "y positions should not align in rows");
    assert.ok(new Set(first.slots.map((slot) => Math.round(slot.size))).size >= 3, "diameters should vary organically");
  }
});
