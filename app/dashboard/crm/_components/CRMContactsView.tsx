import { useTranslations } from "next-intl";
import type { Dispatch, RefObject, SetStateAction } from "react";
import styles from "../crm.module.css";
import {
  buildDisplayName,
  categoryBadgeClass,
  CATEGORY_LABEL,
  CATEGORY_LABEL_SHORT,
  getDepartmentCode,
  typeBadgeClass,
  TYPE_LABEL,
  TYPE_LABEL_SHORT,
} from "../crm.shared";
import type { Category, ContactType, CrmContact } from "../crm.types";

type Props = {
  documentsEnabled: boolean;
  isResponsive: boolean;
  visibleContacts: CrmContact[];
  emptyMessage: string;
  selectedContactIds: Set<string>;
  expandedMobileContactId: string | null;
  setExpandedMobileContactId: Dispatch<SetStateAction<string | null>>;
  toggleSelect: (id: string) => void;
  sendMailToContact: (contact: CrmContact) => void;
  goPlanifierIntervention: (contact: CrmContact) => void;
  goNewDevis: (contact: CrmContact) => void;
  goNewFacture: (contact: CrmContact) => void;
  startEdit: (contact: CrmContact) => void;
  toggleImportant: (id: string) => void;
  remove: (id: string) => Promise<void> | void;
  mobileLoadMoreRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  page: number;
  mobileHasMore: boolean;
  allVisibleSelected: boolean;
  toggleSelectAllVisible: () => void;
  showDesktopEmptyMessage: boolean;
  desktopRowHeight: number;
  desktopPlaceholderRows: unknown[];
};

