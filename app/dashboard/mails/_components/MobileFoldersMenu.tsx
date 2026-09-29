import { useTranslations } from "next-intl";
import React from "react";
import styles from "../mails.module.css";
import { ALL_FOLDERS, folderLabel, folderTheme, type Folder, type FolderCounts } from "../_lib/mailboxPhase1";

type Props = {
  folders?: readonly Folder[];
  open: boolean;
  folder: Folder;
  counts: FolderCounts;
  countsLoading?: boolean;
  onClose: () => void;
  onSelectFolder: (folder: Folder) => void;
  adsTab?: { active: boolean; count: number | null; onSelect: () => void };
};

export default function MobileFoldersMenu({ folders = ALL_FOLDERS, open, folder, counts, countsLoading = false, onClose, onSelectFolder, adsTab }: Props) {
  const i18nT = useTranslations("mails");
  if (!open) return null;
  return (
    <div className={styles.mobileMenuOverlay} onClick={onClose}>
      <div className={styles.mobileMenu} onClick={(e) => e.stopPropagation()}>
        <div className={styles.mobileMenuHeader}>
          <div className={styles.mobileMenuTitle}>{i18nT("dossiers_2a59919f")}</div>
          <button className={styles.btnGhost} onClick={onClose} type="button">
            ✕
          </button>
        </div>
        <div className={styles.mobileMenuBody}>
          {folders.map((f) => {
            const active = !adsTab?.active && f === folder;
            return (
              <button
                key={f}
                className={`${styles.mobileFolderBtn} ${active ? styles.mobileFolderBtnActive : ""}`}
                style={folderTheme(f)}
                onClick={() => {
                  onSelectFolder(f);
                  onClose();
                }}
                type="button"
              >
                <span>{folderLabel(f)}</span>
                <span className={styles.badgeCount}>{countsLoading ? "…" : counts[f] || 0}</span>
              </button>
            );
          })}
          {adsTab && <button
            className={`${styles.mobileFolderBtn} ${adsTab.active ? styles.mobileFolderBtnActive : ""}`}
            onClick={() => { adsTab.onSelect(); onClose(); }}
            type="button"
          ><span>ADS</span><span className={styles.badgeCount}>{adsTab.count ?? "…"}</span></button>}
        </div>
      </div>
    </div>
  );
}
