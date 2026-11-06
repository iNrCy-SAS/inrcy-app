"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type DialogHTMLAttributes } from "react";
import { installBrowserPopoverFallback } from "@/lib/browserPopover";

export type CompatiblePopoverProps = Omit<DialogHTMLAttributes<HTMLDialogElement>, "popover" | "open"> & { popover?: "auto" };

/** One SSR-stable element; unsupported browsers receive a local dialog adapter. */
const CompatiblePopover = forwardRef<HTMLDialogElement, CompatiblePopoverProps>(function CompatiblePopover(
  { popover: _popover, onCancel, ...props }, forwardedRef,
) {
  const element = useRef<HTMLDialogElement>(null);
  useImperativeHandle(forwardedRef, () => element.current!, []);
  useLayoutEffect(() => {
    if (element.current) return installBrowserPopoverFallback(element.current);
  }, []);
  return <dialog {...props} ref={element} popover="auto" onCancel={event => {
    event.preventDefault();
    event.stopPropagation();
    element.current?.hidePopover?.();
    onCancel?.(event);
  }} />;
});

export default CompatiblePopover;
