import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("iNrSend updates Google text in place and safely replaces changed media", () => {
  const source = read("lib/inrsend/publicationChannelActions.ts");
  const start = source.indexOf('if (channel === "gmb")');
  const end = source.indexOf('if (channel === "tiktok")', start);
  const branch = source.slice(start, end);

  assert.match(branch, /gmbPatchLocalPost/);
  assert.match(branch, /rebuildGoogleBusinessImagesFromSources/);
  assert.doesNotMatch(branch, /withoutMedia|published_without_image/);
  assert.ok(branch.indexOf("gmbCreateLocalPost") < branch.lastIndexOf("gmbDeleteLocalPost"));
  assert.match(branch, /create and validate the new post first/);
});

test("iNrSend warns before an Instagram Business edit creates a new post", () => {
  const client = read("app/dashboard/mails/MailboxClient.tsx");
  const saveStart = client.indexOf("async function saveChannelPublication");
  const saveEnd = client.indexOf("async function deleteChannelPublication", saveStart);
  const save = client.slice(saveStart, saveEnd);

  assert.match(save, /normalizedChannel === "instagram"/);
  assert.match(save, /await confirmInrcy/);
  assert.match(save, /instagram_business_edit_warning_message/);
  assert.ok(save.indexOf("await confirmInrcy") < save.indexOf("method: \"PATCH\""));

  for (const locale of fs.readdirSync(path.join(ROOT, "messages"))) {
    const catalogPath = path.join(ROOT, "messages", locale, "mails.json");
    if (!fs.existsSync(catalogPath)) continue;
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    assert.ok(catalog.instagram_business_edit_warning_title, locale);
    assert.ok(catalog.instagram_business_edit_warning_message, locale);
    assert.ok(catalog.instagram_business_edit_warning_confirm, locale);
  }
});
