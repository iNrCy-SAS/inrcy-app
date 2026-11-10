import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { assistantMessagesWithFiles } from "../../lib/inrAssistantAttachmentPrompt.ts";
import { assistantModelInputBudget } from "../../lib/inrAssistantAttachments.ts";
import type { AssistantFileContext } from "../../lib/inrAssistantAttachmentStorage.ts";
import type { ModelMessage } from "ai";

type FileMetadata = { documentIndex: number; name: string; kind: string; excerpt?: string; sentVisualCount?: number; omittedVisualCount?: number; sentVideoFrameTimesSeconds?: number[]; omittedVideoFrameCount?: number; visualCoverage?: string; videoPreviewTimestampUnknown?: boolean };
async function preview() { return (await sharp({ create: { width: 16, height: 16, channels: 3, background: "blue" } }).jpeg().toBuffer()).toString("base64"); }
function video(index: number, image: string): AssistantFileContext {
  return { name: `clip-${index}.mp4`, kind: "video", text: `Paroles fictives de la vidéo ${index}.`, textTruncated: false,
    frames: [0, 30, 59.85].map(timeSeconds => ({ image, timeSeconds })),
    note: "Trois images stockées aux secondes 0, 30, 59.85 ; transcription automatique de 0 à 60 secondes. Lecture partielle." };
}
function inspect(messages: ModelMessage[]) {
  const latest = messages.at(-1)!;
  assert.equal(latest.role, "user"); assert.ok(Array.isArray(latest.content));
  const metadata: FileMetadata[] = [], timestamps = new Map<number, number[]>();
  let imageCount = 0;
  for (const part of latest.content) {
    if (part.type === "image") imageCount += 1;
    if (part.type !== "text" || !part.text.startsWith("{")) continue;
    const record = JSON.parse(part.text);
    if (record.name) metadata.push(record);
    if (typeof record.sampledVideoFrameAtSeconds === "number") {
      const sent = timestamps.get(record.documentIndex) ?? []; sent.push(record.sampledVideoFrameAtSeconds); timestamps.set(record.documentIndex, sent);
    }
  }
  return { metadata, timestamps, imageCount };
}

test("four videos share six visual slots fairly, prioritize their middle frame and retain all transcripts", async () => {
  const image = await preview(), files = [1, 2, 3, 4].map(index => video(index, image));
  const before = JSON.stringify(files);
  const messages = assistantMessagesWithFiles([{ role: "user", content: "Compare ces quatre vidéos sans agir." }], files);
  const result = inspect(messages);
  assert.equal(result.imageCount, 6); assert.deepEqual(result.metadata.map(file => file.sentVisualCount), [2, 2, 1, 1]);
  assert.deepEqual(result.metadata.map(file => file.omittedVideoFrameCount), [1, 1, 2, 2]);
  assert.equal(result.metadata.length, 4);
  for (const [index, file] of result.metadata.entries()) {
    assert.equal(file.documentIndex, index + 1); assert.equal(file.sentVideoFrameTimesSeconds?.[0], 30);
    assert.deepEqual(file.sentVideoFrameTimesSeconds, result.timestamps.get(index + 1));
    assert.equal(file.omittedVideoFrameCount, 3 - file.sentVideoFrameTimesSeconds!.length);
    assert.match(file.excerpt!, new RegExp(`vidéo ${index + 1}`));
    assert.match(file.visualCoverage!, /Aucune lecture des images omises/);
  }
  assert.ok(assistantModelInputBudget(messages) < 20_000, "Six images leave context room for system and tools");
  assert.equal(JSON.stringify(files), before, "All three stored frames and transcripts remain intact");
});

test("fixed images count toward the same six slots and every visual file is represented regardless of order", async () => {
  const image = await preview();
  const photo = (index: number): AssistantFileContext => ({ name: `photo-${index}.jpg`, kind: "image", image, note: "Image fournie." });
  for (const files of [[video(1, image), photo(1), photo(2), video(2, image)], [photo(1), video(1, image), video(2, image), photo(2)]]) {
    const result = inspect(assistantMessagesWithFiles([{ role: "user", content: "Compare les quatre fichiers." }], files));
    assert.equal(result.imageCount, 6); assert.equal(result.metadata.length, 4);
    for (const file of result.metadata) {
      assert.equal(file.sentVisualCount, file.kind === "image" ? 1 : 2);
      assert.equal(file.omittedVisualCount, file.kind === "image" ? 0 : 1);
      if (file.kind === "video") { assert.deepEqual(file.sentVideoFrameTimesSeconds, [30, 0]); assert.equal(file.omittedVideoFrameCount, 1); }
    }
    assert.ok(assistantModelInputBudget(assistantMessagesWithFiles([{ role: "user", content: "Compare les quatre fichiers." }], files)) < 20_000);
  }
});

