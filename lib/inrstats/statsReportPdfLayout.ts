import type { jsPDF } from "jspdf";

export type InsightCard = { title: string; items: string[] };
export type InsightCardLine = { text: string; y: number };
export type InsightCardPage = {
  height: number;
  columns: { title: string; continuation: boolean; lines: InsightCardLine[] }[];
};

const BODY_START = 23;
const BOTTOM_PADDING = 7;
const LINE_HEIGHT = 4.6;
const ITEM_GAP = 1.8;

function paginateInsightCards(
  doc: Pick<jsPDF, "setFont" | "setFontSize" | "splitTextToSize">,
  cards: InsightCard[],
  firstHeight: number,
  textWidth: number,
): InsightCardPage[] {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.4);

  const wrapped = cards.map((card) =>
    card.items.flatMap((item) => {
      const lines = doc.splitTextToSize(`- ${item}`, textWidth) as string[];
      return lines.map((line, index) => ({
        text: line,
        gapAfter: index === lines.length - 1 ? ITEM_GAP : 0,
      }));
    }),
  );
  const positions = cards.map(() => 0);
  const pages: InsightCardPage[] = [];

  do {
    const height = pages.length === 0 ? firstHeight : 216;
    const columns = cards.map((card, index) => {
      const continuation = positions[index] > 0;
      const lines: InsightCardLine[] = [];
      let cursor = BODY_START;
      while (positions[index] < wrapped[index].length && cursor <= height - BOTTOM_PADDING) {
        const line = wrapped[index][positions[index]++];
        lines.push({ text: line.text, y: cursor });
        cursor += LINE_HEIGHT + line.gapAfter;
      }
      return { title: card.title, continuation, lines };
    });
    pages.push({ height, columns });
  } while (positions.some((position, index) => position < wrapped[index].length));

  if (pages.length > 1) {
    const lastPage = pages[pages.length - 1];
    const lastLineY = Math.max(BODY_START, ...lastPage.columns.flatMap((column) => column.lines.map((line) => line.y)));
    lastPage.height = Math.max(60, Math.min(lastPage.height, lastLineY + BOTTOM_PADDING));
  }

  return pages;
}

export function planExecutiveInsightCards(
  doc: Pick<jsPDF, "setFont" | "setFontSize" | "splitTextToSize">,
  cards: InsightCard[],
  textWidth: number,
): { pages: InsightCardPage[]; prioritiesOnFirstPage: boolean; prioritiesOnLastPage: boolean } {
  const compactPages = paginateInsightCards(doc, cards, 86, textWidth);
  if (compactPages.length === 1) {
    return { pages: compactPages, prioritiesOnFirstPage: true, prioritiesOnLastPage: false };
  }
  const pages = paginateInsightCards(doc, cards, 160, textWidth);
  const lastPage = pages[pages.length - 1];
  return {
    pages,
    prioritiesOnFirstPage: false,
    prioritiesOnLastPage: pages.length > 1 && 48 + lastPage.height + 18 + 47 <= 266,
  };
}
