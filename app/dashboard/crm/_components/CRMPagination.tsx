import { useTranslations } from "next-intl";
import type { Dispatch, SetStateAction } from "react";
import styles from "../crm.module.css";

type Props = {
  isResponsive: boolean;
  total: number;
  visibleCount: number;
  page: number;
  pageSize: number;
  pageCount: number;
  loading: boolean;
  setPage: Dispatch<SetStateAction<number>>;
};

export default function CRMPagination({ isResponsive, total, visibleCount, page, pageSize, pageCount, loading, setPage }: Props) {
  const i18nT = useTranslations("crm");
  if (!isResponsive) {
    return (
      <div className={styles.paginationBar}>
        <div className={styles.paginationMeta}>
          {loading && total === 0 ? i18nT("chargement_des_contacts_37c250fb") : total > 0 ? i18nT("affichage_value_value_sur_value_cd705182", { value0: Math.min((page - 1) * pageSize + 1, total), value1: Math.min(page * pageSize, total), value2: total }) : i18nT("0_contact_989eb1d4")}
        </div>
        <div className={styles.paginationControls}>
          <button type="button" className={styles.ghostBtn} onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1 || loading}>
            {i18nT("precedent_3ec988c1")}{" "}</button>
          <span className={styles.paginationStatus}>{i18nT("page_value_value_e9b2eea1", { value0: Math.min(page, pageCount), value1: Math.max(pageCount, 1) })}</span>
          <button type="button" className={styles.ghostBtn} onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))} disabled={page >= pageCount || loading || total === 0}>
            {i18nT("suivant_ea96c11e")}{" "}</button>
        </div>
      </div>
    );
  }

  return <div className={styles.mobileListSummary}>{loading && total === 0 ? i18nT("chargement_des_contacts_37c250fb") : total > 0 ? `${visibleCount} / ${total} contact${total > 1 ? "s" : ""}` : i18nT("0_contact_989eb1d4")}</div>;
}
