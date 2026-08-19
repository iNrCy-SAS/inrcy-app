"use client";

import { useTranslations } from "next-intl";

import styles from "../legal.module.css";
import {
  LEGAL_DOCUMENT_BLOCKS,
  type LegalDocumentId,
} from "./legalDocumentSchema";

export default function LegalTextContent({ document }: { document: LegalDocumentId }) {
  const t = useTranslations("legal");
  const blocks = LEGAL_DOCUMENT_BLOCKS[document];

  return (
    <section>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <h2 className={styles.h2} key={`${block.key}-${index}`}>
              {t(block.key)}
            </h2>
          );
        }

        if (block.kind === "list") {
          return (
            <ul className={styles.ul} key={`${block.keys[0]}-${index}`}>
              {block.keys.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p className={styles.p} key={`${block.key}-${index}`}>
            {t(block.key)}
          </p>
        );
      })}

      <p className={styles.translationNotice}>
        {t("version_francaise_reference_2d7d7eab")}
      </p>
    </section>
  );
}
