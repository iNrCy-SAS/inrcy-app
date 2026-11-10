"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { useInrAssistantLocalInterface } from "../_hooks/useInrAssistantLocalInterface";
import type { AiMediaCharacterVoiceSample } from "@/lib/aiMediaCharacterVoices";
import MediaCharacterVoiceInput from "./MediaCharacterVoiceInput";
import dialogStyles from "./MediaFreeGenerator.module.css";
import styles from "./StudioVoicePool.module.css";

export type StudioVoiceProfile = {
  id: string;
  sample: AiMediaCharacterVoiceSample;
  target: "narration" | { characterId: string } | null;
  gender: "auto" | "female" | "male";
};
type Draft = Omit<StudioVoiceProfile, "sample">;
type Props = {
  visible: boolean;
  available?: boolean;
  onOpenChange?: (open: boolean) => void;
  scopeKey: string;
  profiles: StudioVoiceProfile[];
  onChange: (profiles: StudioVoiceProfile[]) => void;
  characters: Array<{ id: string; name: string; referenceIndex: number }>;
  selectedCharacterId: string | null;
  speechMode: "voiceover" | "characters" | "silent";
  activeNarrationVoiceId: string | null;
  onNarrationChange: (id: string | null) => void;
  narrationConsent: boolean;
  onNarrationConsentChange: (value: boolean) => void;
  disabled: boolean;
  onBusyChange: (value: boolean) => void;
  onAssignCharacter: (id: string) => void;
  onUnassignCharacter: (id: string) => void;
  releaseSample: (sample: AiMediaCharacterVoiceSample) => void;
};

