import { isInrAssistantBusinessRichTextRequest, parseInrAssistantBusinessRichTextEdit, INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES, type InrAssistantBusinessRichTextField } from "./inrAssistantBusinessRichText.ts";
import { isInrAssistantLocalInterfaceRequest } from "./inrAssistantLocalInterface.ts";
import { INR_ASSISTANT_ACCOUNT_UI_COMMANDS, type InrAssistantAccountUiCommandName } from "./inrAssistantAccountUiIntent.ts";
import { inrAssistantNavigationForm } from "./inrAssistantNavigationForm.ts";
import { parseInrAssistantClientContext, type InrAssistantClientContext, type InrAssistantClientScreen } from "./inrAssistantClientContext.ts";
import { getDirectInrAssistantNavigationRequest, isInrAssistantScreenCommandRequest } from "./inrAssistantUiCommands.ts";
import { parseInrAssistantUiActions, inrAssistantUiSuccessStatus, type InrAssistantUiAction, type InrAssistantUiResult } from "./inrAssistantUiActions.ts";
import { inrAssistantMaskQuotedText, inrAssistantRequestClauses } from "./inrAssistantRequestClauses.ts";
import { matchesInrAssistantActionClause } from "./inrAssistantActionClause.ts";
import { inrAssistantUiPostScreenMatchesAction, type InrAssistantUiPostScreen } from "./inrAssistantUiPostScreen.ts";
import { isInrAssistantDocumentPrefillInstruction } from "./inrAssistantDocumentUiCommands.ts";
import { isInrAssistantNotificationActionRequest } from "./inrAssistantNotificationNavigation.ts";
import { isInrAssistantResumePublicationDraftRequest } from "./inrAssistantSendPublicationIntent.ts";

type ScreenCommand = NonNullable<InrAssistantClientScreen["availableCommands"]>[number] | InrAssistantAccountUiCommandName;
export const INR_ASSISTANT_UI_TASK_TOOLS = ["openNotificationAction", "resumePublicationDraft", "refreshBadgeThemeFromLogo", "navigateApplication", "runScreenCommand", "prepareCommercialDocumentForm", "prepareCurrentDocumentTemplate", "prepareAccountDocumentDownload", "configureCookieConsent", "configureApplicationPreferences", "controlLocalInterface", "formatBusinessDnaText", "submitContentReport"] as const;
export function isInrAssistantUiTaskTool(name: string): boolean {
  return INR_ASSISTANT_UI_TASK_TOOLS.some(tool => tool === name);
}
export function inrAssistantUiStepTool(step: InrAssistantUiStep): typeof INR_ASSISTANT_UI_TASK_TOOLS[number] {
  if (step.command === "download_account_export" || step.command === "download_subscription_invoice" || step.command === "open_subscription_invoice_link") return "prepareAccountDocumentDownload";
  if (step.command === "openNotificationAction") return "openNotificationAction";
  if (step.command === "navigateApplication" && isInrAssistantResumePublicationDraftRequest(step.instruction)) return "resumePublicationDraft";
  if (step.command === "refresh_badge_theme_from_logo") return "refreshBadgeThemeFromLogo";
  if (step.command === "submit_content_report") return "submitContentReport";
  if (step.command === "control_local_interface") return isInrAssistantBusinessRichTextRequest(step.instruction) ? "formatBusinessDnaText" : "controlLocalInterface";
  if (step.command === "configure_application_preferences") return "configureApplicationPreferences";
  if (step.command === "configure_cookie_consent") return "configureCookieConsent";
  if (step.command === "create_document_template") return "prepareCurrentDocumentTemplate";
  return step.command === "navigateApplication" || step.command === "prepareCommercialDocumentForm" ? step.command : "runScreenCommand";
}

