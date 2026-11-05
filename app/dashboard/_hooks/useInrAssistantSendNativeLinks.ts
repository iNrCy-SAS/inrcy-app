"use client";
import { useCallback, useRef, useState } from "react";
import { useInrAssistantLocalInterface } from "./useInrAssistantLocalInterface";

const TARGET = /^(?:account|publication|active_video|(?:image|video|file):(?:[1-9]|[1-9][0-9]|100))$/;
/** Targets refer only to explicit, rendered controls in an owned history detail.
 * No model URL or DOM discovery. ACK means handed to the browser, never loaded
 * external content or a completed download. */
export function useInrAssistantSendNativeLinks(options: { enabled: boolean; busy: boolean; stateKey: string }) {
  const controls = useRef(new Map<string, { node: HTMLAnchorElement | HTMLButtonElement; href: string }>());
  const [requested, setRequested] = useState({ target: "", sequence: 0 });
  const state = { stateKey: options.stateKey, requested };
  useInrAssistantLocalInterface("send_links", state, { select: {
    invoke: (value, stillCurrent) => {
      if (!stillCurrent() || !value || !TARGET.test(value)) throw new Error("Unavailable history link");
      const control = controls.current.get(value);
      if (!control?.node.isConnected || control.node.matches(":disabled")) throw new Error("History link is not rendered");
      const url = new URL(control.href, window.location.href);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || control.node instanceof HTMLAnchorElement && control.node.href !== url.href) throw new Error("History link has changed");
      control.node.click();
      if (!stillCurrent()) throw new Error("History link scope changed");
      setRequested(previous => ({ target: value, sequence: previous.sequence + 1 }));
    },
    matches: (value, target) => { const current = value as typeof state; return current.stateKey === state.stateKey && current.requested.target === target && current.requested.sequence > requested.sequence; },
  } }, options.enabled, options.busy);
  return useCallback((target: string, href: string | null | undefined) => (node: HTMLAnchorElement | HTMLButtonElement | null) => {
    if (node && href && TARGET.test(target)) controls.current.set(target, { node, href });
    else controls.current.delete(target);
  }, []);
}
