import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACTUS_WIDGET_EMBED_PATH,
  createActusWidgetEmbedUrl,
  isActusWidgetEmbedUrl,
  isPublicEmbedPath,
  resolvePublicAppOrigin,
} from "../../lib/actusWidgetEmbed.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("le générateur cible toujours la route publique du widget Actus", () => {
  assert.equal(ACTUS_WIDGET_EMBED_PATH, "/embed/actus");
  assert.equal(resolvePublicAppOrigin("https://app.inrcy.com/login"), "https://app.inrcy.com");
  assert.equal(
    createActusWidgetEmbedUrl("https://app.inrcy.com/login").toString(),
    "https://app.inrcy.com/embed/actus",
  );
  assert.equal(isActusWidgetEmbedUrl("https://app.inrcy.com/embed/actus?token=test"), true);
  assert.equal(isActusWidgetEmbedUrl("https://app.inrcy.com/"), false);
  assert.equal(isActusWidgetEmbedUrl("https://app.inrcy.com/login"), false);
});

test("seul l'espace /embed est reconnu comme intégrable", () => {
  assert.equal(isPublicEmbedPath("/embed/actus"), true);
  assert.equal(isPublicEmbedPath("/embed/actus/media"), true);
  assert.equal(isPublicEmbedPath("/embed/autre"), false);
  assert.equal(isPublicEmbedPath("/embed"), false);
  assert.equal(isPublicEmbedPath("/login"), false);
  assert.equal(isPublicEmbedPath("/dashboard"), false);
});

test("le proxy ne peut pas rediriger un embed vers le login", () => {
  const proxy = read("proxy.ts");
  const embedBypassIndex = proxy.indexOf("if (isPublicEmbedPath(pathname))");
  const authClientIndex = proxy.search(/createProxySupabaseClient\(\s*req,/);

  assert.ok(embedBypassIndex > 0, "le bypass /embed doit exister");
  assert.ok(authClientIndex > 0, "le rafraîchissement Supabase doit exister");
  assert.ok(embedBypassIndex < authClientIndex, "le bypass /embed doit précéder la session");
});

test("les pages privées restent DENY et /embed garde sa CSP intégrable", () => {
  const config = read("next.config.ts");

  assert.match(config, /source: "\/embed\/actus"[\s\S]*?frame-ancestors \*/);
  assert.match(config, /source: "\/\(\(\?!widgets\/\|embed\/actus/);
  assert.match(config, /X-Frame-Options", value: "DENY"/);
});