test("visual limiting preserves audio text and legacy video previews never invent an unknown timestamp", async () => {
  const image = await preview();
  const files: AssistantFileContext[] = [video(1, image), video(2, image), { name: "legacy.mp4", kind: "video", image, note: "Première image historique." },
    { name: "speech.mp3", kind: "audio", text: "Le rendez-vous est vendredi à dix heures.", textTruncated: false, note: "Transcription automatique." }];
  const result = inspect(assistantMessagesWithFiles([{ role: "user", content: "Résume les fichiers et la note vocale." }], files));
  assert.equal(result.imageCount, 6); assert.equal(result.metadata.length, 4);
  assert.equal(result.metadata[2].sentVisualCount, 1); assert.equal(result.metadata[2].videoPreviewTimestampUnknown, true);
  assert.deepEqual(result.metadata[2].sentVideoFrameTimesSeconds, []); assert.equal(result.metadata[2].omittedVideoFrameCount, 0);
  assert.equal(result.metadata[3].excerpt, files[3].text); assert.equal(result.metadata[3].sentVisualCount, undefined);
  assert.equal(result.timestamps.has(3), false);
});

test("omitted frames still undergo validation before a request can be built", async () => {
  const image = await preview(), files = [1, 2, 3, 4].map(index => video(index, image));
  files[3].frames![2].image = Buffer.from("invalid JPEG").toString("base64");
  assert.throws(() => assistantMessagesWithFiles([{ role: "user", content: "Compare les vidéos." }], files), /Invalid assistant video frame/);
});

test("adaptive four-to-six visual limits preserve every clip and every transcript with exact new coverage", async () => {
  const image = await preview(), files = [1, 2, 3, 4].map(index => video(index, image));
  const before = JSON.stringify(files), user = [{ role: "user" as const, content: "Compare ces clips, sans aucune publication." }];
  let previousBudget = Infinity;
  for (const maxVisuals of [6, 5, 4]) {
    const messages = assistantMessagesWithFiles(user, files, { maxVisuals });
    const result = inspect(messages);
    assert.equal(result.imageCount, maxVisuals);
    assert.deepEqual(result.metadata.map(file => file.sentVisualCount), maxVisuals === 6 ? [2, 2, 1, 1] : maxVisuals === 5 ? [2, 1, 1, 1] : [1, 1, 1, 1]);
    for (const [index, metadata] of result.metadata.entries()) {
      assert.equal(metadata.sentVideoFrameTimesSeconds?.[0], 30);
      assert.deepEqual(metadata.sentVideoFrameTimesSeconds, result.timestamps.get(index + 1));
      assert.equal(metadata.omittedVideoFrameCount, 3 - metadata.sentVideoFrameTimesSeconds!.length);
      assert.equal(metadata.excerpt, files[index].text);
    }
    const latest = messages.at(-1)!; assert.ok(Array.isArray(latest.content));
    assert.equal(latest.content[0].type, "text"); assert.equal(latest.content[0].text, user[0].content);
    const constraints = latest.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    assert.match(constraints, /borne d’extraction\/transcription ne prouve pas que le son ou la parole s’arrête/);
    assert.match(constraints, /images ponctuelles ne prouvent ni mouvement continu, ni instant de transition/);
    const budget = assistantModelInputBudget(messages); assert.ok(budget < previousBudget); previousBudget = budget;
    assert.match(JSON.stringify(messages), new RegExp(`Au maximum ${maxVisuals} visuels`));
    assert.equal(JSON.stringify(files), before);
  }
  for (const maxVisuals of [0, 3, 7, 4.5, NaN]) assert.throws(() => assistantMessagesWithFiles(user, files, { maxVisuals }), /Invalid assistant visual budget/);
});
