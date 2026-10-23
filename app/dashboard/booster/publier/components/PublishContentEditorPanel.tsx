import type { ThreadsPublicationMode, ThreadsPublicationPreferences } from "@/lib/threadsPublicationPreferences";
import ThreadsPublicationModeControls from "./ThreadsPublicationModeControls";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import type {
  CSSProperties,
  Dispatch,
  KeyboardEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useEffect, useRef, useState } from "react";
import type { BoosterCreationMode } from "@/lib/boosterCreationMode";
import type { InstagramPublicationPreferences } from "@/lib/instagramPublicationPreferences";
import type { FacebookPublicationPreferences } from "@/lib/facebookPublicationPreferences";
import type { MetaPrimaryPublicationPlacement } from "@/lib/metaPublicationTargets";
import { buildCtaTextForChannel, getCtaPhone } from "@/lib/boosterCta";
import {
  getBoosterXForbiddenUrlFields,
  getBoosterXUrlBlockerMessage,
} from "@/lib/boosterXUrlPolicy";
import {
  buildBoosterWhatsAppUrl,
  getBoosterWhatsAppPhoneFromUrl,
} from "@/lib/boosterWhatsappCta";
import { editableHtmlToSiteText, stripSiteTextFormatting } from "@/lib/boosterFormatting";
import { readSanitizedElementHtml } from "@/lib/sanitizeHtml";
import EmojiPickerButton from "@/app/dashboard/_components/EmojiPickerButton";
import AiContentReportButton from "@/app/dashboard/_components/AiContentReportButton";
import MediaSubjectVoiceButton from "@/app/dashboard/_components/MediaSubjectVoiceButton";
import {
  CHANNEL_TEXT_GUIDELINES,
  getLocalizedChannelDefaultCtaLabel,
  getLocalizedChannelLabel,
  getLocalizedChannelTotalLabel,
  getLocalizedCtaModeHelp,
  getLocalizedPreferredCtaLabel,
  getLocalizedWebsiteSourceLabelForChannel,
  getPreferredCtaOptionsForChannel,
  getPreferredCtaChoiceFromPost,
  getCtaModeForPreferredChoice,
  getWebsiteUrlForChannel,
  isSiteDisplayKey,
  parseInstagramHashtagsInput,
  renderLimitCounter,
  type BoosterCtaDefaults,
  type BoosterPreferredCta,
  type ChannelKey,
  type ChannelMediaMode,
  type ChannelPost,
  type DisplayKey,
} from "../publishModal.shared";
import {
  darkOptionStyle,
  darkSelectStyle,
  inputStyle,
  lightFieldStyle,
  pillBtn,
  textAreaStyle,
} from "../publishModal.styles";
import RichSiteContentEditor from "./RichSiteContentEditor";
import ChannelNavigationRail from "./ChannelNavigationRail";
import PublishStepTitle from "./PublishStepTitle";
import css from "./PublishContentEditorPanel.module.css";
import { PUBLISH_CHANNEL_IDENTITY } from "./publishChannelIdentity";

type PublishModalStyles = Readonly<Record<string, string>>;

type DuplicateFeedback = {
  kind: "success" | "error";
  message: string;
} | null;

type ManualVoiceField = "title" | "content" | "hashtags";

type ManualVoiceTarget = {
  channel: DisplayKey;
  field: ManualVoiceField;
};

const INSTAGRAM_HASHTAGS_INPUT_MAX_LENGTH = 20 * (40 + 2);
const X_HASHTAGS_INPUT_MAX_LENGTH = 2 * (40 + 2);

