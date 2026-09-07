"use client";

import { useTranslations } from "next-intl";
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import styles from "./ChannelNavigationRail.module.css";

const DESKTOP_CHANNEL_NAVIGATION_QUERY = "(min-width: 1181px)";

type ChannelNavigationRailProps<ItemKey extends string> = {
  items: readonly ItemKey[];
  activeItem: ItemKey;
  onSelect: (item: ItemKey) => void;
  navigationLabel: string;
  trackStyle: CSSProperties;
  trackClassName?: string;
  rootStyle?: CSSProperties;
  disabled?: boolean;
  children: ReactNode;
};

function isDesktopChannelNavigation() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(DESKTOP_CHANNEL_NAVIGATION_QUERY).matches
  );
}

export default function ChannelNavigationRail<ItemKey extends string>({
  items,
  activeItem,
  onSelect,
  navigationLabel,
  trackStyle,
  trackClassName,
  rootStyle,
  disabled = false,
  children,
}: ChannelNavigationRailProps<ItemKey>) {
  const shellT = useTranslations("shell");
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activeIndex = Math.max(0, items.indexOf(activeItem));
  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < items.length - 1;
  const density =
    items.length >= 12
      ? "dense"
      : items.length >= 10
        ? "compact"
        : "comfortable";

  const centerItem = useCallback((item: ItemKey, behavior: ScrollBehavior) => {
    if (!isDesktopChannelNavigation()) return;
    const track = trackRef.current;
    if (!track) return;
    const element = Array.from(track.children).find(
      (candidate) =>
        (candidate as HTMLElement).dataset.channelNavigationItem === item,
    ) as HTMLElement | undefined;
    if (!element) return;

    const trackRect = track.getBoundingClientRect();
    const itemRect = element.getBoundingClientRect();
    const centeredLeft =
      track.scrollLeft +
      (itemRect.left - trackRect.left) -
      (track.clientWidth - itemRect.width) / 2;
    track.scrollTo({ left: Math.max(0, centeredLeft), behavior });
  }, []);

  useEffect(() => {
    centerItem(activeItem, "smooth");
  }, [activeItem, centerItem]);

  const navigate = (direction: -1 | 1) => {
    const nextIndex = activeIndex + direction;
    const nextItem = items[nextIndex];
    if (!nextItem) return;
    onSelect(nextItem);
    centerItem(nextItem, "smooth");
  };

  return (
    <div
      className={styles.root}
      style={rootStyle}
      aria-label={navigationLabel}
      data-channel-count={items.length}
      data-channel-density={density}
    >
      <button
        type="button"
        className={styles.arrow}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          navigate(-1);
        }}
        disabled={disabled || !hasPrevious}
        aria-label={shellT("element_precedent_358f9c1e")}
        title={shellT("element_precedent_358f9c1e")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <path
            d="m14.5 6.5-5 5.5 5 5.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div
        ref={trackRef}
        className={`${styles.track}${trackClassName ? ` ${trackClassName}` : ""}`}
        style={trackStyle}
        role="navigation"
        aria-label={navigationLabel}
      >
        {Children.map(children, (rendered, index) => {
          if (!isValidElement(rendered)) return rendered;
          const item = items[index];
          if (!item) return rendered;
          return cloneElement(
            rendered as ReactElement<Record<string, unknown>>,
            { "data-channel-navigation-item": item },
          );
        })}
      </div>

      <button
        type="button"
        className={styles.arrow}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          navigate(1);
        }}
        disabled={disabled || !hasNext}
        aria-label={shellT("element_suivant_9d61e569")}
        title={shellT("element_suivant_9d61e569")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <path
            d="m9.5 6.5 5 5.5-5 5.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
