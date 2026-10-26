import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createInrAssistantMemory, INR_ASSISTANT_MEMORY_MAX_REPLY_CHARS } from "@/lib/inrAssistantMemory";
import { recordCurrentAccountDiagnosticError, runWithAccountDiagnosticContext } from "@/lib/observability/accountDiagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Message = { role: "user" | "assistant"; content: string; turnId?: string };

export async function GET(request: Request) {
  const requestId = randomUUID();
  return runWithAccountDiagnosticContext({ route: "/api/assistant/history", requestId }, () => respond(request, requestId));
}

async function respond(request: Request, requestId: string) {
  const headers = { "Cache-Control": "no-store, private", "X-Request-Id": requestId };
  const auth = await requireUser();
  if (auth.errorResponse) {
    for (const [name, value] of Object.entries(headers)) auth.errorResponse.headers.set(name, value);
    return auth.errorResponse;
  }
  const rawIds = new URL(request.url).searchParams.getAll("conversationId");
  if (rawIds.length > 1 || (rawIds.length === 1 && !CONVERSATION_ID.test(rawIds[0]))) {
    return NextResponse.json({ error: "Identifiant de discussion invalide.", code: "assistant_memory_invalid_request", requestId }, { status: 400, headers });
  }
  const requestedId = rawIds[0]?.toLowerCase();
  const provenance = { accountId: auth.activeUserId, requestId };
  const unavailable = () => NextResponse.json({ ...provenance, available: false, conversations: [], conversation: null, truncated: false }, { headers });
  try {
    // Actor and establishment are separate authenticated identities. Query
    // parameters never select scope, edition, SQL, a provider or a model.
    const memory = createInrAssistantMemory({ supabase: auth.supabase, accountId: auth.activeUserId, actorUserId: auth.authUserId });
    const listing = await memory.listConversations({ limit: 20 });
    if (!listing.available) return unavailable();
    const selectedId = requestedId ?? listing.conversations[0]?.id;
    if (!selectedId) return NextResponse.json({ ...provenance, available: true, conversations: listing.conversations, conversation: null, truncated: listing.truncated }, { headers });
    const recent = await memory.loadRecent({ conversationId: selectedId, limit: 6 });
    if (!recent.available) return unavailable();
    const turns = recent.turns.slice(-6);
    const messages: Message[] = [];
    for (const turn of turns) {
      if (turn.conversationId !== selectedId) continue;
      messages.push({ role: "user", content: turn.userText.slice(0, 4_000), turnId: turn.turnId });
      // A failed or running generation never becomes an invented answer,
      // including when a partial assistant text happened to be stored.
      if (turn.status === "completed" && turn.assistantText?.trim()) {
        messages.push({ role: "assistant", content: turn.assistantText.slice(0, INR_ASSISTANT_MEMORY_MAX_REPLY_CHARS) });
      }
    }
    const lastTurn = turns.at(-1), lastMessage = messages.at(-1);
    const pendingTurn = lastTurn && lastTurn.conversationId === selectedId && lastTurn.status !== "completed"
      && lastMessage?.role === "user" && lastMessage.turnId === lastTurn.turnId ? { turnId: lastTurn.turnId } : undefined;
    return NextResponse.json({ ...provenance, available: true, conversations: listing.conversations,
      conversation: messages.length ? { id: selectedId, messages, ...(pendingTurn ? { pendingTurn } : {}) } : null,
      truncated: listing.truncated || recent.truncated,
    }, { headers });
  } catch {
    await recordCurrentAccountDiagnosticError(503, "assistant_history_unavailable");
    return NextResponse.json({ error: "L’historique est momentanément indisponible. Merci de réessayer.", code: "assistant_history_unavailable", requestId }, { status: 503, headers });
  }
}