function MetaPublicationFormatControls({
  label,
  primaryPlacement,
  reelsEnabled,
  storyEnabled,
  storiesEnabled,
  disabled,
  classicLabel,
  reelLabel,
  storyLabel,
  onPrimaryPlacementChange,
  onStoryEnabledChange,
}: {
  label: string;
  primaryPlacement: MetaPrimaryPublicationPlacement;
  reelsEnabled: boolean;
  storyEnabled: boolean;
  storiesEnabled: boolean;
  disabled: boolean;
  classicLabel: string;
  reelLabel: string;
  storyLabel: string;
  onPrimaryPlacementChange: (
    placement: MetaPrimaryPublicationPlacement,
  ) => void;
  onStoryEnabledChange: (enabled: boolean) => void;
}) {
  const optionStyle = (active: boolean) => ({
    ...pillBtn,
    minHeight: 36,
    padding: "7px 13px",
    border: active
      ? "1px solid rgba(76,195,255,0.68)"
      : "1px solid rgba(148,163,184,0.28)",
    background: active
      ? "linear-gradient(135deg, rgba(32,151,217,0.34), rgba(151,71,255,0.28))"
      : "rgba(8,20,46,0.58)",
    color: active ? "#f8fbff" : "rgba(226,232,240,0.78)",
    opacity: disabled ? 0.55 : 1,
  });

  return (
    <div
      aria-label={label}
      role="group"
      className={css.metaFormats}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 7,
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      <button
        type="button"
        aria-pressed={primaryPlacement === "classic"}
        onClick={() => onPrimaryPlacementChange("classic")}
        disabled={disabled}
        style={optionStyle(primaryPlacement === "classic")}
      >
        {classicLabel}
      </button>
      {reelsEnabled ? (
        <button
          type="button"
          aria-pressed={primaryPlacement === "reel"}
          onClick={() => onPrimaryPlacementChange("reel")}
          disabled={disabled}
          style={optionStyle(primaryPlacement === "reel")}
        >
          {reelLabel}
        </button>
      ) : null}
      {storiesEnabled ? (
        <>
          <button
            type="button"
            aria-pressed={primaryPlacement === "story"}
            onClick={() => {
              onPrimaryPlacementChange("story");
              onStoryEnabledChange(false);
            }}
            disabled={disabled}
            style={optionStyle(primaryPlacement === "story")}
          >
            {storyLabel}
          </button>
          {primaryPlacement !== "story" ? (
            <label
              style={{
                ...optionStyle(storyEnabled),
                cursor: disabled ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontWeight: 800,
              }}
            >
              <input
                type="checkbox"
                checked={storyEnabled}
                onChange={(event) => onStoryEnabledChange(event.target.checked)}
                disabled={disabled}
                style={{ accentColor: "#38bdf8" }}
              />
              + {storyLabel}
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type PublishContentEditorPanelProps = {
  actionsContainer?: HTMLElement | null;
  styles: PublishModalStyles;
  isMobile: boolean;
  creationMode: BoosterCreationMode | null;
  stepNumber: number;
  displayCards: DisplayKey[];
  activeCard: DisplayKey;
  setSynchronizedActiveChannel: (channel: ChannelKey) => void;
  getDisplayPost: (key: DisplayKey) => ChannelPost;
  updatePost: (
    channel: ChannelKey,
    patch: Partial<ChannelPost>,
    options?: { sanitize?: boolean },
  ) => void;
  applySiteContentFormat: (kind: "bold" | "italic" | "underline") => void;
  siteContentEditorRef: MutableRefObject<HTMLDivElement | null>;
  contentTextAreaRef: MutableRefObject<HTMLTextAreaElement | null>;
  ctaDefaults: BoosterCtaDefaults | null;
  applyPreferredCtaPrefill: (
    channel: ChannelKey,
    choice: BoosterPreferredCta,
  ) => void;
  instagramHashtagsInput: string;
  setInstagramHashtagsInput: Dispatch<SetStateAction<string>>;
  getLiveInstagramHashtags: () => string[];
  xHashtagsInput: string;
  setXHashtagsInput: Dispatch<SetStateAction<string>>;
  duplicateFeedback: DuplicateFeedback;
  onDuplicateContentToAllChannels: () => void;
  pinterestBoards: Array<{ id: string; name: string }>;
  pinterestBoardId: string;
  pinterestBoardsLoading: boolean;
  pinterestBoardsError: string;
  onPinterestBoardChange: (boardId: string) => void;
  threadsPublicationMode: ThreadsPublicationMode;
  threadsPublicationPreferences: ThreadsPublicationPreferences;
  threadsPreferencesLoading: boolean;
  threadsPreferencesFailed: boolean;
  onThreadsPublicationModeChange: (mode: ThreadsPublicationMode) => void;
  instagramPublicationPlacement: MetaPrimaryPublicationPlacement;
  instagramStoryEnabled: boolean;
  instagramPublicationPreferences: InstagramPublicationPreferences;
  instagramMediaMode: ChannelMediaMode;
  onInstagramPublicationPlacementChange: (
    placement: MetaPrimaryPublicationPlacement,
  ) => void;
  onInstagramStoryEnabledChange: (enabled: boolean) => void;
  facebookPublicationPlacement: MetaPrimaryPublicationPlacement;
  facebookStoryEnabled: boolean;
  facebookPublicationPreferences: FacebookPublicationPreferences;
  facebookMediaMode: ChannelMediaMode;
  onFacebookPublicationPlacementChange: (
    placement: MetaPrimaryPublicationPlacement,
  ) => void;
  onFacebookStoryEnabledChange: (enabled: boolean) => void;
  onVoiceBusyChange?: (busy: boolean) => void;
};

export default function PublishContentEditorPanel({
  actionsContainer,
  styles,
  isMobile,
  creationMode,
  stepNumber,
  displayCards,
  activeCard,
  setSynchronizedActiveChannel,
  getDisplayPost,
  updatePost,
  applySiteContentFormat,
  siteContentEditorRef,
  contentTextAreaRef,
  ctaDefaults,
  applyPreferredCtaPrefill,
  instagramHashtagsInput,
  setInstagramHashtagsInput,
  getLiveInstagramHashtags,
  xHashtagsInput,
  setXHashtagsInput,
  duplicateFeedback,
  onDuplicateContentToAllChannels,
  pinterestBoards,
  pinterestBoardId,
  pinterestBoardsLoading,
  pinterestBoardsError,
  onPinterestBoardChange,
  threadsPublicationMode,
  threadsPublicationPreferences,
  threadsPreferencesLoading,
  threadsPreferencesFailed,
  onThreadsPublicationModeChange,
  instagramPublicationPlacement,
  instagramStoryEnabled,
  instagramPublicationPreferences,
  instagramMediaMode,
  onInstagramPublicationPlacementChange,
  onInstagramStoryEnabledChange,
  facebookPublicationPlacement,
  facebookStoryEnabled,
  facebookPublicationPreferences,
  facebookMediaMode,
  onFacebookPublicationPlacementChange,
  onFacebookStoryEnabledChange,
  onVoiceBusyChange,
}: PublishContentEditorPanelProps) {
  const i18nT = useTranslations("booster");
  const runtimeT = i18nT as unknown as (key: string) => string;
  const titleEditorRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const titleEmojiRangeRef = useRef<Range | null>(null);
  const titleEmojiSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const siteEmojiSelectionRef = useRef<Range | null>(null);
  const plainEmojiSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const [activeTextField, setActiveTextField] = useState<"title" | "content">("content");
  const [activeVoiceTarget, setActiveVoiceTarget] =
    useState<ManualVoiceTarget | null>(null);
  const voiceBusy = activeVoiceTarget !== null;
  const TitleControl = isMobile ? "textarea" : "input";

  useEffect(() => {
    titleEmojiRangeRef.current = null;
    titleEmojiSelectionRef.current = null;
    siteEmojiSelectionRef.current = null;
    plainEmojiSelectionRef.current = null;
  }, [activeCard]);

  useEffect(() => {
    onVoiceBusyChange?.(voiceBusy);
  }, [onVoiceBusyChange, voiceBusy]);

  useEffect(
    () => () => {
      onVoiceBusyChange?.(false);
    },
    [onVoiceBusyChange],
  );

  const handleVoiceBusyChange = (
    channel: DisplayKey,
    field: ManualVoiceField,
    busy: boolean,
  ) => {
    setActiveVoiceTarget((current) => {
      if (busy) return { channel, field };
      if (current?.channel === channel && current.field === field) return null;
      return current;
    });
  };

  const isVoiceTargetDisabled = (
    channel: DisplayKey,
    field: ManualVoiceField,
  ) =>
    activeVoiceTarget !== null &&
    (activeVoiceTarget.channel !== channel || activeVoiceTarget.field !== field);

  const keepEditorTypingInsideField = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    // Les bulles/carrousels du dashboard utilisent Espace/Entrée comme raccourcis clavier.
    // Quand on édite un titre ou un contenu, on bloque seulement la propagation
    // pour éviter qu'un parent intercepte la touche Espace, sans empêcher la saisie.
    event.stopPropagation();
  };

  const saveEmojiSelection = () => {
    if (isSiteDisplayKey(activeCard)) {
      const editor = siteContentEditorRef.current;
      const selection = typeof window !== "undefined" ? window.getSelection() : null;
      if (!editor || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return;
      siteEmojiSelectionRef.current = range.cloneRange();
      return;
    }

    const textarea = contentTextAreaRef.current;
    if (!textarea) return;
    plainEmojiSelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  };

  const insertEmoji = (emoji: string) => {
    if (isSiteDisplayKey(activeCard)) {
      const editor = siteContentEditorRef.current;
      if (!editor) return;
      try {
        editor.focus({ preventScroll: true });
      } catch {
        editor.focus();
      }
      const range = siteEmojiSelectionRef.current;
      if (range && editor.contains(range.commonAncestorContainer)) {
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
      document.execCommand("insertText", false, emoji);
      updatePost(activeCard, {
        content: editableHtmlToSiteText(readSanitizedElementHtml(editor)),
      });
      return;
    }

    const textarea = contentTextAreaRef.current;
    if (!textarea) return;
    const currentContent = getDisplayPost(activeCard).content;
    const selection = plainEmojiSelectionRef.current || {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
    const nextContent = `${currentContent.slice(0, selection.start)}${emoji}${currentContent.slice(selection.end)}`;
    const nextCursor = selection.start + emoji.length;
    updatePost(activeCard, { content: nextContent }, { sanitize: false });
    plainEmojiSelectionRef.current = { start: nextCursor, end: nextCursor };
    window.requestAnimationFrame(() => {
      const currentTextarea = contentTextAreaRef.current;
      if (!currentTextarea) return;
      currentTextarea.focus({ preventScroll: true });
      currentTextarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const saveTitleEmojiSelection = () => {
    if (isSiteDisplayKey(activeCard)) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && titleEditorRef.current?.contains(range.commonAncestorContainer)) {
        titleEmojiRangeRef.current = range.cloneRange();
      }
    } else {
      const input = titleInputRef.current;
      if (input) titleEmojiSelectionRef.current = { start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length };
    }
  };

  const insertTitleEmoji = (emoji: string) => {
    if (isSiteDisplayKey(activeCard)) {
      const editor = titleEditorRef.current;
      if (!editor) return;
      editor.focus({ preventScroll: true });
      const range = titleEmojiRangeRef.current;
      if (range && editor.contains(range.commonAncestorContainer)) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      document.execCommand("insertText", false, emoji);
      updatePost(activeCard, { title: editableHtmlToSiteText(readSanitizedElementHtml(editor)) });
      return;
    }
    const input = titleInputRef.current;
    if (!input) return;
    const title = getDisplayPost(activeCard).title;
    const selection = titleEmojiSelectionRef.current || { start: input.selectionStart ?? title.length, end: input.selectionEnd ?? title.length };
    const cursor = selection.start + emoji.length;
    updatePost(activeCard, { title: title.slice(0, selection.start) + emoji + title.slice(selection.end) }, { sanitize: false });
    titleEmojiSelectionRef.current = { start: cursor, end: cursor };
    window.requestAnimationFrame(() => { titleInputRef.current?.focus({ preventScroll: true }); titleInputRef.current?.setSelectionRange(cursor, cursor); });
  };

  const applyTitleFormat = (kind: "bold" | "italic" | "underline") => {
    const editor = titleEditorRef.current;
    if (!isSiteDisplayKey(activeCard) || !editor || voiceBusy) return;
    editor.focus({ preventScroll: true });
    document.execCommand(kind, false);
    updatePost(activeCard, { title: editableHtmlToSiteText(readSanitizedElementHtml(editor)) });
  };

  const rememberTextSelection = (field: "title" | "content") => {
    if (field === "title") saveTitleEmojiSelection();
    else saveEmojiSelection();
  };

  const applyActiveTextFormat = (kind: "bold" | "italic" | "underline") => {
    if (!isSiteDisplayKey(activeCard) || voiceBusy || activeStoryOnly) return;
    const editor = activeTextField === "title" ? titleEditorRef.current : siteContentEditorRef.current;
    const range = activeTextField === "title" ? titleEmojiRangeRef.current : siteEmojiSelectionRef.current;
    if (!editor) return;
    editor.focus({ preventScroll: true });
    if (range && editor.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (activeTextField === "title") applyTitleFormat(kind);
    else applySiteContentFormat(kind);
    rememberTextSelection(activeTextField);
  };

  const renderFormattingTools = (field: "title" | "content") => (
    <div className={css.formatTools} role="toolbar" aria-label={i18nT(field === "title" ? "titre_eb97899a" : "contenu_f3cb82af")}>
      {([
        ["bold", "B", i18nT("format_bold")],
        ["italic", "I", i18nT("format_italic")],
        ["underline", "U", i18nT("format_underline")],
      ] as const).map(([kind, label, title]) => (
        <button key={kind} type="button"
          title={isSiteDisplayKey(activeCard) ? title : i18nT("format_site_only")}
          aria-label={title}
          disabled={!isSiteDisplayKey(activeCard) || voiceBusy || activeStoryOnly}
          onPointerDown={() => rememberTextSelection(field)}
          onMouseDown={(event) => { if (event.cancelable) event.preventDefault(); }}
          onClick={() => applyActiveTextFormat(kind)}
          style={{ fontWeight: 900, fontStyle: kind === "italic" ? "italic" : "normal", textDecoration: kind === "underline" ? "underline" : "none" }}>
          {label}
        </button>
      ))}
      <EmojiPickerButton onBeforeOpen={field === "title" ? saveTitleEmojiSelection : saveEmojiSelection}
        onSelect={field === "title" ? insertTitleEmoji : insertEmoji} disabled={voiceBusy || activeStoryOnly}
        buttonStyle={{ minWidth: 32, height: 30, borderRadius: 9, border: "1px solid rgba(76,195,255,0.35)", background: "rgba(76,195,255,0.12)", color: "#eaf7ff", fontSize: 16, cursor: voiceBusy ? "not-allowed" : "pointer" }} />
    </div>
  );

  const activePost = getDisplayPost(activeCard);
  const xHashtagsSignature =
    activeCard === "x" ? (activePost.hashtags || []).join("|") : "";

  useEffect(() => {
    if (activeCard !== "x") return;
    setXHashtagsInput((currentInput) => {
      // Conserver une URL saisie tant que le pro ne la corrige pas lui-même :
      // changer de canal ne doit jamais masquer ni effacer silencieusement l'erreur.
      if (
        getBoosterXForbiddenUrlFields(
          { hashtags: [] },
          { hashtagsInput: currentInput },
        ).length
      ) {
        return currentInput;
      }
      return (activePost.hashtags || [])
        .slice(0, 2)
        .map((tag) => `#${String(tag || "").replace(/^#+/, "")}`)
        .join(" ");
    });
  }, [activeCard, activePost.hashtags, setXHashtagsInput, xHashtagsSignature]);

  const getLiveXHashtags = () =>
    parseInstagramHashtagsInput(xHashtagsInput).slice(0, 2);
  const xForbiddenUrlFields =
    activeCard === "x"
      ? getBoosterXForbiddenUrlFields(activePost, {
          hashtagsInput: xHashtagsInput,
        })
      : [];
  const xForbiddenCtaUrlFields = xForbiddenUrlFields.filter((field) =>
    ["cta", "ctaUrl", "ctaPhone"].includes(field.field),
  );
  const instagramVerticalFormat =
    activeCard === "instagram" &&
    (instagramPublicationPlacement === "reel" ||
      instagramPublicationPlacement === "story" ||
      instagramStoryEnabled);
  const facebookVerticalFormat =
    activeCard === "facebook" &&
    (facebookPublicationPlacement === "reel" ||
      facebookPublicationPlacement === "story" ||
      facebookStoryEnabled);
  const activeStoryEnabled =
    (activeCard === "instagram" && instagramStoryEnabled) ||
    (activeCard === "instagram" && instagramPublicationPlacement === "story") ||
    (activeCard === "facebook" && facebookStoryEnabled) ||
    (activeCard === "facebook" && facebookPublicationPlacement === "story");
  const activeStoryOnly =
    (activeCard === "instagram" &&
      instagramPublicationPlacement === "story") ||
    (activeCard === "facebook" && facebookPublicationPlacement === "story");
  const activeMediaMode =
    activeCard === "instagram"
      ? instagramMediaMode
      : activeCard === "facebook"
        ? facebookMediaMode
        : "none";
  const activeVerticalImageMotion =
    (instagramVerticalFormat || facebookVerticalFormat) &&
    activeMediaMode === "images";
  const activeTextGuidelines = CHANNEL_TEXT_GUIDELINES[activeCard];
  const titleVoiceMaxLength = Math.max(
    activePost.title.length,
    activeTextGuidelines.title,
  );
  const contentFormattingLength = isSiteDisplayKey(activeCard)
    ? Math.max(
        0,
        activePost.content.length - stripSiteTextFormatting(activePost.content).length,
      )
    : 0;
  const contentVoiceMaxLength = Math.max(
    activePost.content.length,
    activeTextGuidelines.content + contentFormattingLength,
  );

  const duplicateAction = (
    <button
      type="button"
      className={`${styles.secondaryBtn} ${css.duplicateButton}`}
      data-publish-duplicate-action
      onClick={onDuplicateContentToAllChannels}
      disabled={displayCards.length < 2 || voiceBusy}
      aria-label={i18nT("dupliquer_ce_contenu_sur_tous_les_464b623c")}
      title={i18nT("dupliquer_ce_contenu_sur_tous_les_464b623c")}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></svg>
      {i18nT("wizard_duplicate")}
    </button>
  );

  const footerActions = (
    <div className={css.footerActions} data-publish-content-footer-actions>
      <AiContentReportButton
        className={css.reportButton}
        surface={`booster:${activeCard}`}
        content={`${getDisplayPost(activeCard).title}\n${getDisplayPost(activeCard).content}`}
      />
      {duplicateAction}
    </div>
  );

  return (
    <div
      className={css.editor}
      data-publish-content-editor
      style={{ "--editor-accent": PUBLISH_CHANNEL_IDENTITY[activeCard].color, "--editor-rgb": PUBLISH_CHANNEL_IDENTITY[activeCard].rgb } as CSSProperties}
    >
      <PublishStepTitle
        styles={styles}
        step={stepNumber}
        style={{ marginBottom: 8 }}
      >
        {creationMode === "manual"
          ? i18nT("textes_par_canal_bf3c7397")
          : i18nT("contenus_generes_par_canal_5197ef4e")}
      </PublishStepTitle>
      {displayCards.length ? (
        <>
          <div className={css.rail}>
          <ChannelNavigationRail
            items={displayCards}
            getItemLabel={(channel) => getLocalizedChannelLabel(channel, runtimeT)}
            getItemIcon={(channel) => PUBLISH_CHANNEL_IDENTITY[channel].icon}
            activeItem={activeCard}
            onSelect={(channel) => setSynchronizedActiveChannel(channel)}
            disabled={voiceBusy}
            navigationLabel={
              creationMode === "manual"
                ? i18nT("textes_par_canal_bf3c7397")
                : i18nT("contenus_generes_par_canal_5197ef4e")
            }
            rootStyle={{ marginBottom: 12 }}
            trackStyle={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "repeat(2, minmax(0, 1fr))"
                : `repeat(${Math.max(1, displayCards.length)}, minmax(0, 1fr))`,
              gap: isMobile ? 8 : 6,
              marginBottom: 12,
              minWidth: 0,
              width: "100%",
            }}
          >
            {displayCards.map((key) => {
              const post = getDisplayPost(key);
              const xUrlBlocked =
                key === "x" &&
                getBoosterXForbiddenUrlFields(
                  post,
                  { hashtagsInput: xHashtagsInput },
                ).length > 0;
              const hasText = !!(
                String(post.title || "").trim() ||
                String(post.content || "").trim()
              );
              const statusStyle = xUrlBlocked
                ? {
                    border: "1px solid rgba(248,113,113,0.48)",
                    color: "#fecaca",
                    background: "rgba(248,113,113,0.12)",
                  }
                : hasText
                ? {
                    border: "1px solid rgba(34,197,94,0.34)",
                    color: "#bbf7d0",
                    background: "rgba(34,197,94,0.10)",
                  }
                : {
                    border: "1px solid rgba(251,191,36,0.36)",
                    color: "#fde68a",
                    background: "rgba(251,191,36,0.10)",
                  };
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSynchronizedActiveChannel(key)}
                  disabled={voiceBusy}
                  className={css.channelButton}
                  aria-pressed={activeCard === key}
                  data-active={activeCard === key}
                  data-content-state={xUrlBlocked ? "blocked" : hasText ? "ready" : "empty"}
                  title={
                    xUrlBlocked
                      ? "X est bloqué : retirez le lien détecté."
                      : hasText
                        ? i18nT("content_text_present")
                        : i18nT("content_text_to_review")
                  }
                  style={{
                    ...({ "--channel-accent": PUBLISH_CHANNEL_IDENTITY[key].color, "--channel-rgb": PUBLISH_CHANNEL_IDENTITY[key].rgb } as CSSProperties),
                    ...pillBtn,
                    ...statusStyle,
                    ...(activeCard === key
                      ? {
                          border: xUrlBlocked
                            ? "2px solid rgba(248,113,113,0.92)"
                            : hasText
                              ? "2px solid rgba(74,222,128,0.90)"
                              : "2px solid rgba(250,204,21,0.92)",
                          boxShadow: xUrlBlocked
                            ? "0 0 0 1px rgba(248,113,113,0.28) inset, 0 0 0 1px rgba(248,113,113,0.22), 0 0 18px rgba(248,113,113,0.20)"
                            : hasText
                              ? "0 0 0 1px rgba(74,222,128,0.26) inset, 0 0 0 1px rgba(74,222,128,0.20), 0 0 18px rgba(74,222,128,0.20)"
                              : "0 0 0 1px rgba(250,204,21,0.26) inset, 0 0 0 1px rgba(250,204,21,0.20), 0 0 18px rgba(250,204,21,0.16)",
                        }
                      : {}),
                    width: "100%",
                    minWidth: 0,
                    minHeight: isMobile ? 43 : 36,
                    boxSizing: "border-box",
                    padding: isMobile ? "4px 6px" : "0 6px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: isMobile ? "visible" : "hidden",
                    whiteSpace: isMobile ? "normal" : "nowrap",
                    textOverflow: isMobile ? "clip" : "ellipsis",
                    fontSize: isMobile ? "clamp(10px, 3.1vw, 13px)" : "clamp(8px, 0.78vw, 13px)",
                    lineHeight: isMobile ? 1.18 : 1.1,
                    cursor: voiceBusy ? "not-allowed" : "pointer",
                    opacity: voiceBusy && activeCard !== key ? 0.58 : 1,
                  }}
                >
                  <img className={css.channelLogo} src={PUBLISH_CHANNEL_IDENTITY[key].icon} alt="" aria-hidden="true" />
                  <span className={css.channelLabel}>{getLocalizedChannelLabel(key, runtimeT)}</span>
                  <span className={css.channelDot} aria-hidden="true" />
                </button>
              );
            })}
          </ChannelNavigationRail>
          </div>
          <div
            className={css.card}
            style={{
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 16,
              padding: 12,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div
              className={css.editorTopbar}
              style={{
                display: activeCard === "threads" ? "grid" : "flex",
                gridTemplateColumns: activeCard === "threads" ? "auto minmax(0, 1fr)" : undefined,
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
                minWidth: 0,
              }}
            >
              <div className={css.publicationFormats}>
              {activeCard === "pinterest" ? (
                <label className={css.boardField}>
                <span>{i18nT("wizard_board")}</span>
                <select
                  value={pinterestBoardId}
                  onChange={(event) =>
                    onPinterestBoardChange(event.target.value)
                  }
                  disabled={pinterestBoardsLoading || !pinterestBoards.length}
                  aria-label={i18nT("tableau_pinterest_1af82867")}
                  title={i18nT("tableau_pinterest_1af82867")}
                  style={{
                    ...darkSelectStyle,
                    width: isMobile ? "min(58vw, 220px)" : "min(360px, 45%)",
                    minWidth: isMobile ? 150 : 200,
                    maxWidth: "100%",
                    flex: "0 1 auto",
                  }}
                >
                  {!pinterestBoards.length ? (
                    <option value="" style={darkOptionStyle}>
                      {pinterestBoardsLoading ? i18nT("chargement_01cba1df") : i18nT("aucun_tableau_d327ddcf")}
                    </option>
                  ) : !pinterestBoardId ? (
                    <option value="" style={darkOptionStyle}>
                      {i18nT("choisir_un_tableau_77f9de39")}{" "}</option>
                  ) : null}
                  {pinterestBoards.map((board) => (
                    <option
                      key={board.id}
                      value={board.id}
                      style={darkOptionStyle}
                    >
                      {board.name}
                    </option>
                  ))}
                </select>
                </label>
              ) : null}
              {activeCard === "threads" ? <ThreadsPublicationModeControls inline mode={threadsPublicationMode} preferences={threadsPublicationPreferences} loading={threadsPreferencesLoading} failed={threadsPreferencesFailed} disabled={voiceBusy} onChange={onThreadsPublicationModeChange} /> : null}
              {activeCard === "instagram" ? (
                <MetaPublicationFormatControls
                  label={i18nT("instagram_publication_format")}
                  primaryPlacement={instagramPublicationPlacement}
                  reelsEnabled={instagramPublicationPreferences.reelsEnabled}
                  storyEnabled={instagramStoryEnabled}
                  storiesEnabled={instagramPublicationPreferences.storiesEnabled}
                  disabled={voiceBusy}
                  classicLabel={i18nT("instagram_classic")}
                  reelLabel={i18nT("instagram_reels")}
                  storyLabel={i18nT("instagram_stories")}
                  onPrimaryPlacementChange={
                    onInstagramPublicationPlacementChange
                  }
                  onStoryEnabledChange={onInstagramStoryEnabledChange}
                />
              ) : null}
              {activeCard === "facebook" ? (
                <MetaPublicationFormatControls
                  label={i18nT("facebook_publication_format")}
                  primaryPlacement={facebookPublicationPlacement}
                  reelsEnabled={facebookPublicationPreferences.reelsEnabled}
                  storyEnabled={facebookStoryEnabled}
                  storiesEnabled={facebookPublicationPreferences.storiesEnabled}
                  disabled={voiceBusy}
                  classicLabel={i18nT("instagram_classic")}
                  reelLabel={i18nT("instagram_reels")}
                  storyLabel={i18nT("instagram_stories")}
                  onPrimaryPlacementChange={
                    onFacebookPublicationPlacementChange
                  }
                  onStoryEnabledChange={onFacebookStoryEnabledChange}
                />
              ) : null}
              </div>
              <div className={css.sharedTools} data-publish-shared-toolbar data-active-field={activeTextField}>
                <span className={css.toolTarget} aria-live="polite">{i18nT(activeTextField === "title" ? "titre_eb97899a" : "contenu_f3cb82af")}</span>
                {renderFormattingTools(activeTextField)}
                {creationMode === "manual" ? (
                  <MediaSubjectVoiceButton
                    key={`manual-voice:${activeCard}:${activeTextField}`}
                    purpose={activeTextField}
                    placement="inline"
                    mergeMode={activeTextField === "title" ? "space" : "paragraph"}
                    maxLength={activeTextField === "title" ? titleVoiceMaxLength : contentVoiceMaxLength}
                    value={activePost[activeTextField]}
                    disabled={activeStoryOnly || isVoiceTargetDisabled(activeCard, activeTextField)}
                    onBusyChange={(busy) => handleVoiceBusyChange(activeCard, activeTextField, busy)}
                    onChange={(value) => updatePost(activeCard, { [activeTextField]: value }, isSiteDisplayKey(activeCard) ? undefined : { sanitize: false })}
                  />
                ) : null}
              </div>
            </div>
            {activeCard === "pinterest" && pinterestBoardsError ? (
              <div style={{ marginBottom: 8, fontSize: 12, color: "#fecaca" }}>
                {pinterestBoardsError}
              </div>
            ) : activeCard === "pinterest" &&
              !pinterestBoardsLoading &&
              !pinterestBoards.length ? (
              <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.72 }}>
                {i18nT("aucun_tableau_disponible_creez_en_un_fdb1c0ea")}{" "}</div>
            ) : null}
            {activeVerticalImageMotion || activeStoryEnabled ? (
              <div
                role="status"
                style={{
                  marginBottom: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(76,195,255,0.28)",
                  background: "rgba(76,195,255,0.08)",
                  color: "rgba(226,247,255,0.92)",
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                {activeVerticalImageMotion
                  ? i18nT("instagram_image_motion_notice")
                  : null}
                {activeVerticalImageMotion && activeStoryEnabled ? " " : null}
                {activeStoryEnabled
                  ? i18nT("instagram_review_media_only_warning", {
                      mode: i18nT("instagram_stories"),
                    })
                  : null}
              </div>
            ) : null}
            {activeCard === "x" && xForbiddenUrlFields.length ? (
              <div
                role="alert"
                data-x-url-blocker="true"
                style={{
                  marginBottom: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(248,113,113,0.42)",
                  background: "rgba(248,113,113,0.12)",
                  color: "#fecaca",
                  fontSize: 12,
                  lineHeight: 1.45,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span>{getBoosterXUrlBlockerMessage(xForbiddenUrlFields)}</span>
                {xForbiddenCtaUrlFields.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      const invalidFields = new Set(
                        xForbiddenCtaUrlFields.map((field) => field.field),
                      );
                      updatePost(
                        "x",
                        {
                          ...(invalidFields.has("cta") ? { cta: "" } : {}),
                          ...(invalidFields.has("ctaUrl")
                            ? { ctaUrl: "" }
                            : {}),
                          ...(invalidFields.has("ctaPhone")
                            ? { ctaPhone: "" }
                            : {}),
                        },
                        { sanitize: false },
                      );
                    }}
                    style={{
                      ...pillBtn,
                      border: "1px solid rgba(248,113,113,0.44)",
                      background: "rgba(127,29,29,0.34)",
                      color: "#fee2e2",
                      flex: "0 0 auto",
                    }}
                  >
                    Retirer le lien du CTA
                  </button>
                ) : null}
              </div>
            ) : null}
            <fieldset
              className={css.fields}
              disabled={activeStoryOnly}
              aria-disabled={activeStoryOnly}
              data-meta-story-only-content={activeStoryOnly ? "disabled" : "enabled"}
              style={{
                display: "grid",
                gap: 10,
                minWidth: 0,
                margin: 0,
                padding: 0,
                border: 0,
                opacity: activeStoryOnly ? 0.42 : 1,
                pointerEvents: activeStoryOnly ? "none" : "auto",
                transition: "opacity 160ms ease",
              }}
            >
              <div className={css.titleField}
                data-active-field={activeTextField === "title"}
                onFocusCapture={() => { if (!voiceBusy) setActiveTextField("title"); }}
                onBlurCapture={() => rememberTextSelection("title")}
                onPointerUp={() => rememberTextSelection("title")}
                onKeyUp={() => rememberTextSelection("title")}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    {i18nT("titre_eb97899a")}{" "}
                  </div>
                </div>
                {isSiteDisplayKey(activeCard) ? (
                  <RichSiteContentEditor value={activePost.title} onChange={(title) => updatePost(activeCard, { title })}
                    minHeight={42} editorRef={titleEditorRef} multiline={false} readOnly={voiceBusy}
                    ariaLabel={i18nT("titre_eb97899a")} className={css.titleRichField} style={inputStyle} />
                ) : (
                  <TitleControl
                    ref={(element: HTMLInputElement | HTMLTextAreaElement | null) => { titleInputRef.current = element; }}
                    rows={isMobile ? 2 : undefined}
                    aria-label={i18nT("titre_eb97899a")}
                    value={activePost.title}
                    readOnly={voiceBusy}
                    onKeyDown={(event) => {
                      keepEditorTypingInsideField(event);
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
                    }}
                    onChange={(e) =>
                      updatePost(
                        activeCard,
                        { title: e.target.value.replace(/[\r\n]+/g, " ") },
                        { sanitize: false },
                      )
                    }
                    style={inputStyle}

                  />
                )}
                {renderLimitCounter(
                  i18nT("titre_eb97899a"),
                  isSiteDisplayKey(activeCard) ? stripSiteTextFormatting(getDisplayPost(activeCard).title).length : getDisplayPost(activeCard).title.length,
                  CHANNEL_TEXT_GUIDELINES[activeCard].title,
                )}
              </div>
              <div className={css.bodyField}
                data-active-field={activeTextField === "content"}
                onFocusCapture={() => { if (!voiceBusy) setActiveTextField("content"); }}
                onBlurCapture={() => rememberTextSelection("content")}
                onPointerUp={() => rememberTextSelection("content")}
                onKeyUp={() => rememberTextSelection("content")}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 6,
                    flexWrap: "wrap",
                  }}
                >
                   <div style={{ fontSize: 12, opacity: 0.85 }}>
                     {activeCard === "inr_search"
                       ? i18nT("phrase_courte_inr_search_ee6e97e1")
                       : i18nT("contenu_f3cb82af")}
                   </div>
                </div>
                {isSiteDisplayKey(activeCard) ? (
                  <RichSiteContentEditor
                    value={activePost.content}
                    ariaLabel={i18nT("contenu_f3cb82af")}
                    onChange={(content) => updatePost(activeCard, { content })}
                    minHeight={280}
                    editorRef={siteContentEditorRef}
                    style={{
                      ...textAreaStyle,
                      pointerEvents: voiceBusy ? "none" : "auto",
                      opacity: voiceBusy ? 0.76 : 1,
                    }}
                  />
                ) : (
                  <textarea
                    ref={(element) => {
                      contentTextAreaRef.current = element;
                    }}
                    value={activePost.content}
                    readOnly={voiceBusy}
                    onKeyDown={keepEditorTypingInsideField}
                    onChange={(e) => {
                      updatePost(
                        activeCard,
                        { content: e.target.value },
                        { sanitize: false },
                      );
                    }}
                    style={{
                      ...textAreaStyle,
                      minHeight: 280,
                      height: isMobile ? 260 : 280,
                      maxHeight: isMobile ? 360 : 420,
                      resize: "vertical",
                      overflowY: "auto",
                    }}
                    rows={10}
                    aria-label={i18nT("contenu_f3cb82af")}
                  />
                )}
                {renderLimitCounter(
                  i18nT("contenu_f3cb82af"),
                  isSiteDisplayKey(activeCard)
                    ? stripSiteTextFormatting(
                        getDisplayPost(activeCard).content,
                      ).length
                    : getDisplayPost(activeCard).content.length,
                  CHANNEL_TEXT_GUIDELINES[activeCard].content,
                )}
              </div>
              <aside className={css.options}>
              <div>
                {(() => {
                  const currentPost = getDisplayPost(activeCard);
                  const ctaChoice = getPreferredCtaChoiceFromPost(
                    activeCard,
                    currentPost,
                  );
                  const ctaMode = getCtaModeForPreferredChoice(ctaChoice);
                  const updateTarget = activeCard;
                  const activeWebsiteUrl = getWebsiteUrlForChannel(
                    activeCard,
                    ctaDefaults,
                  );
                  const activeWebsiteSourceLabel =
                    getLocalizedWebsiteSourceLabelForChannel(activeCard, ctaDefaults, runtimeT);
                  const ctaGridColumns = isMobile ? "minmax(0, 1fr)"
                    : ctaMode === "website" || ctaMode === "custom" ? "minmax(180px, .8fr) minmax(0, 1.1fr) minmax(0, 1fr)"
                    : ctaMode === "call" ? "minmax(180px, .9fr) minmax(0, 1.1fr)" : "minmax(180px, .9fr)";

                  return (
                    <>
                      <div
                        className={css.ctaGrid}
                        style={{
                          display: "grid",
                          gridTemplateColumns: ctaGridColumns,
                          gap: 10,
                          alignItems: "start",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: 12,
                              opacity: 0.85,
                              marginBottom: 6,
                            }}
                          >
                            {activeCard === "x"
                              ? "CTA intégré au texte"
                              : i18nT("bouton_fd5aea71")}{" "}</div>
                          <select
                            aria-label={activeCard === "x" ? "CTA intégré au texte" : i18nT("bouton_fd5aea71")}
                            value={ctaChoice}
                            disabled={voiceBusy}
                            onChange={(e) =>
                              applyPreferredCtaPrefill(
                                activeCard,
                                e.target.value as BoosterPreferredCta,
                              )
                            }
                            style={darkSelectStyle}
                          >
                            {getPreferredCtaOptionsForChannel(activeCard).map((option) => (
                              <option
                                key={option.value}
                                value={option.value}
                                style={darkOptionStyle}
                              >
                                {getLocalizedPreferredCtaLabel(option.value, runtimeT)}
                              </option>
                            ))}
                          </select>
                        </div>
                        {ctaMode === "website" ? (
                          <>
                            <div>
                              <div
                                style={{
                                  fontSize: 12,
                                  opacity: 0.85,
                                  marginBottom: 6,
                                }}
                              >
                                {i18nT("url_de_destination_f11980ae")}{" "}</div>
                              <input
                                aria-label={i18nT("url_de_destination_f11980ae")}
                                value={currentPost.ctaUrl || ""}
                                readOnly={voiceBusy}
                                onChange={(e) =>
                                  updatePost(updateTarget, {
                                    ctaUrl: e.target.value,
                                  })
                                }
                                style={lightFieldStyle}
                                placeholder={
                                  activeWebsiteUrl
                                    ? i18nT("website_url_prefilled", { source: activeWebsiteSourceLabel })
                                    : i18nT("website_url_optional")
                                }
                              />
                            </div>
                            <div>
                              <div
                                style={{
                                  fontSize: 12,
                                  opacity: 0.85,
                                  marginBottom: 6,
                                }}
                              >
                                {activeCard === "x"
                                  ? "Texte du CTA"
                                  : i18nT("texte_du_bouton_5bc213b4")}{" "}
                              </div>
                              <input
                                aria-label={activeCard === "x" ? "Texte du CTA" : i18nT("texte_du_bouton_5bc213b4")}
                                value={currentPost.cta}
                                readOnly={voiceBusy}
                                onChange={(e) =>
                                  updatePost(updateTarget, {
                                    cta: e.target.value,
                                  })
                                }
                                style={lightFieldStyle}
                                placeholder={i18nT("texte_du_bouton_ex_value_872ff84c", { value0: getLocalizedChannelDefaultCtaLabel("website", runtimeT) })}
                              />
                            </div>
                          </>
                        ) : null}
                        {ctaMode === "call" ? (
                          <div>
                            <div
                              style={{
                                fontSize: 12,
                                opacity: 0.85,
                                marginBottom: 6,
                              }}
                            >
                              {i18nT("telephone_d3b023ea")}{" "}</div>
                            <input
                              aria-label={i18nT("telephone_d3b023ea")}
                              value={currentPost.ctaPhone || ""}
                              readOnly={voiceBusy}
                              onChange={(e) =>
                                updatePost(updateTarget, {
                                  ctaPhone: e.target.value,
                                })
                              }
                              style={lightFieldStyle}
                              placeholder={
                                ctaDefaults?.phone
                                  ? i18nT("phone_prefilled_from_profile")
                                  : i18nT("phone_optional")
                              }
                            />
                          </div>
                        ) : null}
                        {ctaMode === "custom" ? (
                          <>
                            {ctaChoice === "whatsapp" ? (
                              <div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    opacity: 0.85,
                                    marginBottom: 6,
                                  }}
                                >
                                  {i18nT("telephone_d3b023ea")}{" "}
                                </div>
                                <input
                                  aria-label={i18nT("telephone_d3b023ea")}
                                  inputMode="tel"
                                  value={
                                    currentPost.ctaPhone ||
                                    getBoosterWhatsAppPhoneFromUrl(currentPost.ctaUrl)
                                  }
                                  readOnly={voiceBusy}
                                  onChange={(e) =>
                                    updatePost(updateTarget, {
                                      ctaPhone: e.target.value,
                                      ctaUrl: buildBoosterWhatsAppUrl(e.target.value),
                                    })
                                  }
                                  style={lightFieldStyle}
                                  placeholder={
                                    ctaDefaults?.phone
                                      ? i18nT("phone_prefilled_from_profile")
                                      : i18nT("phone_optional")
                                  }
                                />
                              </div>
                            ) : (
                              <div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    opacity: 0.85,
                                    marginBottom: 6,
                                  }}
                                >
                                  {i18nT("url_de_destination_f11980ae")}{" "}</div>
                                <input
                                  aria-label={i18nT("url_de_destination_f11980ae")}
                                  value={currentPost.ctaUrl || ""}
                                  readOnly={voiceBusy}
                                  onChange={(e) =>
                                    updatePost(updateTarget, {
                                      ctaUrl: e.target.value,
                                    })
                                  }
                                  style={lightFieldStyle}
                                  placeholder={i18nT("url_personnalisee_optionnel_49f1857f")}
                                />
                              </div>
                            )}
                            <div>
                              <div
                                style={{
                                  fontSize: 12,
                                  opacity: 0.85,
                                  marginBottom: 6,
                                }}
                              >
                                {activeCard === "x"
                                  ? "Texte du CTA"
                                  : i18nT("texte_du_bouton_5bc213b4")}{" "}
                              </div>
                              <input
                                value={currentPost.cta}
                                readOnly={voiceBusy}
                                onChange={(e) =>
                                  updatePost(updateTarget, {
                                    cta: e.target.value,
                                  })
                                }
                                style={lightFieldStyle}
                                placeholder={i18nT("ex_en_savoir_plus_8c60a773")}
                              />
                            </div>
                          </>
                        ) : null}
                      </div>
                      <div data-publish-field-help
                        style={{
                          fontSize: 11,
                          marginTop: 6,
                          color: "rgba(255,255,255,0.62)",
                          lineHeight: 1.45,
                        }}
                      >
                        {getLocalizedCtaModeHelp(
                          activeCard,
                          ctaMode,
                          runtimeT,
                          ctaChoice,
                        )}
                      </div>
                      {ctaMode === "call" && activeCard !== "gmb" && getCtaPhone(currentPost, { phone: ctaDefaults?.phone || "" }) ? (
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            marginTop: 8,
                            color: "rgba(255,255,255,0.9)",
                          }}
                        >
                          {buildCtaTextForChannel(activeCard, currentPost, {
                            websiteUrl: activeWebsiteUrl,
                            phone: ctaDefaults?.phone || "",
                          })}
                        </div>
                      ) : null}
                      {ctaMode === "website" && activeWebsiteUrl ? (
                        <div data-publish-field-help
                          style={{
                            fontSize: 11,
                            marginTop: 8,
                            color: "rgba(255,255,255,0.62)",
                            lineHeight: 1.45,
                          }}
                        >
                          {i18nT("website_default_available_from", {
                            source: activeWebsiteSourceLabel,
                            url: activeWebsiteUrl,
                          })}
                        </div>
                      ) : null}
                      {(ctaMode === "call" || ctaChoice === "whatsapp") &&
                      ctaDefaults?.phone ? (
                        <div data-publish-field-help
                          style={{
                            fontSize: 11,
                            marginTop: 8,
                            color: "rgba(255,255,255,0.62)",
                            lineHeight: 1.45,
                          }}
                        >
                          {i18nT("valeur_par_defaut_disponible_depuis_mon_841d60a8")}{" "}
                          {ctaDefaults.phone}
                        </div>
                      ) : null}
                      {ctaMode === "website" || ctaMode === "custom"
                        ? renderLimitCounter(
                            activeCard === "x"
                              ? "CTA"
                              : i18nT("bouton_fd5aea71"),
                            currentPost.cta.length,
                            CHANNEL_TEXT_GUIDELINES[activeCard].cta,
                          )
                        : null}
                    </>
                  );
                })()}
              </div>
              {activeCard === "instagram" ? (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {i18nT("hashtags_338da6e1")}{" "}
                    </div>
                    {creationMode === "manual" ? (
                      <MediaSubjectVoiceButton
                        key="manual-voice:instagram:hashtags"
                        purpose="hashtags"
                        placement="inline"
                        mergeMode="space"
                        maxLength={Math.max(
                          instagramHashtagsInput.length,
                          INSTAGRAM_HASHTAGS_INPUT_MAX_LENGTH,
                        )}
                        value={instagramHashtagsInput}
                        disabled={isVoiceTargetDisabled(
                          "instagram",
                          "hashtags",
                        )}
                        onBusyChange={(busy) =>
                          handleVoiceBusyChange(
                            "instagram",
                            "hashtags",
                            busy,
                          )
                        }
                        onChange={(nextInput) => {
                          setInstagramHashtagsInput(nextInput);
                          updatePost("instagram", {
                            hashtags: parseInstagramHashtagsInput(nextInput),
                          });
                        }}
                      />
                    ) : null}
                  </div>
                  <input
                    value={instagramHashtagsInput}
                    readOnly={voiceBusy}
                    onChange={(e) => setInstagramHashtagsInput(e.target.value)}
                    onBlur={() =>
                      updatePost("instagram", {
                        hashtags: getLiveInstagramHashtags(),
                      })
                    }
                    style={inputStyle}
                    placeholder={i18nT("local_metier_fb03ef96")}
                  />
                  {renderLimitCounter(
                    i18nT("hashtags_338da6e1"),
                    getLiveInstagramHashtags().length,
                    CHANNEL_TEXT_GUIDELINES.instagram.hashtags || 20,
                  )}
                </div>
              ) : null}
              {activeCard === "x" ? (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {i18nT("hashtags_338da6e1")} — 2 maximum
                    </div>
                    {creationMode === "manual" ? (
                      <MediaSubjectVoiceButton
                        key="manual-voice:x:hashtags"
                        purpose="hashtags"
                        placement="inline"
                        mergeMode="space"
                        maxLength={Math.max(
                          xHashtagsInput.length,
                          X_HASHTAGS_INPUT_MAX_LENGTH,
                        )}
                        value={xHashtagsInput}
                        disabled={isVoiceTargetDisabled("x", "hashtags")}
                        onBusyChange={(busy) =>
                          handleVoiceBusyChange("x", "hashtags", busy)
                        }
                        onChange={(nextInput) => {
                          setXHashtagsInput(nextInput);
                          if (!getBoosterXForbiddenUrlFields(
                            { hashtags: [] },
                            { hashtagsInput: nextInput },
                          ).length) {
                            updatePost("x", {
                              hashtags: parseInstagramHashtagsInput(nextInput).slice(
                                0,
                                2,
                              ),
                            });
                          }
                        }}
                      />
                    ) : null}
                  </div>
                  <input
                    value={xHashtagsInput}
                    readOnly={voiceBusy}
                    onChange={(event) => setXHashtagsInput(event.target.value)}
                    onBlur={() => {
                      if (
                        getBoosterXForbiddenUrlFields(
                          { hashtags: [] },
                          { hashtagsInput: xHashtagsInput },
                        ).length
                      ) {
                        return;
                      }
                      updatePost("x", { hashtags: getLiveXHashtags() });
                    }}
                    style={inputStyle}
                    placeholder={i18nT("local_metier_fb03ef96")}
                  />
                  {renderLimitCounter(
                    i18nT("hashtags_338da6e1"),
                    getLiveXHashtags().length,
                    CHANNEL_TEXT_GUIDELINES.x.hashtags || 2,
                  )}
                </div>
              ) : null}
              {CHANNEL_TEXT_GUIDELINES[activeCard].totalLabel &&
              CHANNEL_TEXT_GUIDELINES[activeCard].totalMax &&
              CHANNEL_TEXT_GUIDELINES[activeCard].totalValue ? (
                <div style={{ marginTop: 2 }}>
                  {renderLimitCounter(
                    getLocalizedChannelTotalLabel(activeCard, runtimeT),
                    activeCard === "instagram" && activeStoryOnly
                      ? 0
                      : CHANNEL_TEXT_GUIDELINES[activeCard].totalValue!(
                          activeCard === "instagram"
                            ? {
                                ...getDisplayPost(activeCard),
                                hashtags: getLiveInstagramHashtags(),
                              }
                            : getDisplayPost(activeCard),
                          {
                            websiteUrl: getWebsiteUrlForChannel(
                              activeCard,
                              ctaDefaults,
                            ),
                            phone: ctaDefaults?.phone || "",
                          },
                          {
                            youtubeAutoHashtags:
                              ctaDefaults?.youtubeAutoHashtags !== false,
                          },
                        ),
                    CHANNEL_TEXT_GUIDELINES[activeCard].totalMax!,
                  )}
                </div>
              ) : null}
              </aside>
            </fieldset>
            {duplicateFeedback ? (
              <div className={css.duplicateFeedback}
                role={duplicateFeedback.kind === "error" ? "alert" : "status"}
                data-publish-duplicate-feedback={duplicateFeedback.kind}>
                {duplicateFeedback.message}
              </div>
            ) : null}
          </div>
          {actionsContainer ? createPortal(footerActions, actionsContainer) : footerActions}
        </>
      ) : (
        <div style={{ fontSize: 13, opacity: 0.75 }}>
          {i18nT("selectionnez_d_abord_vos_canaux_224225ce")}{" "}</div>
      )}
    </div>
  );
}
