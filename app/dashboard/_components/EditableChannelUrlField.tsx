"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslations } from "next-intl";

import {
  normalizeChannelPublicUrl,
  type ChannelPublicUrlErrorCode,
  type EditableChannelPublicUrlChannel,
  type LinkedinPublicUrlTarget,
} from "@/lib/channelPublicUrl";
import styles from "../dashboard.module.css";
import fieldStyles from "./EditableChannelUrlField.module.css";
import SaveIcon from "./SaveIcon";

type EditableChannelUrlFieldProps = {
  channel: EditableChannelPublicUrlChannel;
  target?: LinkedinPublicUrlTarget;
  id?: string;
  value: string;
  onSaved: (url: string) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  ariaLabel: string;
  placeholder?: string;
  viewLabel: string;
  disabled?: boolean;
  editorOnly?: boolean;
  saveAsIcon?: boolean;
  inputClassName?: string;
  inputStyle?: CSSProperties;
  actionClassName?: string;
  viewClassName?: string;
};

function validationKey(code: ChannelPublicUrlErrorCode) {
  if (code === "required") return "channel_url_required";
  if (code === "wrong_host") return "channel_url_wrong_platform";
  if (code === "credentials_not_allowed") return "channel_url_credentials_forbidden";
  if (code === "invalid_protocol") return "channel_url_protocol_invalid";
  return "channel_url_invalid";
}

