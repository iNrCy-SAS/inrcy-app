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

test("legal documents keep their expected dates, with only CGA updated for video credits, and no Trustpilot", () => {
  const docs = read("app/legal/_components/legalDocs.tsx");
  const shell = read("app/legal/_components/LegalPageShell.tsx");
  const cga = read("app/legal/_components/CgaContent.tsx");
  const privacy = read("app/legal/_components/ConfidentialiteContent.tsx");
  const mentions = read("app/legal/_components/MentionsLegalesContent.tsx");
  const legalText = read("app/legal/_components/LegalTextContent.tsx");
  const templates = read("lib/messageTemplates.ts");
  const cgaPage = read("app/legal/cga/page.tsx");
  const privacyPage = read("app/legal/confidentialite/page.tsx");
  const mentionsPage = read("app/legal/mentions-legales/page.tsx");
  const publicMessages = JSON.parse(read("messages/fr-FR/public.json")) as Record<string, string>;
  const legalMessages = JSON.parse(read("messages/fr-FR/legal.json")) as Record<string, string>;
  const settingsMessages = JSON.parse(read("messages/fr-FR/settings.json")) as Record<string, string>;

  const documentDates = Object.fromEntries(Array.from(
    docs.matchAll(/(?:"(mentions-legales)"|(confidentialite|cga)):\s*\{[^}]*?subtitleKey:\s*"([^"]+)"/g),
    (match) => [match[1] ?? match[2], match[3]],
  ));
  assert.deepEqual(documentDates, {
    confidentialite: "derniere_mise_a_jour_04_10_2026_7a4f81d2",
    "mentions-legales": "derniere_mise_a_jour_04_10_2026_7a4f81d2",
    cga: "version_du_11_10_2026_video_credits",
  });
  assert.equal(publicMessages.derniere_mise_a_jour_04_10_2026_7a4f81d2, "Dernière mise à jour : 04/10/2026");
  assert.equal(publicMessages.version_du_04_10_2026_51f2b1b8, "Version du 04/10/2026");
  assert.equal(publicMessages.version_du_11_10_2026_video_credits, "Version mise à jour le 11 octobre 2026.");
  assert.equal(settingsMessages.version_du_11_10_2026_video_credits, publicMessages.version_du_11_10_2026_video_credits);
  assert.equal(legalMessages.cga_0436_revision_20261004, publicMessages.version_du_11_10_2026_video_credits);
  assert.match(cgaPage, /subtitle=\{i18nT\("version_du_11_10_2026_video_credits"\)\}/);
  assert.match(cgaPage, /revision=\{i18nT\("version_du_11_10_2026_video_credits"\)\}/);
  assert.match(privacyPage, /derniere_mise_a_jour_04_10_2026_7a4f81d2/);
  assert.doesNotMatch(privacyPage + mentionsPage, /revision=/);
  assert.match(shell, /version_juridique_synchronisee_le_04_10_2026_68a90e11/);
  assert.match(shell, /props\.revision \?\? i18nT\("version_juridique_synchronisee_le_04_10_2026_68a90e11"\)/);
  assert.match(shell, /subtitle/);
  assert.ok(Object.values(legalMessages).some((message) => message.includes("1 vidéo source jusqu’à 300 Mo")));
  assert.match(legalText, /useTranslations\("legal"\)/);
  assert.match(cga, /document="cga"/);
  assert.match(privacy, /document="confidentialite"/);
  assert.match(mentions, /document="mentions-legales"/);

  for (const source of [JSON.stringify(legalMessages), templates]) {
    assert.doesNotMatch(source, /Trustpilot/i);
  }
});
