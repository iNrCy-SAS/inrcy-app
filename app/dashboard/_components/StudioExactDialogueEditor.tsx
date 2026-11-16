"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useInrAssistantLocalInterface } from '../_hooks/useInrAssistantLocalInterface';
import { parseInrAssistantStudioExactDialogueSelection } from '@/lib/inrAssistantStudioExactDialogue';
import { createMediaExactDialogueRow, initializeMediaExactDialogueRows, countMediaExactDialogueCharacters, MEDIA_EXACT_DIALOGUE_MAX_CHARS, MEDIA_EXACT_DIALOGUE_MAX_ROWS,
  type MediaExactDialogueCharacter, type MediaExactDialogueRow } from '@/lib/mediaExactDialogueEditor';
import styles from './StudioExactDialogueEditor.module.css';

type Props = {
  enabled: boolean; disabled: boolean; scopeKey: string; rows: MediaExactDialogueRow[];
  characters: MediaExactDialogueCharacter[]; onChange: (rows: MediaExactDialogueRow[]) => void;
  onOpenChange?: (open: boolean) => void; legacyImported?: boolean;
  defaultSpeaker?: 'ai_voice' | 'provided_voice' | 'character'; defaultCharacterId?: string | null;
  narrationOnly?: 'ai' | 'provided'; requireCharacter?: boolean;
  speechBudget?: { units: number; maxUnits: number; characters: number; maxCharacters: number; unitLabel: string; engineLabel: string; durationSeconds: number };
  validationMessage?: string;
};

