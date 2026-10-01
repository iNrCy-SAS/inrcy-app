"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "./LocalMediaUploadChoice.module.css";

type LocalMediaChoice = {
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
  detail?: string;
  hidden?: boolean;
};

type LocalMediaUploadChoiceProps = {
  image: LocalMediaChoice & { maxSelection?: number };
  video: LocalMediaChoice;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  triggerLabel?: string;
  triggerDetail?: string;
  triggerIcon?: ReactNode;
  dialogTitle?: string;
  dialogDescription?: string;
  testId?: string;
};

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/**
 * Keeps image and video file pickers deliberately separate. The user first
 * chooses the media kind, so a native file dialog can never return a mixed
 * image/video selection.
 */
export default function LocalMediaUploadChoice({
  image,
  video,
  className,
  style,
  disabled = false,
  triggerLabel,
  triggerDetail,
  triggerIcon,
  dialogTitle,
  dialogDescription,
  testId,
}: LocalMediaUploadChoiceProps) {
  const mediaT = useTranslations("media");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasVisibleChoice = !image.hidden || !video.hidden;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const firstAvailable = dialog.querySelector<HTMLElement>(
        '[data-local-media-choice]:not([aria-disabled="true"])',
      );
      (firstAvailable || focusableElements(dialog)[0] || dialog).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  const choose = (choice: LocalMediaChoice) => {
    if (choice.disabled) return;
    choice.onSelect();
    setOpen(false);
  };

  const resolvedTriggerLabel = triggerLabel || mediaT("local_upload_trigger");
  const resolvedDialogTitle = dialogTitle || mediaT("local_upload_dialog_title");
  const resolvedDialogDescription =
    dialogDescription || mediaT("local_upload_dialog_description");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        style={style}
        disabled={disabled || !hasVisibleChoice}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        {triggerIcon}
        {triggerDetail ? (
          <>
            <strong>{resolvedTriggerLabel}</strong>
            <small>{triggerDetail}</small>
          </>
        ) : (
          resolvedTriggerLabel
        )}
      </button>

      {mounted && open
        ? createPortal(
            <div
              className={styles.backdrop}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div
                ref={dialogRef}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
              >
                <button
                  type="button"
                  className={styles.close}
                  onClick={() => setOpen(false)}
                  aria-label={mediaT("local_upload_close")}
                >
                  ×
                </button>
                <div className={styles.heading}>
                  <span aria-hidden="true">＋</span>
                  <div>
                    <h2 id={titleId}>{resolvedDialogTitle}</h2>
                    <p id={descriptionId}>{resolvedDialogDescription}</p>
                  </div>
                </div>
                <div className={styles.choices}>
                  {!image.hidden ? (
                    <button
                      type="button"
                      className={styles.choice}
                      data-local-media-choice="image"
                      aria-disabled={image.disabled || undefined}
                      title={image.disabled ? image.disabledReason : undefined}
                      onClick={() => choose(image)}
                    >
                      <span className={styles.choiceIcon} aria-hidden="true">
                        ▧
                      </span>
                      <span>
                        <strong>{mediaT("local_upload_image")}</strong>
                        <small>
                          {image.disabled
                            ? image.disabledReason || mediaT("local_upload_unavailable")
                            : image.detail ||
                              mediaT("local_upload_images_detail", {
                                count: image.maxSelection ?? 5,
                              })}
                        </small>
                      </span>
                    </button>
                  ) : null}
                  {!video.hidden ? (
                    <button
                      type="button"
                      className={styles.choice}
                      data-local-media-choice="video"
                      aria-disabled={video.disabled || undefined}
                      title={video.disabled ? video.disabledReason : undefined}
                      onClick={() => choose(video)}
                    >
                      <span className={styles.choiceIcon} aria-hidden="true">
                        ▶
                      </span>
                      <span>
                        <strong>{mediaT("local_upload_video")}</strong>
                        <small>
                          {video.disabled
                            ? video.disabledReason || mediaT("local_upload_unavailable")
                            : video.detail || mediaT("local_upload_video_detail")}
                        </small>
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