export default function EditableChannelUrlField({
  channel,
  target,
  id,
  value,
  onSaved,
  onDirtyChange,
  ariaLabel,
  placeholder,
  viewLabel,
  disabled = false,
  editorOnly = false,
  saveAsIcon = false,
  inputClassName = "",
  inputStyle,
  actionClassName = "",
  viewClassName = "",
}: EditableChannelUrlFieldProps) {
  const t = useTranslations("shell");
  const inputRef = useRef<HTMLInputElement>(null);
  const messageId = useId();
  const [draft, setDraft] = useState(value);
  const [draftChangedByUser, setDraftChangedByUser] = useState(false);
  const [editingMode, setEditing] = useState(false);
  const editing = editorOnly || editingMode;
  const [saving, setSaving] = useState(false);
  const [errorCode, setErrorCode] = useState<ChannelPublicUrlErrorCode | "save_failed" | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!editing || !draftChangedByUser) setDraft(value);
  }, [draftChangedByUser, editing, value]);

  useEffect(() => {
    if (!savedNotice) return;
    const timer = window.setTimeout(() => setSavedNotice(false), 2500);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  const normalizedDraft = useMemo(
    () => normalizeChannelPublicUrl(channel, draft, target),
    [channel, draft, target],
  );
  const normalizedSaved = useMemo(
    () => normalizeChannelPublicUrl(channel, value, target),
    [channel, target, value],
  );
  const hasDraftChange = draftChangedByUser && draft !== value;
  const hasNormalizedChange = hasDraftChange && normalizedDraft.ok && (
    !normalizedSaved.ok || normalizedDraft.comparisonKey !== normalizedSaved.comparisonKey
  );
  const canSave = saveAsIcon ? normalizedDraft.ok : hasNormalizedChange;
  const savedHref = normalizedSaved.ok ? normalizedSaved.url : "";

  useEffect(() => {
    onDirtyChange?.(editing && hasDraftChange);
  }, [editing, hasDraftChange, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  const startEditing = () => {
    if (disabled || saving) return;
    setDraft(value);
    setDraftChangedByUser(false);
    setErrorCode(null);
    setSavedNotice(false);
    setEditing(true);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const cancelEditing = () => {
    if (saving) return;
    setDraft(value);
    setDraftChangedByUser(false);
    setErrorCode(null);
    setEditing(false);
  };

  const save = async () => {
    if (!editing || saving || disabled) return;
    if (!normalizedDraft.ok) {
      setErrorCode(normalizedDraft.code);
      return;
    }
    if (!hasNormalizedChange) {
      // The floppy also confirms an already-saved address, including a URL
      // entered without https:// or its trailing slash.
      if (saveAsIcon && normalizedSaved.ok) {
        setDraft(normalizedSaved.url);
        setDraftChangedByUser(false);
        setErrorCode(null);
        setEditing(false);
        setSavedNotice(true);
      }
      return;
    }

    setSaving(true);
    setErrorCode(null);
    setSavedNotice(false);
    try {
      const response = await fetch("/api/integrations/channel-public-url", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, target, url: normalizedDraft.url }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const responseCode = String(payload?.errorCode || "");
        if (["required", "invalid_url", "invalid_protocol", "credentials_not_allowed", "wrong_host"].includes(responseCode)) {
          setErrorCode(responseCode as ChannelPublicUrlErrorCode);
        } else {
          setErrorCode("save_failed");
        }
        return;
      }

      const savedUrl = String(payload?.url || normalizedDraft.url);
      await onSaved(savedUrl);
      setDraft(savedUrl);
      setDraftChangedByUser(false);
      setEditing(false);
      setSavedNotice(true);
    } catch {
      setErrorCode("save_failed");
    } finally {
      setSaving(false);
    }
  };

  const visibleError = editing && hasDraftChange && !normalizedDraft.ok
    ? normalizedDraft.code
    : errorCode;
  const errorMessage = visibleError
    ? visibleError === "save_failed"
      ? t("channel_url_save_failed")
      : t(validationKey(visibleError))
    : null;

  return (
    <div className={fieldStyles.field} data-channel-url-field={channel} data-save-as-icon={saveAsIcon || undefined} data-editing={editing ? "true" : "false"}>
      <input
        id={id}
        ref={inputRef}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setDraftChangedByUser(true);
          setErrorCode(null);
          setSavedNotice(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancelEditing();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
        readOnly={!editing}
        disabled={disabled || saving}
        aria-label={ariaLabel}
        aria-describedby={errorMessage || savedNotice ? messageId : undefined}
        aria-invalid={Boolean(errorMessage)}
        aria-busy={saving}
        inputMode="url"
        autoComplete="url"
        placeholder={placeholder}
        className={`${fieldStyles.input} ${inputClassName}`.trim()}
        style={inputStyle}
        data-editing={editing ? "true" : "false"}
      />

      {!editorOnly && !saveAsIcon ? <a
        href={savedHref || "#"}
        target="_blank"
        rel="noreferrer"
        className={`${styles.actionBtn} ${styles.viewBtn} ${actionClassName} ${viewClassName}`.trim()}
        aria-disabled={!savedHref}
        tabIndex={savedHref ? 0 : -1}
        style={{ pointerEvents: savedHref ? "auto" : "none", opacity: savedHref ? 1 : 0.5 }}
      >
        {viewLabel}
      </a> : null}

      <button
        type="button"
        className={`${styles.actionBtn} ${editing && canSave ? styles.connectBtn : styles.secondaryBtn} ${actionClassName}`.trim()}
        onClick={editing ? () => void save() : startEditing}
        disabled={disabled || saving || (editing && !canSave)}
        aria-busy={saving}
        aria-label={saveAsIcon ? editing ? t("enregistrer_f7c8bcd8") : t("channel_url_edit") : undefined}
        title={!saveAsIcon && editing && !canSave ? t("channel_url_change_required") : saveAsIcon ? editing ? t("enregistrer_f7c8bcd8") : t("channel_url_edit") : undefined}
      >
        {saveAsIcon ? editing ? <SaveIcon /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 4 2-2a3 3 0 0 1 4 4l-9 9-5 1 1-5 7-7Zm1-1 4 4M5 21h14" /></svg> : saving
          ? t("enregistrement_9bf1058a")
          : editorOnly || (editing && hasNormalizedChange)
            ? t("enregistrer_f7c8bcd8")
            : t("channel_url_edit")}
      </button>

      {editing && !saveAsIcon ? (
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.secondaryBtn} ${actionClassName}`.trim()}
          onClick={cancelEditing}
          disabled={saving}
        >
          {t("annuler_49ba3292")}
        </button>
      ) : null}

      {errorMessage ? (
        <p id={messageId} className={`${fieldStyles.message} ${fieldStyles.error}`} role="alert">
          {errorMessage}
        </p>
      ) : savedNotice ? (
        <p id={messageId} className={`${fieldStyles.message} ${fieldStyles.success}`} role="status">
          {t("channel_url_saved")}
        </p>
      ) : null}
    </div>
  );
}
