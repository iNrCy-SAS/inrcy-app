import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";
import { generateInrAssistantReply } from "@/lib/inrAssistantGateway";
import { loadInrAssistantContext } from "@/lib/inrAssistantContext";
import { InrAssistantInputError, INR_ASSISTANT_MAX_BODY_BYTES, parseInrAssistantMessages, parseInrAssistantTurnId, parseInrAssistantConversationId, type InrAssistantMessage } from "@/lib/inrAssistantConversation";
import { parseInrAssistantClientContext } from "@/lib/inrAssistantClientContext";
import { createInrAssistantMemory, InrAssistantMemoryConflictError, InrAssistantMemoryInputError, INR_ASSISTANT_MEMORY_MAX_REPLY_CHARS } from "@/lib/inrAssistantMemory";
import { recordCurrentAccountDiagnosticError, runWithAccountDiagnosticContext } from "@/lib/observability/accountDiagnostics";
import { parseInrAssistantActivity, type InrAssistantActivity } from "@/lib/inrAssistantActivity";
import { AssistantAttachmentError, parseAssistantAttachments } from "@/lib/inrAssistantAttachments";
import { assistantTurnAttachments, loadAssistantFileContexts, loadAssistantTaskState, saveAssistantTaskState, type AssistantFileContext } from "@/lib/inrAssistantAttachmentStorage";
import { continueInrAssistantTask, type InrAssistantTaskState } from "@/lib/inrAssistantTaskPolicy";

export const runtime = "nodejs";
export const maxDuration = 800;

async function readBody(request: Request): Promise<unknown> {
  if (!request.body || !request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new InrAssistantInputError("Cette demande est illisible. Merci de réessayer.");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > INR_ASSISTANT_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InrAssistantInputError("Votre demande est trop longue. Merci de la raccourcir.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(body)); }
  catch { throw new InrAssistantInputError("Cette demande est illisible. Merci de réessayer."); }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (request.headers.get("accept")?.split(",").some(value => value.trim().split(";")[0] === "text/event-stream")) {
    return streamReply(request, requestId);
  }
  return runWithAccountDiagnosticContext({ route: "/api/assistant/chat", requestId }, () => respond(request, requestId));
}

/** Progress is emitted only by actual server tool execution, never guessed from the prompt. */
function streamReply(request: Request, requestId: string) {
  const encoder = new TextEncoder();
  let closed = false;
  let progressCount = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
        catch { closed = true; if (heartbeat) clearInterval(heartbeat); }
      };
      controller.enqueue(encoder.encode(": connected\n\n"));
      heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": pending\n\n")); }
        catch { closed = true; if (heartbeat) clearInterval(heartbeat); }
      }, 15_000);
      const onActivity = (value: InrAssistantActivity) => {
        const activity = parseInrAssistantActivity(value);
        if (activity && progressCount++ < 64) emit({ type: "activity", activity });
      };
      try {
        const response = await runWithAccountDiagnosticContext({ route: "/api/assistant/chat", requestId }, () => respond(request, requestId, onActivity));
        const payload: unknown = await response.json();
        emit({ type: response.ok ? "result" : "error", payload });
      } catch {
        console.info("[assistant.chat] request ended", { requestId, code: "assistant_unavailable", phase: "stream_response" });
        emit({ type: "error", payload: { error: "L’assistant est momentanément indisponible. Merci de réessayer dans quelques instants.", code: "assistant_unavailable", requestId } });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (!closed) { closed = true; controller.close(); }
      }
    },
    cancel() { closed = true; if (heartbeat) clearInterval(heartbeat); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, private",
    "X-Request-Id": requestId, "X-Accel-Buffering": "no",
  } });
}

