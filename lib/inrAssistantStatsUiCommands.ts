export const INR_ASSISTANT_STATS_UI_COMMANDS = ["configure_stats_view"] as const;
export type InrAssistantStatsUiCommandName = typeof INR_ASSISTANT_STATS_UI_COMMANDS[number];
export const INR_ASSISTANT_STATS_CHANNELS = ["inrbadge", "site_web", "gmb", "inr_search", "facebook", "instagram", "threads", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x", "mails"] as const;
export type InrAssistantStatsChannel = typeof INR_ASSISTANT_STATS_CHANNELS[number];
export type InrAssistantStatsViewPatch = {
  panel?: "all" | "evolution" | InrAssistantStatsChannel;
  evolutionView?: "measured" | "index";
  metric?: "visibility" | "clicks";
  channel?: "all" | InrAssistantStatsChannel;
};
export type InrAssistantStatsUiCommand = { command: "configure_stats_view"; selection: { kind: "stats"; id: "stats" }; revision: string; patch: InrAssistantStatsViewPatch };
export const isInrAssistantStatsUiCommandName = (value: unknown): value is InrAssistantStatsUiCommandName => value === "configure_stats_view";
export function parseInrAssistantStatsUiCommand(value: unknown): InrAssistantStatsUiCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, selection = row.selection as Record<string, unknown> | undefined;
  if (row.command !== "configure_stats_view" || selection?.kind !== "stats" || selection.id !== "stats" || typeof row.revision !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.revision)) return null;
  if (!row.patch || typeof row.patch !== "object" || Array.isArray(row.patch)) return null;
  const patch = row.patch as Record<string, unknown>;
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !["panel", "evolutionView", "metric", "channel"].includes(key))) return null;
  if (patch.panel !== undefined && !["all", "evolution", ...INR_ASSISTANT_STATS_CHANNELS].includes(patch.panel as never)
    || patch.evolutionView !== undefined && !["measured", "index"].includes(String(patch.evolutionView))
    || patch.metric !== undefined && !["visibility", "clicks"].includes(String(patch.metric))
    || patch.channel !== undefined && !["all", ...INR_ASSISTANT_STATS_CHANNELS].includes(patch.channel as never)) return null;
  return { command: row.command, selection: { kind: "stats", id: "stats" }, revision: row.revision, patch: { ...patch } as InrAssistantStatsViewPatch };
}
export function isInrAssistantStatsUiCommandAvailable(command: unknown, pathname: unknown, kind: unknown) {
  return command === "configure_stats_view" && pathname === "/dashboard/stats" && kind === "stats";
}
/** A mounted Stats screen does not turn a module opening into a filter edit. */
export function isInrAssistantStatsUiCommandText(message: string) {
  const text = inrAssistantUnquotedRequest(message);
  if (/^(?:comment|pourquoi|explique|how|why|si |imagine)\b|\b(?:si|if|quand|when|lorsque|apres|avant|demain|tomorrow|later)\b|\bplus tard\b|\b(?:ne |n['’]|sans |do not |don't ).{0,50}(?:affich|ouvr|selection|passe|chois|filtr|montre|modifi|chang|regl|mets|show|open|select|set|switch|filter)/.test(text)) return false;
  return inrAssistantRequestClauses(text).some(clause => {
    const action = clause.match(/^(?:(?:peux|pouvez|pourrais|pourriez)[ -](?:tu|vous)\s+(?:m'|me\s+|nous\s+)?)?(?:affich\w*|ouvr\w*|ouvre|selectionn\w*|passe|choisi\w*|filtr\w*|montre(?:r|z)?|modifi\w*|chang\w*|regl\w*|mets|show|open|select|set|switch|filter)(?:-moi|-nous)?\s+(.+)$/);
    if (!action) return false;
    const target = action[1].replace(/^(?:(?:dans|sur|en|vers|a|au|aux|to)\s+)?(?:(?:le|la|les|un|une|des|ce|cet|cette|ces|mon|ma|mes|the|my)\s+|l')?/, "");
    // Bind the verb to its direct Stats object. An image request containing
    // incidental words such as "vue" or "statistiques" has another target.
    if (/^(?:vue|onglet|panneau)\s+(?:evolution|globale?|d'ensemble|mensuell\w*|mesur\w*|indice|visibilite|clics?)\b/.test(target)) return !/\b(?:image|photo|video|illustration)\b/.test(target);
    if (/^(?:evolution|visibilite|clics?|indice|mesures?|metrique|canal|canaux|filtre)\b/.test(target)) return true;
    // A named channel is an explicit native panel/filter; generic Stats alone
    // remains navigation, including "la page complète de mes statistiques".
    return /^(?:stats?|statistiques?)\s+(?:(?:de|du|des|sur|pour)\s+)?(?:(?:le|la|les|mon|ma|mes)\s+)?(?:canal|canaux|facebook|instagram|threads|linkedin|tiktok|youtube|pinterest|google business|gmb|inrbadge|site web|inr.?search|mails)\b/.test(target)
      || /^filtr\w*\b/.test(clause) && /^(?:stats?|statistiques?|evolution)\b/.test(target);
  });
}
import { inrAssistantRequestClauses, inrAssistantUnquotedRequest } from "./inrAssistantRequestClauses.ts";

