export const INR_ASSISTANT_MEDIA_UI_COMMANDS = ["select_video_source", "save_video_retouch", "optimize_media"] as const;
export type InrAssistantMediaUiCommandName = typeof INR_ASSISTANT_MEDIA_UI_COMMANDS[number];
type Target = { selection: { kind: "media"; id: string }; revision: string };
export type InrAssistantMediaUiCommand = Target & (
  { command: "select_video_source"; mediaId: string }
  | { command: "save_video_retouch" }
  | { command: "optimize_media"; targetBytes?: number; mediaId?: string }
);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const id = /^[a-zA-Z0-9_-]{1,100}$/;
export function isInrAssistantMediaUiCommandName(value: unknown): value is InrAssistantMediaUiCommandName {
  return INR_ASSISTANT_MEDIA_UI_COMMANDS.includes(value as InrAssistantMediaUiCommandName);
}
export function parseInrAssistantMediaUiCommand(value: unknown): InrAssistantMediaUiCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, selection = row.selection as Record<string, unknown> | undefined;
  if (!isInrAssistantMediaUiCommandName(row.command) || !selection || selection.kind !== "media"
    || typeof selection.id !== "string" || !id.test(selection.id) || typeof row.revision !== "string" || !id.test(row.revision)) return null;
  const target = { selection: { kind: "media" as const, id: selection.id }, revision: row.revision };
  if (row.command === "select_video_source") return typeof row.mediaId === "string" && uuid.test(row.mediaId) ? { ...target, command: row.command, mediaId: row.mediaId } : null;
  if (row.command === "save_video_retouch") return { ...target, command: row.command };
  if (row.mediaId === undefined ? !uuid.test(selection.id) : typeof row.mediaId !== "string" || !uuid.test(row.mediaId)) return null;
  if (row.targetBytes !== undefined && (typeof row.targetBytes !== "number" || !Number.isSafeInteger(row.targetBytes) || row.targetBytes < 5_000_000 || row.targetBytes > 75_000_000)) return null;
  return { ...target, command: row.command, ...(row.targetBytes !== undefined ? { targetBytes: row.targetBytes as number } : {}), ...(row.mediaId !== undefined ? { mediaId: row.mediaId as string } : {}) };
}

/** Receives the existing quote/fence-stripped normalized request text. */
export function isInrAssistantMediaUiCommandText(text: string, command?: InrAssistantMediaUiCommandName) {
  if (/^(?:comment|pourquoi|explique|how|why|si |imagine)\b|\b(?:si|if|quand|when|lorsque|apres|avant|unless|until|demain|tomorrow|later)\b|\bplus tard\b/.test(text)
    || /\b(?:ne |n['’]|sans |do not |don't ).{0,40}(?:select|chois|ouvr|utilis|remplac|enregistr|sauv|optimis|compress|save|use|open)/.test(text)) return false;
  const video = /\b(?:video|source|retouche)\b/.test(text);
  const select = video && /\b(?:selectionn\w*|choisi\w*|ouvre|ouvrir|ouvrez|utilis\w*|remplac\w*|select|choose|open|use)\b/.test(text);
  const save = video && /\b(?:enregistr\w*|sauvegard\w*|save)\b/.test(text);
  const optimize = /\b(?:optimis\w*|compress\w*|all[eé]g\w*|optimiz\w*)\b/.test(text) && /\b(?:media|image|photo|video|fichier)\b/.test(text);
  return command === "select_video_source" ? select : command === "save_video_retouch" ? save : command === "optimize_media" ? optimize : select || save || optimize;
}

export function isInrAssistantMediaUiCommandAvailable(command: unknown, pathname: unknown, kind: unknown) {
  return kind === "media" && (command === "optimize_media" ? pathname === "/dashboard/mediatheque"
    : (command === "select_video_source" || command === "save_video_retouch") && pathname === "/dashboard/generer-media");
}
