import assert from "node:assert/strict";
import test from "node:test";
import { connectInrcyTooltip, getInrcyTooltipPosition } from "../../lib/inrcyTooltip.ts";

const rect = (left: number, top: number, width = 40, height = 30) => ({ left, top, right: left + width, bottom: top + height, width, height });

test("tooltip uses available space below a control at the top", () => {
  assert.deepEqual(getInrcyTooltipPosition(rect(100, 4), { width: 160, height: 60 }, { width: 400, height: 300 }), { left: 40, top: 44, placement: "bottom" });
});

test("tooltip stays above a lower control with a viewport margin", () => {
  assert.deepEqual(getInrcyTooltipPosition(rect(350, 260), { width: 160, height: 60 }, { width: 400, height: 300 }), { left: 228, top: 190, placement: "top" });
});

test("tooltip clamps horizontal edges on narrow screens", () => {
  assert.equal(getInrcyTooltipPosition(rect(-5, 80), { width: 260, height: 60 }, { width: 320, height: 400 }).left, 12);
  assert.equal(getInrcyTooltipPosition(rect(310, 80), { width: 260, height: 60 }, { width: 320, height: 400 }).left, 48);
});

test("tooltip accounts for a zoomed visual viewport's offset", () => {
  const result = getInrcyTooltipPosition(rect(415, 210), { width: 180, height: 70 }, { width: 260, height: 250, left: 200, top: 100 });
  assert.equal(result.left, 268);
  assert.equal(result.top, 130);
});

test("aria-describedby preserves existing tokens and concurrent updates", () => {
  const attributes = new Map<string, string>([["aria-describedby", "hint validation"]]);
  const anchor = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  } as unknown as Element;
  const disconnect = connectInrcyTooltip(anchor, "inrcy-tooltip");
  assert.equal(attributes.get("aria-describedby"), "hint validation inrcy-tooltip");
  attributes.set("aria-describedby", "hint validation inrcy-tooltip new-error");
  disconnect();
  assert.equal(attributes.get("aria-describedby"), "hint validation new-error");
});

test("aria-describedby removes only the temporary empty attribute", () => {
  const attributes = new Map<string, string>();
  const anchor = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  } as unknown as Element;
  connectInrcyTooltip(anchor, "inrcy-tooltip")();
  assert.equal(attributes.has("aria-describedby"), false);
});
