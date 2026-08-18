"use client";

import { useTranslations } from "next-intl";


import type { RefObject } from "react";
import styles from "./documents.module.css";
import type { ClientType, CrmContact } from "./documentEditorShared";

type ContactFieldKey =
  | "clientType"
  | "clientName"
  | "clientEmail"
  | "clientSiren"
  | "billingAddress"
  | "billingPostalCode"
  | "billingCity";

type ContactFieldErrors = Partial<Record<ContactFieldKey, string>>;

type ActionMessage = {
  type: "error" | "success";
  text: string;
};

type DocumentContactSectionProps = {
  crmContainerRef: RefObject<HTMLDivElement | null>;
  crmLoading: boolean;
  crmOpen: boolean;
  onToggleCrm: () => void;
  crmButtonText: string;
  crmQuery: string;
  onCrmQueryChange: (value: string) => void;
  filteredCrmContacts: CrmContact[];
  getContactLabel: (contact: CrmContact) => string;
  onSelectCrmContact: (contact: CrmContact) => void;
  clientType: ClientType;
  onClientTypeChange: (value: ClientType) => void;
  fieldErrors: ContactFieldErrors;
  addingToCrm: boolean;
  addToCrmDisabled: boolean;
  onAddCurrentClientToCrm: () => void;
  crmActionMessage: ActionMessage | null;
  crmError: string | null;
  clientName: string;
  onClientNameChange: (value: string) => void;
  clientEmail: string;
  onClientEmailChange: (value: string) => void;
  clientSiren: string;
  onClientSirenChange: (value: string) => void;
  clientVatNumber: string;
  onClientVatNumberChange: (value: string) => void;
  billingAddress: string;
  onBillingAddressChange: (value: string) => void;
  billingPostalCode: string;
  onBillingPostalCodeChange: (value: string) => void;
  billingCity: string;
  onBillingCityChange: (value: string) => void;
  sameAddresses: boolean;
  onSameAddressesChange: (value: boolean) => void;
  deliveryAddress: string;
  onDeliveryAddressChange: (value: string) => void;
  deliveryPostalCode: string;
  onDeliveryPostalCodeChange: (value: string) => void;
  deliveryCity: string;
  onDeliveryCityChange: (value: string) => void;
  editingLocked?: boolean;
  showOptionalSirenLabel?: boolean;
};

