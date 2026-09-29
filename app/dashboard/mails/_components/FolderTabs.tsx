import React from "react";
import styles from "../mails.module.css";
import { ALL_FOLDERS, folderLabel, folderTheme, type Folder, type FolderCounts } from "../_lib/mailboxPhase1";

type Props = {
  folders?: readonly Folder[];
  folder: Folder;
  counts: FolderCounts;
  countsLoading?: boolean;
  onSelectFolder: (folder: Folder) => void;
  adsTab?: { active: boolean; count: number | null; onSelect: () => void };
};

export default function FolderTabs({ folders = ALL_FOLDERS, folder, counts, countsLoading = false, onSelectFolder, adsTab }: Props) {
  return (
    <div
      className={styles.folderTabs}
      style={{ "--folder-tab-count": folders.length + (adsTab ? 1 : 0) } as React.CSSProperties}
    >
      {folders.map((f) => {
        const active = !adsTab?.active && f === folder;
        return (
          <button
            key={f}
            className={`${styles.folderTabBtn} ${active ? styles.folderTabBtnActive : ""}`}
            style={folderTheme(f)}
            onClick={() => onSelectFolder(f)}
            type="button"
            title={folderLabel(f)}
          >
            <span className={styles.folderTabLabel}>{folderLabel(f)}</span>
            <span className={styles.badgeCount}>{countsLoading ? "…" : counts[f] || 0}</span>
          </button>
        );
      })}
      {adsTab && <button
        className={`${styles.folderTabBtn} ${adsTab.active ? styles.folderTabBtnActive : ""}`}
        onClick={adsTab.onSelect}
        type="button"
        title="ADS"
      ><span className={styles.folderTabLabel}>ADS</span><span className={styles.badgeCount}>{adsTab.count ?? "…"}</span></button>}
    </div>
  );
}
