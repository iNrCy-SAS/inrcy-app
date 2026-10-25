export type InrcyTooltipContent = { label: string; description?: string };
export type InrcyTooltipState = InrcyTooltipContent & { anchor: Element; host: HTMLElement };
export type TooltipRectangle = { left: number; top: number; right: number; bottom: number; width: number; height: number };

const SOURCE_SELECTOR = "[title], [data-tooltip], [data-tooltip-title], [data-inrcy-tooltip], [data-inrcy-tooltip-title]";
const MANAGED_ATTRIBUTE = "data-inrcy-tooltip-managed";
const EXCLUDED_SELECTOR = 'link, style, script, [data-inrcy-tooltip="off"], [data-inrcy-tooltip-disabled]';

/** Fixed coordinates, including the visual viewport when the page is zoomed. */
export function getInrcyTooltipPosition(
  anchor: TooltipRectangle,
  bubble: { width: number; height: number },
  viewport: { width: number; height: number; left?: number; top?: number },
) {
  const margin = 12;
  const gap = 10;
  const minimumLeft = (viewport.left ?? 0) + margin;
  const minimumTop = (viewport.top ?? 0) + margin;
  const maximumLeft = Math.max(minimumLeft, (viewport.left ?? 0) + viewport.width - bubble.width - margin);
  const maximumTop = Math.max(minimumTop, (viewport.top ?? 0) + viewport.height - bubble.height - margin);
  const below = anchor.bottom + gap;
  const above = anchor.top - bubble.height - gap;
  const placement = above >= minimumTop || below + bubble.height > maximumTop + bubble.height ? "top" : "bottom";
  return {
    left: Math.min(maximumLeft, Math.max(minimumLeft, anchor.left + (anchor.width - bubble.width) / 2)),
    top: Math.min(maximumTop, Math.max(minimumTop, placement === "top" ? above : below)),
    placement,
  } as const;
}

/** Append our description without replacing a control's existing description. */
export function connectInrcyTooltip(anchor: Element, id: string) {
  const previous = anchor.getAttribute("aria-describedby");
  const ids = new Set((previous ?? "").split(/\s+/u).filter(Boolean));
  ids.add(id);
  anchor.setAttribute("aria-describedby", [...ids].join(" "));
  return () => {
    const remaining = (anchor.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter((value) => value && value !== id);
    if (remaining.length) anchor.setAttribute("aria-describedby", remaining.join(" "));
    else anchor.removeAttribute("aria-describedby");
  };
}

type OwnedAttribute = { value: string; previous: string | null };
type SourceRecord = { nativeTitle: string | null; label?: OwnedAttribute; description?: OwnedAttribute };

function isElement(value: EventTarget | Node | null): value is Element {
  return Boolean(value && "nodeType" in value && value.nodeType === 1);
}

function needsAccessibleName(element: Element, ownedLabel?: string) {
  const explicitLabel = element.getAttribute("aria-label")?.trim();
  if (explicitLabel && explicitLabel !== ownedLabel?.trim()) return false;
  const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/u).filter(Boolean);
  if (labelledBy.some((id) => {
    const label = element.ownerDocument.getElementById(id);
    return label?.textContent?.trim() || label?.getAttribute("aria-label")?.trim();
  })) return false;
  if ("labels" in element && (element as HTMLInputElement).labels?.length) return false;
  if (element.hasAttribute("alt") || element.querySelector('img[alt]:not([alt=""]), svg[aria-label], svg[aria-labelledby], svg title')) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "iframe") return true;
  if (tag === "input") {
    const input = element as HTMLInputElement;
    return !(["button", "submit", "reset"].includes(input.type) && input.value);
  }
  if (tag === "select" || tag === "textarea") return true;
  const isControl = element.matches('button, a[href], summary, [role="button"], [role="link"], [role="img"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="slider"], [role="textbox"]');
  return isControl && !/[\p{L}\p{N}]/u.test(element.textContent ?? "");
}

