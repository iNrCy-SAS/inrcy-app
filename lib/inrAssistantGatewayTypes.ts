import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardEdition } from "./dashboardEdition.ts";
import type { InrAssistantMessage } from "./inrAssistantConversation.ts";
import type { InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import type { InrAssistantMemoryReader } from "./inrAssistantMemoryTools.ts";
import type { InrAssistantActivityCallback } from "./inrAssistantActivity.ts";
import type { AssistantFileContext } from "./inrAssistantAttachmentStorage.ts";
import type { createInrAssistantMediaLibraryTools } from "./inrAssistantMediaLibraryTools.ts";
import type { InrAssistantMediaResult } from "./inrAssistantMediaTools.ts";
import type { InrAssistantStudioDraft } from "./inrAssistantStudioDraft.ts";
import type { InrAssistantTaskState, InrAssistantTaskOutcome } from "./inrAssistantTaskPolicy.ts";
import type { InrAssistantNavigation, InrAssistantUiCommand } from "./inrAssistantUiCommands.ts";
import type { InrAssistantUiAction } from "./inrAssistantUiActions.ts";

export type InrAssistantReply = { message: string; needsHuman?: boolean; handoffSummary?: string; media?: InrAssistantMediaResult; studioDraft?: InrAssistantStudioDraft; insertStudioDraft?: boolean; outcome?: InrAssistantTaskOutcome; taskState?: InrAssistantTaskState; navigation?: InrAssistantNavigation; uiCommand?:InrAssistantUiCommand; uiActions?: InrAssistantUiAction[]; taskProgress?: { outcome:InrAssistantTaskOutcome; completed:string[]; remaining:string[] } };

/** Server-resolved request scope shared by the gateway and its tool registry. */
export type InrAssistantGatewayArgs = {
  accountId: string;
  actorUserId?: string;
  displayName: string;
  edition: DashboardEdition;
  requestId: string;
  actionRequestId?: string;
  actionStartedAt?: string;
  request: Request;
  messages: InrAssistantMessage[];
  accountContext?: unknown;
  clientContext?: InrAssistantClientContext | null;
  memory?: InrAssistantMemoryReader;
  turnId?: string;
  supabase?: Pick<SupabaseClient, "from">;
  signal?: AbortSignal;
  onActivity?: InrAssistantActivityCallback;
  fileContexts?: AssistantFileContext[];
  mediaAttachments?: NonNullable<Parameters<typeof createInrAssistantMediaLibraryTools>[0]["mediaAttachments"]>;
  resolveMediaAttachment?: Parameters<typeof createInrAssistantMediaLibraryTools>[0]["resolveMediaAttachment"];
  claimMediaAttachmentImport?: Parameters<typeof createInrAssistantMediaLibraryTools>[0]["claimMediaAttachmentImport"];
  /** Server-resolved pending task only, never an HTTP body field. */
  actionInstruction?: string;
  taskContext?: InrAssistantTaskState;
  taskIntent?: "continue" | "check_status";
  onTaskCheckpoint?: (state: InrAssistantTaskState) => Promise<void>;
};
