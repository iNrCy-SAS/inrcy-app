import { useTranslations } from "next-intl";
import React from "react";
import Link from "next/link";
import styles from "../mails.module.css";
import { toolbarActionTheme, type BoxView, type Folder, type MailAccount } from "../_lib/mailboxPhase1";

type Props = {
  folder: Folder;
  filterAccountId: string;
  setFilterAccountId: (value: string) => void;
  mailAccounts: MailAccount[];
  searchOpen: boolean;
  historyQuery: string;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  loadHistory: () => Promise<unknown> | void;
  toolCfg: { href?: string | null; label: string };
  resetCompose: (type: any) => void;
  setComposeOpen: (open: boolean) => void;
  boxView: BoxView;
  setBoxView: React.Dispatch<React.SetStateAction<BoxView>>;
  draftCount: number;
  publicationOnly?: boolean;
};

export default function MailboxToolbar(props: Props) {
  const i18nT = useTranslations("mails");
  const {
    folder,
    filterAccountId,
    setFilterAccountId,
    mailAccounts,
    searchOpen,
    historyQuery,
    setSearchOpen,
    loadHistory,
    toolCfg,
    resetCompose,
    setComposeOpen,
    boxView,
    setBoxView,
    draftCount,
    publicationOnly = false,
  } = props;

  return (
    <div className={styles.toolbarRow}>
      <div className={styles.filterRow}>
        <div className={styles.toolbarInfo}>
          {publicationOnly ? i18nT("historique_des_publications_2bcf9ffb") : i18nT("filtrer_a7a02ef5")}
        </div>
        {!publicationOnly ? (
          <select
            className={styles.filterSelect}
            value={filterAccountId}
            onChange={(event) => setFilterAccountId(event.target.value)}
            title={i18nT("filtrer_par_boite_d_envoi_960f88f5")}
          >
            <option value="">{i18nT("toutes_les_boites_2d792cf5")}</option>
            {mailAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {(account.display_name ? `${account.display_name} — ` : "") + account.email_address + ` (${account.provider})`}
              </option>
            ))}
          </select>
        ) : null}
        <div className={styles.mobileTopTools}>
          <button
            className={`${styles.toolbarBtn} ${styles.toolbarIconBtn} ${styles.mobileOnlyBtn} ${
              !searchOpen && historyQuery.trim() ? styles.toolbarIconBtnActive : ""
            }`}
            onClick={() => setSearchOpen((value) => !value)}
            type="button"
            title={searchOpen ? i18nT("search_close_title") : i18nT("search_open_title")}
            aria-label={i18nT("rechercher_91f7d3e9")}
          >
            <span className={styles.toolbarIconGlyph}>⌕</span>
            {!searchOpen && historyQuery.trim() ? <span className={styles.activeDot} /> : null}
          </button>
          <button
            className={`${styles.toolbarBtn} ${styles.toolbarIconBtn} ${styles.mobileOnlyBtn}`}
            onClick={() => { void loadHistory(); }}
            type="button"
            title={i18nT("actualiser_9d3b2a7d")}
            aria-label={i18nT("actualiser_9d3b2a7d")}
          >
            ↻
          </button>
        </div>
      </div>

      <div className={styles.toolbarActions}>
        <div className={styles.toolbarSpacer} />

        {toolCfg.href ? (
          <Link
            className={`${styles.toolbarBtn} ${styles.toolbarBtnCta}`}
            style={toolbarActionTheme(folder)}
            href={toolCfg.href}
            title={toolCfg.label}
          >
            {toolCfg.label}
          </Link>
        ) : !publicationOnly ? (
          <button
            className={`${styles.toolbarBtn} ${styles.toolbarBtnCta}`}
            style={toolbarActionTheme(folder)}
            onClick={() => {
              resetCompose("mail");
              setComposeOpen(true);
            }}
            type="button"
          >
            {toolCfg.label}
          </button>
        ) : null}

        {!publicationOnly ? (
          <button
            className={`${styles.toolbarBtn} ${styles.draftsToggleBtn} ${boxView === "drafts" ? styles.toolbarBtnActive : ""}`}
            onClick={() => setBoxView((value: BoxView) => (value === "drafts" ? "sent" : "drafts"))}
            type="button"
            title={draftCount > 0
              ? i18nT("drafts_count", { count: draftCount })
              : i18nT("brouillons_a55f3cd9")}
          >
            <span className={styles.draftsToggleLabel}>{i18nT("brouillons_a55f3cd9")}</span>
            {draftCount > 0 ? <span className={styles.badgeCount}>{draftCount}</span> : null}
          </button>
        ) : null}

        <button
          className={`${styles.toolbarBtn} ${styles.toolbarIconBtn} ${styles.desktopToolbarIconBtn} ${
            !searchOpen && historyQuery.trim() ? styles.toolbarIconBtnActive : ""
          }`}
          onClick={() => setSearchOpen((value) => !value)}
          type="button"
          title={searchOpen ? i18nT("search_close_title") : i18nT("search_open_title")}
          aria-label={i18nT("rechercher_91f7d3e9")}
        >
          <span className={styles.toolbarIconGlyph}>⌕</span>
          {!searchOpen && historyQuery.trim() ? <span className={styles.activeDot} /> : null}
        </button>

        <button
          className={`${styles.toolbarBtn} ${styles.toolbarIconBtn} ${styles.desktopToolbarIconBtn}`}
          onClick={() => { void loadHistory(); }}
          type="button"
          title={i18nT("actualiser_9d3b2a7d")}
          aria-label={i18nT("actualiser_9d3b2a7d")}
        >
          ↻
        </button>
      </div>
    </div>
  );
}
