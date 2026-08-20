import { useTranslations } from "next-intl";
import type {
  Dispatch,
  KeyboardEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useRef } from "react";
import type { BoosterCreationMode } from "@/lib/boosterCreationMode";
import { editableHtmlToSiteText, stripSiteTextFormatting } from "@/lib/boosterFormatting";
import { readSanitizedElementHtml } from "@/lib/sanitizeHtml";
import EmojiPickerButton from "@/app/dashboard/_components/EmojiPickerButton";
import AiContentReportButton from "@/app/dashboard/_components/AiContentReportButton";
import {
  BOOSTER_PREFERRED_CTA_OPTIONS,
  CHANNEL_TEXT_GUIDELINES,
  getLocalizedChannelDefaultCtaLabel,
  getLocalizedChannelLabel,
  getLocalizedChannelTotalLabel,
  getLocalizedCtaModeHelp,
  getLocalizedPreferredCtaLabel,
  getLocalizedWebsiteSourceLabelForChannel,
  getPreferredCtaChoiceFromPost,
  getWebsiteUrlForChannel,
  isSiteDisplayKey,
  renderLimitCounter,
  type BoosterCtaDefaults,
  type BoosterPreferredCta,
  type ChannelKey,
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
import PublishStepTitle from "./PublishStepTitle";

type PublishModalStyles = Readonly<Record<string, string>>;

type DuplicateFeedback = {
  kind: "success" | "error";
  message: string;
} | null;

type PublishContentEditorPanelProps = {
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
  duplicateFeedback: DuplicateFeedback;
  onDuplicateContentToAllChannels: () => void;
  pinterestBoards: Array<{ id: string; name: string }>;
  pinterestBoardId: string;
  pinterestBoardsLoading: boolean;
  pinterestBoardsError: string;
  onPinterestBoardChange: (boardId: string) => void;
};

export default function PublishContentEditorPanel({
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
  duplicateFeedback,
  onDuplicateContentToAllChannels,
  pinterestBoards,
  pinterestBoardId,
  pinterestBoardsLoading,
  pinterestBoardsError,
  onPinterestBoardChange,
}: PublishContentEditorPanelProps) {
  const i18nT = useTranslations("booster");
  const runtimeT = i18nT as unknown as (key: string) => string;
  const siteEmojiSelectionRef = useRef<Range | null>(null);
  const plainEmojiSelectionRef = useRef<{ start: number; end: number } | null>(null);

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

  return (
    <div
      className={styles.blockCard}
      style={{ minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}
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
      <div
        className={styles.subtitle}
        style={{ marginBottom: 10, maxWidth: "none", whiteSpace: "normal" }}
      >
        {creationMode === "manual"
          ? i18nT("redigez_directement_le_texte_de_chaque_83f7eae7")
          : i18nT("verifiez_les_contenus_generes_et_adaptez_8907d2ac")}
      </div>
      {displayCards.length ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(10, minmax(0, 1fr))",
              gap: isMobile ? 8 : 6,
              marginBottom: 12,
              minWidth: 0,
              width: "100%",
            }}
          >
            {displayCards.map((key) => {
              const post = getDisplayPost(key);
              const hasText = !!(
                String(post.title || "").trim() ||
                String(post.content || "").trim()
              );
              const statusStyle = hasText
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
                  title={hasText ? i18nT("content_text_present") : i18nT("content_text_to_review")}
                  style={{
                    ...pillBtn,
                    ...statusStyle,
                    ...(activeCard === key
                      ? {
                          border: hasText
                            ? "2px solid rgba(74,222,128,0.90)"
                            : "2px solid rgba(250,204,21,0.92)",
                          boxShadow: hasText
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
                  }}
                >
                  {getLocalizedChannelLabel(key, runtimeT)}
                </button>
              );
            })}
          </div>
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 16,
              padding: 12,
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                marginBottom: 10,
                minWidth: 0,
              }}
            >
              <div style={{ fontWeight: 900, flex: "0 0 auto" }}>
                {getLocalizedChannelLabel(activeCard, runtimeT)}
              </div>
              {activeCard === "pinterest" ? (
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
              ) : null}
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
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>
                  {i18nT("titre_eb97899a")}{" "}</div>
                {isMobile ? (
                  <textarea
                    value={getDisplayPost(activeCard).title}
                    onKeyDown={keepEditorTypingInsideField}
                    onChange={(e) =>
                      updatePost(
                        activeCard,
                        { title: e.target.value },
                        { sanitize: false },
                      )
                    }
                    style={{
                      ...inputStyle,
                      minHeight: 64,
                      height: 64,
                      padding: "10px 14px",
                      lineHeight: 1.35,
                      resize: "none",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                    }}
                    rows={2}
                    placeholder={i18nT("titre_eb97899a")}
                  />
                ) : (
                  <input
                    value={getDisplayPost(activeCard).title}
                    onKeyDown={keepEditorTypingInsideField}
                    onChange={(e) =>
                      updatePost(
                        activeCard,
                        { title: e.target.value },
                        { sanitize: false },
                      )
                    }
                    style={inputStyle}
                    placeholder={i18nT("titre_eb97899a")}
                  />
                )}
                {renderLimitCounter(
                  i18nT("titre_eb97899a"),
                  getDisplayPost(activeCard).title.length,
                  CHANNEL_TEXT_GUIDELINES[activeCard].title,
                )}
              </div>
              <div>
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
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {!isSiteDisplayKey(activeCard) ? (
                      <span
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.48)",
                          marginRight: 2,
                        }}
                      >
                        {i18nT("formatage_reserve_au_site_internet_18e28060")}{" "}</span>
                    ) : null}
                    {(
                      [
                        ["bold", "B", i18nT("format_bold")],
                        ["italic", "I", i18nT("format_italic")],
                        ["underline", "U", i18nT("format_underline")],
                      ] as const
                    ).map(([kind, label, title]) => (
                      <button
                        key={kind}
                        type="button"
                        title={
                          isSiteDisplayKey(activeCard)
                            ? title
                            : i18nT("format_site_only")
                        }
                        aria-label={title}
                        disabled={!isSiteDisplayKey(activeCard)}
                        onMouseDown={(event) => {
                          if (event.cancelable) event.preventDefault();
                          applySiteContentFormat(kind);
                        }}
                        style={{
                          minWidth: 32,
                          height: 30,
                          borderRadius: 9,
                          border: isSiteDisplayKey(activeCard)
                            ? "1px solid rgba(76,195,255,0.35)"
                            : "1px solid rgba(255,255,255,0.10)",
                          background: isSiteDisplayKey(activeCard)
                            ? "rgba(76,195,255,0.12)"
                            : "rgba(255,255,255,0.04)",
                          color: isSiteDisplayKey(activeCard)
                            ? "#eaf7ff"
                            : "rgba(255,255,255,0.32)",
                          fontWeight: 900,
                          fontStyle: kind === "italic" ? "italic" : "normal",
                          textDecoration:
                            kind === "underline" ? "underline" : "none",
                          cursor: isSiteDisplayKey(activeCard)
                            ? "pointer"
                            : "not-allowed",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <EmojiPickerButton
                      onBeforeOpen={saveEmojiSelection}
                      onSelect={insertEmoji}
                      buttonStyle={{
                        minWidth: 32,
                        height: 30,
                        borderRadius: 9,
                        border: "1px solid rgba(76,195,255,0.35)",
                        background: "rgba(76,195,255,0.12)",
                        color: "#eaf7ff",
                        fontSize: 16,
                        cursor: "pointer",
                      }}
                    />
                  </div>
                </div>
                {isSiteDisplayKey(activeCard) ? (
                  <RichSiteContentEditor
                    value={getDisplayPost(activeCard).content}
                    onChange={(content) => updatePost(activeCard, { content })}
                    minHeight={280}
                    editorRef={siteContentEditorRef}
                    style={textAreaStyle}
                  />
                ) : (
                  <textarea
                    ref={(element) => {
                      contentTextAreaRef.current = element;
                    }}
                    value={getDisplayPost(activeCard).content}
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
                    placeholder={i18nT("contenu_f3cb82af")}
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
                {creationMode === "ai" ? (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <AiContentReportButton
                      surface={`booster:${activeCard}`}
                      content={`${getDisplayPost(activeCard).title}\n${getDisplayPost(activeCard).content}`}
                    />
                  </div>
                ) : null}
              </div>
              <div>
                {(() => {
                  const currentPost = getDisplayPost(activeCard);
                  const ctaMode = currentPost.ctaMode || "none";
                  const ctaChoice = getPreferredCtaChoiceFromPost(
                    activeCard,
                    currentPost,
                  );
                  const updateTarget = activeCard;
                  const activeWebsiteUrl = getWebsiteUrlForChannel(
                    activeCard,
                    ctaDefaults,
                  );
                  const activeWebsiteSourceLabel =
                    getLocalizedWebsiteSourceLabelForChannel(activeCard, ctaDefaults, runtimeT);
                  const websiteChoices = [
                    ctaDefaults?.inrcySiteUrl
                      ? { label: i18nT("site_inrcy_57016d6f"), url: ctaDefaults.inrcySiteUrl }
                      : null,
                    ctaDefaults?.siteWebUrl
                      ? { label: i18nT("site_web_7e78af33"), url: ctaDefaults.siteWebUrl }
                      : null,
                  ].filter(Boolean) as Array<{ label: string; url: string }>;
                  const ctaGridColumns = isMobile
                    ? "1fr"
                    : ctaMode === "website" || ctaMode === "custom"
                      ? "minmax(0, 0.8fr) minmax(0, 1.1fr) minmax(0, 1fr)"
                      : ctaMode === "call"
                        ? "minmax(0, 0.9fr) minmax(0, 1.1fr)"
                        : "minmax(0, 0.9fr)";

                  return (
                    <>
                      <div
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
                            {i18nT("bouton_fd5aea71")}{" "}</div>
                          <select
                            value={ctaChoice}
                            onChange={(e) =>
                              applyPreferredCtaPrefill(
                                activeCard,
                                e.target.value as BoosterPreferredCta,
                              )
                            }
                            style={darkSelectStyle}
                          >
                            {BOOSTER_PREFERRED_CTA_OPTIONS.map((option) => (
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
                                value={currentPost.ctaUrl || ""}
                                onChange={(e) =>
                                  updatePost(updateTarget, {
                                    ctaUrl: e.target.value,
                                  })
                                }
                                style={lightFieldStyle}
                                placeholder={
                                  activeWebsiteUrl
                                    ? i18nT("website_url_prefilled", { source: activeWebsiteSourceLabel })
                                    : websiteChoices.length > 1
                                      ? i18nT("website_choose_source")
                                      : i18nT("website_url_optional")
                                }
                              />
                              {websiteChoices.length ? (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 6,
                                    flexWrap: "wrap",
                                    marginTop: 7,
                                  }}
                                >
                                  {websiteChoices.map((choice) => (
                                    <button
                                      key={choice.label}
                                      type="button"
                                      onClick={() =>
                                        updatePost(updateTarget, {
                                          ctaUrl: choice.url,
                                        })
                                      }
                                      style={{
                                        border:
                                          currentPost.ctaUrl === choice.url
                                            ? "1px solid rgba(76,195,255,0.55)"
                                            : "1px solid rgba(255,255,255,0.14)",
                                        background:
                                          currentPost.ctaUrl === choice.url
                                            ? "rgba(76,195,255,0.14)"
                                            : "rgba(255,255,255,0.06)",
                                        color: "rgba(255,255,255,0.86)",
                                        borderRadius: 999,
                                        padding: "5px 9px",
                                        fontSize: 11,
                                        fontWeight: 800,
                                        cursor: "pointer",
                                      }}
                                    >
                                      {choice.label}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div>
                              <div
                                style={{
                                  fontSize: 12,
                                  opacity: 0.85,
                                  marginBottom: 6,
                                }}
                              >
                                {i18nT("texte_du_bouton_5bc213b4")}{" "}</div>
                              <input
                                value={currentPost.cta}
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
                              value={currentPost.ctaPhone || ""}
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
                                value={currentPost.ctaUrl || ""}
                                onChange={(e) =>
                                  updatePost(updateTarget, {
                                    ctaUrl: e.target.value,
                                  })
                                }
                                style={lightFieldStyle}
                                placeholder={i18nT("url_personnalisee_optionnel_49f1857f")}
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
                                {i18nT("texte_du_bouton_5bc213b4")}{" "}</div>
                              <input
                                value={currentPost.cta}
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
                      <div
                        style={{
                          fontSize: 11,
                          marginTop: 6,
                          color: "rgba(255,255,255,0.62)",
                          lineHeight: 1.45,
                        }}
                      >
                        {getLocalizedCtaModeHelp(activeCard, ctaMode, runtimeT)}
                      </div>
                      {ctaMode === "website" && activeWebsiteUrl ? (
                        <div
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
                      ) : ctaMode === "website" && websiteChoices.length > 1 ? (
                        <div
                          style={{
                            fontSize: 11,
                            marginTop: 8,
                            color: "rgba(255,255,255,0.62)",
                            lineHeight: 1.45,
                          }}
                        >
                          {i18nT("deux_sites_sont_connectes_choisissez_le_ec7d3ccc")}{" "}</div>
                      ) : null}
                      {ctaMode === "call" && ctaDefaults?.phone ? (
                        <div
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
                            i18nT("bouton_fd5aea71"),
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
                  <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 6 }}>
                    {i18nT("hashtags_338da6e1")}{" "}</div>
                  <input
                    value={instagramHashtagsInput}
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
              {CHANNEL_TEXT_GUIDELINES[activeCard].totalLabel &&
              CHANNEL_TEXT_GUIDELINES[activeCard].totalMax &&
              CHANNEL_TEXT_GUIDELINES[activeCard].totalValue ? (
                <div style={{ marginTop: 2 }}>
                  {renderLimitCounter(
                    getLocalizedChannelTotalLabel(activeCard, runtimeT),
                    CHANNEL_TEXT_GUIDELINES[activeCard].totalValue!(
                      activeCard === "instagram"
                        ? {
                            ...getDisplayPost(activeCard),
                            hashtags: getLiveInstagramHashtags(),
                          }
                        : getDisplayPost(activeCard),
                    ),
                    CHANNEL_TEXT_GUIDELINES[activeCard].totalMax!,
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color:
                  duplicateFeedback?.kind === "error"
                    ? "#ffb4b4"
                    : "rgba(255,255,255,0.72)",
              }}
            >
              {(duplicateFeedback?.message || null) ||
                i18nT("dupliquez_le_titre_et_le_contenu_30b8cc6a")}
            </div>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onDuplicateContentToAllChannels}
              disabled={displayCards.length < 2}
              style={{ marginLeft: "auto" }}
            >
              {i18nT("dupliquer_ce_contenu_sur_tous_les_464b623c")}{" "}</button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, opacity: 0.75 }}>
          {i18nT("selectionnez_d_abord_vos_canaux_224225ce")}{" "}</div>
      )}
    </div>
  );
}
