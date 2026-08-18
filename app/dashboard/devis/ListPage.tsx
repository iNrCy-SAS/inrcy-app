"use client";

import { useTranslations } from "next-intl";


import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../_documents/documents.module.css";
import { type DocRecord, calcTotalsWithDiscount, formatEuro, loadDocs } from "../_documents/docUtils";
import { deleteDocRecord, duplicateDocRecord, fetchDocRecords } from "../_documents/docSaveStore";

type Props = {
  kind: "devis" | "facture";
  title: string;
  ctaLabel: string;
  ctaHref: string;
};

type Row = DocRecord & { totals: ReturnType<typeof calcTotalsWithDiscount> };

export default function ListPage({ kind, title, ctaLabel, ctaHref }: Props) {
  const i18nT = useTranslations("documents");
  const router = useRouter();
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageMode, setStorageMode] = useState<"supabase" | "local">("supabase");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchDocRecords(kind);
      setDocs(next);
      setStorageMode("supabase");
    } catch (error) {
      console.error(error);
      setDocs(loadDocs().filter((d) => d.kind === kind));
      setStorageMode("local");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows: Row[] = useMemo(() => {
    return docs.map((d) => ({
      ...d,
      totals: calcTotalsWithDiscount(d.lines, !!d.vatDispense, d.discountKind, d.discountValue),
    }));
  }, [docs]);

  const onOpen = (id: string) => {
    router.push(`/dashboard/devis/new?saveId=${encodeURIComponent(id)}`);
  };

  const onDuplicate = async (id: string) => {
    try {
      const duplicatedId = await duplicateDocRecord(kind, id);
      await refresh();
      if (duplicatedId) router.push(`/dashboard/devis/new?saveId=${encodeURIComponent(duplicatedId)}`);
    } catch (error) {
      console.error(error);
    }
  };

  const onTransform = (id: string) => {
    router.push(`/dashboard/factures/new?fromDevisSaveId=${encodeURIComponent(id)}`);
  };

  const onDelete = async (id: string) => {
    try {
      await deleteDocRecord(kind, id);
      await refresh();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className={styles.listWrap}>
      <div className={styles.listHeader}>
        <div>
          <h1 className={styles.listTitle}>{title}</h1>
          <p className={styles.listSub}>
            {storageMode === "supabase"
              ? i18nT("brouillons_et_versions_synchronises_via_inrsend_5951fef1")
              : i18nT("affichage_de_secours_depuis_le_navigateur_7483ff1a")}
          </p>
        </div>
        <button type="button" onClick={() => router.push(ctaHref)} className={styles.primaryBtn}>
          {ctaLabel}
        </button>
      </div>

      <div className={styles.tableCard}>
        {loading ? (
          <div className={styles.empty}>{i18nT("chargement_01cba1df")}</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            {i18nT("aucun_document_pour_l_instant_081d01a6")}{" "}<div style={{ marginTop: 10 }}>
              <button type="button" onClick={() => router.push(ctaHref)} className={styles.primaryBtn}>
                {ctaLabel}
              </button>
            </div>
          </div>
        ) : (
          <table className={styles.listTable}>
            <thead>
              <tr>
                <th>{i18nT("numero_15e73db0")}</th>
                <th>{i18nT("client_1bdd79b1")}</th>
                <th>{i18nT("date_eb9a4bc1")}</th>
                <th>{i18nT("statut_659499f3")}</th>
                <th style={{ textAlign: "right" }}>{i18nT("total_b25928c6")}</th>
                <th style={{ width: 380 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 650 }}>{d.number}</td>
                  <td>{d.clientName}</td>
                  <td>{new Date(d.createdAtISO).toLocaleDateString("fr-FR")}</td>
                  <td>{d.status}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {formatEuro(d.totals.totalDue ?? d.totals.totalTTC)}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      display: "flex",
                      gap: 8,
                      justifyContent: "flex-end",
                      flexWrap: "wrap",
                    }}
                  >
                    <button type="button" onClick={() => onOpen(d.id)} className={styles.ghostBtn}>
                      {i18nT("ouvrir_42c07747")}{" "}</button>
                    <button type="button" onClick={() => onDuplicate(d.id)} className={styles.ghostBtn}>
                      {i18nT("dupliquer_c5e1d3f1")}{" "}</button>
                    <button type="button" onClick={() => onTransform(d.id)} className={styles.ghostBtn}>
                      {i18nT("facture_8c62da5d")}{" "}</button>
                    <button type="button" onClick={() => onDelete(d.id)} className={styles.ghostBtn}>
                      {i18nT("supprimer_1acfc1c7")}{" "}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
