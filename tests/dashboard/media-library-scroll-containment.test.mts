import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  "app/dashboard/mediatheque/mediaLibrary.module.css",
  "utf8",
);

test("la carte de la médiathèque ne devient jamais un second conteneur de défilement", () => {
  assert.match(
    styles,
    /\.libraryCard\{\s*display:flex;\s*flex-direction:column;[\s\S]*?overflow:clip;\s*overscroll-behavior:none;/,
  );
  assert.match(
    styles,
    /\.mediaList\{\s*min-height:0;\s*height:auto;\s*max-height:100%;\s*flex:1;\s*overflow:auto;\s*overscroll-behavior:contain;\s*scrollbar-gutter:stable;/,
  );
});
