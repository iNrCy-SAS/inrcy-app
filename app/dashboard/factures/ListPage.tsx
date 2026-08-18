"use client";

import { useTranslations } from "next-intl";


import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../_documents/documents.module.css";
import { type DocRecord, calcTotalsWithDiscount, formatEuro, loadDocs } from "../_documents/docUtils";
import { deleteDocRecord, duplicateDocRecord, fetchDocRecords, updateDocRecordStatus } from "../_documents/docSaveStore";
import { PROFILE_VERSION_EVENT, type ProfileVersionChangeDetail } from "@/lib/profileVersioning";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";

type Props = {
  kind: "devis" | "facture";
  title: string;
  ctaLabel: string;
  ctaHref: string;
};

type Row = DocRecord & { totals: ReturnType<typeof calcTotalsWithDiscount> };

type DocumentsListSnapshot = {
  docs: DocRecord[];
  storageMode: "supabase" | "local";
};

function snapshotKeyForKind(kind: Props["kind"]) {
  return kind === "facture" ? MODULE_SNAPSHOT_KEYS.facturesList : MODULE_SNAPSHOT_KEYS.devisList;
}

function readInitialDocumentsSnapshot(kind: Props["kind"]): DocumentsListSnapshot | null {
  const snapshot = readModuleSnapshot<DocumentsListSnapshot>(snapshotKeyForKind(kind));
  if (!snapshot?.data || !Array.isArray(snapshot.data.docs)) return null;
  return snapshot.data;
}

function ListPage({ kind, title, ctaLabel, ctaHref }: Props) {
  const i18nT = useTranslations("documents");
  const router = useRouter();
  const [initialSnapshot] = useState<DocumentsListSnapshot | null>(() => readInitialDocumentsSnapshot(kind));
  const [docs, setDocs] = useState<DocRecord[]>(() => initialSnapshot?.docs ?? []);
  const [loading, setLoading] = useState(() => !initialSnapshot);
  const [storageMode, setStorageMode] = useState<"supabase" | "local">(() => initialSnapshot?.storageMode ?? "supabase");

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const next = await fetchDocRecords(kind);
      setDocs(next);
      setStorageMode("supabase");
      writeModuleSnapshot<DocumentsListSnapshot>(snapshotKeyForKind(kind), { docs: next, storageMode: "supabase" });
    } catch (error) {
      console.error(error);
      const localDocs = loadDocs().filter((d) => d.kind === kind);
      setDocs(localDocs);
      setStorageMode("local");
      writeModuleSnapshot<DocumentsListSnapshot>(snapshotKeyForKind(kind), { docs: localDocs, storageMode: "local" });
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void refresh({ silent: Boolean(initialSnapshot) });
  }, [initialSnapshot, refresh]);

  useEffect(() => {
    const handleProfileVersionChange = (event: Event) => {
      const detail = (event as CustomEvent<ProfileVersionChangeDetail>).detail;
      if (detail?.field !== "docs_version") return;
      void refresh();
    };

    window.addEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    return () => {
      window.removeEventListener(PROFILE_VERSION_EVENT, handleProfileVersionChange as EventListener);
    };
  }, [refresh]);

  const rows: Row[] = useMemo(() => {
    return docs.map((d) => ({
      ...d,
      totals: calcTotalsWithDiscount(d.lines, !!d.vatDispense, d.discountKind, d.discountValue),
    }));
  }, [docs]);

  const onOpen = (id: string) => {
    router.push(`/dashboard/factures/new?saveId=${encodeURIComponent(id)}`);
  };

  const onDuplicate = async (id: string) => {
    try {
      const duplicatedId = await duplicateDocRecord(kind, id);
      await refresh();
      if (duplicatedId) router.push(`/dashboard/factures/new?saveId=${encodeURIComponent(duplicatedId)}`);
    } catch (error) {
      console.error(error);
    }
  };

  const onMarkPaid = async (id: string, isAlreadyPaid: boolean) => {
    if (isAlreadyPaid) return;
    try {
      await updateDocRecordStatus(kind, id, "paye");
      await refresh();
    } catch (error) {
      console.error(error);
    }
  };

  const onDelete = async (id: string) => {
    const doc = docs.find((item) => item.id === id);
    if (doc?.isFinalized) return;

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
            {i18nT("aucune_facture_pour_l_instant_e0f98428")}{" "}<div style={{ marginTop: 10 }}>
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
              {rows.map((d) => {
                const isPaid = d.status === "paye";
                const deletionLocked = !!d.isFinalized;
                return (
                  <tr key={d.id}>
                    <td style={{ fontWeight: 650 }}>{d.number}</td>
                    <td>{d.clientName}</td>
                    <td>{new Date(d.createdAtISO).toLocaleDateString("fr-FR")}</td>
                    <td>{d.status}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {formatEuro(d.totals.totalDue ?? d.totals.totalTTC)}
                    </td>
                    <td style={{ textAlign: "right", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button type="button" onClick={() => onOpen(d.id)} className={styles.ghostBtn}>
                        {i18nT("ouvrir_42c07747")}{" "}</button>
                      <button type="button" onClick={() => onDuplicate(d.id)} className={styles.ghostBtn}>
                        {i18nT("dupliquer_c5e1d3f1")}{" "}</button>
                      <button
                        type="button"
                        onClick={() => onMarkPaid(d.id, isPaid)}
                        className={styles.ghostBtn}
                        disabled={isPaid}
                        style={isPaid ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                      >
                        {i18nT("marquer_paye_90c8539f")}{" "}</button>
                      <button
                        type="button"
                        onClick={() => onDelete(d.id)}
                        className={styles.ghostBtn}
                        disabled={deletionLocked}
                        title={deletionLocked ? "Une facture figée ne peut pas être supprimée." : undefined}
                        style={deletionLocked ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                      >
                        {deletionLocked ? i18nT("figee_ea278e77") : i18nT("supprimer_1acfc1c7")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default ListPage;
