import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const css = read("app/dashboard/agenda/agenda.module.css");
const ui = read("app/dashboard/agenda/agenda.ui.tsx");
const client = read("app/dashboard/agenda/AgendaClient.tsx");

test("iNrCalendar uses a viewport-sized desktop cockpit without page scrolling", () => {
  assert.match(
    css,
    /@media \(min-width: 1101px\) and \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.page\s*\{[\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(css, /grid-template-columns:\s*minmax\(0, 3fr\) minmax\(300px, 1fr\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.gridCompact\s*\{[\s\S]*?grid-template-rows:\s*repeat\(6, minmax\(0, 1fr\)\)/);
});

test("desktop calendar header and day details remain usable without internal scrollbars", () => {
  assert.match(ui, /styles\.desktopCalendarNav/);
  assert.match(ui, /const desktopPageSize = 6/);
  assert.match(ui, /styles\.desktopEventPager/);
  assert.match(css, /\.desktopEventList\s*\{[\s\S]*?grid-template-rows:\s*repeat\(6, minmax\(0, 1fr\)\)[\s\S]*?overflow:\s*hidden/);
  assert.match(client, /cursorMonth=\{cursorMonth\}[\s\S]*?onRefresh=\{\(\) => loadEventsForMonth\(cursorMonth\)\}/);
});

test("desktop branding keeps the iNrCalendar slogan beside the logo", () => {
  const frenchMessages = read("messages/fr-FR/agenda.json");

  assert.match(css, /\.brand\s*\{[\s\S]*?flex-direction:\s*row;[\s\S]*?align-items:\s*center;/);
  assert.match(frenchMessages, /"plus_qu_un_agenda_pense_pour_3d5ee439": "Un agenda pensé pour le terrain"/);
});
