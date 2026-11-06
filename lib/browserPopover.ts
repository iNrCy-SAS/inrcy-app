type PopoverElement = Element & { open?: boolean; showPopover?: () => void; hidePopover?: () => void };
const installed = new WeakMap<HTMLDialogElement, { release: () => void; users: number }>();
const manualToggle = Symbol("inrcyPopoverToggle");
type OpenFallback = { element: HTMLDialogElement; hide: () => void };
const openByDocument = new WeakMap<Document, OpenFallback[]>();

export function supportsNativePopover(element?: Element | null): boolean {
  const target = element || (typeof document === "undefined" ? null : document.createElement("div"));
  if (!target || installed.has(target as HTMLDialogElement)) return false;
  if (typeof (target as PopoverElement).showPopover !== "function" || typeof (target as PopoverElement).hidePopover !== "function") return false;
  try { target.matches(":popover-open"); return true; } catch { return false; }
}

/** Firefox before Popover support throws on the selector instead of returning false. */
export function isBrowserPopoverOpen(element: Element | null | undefined): boolean {
  if (!element) return false;
  if (installed.has(element as HTMLDialogElement)) return (element as PopoverElement).open === true;
  try { if (element.matches(":popover-open")) return true; } catch { /* Unsupported selector. */ }
  return (element as PopoverElement).open === true;
}

/** Install on this dialog only; native browsers keep their own top-layer API. */
export function installBrowserPopoverFallback(element: HTMLDialogElement): () => void {
  if (supportsNativePopover(element)) return () => {};
  const previous = installed.get(element);
  if (previous) { previous.users++; return () => { if (--previous.users === 0) previous.release(); }; }
  const ownerDocument = element.ownerDocument;
  const view = ownerDocument.defaultView;
  const savedMethods = new Map(["showPopover", "hidePopover", "togglePopover"].map(name => [name, Object.getOwnPropertyDescriptor(element, name)]));
  let wasOpen = element.open;
  let restoreFocus: HTMLElement | null = null;
  let released = false;
  const contains = (parent: Element, child: Element | null) => Boolean(child && typeof parent.contains === "function" && parent.contains(child));
  const removeOpen = () => openByDocument.set(ownerDocument, (openByDocument.get(ownerDocument) || []).filter(item => item.element !== element));

  function emit(type: "beforetoggle" | "toggle", open: boolean) {
    const EventClass = view?.Event || Event;
    const event = new EventClass(type, { cancelable: type === "beforetoggle" && open });
    Object.defineProperties(event, {
      oldState: { value: open ? "closed" : "open" },
      newState: { value: open ? "open" : "closed" },
      [manualToggle]: { value: true },
    });
    return element.dispatchEvent(event);
  }
  function restore() {
    const target = restoreFocus;
    restoreFocus = null;
    const current = ownerDocument.activeElement;
    if (current && current !== target && current !== element && current !== ownerDocument.body && !contains(element, current)) return;
    if (target?.isConnected && typeof target.focus === "function") target.focus({ preventScroll: true });
  }
  function show() {
    if (released || element.open) return;
    if (!emit("beforetoggle", true)) return;
    const focusBefore = ownerDocument.activeElement as HTMLElement | null;
    for (const other of [...(openByDocument.get(ownerDocument) || [])].reverse()) {
      if (other.element !== element && !contains(other.element, element)) other.hide();
    }
    restoreFocus = focusBefore;
    // A real modal dialog keeps the fallback above a containing modal and
    // gives Firefox its native focus trap, inert background and Escape stack.
    element.showModal();
    wasOpen = true;
    openByDocument.set(ownerDocument, [...(openByDocument.get(ownerDocument) || []), { element, hide }]);
    emit("toggle", true);
  }
  function hide() {
    if (released || !element.open) return;
    for (const other of [...(openByDocument.get(ownerDocument) || [])].reverse()) {
      if (other.element !== element && contains(element, other.element)) other.hide();
    }
    emit("beforetoggle", false);
    wasOpen = false;
    element.close();
    removeOpen();
    emit("toggle", false);
    restore();
  }
  function toggle(force?: boolean | { force?: boolean }) {
    const requested = typeof force === "object" ? force.force : force;
    if (requested ?? !element.open) show(); else hide();
    return element.open;
  }
  const onTargetClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const button = target && typeof target.closest === "function" ? target.closest("[popovertarget]") as HTMLButtonElement | null : null;
    if (!button || button.disabled || button.getAttribute("popovertarget") !== element.id) return;
    event.preventDefault();
    const action = button.getAttribute("popovertargetaction");
    if (action === "hide") hide(); else if (action === "show") show(); else toggle();
  };
  const onCancel = (event: Event) => { event.preventDefault(); event.stopPropagation(); hide(); };
  const onClose = () => {
    if (!wasOpen || element.open) return;
    emit("beforetoggle", false);
    wasOpen = false;
    removeOpen();
    emit("toggle", false);
    restore();
  };
  const onBackdrop = (event: MouseEvent) => {
    if (event.target !== element || !element.open) return;
    const box = element.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) hide();
  };
  // Some intermediate browsers implement dialog toggle events without the
  // Popover API. Emit one consistent pair from our adapter in that case too.
  const suppressNativeToggle = (event: Event) => {
    if (!(event as Event & { [manualToggle]?: boolean })[manualToggle]) event.stopImmediatePropagation();
  };
  element.addEventListener("beforetoggle", suppressNativeToggle, true);
  element.addEventListener("toggle", suppressNativeToggle, true);
  element.addEventListener("cancel", onCancel);
  element.addEventListener("close", onClose);
  element.addEventListener("click", onBackdrop);
  ownerDocument.addEventListener("click", onTargetClick);
  Object.defineProperties(element, {
    showPopover: { configurable: true, writable: true, value: show },
    hidePopover: { configurable: true, writable: true, value: hide },
    togglePopover: { configurable: true, writable: true, value: toggle },
  });
  const state = { users: 1, release() {
    if (released) return;
    hide();
    released = true;
    ownerDocument.removeEventListener("click", onTargetClick);
    element.removeEventListener("beforetoggle", suppressNativeToggle, true);
    element.removeEventListener("toggle", suppressNativeToggle, true);
    element.removeEventListener("cancel", onCancel);
    element.removeEventListener("close", onClose);
    element.removeEventListener("click", onBackdrop);
    for (const [name, descriptor] of savedMethods) {
      if (descriptor) Object.defineProperty(element, name, descriptor); else Reflect.deleteProperty(element, name);
    }
    installed.delete(element);
  } };
  installed.set(element, state);
  return () => { if (--state.users === 0) state.release(); };
}
