import React from "react";
import { useTranslations } from "next-intl";
import DashboardMobileSelect from "../../_components/DashboardMobileSelect";
import styles from "../mails.module.css";
import { ALL_FOLDERS, folderTheme, type Folder, type FolderCounts } from "../_lib/mailboxPhase1";

const FOLDER_MESSAGE_KEYS: Record<Folder, string> = {
  mails: "mails_8d79d3a8", factures: "factures_da35e4f2", devis: "devis_f7622f90",
  publications: "publications_0855684c", recoltes: "recoltes_4c5913ca", offres: "offres_1b2f74c2",
  propulsions: "propulsions_56a8a9ad", informations: "informations_54937b3a", suivis: "suivis_ba12ded5",
  enquetes: "enquetes_354b5a30", fidelisations: "fidelisations_34a35f2d", stats: "stats_be763e9a",
};

type Props = {
  folders?: readonly Folder[];
  folder: Folder;
  counts: FolderCounts;
  countsLoading?: boolean;
  onSelectFolder: (folder: Folder) => void;
  adsTab?: { active: boolean; count: number | null; countError?: string; onSelect: () => void };
};

export default function FolderTabs({ folders = ALL_FOLDERS, folder, counts, countsLoading = false, onSelectFolder, adsTab }: Props) {
  const t = useTranslations("mails");
  const folderLabel = (value: Folder) => t(FOLDER_MESSAGE_KEYS[value]);
  const errorId = React.useId();
  const folderIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M3 8h18" /></svg>;
  const mobileOptions: { value: Folder | "campagnes-ads"; label: string; icon: React.ReactNode }[] = folders.map(f => ({
    value: f, label: `${folderLabel(f)} · ${countsLoading ? "…" : counts[f] || 0}`, icon: folderIcon,
  }));
  if (adsTab) mobileOptions.push({
    value: "campagnes-ads", label: `ADS · ${adsTab.countError ? "—" : adsTab.count ?? "…"}`,
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="13" r="8" /><circle cx="11" cy="13" r="4" /><path d="m11 13 9-9m-1-2v4h4" /></svg>,
  });
  return (
    <>
    <div className={styles.mobileFolderSelect}>
      <DashboardMobileSelect
        value={adsTab?.active ? "campagnes-ads" : folder}
        options={mobileOptions}
        ariaLabel={t("dossiers_2a59919f")}
        describedBy={adsTab?.countError ? errorId : undefined}
        onChange={(value) => value === "campagnes-ads" ? adsTab?.onSelect() : onSelectFolder(value)}
      />
      {adsTab?.countError ? <p id={errorId} className={styles.mobileFolderError} role="status">ADS: {adsTab.countError}</p> : null}
    </div>
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
        title={adsTab.countError || "ADS"}
        aria-label={adsTab.countError ? `ADS : ${adsTab.countError}` : undefined}
      ><span className={styles.folderTabLabel}>ADS</span><span className={styles.badgeCount}>{adsTab.countError ? "—" : adsTab.count ?? "…"}</span></button>}
    </div>
    </>
  );
}
