import type { ReactNode } from "react";
import type { AutomationKey } from "../_lib/agent.types";

export function AutomationIcon({ type }: { type: AutomationKey }) {
  if (type === "publish") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden>
        <path d="M16 36h-4a6 6 0 0 1 0-12h4" />
        <path d="M18 24 44 14v36L18 40V24Z" />
        <path d="M25 42v7a5 5 0 0 0 5 5h3" />
        <path d="M49 24c3 3 3 13 0 16" />
      </svg>
    );
  }

  if (type === "grow") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden>
        <path d="M34 37 23 26c6-11 16-17 30-16-1 14-7 24-19 27Z" />
        <path d="M25 35 14 46" />
        <path d="M21 43 15 49" />
        <path d="M37 16l11 11" />
        <path d="M20 28H10l9-9" />
        <path d="M36 44v10l9-9" />
      </svg>
    );
  }

  if (type === "loyalty") {
    return (
      <svg viewBox="0 0 64 64" aria-hidden>
        <path d="M32 51S13 39 13 24c0-7 5-12 12-12 4 0 7 2 9 5 2-3 5-5 9-5 7 0 12 5 12 12 0 15-23 27-23 27Z" />
        <path d="M21 37h9l4-8 5 12 4-7h8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <path d="M14 50V34h9v16h-9Z" />
      <path d="M28 50V22h9v28h-9Z" />
      <path d="M42 50V12h9v38h-9Z" />
    </svg>
  );
}

export function AutomationSettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        stroke="none"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.33-.02-.64-.06-.94l2.05-1.59c.18-.14.23-.39.11-.6l-2-3.46c-.12-.21-.37-.29-.59-.21l-2.42.97c-.5-.38-1.04-.7-1.63-.95l-.36-2.57a.5.5 0 0 0-.48-.41h-3a.5.5 0 0 0-.48.41l-.36 2.57c-.59.25-1.13.57-1.63.95L5.93 5.2c-.22-.08-.47 0-.59.21l-2 3.46c-.12.21-.07.46.11.6l2.05 1.59c-.04.3-.06.61-.06.94 0 .33.02.64.06.94l-2.05 1.59c-.18.14-.23.39-.11.6l2 3.46c.12.21.37.29.59.21l2.42-.97c.5.38 1.04.7 1.63.95l.36 2.57c.03.24.24.41.48.41h3c.24 0 .45-.17.48-.41l.36-2.57c.59-.25 1.13-.57 1.63-.95l2.42.97c.22.08.47 0 .59-.21l2-3.46c.12-.21.07-.46-.11-.6l-2.05-1.59ZM12 16.05a4.05 4.05 0 1 0 0-8.1 4.05 4.05 0 0 0 0 8.1Z"
      />
      <circle cx="12" cy="12" r="4.95" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="12" cy="12" r="2.55" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function ImageMetaIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="m7 16 4-4 3 3 2-2 3 3" />
      <path d="M8.5 9.5h.1" />
    </svg>
  );
}

export function CalendarMetaIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="M9 14h.1" />
      <path d="M13 14h.1" />
    </svg>
  );
}

export function PencilActionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4.5 19.5 6 14l9.9-9.9a2.1 2.1 0 0 1 3 3L9 17l-4.5 2.5Z" />
      <path d="m14.5 5.5 4 4" />
      <path d="M12 19h7" />
    </svg>
  );
}

export function SaveActionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 4h11l3 3v13H5V4Z" />
      <path d="M8 4v6h8V4" />
      <path d="M8 20v-6h8v6" />
    </svg>
  );
}

export function NavigationChevronIcon({
  direction,
}: {
  direction: "left" | "right";
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d={direction === "left" ? "m14.5 5-7 7 7 7" : "m9.5 5 7 7-7 7"}
      />
    </svg>
  );
}

export function ValidateActionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m6.8 12.4 3.2 3.2 7.2-7.4" />
    </svg>
  );
}

export function RefuseActionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m8 8 8 8" />
      <path d="m16 8-8 8" />
    </svg>
  );
}

export function DownloadActionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 4v10" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

export function SparkSettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="m5.6 5.6 2.8 2.8" />
      <path d="m15.6 15.6 2.8 2.8" />
      <path d="m18.4 5.6-2.8 2.8" />
      <path d="m8.4 15.6-2.8 2.8" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

export function SendPlaneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M21 3 10 14" />
      <path d="m21 3-7 18-4-7-7-4 18-7Z" />
    </svg>
  );
}

export function ShieldLineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3 5.5 5.8v5.8c0 4.1 2.7 7.8 6.5 9.4 3.8-1.6 6.5-5.3 6.5-9.4V5.8L12 3Z" />
      <path d="m9.4 11.9 1.9 1.9 3.4-3.7" />
    </svg>
  );
}

