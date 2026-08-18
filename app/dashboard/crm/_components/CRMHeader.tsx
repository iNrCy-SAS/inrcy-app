import { useTranslations } from "next-intl";
import HelpButton from "../../_components/HelpButton";
import type { ReactNode, RefObject } from "react";
import styles from "../crm.module.css";

type StatItem = { label: string; value: ReactNode };

type Props = {
  isResponsive: boolean;
  isCompactUi: boolean;
  saving: boolean;
  importing: boolean;
  loading: boolean;
  total: number;
  exportingFormat: "" | "csv" | "xlsx";
  exportOpen: boolean;
  setExportOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  statsOpen: boolean;
  setStatsOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  headerSearchOpen: boolean;
  setHeaderSearchOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setHelpOpen: (value: boolean) => void;
  query: string;
  setQuery: (value: string) => void;
  triggerImport: () => void;
  exportExcel: () => Promise<void>;
  exportCsv: () => Promise<void>;
  startNew: () => void;
  openAddModal: () => void;
  statsItems: StatItem[];
  exportRef: RefObject<HTMLDivElement | null>;
  statsRef: RefObject<HTMLDivElement | null>;
  headerSearchRef: RefObject<HTMLDivElement | null>;
  headerSearchInputRef: RefObject<HTMLInputElement | null>;
  onCloseDashboard: () => void;
};

