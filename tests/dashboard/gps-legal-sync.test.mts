import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("the GPS opens the exact guide selected from search or the article tabs", () => {
  const client = read("app/dashboard/gps/GpsClient.tsx");
  const css = read("app/dashboard/gps/gps.module.css");

  assert.match(client, /activeArticleId/);
  assert.match(client, /openSection\(hit\.sectionId, hit\.article\.id\)/);
  assert.match(client, /role="tablist"/);
  assert.match(client, /setActiveArticleId\(article\.id\)/);
  assert.match(css, /\.articleTabs \{/);
  assert.match(css, /overflow-x: auto/);
});

test("the GPS documents onboarding, legal settings, media optimization and mobile recovery", () => {
  const content = read("app/dashboard/gps/noticeContent.ts");
  const messages = JSON.parse(read("messages/fr-FR/gps.json")) as Record<string, string>;

  for (const articleId of [
    "demarrer-rangement",
    "booster-medias",
    "booster-bilan",
    "documents-legal",
    "problemes-mobile-reseau",
    "problemes-vocal",
  ]) {
    assert.match(content, new RegExp(`id: "${articleId}"`));
  }

  assert.ok(Object.values(messages).some((message) => message.includes("1 vidéo de 300 Mo maximum")));
  assert.ok(Object.values(messages).some((message) => message.includes("50 Mo maximum par image et 75 Mo pour la vidéo")));
});

test("the three app legal documents share the current date and no longer expose Trustpilot", () => {
  const docs = read("app/legal/_components/legalDocs.tsx");
  const shell = read("app/legal/_components/LegalPageShell.tsx");
  const cga = read("app/legal/_components/CgaContent.tsx");
  const privacy = read("app/legal/_components/ConfidentialiteContent.tsx");
  const mentions = read("app/legal/_components/MentionsLegalesContent.tsx");
  const templates = read("lib/messageTemplates.ts");
  const publicMessages = JSON.parse(read("messages/fr-FR/public.json")) as Record<string, string>;

  assert.equal((docs.match(/derniere_mise_a_jour_08_08_f576f6f7/g) ?? []).length, 2);
  assert.equal((docs.match(/version_du_08_08_2026_1465b7bb/g) ?? []).length, 1);
  assert.equal(publicMessages.derniere_mise_a_jour_08_08_f576f6f7, "Dernière mise à jour : 08/08/2026");
  assert.equal(publicMessages.version_du_08_08_2026_1465b7bb, "Version du 08/08/2026");
  assert.match(shell, /subtitle/);
  assert.match(cga, /1 vidéo source jusqu’à 300 Mo/);
  assert.match(privacy, /1 vidéo source jusqu’à 300 Mo/);

  for (const source of [cga, privacy, mentions, templates]) {
    assert.doesNotMatch(source, /Trustpilot/i);
  }
});
