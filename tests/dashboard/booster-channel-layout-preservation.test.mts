import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  editableHtmlToSiteText,
  renderBoosterSiteContentHtml,
  sanitizeBoosterSiteText,
  stripSiteTextFormattingPreserveLayout,
} from "../../lib/boosterFormatting.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const channelContext = read("app/api/booster/publish-now/publishNow.channel-context.ts");
const publishRoute = read("app/api/booster/publish-now/route.ts");
const boosterCta = read("lib/boosterCta.ts");
const inrSearchPublic = read("lib/inrSearchPublic.ts");

const authored = "Première ligne.\n\n\nDeuxième ligne.\n\nTroisième ligne.";

test("Site web and Site iNrCy preserve every authored blank line", () => {
  assert.equal(sanitizeBoosterSiteText(authored), authored);
  assert.equal(
    editableHtmlToSiteText("Première ligne.<br><br><br>Deuxième ligne.<br><br>Troisième ligne."),
    authored,
  );
  assert.equal(
    renderBoosterSiteContentHtml(authored),
    "<p>Première ligne.<br /><br /><br />Deuxième ligne.<br /><br />Troisième ligne.</p>",
  );
});

test("social-channel formatting strips rich tags without compacting paragraph layout", () => {
  const rich = `<strong>Première ligne.</strong>\n\n\nDeuxième ligne.\n\nTroisième ligne.`;
  assert.equal(stripSiteTextFormattingPreserveLayout(rich), authored);
  assert.match(boosterCta, /stripSiteTextFormattingPreserveLayout\(post\?\.content \|\| ""\)/);
  assert.match(boosterCta, /parts\.join\("\\n\\n"\)\.trim\(\)/);
});

test("the publication resolver applies the layout-preserving sanitizer per channel", () => {
  assert.match(
    channelContext,
    /const isSiteChannel = channel === "inrcy_site" \|\| channel === "site_web" \|\| channel === "inr_search"/,
  );
  assert.match(
    channelContext,
    /const content = isSiteChannel\s*\? sanitizeBoosterSiteText\(rawContent\)\s*:\s*stripSiteTextFormattingPreserveLayout\(rawContent\)/,
  );
});

test("Site web and Site iNrCy persist the resolved channel content verbatim", () => {
  assert.match(publishRoute, /if \(ch === "inrcy_site" \|\| ch === "site_web"\)/);
  assert.match(publishRoute, /content: channelPost\.content/);
});

test("Facebook, Instagram and LinkedIn receive the preserved channel message", () => {
  assert.match(publishRoute, /description: canonMessage/);
  assert.match(publishRoute, /message: canonMessage/);
  assert.match(publishRoute, /const instagramCaption = buildBoosterInstagramCaption\(channelPost/);
  assert.match(publishRoute, /caption: instagramCaption/);
  assert.match(publishRoute, /text: canonMessage/);
});

test("TikTok, YouTube and Pinterest append optional parts with paragraph separators", () => {
  assert.match(publishRoute, /const description = \[canonMessage, tagLine\][\s\S]*?\.join\("\\n\\n"\)/);
  assert.match(publishRoute, /\[canonMessage, tiktokHashtagLine\][\s\S]*?\.join\("\\n\\n"\)/);
  assert.match(publishRoute, /const pinterestContent = stripSiteTextFormattingPreserveLayout\(/);
  assert.match(publishRoute, /\[description, optionalPart\]\.filter\(Boolean\)\.join\("\\n\\n"\)/);
});

test("Google Business keeps paragraph breaks while applying its compliance filter", () => {
  assert.match(publishRoute, /const gmbSummary = buildBoosterGmbSummary\(channelPost/);
  assert.match(publishRoute, /summary: gmbSummary/);
  assert.match(boosterCta, /sanitizeGoogleBusinessPublicationText\(parts\.join\("\\n\\n"\)\)/);
});

test("iNr'Search reads its own channel post without flattening its content", () => {
  assert.match(inrSearchPublic, /byChannel\.inr_search \|\| payload\.post/);
  assert.match(
    inrSearchPublic,
    /clean\(preferredPost\.content \|\| preferredPost\.text \|\| fallbackPost\.content \|\| fallbackPost\.text, 2400\)/,
  );
  assert.match(inrSearchPublic, /String\(value \?\? ""\)\.trim\(\)\.slice\(0, max\)\.trim\(\)/);
});
