import type { InrAssistantClientScreen } from "./inrAssistantClientContext.ts";
import { inrAssistantAgentSettingsTarget } from "./inrAssistantAgentSettingsUi.ts";
import { getInrAssistantLocalInterfaceHints, runInrAssistantLocalInterface } from "./inrAssistantLocalInterface.ts";
import { parseInrAssistantUiPostScreen, type InrAssistantUiPostScreen } from "./inrAssistantUiPostScreen.ts";

/** Completes only the finite navigation's native panel. No UI ACK is returned
 * until its scoped callback and the matching committed screen are observable. */
export async function openInrAssistantAgentSettingsAfterNavigation(destination: string, scope: { accountId: string; actorUserId: string; pathname: string }, screen: () => InrAssistantClientScreen | undefined, stillCurrent: () => boolean, timeoutMs = 5000): Promise<InrAssistantUiPostScreen | null> {
  const target = inrAssistantAgentSettingsTarget(destination);
  if (!target || target.pathname !== scope.pathname || !stillCurrent()) return null;
  // The caller guards the live route as well as actor/account. A closed panel
  // may have no screen override yet; only the final ACK needs that proof.
  const current = () => {
    if (!stillCurrent()) return false;
    const contextual = screen();
    return contextual === undefined || contextual.pathname === target.pathname;
  };
  const deadline = Date.now() + timeoutMs;
  let hint = getInrAssistantLocalInterfaceHints(scope)?.find(hint => hint.id === "agent_settings");
  while (!hint && current() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
    hint = getInrAssistantLocalInterfaceHints(scope)?.find(hint => hint.id === "agent_settings");
  }
  if (!hint || !current()) return null;
  if (hint.operations.includes("open")) {
    const applied = await runInrAssistantLocalInterface({ command: "control_local_interface", selection: { kind: "account_document", id: "agent_settings" }, revision: hint.revision, operation: "open", value: null }, scope, current);
    if (!applied || !current()) return null;
  } else if (!hint.operations.includes("close")) return null;
  while (current() && Date.now() <= deadline) {
    const visible = screen();
    const committed = visible?.agentSettings === target.agent && visible.selection?.id === `agent_${target.agent}`
      ? parseInrAssistantUiPostScreen(visible) : null;
    if (committed) return committed;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return null;
}
