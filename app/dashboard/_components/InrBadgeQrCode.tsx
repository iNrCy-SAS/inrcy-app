"use client";

import { useTranslations } from "next-intl";


import { useMemo } from "react";
import { createInrBadgeQrMatrix } from "@/lib/inrBadgeQr";
import styles from "../dashboard.module.css";

type Props = {
  value: string;
  label?: string;
};

export default function InrBadgeQrCode({ value, label = "QR Code iNr'Badge" }: Props) {
  const i18nT = useTranslations("shell");
  const matrix = useMemo(() => {
    try {
      return createInrBadgeQrMatrix(value);
    } catch {
      return [];
    }
  }, [value]);

  if (!matrix.length) {
    return (
      <div className={styles.inrBadgeQrUnavailable} role="img" aria-label={i18nT("qr_code_indisponible_7d1cdbea")}>
        {i18nT("qr_indisponible_cd24def2")}{" "}</div>
    );
  }

  const size = matrix.length;
  const quietZone = 4;
  const viewBoxSize = size + quietZone * 2;
  const path = matrix
    .flatMap((row, rowIndex) => row.map((dark, colIndex) => (dark ? `M${colIndex + quietZone},${rowIndex + quietZone}h1v1h-1z` : "")))
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className={styles.inrBadgeQrSvg}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={viewBoxSize} height={viewBoxSize} rx="2" fill="currentColor" className={styles.inrBadgeQrSvgBackground} />
      <path d={path} fill="currentColor" className={styles.inrBadgeQrSvgModules} />
    </svg>
  );
}
