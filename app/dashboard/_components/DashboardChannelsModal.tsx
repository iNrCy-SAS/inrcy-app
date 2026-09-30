"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import DashboardFluxBubble, { type DashboardFluxBubbleData } from "./DashboardFluxBubble";
import { getChannelSceneLayout, getChannelTone } from "./dashboard-channel-presentation";
import styles from "./DashboardChannelsModal.module.css";

type Props = {
  items: DashboardFluxBubbleData[];
  onClose: () => void;
  onOpenHelp?: () => void;
  /** Same plan-aware count displayed by the dashboard hub. */
  summary?: { connected: number; total: number };
};

type ChannelFilter = "all" | "connected" | "configure";

function ChannelsIcon() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="4" y="4" width="10" height="10" rx="3" fill="currentColor" /><rect x="18" y="4" width="10" height="10" rx="3" fill="currentColor" opacity=".65" /><rect x="4" y="18" width="10" height="10" rx="3" fill="currentColor" opacity=".65" /><rect x="18" y="18" width="10" height="10" rx="3" fill="currentColor" /></svg>;
}

export default function DashboardChannelsModal({ items, onClose, onOpenHelp, summary }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const selectedAreaRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [selectedKey, setSelectedKey] = useState("inrbadge");
  const [motionPaused, setMotionPaused] = useState(false);
  const [sceneLayout, setSceneLayout] = useState(() => getChannelSceneLayout(1200, 520));

  const closeDialog = useCallback(() => {
    dialogRef.current?.close();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0 && !window.matchMedia("(max-width: 1100px)").matches) {
        setSceneLayout(getChannelSceneLayout(width, height));
      }
    });
    observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  const filteredItems = useMemo(() => items.filter((item) => {
    const tone = getChannelTone(item);
    return filter === "all" || (filter === "connected" ? tone === "connected" : tone === "available" || tone === "warning");
  }), [filter, items]);
  const selected = filteredItems.find((item) => item.key === selectedKey) ?? filteredItems[0];
  const satellites = filteredItems.filter((item) => item.key !== selected?.key);
  const connectedCount = summary?.connected ?? items.filter((item) => getChannelTone(item) === "connected").length;
  const totalCount = summary?.total ?? items.length;
  const selectAdjacentChannel = (direction: -1 | 1) => {
    if (!selected || filteredItems.length < 2) return;
    const index = filteredItems.findIndex((item) => item.key === selected.key);
    setSelectedKey(filteredItems[(index + direction + filteredItems.length) % filteredItems.length].key);
  };

  // Only wrap presentation-level actions: their original destination and guards remain unchanged.
  const selectedItem = selected ? {
    ...selected,
    onConfigure: () => { closeDialog(); selected.onConfigure(); },
    onSpecialView: selected.onSpecialView ? () => { closeDialog(); selected.onSpecialView?.(); } : undefined,
    onCreate: selected.onCreate ? () => { closeDialog(); selected.onCreate?.(); } : undefined,
    viewAction: selected.viewAction ? {
      ...selected.viewAction,
      onClick: selected.viewAction.onClick ? () => { closeDialog(); selected.viewAction?.onClick?.(); } : undefined,
    } : undefined,
  } : null;

  return (
    <dialog
      ref={dialogRef}
      data-dashboard-channels-dialog="true"
      className={`${styles.dialog} ${motionPaused ? styles.motionPaused : ""}`}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); closeDialog(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
      }}
    >
      <div className={styles.surface}>
        <div className={styles.ambient} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        <header className={styles.headerPanel}>
          <div className={styles.heading}>
            <span className={styles.headingIcon}><ChannelsIcon /></span>
            <h2 id={titleId}>Mes canaux</h2>
            <p id={descriptionId} className={styles.srOnly}>Votre écosystème de visibilité. Sélectionnez une bulle pour explorer un canal.</p>
          </div>
          <div className={styles.headerInfo}>
            <span className={styles.connectionCount}><span aria-hidden="true" /><strong>{connectedCount} connectés</strong><span className={styles.countTotal}>/ {totalCount}</span></span>
          <div className={styles.filters} role="group" aria-label="Filtrer les canaux">
            {([{ value: "all", label: "Tous" }, { value: "connected", label: "Connectés" }, { value: "configure", label: "À configurer" }] as const).map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={filter === value} className={`${styles.filter} ${filter === value ? styles.filterActive : ""}`} onClick={() => setFilter(value)}>
                {value !== "all" ? <span className={value === "connected" ? styles.greenDot : styles.amberDot} aria-hidden="true" /> : null}{label}
              </button>
            ))}
          </div>
          </div>
          <div className={styles.toolbarActions}>
            <button type="button" className={styles.motionButton} aria-pressed={motionPaused} onClick={() => setMotionPaused((paused) => !paused)} title={motionPaused ? "Reprendre l’animation" : "Mettre en pause l’animation"}>
              <svg viewBox="0 0 20 20" aria-hidden="true">{motionPaused ? <path d="m7 4 9 6-9 6Z" /> : <><path d="M6 4v12M14 4v12" /></>}</svg><span>{motionPaused ? "Reprendre" : "Pause"}</span>
            </button>
            {onOpenHelp ? <button type="button" className={styles.helpButton} aria-label="Aide sur les canaux" onClick={onOpenHelp}>?</button> : null}
            <button ref={closeButtonRef} type="button" className={styles.close} onClick={closeDialog} aria-label="Fermer les canaux">Fermer</button>
          </div>
        </header>

        <div ref={sceneRef} className={styles.scene} data-channel-count={filteredItems.length} style={{ "--center-size": `${sceneLayout.centerSize}px`, "--center-y": `${sceneLayout.centerY}px`, "--satellite-size": `${sceneLayout.satelliteSize}px` } as CSSProperties}>
          <div className={styles.nebula} aria-hidden="true" />
          <div className={styles.starfield} aria-hidden="true" />
          {selected ? (
            <div ref={selectedAreaRef} className={styles.selectedArea} tabIndex={-1} role="group" aria-label={`${selected.name} — ${selected.bubbleStatusText}`}>
              <div className={styles.selectedHalo} aria-hidden="true" />
              <div
                className={styles.selectedBubble}
                data-tone={getChannelTone(selected)}
                onClickCapture={(event) => {
                  const target = event.target instanceof Element ? event.target.closest("a") : null;
                  if (target && target.getAttribute("aria-disabled") !== "true" && target.getAttribute("href") !== "#") closeDialog();
                }}
              >
                <DashboardFluxBubble key={selected.key} item={selectedItem!} />
              </div>
              <button type="button" className={`${styles.channelArrow} ${styles.arrowPrevious}`} aria-label="Canal précédent" disabled={filteredItems.length < 2} onClick={() => selectAdjacentChannel(-1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
              <button type="button" className={`${styles.channelArrow} ${styles.arrowNext}`} aria-label="Canal suivant" disabled={filteredItems.length < 2} onClick={() => selectAdjacentChannel(1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
              <span className={styles.srOnly} aria-live="polite" aria-atomic="true">{selected.name} — {selected.bubbleStatusText}</span>
              {selected.helpKind && (selected.onHelpSiteInrcy || selected.onHelpSiteWeb) ? <button type="button" className={styles.siteHelp} aria-label={`Comprendre le canal ${selected.name}`} title={`Comprendre le canal ${selected.name}`} onClick={() => (selected.helpKind === "site_inrcy" ? selected.onHelpSiteInrcy : selected.onHelpSiteWeb)?.()}>?</button> : null}
            </div>
          ) : <div className={styles.empty}><ChannelsIcon /><h3>{filter === "configure" ? "Tout est prêt à rayonner." : "Aucun canal dans cette vue."}</h3><p>{filter === "configure" ? "Aucun canal disponible ne nécessite de configuration." : "Retrouvez l’ensemble de vos canaux dans la vue Tous."}</p><button type="button" onClick={() => setFilter("all")}>Voir tous les canaux</button></div>}

          <div className={styles.satellites} role="group" aria-label="Choisir un canal">
            {satellites.map((item, index) => {
              const { x, y, size } = sceneLayout.slots[index % sceneLayout.slots.length];
              const tone = getChannelTone(item);
              return (
                <div key={item.key} className={styles.satellitePosition} style={{ "--bubble-x": `${x}px`, "--bubble-y": `${y}px`, "--bubble-size": `${size}px`, "--bubble-delay": `${index * -0.83}s`, "--bubble-duration": `${7 + index % 4}s`, "--bubble-hue": `${[194, 259, 202, 285, 216, 321][index % 6]}` } as CSSProperties}>
                  <button type="button" className={`${styles.satellite} ${styles[tone]}`} onClick={() => {
                    setSelectedKey(item.key);
                    // The chosen satellite leaves the ring; retain a useful keyboard focus.
                    requestAnimationFrame(() => selectedAreaRef.current?.focus());
                  }} aria-label={`${item.name} — ${item.bubbleStatusText}. Sélectionner ce canal.`} title={`${item.name} · ${item.bubbleStatusText}`}>
                    <span className={styles.satelliteStatus} aria-hidden="true" />
                    <span className={styles.channelLogoMedallion}><Image src={item.logoSrc} alt="" width={58} height={58} unoptimized loading="eager" decoding="sync" className={styles.channelLogo} /></span>
                    <span className={styles.channelName}>{item.name}</span>
                    <span className={styles.channelStatusText}>{item.bubbleStatusText}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </dialog>
  );
}
