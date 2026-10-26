"use client";

import type { ComponentProps, MouseEvent, ReactNode } from "react";
import type { Nodes, PhrasingContent, Root } from "mdast";
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins, type Components, type UrlTransform } from "streamdown";
import { getAssistantAppPath, getAssistantInternalDestination, getSafeAssistantHref } from "../../../lib/inrAssistantNavigation";
import styles from "./DashboardAssistantMessageContent.module.css";

export { getSafeAssistantHref } from "../../../lib/inrAssistantNavigation";
const ALLOWED_ELEMENTS = [
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
  "hr", "li", "ol", "p", "pre", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
];

type Navigate = (href: string) => void;
type LinkProps = (ComponentProps<"a"> | Record<string, unknown>) & { onInternalNavigate?: Navigate };

export function AssistantMessageLink({ href, children, title, onInternalNavigate }: LinkProps) {
  const safeHref = getSafeAssistantHref(typeof href === "string" ? href : undefined);
  const label = children as ReactNode;
  if (!safeHref) return <span>{label}</span>;
  const internal = getAssistantInternalDestination(safeHref);
  if (internal) return <a href={internal.href} data-inrcy-unguarded-navigation={onInternalNavigate ? "true" : undefined}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      if (!onInternalNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onInternalNavigate(internal.href);
    }}>{internal.label}</a>;
  if (getAssistantAppPath(safeHref)?.startsWith("/dashboard")) return <span>iNrCy</span>;
  return <a href={safeHref} title={typeof title === "string" ? title : undefined} target="_blank" rel="noopener noreferrer">{label}</a>;
}

const baseComponents: Components = {
  p: "p", strong: "strong", ul: "ul", ol: "ol", li: "li", blockquote: "blockquote",
  h1: "h1", h2: "h2", h3: "h3", h4: "h4", h5: "h5", h6: "h6", hr: "hr", pre: "pre", code: "code",
};
// Preserve sanitization, but enforce our own URL policy instead of rewriting links.
const rehypePlugins = [defaultRehypePlugins.raw, defaultRehypePlugins.sanitize];
const remarkRehypeOptions = { allowDangerousHtml: false };
const transformUrl: UrlTransform = (url, key) => key === "href" ? getSafeAssistantHref(url) : undefined;

/** Transform parsed text nodes only: no raw HTML or Markdown string rewriting. */
function remarkAssistantNavigation() {
  return (tree: Root) => {
    const definitions = new Map(tree.children.filter(node => node.type === "definition").map(node => [node.identifier.toLowerCase(), node.url]));
    function linksInText(value: string): PhrasingContent[] {
      const result: PhrasingContent[] = [];
      // This locates URL tokens inside an already parsed text node, not Markdown.
      const paths = /(?:https?:\/\/[^\s<>"'`]+|(?<![\w/])\/dashboard(?:[/?#][^\s<>"'`]*|(?=$|[\s),.;:!?])))/giu;
      let previous = 0;
      for (const match of value.matchAll(paths)) {
        const token = match[0].replace(/[),.;:!?]+$/u, "");
        const destination = getAssistantInternalDestination(token);
        const isDashboardPath = /^\/dashboard(?:[/?#]|$)/u.test(getAssistantAppPath(token) || "");
        if (!destination && !isDashboardPath) continue;
        if (match.index! > previous) result.push({ type: "text", value: value.slice(previous, match.index) });
        result.push(destination ? { type: "link", url: destination.href, children: [{ type: "text", value: destination.label }] } : { type: "text", value: "iNrCy" });
        previous = match.index! + token.length;
      }
      if (previous < value.length) result.push({ type: "text", value: value.slice(previous) });
      return result;
    }
    function walk(node: Nodes) {
      if (!("children" in node)) return;
      const children: Nodes[] = node.children;
      node.children = children.flatMap<Nodes>(child => {
        if (child.type === "link" || child.type === "linkReference") {
          const url = child.type === "link" ? child.url : definitions.get(child.identifier.toLowerCase());
          const destination = getAssistantInternalDestination(url);
          if (destination) return [{ type: "link" as const, url: destination.href, children: [{ type: "text" as const, value: destination.label }] }];
          return [child];
        }
        if (child.type === "text") return linksInText(child.value);
        if (child.type === "inlineCode") {
          const destination = getAssistantInternalDestination(child.value);
          if (destination) return [{ type: "link" as const, url: destination.href, children: [{ type: "text" as const, value: destination.label }] }];
          if (/^\/dashboard(?:[/?#]|$)/u.test(getAssistantAppPath(child.value) || "")) return [{ type: "text" as const, value: "iNrCy" }];
          return [child];
        }
        walk(child);
        return [child];
      }) as typeof node.children;
    }
    walk(tree);
  };
}
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkAssistantNavigation];

export default function DashboardAssistantMessageContent({ content, onInternalNavigate }: { content: string; onInternalNavigate?: Navigate }) {
  const components: Components = { ...baseComponents, a: props => <AssistantMessageLink {...props} onInternalNavigate={onInternalNavigate} /> };
  return (
    <Streamdown
      className={styles.content}
      mode="static"
      controls={false}
      components={components}
      allowedElements={ALLOWED_ELEMENTS}
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
      remarkRehypeOptions={remarkRehypeOptions}
      skipHtml
      urlTransform={transformUrl}
    >
      {content}
    </Streamdown>
  );
}
