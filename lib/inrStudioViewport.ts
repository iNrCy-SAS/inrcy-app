/** Keep the actual origin nodes: an embedded Studio never replaces their tree. */
export function captureInrStudioViewport() {
  const focus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const windowPosition = { left: window.scrollX, top: window.scrollY };
  const positions = Array.from(document.querySelectorAll<HTMLElement>("*"))
    .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0 ||
      element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
    .map((element) => ({ element, left: element.scrollLeft, top: element.scrollTop }));

  return () => {
    for (const { element, left, top } of positions) {
      if (element.isConnected) element.scrollTo({ left, top, behavior: "instant" });
    }
    window.scrollTo({ ...windowPosition, behavior: "instant" });
    if (focus?.isConnected) focus.focus({ preventScroll: true });
  };
}