/** Private plan bookkeeping. Browser reports never become business receipts. */
export type InrAssistantUiStep = {
  id: string;
  instruction: string;
  command: ScreenCommand | "navigateApplication" | "prepareCommercialDocumentForm" | "openNotificationAction";
  /** A known native transition supplies this next form only after its verified ACK. */
  afterStepId?: string;
  screen?: InrAssistantClientScreen;
  actions?: InrAssistantUiAction[];
  source?: { turnId: string; createdAt: string };
};
export type InrAssistantUiStepResult = { stepId: string; status: "applied" | "pending" | "failed" | "cancelled"; postScreen?: InrAssistantUiPostScreen };
const followupCapabilities: Partial<Record<InrAssistantUiStep["command"], ScreenCommand[]>> = {
  generate_website_widget_code: ["show_website_widget_code", "copy_website_widget_code"],
  select_image_source: ["configure_image_retouch", "reset_image_retouch", "save_image_retouch"],
  configure_image_retouch: ["reset_image_retouch", "save_image_retouch"],
  reset_image_retouch: ["configure_image_retouch", "save_image_retouch"],
  select_video_source: ["configure_video_retouch", "save_video_retouch"],
  configure_video_retouch: ["save_video_retouch"],
  configure_ads_draft: ["save_ads_draft"],
  configure_mail_draft: ["save_mail_draft", "send_mail_draft", "open_mail_schedule"],
  save_mail_draft: ["configure_mail_draft", "send_mail_draft", "open_mail_schedule"],
};
const transitionCapabilities: Partial<Record<InrAssistantUiStep["command"], ScreenCommand[]>> = {
  prepare_document_mail: ["configure_mail_draft", "save_mail_draft", "send_mail_draft", "open_mail_schedule"],
  prepareCommercialDocumentForm: ["export_document_pdf", "create_document_template"],
};
function transitions(step: InrAssistantUiStep): readonly string[] | undefined {
  return step.command === "navigateApplication" ? inrAssistantNavigationForm(getDirectInrAssistantNavigationRequest(step.instruction)?.destination ?? "")?.commands : transitionCapabilities[step.command];
}
const documentFormRequest = (message: string) => isInrAssistantDocumentPrefillInstruction(message, "convert_quote") || isInrAssistantDocumentPrefillInstruction(message, "apply_template");
/** Recover original field bytes using the same masked clause order, never treat
 * quoted values as new instructions. Offsets also retain decomposed accents. */
function originalUiClauses(message: string, clauses: string[]): Array<string | undefined> {
  const masked = inrAssistantMaskQuotedText(message), offsets: number[] = []; let normalized = "", offset = 0;
  for (const character of masked) {
    const chunk = character.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").toLowerCase();
    for (let index = 0; index < chunk.length; index++) offsets.push(offset);
    normalized += chunk; offset += character.length;
  }
  let cursor = 0;
  const starts = clauses.map(clause => { const found = normalized.indexOf(clause, cursor); if (found < 0) return undefined; cursor = found + clause.length; return offsets[found]; });
  return starts.map((start, index) => start === undefined || index < starts.length - 1 && starts[index + 1] === undefined ? undefined : message.slice(start, starts[index + 1] ?? message.length).replace(/\s+(?:et\s+puis|et|puis|ensuite|and\s+then|and|then)\s*$/iu, "").trim());
}

export function inrAssistantUiStepAcceptsAction(step: InrAssistantUiStep, action: InrAssistantUiAction): boolean {
  if (step.command === "openNotificationAction") return action.type === "navigate" && Boolean(action.navigation.notificationId) && isInrAssistantNotificationActionRequest(step.instruction);
  if (step.command === "navigateApplication" && isInrAssistantResumePublicationDraftRequest(step.instruction)) return action.type === "navigate" && Boolean(action.navigation.publicationDraftId);
  if (step.command === "prepareCommercialDocumentForm") return action.type === "navigate" && Boolean(action.navigation.documentPrefill
    && isInrAssistantDocumentPrefillInstruction(step.instruction, action.navigation.documentPrefill.operation));
  if (step.command === "control_local_interface" && isInrAssistantBusinessRichTextRequest(step.instruction)) {
    if (action.type !== "command" || action.command.command !== "control_local_interface" || action.command.operation !== "select" || !action.command.value) return false;
    const command = action.command;
    const field = (Object.keys(INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES) as InrAssistantBusinessRichTextField[]).find(field => INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES[field] === command.selection.id);
    try { const edit = parseInrAssistantBusinessRichTextEdit(JSON.parse(action.command.value)); return Boolean(field && edit && isInrAssistantBusinessRichTextRequest(step.instruction, field, edit)); } catch { return false; }
  }
  if (step.command === "control_local_interface") return action.type === "command" && action.command.command === "control_local_interface" && isInrAssistantLocalInterfaceRequest(step.instruction, action.command.selection.id, action.command.operation);
  return step.command === "navigateApplication" ? action.type === "navigate" : action.type === "command" && action.command.command === step.command;
}

/** Capabilities are parsed before matching; adding a native form command to the
 * context/parser and its detector also makes it eligible for ordered tracking. */
