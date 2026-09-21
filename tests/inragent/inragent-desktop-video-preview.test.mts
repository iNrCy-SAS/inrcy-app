import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preview = readFileSync(
  "app/dashboard/agent/_lib/agent.publish-preview.ts",
  "utf8",
);
const client = readFileSync("app/dashboard/agent/AgentClient.tsx", "utf8");

test("iNrAgent reconnait les anciennes vidéos même avec une URL sans extension", () => {
  assert.match(
    preview,
    /record\.contentType,[\s\S]*?record\.kind,[\s\S]*?record\.mediaType,[\s\S]*?record\.media_type/,
  );
  assert.match(
    preview,
    /record\.posterUrl,[\s\S]*?record\.thumbnailUrl,[\s\S]*?record\.previewUrl/,
  );
});

test("le lecteur desktop recharge le canal actif et affiche sa vignette", () => {
  assert.match(
    client,
    /key=\{publishMediaPreview\.url\}[\s\S]*?poster=\{publishMediaPreview\.posterUrl \|\| undefined\}[\s\S]*?playsInline[\s\S]*?preload="auto"/,
  );
  assert.match(client, /poster=\{item\.posterUrl \|\| undefined\}/);
});
