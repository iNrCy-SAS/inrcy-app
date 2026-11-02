"use client";

import type { Dispatch, SetStateAction } from "react";
import MediaSubjectVoiceButton from "../../_components/MediaSubjectVoiceButton";
import { appendInrAgentPublicationIdeaSlot, INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS, INR_AGENT_PUBLICATION_IDEA_MAX_LENGTH } from "@/lib/inrAgentSettings";
import type { AutomationKey } from "../_lib/agent.types";
import styles from "../agent.module.css";

type AgentPublicationIdeasEditorProps = {
  i18nT: (key: string, values?: Record<string, string | number>) => string;
  publicationIdeasDraft: string[];
  settingsPublicationIdeaEntries: Array<{ index: number; value: string }>;
  publicationIdeaStates: Record<string, { status: "active" | "disabled" | "used"; reserved_action_id: string | null; order_key: number }>;
  savedPublicationIdeas: string[];
  savedPublicationIdeaOrder: string[];
  publicationIdeaToggleBusy: string | null;
  publicationIdeasSaveState: "idle" | "saving";
  publicationIdeaDropTarget: string | null;
  setDraggedPublicationIdea: Dispatch<SetStateAction<string | null>>;
  draggedPublicationIdea: string | null;
  setPublicationIdeaDropTarget: Dispatch<SetStateAction<string | null>>;
  movePublicationIdea: (idea: string, targetIndex: number) => void;
  settingsPublicationIdeaVoiceBusy: boolean;
  publicationIdeaVoiceIndex: number | null;
  updateSettingsPublicationIdea: (index: number, value: string) => void;
  loadState: string;
  testNowKey: AutomationKey | null;
  setPublicationIdeaVoiceIndex: Dispatch<SetStateAction<number | null>>;
  togglePublicationIdea: (idea: string, active: boolean) => Promise<void>;
  settingsPublicationIdeaFieldCount: number;
  setPublicationIdeasDraft: Dispatch<SetStateAction<string[]>>;
};

