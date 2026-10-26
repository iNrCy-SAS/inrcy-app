import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { ASSISTANT_ATTACHMENT_MAX_COUNT, ASSISTANT_ATTACHMENT_TOTAL_BYTES, ASSISTANT_ATTACHMENT_UUID, AssistantAttachmentError, assistantAttachmentFile, parseAssistantAttachments } from "@/lib/inrAssistantAttachments";
import { attachAssistantLibraryItem, finalizeAssistantAttachment, prepareAssistantAttachment } from "@/lib/inrAssistantAttachmentStorage";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store, private" };
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const limited = await enforceRateLimit({ name: "assistant_attachments", identifier: auth.activeUserId, limit: 90, window: "1 h", failClosed: true });
  if (limited) return limited;
  try {
    if (!request.headers.get("content-type")?.includes("application/json") || !request.body) throw new AssistantAttachmentError("attachment_invalid");
    const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 16000) { await reader.cancel(); throw new AssistantAttachmentError("attachment_limit"); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    if (typeof body.conversationId !== "string" || !ASSISTANT_ATTACHMENT_UUID.test(body.conversationId)) throw new AssistantAttachmentError("attachment_invalid");
    const scope = { accountId: auth.activeUserId, actorUserId: auth.authUserId, conversationId: body.conversationId };
    if (body.action === "prepare") {
      if (!Array.isArray(body.files) || !body.files.length || body.files.length > ASSISTANT_ATTACHMENT_MAX_COUNT) throw new AssistantAttachmentError("attachment_limit");
      const files = body.files.map((file: unknown) => assistantAttachmentFile(file && typeof file === "object" ? file : {}));
      if (files.reduce((sum: number, file: { size: number }) => sum + file.size, 0) > ASSISTANT_ATTACHMENT_TOTAL_BYTES) throw new AssistantAttachmentError("attachment_limit");
      const prepared = [];
      for (const file of files) prepared.push(await prepareAssistantAttachment(scope, file));
      return NextResponse.json({ accountId: scope.accountId, prepared }, { headers });
    }
    if (body.action === "finalize") {
      const refs = parseAssistantAttachments([body.attachment]);
      const attachment = await finalizeAssistantAttachment(scope, refs[0]);
      return NextResponse.json({ accountId: scope.accountId, attachments: [attachment] }, { headers });
    }
    if (body.action === "library") {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > ASSISTANT_ATTACHMENT_MAX_COUNT || new Set(body.ids).size !== body.ids.length) throw new AssistantAttachmentError("attachment_limit");
      const attachments = [];
      let remainingBytes = ASSISTANT_ATTACHMENT_TOTAL_BYTES;
      for (const id of body.ids) {
        const attachment = await attachAssistantLibraryItem(scope, auth.supabase, id, remainingBytes);
        attachments.push(attachment); remainingBytes -= attachment.size;
      }
      parseAssistantAttachments(attachments);
      return NextResponse.json({ accountId: scope.accountId, attachments }, { headers });
    }
    throw new AssistantAttachmentError("attachment_invalid");
  } catch (error) {
    const code = error instanceof AssistantAttachmentError ? error.code : "attachment_unavailable";
    return NextResponse.json({ code, error: "Le fichier n’a pas pu être joint. Vérifiez son format et sa taille, puis réessayez." }, { status: code === "attachment_unavailable" ? 503 : 400, headers });
  }
}