export default function CRMHeader({
  isResponsive,
  isCompactUi,
  saving,
  importing,
  loading,
  total,
  exportingFormat,
  exportOpen,
  setExportOpen,
  statsOpen,
  setStatsOpen,
  headerSearchOpen,
  setHeaderSearchOpen,
  setHelpOpen,
  query,
  setQuery,
  triggerImport,
  exportExcel,
  exportCsv,
  startNew,
  openAddModal,
  statsItems,
  exportRef,
  statsRef,
  headerSearchRef,
  headerSearchInputRef,
  onCloseDashboard,
}: Props) {
  const i18nT = useTranslations("crm");
  return (
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <div className={styles.titleWrap}>
          <img src="/inrcrm-logo.png" alt={i18nT("inr_crm_010c9ef1")} width={154} height={64} loading="eager" decoding="sync" fetchPriority="high" style={{ width: 154, height: 64, display: "block" }} />
          {!isResponsive ? <p className={styles.subInline}>{i18nT("la_centrale_de_tous_vos_contacts_ac5c0306")}</p> : null}
        </div>
        {isResponsive ? <p className={styles.mobileTagline}>{i18nT("la_centrale_de_tous_vos_contacts_ac5c0306")}</p> : null}
      </div>

      <div className={styles.headerRight}>
        {!isResponsive ? <HelpButton onClick={() => setHelpOpen(true)} title={i18nT("aide_inr_crm_1c08cd6b")} /> : null}

        {isResponsive ? (
          <>
            <div className={styles.headerSearchWrap} ref={headerSearchRef}>
              <button
                type="button"
                className={`${styles.headerIconBtn} ${styles.searchBtn}`.trim()}
                onClick={() => {
                  setStatsOpen(false);
                  setHeaderSearchOpen((prev) => !prev);
                }}
                aria-expanded={headerSearchOpen ? "true" : "false"}
                aria-label={i18nT("rechercher_un_contact_938c4f09")}
                title={i18nT("rechercher_91f7d3e9")}
              >
                🔍
              </button>

              {headerSearchOpen ? (
                <div className={styles.headerSearchDropdown}>
                  <div className={styles.searchWrap}>
                    <input
                      ref={headerSearchInputRef}
                      className={`${styles.search} ${styles.headerSearchActive}`.trim()}
                      placeholder={i18nT("rechercher_un_contact_8d90d293")}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className={styles.statsWrap} ref={statsRef}>
              <button
                type="button"
                className={styles.headerIconBtn}
                onClick={() => {
                  setHeaderSearchOpen(false);
                  setStatsOpen((v) => !v);
                }}
                aria-expanded={statsOpen ? "true" : "false"}
                aria-label={i18nT("ouvrir_le_menu_crm_5eff557e")}
                title={i18nT("menu_crm_b2986af6")}
              >
                ☰
              </button>

              {statsOpen ? (
                <div className={`${styles.statsDropdown} ${styles.mobileMenuDropdown}`.trim()} role="menu">
                  <div className={styles.statsTitle}>{i18nT("menu_crm_b2986af6")}</div>

                  <div className={styles.mobileMenuActions}>
                    <button
                      className={styles.mobileMenuItem}
                      type="button"
                      onClick={() => {
                        setStatsOpen(false);
                        startNew();
                        openAddModal();
                      }}
                      disabled={saving}
                    >
                      {i18nT("ajouter_un_contact_58e74c01")}{" "}</button>
                    <button
                      className={styles.mobileMenuItem}
                      type="button"
                      onClick={() => {
                        setStatsOpen(false);
                        triggerImport();
                      }}
                      disabled={saving || importing}
                    >
                      {importing ? i18nT("import_4834caf8") : i18nT("importer_f54cfe90")}
                    </button>
                    <button
                      className={styles.mobileMenuItem}
                      type="button"
                      onClick={() => {
                        setStatsOpen(false);
                        void exportExcel();
                      }}
                      disabled={saving || loading || Boolean(exportingFormat) || total === 0}
                    >
                      {i18nT("export_excel_4a245944")}{" "}</button>
                    <button
                      className={styles.mobileMenuItem}
                      type="button"
                      onClick={() => {
                        setStatsOpen(false);
                        void exportCsv();
                      }}
                      disabled={saving || loading || Boolean(exportingFormat) || total === 0}
                    >
                      {i18nT("export_csv_5755f9ac")}{" "}</button>
                    <button
                      className={styles.mobileMenuItem}
                      type="button"
                      onClick={() => {
                        setStatsOpen(false);
                        setHelpOpen(true);
                      }}
                    >
                      {i18nT("aide_40a1dd82")}{" "}</button>
                  </div>

                  <div className={styles.mobileMenuStats}>
                    {statsItems.map((item) => (
                      <div key={item.label} className={styles.statsItem}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className={styles.closeWrap}>
              <button type="button" className={styles.backBtn} onClick={onCloseDashboard} aria-label={i18nT("fermer_5ab4ec64")} title={i18nT("fermer_5ab4ec64")}>
                <span className={styles.closeIcon}>✕</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.headerActionBtn}`}
              onClick={() => {
                startNew();
                openAddModal();
              }}
              disabled={saving}
            >
              {i18nT("ajouter_daff7acf")}{" "}</button>

            <button
              type="button"
              className={`${styles.ghostBtn} ${styles.headerActionBtn}`}
              onClick={triggerImport}
              disabled={saving || importing}
              title={i18nT("importer_un_fichier_csv_json_ou_1772addb")}
            >
              {importing ? i18nT("import_4834caf8") : i18nT("importer_f54cfe90")}
            </button>

            <div className={styles.exportWrap} ref={exportRef}>
              <button
                className={`${styles.ghostBtn} ${styles.headerActionBtn}`}
                type="button"
                onClick={() => setExportOpen((prev) => !prev)}
                disabled={saving || loading || Boolean(exportingFormat) || total === 0}
                aria-expanded={exportOpen ? "true" : "false"}
                title={loading ? "Chargement des contacts" : total === 0 ? "Aucun contact à exporter" : "Choisir le format d’export"}
              >
                {exportingFormat ? i18nT("export_0a116345") : i18nT("exporter_0cd84bdc")} <span className={styles.caret}>▾</span>
              </button>

              {exportOpen ? (
                <div className={styles.exportMenu} role="menu">
                  <button
                    className={styles.exportItem}
                    type="button"
                    onClick={() => {
                      setExportOpen(false);
                      void exportExcel();
                    }}
                    disabled={Boolean(exportingFormat)}
                  >
                    {i18nT("excel_xlsx_47f8ecb0")}{" "}</button>
                  <button
                    className={styles.exportItem}
                    type="button"
                    onClick={() => {
                      setExportOpen(false);
                      void exportCsv();
                    }}
                    disabled={Boolean(exportingFormat)}
                  >
                    {i18nT("csv_csv_66c529f3")}{" "}</button>
                </div>
              ) : null}
            </div>

            <div className={styles.statsWrap} ref={statsRef}>
              <button
                type="button"
                className={`${styles.ghostBtn} ${styles.headerActionBtn} ${styles.headerStatsBtn}`}
                onClick={() => {
                  setHeaderSearchOpen(false);
                  setExportOpen(false);
                  setStatsOpen((v) => !v);
                }}
                aria-expanded={statsOpen ? "true" : "false"}
                title={i18nT("statistiques_fdce305a")}
              >
                {i18nT("stats_be763e9a")}{" "}</button>

              {statsOpen ? (
                <div className={styles.statsDropdown} role="menu">
                  <div className={styles.statsTitle}>{i18nT("statistiques_fdce305a")}</div>
                  <div className={styles.statsGrid}>
                    {statsItems.map((item) => (
                      <div key={item.label} className={styles.statsItem}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className={styles.closeWrap}>
              <button type="button" className={styles.backBtn} onClick={onCloseDashboard} aria-label={i18nT("fermer_5ab4ec64")} title={i18nT("fermer_5ab4ec64")}>
                {isCompactUi ? <span className={styles.closeIcon}>✕</span> : <span className={styles.closeText}>{i18nT("fermer_5ab4ec64")}</span>}
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