function findInlineHtmlClose(text: string, start: number, tag: "strong" | "em" | "u") {
  const closePattern =
    tag === "strong"
      ? /<\s*\/\s*(strong|b)\s*>/i
      : tag === "em"
        ? /<\s*\/\s*(em|i)\s*>/i
        : /<\s*\/\s*u\s*>/i;
  const afterOpen = text.slice(start);
  const close = afterOpen.match(closePattern);
  if (!close || typeof close.index !== "number") return null;
  return { index: start + close.index, length: close[0].length };
}

function renderInlineHtmlTag(tag: "strong" | "em" | "u", value: string, key: string): ReactNode {
  const children = renderRichInlineText(value, key);
  if (tag === "strong") return <strong key={key}>{children}</strong>;
  if (tag === "em") return <em key={key}>{children}</em>;
  return <u key={key}>{children}</u>;
}

export function renderRichInlineText(text: string, keyPrefix = "rich"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  let safety = 0;

  while (index < text.length && safety < 1200) {
    safety += 1;
    const rest = text.slice(index);
    const htmlOpen = rest.match(/^<\s*(strong|b|em|i|u)\s*>/i);
    if (htmlOpen) {
      const normalizedTag = htmlOpen[1].toLowerCase();
      const tag = normalizedTag === "strong" || normalizedTag === "b" ? "strong" : normalizedTag === "em" || normalizedTag === "i" ? "em" : "u";
      const contentStart = index + htmlOpen[0].length;
      const close = findInlineHtmlClose(text, contentStart, tag);
      if (close && close.index > contentStart) {
        const value = text.slice(contentStart, close.index);
        const key = `${keyPrefix}-html-${tag}-${index}`;
        nodes.push(renderInlineHtmlTag(tag, value, key));
        index = close.index + close.length;
        continue;
      }
    }

    if (rest.startsWith("***")) {
      const end = text.indexOf("***", index + 3);
      if (end > index + 3) {
        const value = text.slice(index + 3, end);
        const key = `${keyPrefix}-bi-${index}`;
        nodes.push(<strong key={key}><em>{renderRichInlineText(value, key)}</em></strong>);
        index = end + 3;
        continue;
      }
    }

    if (rest.startsWith("___")) {
      const end = text.indexOf("___", index + 3);
      if (end > index + 3) {
        const value = text.slice(index + 3, end);
        const key = `${keyPrefix}-bi2-${index}`;
        nodes.push(<strong key={key}><em>{renderRichInlineText(value, key)}</em></strong>);
        index = end + 3;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        const value = text.slice(index + 2, end);
        nodes.push(<strong key={`${keyPrefix}-b-${index}`}>{renderRichInlineText(value, `${keyPrefix}-b-${index}`)}</strong>);
        index = end + 2;
        continue;
      }
    }

    if (rest.startsWith("__")) {
      const end = text.indexOf("__", index + 2);
      if (end > index + 2) {
        const value = text.slice(index + 2, end);
        nodes.push(<strong key={`${keyPrefix}-b2-${index}`}>{renderRichInlineText(value, `${keyPrefix}-b2-${index}`)}</strong>);
        index = end + 2;
        continue;
      }
    }

    if (rest.startsWith("<u>")) {
      const end = text.indexOf("</u>", index + 3);
      if (end > index + 3) {
        const value = text.slice(index + 3, end);
        nodes.push(<u key={`${keyPrefix}-u-${index}`}>{renderRichInlineText(value, `${keyPrefix}-u-${index}`)}</u>);
        index = end + 4;
        continue;
      }
    }

    if (rest.startsWith("*") && !rest.startsWith("**")) {
      const end = text.indexOf("*", index + 1);
      if (end > index + 1) {
        const value = text.slice(index + 1, end);
        nodes.push(<em key={`${keyPrefix}-i-${index}`}>{renderRichInlineText(value, `${keyPrefix}-i-${index}`)}</em>);
        index = end + 1;
        continue;
      }
    }

    if (rest.startsWith("_") && !rest.startsWith("__")) {
      const end = text.indexOf("_", index + 1);
      if (end > index + 1) {
        const value = text.slice(index + 1, end);
        nodes.push(<em key={`${keyPrefix}-i2-${index}`}>{renderRichInlineText(value, `${keyPrefix}-i2-${index}`)}</em>);
        index = end + 1;
        continue;
      }
    }

    const nextMarkers = [
      text.indexOf("<strong>", index + 1),
      text.indexOf("<b>", index + 1),
      text.indexOf("<em>", index + 1),
      text.indexOf("<i>", index + 1),
      text.indexOf("<u>", index + 1),
      text.indexOf("***", index + 1),
      text.indexOf("___", index + 1),
      text.indexOf("**", index + 1),
      text.indexOf("__", index + 1),
      text.indexOf("*", index + 1),
      text.indexOf("_", index + 1),
    ].filter((position) => position >= 0);
    const next = nextMarkers.length ? Math.min(...nextMarkers) : text.length;
    nodes.push(text.slice(index, next));
    index = next;
  }

  if (index < text.length) nodes.push(text.slice(index));
  return nodes;
}