/** Presentation only: persistence, voice state and ordering remain with the workspace. */
export default function AgentPublicationIdeasEditor({
  i18nT,
  publicationIdeasDraft,
  settingsPublicationIdeaEntries,
  publicationIdeaStates,
  savedPublicationIdeas,
  savedPublicationIdeaOrder,
  publicationIdeaToggleBusy,
  publicationIdeasSaveState,
  publicationIdeaDropTarget,
  setDraggedPublicationIdea,
  draggedPublicationIdea,
  setPublicationIdeaDropTarget,
  movePublicationIdea,
  settingsPublicationIdeaVoiceBusy,
  publicationIdeaVoiceIndex,
  updateSettingsPublicationIdea,
  loadState,
  testNowKey,
  setPublicationIdeaVoiceIndex,
  togglePublicationIdea,
  settingsPublicationIdeaFieldCount,
  setPublicationIdeasDraft,
}: AgentPublicationIdeasEditorProps) {
  return (
    <section className={styles.publicationIdeasPanel}>
                <header>
                  <div className={styles.publicationIdeasHeaderActions}>
                    <details className={styles.publicationIdeasHelp}>
                      <summary aria-label={i18nT("publication_ideas_help_label")} title={i18nT("publication_ideas_help_label")}>?</summary>
                      <div className={styles.publicationIdeasHelpContent}>
                        <strong>{i18nT("publication_ideas_help_label")}</strong>
                        <p>{i18nT("publication_ideas_description")}</p>
                        <p>{i18nT("publication_ideas_help_order")}</p>
                        <p>{i18nT("publication_ideas_help_consumption")}</p>
                        <p>{i18nT("publication_ideas_help_reactivation")}</p>
                        <p>{i18nT("publication_ideas_help_fallback")}</p>
                        <p>{i18nT("publication_ideas_hint")}</p>
                      </div>
                    </details>
                    <span className={styles.publicationIdeasCount}>
                      {publicationIdeasDraft.filter((idea) => idea.trim()).length}
                      /{INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS}
                    </span>
                  </div>
                </header>
                <div className={styles.publicationIdeasGrid}>
                  {settingsPublicationIdeaEntries.map(
                    ({ index, value }, visualIndex) => {
                      const inputId = `publication-idea-${index}`;
                      const ideaState = publicationIdeaStates[value];
                      const ideaIsSaved = Boolean(value && savedPublicationIdeas.includes(value));
                      const ideaIsReserved = ideaState?.status === "active" && Boolean(ideaState.reserved_action_id);
                      const ideaIsActive = ideaState?.status === "active";
                      const ideaWasUsed = ideaState?.status === "used";
                      const queueIndex = savedPublicationIdeaOrder.indexOf(value);
                      const canReorder = queueIndex >= 0 &&
                        settingsPublicationIdeaEntries.filter((entry) => entry.value === value).length === 1 &&
                        !publicationIdeaToggleBusy && publicationIdeasSaveState !== "saving";
                      return (
                        <div
                          key={inputId}
                          className={styles.publicationIdeaCard}
                          data-idea-state={ideaState?.status || "empty"}
                          data-drop-target={publicationIdeaDropTarget === value || undefined}
                          draggable={canReorder}
                          onDragStart={(event) => {
                            if (!canReorder || (event.target instanceof Element &&
                              !event.target.closest(`.${styles.publicationIdeaDragHandle}`) &&
                              event.target.closest("button, textarea, input, label"))) {
                              event.preventDefault();
                              return;
                            }
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", value);
                            setDraggedPublicationIdea(value);
                          }}
                          onDragOver={(event) => {
                            if (!canReorder || !draggedPublicationIdea || draggedPublicationIdea === value) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setPublicationIdeaDropTarget(value);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const source = event.dataTransfer.getData("text/plain") || draggedPublicationIdea;
                            if (canReorder && source && source !== value && savedPublicationIdeaOrder.includes(source)) {
                              movePublicationIdea(source, queueIndex);
                            }
                            setDraggedPublicationIdea(null);
                            setPublicationIdeaDropTarget(null);
                          }}
                          onDragEnd={() => {
                            setDraggedPublicationIdea(null);
                            setPublicationIdeaDropTarget(null);
                          }}
                        >
                          <div className={styles.publicationIdeaCardHeader}>
                            <button
                              type="button"
                              className={styles.publicationIdeaMoveButton}
                              disabled={!canReorder || queueIndex === 0}
                              onClick={() => movePublicationIdea(value, queueIndex - 1)}
                              aria-label={i18nT("publication_idea_move_previous", { number: visualIndex + 1 })}
                              title={i18nT("publication_idea_move_previous", { number: visualIndex + 1 })}
                            >←</button>
                            <label htmlFor={inputId}>
                              <strong>{i18nT("publication_idea_label", { number: visualIndex + 1 })}</strong>
                              <span className={styles.publicationIdeaDragHandle} aria-hidden="true">⠿</span>
                            </label>
                            <button
                              type="button"
                              className={styles.publicationIdeaMoveButton}
                              disabled={!canReorder || queueIndex === savedPublicationIdeaOrder.length - 1}
                              onClick={() => movePublicationIdea(value, queueIndex + 1)}
                              aria-label={i18nT("publication_idea_move_next", { number: visualIndex + 1 })}
                              title={i18nT("publication_idea_move_next", { number: visualIndex + 1 })}
                            >→</button>
                            <small>{value.length}/{INR_AGENT_PUBLICATION_IDEA_MAX_LENGTH}</small>
                          </div>
                          <div className={styles.publicationIdeaTextareaWrap}>
                            <textarea
                              id={inputId}
                              value={value}
                              maxLength={INR_AGENT_PUBLICATION_IDEA_MAX_LENGTH}
                              rows={4}
                              readOnly={settingsPublicationIdeaVoiceBusy || publicationIdeasSaveState === "saving"}
                              aria-busy={publicationIdeaVoiceIndex === index}
                              placeholder={i18nT(
                                "publication_idea_placeholder"
                              )}
                              onChange={(event) =>
                                updateSettingsPublicationIdea(
                                  index,
                                  event.target.value
                                )
                              }
                            />
                            <MediaSubjectVoiceButton
                              purpose="subject"
                              value={value}
                              maxLength={INR_AGENT_PUBLICATION_IDEA_MAX_LENGTH}
                              mergeMode="paragraph"
                              contextLabel={i18nT("publication_idea_label", {
                                number: visualIndex + 1,
                              })}
                              disabled={
                                publicationIdeasSaveState === "saving" ||
                                loadState === "loading" ||
                                Boolean(testNowKey) ||
                                (publicationIdeaVoiceIndex !== null &&
                                  publicationIdeaVoiceIndex !== index)
                              }
                              onBusyChange={(busy) =>
                                setPublicationIdeaVoiceIndex((current) =>
                                  busy
                                    ? index
                                    : current === index
                                    ? null
                                    : current
                                )
                              }
                              onChange={(nextValue) =>
                                updateSettingsPublicationIdea(index, nextValue)
                              }
                            />
                          </div>
                          {value.trim() ? (
                            <div className={styles.publicationIdeaStatusRow}>
                              <span>
                                {ideaWasUsed
                                  ? i18nT("publication_idea_state_used")
                                  : ideaState?.status === "disabled"
                                    ? i18nT("publication_idea_state_disabled")
                                    : ideaIsReserved
                                      ? i18nT("publication_idea_state_reserved")
                                      : ideaIsActive
                                        ? i18nT("publication_idea_state_active")
                                        : ideaIsSaved
                                          ? i18nT("publication_idea_state_loading")
                                          : i18nT("publication_idea_state_unsaved")}
                              </span>
                              <button
                                type="button"
                                disabled={!ideaIsSaved || !ideaState || Boolean(publicationIdeaToggleBusy) || publicationIdeasSaveState === "saving"}
                                onClick={() => void togglePublicationIdea(value, !ideaIsActive)}
                                aria-label={ideaIsActive
                                  ? i18nT("publication_idea_disable_aria", { number: visualIndex + 1 })
                                  : ideaWasUsed
                                    ? i18nT("publication_idea_reuse_aria", { number: visualIndex + 1 })
                                    : i18nT("publication_idea_reactivate_aria", { number: visualIndex + 1 })}
                              >
                                {ideaIsActive
                                  ? i18nT("publication_idea_disable")
                                  : ideaWasUsed
                                    ? i18nT("publication_idea_reuse")
                                    : i18nT("publication_idea_reactivate")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    }
                  )}
                </div>
                <button
                  type="button"
                  className={styles.publicationIdeasAddButton}
                  disabled={
                    settingsPublicationIdeaVoiceBusy ||
                    publicationIdeasSaveState === "saving" ||
                    settingsPublicationIdeaFieldCount >=
                      INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS
                  }
                  onClick={() =>
                    setPublicationIdeasDraft(appendInrAgentPublicationIdeaSlot(publicationIdeasDraft))
                  }
                >
                  <span aria-hidden="true">+</span>
                  {settingsPublicationIdeaFieldCount >=
                  INR_AGENT_PUBLICATION_IDEA_MAX_ITEMS
                    ? i18nT("publication_ideas_limit_reached")
                    : i18nT("publication_ideas_add")}
                </button>
              </section>
  );
}
