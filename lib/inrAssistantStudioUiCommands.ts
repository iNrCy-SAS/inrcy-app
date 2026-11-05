import type { ImageOverlay, ImageOverlayItem } from "./imageOverlay.ts";
import { normalizeImageOverlay } from "./imageOverlay.ts";

export const INR_ASSISTANT_STUDIO_UI_COMMANDS = ["select_image_source", "configure_image_retouch", "reset_image_retouch", "save_image_retouch", "configure_media_library"] as const;
export type InrAssistantStudioUiCommandName = typeof INR_ASSISTANT_STUDIO_UI_COMMANDS[number];
export type InrAssistantImagePatch = { fit?: "contain" | "cover"; zoom?: number; offsetX?: number; offsetY?: number; backgroundMode?: "transparent" | "color" | "white" | "black" | "gray" | "sand" | "brand"; backgroundColor?: string; overlay?: ImageOverlay | null };
type Target = { selection: { kind: "media"; id: string }; revision: string };
export type InrAssistantLibraryPatch = { search?: string; typeFilter?: "all" | "image" | "video" | "audio"; activeFilter?: "active" | "inactive" | "all"; selectedMediaIds?: string[]; previewMediaId?: string | null };
export type InrAssistantStudioUiCommand = Target & ({ command: "select_image_source"; mediaId: string } | { command: "configure_image_retouch"; patch: InrAssistantImagePatch } | { command: "reset_image_retouch" } | { command: "save_image_retouch" } | { command: "configure_media_library"; patch: InrAssistantLibraryPatch });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
function overlayItem(value: unknown): value is ImageOverlayItem {
  const item = record(value); if (!item || Object.keys(item).some(key => !["id", "text", "linkUrl", "x", "y", "width", "height", "position", "style", "fontFamily", "fontSize", "bold", "italic", "underline", "color", "borderWidth", "borderColor"].includes(key))) return false;
  for (const key of ["id", "text", "linkUrl"] as const) if (item[key] !== undefined && (typeof item[key] !== "string" || (item[key] as string).length > (key === "id" ? 80 : key === "text" ? 180 : 2048))) return false;
  if (!item.text && !item.linkUrl) return false;
  if (item.linkUrl !== undefined) { try { if (!["https:", "http:"].includes(new URL(item.linkUrl as string).protocol)) return false; } catch { return false; } }
  for (const [key, min, max] of [["x", 0, 100], ["y", 0, 100], ["width", 16, 96], ["height", 8, 92], ["fontSize", 1.5, 10], ["borderWidth", 0, 8]] as const) if (item[key] !== undefined && !finite(item[key], min, max)) return false;
  for (const key of ["bold", "italic", "underline"] as const) if (item[key] !== undefined && typeof item[key] !== "boolean") return false;
  for (const key of ["color", "borderColor"] as const) if (item[key] !== undefined && (typeof item[key] !== "string" || !/^#[a-f0-9]{6}$/i.test(item[key] as string))) return false;
  for (const [key, values] of [["position", ["top", "center", "bottom"]], ["style", ["solid", "glass"]], ["fontFamily", ["inter", "arial", "georgia", "verdana"]]] as const) if (item[key] !== undefined && !(values as readonly unknown[]).includes(item[key])) return false;
  return true;
}
export function parseInrAssistantImagePatch(value: unknown): InrAssistantImagePatch | null {
  const row = record(value); if (!row || !Object.keys(row).length || Object.keys(row).some(key => !["fit", "zoom", "offsetX", "offsetY", "backgroundMode", "backgroundColor", "overlay"].includes(key))) return null;
  if (row.fit !== undefined && !["contain", "cover"].includes(String(row.fit))) return null;
  for (const [key, min, max] of [["zoom", .4, 3], ["offsetX", -100, 100], ["offsetY", -100, 100]] as const) if (row[key] !== undefined && !finite(row[key], min, max)) return null;
  if (row.backgroundMode !== undefined && !["transparent", "color", "white", "black", "gray", "sand", "brand"].includes(String(row.backgroundMode))) return null;
  if (row.backgroundColor !== undefined && (typeof row.backgroundColor !== "string" || !/^#[a-f0-9]{6}$/i.test(row.backgroundColor))) return null;
  const result = { ...row } as InrAssistantImagePatch;
  if (row.overlay !== undefined && row.overlay !== null) {
    const overlay = record(row.overlay); if (!overlay) return null;
    if (Array.isArray(overlay.items)) { if (Object.keys(overlay).some(key => key !== "items") || !overlay.items.length || overlay.items.length > 6 || !overlay.items.every(overlayItem)) return null; }
    else if (!overlayItem(overlay)) return null;
    result.overlay = normalizeImageOverlay(overlay); if (!result.overlay) return null;
  }
  return result;
}
export function parseInrAssistantLibraryPatch(value: unknown): InrAssistantLibraryPatch | null {
  const patch = record(value); if (!patch || !Object.keys(patch).length || Object.keys(patch).some(key => !["search", "typeFilter", "activeFilter", "selectedMediaIds", "previewMediaId"].includes(key))) return null;
  if (patch.search !== undefined && (typeof patch.search !== "string" || patch.search.length > 200)) return null;
  if (patch.typeFilter !== undefined && !["all", "image", "video", "audio"].includes(String(patch.typeFilter)) || patch.activeFilter !== undefined && !["active", "inactive", "all"].includes(String(patch.activeFilter))) return null;
  if (patch.selectedMediaIds !== undefined && (!Array.isArray(patch.selectedMediaIds) || patch.selectedMediaIds.length > 25 || patch.selectedMediaIds.some(id => typeof id !== "string" || !uuid.test(id)) || new Set(patch.selectedMediaIds).size !== patch.selectedMediaIds.length)) return null;
  if (patch.previewMediaId !== undefined && patch.previewMediaId !== null && (typeof patch.previewMediaId !== "string" || !uuid.test(patch.previewMediaId))) return null;
  if ((patch.selectedMediaIds !== undefined || patch.previewMediaId !== undefined) && (patch.search !== undefined || patch.typeFilter !== undefined || patch.activeFilter !== undefined)) return null;
  return patch as InrAssistantLibraryPatch;
}
export function parseInrAssistantStudioUiCommand(value: unknown): InrAssistantStudioUiCommand | null {
  const row = record(value), selection = record(row?.selection); if (!row || !selection || selection.kind !== "media" || typeof selection.id !== "string" || !identifier.test(selection.id) || typeof row.revision !== "string" || !identifier.test(row.revision) || !INR_ASSISTANT_STUDIO_UI_COMMANDS.includes(row.command as InrAssistantStudioUiCommandName)) return null;
  const target: Target = { selection: { kind: "media", id: selection.id }, revision: row.revision };
  const expected = ["command", "selection", "revision", ...(row.command === "select_image_source" ? ["mediaId"] : row.command === "configure_image_retouch" || row.command === "configure_media_library" ? ["patch"] : [])];
  if (Object.keys(row).some(key => !expected.includes(key))) return null;
  if (row.command === "select_image_source") return typeof row.mediaId === "string" && uuid.test(row.mediaId) ? { ...target, command: row.command, mediaId: row.mediaId } : null;
  if (row.command === "configure_image_retouch") { const patch = parseInrAssistantImagePatch(row.patch); return patch ? { ...target, command: row.command, patch } : null; }
  if (row.command === "configure_media_library") { const patch = parseInrAssistantLibraryPatch(row.patch); return patch ? { ...target, command: row.command, patch } : null; }
  return { ...target, command: row.command as "reset_image_retouch" | "save_image_retouch" };
}
export function isInrAssistantStudioUiRequest(message: string, command?: string) {
  if (command && !INR_ASSISTANT_STUDIO_UI_COMMANDS.includes(command as InrAssistantStudioUiCommandName)) return false;
  const text = message.replace(/```[\s\S]*?(?:```|(?![\s\S]))/g, " ").replace(/`[^`]*(?:`|$)|«[^»]*(?:»|$)|“[^”]*(?:”|$)|"[^"]*(?:"|$)|(?<![\p{L}])'[\s\S]*?(?:'(?![\p{L}])|$)|‘[\s\S]*?(?:’(?![\p{L}])|$)/gu, " ").replace(/^\s*>.*$/gm, " ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\b(?:comment|pourquoi|explique|how|why|si|if|quand|when|lorsque|apres|avant|demain|tomorrow|later)\b|\bplus tard\b|\b(?:ne |n['’]|sans |do not |don't ).{0,60}(?:select|chois|ouvr|utilis|modifi|chang|remplac|enregistr|sauv|reinitial|ajout|retir)|\b(?:modifie|change|enregistre|sauvegarde|reinitialise|ajoute|retire)\s+pas\b/.test(text)) return false;
  const select = /\b(?:selectionn\w*|choisi\w*|ouvre|ouvrir|utilis\w*|remplac\w*)\b/.test(text) && /\b(?:image|photo|source|retouche)\b/.test(text);
  const save = /\b(?:enregistr\w*|sauvegard\w*|save)\b/.test(text) && /\b(?:image|photo|retouche|copie)\b/.test(text);
  const reset = /\b(?:reinitialis\w*|reset|remets|annule)\b/.test(text) && /\b(?:retouche|reglage|reglages|origine|initial)\b/.test(text);
  const imageObject = /\b(?:image|photo|retouche|zoom|cadrage|fond|calque|habillage|superposition|overlay|bloc|opacite|transparence)\b/.test(text);
  const configure = imageObject && /\b(?:modifi\w*|corrig\w*|chang\w*|ajout\w*|retir\w*|supprim\w*|zoome\w*|recadr\w*|mets|mettre|deplac\w*|agrandi\w*|redui\w*)\b/.test(text);
  if (command === "configure_media_library") return /\b(?:affiche\w*|filtre\w*|recherch\w*|cherch\w*|selectionn\w*|deselectionn\w*|ouvre|ferme|montre|voir|apercu)\b/.test(text) && /\b(?:mediatheque|bibliotheque|medias?|images?|photos?|videos?|audios?|fichiers?)\b/.test(text);
  if (/\bvideo\b/.test(text) && !/\b(?:image|photo)\b/.test(text)) return false;
  return command === "select_image_source" ? select : command === "save_image_retouch" ? save : command === "reset_image_retouch" ? reset : command === "configure_image_retouch" ? configure : select || save || reset || configure;
}
export function inrAssistantStudioUiCommandAvailable(command: unknown, pathname: unknown, kind: unknown) { return INR_ASSISTANT_STUDIO_UI_COMMANDS.includes(command as InrAssistantStudioUiCommandName) && pathname === (command === "configure_media_library" ? "/dashboard/mediatheque" : "/dashboard/generer-media") && kind === "media"; }
