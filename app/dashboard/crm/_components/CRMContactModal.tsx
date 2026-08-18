import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import styles from "../crm.module.css";
import type { Category, ContactType, CrmDraft } from "../crm.types";
import { useUnsavedExitGuard } from "../../_hooks/useUnsavedExitGuard";
import { confirmInrcy } from "@/lib/inrcyDialog";
import DetailSequenceNavigation from "../../_components/DetailSequenceNavigation";

type Props = {
  open: boolean;
  error: string | null;
  isResponsive: boolean;
  editingId: string | null;
  draft: CrmDraft;
  setDraft: Dispatch<SetStateAction<CrmDraft>>;
  saving: boolean;
  deliverySameAsPrimary: boolean;
  setDeliverySameAsPrimary: (checked: boolean) => void;
  updatePrimaryAddress: (value: string) => void;
  onToggleImportant: () => void;
  onClose: () => void;
  onSave: () => void;
  navigationLabel: string;
  navigationBusy: boolean;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
  onNavigatePrevious: () => void | Promise<void>;
  onNavigateNext: () => void | Promise<void>;
};

export default function CRMContactModal({
  open,
  error,
  isResponsive,
  editingId,
  draft,
  setDraft,
  saving,
  deliverySameAsPrimary,
  setDeliverySameAsPrimary,
  updatePrimaryAddress,
  onToggleImportant,
  onClose,
  onSave,
  navigationLabel,
  navigationBusy,
  canNavigatePrevious,
  canNavigateNext,
  onNavigatePrevious,
  onNavigateNext,
}: Props) {
  const i18nT = useTranslations("crm");
  const contactIdentity = editingId ?? "new-contact";
  const [baseline, setBaseline] = useState<{ identity: string; snapshot: string } | null>(null);
  const snapshot = useMemo(
    () => JSON.stringify({ draft, deliverySameAsPrimary }),
    [draft, deliverySameAsPrimary],
  );

  useLayoutEffect(() => {
    setBaseline((current) => {
      if (!open) return null;
      if (current?.identity === contactIdentity) return current;
      return { identity: contactIdentity, snapshot };
    });
  }, [contactIdentity, open, snapshot]);

  const hasUnsavedChanges = open
    && baseline?.identity === contactIdentity
    && snapshot !== baseline.snapshot;
  const { confirmExit } = useUnsavedExitGuard({
    active: open,
    shouldBlock: hasUnsavedChanges,
    onConfirmExit: onClose,
    eyebrow: i18nT("contacts_b0dd615c"),
    title: i18nT("quitter_sans_enregistrer_6208bd94"),
    message: i18nT("ce_contact_contient_des_modifications_non_3fa2c30f"),
    confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });

  const requestNavigation = async (direction: "previous" | "next") => {
    if (hasUnsavedChanges) {
      const ok = await confirmInrcy({
        eyebrow: i18nT("contacts_b0dd615c"),
        title: i18nT("changer_de_contact_sans_enregistrer_ed9e2ac9"),
        message: i18nT("les_modifications_apportees_a_ce_contact_434b9120"),
        confirmLabel: i18nT("changer_de_contact_4974dc4a"),
        cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
        variant: "warning",
      });
      if (!ok) return;
    }
    if (direction === "previous") await onNavigatePrevious();
    else await onNavigateNext();
  };

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div className={styles.modalTitle}>{editingId ? i18nT("modifier_un_contact_b7162016") : i18nT("ajouter_un_contact_58e74c01")}</div>
          <div className={styles.modalHeadActions}>
            {editingId && navigationLabel ? (
              <DetailSequenceNavigation
                label={navigationLabel}
                busy={navigationBusy}
                canPrevious={canNavigatePrevious}
                canNext={canNavigateNext}
                onPrevious={() => requestNavigation("previous")}
                onNext={() => requestNavigation("next")}
                ariaLabel={i18nT("navigation_entre_les_contacts_c10b0f06")}
              />
            ) : null}
            <button type="button" className={styles.modalClose} onClick={() => void confirmExit()} aria-label={i18nT("fermer_5ab4ec64")}>
              ✕
            </button>
          </div>
        </div>

        {error ? <div className={styles.error}>{error}</div> : null}

        {isResponsive ? (
          <div className={styles.mobileModalForm}>
            <label className={`${styles.label} ${styles.mfName} ${styles.fName}`}>
              <span>{i18nT("nom_prenom_raison_sociale_ca1f1a9b")}</span>
              <input
                className={styles.input}
                value={draft.display_name}
                onChange={(e) => setDraft((s) => ({ ...s, display_name: e.target.value }))}
                placeholder={i18nT("dupont_marie_sas_exemple_22dde339")}
                autoComplete="name"
              />
            </label>

            <label className={`${styles.label} ${styles.mfPhone} ${styles.fPhone}`}>
              <span>{i18nT("telephone_d3b023ea")}</span>
              <input
                className={styles.input}
                value={draft.phone}
                onChange={(e) => setDraft((s) => ({ ...s, phone: e.target.value }))}
                placeholder="06 00 00 00 00"
                autoComplete="tel"
              />
            </label>

            <label className={`${styles.label} ${styles.mfMail} ${styles.fMail}`}>
              <span>{i18nT("mail_92379cbb")}</span>
              <input
                className={styles.input}
                value={draft.email}
                onChange={(e) => setDraft((s) => ({ ...s, email: e.target.value }))}
                placeholder="marie@exemple.fr"
                autoComplete="email"
              />
            </label>

            <label className={`${styles.label} ${styles.mfCategory} ${styles.fCategory}`}>
              <span>{i18nT("categorie_6b38300a")}</span>
              <select className={styles.select} value={draft.category} onChange={(e) => setDraft((s) => ({ ...s, category: e.target.value as Category }))}>
                <option value="">—</option>
                <option value="particulier">{i18nT("particulier_281680dd")}</option>
                <option value="professionnel">{i18nT("professionnel_aec80314")}</option>
                <option value="collectivite_publique">{i18nT("institution_429f9450")}</option>
              </select>
            </label>

            <label className={`${styles.label} ${styles.mfType} ${styles.fType}`}>
              <span>{i18nT("type_3deb7456")}</span>
              <select className={styles.select} value={draft.contact_type} onChange={(e) => setDraft((s) => ({ ...s, contact_type: e.target.value as ContactType }))}>
                <option value="">—</option>
                <option value="client">{i18nT("client_1bdd79b1")}</option>
                <option value="prospect">{i18nT("prospect_99b3f65c")}</option>
                <option value="fournisseur">{i18nT("fournisseur_97d91d89")}</option>
                <option value="partenaire">{i18nT("partenaire_d727d03b")}</option>
                <option value="autre">{i18nT("autre_43dacf9e")}</option>
              </select>
            </label>

            <label className={`${styles.label} ${styles.mfSiren} ${styles.fSiren}`}>
              <span>SIREN</span>
              <input
                className={styles.input}
                value={draft.siret}
                onChange={(e) => setDraft((s) => ({ ...s, siret: e.target.value }))}
                placeholder="123 456 789"
                inputMode="numeric"
              />
            </label>

            <label className={`${styles.label} ${styles.mfVat} ${styles.fVat}`}>
              <span>{i18nT("tva_intracom_099df2a4")}</span>
              <input
                className={styles.input}
                value={draft.vat_number}
                onChange={(e) => setDraft((s) => ({ ...s, vat_number: e.target.value }))}
                placeholder="FR12345678901"
              />
            </label>

            <label className={`${styles.label} ${styles.mfImportant} ${styles.fImportant}`}>
              <span>{i18nT("important_4b6d6a30")}</span>
              <button
                type="button"
                className={styles.starToggle}
                onClick={onToggleImportant}
                aria-pressed={draft.important ? "true" : "false"}
                title={draft.important ? "Contact important" : "Marquer comme important"}
              >
                {draft.important ? "★" : "☆"}
              </button>
            </label>

            <label className={`${styles.label} ${styles.mfAddress} ${styles.fAddress}`}>
              <span>{i18nT("adresse_principale_b7ab7b05")}</span>
              <input
                className={styles.input}
                value={draft.address}
                onChange={(e) => updatePrimaryAddress(e.target.value)}
                placeholder={i18nT("12_rue_95da8eca")}
                autoComplete="street-address"
              />
            </label>

            <label className={`${styles.label} ${styles.mfCity} ${styles.fCity}`}>
              <span>{i18nT("ville_97217611")}</span>
              <input
                className={styles.input}
                value={draft.city}
                onChange={(e) => setDraft((s) => ({ ...s, city: e.target.value }))}
                placeholder={i18nT("paris_22390ad1")}
                autoComplete="address-level2"
              />
            </label>

            <label className={`${styles.label} ${styles.mfCP} ${styles.fCP}`}>
              <span>CP</span>
              <input
                className={styles.input}
                value={draft.postal_code}
                onChange={(e) => setDraft((s) => ({ ...s, postal_code: e.target.value }))}
                placeholder="75000"
                inputMode="numeric"
                autoComplete="postal-code"
              />
            </label>

            <label className={`${styles.label} ${styles.mfDeliverySame}`}>
              <span className={styles.sameAddressLabel}>{i18nT("adresse_de_livraison_identique_9b320046")}</span>
              <label className={styles.sameAddressCheck}>
                <input type="checkbox" checked={deliverySameAsPrimary} onChange={(e) => setDeliverySameAsPrimary(e.target.checked)} />
                <span>{i18nT("utiliser_l_adresse_principale_fbbcc33b")}</span>
              </label>
            </label>

            <label className={`${styles.label} ${styles.mfNotes} ${styles.fNotes}`}>
              <span>{i18nT("notes_70440046")}</span>
              <textarea
                className={styles.textarea}
                value={draft.notes}
                onChange={(e) => setDraft((s) => ({ ...s, notes: e.target.value }))}
                placeholder={i18nT("notes_internes_1a81fb4e")}
              />
            </label>
          </div>
        ) : (
          <div className={`${styles.formGrid} ${styles.modalFormGrid} ${styles.desktopModalGrid}`}>
            <label className={`${styles.label} ${styles.col6} ${styles.fName}`}>
              <span>{i18nT("nom_prenom_raison_sociale_ca1f1a9b")}</span>
              <input
                className={styles.input}
                value={draft.display_name}
                onChange={(e) => setDraft((s) => ({ ...s, display_name: e.target.value }))}
                placeholder={i18nT("dupont_marie_sas_exemple_22dde339")}
                autoComplete="name"
              />
            </label>

            <label className={`${styles.label} ${styles.col3} ${styles.fPhone}`}>
              <span>{i18nT("telephone_d3b023ea")}</span>
              <input
                className={styles.input}
                value={draft.phone}
                onChange={(e) => setDraft((s) => ({ ...s, phone: e.target.value }))}
                placeholder="06 00 00 00 00"
                autoComplete="tel"
              />
            </label>

            <label className={`${styles.label} ${styles.col3} ${styles.fMail}`}>
              <span>{i18nT("mail_92379cbb")}</span>
              <input
                className={styles.input}
                value={draft.email}
                onChange={(e) => setDraft((s) => ({ ...s, email: e.target.value }))}
                placeholder="marie@exemple.fr"
                autoComplete="email"
              />
            </label>

            <label className={`${styles.label} ${styles.col2} ${styles.fCategory}`}>
              <span>{i18nT("categorie_6b38300a")}</span>
              <select className={styles.select} value={draft.category} onChange={(e) => setDraft((s) => ({ ...s, category: e.target.value as Category }))}>
                <option value="">—</option>
                <option value="particulier">{i18nT("particulier_281680dd")}</option>
                <option value="professionnel">{i18nT("professionnel_aec80314")}</option>
                <option value="collectivite_publique">{i18nT("institution_429f9450")}</option>
              </select>
            </label>

            <label className={`${styles.label} ${styles.col2} ${styles.fType}`}>
              <span>{i18nT("type_3deb7456")}</span>
              <select className={styles.select} value={draft.contact_type} onChange={(e) => setDraft((s) => ({ ...s, contact_type: e.target.value as ContactType }))}>
                <option value="">—</option>
                <option value="client">{i18nT("client_1bdd79b1")}</option>
                <option value="prospect">{i18nT("prospect_99b3f65c")}</option>
                <option value="fournisseur">{i18nT("fournisseur_97d91d89")}</option>
                <option value="partenaire">{i18nT("partenaire_d727d03b")}</option>
                <option value="autre">{i18nT("autre_43dacf9e")}</option>
              </select>
            </label>

            <label className={`${styles.label} ${styles.col2} ${styles.fSiren}`}>
              <span>SIREN</span>
              <input className={styles.input} value={draft.siret} onChange={(e) => setDraft((s) => ({ ...s, siret: e.target.value }))} placeholder="123 456 789" inputMode="numeric" />
            </label>

            <label className={`${styles.label} ${styles.col2} ${styles.fVat}`}>
              <span>TVA</span>
              <input className={styles.input} value={draft.vat_number} onChange={(e) => setDraft((s) => ({ ...s, vat_number: e.target.value }))} placeholder="FR12345678901" />
            </label>

            <label className={`${styles.label} ${styles.col2} ${styles.modalImportantField} ${styles.fImportant}`}>
              <span>{i18nT("important_4b6d6a30")}</span>
              <button
                type="button"
                className={styles.starToggle}
                onClick={onToggleImportant}
                aria-pressed={draft.important ? "true" : "false"}
                title={draft.important ? "Contact important" : "Marquer comme important"}
              >
                {draft.important ? "★" : "☆"}
              </button>
            </label>

            <label className={`${styles.label} ${styles.col5} ${styles.fAddress}`}>
              <span>{i18nT("adresse_principale_b7ab7b05")}</span>
              <input className={styles.input} value={draft.address} onChange={(e) => updatePrimaryAddress(e.target.value)} placeholder={i18nT("12_rue_95da8eca")} autoComplete="street-address" />
            </label>

            <label className={`${styles.label} ${styles.col2} ${styles.fCity}`}>
              <span>{i18nT("ville_97217611")}</span>
              <input className={styles.input} value={draft.city} onChange={(e) => setDraft((s) => ({ ...s, city: e.target.value }))} placeholder={i18nT("paris_22390ad1")} autoComplete="address-level2" />
            </label>

            <label className={`${styles.label} ${styles.col2} ${styles.fCP}`}>
              <span>CP</span>
              <input className={styles.input} value={draft.postal_code} onChange={(e) => setDraft((s) => ({ ...s, postal_code: e.target.value }))} placeholder="75000" inputMode="numeric" autoComplete="postal-code" />
            </label>

            <label className={`${styles.label} ${styles.col3} ${styles.sameAddressField}`}>
              <span>{i18nT("adresse_de_livraison_31eac756")}</span>
              <label className={styles.sameAddressCheck}>
                <input type="checkbox" checked={deliverySameAsPrimary} onChange={(e) => setDeliverySameAsPrimary(e.target.checked)} />
                <span>{i18nT("identique_11720f37")}</span>
              </label>
            </label>

            <label className={`${styles.label} ${styles.col12} ${styles.fNotes}`}>
              <span>{i18nT("notes_70440046")}</span>
              <textarea className={styles.textarea} value={draft.notes} onChange={(e) => setDraft((s) => ({ ...s, notes: e.target.value }))} placeholder={i18nT("notes_internes_1a81fb4e")} />
            </label>
          </div>
        )}

        <div className={styles.modalFooter}>
          <button type="button" className={styles.ghostBtn} onClick={() => void confirmExit()}>
            {i18nT("annuler_49ba3292")}{" "}</button>
          <button type="button" className={styles.primaryBtn} onClick={onSave} disabled={saving}>
            {editingId ? i18nT("mettre_a_jour_e97e6c66") : i18nT("ajouter_87c57ed1")}
          </button>
        </div>
      </div>
    </div>
  );
}
