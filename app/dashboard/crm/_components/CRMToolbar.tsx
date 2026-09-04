import { useTranslations } from "next-intl";
import type { Dispatch, RefObject, SetStateAction } from "react";
import styles from "../crm.module.css";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, sanitizeDepartmentFilter } from "../crm.shared";
import type { Category, ContactType, CrmContact } from "../crm.types";

type Props = {
  documentsEnabled: boolean;
  isResponsive: boolean;
  saving: boolean;
  importing: boolean;
  selectedCount: number;
  visibleContacts: CrmContact[];
  actionsOpen: boolean;
  setActionsOpen: Dispatch<SetStateAction<boolean>>;
  mobileFiltersOpen: boolean;
  setMobileFiltersOpen: Dispatch<SetStateAction<boolean>>;
  desktopFiltersOpen: boolean;
  setDesktopFiltersOpen: Dispatch<SetStateAction<boolean>>;
  activeFiltersCount: number;
  activeFilterChips: string[];
  actionEmails: string[];
  primaryContact: CrmContact | null;
  clearSelection: () => void;
  selectAllVisible: () => void;
  removeSelected: () => void;
  sendMailToAction: () => void;
  goNewDevis: (contact: CrmContact) => void;
  goNewFacture: (contact: CrmContact) => void;
  goPlanifierIntervention: (contact: CrmContact) => void;
  actionsRef: RefObject<HTMLDivElement | null>;
  desktopFiltersRef: RefObject<HTMLDivElement | null>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  pageSize: number;
  setPage: Dispatch<SetStateAction<number>>;
  setPageSize: Dispatch<SetStateAction<number>>;
  categoryFilter: Category;
  setCategoryFilter: Dispatch<SetStateAction<Category>>;
  typeFilter: ContactType;
  setTypeFilter: Dispatch<SetStateAction<ContactType>>;
  departmentFilter: string;
  setDepartmentFilter: Dispatch<SetStateAction<string>>;
  importantOnly: boolean;
  setImportantOnly: Dispatch<SetStateAction<boolean>>;
};

