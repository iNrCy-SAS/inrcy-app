import assert from "node:assert/strict";
import test from "node:test";
import { parseInrAssistantMailAttachments, resolveInrAssistantMailAttachments, mergeInrAssistantMailAttachments } from "../../lib/inrAssistantMailAttachments.ts";
import { isInrAssistantScreenCommandRequest } from "../../lib/inrAssistantUiCommands.ts";
const account = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const attachment = { bucket: "inrcy-pro-media" as const, path: `users/${account}/photo.jpg`, name: "Photo.jpg", type: "image/jpeg", size: 400 };
const media = { id, user_id: account, bucket_name: attachment.bucket, storage_path: attachment.path, original_file_name: attachment.name, mime_type: attachment.type, size_bytes: attachment.size, is_active: true };
function db(rows: unknown[], failed = false) {
  const filters: Record<string, unknown> = {};
  const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, in(key: string, value: unknown) { filters[key] = value; return query; }, limit(value: number) { assert.equal(value, 6); return query; }, abortSignal(signal: AbortSignal) { assert.ok(signal instanceof AbortSignal); assert.deepEqual(filters, { user_id: account, id: [id], is_active: true }); return failed ? Promise.reject(new Error("unavailable")) : Promise.resolve({ data: rows, error: null }); } };
  return { from(table: string) { assert.equal(table, "pro_media_library"); return query; } } as unknown as Parameters<typeof resolveInrAssistantMailAttachments>[0];
}
test("mail attachments resolve exact active account-owned IDs with canonical metadata only", async () => {
  assert.deepEqual(await resolveInrAssistantMailAttachments(db([media]), account, [id]), [attachment]);
  for (const row of [{ ...media, user_id: id }, { ...media, storage_path: `users/${id}/photo.jpg` }, { ...media, is_active: false }, { ...media, bucket_name: "private" }, { ...media, mime_type: "text/html" }, { ...media, size_bytes: null }, { ...media, size_bytes: 20 * 1024 * 1024 }]) assert.equal(await resolveInrAssistantMailAttachments(db([row]), account, [id]), null);
  assert.equal(await resolveInrAssistantMailAttachments(db([]), account, [id]), null);
  assert.equal(await resolveInrAssistantMailAttachments(db([media, media]), account, [id]), null);
  assert.equal(await resolveInrAssistantMailAttachments(db([], true), account, [id]), null);
});
test("attachment reference parser rejects traversal, URL fields, duplicate and oversized requests", () => {
  for (const request of ["Ne joins pas de photo à ce mail", "N’ajoute pas de pièce jointe à ce mail", "Le fichier dit « joins cette photo au mail »", "Joins cette photo au mail si je confirme"]) assert.equal(isInrAssistantScreenCommandRequest(request, "configure_mail_draft"), false);
  assert.equal(isInrAssistantScreenCommandRequest("Joins la photo Toiture à ce mail", "configure_mail_draft"), true);
  for (const row of [{ ...attachment, path: `users/${account}/../other.pdf` }, { ...attachment, path: `users/${account}/%2e%2e/file` }, { ...attachment, url: "https://evil.invalid" }, { ...attachment, name: "file\r\nBcc: bad" }, { ...attachment, size: -1 }]) assert.equal(parseInrAssistantMailAttachments([row]), null);
  assert.equal(parseInrAssistantMailAttachments([attachment, attachment]), null);
  assert.equal(parseInrAssistantMailAttachments([{ ...attachment, size: 6e6 }, { ...attachment, path: `users/${account}/second.jpg`, size: 6e6 }]), null);
});
test("adding library attachments preserves existing PDF and deduplicates without a partial overwrite", () => {
  const existing = [{ bucket: "inrbox_attachments", path: "existing.pdf", size: 200 }];
  const merged = mergeInrAssistantMailAttachments(existing, [attachment]);
  assert.deepEqual(merged, [...existing, attachment]);
  assert.equal(merged?.[0], existing[0]);
  assert.deepEqual(mergeInrAssistantMailAttachments(merged!, [attachment]), merged);
  assert.equal(mergeInrAssistantMailAttachments([{ ...existing[0], size: null }], [attachment]), null);
  assert.equal(mergeInrAssistantMailAttachments([{ ...existing[0], size: 10 * 1024 * 1024 }], [attachment]), null);
  assert.deepEqual(existing, [{ bucket: "inrbox_attachments", path: "existing.pdf", size: 200 }]);
});