/**
 * One delegated controller enhances existing title attributes after hydration.
 * It leaves React callbacks, focusability and disabled states untouched. Titles
 * stay empty (rather than absent) to prevent native ancestor-title inheritance.
 */
export function createInrcyTooltipController({
  document: doc,
  onChange,
  getBubble,
  hoverDelay = 360,
  focusDelay = 80,
}: {
  document: Document;
  onChange: (_state: InrcyTooltipState | null) => void;
  getBubble: () => HTMLElement | null;
  hoverDelay?: number;
  focusDelay?: number;
}) {
  const win = doc.defaultView;
  if (!win) return { dismiss() {}, destroy() {} };
  const records = new WeakMap<Element, SourceRecord>();
  const media = win.matchMedia("(any-hover: hover) and (any-pointer: fine)");
  let active: InrcyTooltipState | null = null;
  let pending: Element | null = null;
  let hovered: Element | null = null;
  let focused: Element | null = null;
  let dismissed: Element | null = null;
  let keyboard = true;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;
  let navigationFrame: number | undefined;
  let activeUrl = "";
  let destroyed = false;

  function setOwnedAttribute(element: Element, record: SourceRecord, key: "label" | "description", value: string | null) {
    const name = key === "label" ? "aria-label" : "aria-description";
    const owned = record[key];
    if (owned && element.getAttribute(name) !== owned.value) {
      delete record[key];
      return; // An application update owns the new accessible attribute.
    }
    if (value) {
      if (!owned && element.getAttribute(name)?.trim()) return;
      record[key] = { previous: owned ? owned.previous : element.getAttribute(name), value };
      element.setAttribute(name, value);
    } else if (owned) {
      if (owned.previous === null) element.removeAttribute(name);
      else element.setAttribute(name, owned.previous);
      delete record[key];
    }
  }

  function contentFor(element: Element): InrcyTooltipContent | null {
    const label = (element.getAttribute("data-inrcy-tooltip-title") || element.getAttribute("data-tooltip-title") || element.getAttribute("data-inrcy-tooltip") || element.getAttribute("data-tooltip") || records.get(element)?.nativeTitle || "").trim();
    if (!label || element.closest(EXCLUDED_SELECTOR)) return null;
    // Existing interactive warning popovers retain their own interaction model.
    const describedBy = (element.getAttribute("aria-describedby") ?? "").split(/\s+/u);
    if (describedBy.some((id) => id && doc.getElementById(id)?.getAttribute("role") === "tooltip" && !doc.getElementById(id)?.hasAttribute("data-inrcy-tooltip-bubble"))) return null;
    const description = (element.getAttribute("data-inrcy-tooltip-description") || element.getAttribute("data-tooltip-description") || "").trim();
    return { label, ...(description && description !== label ? { description } : {}) };
  }

  function enhance(element: Element) {
    if (element.matches(EXCLUDED_SELECTOR) || element.closest('[data-inrcy-tooltip="off"], [data-inrcy-tooltip-disabled]')) return;
    let record = records.get(element);
    if (!record) {
      record = { nativeTitle: null };
      records.set(element, record);
    }
    const title = element.getAttribute("title");
    if (title) {
      record.nativeTitle = title;
      element.setAttribute("title", "");
    }
    const content = contentFor(element);
    const accessibleLabel = record.nativeTitle || content?.label;
    if (accessibleLabel) {
      const ownsName = needsAccessibleName(element, record.label?.value);
      setOwnedAttribute(element, record, "label", ownsName ? accessibleLabel : null);
      // aria-describedby already takes priority over aria-description. Keeping
      // this fallback also preserves the native title's semantics after our
      // temporary tooltip relationship is removed.
      setOwnedAttribute(element, record, "description", !ownsName ? content?.description || accessibleLabel : null);
    } else {
      setOwnedAttribute(element, record, "label", null);
      setOwnedAttribute(element, record, "description", null);
    }
    if (content || record.nativeTitle) element.setAttribute(MANAGED_ATTRIBUTE, "");
    else element.removeAttribute(MANAGED_ATTRIBUTE);
  }

  function scan(node: Node) {
    if (!isElement(node)) return;
    if (node.matches(SOURCE_SELECTOR)) enhance(node);
    node.querySelectorAll(SOURCE_SELECTOR).forEach(enhance);
  }

  function cancelTimers() {
    win!.clearTimeout(showTimer);
    win!.clearTimeout(hideTimer);
    showTimer = undefined;
    hideTimer = undefined;
    pending = null;
  }

  function dismiss() {
    cancelTimers();
    if (navigationFrame !== undefined) win!.cancelAnimationFrame(navigationFrame);
    navigationFrame = undefined;
    if (active) {
      active = null;
      onChange(null);
    }
  }

  function watchNavigation() {
    if (!active || destroyed) return;
    if (!active.anchor.isConnected || win!.location.href !== activeUrl) { dismiss(); return; }
    navigationFrame = win!.requestAnimationFrame(watchNavigation);
  }

  function findSource(target: EventTarget | null) {
    let element = isElement(target) ? target : null;
    while (element) {
      if (element.closest(EXCLUDED_SELECTOR)) return null;
      if (element.matches(SOURCE_SELECTOR)) {
        enhance(element);
        if (contentFor(element)) return element;
        if (element.hasAttribute("title")) return null;
      }
      element = element.parentElement;
    }
    return null;
  }

  function request(anchor: Element | null, delay: number) {
    win!.clearTimeout(hideTimer);
    hideTimer = undefined;
    if (!anchor || anchor === dismissed) return;
    if (active?.anchor === anchor || pending === anchor) return;
    dismiss();
    pending = anchor;
    showTimer = win!.setTimeout(() => {
      pending = null;
      const content = contentFor(anchor);
      if (destroyed || !anchor.isConnected || !content) return;
      const rect = anchor.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      active = { ...content, anchor, host: anchor.closest<HTMLDialogElement>("dialog[open]") ?? doc.body };
      activeUrl = win!.location.href;
      onChange(active);
      watchNavigation();
    }, delay);
  }

  function hideSoon() {
    win!.clearTimeout(showTimer);
    pending = null;
    if (focused && focused === active?.anchor) return;
    if (hideTimer === undefined) hideTimer = win!.setTimeout(dismiss, 140);
  }

  function onPointerOver(event: PointerEvent) {
    if (event.pointerType !== "mouse" || !media.matches) return;
    hovered = findSource(event.target);
    request(hovered, hoverDelay);
  }

  function onPointerOut(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    if (hovered && isElement(event.relatedTarget) && hovered.contains(event.relatedTarget)) return;
    if (dismissed === hovered) dismissed = null;
    hovered = null;
    hideSoon();
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerType !== "mouse" || !active) return;
    const containsPoint = (element: Element | null) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    };
    // The bubble remains hoverable while letting every click pass through it.
    if (containsPoint(active.anchor) || containsPoint(getBubble())) {
      win!.clearTimeout(hideTimer);
      hideTimer = undefined;
    } else hideSoon();
  }

  function onPointerDown() { keyboard = false; dismissed = active?.anchor ?? pending; dismiss(); }
  function onFocusIn(event: FocusEvent) {
    focused = findSource(event.target);
    if (keyboard) request(focused, focusDelay);
  }
  function onFocusOut(event: FocusEvent) {
    if (focused && isElement(event.relatedTarget) && focused.contains(event.relatedTarget)) return;
    if (dismissed === focused) dismissed = null;
    focused = null;
    dismiss();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape" && (active || pending)) {
      dismissed = active?.anchor ?? pending;
      dismiss();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !["Shift", "Control", "Alt", "Meta"].includes(event.key)) keyboard = true;
  }

  scan(doc.body);
  const Observer = win.MutationObserver;
  function processMutations(mutations: MutationRecord[]) {
    const changed = new Set<Element>();
    // Read the whole mutation batch before enhancing any target. A React update
    // can change title and data-tooltip together; our own title suppression must
    // not make a later record in that same batch look like an empty app label.
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && isElement(mutation.target)) {
        if (mutation.attributeName === "title") {
          const title = mutation.target.getAttribute("title");
          if (title === null || (title === "" && mutation.oldValue === "")) {
            const record = records.get(mutation.target);
            if (record) record.nativeTitle = null;
          }
        }
        changed.add(mutation.target);
      } else if (mutation.type === "childList" || mutation.type === "characterData") {
        const parent = isElement(mutation.target) ? mutation.target : mutation.target.parentElement;
        const source = parent?.closest(SOURCE_SELECTOR);
        if (source) changed.add(source);
      }
    }
    for (const mutation of mutations) {
      if (mutation.type === "childList") mutation.addedNodes.forEach(scan);
    }
    changed.forEach(enhance);
    if (active) {
      const content = contentFor(active.anchor);
      if (!active.anchor.isConnected || !content) dismiss();
      else if (content.label !== active.label || content.description !== active.description) {
        active = { ...content, anchor: active.anchor, host: active.host };
        onChange(active);
      }
    }
  }
  const observer = new Observer(processMutations);
  observer.observe(doc.body, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
    attributeFilter: ["title", "data-tooltip", "data-tooltip-title", "data-tooltip-description", "data-inrcy-tooltip", "data-inrcy-tooltip-title", "data-inrcy-tooltip-description", "data-inrcy-tooltip-disabled"],
  });
  doc.documentElement.setAttribute("data-inrcy-tooltips-ready", "");
  doc.addEventListener("pointerover", onPointerOver, true);
  doc.addEventListener("pointerout", onPointerOut, true);
  doc.addEventListener("pointermove", onPointerMove, { passive: true });
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("click", dismiss, true);
  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("focusout", onFocusOut, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("scroll", dismiss, { capture: true, passive: true });
  doc.addEventListener("visibilitychange", dismiss);
  win.addEventListener("resize", dismiss, { passive: true });
  win.addEventListener("blur", dismiss);
  win.addEventListener("popstate", dismiss);
  win.addEventListener("hashchange", dismiss);
  win.visualViewport?.addEventListener("resize", dismiss, { passive: true });
  win.visualViewport?.addEventListener("scroll", dismiss, { passive: true });

  return {
    dismiss,
    destroy() {
      if (destroyed) return;
      // React may have just cleared a title in the same commit that unmounts
      // this effect. Drain those writes before restoring our temporary changes.
      processMutations(observer.takeRecords());
      destroyed = true;
      dismiss();
      observer.disconnect();
      doc.documentElement.removeAttribute("data-inrcy-tooltips-ready");
      doc.removeEventListener("pointerover", onPointerOver, true);
      doc.removeEventListener("pointerout", onPointerOut, true);
      doc.removeEventListener("pointermove", onPointerMove);
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("click", dismiss, true);
      doc.removeEventListener("focusin", onFocusIn, true);
      doc.removeEventListener("focusout", onFocusOut, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("scroll", dismiss, true);
      doc.removeEventListener("visibilitychange", dismiss);
      win.removeEventListener("resize", dismiss);
      win.removeEventListener("blur", dismiss);
      win.removeEventListener("popstate", dismiss);
      win.removeEventListener("hashchange", dismiss);
      win.visualViewport?.removeEventListener("resize", dismiss);
      win.visualViewport?.removeEventListener("scroll", dismiss);
      doc.querySelectorAll(`[${MANAGED_ATTRIBUTE}]`).forEach((element) => {
        const record = records.get(element);
        if (record?.nativeTitle && element.getAttribute("title") === "") element.setAttribute("title", record.nativeTitle);
        if (record) {
          setOwnedAttribute(element, record, "label", null);
          setOwnedAttribute(element, record, "description", null);
        }
        element.removeAttribute(MANAGED_ATTRIBUTE);
      });
    },
  };
}
