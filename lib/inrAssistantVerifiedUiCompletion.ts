import { parseInrAssistantClientContext, type InrAssistantClientContext } from "./inrAssistantClientContext.ts";
import { inrAssistantClauseIsAdvice, inrAssistantRequestClauses, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";
import { inrAssistantUiSuccessStatus } from "./inrAssistantUiActions.ts";
import { inrAssistantUiPostScreenMatchesAction } from "./inrAssistantUiPostScreen.ts";
import { inrAssistantUiStepAcceptsAction, isInrAssistantUiTaskTool, parseInrAssistantUiSteps, type InrAssistantUiStep, type InrAssistantUiStepResult } from "./inrAssistantUiTask.ts";

export type InrAssistantVerifiedUiCompletionInput = {
  instruction: string;
  uiSteps: InrAssistantUiStep[];
  /** Only results loaded by the existing scoped, immutable server readers.
   * This helper neither authenticates a caller nor accepts HTTP-body ACKs. */
  verifiedResults: InrAssistantUiStepResult[];
  clientContext?: InrAssistantClientContext | null;
  requiredTools: readonly string[];
  objectives: ReadonlyArray<{ kind: string }>;
  receipts: ReadonlyArray<{ tool: string }>;
  /** Files, advice, human support or another independent requested result. */
  hasIndependentWork: boolean;
};

/** A display projection of already verified browser work, never a new business
 * receipt or authority to open, send, save, publish or retry anything. */
export function verifiedInrAssistantUiCompletion(input: InrAssistantVerifiedUiCompletionInput): { message: string; completed: string[] } | null {
  if (input.hasIndependentWork || input.requiredTools.some(tool => !isInrAssistantUiTaskTool(tool))
    || input.objectives.some(objective => objective.kind !== "ui")
    || input.receipts.some(receipt => !isInrAssistantUiTaskTool(receipt.tool))) return null;
  const clauses = inrAssistantRequestClauses(input.instruction);
  const text = inrAssistantUnquotedRequest(input.instruction);
  // An extra question may share a routing clause with an imperative. Do not
  // turn an opening/filter ACK into an answer to that independent request.
  if (/[?？]/u.test(text) || clauses.some(inrAssistantClauseIsAdvice)
    || /\b(?:explique\w*|compar\w*|analys\w*|diagnosti\w*|conseill\w*|recommand\w*|resum\w*|tradui\w*|calcul\w*|combien|pourquoi|comment|quels?|quelles?|pourrais.je|dois.je|why|what|how|which|explain|compare|analy[sz]e|translate|calculate|recommend)\b/u.test(text)) return null;
  const steps = parseInrAssistantUiSteps(input.uiSteps);
  const current = parseInrAssistantClientContext(input.clientContext)?.screen;
  if (!steps?.length || clauses.length !== steps.length || !current?.selection || !current.revision || current.pendingChanges
    || input.verifiedResults.length !== steps.length || new Set(input.verifiedResults.map(result => result.stepId)).size !== steps.length) return null;
  const actionIds = new Set<string>();
  for (const [index, step] of steps.entries()) {
    const stepClauses = inrAssistantRequestClauses(step.instruction);
    const result = input.verifiedResults.find(result => result.stepId === step.id);
    const lastAction = step.actions?.at(-1);
    if (step.id !== `ui_${index}` || stepClauses.length !== 1 || stepClauses[0] !== clauses[index]
      || !step.source || !step.actions?.length || !lastAction || result?.status !== "applied" || !result.postScreen
      || !inrAssistantUiPostScreenMatchesAction(lastAction, result.postScreen)) return null;
    for (const action of step.actions) {
      // A handoff (download/link) is not an applied screen change.
      const identity = `${step.source.turnId}:${step.source.createdAt}:${action.id}`;
      if (actionIds.has(identity) || !inrAssistantUiStepAcceptsAction(step, action) || inrAssistantUiSuccessStatus(action) !== "applied") return null;
      actionIds.add(identity);
    }
  }
  const finalScreen = input.verifiedResults.find(result => result.stepId === steps.at(-1)!.id)!.postScreen!;
  if (current.pathname !== finalScreen.pathname || current.revision !== finalScreen.revision
    || current.agentSettings !== finalScreen.agentSettings
    || current.selection.kind !== finalScreen.selection.kind || current.selection.id !== finalScreen.selection.id
    || JSON.stringify(current.documentPrefill) !== JSON.stringify(finalScreen.documentPrefill)) return null;

  const actions = steps.flatMap(step => step.actions!);
  const libraryOpen = actions.length === 2 && actions[0].type === "navigate"
    && actions[0].navigation.destination === "media" && actions[0].navigation.href === "/dashboard/mediatheque";
  const last = actions.at(-1)!;
  const imagesOnly = last.type === "command" && last.command.command === "configure_media_library"
    && Object.keys(last.command.patch).length === 1 && last.command.patch.typeFilter === "image"
    && current.pathname === "/dashboard/mediatheque" && current.selection.kind === "media";
  if (libraryOpen && imagesOnly) return { message: "La médiathèque est ouverte et le filtre Type : Images est appliqué.", completed: ["ouvrir la médiathèque", "appliquer le filtre Type : Images"] };
  return { message: `${steps.length} étape${steps.length > 1 ? "s" : ""} d’écran confirmée${steps.length > 1 ? "s" : ""} par le navigateur.`, completed: steps.map(() => "confirmer l’étape d’écran dans le navigateur") };
}