export default function CRMContactsView({
  documentsEnabled,
  isResponsive,
  visibleContacts,
  emptyMessage,
  selectedContactIds,
  expandedMobileContactId,
  setExpandedMobileContactId,
  toggleSelect,
  sendMailToContact,
  goPlanifierIntervention,
  goNewDevis,
  goNewFacture,
  startEdit,
  toggleImportant,
  remove,
  mobileLoadMoreRef,
  loading,
  page,
  mobileHasMore,
  allVisibleSelected,
  toggleSelectAllVisible,
  showDesktopEmptyMessage,
  desktopRowHeight,
  desktopPlaceholderRows,
}: Props) {
  const i18nT = useTranslations("crm");
  if (isResponsive) {
    return (
      <div className={styles.mobileTable}>
        {visibleContacts.length === 0 ? (
          loading && page <= 1 ? <div className={styles.mobileEmpty}>{i18nT("chargement_des_contacts_37c250fb")}</div> : <div className={styles.mobileEmpty}>{emptyMessage}</div>
        ) : (
          visibleContacts.map((c) => {
            const isExpanded = expandedMobileContactId === c.id;
            return (
              <div key={c.id} className={styles.mobileContactBlock}>
                <div className={`${styles.mobileListRow} ${isExpanded ? styles.mobileListRowOpen : ""}`.trim()}>
                  <label className={styles.mobileCheckboxWrap} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selectedContactIds.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      aria-label={i18nT("selectionner_value_b74d84aa", { value0: buildDisplayName(c) || "ce contact" })}
                    />
                  </label>

                  <button
                    type="button"
                    className={styles.mobileListMain}
                    onClick={() => setExpandedMobileContactId((prev) => (prev === c.id ? null : c.id))}
                    aria-expanded={isExpanded ? "true" : "false"}
                  >
                    <span className={`${styles.mobileListName} ${c.important ? styles.nameImportant : ""}`.trim()}>
                      {buildDisplayName(c) || i18nT("contact_sans_nom_5b4b82fc")}
                    </span>
                  </button>

                  <button
                    type="button"
                    className={styles.mobileExpandBtn}
                    onClick={() => setExpandedMobileContactId((prev) => (prev === c.id ? null : c.id))}
                    aria-label={isExpanded ? "Réduire le détail" : "Afficher le détail"}
                    aria-expanded={isExpanded ? "true" : "false"}
                  >
                    {isExpanded ? "−" : "+"}
                  </button>
                </div>

                {isExpanded ? (
                  <div className={styles.mobileRowDetails}>
                    <div className={styles.mobileDetailGrid}>
                      <div>
                        <span className={styles.mobileDetailLabel}>{i18nT("mail_92379cbb")}</span>
                        <strong>{c.email || "—"}</strong>
                      </div>
                      <div>
                        <span className={styles.mobileDetailLabel}>{i18nT("telephone_d3b023ea")}</span>
                        <strong>{c.phone || "—"}</strong>
                      </div>
                      <div>
                        <span className={styles.mobileDetailLabel}>{i18nT("categorie_6b38300a")}</span>
                        <strong>{c.category ? CATEGORY_LABEL[c.category as Exclude<Category, "">] : "—"}</strong>
                      </div>
                      <div>
                        <span className={styles.mobileDetailLabel}>{i18nT("type_3deb7456")}</span>
                        <strong>{c.contact_type ? TYPE_LABEL[c.contact_type as Exclude<ContactType, "">] : "—"}</strong>
                      </div>
                      <div>
                        <span className={styles.mobileDetailLabel}>{i18nT("departement_3d7c87c2")}</span>
                        <strong>{getDepartmentCode(c.postal_code) || "—"}</strong>
                      </div>
                      <div>
                        <span className={styles.mobileDetailLabel}>{i18nT("adresse_522e1466")}</span>
                        <strong>{[c.address, c.postal_code, c.city].filter(Boolean).join(" ") || "—"}</strong>
                      </div>
                      {(c.notes || "").trim() ? (
                        <div className={styles.mobileDetailNotes}>
                          <span className={styles.mobileDetailLabel}>{i18nT("notes_70440046")}</span>
                          <strong>{c.notes}</strong>
                        </div>
                      ) : null}
                    </div>

                    <div className={styles.mobileDetailActions}>
                      <button type="button" className={styles.smallBtn} disabled={!c.email} onClick={(e) => { e.stopPropagation(); sendMailToContact(c); }}>
                        {i18nT("mail_92379cbb")}{" "}</button>
                      <button type="button" className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); goPlanifierIntervention(c); }}>
                        {i18nT("agenda_891e9d6d")}{" "}</button>
                      {documentsEnabled ? (
                        <>
                          <button type="button" className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); goNewDevis(c); }}>
                            {i18nT("devis_f7622f90")}{" "}</button>
                          <button type="button" className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); goNewFacture(c); }}>
                            {i18nT("facture_3953b9f5")}{" "}</button>
                        </>
                      ) : null}
                      <button type="button" className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); startEdit(c); }}>
                        {i18nT("modifier_f260e757")}{" "}</button>
                      <button type="button" className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); toggleImportant(c.id); }}>
                        {c.important ? i18nT("retirer_7ef7a367") : i18nT("mettre_e1ba02e1")}
                      </button>
                      <button type="button" className={`${styles.smallBtn} ${styles.dangerBtn}`.trim()} onClick={(e) => { e.stopPropagation(); void remove(c.id); }}>
                        {i18nT("supprimer_1acfc1c7")}{" "}</button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}

        <div ref={mobileLoadMoreRef} className={styles.mobileLoadSentinel} aria-hidden="true" />
        {loading && page > 1 ? <div className={styles.mobileLoadMore}>{i18nT("chargement_de_plus_de_contacts_ecb1f149")}</div> : null}
        {!mobileHasMore && visibleContacts.length > 0 ? <div className={styles.mobileListEnd}>{i18nT("tous_les_contacts_sont_affiches_2c02a496")}</div> : null}
      </div>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.thSelect}>
            <input
              type="checkbox"
              className={styles.checkbox}
              onClick={(e) => e.stopPropagation()}
              onChange={toggleSelectAllVisible}
              checked={allVisibleSelected}
              aria-label={i18nT("selectionner_tous_les_contacts_de_la_24fdd0b2")}
            />
          </th>
          <th className={styles.thName}>{i18nT("nom_prenom_rs_15d43630")}</th>
          <th className={styles.thMail}>{i18nT("mail_92379cbb")}</th>
          <th className={styles.thTel}>{i18nT("telephone_d3b023ea")}</th>
          <th className={styles.thCp}>CP</th>
          <th className={styles.thCat}>{i18nT("categorie_6b38300a")}</th>
          <th className={styles.thType}>{i18nT("type_3deb7456")}</th>
          <th className={styles.thStar}>⭐</th>
        </tr>
      </thead>
      <tbody>
        {showDesktopEmptyMessage ? (
          <tr className={styles.placeholderMessageRow} style={{ height: `${desktopRowHeight}px` }}>
            <td colSpan={8} className={styles.empty}>
              {emptyMessage}
            </td>
          </tr>
        ) : null}

        {visibleContacts.map((c) => (
          <tr
            key={c.id}
            className={selectedContactIds.has(c.id) ? styles.rowSelected : undefined}
            onClick={() => startEdit(c)}
            style={{ cursor: "pointer", height: `${desktopRowHeight}px` }}
          >
            <td className={styles.tdSelect}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selectedContactIds.has(c.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSelect(c.id)}
                aria-label={i18nT("selectionner_value_b74d84aa", { value0: buildDisplayName(c) })}
              />
            </td>
            <td className={`${styles.tdName} ${c.important ? styles.nameImportant : ""}`.trim()}>{buildDisplayName(c)}</td>
            <td className={`${styles.mono} ${styles.tdMail}`}>{c.email}</td>
            <td className={`${styles.mono} ${styles.tdTel}`}>{c.phone}</td>
            <td className={`${styles.mono} ${styles.tdCp}`}>{c.postal_code ?? ""}</td>
            <td className={styles.tdCat}>
              {c.category ? (
                <span className={categoryBadgeClass(c.category)}>
                  <span className={styles.badgeLabelFull}>{CATEGORY_LABEL[c.category as Exclude<Category, "">]}</span>
                  <span className={styles.badgeLabelShort}>{CATEGORY_LABEL_SHORT[c.category as Exclude<Category, "">]}</span>
                </span>
              ) : (
                <span className={styles.dash}>—</span>
              )}
            </td>
            <td>
              {c.contact_type ? (
                <span className={typeBadgeClass(c.contact_type)}>
                  <span className={styles.badgeLabelFull}>{TYPE_LABEL[c.contact_type as Exclude<ContactType, "">]}</span>
                  <span className={styles.badgeLabelShort}>{TYPE_LABEL_SHORT[c.contact_type as Exclude<ContactType, "">]}</span>
                </span>
              ) : (
                <span className={styles.dash}>—</span>
              )}
            </td>
            <td className={styles.tdStar}>
              {c.important ? <span className={styles.starStatic} title={i18nT("important_4b6d6a30")} aria-label={i18nT("important_4b6d6a30")}>★</span> : null}
            </td>
          </tr>
        ))}

        {desktopPlaceholderRows.map((_, index) => (
          <tr key={`placeholder-row-${page}-${index}`} className={styles.placeholderRow} aria-hidden="true" style={{ height: `${desktopRowHeight}px` }}>
            <td className={styles.tdSelect}>{i18nT("nbsp_47c1f11e")}</td>
            <td className={styles.tdName}>{i18nT("nbsp_47c1f11e")}</td>
            <td className={`${styles.mono} ${styles.tdMail}`}>{i18nT("nbsp_47c1f11e")}</td>
            <td className={`${styles.mono} ${styles.tdTel}`}>{i18nT("nbsp_47c1f11e")}</td>
            <td className={`${styles.mono} ${styles.tdCp}`}>{i18nT("nbsp_47c1f11e")}</td>
            <td className={styles.tdCat}>{i18nT("nbsp_47c1f11e")}</td>
            <td>{i18nT("nbsp_47c1f11e")}</td>
            <td className={styles.tdStar}>{i18nT("nbsp_47c1f11e")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
