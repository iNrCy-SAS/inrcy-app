type BubbleBounds = { left: number; top: number; width: number; height: number };

/** Small frames belong to the active bubble and must stay within the viewport. */
export function getChannelPopoverPosition(
  button: { left: number; width: number; bottom: number },
  viewport: { width: number; height: number },
  preferredWidth: number,
  content: { height: number; bubble?: BubbleBounds } = { height: 240 },
) {
  const edge = 12;
  const gap = 8;
  const width = Math.min(preferredWidth, Math.max(0, viewport.width - edge * 2));
  const maxHeight = Math.max(0, viewport.height - edge * 2);
  const height = Math.min(content.height, maxHeight);
  const centerX = content.bubble ? content.bubble.left + content.bubble.width / 2 : button.left + button.width / 2;
  const centerY = content.bubble ? content.bubble.top + content.bubble.height / 2 : viewport.height / 2;
  const below = button.bottom + gap;
  const top = !content.bubble && below + height <= viewport.height - edge
    ? below
    : Math.max(edge, Math.min(centerY - height / 2, viewport.height - height - edge));
  return {
    width,
    left: Math.max(edge, Math.min(centerX - width / 2, viewport.width - width - edge)),
    top,
    maxHeight,
  };
}

export function getChannelPopoverPlacement(button: HTMLButtonElement, menu: HTMLElement | null, preferredWidth: number) {
  const bubble = button.closest<HTMLElement>("article[data-channel-bubble]")?.getBoundingClientRect();
  return getChannelPopoverPosition(button.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, preferredWidth, {
    bubble,
    height: menu ? Math.max(menu.scrollHeight + 2, menu.offsetHeight) || 240 : 240,
  });
}
