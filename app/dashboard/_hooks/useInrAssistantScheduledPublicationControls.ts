"use client";
import { useLayoutEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { useDashboardViewerAccess } from "../_components/DashboardViewerAccessProvider";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";
import { parseInrAssistantScheduledOptionSelection, parseInrAssistantScheduledTextSelection, type InrAssistantScheduledTextDraft } from "@/lib/inrAssistantScheduledEditorSelection";

type Guard = () => boolean;
type Options = {
  enabled: boolean; sessionId: string | null; sourceVersion: string; baseline: string; channel: string | null; channels: readonly string[]; busy: boolean; dirty: boolean; actionSignature: string;
  choiceOpen: boolean; textOpen: boolean; textDraft: InrAssistantScheduledTextDraft; canEditContent: boolean; canEditOptions: boolean;
  ctaChoice: string; ctaMode: string; ctaChoices: readonly string[]; websiteUrl: string; supportsHashtags: boolean;
  expectedTextSignature(all: boolean): string;
  openEditor(): void; closeEditor(): void; exitEditor(canContinue: Guard): Promise<void>;
  openText(): void; changeText(field: "title" | "body" | "hashtags" | "cta" | "ctaUrl" | "ctaPhone", value: string): void;
  changeCtaChoice(value: string): void; chooseWebsite(): void; applyText(all: boolean, canContinue: Guard): Promise<void>;
  changeChannel(value: string): void;
  mediaOpen: boolean; mediaCount: number; mediaIndex: number; mediaAvailable: boolean; mediaGhost: boolean;
  libraryOpen: boolean; studioOpen: boolean; canGenerate: boolean; canModify: boolean; mediaKind: string | null;
  mediaAllAllowed: boolean; expectedMediaAllSignature: string;
  openMedia(): void; closeMedia(): void; setMediaIndex(index: number): void; setLibraryOpen(open: boolean): void;
  openStudio(mode: "generate" | "modify" | "retouch", canContinue: Guard): Promise<void>; applyMediaAll(canContinue: Guard): Promise<void>;
  placement: string; placements: readonly string[]; storyEnabled: boolean; hasUsableMedia: boolean; threadsMode: string; threadsModes: readonly string[]; pinterestBoardId: string; pinterestBoardIds: readonly string[];
  changePlacement(value: string, canContinue: Guard): Promise<void>; changeThreadsMode(value: string, canContinue: Guard): Promise<void>; changePinterestBoard(value: string, canContinue: Guard): Promise<void>;
};
type Snapshot = { sessionId: string | null; channel: string | null; actionSignature: string; choiceOpen: boolean; textOpen: boolean; textDraft: InrAssistantScheduledTextDraft; ctaChoice: string; mediaOpen: boolean; mediaIndex: number; libraryOpen: boolean; studioOpen: boolean; placement: string; threadsMode: string; pinterestBoardId: string };
const snapshot = (value: unknown) => value && typeof value === "object" ? value as Snapshot : null;

/** These callbacks are registered exclusively for a local scheduled edit.
 * The non-scheduled Agent callbacks can persist immediately and are unreachable. */
export function useInrAssistantScheduledPublicationControls(options: Options) {
  const { actorUserId, activeAccountId } = useDashboardViewerAccess(), pathname = usePathname();
  const key = JSON.stringify([actorUserId, activeAccountId, pathname, options.enabled, options.sessionId, options.sourceVersion, options.baseline, options.channel]);
  const token = useMemo(() => ({ key }), [key]), current = useRef(token), alive = useRef(false);
  useLayoutEffect(() => { current.current = token; }, [token]);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const guarded = (valid: Guard) => () => valid() && alive.current && current.current === token;
  const ready = (valid: Guard) => { const canContinue = guarded(valid); if (!options.enabled || !options.sessionId || options.busy || !canContinue()) throw new Error("scheduled_editor_stale"); return canContinue; };
  const state: Snapshot = { sessionId: options.sessionId, channel: options.channel, actionSignature: options.actionSignature, choiceOpen: options.choiceOpen, textOpen: options.textOpen, textDraft: options.textDraft, ctaChoice: options.ctaChoice, mediaOpen: options.mediaOpen, mediaIndex: options.mediaIndex, libraryOpen: options.libraryOpen, studioOpen: options.studioOpen, placement: options.placement, threadsMode: options.threadsMode, pinterestBoardId: options.pinterestBoardId };
  const same = (value: unknown) => { const next = snapshot(value); return next?.sessionId === options.sessionId && next.channel === options.channel ? next : null; };
  const enabled = options.enabled && !!options.sessionId;
  const nextChannel = (direction: -1 | 1) => { const index = options.channels.indexOf(options.channel ?? ""); return options.channels[index < 0 ? direction > 0 ? 0 : options.channels.length - 1 : (index + direction + options.channels.length) % options.channels.length]; };
  useInrAssistantLocalInterface("scheduled_publication_channel", state, {
    select: { invoke: (value, valid) => { ready(valid); if (!value || !options.channels.includes(value)) throw new Error("scheduled_channel_unavailable"); options.changeChannel(value); }, matches: (value, channel) => snapshot(value)?.sessionId === options.sessionId && snapshot(value)?.channel === channel },
    ...(options.channels.length > 1 ? Object.fromEntries(([-1, 1] as const).map(direction => [direction < 0 ? "previous" : "next", { invoke: (_value: string | null, valid: Guard) => { ready(valid); options.changeChannel(nextChannel(direction)); }, matches: (value: unknown) => snapshot(value)?.sessionId === options.sessionId && snapshot(value)?.channel === nextChannel(direction) }])) : {}),
  }, enabled, options.busy);
  useInrAssistantLocalInterface("scheduled_publication_workspace", state, { close: { invoke: async (_value, valid) => { await options.exitEditor(ready(valid)); }, matches: value => snapshot(value)?.sessionId === null, allowUnmount: true } }, enabled, options.busy);
  useInrAssistantLocalInterface("scheduled_publication_editor", state, {
    open: { invoke: (_value, valid) => { ready(valid); if (options.textOpen || !options.canEditContent) throw new Error("scheduled_editor_already_open"); options.openEditor(); }, matches: value => same(value)?.choiceOpen === true },
    close: { invoke: (_value, valid) => { ready(valid); options.closeEditor(); }, matches: value => same(value)?.choiceOpen === false && same(value)?.textOpen === false },
  }, enabled, options.busy);
  const textContext = { enabled: enabled && options.canEditContent, open: options.textOpen, busy: options.busy, draft: options.textDraft, ctaChoice: options.ctaChoice, ctaMode: options.ctaMode, ctaChoices: options.ctaChoices, websiteUrl: options.websiteUrl, supportsHashtags: options.supportsHashtags };
  useInrAssistantLocalInterface("scheduled_publication_text_form", state, { select: {
    invoke: async (value, valid) => {
      const canContinue = ready(valid), change = parseInrAssistantScheduledTextSelection(value, textContext); if (!change) throw new Error("scheduled_text_selection_unavailable");
      if (change.field === "apply") { await options.applyText(change.value === "all_channels", canContinue); return; }
      if (change.field === "ctaChoice") { options.changeCtaChoice(change.value); return; }
      if (change.field === "websiteChoice") { options.chooseWebsite(); return; }
      options.changeText(change.field, change.value);
    },
    matches: (value, encoded) => {
      const next = same(value), change = parseInrAssistantScheduledTextSelection(encoded, textContext); if (!next || !change) return false;
      if (change.field === "apply") return !next.textOpen && next.actionSignature === options.expectedTextSignature(change.value === "all_channels");
      if (change.field === "ctaChoice") return next.ctaChoice === change.value;
      return next.textDraft[change.field === "websiteChoice" ? "ctaUrl" : change.field] === (change.field === "websiteChoice" ? options.websiteUrl : change.value);
    },
  } }, enabled && options.textOpen && options.canEditContent, options.busy);
  const optionContext = { enabled: enabled && options.canEditOptions, busy: options.busy, channel: options.channel, placements: options.placements, storyEnabled: options.storyEnabled, hasUsableMedia: options.hasUsableMedia, threadsModes: options.threadsModes, pinterestBoardIds: options.pinterestBoardIds };
  useInrAssistantLocalInterface("scheduled_publication_options", state, { select: {
    invoke: async (value, valid) => { const canContinue = ready(valid), change = parseInrAssistantScheduledOptionSelection(value, optionContext); if (!change) throw new Error("scheduled_options_unavailable"); if (change.field === "placement") await options.changePlacement(change.value, canContinue); else if (change.field === "threadsMode") await options.changeThreadsMode(change.value, canContinue); else await options.changePinterestBoard(change.value, canContinue); },
    matches: (value, encoded) => { const next = same(value), change = parseInrAssistantScheduledOptionSelection(encoded, optionContext); return !!next && !!change && next[change.field === "pinterestBoard" ? "pinterestBoardId" : change.field] === change.value; },
  } }, enabled && options.canEditOptions, options.busy);
  const targetMediaIndex = (direction: -1 | 1) => (options.mediaIndex + direction + options.mediaCount) % options.mediaCount;
  useInrAssistantLocalInterface("scheduled_publication_media", state, {
    open: { invoke: (_value, valid) => { ready(valid); if (options.mediaGhost) throw new Error("scheduled_media_unavailable"); options.openMedia(); }, matches: value => same(value)?.mediaOpen === true },
    close: { invoke: (_value, valid) => { ready(valid); options.closeMedia(); }, matches: value => same(value)?.mediaOpen === false },
    ...(options.mediaCount > 1 ? Object.fromEntries(([-1, 1] as const).map(direction => [direction < 0 ? "previous" : "next", { invoke: (_value: string | null, valid: Guard) => { ready(valid); options.setMediaIndex(targetMediaIndex(direction)); }, matches: (value: unknown) => same(value)?.mediaIndex === targetMediaIndex(direction) }])) : {}),
    select: {
      invoke: async (value, valid) => {
        const canContinue = ready(valid);
        if (typeof value === "string" && /^index:(?:0|[1-9]\d?)$/.test(value)) { const index = Number(value.slice(6)); if (index >= options.mediaCount) throw new Error("scheduled_media_unavailable"); options.setMediaIndex(index); return; }
        if (value === "apply_to_all") { if (!options.mediaAllAllowed || !options.canEditContent) throw new Error("scheduled_media_unavailable"); await options.applyMediaAll(canContinue); return; }
        const mode = value === "studio_generate" ? "generate" : value === "studio_modify" ? "modify" : value === "studio_retouch" ? "retouch" : null;
        if (!mode || !options.canEditContent || options.mediaGhost || (mode === "generate" ? !options.canGenerate : !options.mediaAvailable || mode === "modify" && (!options.canModify || options.mediaKind !== "image"))) throw new Error("scheduled_media_unavailable");
        await options.openStudio(mode, canContinue);
      },
      matches: (value, selection) => { const next = same(value); if (!next) return false; if (selection?.startsWith("index:")) return next.mediaIndex === Number(selection.slice(6)); if (selection === "apply_to_all") return next.actionSignature === options.expectedMediaAllSignature; return ["studio_generate", "studio_modify", "studio_retouch"].includes(selection ?? "") && next.studioOpen; },
    },
  }, enabled, options.busy);
  useInrAssistantLocalInterface("scheduled_publication_library", state, {
    open: { invoke: (_value, valid) => { ready(valid); if (!options.mediaOpen || options.mediaGhost) throw new Error("scheduled_library_unavailable"); options.setLibraryOpen(true); }, matches: value => same(value)?.libraryOpen === true },
    close: { invoke: (_value, valid) => { ready(valid); options.setLibraryOpen(false); }, matches: value => same(value)?.libraryOpen === false },
  }, enabled && options.mediaOpen, options.busy);
}
