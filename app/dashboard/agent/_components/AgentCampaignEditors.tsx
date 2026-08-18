import { useTranslations } from "next-intl";
import type { RefObject } from "react";
import EmojiPickerButton from "../../_components/EmojiPickerButton";
import RichSiteContentEditor from "../../booster/publier/components/RichSiteContentEditor";
import styles from "../agent.module.css";
import { AGENT_RICH_TEXT_EDITOR_STYLE } from "../_lib/agent.config";
import {
  contactDisplayName,
  contactDepartment,
  contactToCampaignRecipient,
  parseRecipientEmails,
} from "../_lib/agent.campaign-preview";
import type {
  CampaignMailPreview,
  CrmContactForAgent,
} from "../_lib/agent.types";

type CampaignTextDraft = { subject: string; body: string };

type AgentTranslator = (key: any) => string;

const CONTACT_TYPE_MESSAGE_KEYS: Record<string, string> = {
  client: "clients_28e22fe3",
  prospect: "prospects_8f522b12",
  fournisseur: "fournisseurs_06b6d88c",
  partenaire: "partenaires_e56efd6d",
  autre: "autres_2f0dd042",
};

const CONTACT_CATEGORY_MESSAGE_KEYS: Record<string, string> = {
  particulier: "particuliers_918ed212",
  professionnel: "professionnels_8d94a78e",
  institution: "institutions_dcd439a7",
  collectivite_publique: "collectivites_c0c84588",
};

function normalizeContactValue(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}

function localizedContactMetaLine(
  contact: CrmContactForAgent,
  translate: AgentTranslator,
) {
  const typeKey = CONTACT_TYPE_MESSAGE_KEYS[
    normalizeContactValue(contact.contact_type)
  ];
  const categoryKey = CONTACT_CATEGORY_MESSAGE_KEYS[
    normalizeContactValue(contact.category)
  ];
  const parts = [
    typeKey ? translate(typeKey) : "",
    categoryKey ? translate(categoryKey) : "",
    contactDepartment(contact.postal_code),
  ].filter(Boolean);
  return parts.join(" · ") || translate("contact_crm_a0dbaf26");
}

type CampaignMailTextModalProps = {
  open: boolean;
  preview: CampaignMailPreview | null;
  draft: CampaignTextDraft;
  editorRef: RefObject<HTMLDivElement | null>;
  saveState: "idle" | "saving";
  onClose: () => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onFormat: (kind: "bold" | "italic" | "underline") => void;
  onBeforeEmojiOpen: () => void;
  onEmojiSelect: (emoji: string) => void;
  onSave: () => void;
};