export function inrAssistantUiSteps(message: string, context?: InrAssistantClientContext | null): InrAssistantUiStep[] {
  let screen = parseInrAssistantClientContext(context)?.screen;
  const commands = new Set<ScreenCommand>(["export_document_pdf", ...INR_ASSISTANT_ACCOUNT_UI_COMMANDS]);
  let afterStepId: string | undefined;
  if (screen?.revision) for (const command of screen.availableCommands ?? []) commands.add(command);
  const clauses = inrAssistantRequestClauses(message), originals = originalUiClauses(message, clauses);
  return clauses.flatMap((instruction, index): InrAssistantUiStep[] => {
    const exactInstruction = originals[index] ?? instruction;
    if (isInrAssistantNotificationActionRequest(exactInstruction)) return [{ id: `ui_${index}`, instruction: exactInstruction, command: "openNotificationAction" }];
    if (isInrAssistantResumePublicationDraftRequest(exactInstruction)) return [{ id: `ui_${index}`, instruction: exactInstruction, command: "navigateApplication" }];
    if (isInrAssistantBusinessRichTextRequest(instruction)) return [{ id: `ui_${index}`, instruction: exactInstruction, command: "control_local_interface" }];
    if (documentFormRequest(instruction) && matchesInrAssistantActionClause(message, message, documentFormRequest)) {
      const step: InrAssistantUiStep = { id: `ui_${index}`, instruction, command: "prepareCommercialDocumentForm" };
      commands.clear(); INR_ASSISTANT_ACCOUNT_UI_COMMANDS.forEach(command => commands.add(command)); transitionCapabilities.prepareCommercialDocumentForm!.forEach(command => commands.add(command));
      screen = undefined; afterStepId = step.id;
      return [step];
    }
    const command = [...commands].find(value => isInrAssistantScreenCommandRequest(instruction, value)
      && matchesInrAssistantActionClause(message, message, candidate => inrAssistantRequestClauses(candidate).some(clause => isInrAssistantScreenCommandRequest(clause, value))));
    if (!command) {
      const navigation = getDirectInrAssistantNavigationRequest(instruction);
      if (!navigation || !matchesInrAssistantActionClause(message, message, () => true)) return [];
      const step: InrAssistantUiStep = {id:`ui_${index}`,instruction,command:"navigateApplication"};
      const following = transitions(step);
      if (following?.length) { commands.clear(); INR_ASSISTANT_ACCOUNT_UI_COMMANDS.forEach(command => commands.add(command)); following.forEach(command => commands.add(command as ScreenCommand)); screen = undefined; afterStepId = step.id; }
      return [step];
    }
    // A future native capability is planning only. It cannot execute until its
    // prerequisite is acknowledged and the mounted form actually advertises it.
    for (const following of followupCapabilities[command] ?? []) commands.add(following);
    const step: InrAssistantUiStep = { id: `ui_${index}`, instruction, command, ...(afterStepId && !INR_ASSISTANT_ACCOUNT_UI_COMMANDS.some(name => name === command) ? { afterStepId } : {}),
      ...(command !== "export_document_pdf" && !INR_ASSISTANT_ACCOUNT_UI_COMMANDS.some(name => name === command) && screen ? { screen: { ...screen, availableCommands: [command as NonNullable<InrAssistantClientScreen["availableCommands"]>[number]] } } : {}) };
    const transition = transitionCapabilities[command];
    if (transition) {
      commands.clear(); INR_ASSISTANT_ACCOUNT_UI_COMMANDS.forEach(command => commands.add(command)); transition.forEach(command => commands.add(command));
      screen = undefined; afterStepId = step.id;
    }
    return [step];
  });
}

