"use client";

import { useTranslations } from "next-intl";


import { useState } from "react";

type EditableTagsProps = {
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
  placeholder: string;
  emptyText?: string;
  maxItems?: number;
  inlineAdd?: boolean;
};

function cleanTag(value: string) {
  return String(value || "")
    .replace(/^[,;\s]+|[,;\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTags(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("fr");
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function EditableTags({
  values,
  onChange,
  addLabel,
  placeholder,
  emptyText,
  maxItems = 30,
  inlineAdd = false,
}: EditableTagsProps) {
  const i18nT = useTranslations("settings");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const next = draft
      .split(/[,;\n]+/)
      .map(cleanTag)
      .filter(Boolean);
    if (!next.length) {
      setDraft("");
      return;
    }
    onChange(uniqueTags([...values, ...next]).slice(0, maxItems));
    setDraft("");
  };

  return (
    <div style={{ display: "grid", gap: 9 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          minHeight: 38,
        }}
      >
        {values.map((value) => (
          <span
            key={value}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              maxWidth: "100%",
              padding: "7px 9px 7px 11px",
              borderRadius: 999,
              border: "1px solid rgba(56,189,248,0.34)",
              background:
                "linear-gradient(135deg, rgba(56,189,248,0.15), rgba(139,92,246,0.13), rgba(244,114,182,0.10))",
              color: "rgba(255,255,255,0.94)",
              fontSize: 12.5,
              fontWeight: 750,
              lineHeight: 1.2,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {value}
            </span>
            <button
              type="button"
              aria-label={i18nT("retirer_value_c04cdfcb", { value0: value })}
              title={i18nT("retirer_value_c04cdfcb", { value0: value })}
              onClick={() => onChange(values.filter((item) => item !== value))}
              style={{
                width: 20,
                height: 20,
                flex: "0 0 auto",
                display: "grid",
                placeItems: "center",
                padding: 0,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.13)",
                background: "rgba(4,10,24,0.42)",
                color: "rgba(255,255,255,0.76)",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        ))}

        {!values.length && emptyText ? (
          <span style={{ color: "rgba(255,255,255,0.56)", fontSize: 12.5 }}>
            {emptyText}
          </span>
        ) : null}

        {inlineAdd && !adding && values.length < maxItems ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            style={addButtonStyle}
          >
            + {addLabel}
          </button>
        ) : null}
      </div>

      {adding ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 8,
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "," || event.key === ";") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              if (draft.trim()) commit();
            }}
            placeholder={placeholder}
            style={{
              minWidth: 0,
              width: "100%",
              boxSizing: "border-box",
              borderRadius: 11,
              border: "1px solid rgba(125,211,252,0.32)",
              background: "rgba(4,10,24,0.48)",
              color: "white",
              outline: "none",
              padding: "9px 11px",
            }}
          />
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={commit}
            style={{
              borderRadius: 11,
              border: "1px solid rgba(56,189,248,0.34)",
              background: "rgba(56,189,248,0.14)",
              color: "white",
              padding: "8px 12px",
              cursor: "pointer",
              fontWeight: 850,
            }}
          >
            {i18nT("ajouter_87c57ed1")}{" "}</button>
        </div>
      ) : !inlineAdd && values.length < maxItems ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={addButtonStyle}
        >
          + {addLabel}
        </button>
      ) : null}
    </div>
  );
}

const addButtonStyle = {
  justifySelf: "start",
  borderRadius: 999,
  border: "1px dashed rgba(125,211,252,0.38)",
  background: "rgba(56,189,248,0.07)",
  color: "#bae6fd",
  padding: "7px 11px",
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 850,
} as const;