export function CampaignMailTextModal({
  open,
  preview,
  draft,
  editorRef,
  saveState,
  onClose,
  onSubjectChange,
  onBodyChange,
  onFormat,
  onBeforeEmojiOpen,
  onEmojiSelect,
  onSave,
}: CampaignMailTextModalProps) {
  const i18nT = useTranslations("agent");
  if (!open || !preview) return null;
  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={`${styles.settingsModal} ${styles.mailTextModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("modifier_le_texte_du_mail_887ee805")}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
        <p className={styles.modalEyebrow}>{i18nT("apercu_du_mail_7729eb2f")}</p>
        <h2>{i18nT("modifier_le_texte_f2680fa0")}</h2>
        <label className={styles.mailTextField}>
          <span>{i18nT("objet_3de621c5")}</span>
          <input value={draft.subject} onChange={(event) => onSubjectChange(event.target.value)} maxLength={220} />
        </label>
        <label className={styles.mailTextField}>
          <span>{i18nT("corps_du_mail_aa87a409")}</span>
          <div className={styles.richTextToolbar} aria-label={i18nT("mise_en_forme_du_corps_du_26c0498d")}>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat("bold")} title={i18nT("gras_bd63d1e9")}>
              <strong>B</strong>
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat("italic")} title={i18nT("italique_023eb97e")}>
              <em>I</em>
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onFormat("underline")} title={i18nT("souligne_591b8563")}>
              <span className={styles.underlineToolbarLabel}>U</span>
            </button>
            <EmojiPickerButton onBeforeOpen={onBeforeEmojiOpen} onSelect={onEmojiSelect} />
          </div>
          <RichSiteContentEditor
            value={draft.body}
            onChange={(value) => onBodyChange(value.slice(0, 6000))}
            minHeight={250}
            editorRef={editorRef}
            className={styles.richTextEditorSurface}
            style={AGENT_RICH_TEXT_EDITOR_STYLE}
          />
        </label>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose}>{i18nT("annuler_49ba3292")}</button>
          <button type="button" onClick={onSave} disabled={saveState === "saving"}>
            {saveState === "saving" ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_f7c8bcd8")}
          </button>
        </div>
      </section>
    </div>
  );
}

type RecipientDraft = { name: string; email: string; phone: string };

type RecipientsPickerModalProps = {
  open: boolean;
  preview: CampaignMailPreview | null;
  manualRecipientsInput: string;
  manualSelectedRecipientEmails: string[];
  crmSearch: string;
  filtersOpen: boolean;
  activeFiltersCount: number;
  category: string;
  contactType: string;
  department: string;
  importantOnly: boolean;
  filteredContacts: CrmContactForAgent[];
  filteredAllSelected: boolean;
  contactsLoading: boolean;
  selectedRecipientEmails: string[];
  newRecipientOpen: boolean;
  newRecipientDraft: RecipientDraft;
  newRecipientState: "idle" | "saving";
  saveState: "idle" | "saving";
  onClose: () => void;
  onManualRecipientsChange: (value: string) => void;
  onAddManualRecipients: () => void;
  onRemoveSelectedRecipient: (email: string) => void;
  onSearchChange: (value: string) => void;
  onToggleFilters: () => void;
  onToggleFiltered: () => void;
  onToggleNewRecipient: () => void;
  onCategoryChange: (value: string) => void;
  onContactTypeChange: (value: string) => void;
  onDepartmentChange: (value: string) => void;
  onToggleImportantOnly: () => void;
  onNewRecipientNameChange: (value: string) => void;
  onNewRecipientEmailChange: (value: string) => void;
  onAddNewRecipient: () => void;
  onToggleRecipient: (email: string) => void;
  onSave: () => void;
};

export function RecipientsPickerModal({
  open,
  preview,
  manualRecipientsInput,
  manualSelectedRecipientEmails,
  crmSearch,
  filtersOpen,
  activeFiltersCount,
  category,
  contactType,
  department,
  importantOnly,
  filteredContacts,
  filteredAllSelected,
  contactsLoading,
  selectedRecipientEmails,
  newRecipientOpen,
  newRecipientDraft,
  newRecipientState,
  saveState,
  onClose,
  onManualRecipientsChange,
  onAddManualRecipients,
  onRemoveSelectedRecipient,
  onSearchChange,
  onToggleFilters,
  onToggleFiltered,
  onToggleNewRecipient,
  onCategoryChange,
  onContactTypeChange,
  onDepartmentChange,
  onToggleImportantOnly,
  onNewRecipientNameChange,
  onNewRecipientEmailChange,
  onAddNewRecipient,
  onToggleRecipient,
  onSave,
}: RecipientsPickerModalProps) {
  const i18nT = useTranslations("agent");
  if (!open || !preview) return null;
  const selectedCount =
    selectedRecipientEmails.length +
    parseRecipientEmails(manualRecipientsInput).filter(
      (email) => !selectedRecipientEmails.includes(email),
    ).length;

  return (
    <div className={styles.modalBackdrop} role="presentation" onClick={onClose}>
      <section
        className={`${styles.settingsModal} ${styles.agentListModal} ${styles.recipientsPickerModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={i18nT("modifier_les_destinataires_3a589ae7")}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
        <h2>{i18nT("choisir_les_destinataires_56917aae")}</h2>

        <div className={styles.manualRecipientBox}>
          <div>
            <strong>{i18nT("destinataires_libres_4064d15b")}</strong>
            <small>{i18nT("saisissez_une_ou_plusieurs_adresses_separees_7dbde7b9")}</small>
          </div>
          <div className={styles.manualRecipientRow}>
            <input
              value={manualRecipientsInput}
              onChange={(event) => onManualRecipientsChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAddManualRecipients();
                }
              }}
              placeholder={i18nT("email_exemple_fr_autre_exemple_fr_d27a89cf")}
            />
            <button type="button" onClick={onAddManualRecipients}>{i18nT("ajouter_87c57ed1")}</button>
          </div>
          {manualSelectedRecipientEmails.length > 0 && (
            <div className={styles.manualRecipientChips}>
              {manualSelectedRecipientEmails.map((email) => (
                <button key={email} type="button" onClick={() => onRemoveSelectedRecipient(email)} title={i18nT("retirer_ce_destinataire_80483f55")}>
                  {email} <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.agentPickerToolbar}>
          <input value={crmSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder={i18nT("rechercher_un_contact_crm_f601aad0")} />
          <button
            type="button"
            className={`${styles.agentToolbarButton} ${activeFiltersCount > 0 ? styles.agentToolbarActiveButton : ""}`}
            onClick={onToggleFilters}
          >
            {i18nT("filtres_2a8e76e0")}{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ""}
          </button>
          <button
            type="button"
            className={styles.agentToolbarButton}
            onClick={onToggleFiltered}
            disabled={contactsLoading || filteredContacts.length === 0}
            title={i18nT(
              filteredAllSelected
                ? "deselect_filtered_contacts"
                : "select_filtered_contacts",
            )}
          >
            {i18nT(
              filteredAllSelected ? "aucun_b2ed82f1" : "tous_b97ae3b4",
            )}
          </button>
          <button type="button" className={styles.agentToolbarButton} onClick={onToggleNewRecipient}>{i18nT("contact_e22b3a79")}</button>
          <span className={styles.agentToolbarCount}>
            {filteredContacts.length} {" "}{i18nT("contact_1a73af9e")}{filteredContacts.length > 1 ? "s" : ""}
          </span>
        </div>

        {filtersOpen && (
          <div className={styles.agentFiltersPanel}>
            <label>
              <span>{i18nT("categorie_6b38300a")}</span>
              <select value={category} onChange={(event) => onCategoryChange(event.target.value)}>
                <option value="all">{i18nT("toutes_c5f641e4")}</option>
                <option value="particulier">{i18nT("particuliers_918ed212")}</option>
                <option value="professionnel">{i18nT("professionnels_8d94a78e")}</option>
                <option value="institution">{i18nT("institutions_dcd439a7")}</option>
                <option value="collectivite_publique">{i18nT("collectivites_c0c84588")}</option>
              </select>
            </label>
            <label>
              <span>{i18nT("type_3deb7456")}</span>
              <select value={contactType} onChange={(event) => onContactTypeChange(event.target.value)}>
                <option value="all">{i18nT("tous_b97ae3b4")}</option>
                <option value="client">{i18nT("clients_28e22fe3")}</option>
                <option value="prospect">{i18nT("prospects_8f522b12")}</option>
                <option value="fournisseur">{i18nT("fournisseurs_06b6d88c")}</option>
                <option value="partenaire">{i18nT("partenaires_e56efd6d")}</option>
                <option value="autre">{i18nT("autres_2f0dd042")}</option>
              </select>
            </label>
            <label>
              <span>{i18nT("departement_3d7c87c2")}</span>
              <input value={department} onChange={(event) => onDepartmentChange(event.target.value)} placeholder="62" inputMode="text" maxLength={3} />
            </label>
            <button
              type="button"
              className={`${styles.agentImportantToggle} ${importantOnly ? styles.agentImportantToggleActive : ""}`}
              onClick={onToggleImportantOnly}
              aria-pressed={importantOnly}
            >
              <span aria-hidden>{importantOnly ? "★" : "☆"}</span> {" "}{i18nT("important_uniquement_ce4158c9")}{" "}</button>
          </div>
        )}

        {newRecipientOpen && (
          <div className={styles.newRecipientBox}>
            <input value={newRecipientDraft.name} onChange={(event) => onNewRecipientNameChange(event.target.value)} placeholder={i18nT("nom_societe_6a160fa1")} />
            <input value={newRecipientDraft.email} onChange={(event) => onNewRecipientEmailChange(event.target.value)} placeholder="email@exemple.fr" />
            <button type="button" onClick={onAddNewRecipient} disabled={newRecipientState === "saving"}>
              {newRecipientState === "saving" ? i18nT("ajout_fd2762c1") : i18nT("ajouter_au_crm_14073ef0")}
            </button>
          </div>
        )}

        <div className={styles.agentListScroll}>
          {contactsLoading ? (
            <p className={styles.campaignEditHint}>{i18nT("chargement_des_contacts_crm_cc0a3919")}</p>
          ) : filteredContacts.length > 0 ? (
            filteredContacts.map((contact) => {
              const recipient = contactToCampaignRecipient(contact);
              if (!recipient) return null;
              const checked = selectedRecipientEmails.includes(recipient.email.toLowerCase());
              return (
                <label
                  key={contact.id}
                  className={`${styles.agentListRow} ${styles.agentSelectableRow} ${styles.agentRecipientRow} ${checked ? styles.agentSelectedRow : ""}`}
                >
                  <input type="checkbox" checked={checked} onChange={() => onToggleRecipient(recipient.email)} />
                  <span className={styles.agentListContent}>
                    <strong className={styles.agentRecipientMain}>
                      <span>
                        {contactDisplayName(contact) === "Contact CRM"
                          ? i18nT("contact_crm_a0dbaf26")
                          : contactDisplayName(contact)}
                        {contact.important ? <span className={styles.agentImportantMark}>★</span> : null}
                      </span>
                      <em>— {recipient.email}</em>
                    </strong>
                    <small>{localizedContactMetaLine(contact, i18nT)}</small>
                  </span>
                </label>
              );
            })
          ) : (
            <p className={styles.campaignEditHint}>{i18nT("aucun_contact_crm_avec_email_ne_defb8e0a")}</p>
          )}
        </div>
        <div className={styles.modalActions}>
          <button type="button" onClick={onClose} disabled={saveState === "saving"}>{i18nT("annuler_49ba3292")}</button>
          <button type="button" onClick={onSave} disabled={saveState === "saving"}>
            {saveState === "saving" ? i18nT("enregistrement_9bf1058a") : i18nT("valider_value_contact_value_a7a4a059", { value0: selectedCount, value1: selectedCount > 1 ? "s" : "" })}
          </button>
        </div>
      </section>
    </div>
  );
}