export default function StudioExactDialogueEditor({ enabled, disabled, scopeKey, rows, characters, onChange, onOpenChange, legacyImported, defaultSpeaker = 'ai_voice', defaultCharacterId, narrationOnly, requireCharacter = false, speechBudget, validationMessage }: Props) {
  const t = useTranslations('media'), id = useId();
  const [open, setOpen] = useState(false), [ready, setReady] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const expected = useRef<{ value: string; rows: MediaExactDialogueRow[] } | null>(null);
  const count = countMediaExactDialogueCharacters(rows);
  const empty = !rows.length || rows.some(row => !row.text.trim());
  const missing = requireCharacter && !rows.some(row => row.speaker === 'character') || rows.some(row => row.speaker === 'unassigned' || row.speaker === 'character' && !characters.some(character => character.id === row.characterId));
  const mixedProvided = rows.some(row => row.speaker === 'provided_voice') && rows.some(row => row.speaker !== 'provided_voice');
  useEffect(() => { setReady(true); }, []);
  useEffect(() => { setOpen(false); expected.current = null; }, [scopeKey]);
  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);
  useLayoutEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false); }, [open, onOpenChange]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal(); element.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    return () => { element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open, ready]);
  const openEditor = () => {
    if (!enabled || disabled) return;
    if (!rows.length) onChange(initializeMediaExactDialogueRows(rows, '', characters, { speechMode: defaultSpeaker === 'character' ? 'characters' : 'voiceover', characterId: defaultCharacterId, narrationVoiceMode: defaultSpeaker === 'provided_voice' ? 'provided' : 'ai' }));
    setOpen(true);
  };
  const changeSpeaker = (row: MediaExactDialogueRow, value: string): MediaExactDialogueRow => {
    if (narrationOnly) return row;
    if (value === 'ai_voice' || value === 'provided_voice') return { ...row, speaker: value, characterId: undefined };
    const character = characters.find(character => `character:${character.id}` === value);
    return character ? { ...row, speaker: 'character' as const, characterId: character.id } : row;
  };
  const move = (index: number, direction: 'up' | 'down') => {
    const next = [...rows], destination = index + (direction === 'up' ? -1 : 1);
    if (destination < 0 || destination >= next.length) return null;
    [next[index], next[destination]] = [next[destination], next[index]]; return next;
  };
  type Snapshot = { scopeKey: string; open: boolean; locked: boolean; rows: MediaExactDialogueRow[]; characters: MediaExactDialogueCharacter[]; narrationOnly?: 'ai' | 'provided' };
  useInrAssistantLocalInterface('studio_exact_dialogue', { scopeKey, open, locked: disabled, rows, narrationOnly, characters: characters.map(({ preview: _preview, ...character }) => character) }, {
    open: { invoke: () => { if (!enabled || disabled) throw new Error('studio_exact_dialogue_unavailable'); openEditor(); }, matches: value => (value as Snapshot)?.scopeKey === scopeKey && (value as Snapshot)?.open === true },
    close: { invoke: () => { if (disabled) throw new Error('studio_exact_dialogue_busy'); setOpen(false); }, matches: value => (value as Snapshot)?.scopeKey === scopeKey && (value as Snapshot)?.open === false },
    select: {
      invoke: value => {
        if (!enabled || !open || disabled) throw new Error('studio_exact_dialogue_unavailable');
        const selection = parseInrAssistantStudioExactDialogueSelection(value);
        if (!selection) throw new Error('studio_exact_dialogue_selection_invalid');
        let next: MediaExactDialogueRow[] | null = null;
        if (selection.field === 'add') { if (rows.length < MEDIA_EXACT_DIALOGUE_MAX_ROWS) next = [...rows, createMediaExactDialogueRow(narrationOnly === 'provided' ? 'provided_voice' : 'ai_voice')]; }
        else {
          const row = rows[selection.rowIndex];
          if (!row) throw new Error('studio_exact_dialogue_row_unavailable');
          if (selection.field === 'text') next = rows.map(item => item.id === row.id ? { ...item, text: selection.value } : item);
          else if (selection.field === 'speaker') {
            if (narrationOnly) throw new Error('studio_exact_dialogue_narrator_selected');
            const offscreen = selection.value === 'ai_voice' || selection.value === 'provided_voice';
            const character = offscreen ? null : characters.find(item => item.characterIndex === Number(selection.value.slice(10)) + 1);
            if (!offscreen && !character) throw new Error('studio_exact_dialogue_character_unavailable');
            next = rows.map(item => item.id === row.id ? changeSpeaker(item, character ? `character:${character.id}` : selection.value) : item);
          } else if (selection.field === 'remove') next = rows.filter(item => item.id !== row.id);
          else if (selection.field === 'move') next = move(selection.rowIndex, selection.value);
        }
        if (!next || countMediaExactDialogueCharacters(next) > MEDIA_EXACT_DIALOGUE_MAX_CHARS) throw new Error('studio_exact_dialogue_limit');
        expected.current = { value: value!, rows: next }; onChange(next);
      },
      matches: (snapshot, value) => {
        const state = snapshot as Snapshot | null, action = expected.current;
        return Boolean(state && action && state.scopeKey === scopeKey && state.open && !state.locked && action.value === value &&
          state.rows.length === action.rows.length && action.rows.every((row, index) => {
            const actual = state.rows[index];
            return actual.id === row.id && actual.speaker === row.speaker && actual.text === row.text && actual.characterId === row.characterId &&
              (row.speaker !== 'character' || state.characters.some(character => character.id === row.characterId));
          }));
      },
    },
  }, enabled && ready, disabled);
  return <div className={styles.editor} data-exact-dialogue-editor>
    {enabled ? <div className={styles.summary}>
      <button type="button" data-exact-dialogue-settings disabled={disabled || !ready} aria-label={t('ai_generator_exact_dialogue_settings')} aria-haspopup="dialog" aria-controls={`${id}-dialog`} aria-expanded={open} onClick={openEditor}>{t('ai_generator_voice_details')}</button></div> : null}
    {ready ? createPortal(<dialog ref={dialog} id={`${id}-dialog`} className={styles.dialog} aria-labelledby={`${id}-title`} aria-modal="true" data-exact-dialogue-dialog
      onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!disabled) setOpen(false); }} onClose={event => event.stopPropagation()}
      onClick={event => { if (event.target !== event.currentTarget || disabled) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false); }}>
      <header><h2 id={`${id}-title`}>{t('ai_generator_exact_dialogue_title')}</h2><button type="button" disabled={disabled} aria-label={t('ai_generator_video_settings_close')} onClick={() => setOpen(false)}>×</button></header>
      <p className={styles.help}>{t('ai_generator_exact_dialogue_help')}</p>
      {empty || missing || mixedProvided || count > MEDIA_EXACT_DIALOGUE_MAX_CHARS ? <p className={styles.hint} role="status">{t(mixedProvided ? 'ai_generator_exact_dialogue_provided_mix' : count > MEDIA_EXACT_DIALOGUE_MAX_CHARS ? 'ai_generator_exact_dialogue_limit' : missing ? 'ai_generator_exact_dialogue_choose_speaker' : 'ai_generator_exact_dialogue_empty')}</p> : null}
      {legacyImported ? <p role="status">{t('ai_generator_exact_dialogue_legacy')}</p> : null}
      {validationMessage ? <p role="alert">{validationMessage}</p> : null}
      <ol className={styles.rows}>
        {rows.map((row, index) => {
          const character = characters.find(item => item.id === row.characterId);
          return <li key={row.id} data-exact-dialogue-row={row.id}>
            <div className={styles.speakerColumn}><strong>{t('ai_generator_exact_dialogue_line', { index: index + 1 })}</strong>
            <label><span className={styles.srOnly}>{t('ai_generator_exact_dialogue_speaker')}</span><select disabled={disabled || Boolean(narrationOnly)} aria-label={t('ai_generator_exact_dialogue_speaker_line', { index: index + 1 })}
              value={row.speaker === 'character' ? `character:${row.characterId}` : row.speaker} onChange={event => onChange(rows.map(item => item.id === row.id ? changeSpeaker(item, event.target.value) : item))}>
              <option value="unassigned" disabled>{t('ai_generator_exact_dialogue_choose_speaker')}</option>
              <option value="ai_voice">{t('ai_generator_exact_dialogue_ai_voice')}</option>
              <option value="provided_voice">{t('ai_generator_exact_dialogue_provided_narrator')}</option>
              {row.speaker === 'character' && !character ? <option value={`character:${row.characterId}`} disabled>{t('ai_generator_exact_dialogue_missing')}</option> : null}
              {!narrationOnly ? characters.map(item => <option key={item.id} value={`character:${item.id}`}>{t('ai_generator_exact_dialogue_character', { index: item.characterIndex })}{item.name ? ` · ${item.name}` : ''}</option>) : null}
            </select></label>
            {row.speaker === 'character' && character?.voiceLabel ? <p className={styles.voiceLabel} title={character.voiceLabel}>{character.voiceLabel}</p> : null}
            </div>
            <label className={styles.textColumn}><span className={styles.srOnly}>{t('ai_generator_exact_dialogue_text')}</span><textarea rows={2} disabled={disabled} value={row.text}
              aria-label={t('ai_generator_exact_dialogue_text_line', { index: index + 1 })} onChange={event => onChange(rows.map(item => item.id === row.id ? { ...item, text: event.target.value } : item))} /></label>
            <div className={styles.rowActions}>
              <button type="button" disabled={disabled || index === 0} aria-label={t('ai_generator_exact_dialogue_up', { index: index + 1 })} onClick={() => { const next = move(index, 'up'); if (next) onChange(next); }}>↑</button>
              <button type="button" disabled={disabled || index === rows.length - 1} aria-label={t('ai_generator_exact_dialogue_down', { index: index + 1 })} onClick={() => { const next = move(index, 'down'); if (next) onChange(next); }}>↓</button>
              <button type="button" disabled={disabled} aria-label={t('ai_generator_exact_dialogue_remove', { index: index + 1 })} onClick={() => onChange(rows.filter(item => item.id !== row.id))}>×</button>
            </div>
          </li>;
        })}
      </ol>
      <footer>{speechBudget ? <div className={styles.budget} data-exact-dialogue-budget aria-live="polite" data-invalid={speechBudget.units > speechBudget.maxUnits || speechBudget.characters > speechBudget.maxCharacters || undefined}>
        <span>{t('ai_generator_video_speech_budget_short', { seconds: speechBudget.durationSeconds, model: speechBudget.engineLabel })}</span>
        <strong>{t('ai_generator_video_speech_count', { count: speechBudget.units.toLocaleString(), max: speechBudget.maxUnits.toLocaleString(), unit: speechBudget.unitLabel })}{' · '}{t('ai_generator_video_speech_character_count', { count: speechBudget.characters.toLocaleString(), max: speechBudget.maxCharacters.toLocaleString() })}</strong>
      </div> : null}
        <button type="button" disabled={disabled || rows.length >= MEDIA_EXACT_DIALOGUE_MAX_ROWS} data-exact-dialogue-add onClick={() => onChange([...rows, createMediaExactDialogueRow(narrationOnly === 'provided' ? 'provided_voice' : 'ai_voice')])}>{t('ai_generator_exact_dialogue_add')}</button></footer>
      {count > MEDIA_EXACT_DIALOGUE_MAX_CHARS ? <p role="alert">{t('ai_generator_exact_dialogue_limit')}</p> : null}
    </dialog>, document.body) : null}
  </div>;
}
