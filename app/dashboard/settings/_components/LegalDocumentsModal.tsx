"use client";

import { useTranslations } from "next-intl";


import BaseModal from "../../_components/WorkflowBaseModal";
import { legalDocs, type LegalDocKey } from "../../../legal/_components/legalDocs";
import legalStyles from "../../../legal/legal.module.css";

export default function LegalDocumentsModal({
  docKey,
  onClose,
}: {
  docKey: LegalDocKey;
  onClose: () => void;
}) {
  const i18nT = useTranslations("settings");
  const doc = legalDocs[docKey];
  const Content = doc.Content;

  return (
    <BaseModal title={i18nT(doc.titleKey)} moduleLabel="" onClose={onClose}>
      <div style={{ width: "100%", maxWidth: 980, margin: "0 auto" }}>
        <div className={legalStyles.card} style={{ marginTop: 0 }}>
          {doc.subtitleKey ? <p className={legalStyles.subtitle} style={{ marginTop: 0 }}>{i18nT(doc.subtitleKey)}</p> : null}
          <div style={{ marginTop: 14 }}>
            <Content />
          </div>
          <p className={legalStyles.small} style={{ marginTop: 18 }}>
            {i18nT("derniere_mise_a_jour_30_06_0c4ba073")}{" "}</p>
        </div>
      </div>
    </BaseModal>
  );
}