export function DocumentContactSection({
  crmContainerRef,
  crmLoading,
  crmOpen,
  onToggleCrm,
  crmButtonText,
  crmQuery,
  onCrmQueryChange,
  filteredCrmContacts,
  getContactLabel,
  onSelectCrmContact,
  clientType,
  onClientTypeChange,
  fieldErrors,
  addingToCrm,
  addToCrmDisabled,
  onAddCurrentClientToCrm,
  crmActionMessage,
  crmError,
  clientName,
  onClientNameChange,
  clientEmail,
  onClientEmailChange,
  clientSiren,
  onClientSirenChange,
  clientVatNumber,
  onClientVatNumberChange,
  billingAddress,
  onBillingAddressChange,
  billingPostalCode,
  onBillingPostalCodeChange,
  billingCity,
  onBillingCityChange,
  sameAddresses,
  onSameAddressesChange,
  deliveryAddress,
  onDeliveryAddressChange,
  deliveryPostalCode,
  onDeliveryPostalCodeChange,
  deliveryCity,
  onDeliveryCityChange,
  editingLocked = false,
  showOptionalSirenLabel = false,
}: DocumentContactSectionProps) {
  const i18nT = useTranslations("documents");
  return (
    <div className={styles.formBlock}>
      <div className={styles.formBlockHeader}>
        <div>
          <div className={styles.formBlockTitleRow}>
            <span className={styles.formBlockIcon} aria-hidden="true">
              👤
            </span>
            <div className={styles.formBlockTitle}>{i18nT("infos_contact_ee4e5207")}</div>
          </div>
          <div className={styles.formBlockSubtitle}>
            {i18nT("import_crm_coordonnees_et_adresse_du_65ebcecd")}{" "}</div>
        </div>
      </div>

      <div className={styles.crmActionBar} ref={crmContainerRef}>
        <div className={styles.crmActionMain}>
          <span className={styles.crmActionLabel}>{i18nT("importer_un_contact_d2ca1cf2")}</span>
          <button
            type="button"
            className={styles.crmImportButton}
            onClick={onToggleCrm}
            disabled={crmLoading || editingLocked}
            aria-haspopup="listbox"
            aria-expanded={crmOpen}
          >
            <span className={styles.crmImportButtonText} title={crmButtonText}>
              {crmButtonText}
            </span>
            <span aria-hidden="true">▾</span>
          </button>

          {crmOpen ? (
            <div
              className={styles.crmSearchPanel}
              role="dialog"
              aria-label={i18nT("importer_ou_rechercher_un_contact_crm_c07daf05")}
            >
              <input
                className={styles.crmSearchInput}
                type="search"
                value={crmQuery}
                onChange={(event) => onCrmQueryChange(event.target.value)}
                placeholder={i18nT("rechercher_un_contact_email_telephone_8f861916")}
                autoFocus
              />
              <div className={styles.crmSearchResults} role="listbox">
                {filteredCrmContacts.length ? (
                  filteredCrmContacts.map((contact) => {
                    const name = getContactLabel(contact);
                    const line = contact.email
                      ? `${name} — ${contact.email}`
                      : name;
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        className={styles.crmSearchItem}
                        onClick={() => onSelectCrmContact(contact)}
                        title={line}
                      >
                        {line}
                      </button>
                    );
                  })
                ) : (
                  <div className={styles.crmSearchEmpty}>
                    {i18nT("aucun_contact_trouve_remplissez_le_client_716d0a18")}{" "}</div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className={`${styles.field} ${styles.crmClientTypeField}`}>
          <label>
            {i18nT("type_de_client_b2406987")}<span className={styles.requiredMark}>*</span>
          </label>
          <select
            value={clientType}
            onChange={(event) =>
              onClientTypeChange(event.target.value as ClientType)
            }
            disabled={editingLocked}
          >
            <option value="">—</option>
            <option value="particulier">{i18nT("particulier_281680dd")}</option>
            <option value="professionnel">{i18nT("professionnel_aec80314")}</option>
            <option value="institution">{i18nT("institution_429f9450")}</option>
          </select>
          {fieldErrors.clientType ? (
            <div className={styles.fieldError}>{fieldErrors.clientType}</div>
          ) : null}
        </div>

        <div className={styles.crmAddColumn}>
          <button
            type="button"
            className={styles.crmAddButton}
            onClick={onAddCurrentClientToCrm}
            disabled={addToCrmDisabled}
          >
            {addingToCrm ? i18nT("ajout_crm_6e9af468") : i18nT("ajouter_au_crm_3fc72231")}
          </button>
          {crmActionMessage ? (
            <div
              className={`${styles.crmActionMessage} ${crmActionMessage.type === "success" ? styles.crmActionMessageSuccess : styles.crmActionMessageError}`}
            >
              {crmActionMessage.text}
            </div>
          ) : null}
        </div>

        {crmError ? (
          <div
            style={{
              gridColumn: "1 / -1",
              marginTop: -4,
              fontSize: 12,
              opacity: 0.8,
            }}
          >
            ⚠️ {crmError}
          </div>
        ) : null}
      </div>

      <div className={styles.fourCol}>
        <div className={styles.field}>
          <label>
            {i18nT("client_1bdd79b1")}<span className={styles.requiredMark}>*</span>
          </label>
          <input
            value={clientName}
            onChange={(event) => onClientNameChange(event.target.value)}
            placeholder={i18nT("nom_du_client_8626bd1c")}
            disabled={editingLocked}
          />
          {fieldErrors.clientName ? (
            <div className={styles.fieldError}>{fieldErrors.clientName}</div>
          ) : null}
        </div>

        <div className={styles.field}>
          <label>
            {i18nT("email_client_a1f95beb")}<span className={styles.requiredMark}>*</span>
          </label>
          <input
            value={clientEmail}
            onChange={(event) => onClientEmailChange(event.target.value)}
            placeholder="email@client.fr"
            disabled={editingLocked}
          />
          {fieldErrors.clientEmail ? (
            <div className={styles.fieldError}>{fieldErrors.clientEmail}</div>
          ) : null}
        </div>

        <div className={styles.field}>
          <label>
            {i18nT("siren_client_70e2fa4d")}{" "}{clientType && clientType !== "particulier" ? (
              <span className={styles.requiredMark}>*</span>
            ) : showOptionalSirenLabel ? (
              <span> {" "}{i18nT("optionnel_6f73b232")}</span>
            ) : null}
          </label>
          <input
            value={clientSiren}
            onChange={(event) => onClientSirenChange(event.target.value)}
            placeholder={i18nT("ex_123456789_c5c1c4f3")}
            disabled={editingLocked}
          />
          {fieldErrors.clientSiren ? (
            <div className={styles.fieldError}>{fieldErrors.clientSiren}</div>
          ) : null}
        </div>

        <div className={styles.field}>
          <label>{i18nT("n_tva_client_optionnel_c4f67258")}</label>
          <input
            value={clientVatNumber}
            onChange={(event) => onClientVatNumberChange(event.target.value)}
            placeholder={i18nT("ex_fr12345678901_d77e14ad")}
            disabled={editingLocked}
          />
        </div>
      </div>

      <div className={styles.compactThreeCol}>
        <div className={styles.field}>
          <label>
            {i18nT("adresse_522e1466")}<span className={styles.requiredMark}>*</span>
          </label>
          <input
            value={billingAddress}
            onChange={(event) => onBillingAddressChange(event.target.value)}
            placeholder={i18nT("adresse_522e1466")}
            disabled={editingLocked}
          />
          {fieldErrors.billingAddress ? (
            <div className={styles.fieldError}>
              {fieldErrors.billingAddress}
            </div>
          ) : null}
        </div>
        <div className={styles.field}>
          <label>
            {i18nT("code_postal_74779109")}<span className={styles.requiredMark}>*</span>
          </label>
          <input
            value={billingPostalCode}
            onChange={(event) =>
              onBillingPostalCodeChange(event.target.value)
            }
            placeholder={i18nT("ex_62440_337b8fbc")}
            disabled={editingLocked}
          />
          {fieldErrors.billingPostalCode ? (
            <div className={styles.fieldError}>
              {fieldErrors.billingPostalCode}
            </div>
          ) : null}
        </div>
        <div className={styles.field}>
          <label>
            {i18nT("ville_97217611")}<span className={styles.requiredMark}>*</span>
          </label>
          <input
            value={billingCity}
            onChange={(event) => onBillingCityChange(event.target.value)}
            placeholder={i18nT("ex_harnes_00e9b711")}
            disabled={editingLocked}
          />
          {fieldErrors.billingCity ? (
            <div className={styles.fieldError}>{fieldErrors.billingCity}</div>
          ) : null}
        </div>
      </div>

      <div className={styles.field}>
        <label
          className={styles.checkboxLabel}
          style={{ cursor: editingLocked ? "not-allowed" : "pointer" }}
        >
          <input
            className={styles.checkboxInput}
            type="checkbox"
            checked={sameAddresses}
            onChange={(event) => onSameAddressesChange(event.target.checked)}
            disabled={editingLocked}
          />
          <span>
            {i18nT("adresse_de_livraison_identique_a_l_e672289e")}{" "}</span>
        </label>
      </div>

      {!sameAddresses ? (
        <div
          style={{
            marginTop: -2,
            marginBottom: 4,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <div className={styles.compactThreeCol}>
            <div className={styles.field} style={{ marginBottom: 0 }}>
              <label>{i18nT("adresse_de_livraison_31eac756")}</label>
              <input
                value={deliveryAddress}
                onChange={(event) =>
                  onDeliveryAddressChange(event.target.value)
                }
                placeholder={i18nT("adresse_522e1466")}
                disabled={editingLocked}
              />
            </div>
            <div className={styles.field} style={{ marginBottom: 0 }}>
              <label>{i18nT("code_postal_livraison_025cc681")}</label>
              <input
                value={deliveryPostalCode}
                onChange={(event) =>
                  onDeliveryPostalCodeChange(event.target.value)
                }
                placeholder={i18nT("ex_62440_337b8fbc")}
                disabled={editingLocked}
              />
            </div>
            <div className={styles.field} style={{ marginBottom: 0 }}>
              <label>{i18nT("ville_livraison_54612c4a")}</label>
              <input
                value={deliveryCity}
                onChange={(event) =>
                  onDeliveryCityChange(event.target.value)
                }
                placeholder={i18nT("ex_harnes_00e9b711")}
                disabled={editingLocked}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