/** Three independent sources; only an explicit binding determines their use. */
export default function StudioVoicePool({ visible, available = true, onOpenChange, scopeKey, profiles, onChange, characters, selectedCharacterId, speechMode, activeNarrationVoiceId, onNarrationChange,
  narrationConsent, onNarrationConsentChange, disabled, onBusyChange, onAssignCharacter, onUnassignCharacter, releaseSample }: Props) {
  const t = useTranslations("media");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const importTarget = useRef<Draft | null>(null);
  const assistantAction = useRef<{ value: string; profileId: string; referenceId?: string; targetKind?: "narration" | "none"; gender?: StudioVoiceProfile["gender"] } | null>(null);
  const current = profiles.find(profile => profile.id === editingId);
  const edited = current ?? draft;
  const newDraft = (): Draft => {
    let target: StudioVoiceProfile["target"] = speechMode === "voiceover" ? "narration" : null;
    if (speechMode === "characters" && selectedCharacterId && !profiles.some(profile => profile.target && profile.target !== "narration" && profile.target.characterId === selectedCharacterId)) target = { characterId: selectedCharacterId };
    return { id: globalThis.crypto.randomUUID(), target, gender: "auto" };
  };

  useEffect(() => { importTarget.current = null; assistantAction.current = null; setDraft(null); setEditingId(null); setOpen(false); }, [scopeKey]);
  useEffect(() => { setPortalReady(true); }, []);
  useLayoutEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [open, onOpenChange]);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal(); closeRef.current?.focus({ preventScroll: true });
    return () => { dialog.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [open, portalReady]);

  const edit = (profile: StudioVoiceProfile) => { if (disabled) return; importTarget.current = null; setDraft(null); setEditingId(profile.id); setOpen(true); };
  const openSettings = () => {
    if (disabled) return;
    const selected = current ?? profiles.find(profile => speechMode === "voiceover" ? profile.id === activeNarrationVoiceId : profile.target && profile.target !== "narration" && profile.target.characterId === selectedCharacterId) ?? profiles[0];
    if (selected) edit(selected);
    else begin();
  };
  const begin = (proposed?: Draft) => {
    if (disabled || profiles.length >= 3) return null;
    const next = proposed ?? draft ?? newDraft();
    importTarget.current = next;
    setDraft(next); setEditingId(null); setOpen(true);
    return next;
  };
  const changeSample = (sample: AiMediaCharacterVoiceSample | undefined) => {
    const target = importTarget.current ?? edited;
    if (!target) return;
    const previous = profiles.find(profile => profile.id === target.id);
    if (!sample) {
      if (previous) {
        onChange(profiles.filter(profile => profile.id !== previous.id));
        releaseSample(previous.sample);
        if (previous.target && previous.target !== "narration") onUnassignCharacter(previous.target.characterId);
        if (activeNarrationVoiceId === previous.id) onNarrationChange(null);
      }
      setOpen(false); return;
    }
    if (!previous && profiles.length >= 3) { releaseSample(sample); return; }
    const next: StudioVoiceProfile = { ...target, sample };
    onChange(previous ? profiles.map(profile => profile.id === next.id ? next : profile) : [...profiles, next]);
    if (previous && previous.sample.path !== sample.path) releaseSample(previous.sample);
    if (next.target && next.target !== "narration") onAssignCharacter(next.target.characterId);
    else if (next.target === "narration" && !activeNarrationVoiceId && speechMode === "voiceover") onNarrationChange(next.id);
    onNarrationConsentChange(false);
    importTarget.current = null; setDraft(null); setEditingId(next.id); setOpen(true);
  };
  const changeTarget = (value: string, subject = edited) => {
    if (disabled || !subject) return false;
    const saved = profiles.find(profile => profile.id === subject.id);
    const target: StudioVoiceProfile["target"] = value === "none" ? null : value === "narration" ? "narration" : { characterId: value };
    if (target && target !== "narration" && (!characters.some(character => character.id === target.characterId) || profiles.some(profile => profile.id !== subject.id && profile.target && profile.target !== "narration" && profile.target.characterId === target.characterId))) return false;
    const next = { ...subject, target };
    if (saved) {
      if (saved.target && saved.target !== "narration" && (!target || target === "narration" || saved.target.characterId !== target.characterId)) onUnassignCharacter(saved.target.characterId);
      onChange(profiles.map(profile => profile.id === saved.id ? { ...profile, target } : profile));
      if (target && target !== "narration") onAssignCharacter(target.characterId);
      if (activeNarrationVoiceId === saved.id && target !== "narration") onNarrationChange(null);
    } else { setDraft(next); importTarget.current = next; }
    onNarrationConsentChange(false);
    return true;
  };
  const changeGender = (gender: StudioVoiceProfile["gender"], subject = edited) => {
    if (disabled || !subject) return false;
    if (profiles.some(profile => profile.id === subject.id)) onChange(profiles.map(profile => profile.id === subject.id ? { ...profile, gender } : profile));
    else { const next = { ...subject, gender }; setDraft(next); importTarget.current = next; }
    return true;
  };

  type Snapshot = { open: boolean; editingId: string | null; draftId: string | null; scopeKey: string; profiles: Array<{ id: string; target: StudioVoiceProfile["target"]; gender: StudioVoiceProfile["gender"] }>; characters: Array<{ id: string }>; activeNarrationVoiceId: string | null };
  const getState = (value: unknown) => value && typeof value === "object" && (value as Snapshot).scopeKey === scopeKey && Array.isArray((value as Snapshot).profiles) ? value as Snapshot : null;
  useInrAssistantLocalInterface("studio_voice_pool", { open, editingId, draftId: draft?.id ?? null, scopeKey,
    profiles: profiles.map(profile => ({ id: profile.id, name: profile.sample.name, durationSeconds: profile.sample.durationSeconds, target: profile.target, gender: profile.gender })), characters, activeNarrationVoiceId }, {
    open: {
      invoke: value => {
        if ((!visible && !open) || (!available && !open) || disabled) throw new Error("studio_voice_pool_unavailable");
        if (value === null) { assistantAction.current = { value: "open:settings", profileId: "" }; openSettings(); return; }
        if (value === "new") { if (profiles.length >= 3) throw new Error("studio_voice_pool_full"); const created = newDraft(); assistantAction.current = { value: `open:${value}`, profileId: created.id }; begin(created); return; }
        const match = /^voice:([0-2])$/.exec(value ?? ""), profile = match ? profiles[Number(match[1])] : null;
        if (!profile) throw new Error("studio_voice_profile_unavailable");
        assistantAction.current = { value: `open:${value}`, profileId: profile.id }; edit(profile);
      },
      matches: (snapshot, value) => { const state = getState(snapshot), action = assistantAction.current; return Boolean(state?.open && (value === null ? action?.value === "open:settings" : action?.value === `open:${value}` && (value === "new" ? state.draftId === action.profileId && state.profiles.length < 3 : state.editingId === action.profileId && state.profiles.some(profile => profile.id === action.profileId)))); },
    },
    close: { invoke: () => { if (disabled) throw new Error("studio_voice_pool_busy"); setOpen(false); }, matches: snapshot => getState(snapshot)?.open === false },
    select: {
      invoke: value => {
        if (disabled || !open) throw new Error("studio_voice_pool_unavailable");
        const match = /^(active|target|gender):([0-2])(?::(narration|none|reference:([0-4])|auto|female|male))?$/.exec(value ?? "");
        const profile = match ? profiles[Number(match[2])] : null;
        if (!match || !profile || profile.id !== editingId) throw new Error("studio_voice_profile_unavailable");
        if (match[1] === "active" && !match[3] && profile.target === "narration") { assistantAction.current = { value: value!, profileId: profile.id }; onNarrationChange(profile.id); return; }
        if (match[1] === "target") {
          const character = match[4] ? characters.find(character => character.referenceIndex === Number(match[4])) : null;
          const target = match[3] === "narration" || match[3] === "none" ? match[3] : character?.id;
          if (!target) throw new Error("studio_voice_target_unavailable");
          assistantAction.current = { value: value!, profileId: profile.id, referenceId: character?.id, targetKind: match[3] === "narration" || match[3] === "none" ? match[3] : undefined };
          if (!changeTarget(target, profile)) { assistantAction.current = null; throw new Error("studio_voice_target_unavailable"); } return;
        }
        if (match[1] === "gender" && ["auto", "female", "male"].includes(match[3])) { const gender = match[3] as StudioVoiceProfile["gender"]; assistantAction.current = { value: value!, profileId: profile.id, gender }; if (!changeGender(gender, profile)) { assistantAction.current = null; throw new Error("studio_voice_profile_unavailable"); } return; }
        throw new Error("studio_voice_pool_choice_unavailable");
      },
      matches: (snapshot, value) => {
        const state = getState(snapshot), action = assistantAction.current;
        if (!state || !action || action.value !== value || !state.open || state.editingId !== action.profileId) return false;
        const profile = state.profiles.find(profile => profile.id === action.profileId);
        if (!profile) return false;
        if (value?.startsWith("active:")) return profile.target === "narration" && state.activeNarrationVoiceId === profile.id;
        if (value?.startsWith("gender:")) return profile.gender === action.gender;
        return action.referenceId ? Boolean(profile.target && profile.target !== "narration" && profile.target.characterId === action.referenceId && state.characters.some(character => character.id === action.referenceId)) : action.targetKind === "none" ? profile.target === null : profile.target === "narration";
      },
    },
  }, portalReady && (open || available && visible), disabled);

  return <div className={styles.pool} data-studio-voice-pool>
    {visible ? <button type="button" className={styles.settings} data-voice-pool-settings disabled={disabled || !portalReady || !available} aria-haspopup="dialog" aria-expanded={open} onClick={openSettings}>{t("ai_generator_voice_details")}</button> : null}
    {portalReady ? createPortal(<dialog ref={dialogRef} className={dialogStyles.mediaSettingsDialog} data-media-settings-dialog="voices" aria-labelledby={`${id}-title`} aria-modal="true"
      onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setOpen(false); }}
      onClose={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target !== event.currentTarget || disabled) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false); }}>
      <header className={dialogStyles.mediaSettingsDialogHeader}><h2 id={`${id}-title`}>{t("ai_generator_voice_real")}</h2><button ref={closeRef} type="button" disabled={disabled} aria-label={t("ai_generator_video_settings_close")} onClick={() => setOpen(false)}>×</button></header>
      <div className={`${dialogStyles.mediaSettingsDialogBody} ${styles.details}`}>
        <div className={styles.inline}>
          <div className={styles.tabs} role="tablist" aria-label={t("ai_generator_voice_real")} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)'));
            const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault(); event.stopPropagation();
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            tabs[next]?.click(); tabs[next]?.focus();
          }}>
          {profiles.map((profile, index) => <button key={profile.id} type="button" role="tab" id={`${id}-tab-${profile.id}`} className={styles.chip} data-voice-profile={profile.id} disabled={disabled}
            aria-label={`${t("ai_generator_voice_profile", { index: index + 1 })} · ${profile.sample.name}`} title={profile.sample.name}
            aria-controls={`${id}-panel`} aria-selected={profile.id === editingId} tabIndex={profile.id === editingId ? 0 : -1}
            onClick={() => edit(profile)}>{t("ai_generator_voice_profile", { index: index + 1 })}</button>)}
          {profiles.length < 3 ? <button type="button" role="tab" id={`${id}-tab-new`} data-voice-pool-add disabled={disabled}
            aria-label={t("ai_generator_character_voice_upload")} aria-controls={`${id}-panel`} aria-selected={!current} tabIndex={current ? -1 : 0}
            onClick={() => begin()}><span aria-hidden="true">+ </span>{t("ai_generator_character_voice_upload")}</button> : null}
          </div>
          <span className={styles.count}>{t("ai_generator_voice_pool_count", { count: profiles.length })}</span>
        </div>
        <div className={styles.editor} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${current?.id ?? "new"}`} data-voice-pool-panel>
        <MediaCharacterVoiceInput key={edited?.id ?? "empty"} context={edited?.target && edited.target !== "narration" ? "character" : "narration"} active={open} hideModeControl mode="provided" sample={current?.sample} disabled={disabled}
          onModeChange={() => undefined} onSampleChange={changeSample} onBusyChange={onBusyChange} />
        {current ? <>
          <label>{t("ai_generator_voice_pool_target")}<select aria-label={t("ai_generator_voice_pool_target")} value={current.target === null ? "none" : current.target === "narration" ? "narration" : current.target.characterId} disabled={disabled} onChange={event => changeTarget(event.target.value)}>
            <option value="none">{t("ai_generator_voice_pool_unassigned")}</option>
            <option value="narration">{t("ai_generator_free_audio_voiceover")}</option>
            {characters.map(character => <option key={character.id} value={character.id} disabled={profiles.some(profile => profile.id !== current.id && profile.target && profile.target !== "narration" && profile.target.characterId === character.id)}>{character.name}</option>)}
          </select></label>
          <label>{t("ai_generator_voice_pool_gender")}<select aria-label={t("ai_generator_voice_pool_gender")} value={current.gender} disabled={disabled} onChange={event => changeGender(event.target.value as StudioVoiceProfile["gender"])}>
            <option value="auto">{t("ai_generator_people_auto")}</option><option value="female">{t("ai_generator_narration_voice_female")}</option><option value="male">{t("ai_generator_narration_voice_male")}</option>
          </select></label>
          <p>{t("ai_generator_voice_pool_gender_help")}</p>
        </> : null}
        {current?.target === "narration" ? <>
          <button type="button" data-voice-narration-active disabled={disabled || activeNarrationVoiceId === current.id} onClick={() => onNarrationChange(current.id)}>{t("ai_generator_voice_pool_activate")}</button>
          {activeNarrationVoiceId === current.id ? <label className={styles.consent}><input type="checkbox" checked={narrationConsent} disabled={disabled} onChange={event => onNarrationConsentChange(event.target.checked)} />{t("ai_generator_narration_voice_consent")}</label> : null}
        </> : null}
        </div>
      </div>
    </dialog>, document.body) : null}
  </div>;
}