export default function CRMToolbar({
  documentsEnabled,
  isResponsive,
  saving,
  selectedCount,
  visibleContacts,
  actionsOpen,
  setActionsOpen,
  mobileFiltersOpen,
  setMobileFiltersOpen,
  desktopFiltersOpen,
  setDesktopFiltersOpen,
  activeFiltersCount,
  activeFilterChips,
  actionEmails,
  primaryContact,
  clearSelection,
  selectAllVisible,
  removeSelected,
  sendMailToAction,
  goNewDevis,
  goNewFacture,
  goPlanifierIntervention,
  actionsRef,
  desktopFiltersRef,
  query,
  setQuery,
  pageSize,
  setPage,
  setPageSize,
  categoryFilter,
  setCategoryFilter,
  typeFilter,
  setTypeFilter,
  departmentFilter,
  setDepartmentFilter,
  importantOnly,
  setImportantOnly,
}: Props) {
  const i18nT = useTranslations("crm");
  const resetFilters = () => {
    setCategoryFilter("");
    setTypeFilter("");
    setDepartmentFilter("");
    setImportantOnly(false);
  };

  return (
    <>
      <div className={styles.secondaryToolbar}>
        {!isResponsive ? (
          <div className={styles.selectionMeta}>
            {selectedCount > 0 ? i18nT("value_contact_value_selectionne_value_76477fae", { value0: selectedCount, value1: selectedCount > 1 ? "s" : "", value2: selectedCount > 1 ? "s" : "" }) : i18nT("aucune_selection_b7a999a0")}
          </div>
        ) : null}

        <div className={`${styles.bulkActions} ${isResponsive ? styles.mobileBulkActions : ""}`.trim()}>
          {isResponsive ? (
            <>
              <button aria-label={i18nT("tout_selectionner_06f2c1c0")} className={`${styles.ghostBtn} ${styles.iconOnlyBtn}`.trim()} type="button" onClick={selectAllVisible} disabled={visibleContacts.length === 0 || saving} title={i18nT("tout_selectionner_06f2c1c0")}>
                ☑
              </button>

              <button
                aria-label={i18nT("deselectionner_bdc31a72")}
                className={`${styles.ghostBtn} ${styles.iconOnlyBtn}`.trim()}
                type="button"
                onClick={clearSelection}
                disabled={selectedCount === 0 || saving}
                title={selectedCount === 0 ? "Aucun contact sélectionné" : "Désélectionner"}
              >
                ⊟
              </button>
            </>
          ) : (
            <button
              aria-label={i18nT("deselectionner_bdc31a72")}
              className={styles.ghostBtn}
              type="button"
              onClick={clearSelection}
              disabled={selectedCount === 0 || saving}
              title={selectedCount === 0 ? "Aucun contact sélectionné" : "Vider la sélection"}
            >
              {i18nT("deselectionner_bdc31a72")}{" "}</button>
          )}

          <div className={styles.actionsWrap} ref={actionsRef}>
            <button
              className={`${styles.actionsBtn} ${isResponsive ? styles.mobileActionsBtn : ""}`.trim()}
              type="button"
              onClick={() => {
                if (isResponsive) setMobileFiltersOpen(false);
                setDesktopFiltersOpen(false);
                setActionsOpen((v) => !v);
              }}
              disabled={(actionEmails.length === 0 && !primaryContact) || saving}
              aria-expanded={actionsOpen ? "true" : "false"}
              title={primaryContact ? "Actions sur ce contact" : selectedCount > 0 ? "Actions sur la sélection" : "Sélectionnez un contact"}
            >
              {i18nT("actions_c3cd636a")}{" "}<span className={styles.caret}>▾</span>
            </button>

            {actionsOpen ? (
              <div className={styles.actionsMenu} role="menu">
                <button
                  className={styles.actionsItem}
                  type="button"
                  onClick={() => {
                    setActionsOpen(false);
                    sendMailToAction();
                  }}
                  disabled={actionEmails.length === 0 || saving}
                >
                  {i18nT("envoyer_un_mail_11b84670")}{" "}</button>

                <div className={styles.actionsSep} />

                {documentsEnabled ? (
                  <>
                    <button
                      className={styles.actionsItem}
                      type="button"
                      onClick={() => {
                        if (!primaryContact) return;
                        setActionsOpen(false);
                        goNewDevis(primaryContact);
                      }}
                      disabled={!primaryContact || saving}
                    >
                      {i18nT("devis_9676cd7e")}{" "}</button>

                    <button
                      className={styles.actionsItem}
                      type="button"
                      onClick={() => {
                        if (!primaryContact) return;
                        setActionsOpen(false);
                        goNewFacture(primaryContact);
                      }}
                      disabled={!primaryContact || saving}
                    >
                      {i18nT("factures_d37c472b")}{" "}</button>

                    <div className={styles.actionsSep} />
                  </>
                ) : null}

                <button
                  className={styles.actionsItem}
                  type="button"
                  onClick={() => {
                    if (!primaryContact) return;
                    setActionsOpen(false);
                    goPlanifierIntervention(primaryContact);
                  }}
                  disabled={!primaryContact || saving}
                >
                  {i18nT("planifier_un_rendez_vous_9f9bb5ac")}{" "}</button>
              </div>
            ) : null}
          </div>

          {isResponsive ? (
            <button
              type="button"
              className={`${styles.ghostBtn} ${styles.mobileFilterActionBtn}`.trim()}
              onClick={() => {
                setActionsOpen(false);
                setMobileFiltersOpen((prev) => !prev);
              }}
              aria-expanded={mobileFiltersOpen ? "true" : "false"}
            >
              {i18nT("filtres_2a8e76e0")}{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ""}
            </button>
          ) : null}

          <button
            aria-label={i18nT("supprimer_1acfc1c7")}
            className={`${styles.smallBtn} ${styles.dangerBtn} ${isResponsive ? styles.mobileDeleteBtn : ""}`.trim()}
            type="button"
            onClick={removeSelected}
            disabled={selectedCount === 0 || saving}
            title={selectedCount === 0 ? "Sélectionne 1 ou plusieurs contacts" : `Supprimer ${selectedCount} contact(s)`}
          >
            🗑️
          </button>
        </div>

        {!isResponsive ? (
          <div className={styles.filtersWrap} ref={desktopFiltersRef}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => {
                setActionsOpen(false);
                setDesktopFiltersOpen((prev) => !prev);
              }}
              aria-expanded={desktopFiltersOpen ? "true" : "false"}
            >
              {i18nT("filtres_2a8e76e0")}{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ""}
            </button>

            {desktopFiltersOpen ? (
              <div className={styles.desktopFiltersPanel}>
                <label className={styles.label}>
                  <span>{i18nT("categorie_6b38300a")}</span>
                  <select className={styles.select} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category)}>
                    <option value="">{i18nT("toutes_c5f641e4")}</option>
                    <option value="particulier">{i18nT("particulier_281680dd")}</option>
                    <option value="professionnel">{i18nT("professionnel_aec80314")}</option>
                    <option value="collectivite_publique">{i18nT("institution_429f9450")}</option>
                  </select>
                </label>

                <label className={styles.label}>
                  <span>{i18nT("type_3deb7456")}</span>
                  <select className={styles.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ContactType)}>
                    <option value="">{i18nT("tous_b97ae3b4")}</option>
                    <option value="client">{i18nT("client_1bdd79b1")}</option>
                    <option value="prospect">{i18nT("prospect_99b3f65c")}</option>
                    <option value="fournisseur">{i18nT("fournisseur_97d91d89")}</option>
                    <option value="partenaire">{i18nT("partenaire_d727d03b")}</option>
                    <option value="autre">{i18nT("autre_43dacf9e")}</option>
                  </select>
                </label>

                <label className={styles.label}>
                  <span>{i18nT("departement_3d7c87c2")}</span>
                  <input className={styles.input} inputMode="numeric" placeholder="62" maxLength={3} value={departmentFilter} onChange={(e) => setDepartmentFilter(sanitizeDepartmentFilter(e.target.value))} />
                </label>

                <label className={`${styles.label} ${styles.desktopImportantToggle}`.trim()}>
                  <span>{i18nT("important_4b6d6a30")}</span>
                  <button type="button" className={`${styles.ghostBtn} ${importantOnly ? styles.mobileImportantActive : ""}`.trim()} onClick={() => setImportantOnly((prev) => !prev)}>
                    {importantOnly ? i18nT("uniquement_les_importants_00983567") : i18nT("tous_les_contacts_4baf9a7f")}
                  </button>
                </label>

                <button type="button" className={styles.mobileFiltersReset} onClick={resetFilters}>
                  {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isResponsive ? (
          <div className={styles.tableSearchWrap}>
            <div className={styles.searchWrap}>
              <input className={styles.search} placeholder={i18nT("rechercher_8bd64daa")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
        ) : null}

        {!isResponsive ? (
          <label className={styles.pageSizeWrap}>
            <span>{i18nT("par_page_fcb00057")}</span>
            <select
              className={styles.pageSizeSelect}
              value={pageSize}
              onChange={(e) => {
                setPage(1);
                setPageSize(Number(e.target.value) || DEFAULT_PAGE_SIZE);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {isResponsive ? (
        <div className={styles.mobileControls}>
          {activeFilterChips.length > 0 ? (
            <div className={styles.mobileFilterChips}>
              {activeFilterChips.map((chip) => (
                <span key={chip} className={styles.mobileFilterChip}>{chip}</span>
              ))}
              <button type="button" className={styles.mobileFiltersReset} onClick={resetFilters}>
                {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
            </div>
          ) : null}

          {mobileFiltersOpen ? (
            <div className={styles.mobileFiltersPanel}>
              <label className={styles.label}>
                <span>{i18nT("categorie_6b38300a")}</span>
                <select className={styles.select} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category)}>
                  <option value="">{i18nT("toutes_c5f641e4")}</option>
                  <option value="particulier">{i18nT("particulier_281680dd")}</option>
                  <option value="professionnel">{i18nT("professionnel_aec80314")}</option>
                  <option value="collectivite_publique">{i18nT("institution_429f9450")}</option>
                </select>
              </label>

              <label className={styles.label}>
                <span>{i18nT("type_3deb7456")}</span>
                <select className={styles.select} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ContactType)}>
                  <option value="">{i18nT("tous_b97ae3b4")}</option>
                  <option value="client">{i18nT("client_1bdd79b1")}</option>
                  <option value="prospect">{i18nT("prospect_99b3f65c")}</option>
                  <option value="fournisseur">{i18nT("fournisseur_97d91d89")}</option>
                  <option value="partenaire">{i18nT("partenaire_d727d03b")}</option>
                  <option value="autre">{i18nT("autre_43dacf9e")}</option>
                </select>
              </label>

              <label className={styles.label}>
                <span>{i18nT("departement_3d7c87c2")}</span>
                <input className={styles.input} inputMode="numeric" placeholder="62" maxLength={3} value={departmentFilter} onChange={(e) => setDepartmentFilter(sanitizeDepartmentFilter(e.target.value))} />
              </label>

              <label className={`${styles.label} ${styles.mobileImportantToggle}`.trim()}>
                <span>{i18nT("important_4b6d6a30")}</span>
                <button type="button" className={`${styles.ghostBtn} ${importantOnly ? styles.mobileImportantActive : ""}`.trim()} onClick={() => setImportantOnly((prev) => !prev)}>
                  {importantOnly ? i18nT("uniquement_les_importants_00983567") : i18nT("tous_les_contacts_4baf9a7f")}
                </button>
              </label>

              <button type="button" className={styles.mobileFiltersReset} onClick={resetFilters}>
                {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
