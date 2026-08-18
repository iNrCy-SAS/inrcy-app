"use client";

import { useTranslations } from "next-intl";


import styles from "./documents.module.css";
import type { Profile } from "./documentEditorShared";

type ProviderField =
  | "company_legal_name"
  | "hq_address"
  | "hq_zip"
  | "hq_city"
  | "phone"
  | "contact_email"
  | "siren"
  | "vat_number";

type DocumentPartiesProps = {
  providerLabel: string;
  clientLabel: string;
  phoneLabel: string;
  vatLabel: string;
  deliveryAddressLabel: string;
  providerData: Profile;
  allowProviderEditing?: boolean;
  isEditingProvider?: boolean;
  onToggleProviderEditing?: () => void;
  onResetProvider?: () => void;
  onProviderFieldChange?: (field: ProviderField, value: string) => void;
  clientName: string;
  clientSiren: string;
  clientVatNumber: string;
  billingFullAddress: string;
  showDeliveryAddress: boolean;
  deliveryFullAddress: string;
  clientEmail: string;
};

export function DocumentParties({
  providerLabel,
  clientLabel,
  phoneLabel,
  vatLabel,
  deliveryAddressLabel,
  providerData,
  allowProviderEditing = false,
  isEditingProvider = false,
  onToggleProviderEditing,
  onResetProvider,
  onProviderFieldChange,
  clientName,
  clientSiren,
  clientVatNumber,
  billingFullAddress,
  showDeliveryAddress,
  deliveryFullAddress,
  clientEmail,
}: DocumentPartiesProps) {
  const i18nT = useTranslations("documents");
  const updateProviderField = (field: ProviderField, value: string) => {
    onProviderFieldChange?.(field, value);
  };

  return (
    <div className={styles.previewParties}>
      <div className={styles.previewPartyCard}>
        <div className={styles.previewPartyTitle}>{providerLabel}</div>
        {allowProviderEditing ? (
          <div
            className={styles.noPrint}
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 8,
              marginTop: 4,
            }}
          >
            <button
              type="button"
              onClick={onToggleProviderEditing}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 8,
                border: "1px solid #cbb4ff",
              }}
            >
              {i18nT("modifier_723bbbfe")}{" "}</button>
            <button
              type="button"
              onClick={onResetProvider}
              style={{
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 8,
                border: "1px solid #cbb4ff",
              }}
            >
              {i18nT("reinitialiser_d4f58c8b")}{" "}</button>
          </div>
        ) : null}
        <div style={{ fontWeight: 600 }}>
          {isEditingProvider ? (
            <input
              value={providerData.company_legal_name ?? ""}
              onChange={(event) =>
                updateProviderField("company_legal_name", event.target.value)
              }
              style={{ width: "100%" }}
            />
          ) : (
            (providerData.company_legal_name ?? "—")
          )}
        </div>
        <div>
          {isEditingProvider ? (
            <input
              value={providerData.hq_address ?? ""}
              onChange={(event) =>
                updateProviderField("hq_address", event.target.value)
              }
              placeholder={i18nT("adresse_522e1466")}
              style={{ width: "100%", marginTop: 4 }}
            />
          ) : (
            (providerData.hq_address ?? "")
          )}
        </div>
        <div>
          {isEditingProvider ? (
            <input
              value={providerData.hq_zip ?? ""}
              onChange={(event) =>
                updateProviderField("hq_zip", event.target.value)
              }
              placeholder="CP"
              style={{ width: "100%", marginTop: 4 }}
            />
          ) : (
            (providerData.hq_zip ?? "")
          )}{" "}
          {isEditingProvider ? (
            <input
              value={providerData.hq_city ?? ""}
              onChange={(event) =>
                updateProviderField("hq_city", event.target.value)
              }
              placeholder={i18nT("ville_97217611")}
              style={{ width: "100%", marginTop: 4 }}
            />
          ) : (
            (providerData.hq_city ?? "")
          )}
        </div>

        <div style={{ marginTop: 6, fontSize: 13, color: "#444" }}>
          {isEditingProvider ? (
            <div style={{ display: "grid", gap: 6 }}>
              <input
                value={providerData.phone ?? ""}
                onChange={(event) =>
                  updateProviderField("phone", event.target.value)
                }
                placeholder={i18nT("telephone_d3b023ea")}
              />
              <input
                value={providerData.contact_email ?? ""}
                onChange={(event) =>
                  updateProviderField("contact_email", event.target.value)
                }
                placeholder={i18nT("email_84add5b2")}
              />
              <input
                value={providerData.siren ?? ""}
                onChange={(event) =>
                  updateProviderField("siren", event.target.value)
                }
                placeholder="SIREN"
              />
              <input
                value={providerData.vat_number ?? ""}
                onChange={(event) =>
                  updateProviderField("vat_number", event.target.value)
                }
                placeholder="TVA"
              />
            </div>
          ) : (
            <>
              {providerData.phone ? (
                <div>
                  {phoneLabel} : {providerData.phone}
                </div>
              ) : null}
              {providerData.contact_email ? (
                <div>{i18nT("email_value_e78d7e52", { value0: providerData.contact_email })}</div>
              ) : null}
              {providerData.siren ? <div>{i18nT("siren_value_b2ffa596", { value0: providerData.siren })}</div> : null}
              {providerData.vat_number ? (
                <div>
                  {vatLabel} : {providerData.vat_number}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className={styles.previewPartyCard}>
        <div className={styles.previewPartyTitle}>{clientLabel}</div>
        <div style={{ fontWeight: 600 }}>{clientName || "—"}</div>
        {clientSiren ? <div>{i18nT("siren_value_b2ffa596", { value0: clientSiren })}</div> : null}
        {clientVatNumber ? (
          <div>
            {vatLabel} : {clientVatNumber}
          </div>
        ) : null}
        <div>{billingFullAddress}</div>
        {showDeliveryAddress ? (
          <div style={{ marginTop: 6 }}>
            <strong>{deliveryAddressLabel} :</strong> {deliveryFullAddress}
          </div>
        ) : null}
        <div style={{ fontSize: 13, color: "#444", marginTop: 6 }}>
          {clientEmail || ""}
        </div>
      </div>
    </div>
  );
}
