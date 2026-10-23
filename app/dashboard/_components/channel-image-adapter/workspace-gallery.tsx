import { useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { FinalImageFrame } from "./frames";
import type { CardItem } from "./types";
import css from "./workspace-gallery.module.css";

export default function WorkspaceGallery({ items, aspectRatio, emptyMessage }: {
  items: CardItem[]; aspectRatio: string; emptyMessage?: string;
}) {
  const t = useTranslations("shell");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const activeIndex = Math.max(0, items.findIndex((item) => item.key === activeKey));
  const item = items[activeIndex];
  if (!item) return <div>{emptyMessage || t("aucune_image_768c8a5c")}</div>;
  const disabled = Boolean(item.disabled && !item.included);
  const ratioText = item.previewAspectRatio || aspectRatio;
  const ratioParts = ratioText.split("/").map(Number);
  const ratio = ratioParts.length === 2 ? ratioParts[0] / ratioParts[1] : Number(ratioText);
  const movePreview = (offset: number) => setActiveKey(items[(activeIndex + offset + items.length) % items.length].key);

  return <div className={css.gallery} data-publish-media-gallery>
    <div className={css.visual}>
      <div className={css.stage}>
        <div className={css.frame} style={{ "--media-ratio": Number.isFinite(ratio) && ratio > 0 ? ratio : 1 } as CSSProperties}>
          <FinalImageFrame image={{ previewUrl: item.previewUrl, transform: item.transform, preset: item.preset, imageMeta: item.imageMeta }}
            aspectRatio={ratioText} fallbackMode={item.backgroundMode} />
        </div>
        {items.length > 1 ? <>
          <button type="button" className={css.previous} onClick={() => movePreview(-1)} aria-label={t("image_precedente_635f9e95")}>‹</button>
          <button type="button" className={css.next} onClick={() => movePreview(1)} aria-label={t("image_suivante_656228da")}>›</button>
          <span className={css.counter}>{activeIndex + 1} / {items.length}</span>
        </> : null}
      </div>
      {items.length > 1 ? <div className={css.thumbnails} role="group" aria-label={t("images_de_la_publication_85bb3522")}>
        {items.map((thumbnail) => <button key={thumbnail.key} type="button"
          aria-label={thumbnail.title} aria-pressed={thumbnail.key === item.key}
          className={css.thumbnail} onClick={() => setActiveKey(thumbnail.key)}
          draggable={Boolean(thumbnail.onMoveTo) && !(thumbnail.disabled && !thumbnail.included)}
          title={thumbnail.dragLabel || thumbnail.title}
          onDragStart={(event) => { event.dataTransfer.setData("text/plain", thumbnail.key); event.dataTransfer.effectAllowed = "move"; setDraggedKey(thumbnail.key); }}
          onDragOver={(event) => { if (draggedKey && draggedKey !== thumbnail.key && thumbnail.onMoveTo && !(thumbnail.disabled && !thumbnail.included)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
          onDrop={(event) => { event.preventDefault(); const sourceKey = event.dataTransfer.getData("text/plain") || draggedKey; const source = items.find((candidate) => candidate.key === sourceKey); if (source && source.key !== thumbnail.key && !(source.disabled && !source.included) && !(thumbnail.disabled && !thumbnail.included)) source.onMoveTo?.(thumbnail.key); setDraggedKey(null); }}
          onDragEnd={() => setDraggedKey(null)}>
          <img src={thumbnail.previewUrl} alt="" draggable={false} />
          <span className={css.inclusion} data-included={thumbnail.included} aria-hidden="true">{thumbnail.included ? "✓" : "−"}</span>
        </button>)}
      </div> : null}
    </div>
    <aside className={css.tools}>
      <div className={css.imageHeading}><strong>{item.title}</strong><span>{item.fitLabel}</span></div>
      <label className={css.include}><input type="checkbox" checked={item.included} disabled={disabled} onChange={item.onToggle} />
        {item.included ? t("incluse_8c79d3a2") : t("ignoree_2b9acddb")}
      </label>
      <p className={css.detail}>{item.subtitle}</p>
      <div className={css.actions}>
        <button type="button" onClick={item.onModify} disabled={disabled} className={css.modify}>✦ {t("modifier_image_3f1a7c90")}</button>
        <button type="button" onClick={item.onAdapt} disabled={disabled} className={css.adapt}>↗ {t("adapter_e6b4616c")}</button>
      </div>
      <div className={css.smallActions}>
        <button type="button" onClick={item.onMovePrevious} disabled={!item.onMovePrevious || disabled} aria-label={t("image_precedente_635f9e95")} title={t("image_precedente_635f9e95")}>←</button>
        <button type="button" onClick={item.onMoveNext} disabled={!item.onMoveNext || disabled} aria-label={t("image_suivante_656228da")} title={t("image_suivante_656228da")}>→</button>
        {item.onReset ? <button type="button" onClick={item.onReset} aria-label={t("reinitialiser_value_cecceaa0", { value0: item.title })} title={t("reinitialiser_value_cecceaa0", { value0: item.title })}>↺</button> : null}
      </div>
      <div className={css.removeActions}>
        {item.onRemove ? <button type="button" onClick={item.onRemove} title={item.removeLabel}>{item.removeLabel || t("retirer_54ec24a1")}</button> : null}
        {item.onRemoveEverywhere ? <button type="button" onClick={item.onRemoveEverywhere} className={css.destructive}>{item.removeEverywhereLabel || t("supprimer_partout_dfb790c4")}</button> : null}
      </div>
    </aside>
  </div>;
}