export function parseInrAssistantUiSteps(value: unknown): InrAssistantUiStep[] | null {
  if (!Array.isArray(value) || value.length > 24 || JSON.stringify(value).length > 24_000) return null;
  const parsed: InrAssistantUiStep[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const step = raw as InrAssistantUiStep;
    if (typeof step.id !== "string" || !/^ui_\d{1,2}$/.test(step.id) || parsed.some(item => item.id === step.id) || typeof step.instruction !== "string" || !step.instruction || step.instruction.length > (step.command === "control_local_interface" && isInrAssistantBusinessRichTextRequest(step.instruction) ? 6200 : 4000)) return null;
    const screen = step.screen === undefined ? undefined : parseInrAssistantClientContext({ screen: step.screen })?.screen;
    if (step.screen !== undefined && !screen) return null;
    const origin = step.afterStepId === undefined ? undefined : parsed.find(previous => previous.id === step.afterStepId);
    if (step.afterStepId !== undefined && (!origin || !transitions(origin)?.some(command => command === step.command))) return null;
    if (!["export_document_pdf", "navigateApplication", "prepareCommercialDocumentForm", "openNotificationAction", ...INR_ASSISTANT_ACCOUNT_UI_COMMANDS].includes(step.command) && (!screen?.revision || !screen.availableCommands?.some(command => command === step.command)) && !origin) return null;
    const richText = step.command === "control_local_interface" && isInrAssistantBusinessRichTextRequest(step.instruction);
    if (step.command === "navigateApplication" ? !getDirectInrAssistantNavigationRequest(step.instruction) && !isInrAssistantResumePublicationDraftRequest(step.instruction) : step.command === "openNotificationAction" ? !isInrAssistantNotificationActionRequest(step.instruction) : step.command === "prepareCommercialDocumentForm" ? !documentFormRequest(step.instruction) : !richText && !isInrAssistantScreenCommandRequest(step.instruction, step.command)) return null;
    const actions = step.actions === undefined ? undefined : parseInrAssistantUiActions(step.actions);
    if (step.actions !== undefined && (!actions?.length || !actions.some(action => inrAssistantUiStepAcceptsAction(step, action)) || origin && !screen)) return null;
    if (step.source && (!actions?.length || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(step.source.turnId) || !/^\d{4}-\d{2}-\d{2}T/.test(step.source.createdAt) || !Number.isFinite(Date.parse(step.source.createdAt)))) return null;
    parsed.push({ id: step.id, instruction: step.instruction, command: step.command, ...(step.afterStepId ? { afterStepId: step.afterStepId } : {}), ...(screen ? { screen } : {}), ...(actions ? { actions } : {}), ...(step.source ? { source: { ...step.source } } : {}) });
  }
  return parsed;
}

export function inrAssistantUiStepResult(step: InrAssistantUiStep, results: InrAssistantUiResult[]): InrAssistantUiStepResult {
  const failed = step.actions?.map(action => results.find(result => result.actionId === action.id)).find(result => result?.status === "failed" || result?.status === "cancelled");
  const complete = step.actions?.length && step.actions.every(action => results.some(result => result.actionId === action.id && result.status === inrAssistantUiSuccessStatus(action)));
  const lastAction = step.actions?.at(-1);
  const postScreen = complete && lastAction ? results.find(result => result.actionId === lastAction.id)?.postScreen : undefined;
  return { stepId: step.id, status: failed?.status === "cancelled" ? "cancelled" : failed ? "failed" : complete ? "applied" : "pending",
    ...(postScreen && lastAction && inrAssistantUiPostScreenMatchesAction(lastAction, postScreen) ? { postScreen } : {}) };
}

/** Continue may rebind only the next untouched form step to the exact revision
 * acknowledged by its preceding command. A manual intervening edit fails closed. */
export function rebindInrAssistantUiStep(steps: InrAssistantUiStep[], results: InrAssistantUiStepResult[], context?: InrAssistantClientContext | null): InrAssistantUiStep[] {
  const current = parseInrAssistantClientContext(context)?.screen;
  const nextIndex = steps.findIndex(step => !step.actions?.length);
  const next = steps[nextIndex];
  if (!next || !next.screen && !next.afterStepId || !current?.revision || !current.selection || !current.availableCommands?.some(command => command === next.command)) return steps;
  const previous = steps.slice(0, nextIndex).reverse().find(step => next.afterStepId
    ? step.id === next.afterStepId || step.afterStepId === next.afterStepId && step.source
    : step.screen?.pathname === next.screen!.pathname && step.screen.selection?.kind === next.screen!.selection?.kind && step.screen.selection?.id === next.screen!.selection?.id);
  if (!previous?.source) return steps;
  const result = results.find(result => result.stepId === previous.id && result.status === "applied");
  const acknowledged = result?.postScreen;
  if (!acknowledged || current.pathname !== acknowledged.pathname || current.revision !== acknowledged.revision
    || current.selection.kind !== acknowledged.selection.kind || current.selection.id !== acknowledged.selection.id
    || acknowledged.documentPrefill && JSON.stringify(current.documentPrefill) !== JSON.stringify(acknowledged.documentPrefill)) return steps;
  return steps.map((step, index) => index === nextIndex ? { ...step, screen: { ...current, availableCommands: [step.command as NonNullable<InrAssistantClientScreen["availableCommands"]>[number]] } } : step);
}

/** Bind only newly emitted steps. An old unbound checkpoint is uncertain and
 * must not acquire a fresh source or be replayed during a reclaimed request. */
export function bindInrAssistantUiSteps(steps: InrAssistantUiStep[], actions: InrAssistantUiAction[], source: { turnId: string; createdAt: string }): InrAssistantUiStep[] {
  return steps.map(step => !step.source && step.actions?.length && step.actions.every(action => actions.some(candidate => JSON.stringify(candidate) === JSON.stringify(action))) ? { ...step, source } : step);
}
