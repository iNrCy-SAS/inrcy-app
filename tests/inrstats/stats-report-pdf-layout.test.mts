import assert from "node:assert/strict";
import test from "node:test";
import { jsPDF } from "jspdf";

import { planExecutiveInsightCards, type InsightCard } from "../../lib/inrstats/statsReportPdfLayout.ts";

const titles = ["Points forts", "À surveiller", "Actions"];

function collectColumnText(pages: ReturnType<typeof planExecutiveInsightCards>["pages"], index: number) {
  return pages.flatMap((page) => page.columns[index].lines.map((line) => line.text)).join(" ");
}

test("short insights leave the priorities on the summary page", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cards = titles.map((title) => ({ title, items: ["Premier constat utile.", "Deuxième constat utile."] }));
  const plan = planExecutiveInsightCards(doc, cards, 42);

  assert.equal(plan.prioritiesOnFirstPage, true);
  assert.equal(plan.prioritiesOnLastPage, false);
  assert.equal(plan.pages.length, 1);
  assert.equal(plan.pages[0].height, 86);
  for (const column of plan.pages[0].columns) {
    assert.ok(column.lines.every((line) => line.y <= 79));
  }
});

test("long insights continue on new pages without clipping or losing bullets", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cards: InsightCard[] = titles.map((title, column) => ({
    title,
    items: Array.from({ length: 5 }, (_, item) =>
      `DEBUT${column}${item} ${"analyse détaillée des résultats et des prochaines actions ".repeat(4)} FIN${column}${item}`,
    ),
  }));
  const plan = planExecutiveInsightCards(doc, cards, 42);

  assert.equal(plan.prioritiesOnFirstPage, false);
  assert.ok(plan.pages.length >= 2);
  assert.equal(plan.pages[0].height, 160);
  assert.equal(plan.prioritiesOnLastPage, true);
  assert.ok(48 + plan.pages[plan.pages.length - 1].height + 18 + 47 <= 266);
  for (const page of plan.pages) {
    for (const column of page.columns) {
      assert.ok(column.lines.every((line) => line.y <= page.height - 7));
      assert.ok(column.lines.every((line) => line.y >= 23));
    }
  }
  for (let column = 0; column < cards.length; column++) {
    const rendered = collectColumnText(plan.pages, column);
    const expected = cards[column].items.map((item) => `- ${item}`).join(" ");
    assert.equal(rendered.replace(/\s+/g, ""), expected.replace(/\s+/g, ""));
    for (let item = 0; item < cards[column].items.length; item++) {
      assert.match(rendered, new RegExp(`DEBUT${column}${item}`));
      assert.match(rendered, new RegExp(`FIN${column}${item}`));
    }
  }
  assert.ok(plan.pages.slice(1).some((page) => page.columns.some((column) => column.continuation)));
});

test("priorities move to a dedicated page when the final card page is full", () => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cards = titles.map((title) => ({
    title,
    items: Array.from({ length: 6 }, () => "Une analyse détaillée des résultats et des prochaines actions utiles. ".repeat(4)),
  }));
  const plan = planExecutiveInsightCards(doc, cards, 42);

  assert.equal(plan.prioritiesOnFirstPage, false);
  assert.equal(plan.prioritiesOnLastPage, false);
  assert.ok(48 + plan.pages[plan.pages.length - 1].height + 18 + 47 > 266);
});
