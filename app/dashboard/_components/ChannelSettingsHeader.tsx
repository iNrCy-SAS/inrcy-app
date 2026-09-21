"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, type ReactNode, type TouchEvent } from "react";
import styles from "../dashboard.module.css";

type ChannelNavigationTarget = {
  name: string;
  onSelect: () => void;
};

type Props = {
  name: string;
  logoSrc: string;
  logoAlt?: string;
  previous: ChannelNavigationTarget;
  next: ChannelNavigationTarget;
  identityContent?: ReactNode;
};

export default function ChannelSettingsHeader({
  name,
  logoSrc,
  logoAlt = "",
  previous,
  next,
  identityContent,
}: Props) {
  const statsT = useTranslations("stats");
  const touchOriginRef = useRef<{ x: number; y: number } | null>(null);
  const previousLabel = `${statsT("canal_precedent_65f40ce6")} : ${previous.name}`;
  const nextLabel = `${statsT("canal_suivant_7b81611d")} : ${next.name}`;

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      touchOriginRef.current = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    touchOriginRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const origin = touchOriginRef.current;
    const touch = event.changedTouches[0];
    touchOriginRef.current = null;
    if (!origin || !touch) return;

    const deltaX = touch.clientX - origin.x;
    const deltaY = touch.clientY - origin.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
    if (deltaX > 0) previous.onSelect();
    else next.onSelect();
  };

  return (
    <div
      className={styles.channelSettingsHeaderNav}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <button
        type="button"
        className={styles.channelSettingsCycleButton}
        onClick={previous.onSelect}
        aria-label={previousLabel}
        title={previousLabel}
      >
        <span aria-hidden="true">‹</span>
      </button>

      <div className={styles.channelSettingsHeaderIdentity}>
        {identityContent ?? (
          <>
            <span className={styles.channelSettingsHeaderLogoBubble} aria-hidden="true">
              <Image
                className={styles.channelSettingsHeaderLogo}
                src={logoSrc}
                alt={logoAlt}
                width={44}
                height={44}
              />
            </span>
            <strong>{name}</strong>
          </>
        )}
      </div>

      <button
        type="button"
        className={styles.channelSettingsCycleButton}
        onClick={next.onSelect}
        aria-label={nextLabel}
        title={nextLabel}
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