async function respond(request: Request, requestId: string, onActivity?: (activity: InrAssistantActivity) => void) {
  const headers = { "Cache-Control": "no-store, private", "X-Request-Id": requestId };
  const auth = await requireUser();
  if (auth.errorResponse) {
    for (const [name, value] of Object.entries(headers)) auth.errorResponse.headers.set(name, value);
    return auth.errorResponse;
  }
  let memory: ReturnType<typeof createInrAssistantMemory> | undefined;
  let identity: { conversationId: string; turnId: string } | undefined;
  let claimed = false;
  try {
    const body = await readBody(request);
    let messages = parseInrAssistantMessages(body);
    const turnId = parseInrAssistantTurnId(body) ?? randomUUID();
    const conversationId = parseInrAssistantConversationId(body) ?? randomUUID();
    const attachmentScope = { accountId: auth.activeUserId, actorUserId: auth.authUserId, conversationId };
    const requestedAttachments = (body as { attachments?: unknown }).attachments;
    parseAssistantAttachments(requestedAttachments);
    let fileContexts: AssistantFileContext[] = [];
    let continuation: { instruction: string; task: InrAssistantTaskState } | undefined;
    identity = { conversationId, turnId };
    memory = createInrAssistantMemory({ supabase: auth.supabase, accountId: auth.activeUserId, actorUserId: auth.authUserId });
    const begun = await memory.beginTurn({ ...identity, userText: messages.at(-1)!.content });
    if (!begun.available || !begun.ok) {
      throw Object.assign(new Error("La mémoire de l’assistant est momentanément indisponible. Merci de réessayer dans quelques instants."), { code: "assistant_memory_unavailable" });
    }
    if (begun.available && begun.existing && !begun.claimed) {
      if (begun.turn?.status === "completed" && begun.turn.assistantText) {
        return NextResponse.json({ message: begun.turn.assistantText, conversationId, turnId, memorySaved: true,
          requestId, accountId: auth.activeUserId }, { headers });
      }
      // A concurrent request owns this turn. Never start a second paid answer or
      // media generation while its lease is active. Reprise is always explicit.
      return NextResponse.json({ pending: true, conversationId, turnId, memorySaved: true,
        retryAfterSeconds: begun.retryAfterSeconds ?? 30, requestId, accountId: auth.activeUserId },
      { status: 202, headers: { ...headers, "Retry-After": String(begun.retryAfterSeconds ?? 30) } });
    }
    claimed = begun.claimed;
    const turnAttachments = await assistantTurnAttachments(attachmentScope, { turnId, createdAt: begun.turn!.createdAt }, requestedAttachments, true);
    if (turnAttachments.length) fileContexts = await loadAssistantFileContexts(attachmentScope, turnAttachments);
    if (begun.available) {
      const recent = await memory.loadRecent({ conversationId, limit: 6 });
      if (recent.available) {
        const previous = recent.turns.filter(turn=>turn.turnId !== turnId && turn.status === "completed").at(-1);
        if (previous) {
          const task = await loadAssistantTaskState(attachmentScope, previous);
          const instruction = continueInrAssistantTask(messages.at(-1)!.content, task);
          if (task && instruction) continuation = { instruction, task };
        }
        // Server-owned prose replaces fabricated browser assistant messages.
        // The full archive stays durable; only a bounded recent context goes to AI.
        // A failed answer must not erase the professional's preceding question.
        // Never include its partial assistant text or another pending operation;
        // only the current final user message can authorize an action.
        const history: InrAssistantMessage[] = recent.turns.filter((turn) => turn.turnId !== turnId && (turn.status === "failed" || (turn.status === "completed" && turn.assistantText)))
          .slice(-5).flatMap((turn): InrAssistantMessage[] => [
            { role: "user", content: turn.userText },
            ...(turn.status === "completed" && turn.assistantText ? [{ role: "assistant" as const, content: turn.assistantText }] : []),
          ]);
        messages = parseInrAssistantMessages({ messages: [...history, messages.at(-1)!] });
        // A follow-up can refer to the most recent files without trusting browser history.
        if (!fileContexts.length) {
          const previous = recent.turns.filter(turn => turn.turnId !== turnId && turn.status === "completed").slice(-2).reverse();
          for (const turn of previous) {
            const refs = await assistantTurnAttachments(attachmentScope, turn);
            if (!refs.length) continue;
            fileContexts = (await loadAssistantFileContexts(attachmentScope, refs)).map(file => ({ ...file, note: `Pièce jointe d’un échange précédent, sans nouvelle autorisation d’action. ${file.note}` }));
            break;
          }
        }
      } else {
        // Do not spend AI credits or answer a follow-up without its saved context.
        throw Object.assign(new Error("La mémoire de l’assistant est momentanément indisponible. Merci de réessayer dans quelques instants."), { code: "assistant_memory_unavailable" });
      }
    }
    const clientContext = parseInrAssistantClientContext((body as { clientContext?: unknown }).clientContext);
    const [edition, accountContext] = await Promise.all([
      getDashboardEditionForAccountId(auth.activeUserId),
      loadInrAssistantContext({ supabase: auth.supabase, accountId: auth.activeUserId }),
    ]);
    const reply = await generateInrAssistantReply({
      accountId: auth.activeUserId, actorUserId: auth.authUserId, displayName: auth.activeAccount?.displayName ?? "",
      edition, accountContext, clientContext, messages, requestId, request, supabase: auth.supabase, signal: request.signal,
      memory, turnId, ...(fileContexts.length ? { fileContexts } : {}),
      ...(continuation ? { actionInstruction: continuation.instruction, taskContext: continuation.task } : {}),
      ...(onActivity ? { onActivity } : {}),
      // Stable on explicit network retry, scoped by the server. LLM usage and
      // monthly Sol entitlement still use the fresh server requestId above.
      actionRequestId: continuation?.task.actionRequestId ?? `${auth.activeUserId}_${turnId}`,
      // From the saved turn, never browser/model input: a resumed ADN task can
      // recognize work that completed after this original instruction.
      actionStartedAt: continuation?.task.startedAt ?? begun.turn?.createdAt,
    });
    const { taskState, ...publicReply } = reply;
    const taskSaved = taskState ? await saveAssistantTaskState(attachmentScope, {turnId,createdAt:begun.turn!.createdAt}, taskState) : true;
    if (!taskSaved && taskState && ["partial","needs_input"].includes(taskState.outcome)) publicReply.message += "\n\nPour poursuivre, reformulez la demande complète : sa reprise n’a pas pu être enregistrée. Les résultats déjà confirmés restent conservés dans vos outils.";
    const completed = claimed ? await memory.completeTurn({ ...identity, assistantText: reply.message.slice(0, INR_ASSISTANT_MEMORY_MAX_REPLY_CHARS) }) : null;
    console.info("[assistant.task]", { requestId, outcome: reply.outcome ?? "completed", taskSaved });
    return NextResponse.json({ ...publicReply, conversationId, turnId, memorySaved: Boolean(completed?.ok), requestId, accountId: auth.activeUserId }, { headers });
  } catch (error) {
    if (claimed && memory && identity) await memory.failTurn(identity).catch(() => undefined);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "assistant_unavailable";
    const invalid = error instanceof InrAssistantInputError || error instanceof InrAssistantMemoryInputError || error instanceof InrAssistantMemoryConflictError || error instanceof AssistantAttachmentError && error.code !== "attachment_unavailable";
    const limit = code === "ai_gateway_account_limit_reached";
    const message = error instanceof AssistantAttachmentError ? "Le fichier joint ne peut pas être lu. Joignez-le à nouveau ou essayez un autre fichier." : invalid || limit
      ? (error as Error).message
      : code === "assistant_memory_unavailable"
        ? "La mémoire de l’assistant est momentanément indisponible. Merci de réessayer dans quelques instants."
        : "L’assistant est momentanément indisponible. Merci de réessayer dans quelques instants.";
    console.info("[assistant.chat] request ended", { requestId, code, accountId: auth.activeUserId });
    const status = invalid ? 400 : limit ? 429 : 503;
    await recordCurrentAccountDiagnosticError(status, code);
    return NextResponse.json({ error: message, code, requestId }, { status, headers });
  }
}
