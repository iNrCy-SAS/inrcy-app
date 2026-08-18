"use client";

import { useTranslations } from "next-intl";


import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabaseClient";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy, promptInrcy } from "@/lib/inrcyDialog";
import styles from "../../_documents/documents.module.css";
import dash from "../../dashboard.module.css";
import SettingsDrawer from "../../SettingsDrawer";
import DocumentsSettingsContent from "../../settings/_components/DocumentsSettingsContent";
import {
  INRDOCUMENTS_SETTINGS_UPDATED_EVENT,
  InrDocumentsSettings,
  dateWithAddedDays,
  makeDefaultLine,
  normalizeInrDocumentsSettings,
} from "@/lib/inrdocumentsSettings";
import {
  DocRecord,
  LineItem,
  calcLineHT,
  calcTotalsWithDiscount,
  DiscountKind,
  generateNumber,
  uid,
} from "../../_documents/docUtils";
import {
  cloneDocumentLines,
  hasReusableDocumentLine,
  prepareTemplateSnapshot,
} from "../../_documents/documentTemplateUtils";
import { printWithIosSafariScale } from "../../_documents/printUtils";
import { DocumentContactSection } from "../../_documents/DocumentContactSection";
import { DocumentParties } from "../../_documents/DocumentParties";
import {
  NotesAndMentionsSection,
  ServiceDateFields,
} from "../../_documents/DocumentAdvancedSections";
import {
  applyDocumentCrmContact,
  useDocumentClientForm,
  useDocumentClientQueryPrefill,
  useDocumentCrmContactsLoader,
  useDocumentCrmDirectory,
  useDocumentCrmUiState,
  useDocumentLineEditor,
  getDocumentCrmContactLabel,
  useDocumentModalBodyLock,
  useDocumentOutsideClose,
  useDocumentProfileLoader,
  useDocumentProviderPreferences,
  useDocumentSettingsPanel,
} from "../../_documents/useDocumentEditorHooks";
import {
  DocumentDateInput,
  OPERATION_CATEGORY_OPTIONS,
  PAYMENT_METHODS,
  buildFullCrmAddress,
  inferServiceDateMode,
  isValidEmail,
  normalizeClientType,
  splitFrenchAddress,
  type ClientType,
  type CrmContact,
  type Profile,
  type ServiceDateMode,
} from "../../_documents/documentEditorShared";
import {
  DOCUMENT_KIND_OPTIONS,
  VAT_OPTIONS,
  buildInvoicePrintPages,
  getInvoicePrintFooterSpacerMm,
  type InvoiceFieldErrors,
} from "../../_documents/invoiceDocumentEditor";
import {
  buildDocumentMailTexts,
  getDocumentOperationCategoryLabel,
  getDocumentPaymentLabel,
  getDocumentStatusLabel,
} from "@/lib/clientCommunication";

export default function NewFacturePage() {
  const i18nT = useTranslations("documents");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const {
    settingsOpen, setSettingsOpen, settingsHasUnsavedChanges,
    setSettingsHasUnsavedChanges, requestCloseSettings,
    documentsSettings, setDocumentsSettings,
  } = useDocumentSettingsPanel();

  // Toujours arriver en haut du module (évite de récupérer le scroll du dashboard)
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo(0, 0);
  }, []);

  // PDF → Supabase Storage (PJ iNrbox)
  const ATTACH_BUCKET = "inrbox_attachments";
  const previewRef = useRef<HTMLDivElement | null>(null);

  const {
    profile, setProfile, clientExchangePreferences, setClientExchangePreferences,
    isEditingProvider, setIsEditingProvider, providerOverride, setProviderOverride,
    vatDispense, providerData, documentClientTexts,
    formatDocumentDate, formatDocumentMoney,
  } = useDocumentProviderPreferences();

  // Orientation: gérée globalement via <OrientationGuard />

  // IMPORTANT: valeur stable SSR/CSR -> on initialise à vide, puis on remplit après mount
  const [number, setNumber] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");

  const {
    clientName, setClientName, clientAddress, setClientAddress,
    clientEmail, setClientEmail, clientSiren, setClientSiren,
    clientVatNumber, setClientVatNumber, clientType, setClientType,
    billingAddress, setBillingAddress, billingPostalCode, setBillingPostalCode,
    billingCity, setBillingCity, deliveryAddress, setDeliveryAddress,
    deliveryPostalCode, setDeliveryPostalCode, deliveryCity, setDeliveryCity,
    sameAddresses, setSameAddresses, operationCategory, setOperationCategory,
    serviceDateMode, setServiceDateMode, serviceDate, setServiceDate,
    servicePeriodStart, setServicePeriodStart, servicePeriodEnd, setServicePeriodEnd,
    updateServiceDateMode, purchaseOrderReference, setPurchaseOrderReference,
    depositKind, setDepositKind, depositValue, setDepositValue,
    billingFullAddress, deliveryFullAddress, setPrimaryClientAddress,
    discountKind, setDiscountKind, discountValue, setDiscountValue,
    discountDetails, setDiscountDetails,
  } = useDocumentClientForm();

  const [vatOnDebits, setVatOnDebits] = useState(false);
  const [lateFeeRate, setLateFeeRate] = useState("");
  const [fixedRecoveryFee40, setFixedRecoveryFee40] = useState(true);
  const [documentKind, setDocumentKind] =
    useState<(typeof DOCUMENT_KIND_OPTIONS)[number]["key"]>("invoice");

  // --- CRM: import d'un contact pour pré-remplir automatiquement
  const {
    crmContacts, setCrmContacts, crmLoading, setCrmLoading,
    crmError, setCrmError, selectedCrmContactId, setSelectedCrmContactId,
    formMessage, setFormMessage, crmActionMessage, setCrmActionMessage,
    fieldErrors, setFieldErrors, addingToCrm, setAddingToCrm,
    currentSaveId, setCurrentSaveId, crmOpen, setCrmOpen,
    advancedOpen, setAdvancedOpen, crmQuery, setCrmQuery,
    crmContainerRef: crmSelectRef,
  } = useDocumentCrmUiState<InvoiceFieldErrors>();

  const { filteredCrmContacts, selectedCrmLabel } =
    useDocumentCrmDirectory({
      contacts: crmContacts,
      query: crmQuery,
      selectedContactId: selectedCrmContactId,
      normalizeSortLabel: false,
    });

  useDocumentClientQueryPrefill(searchParams, {
    setClientName,
    setClientAddress,
    setClientEmail,
    setClientSiren,
    setClientVatNumber,
    setBillingAddress,
    setBillingPostalCode,
    setBillingCity,
    setDeliveryAddress,
    setDeliveryPostalCode,
    setDeliveryCity,
  });

  useDocumentCrmContactsLoader({
    setContacts: setCrmContacts,
    setLoading: setCrmLoading,
    setError: setCrmError,
  });

  const applyCrmContact = (contact: CrmContact) =>
    applyDocumentCrmContact(
      contact,
      {
        setClientName,
        setClientEmail,
        setClientSiren,
        setClientVatNumber,
        setClientType,
        setBillingAddress,
        setBillingPostalCode,
        setBillingCity,
        setClientAddress,
        setSameAddresses,
        setDeliveryAddress,
        setDeliveryPostalCode,
        setDeliveryCity,
      },
      "",
    );

  useDocumentOutsideClose({
    active: crmOpen,
    containerRef: crmSelectRef,
    setOpen: setCrmOpen,
    eventTarget: "document",
    attachWhenInactive: true,
  });

  const selectCrmContact = (c: CrmContact) => {
    setSelectedCrmContactId(String(c.id));
    applyCrmContact(c);
    setFieldErrors((prev) => ({
      ...prev,
      clientType: undefined,
      clientName: undefined,
      billingAddress: undefined,
      billingPostalCode: undefined,
      billingCity: undefined,
      clientEmail: undefined,
      clientSiren: undefined,
    }));
    setCrmQuery("");
    setCrmOpen(false);
  };

  const [status, setStatus] = useState<
    DocRecord["status"] | "en_attente_paiement" | ""
  >("");

  const [paymentMethod, setPaymentMethod] =
    useState<(typeof PAYMENT_METHODS)[number]["key"]>("");

  const [paymentDetails, setPaymentDetails] = useState("");
  const [notes, setNotes] = useState("");
  const [invoiceMention, setInvoiceMention] = useState("");

  // IMPORTANT: id stable au 1er render
  const { lines, setLines, addLine, removeLine, updateLine, clearFieldError } =
    useDocumentLineEditor<InvoiceFieldErrors>({
      vatDispense,
      initialUnitPrice: 120,
      setFieldErrors,
    });

  const applyDocumentDefaults = (settings: InrDocumentsSettings) => {
    setOperationCategory(
      settings.common
        .operationCategory as (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"],
    );
    setDepositKind(settings.common.depositKind);
    setDepositValue(
      settings.common.depositKind ? settings.common.depositValue : "",
    );
    setVatOnDebits(settings.invoice.vatOnDebits);
    setLateFeeRate(settings.invoice.lateFeeRate);
    setFixedRecoveryFee40(settings.invoice.fixedRecoveryFee40);
    setDocumentKind(
      settings.invoice
        .documentKind as (typeof DOCUMENT_KIND_OPTIONS)[number]["key"],
    );
    setStatus(
      settings.invoice.status as
        | DocRecord["status"]
        | "en_attente_paiement"
        | "",
    );
    setPaymentMethod(
      settings.common.paymentMethod as (typeof PAYMENT_METHODS)[number]["key"],
    );
    setPaymentDetails(settings.common.paymentDetails);
    setNotes(settings.common.notes);
    setInvoiceMention(settings.invoice.mention);
    setDueDate(
      dateWithAddedDays(
        invoiceDate || new Date().toISOString().slice(0, 10),
        settings.invoice.dueDays,
      ),
    );
    setLines([makeDefaultLine(settings, vatDispense, 120)]);
  };

  useEffect(() => {
    let cancelled = false;
    const shouldApplyDefaults = !(
      searchParams.get("saveId") ||
      searchParams.get("docSaveId") ||
      searchParams.get("fromDevisSaveId") ||
      searchParams.get("devisSaveId")
    );

    const loadSettings = async (applyDefaults: boolean) => {
      const response = await fetch("/api/documents/settings", {
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) return;
      const nextSettings = normalizeInrDocumentsSettings(json?.settings);
      if (cancelled) return;
      setDocumentsSettings(nextSettings);
      if (applyDefaults) applyDocumentDefaults(nextSettings);
    };

    void loadSettings(shouldApplyDefaults);

    const onUpdated = () => {
      void loadSettings(true);
    };

    window.addEventListener(INRDOCUMENTS_SETTINGS_UPDATED_EVENT, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(
        INRDOCUMENTS_SETTINGS_UPDATED_EVENT,
        onUpdated,
      );
    };
  }, [searchParams]);

  // Init client-only (évite mismatch SSR/CSR)
  useEffect(() => {
    // Numéro + dates
    setNumber(generateNumber("FAC"));

    const d = new Date();
    setInvoiceDate(d.toISOString().slice(0, 10));

    const dd = new Date();
    dd.setDate(dd.getDate() + 30);
    setDueDate(dd.toISOString().slice(0, 10));
  }, []);

  useDocumentProfileLoader({
    supabase,
    setProfile,
    setClientExchangePreferences,
  });

  const totals = useMemo(
    () =>
      calcTotalsWithDiscount(
        lines,
        vatDispense,
        discountKind ? (discountKind as DiscountKind) : null,
        discountValue,
      ),
    [lines, vatDispense, discountKind, discountValue],
  );

  // --- Sauvegardes (brouillons locaux)
  type FactureDraft = {
    id: string;
    updatedAtISO: string;
    name?: string | null;
    snapshot: {
      number: string;
      invoiceDate: string;
      dueDate: string;
      clientName: string;
      clientAddress: string;
      billingAddress?: string;
      billingPostalCode?: string;
      billingCity?: string;
      deliveryAddress?: string;
      deliveryPostalCode?: string;
      deliveryCity?: string;
      sameAddresses?: boolean;
      providerOverride?: Partial<Profile>;
      clientEmail: string;
      clientSiren?: string;
      clientVatNumber?: string;
      clientType?: ClientType;
      vatDispense?: boolean;
      operationCategory?: (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"];
      serviceDateMode?: ServiceDateMode;
      serviceDate?: string;
      servicePeriodStart?: string;
      servicePeriodEnd?: string;
      purchaseOrderReference?: string;
      depositKind?: "" | "percent" | "amount";
      depositValue?: string;
      vatOnDebits?: boolean;
      lateFeeRate?: string;
      fixedRecoveryFee40?: boolean;
      documentKind?: (typeof DOCUMENT_KIND_OPTIONS)[number]["key"];
      status: DocRecord["status"];
      paymentMethod: (typeof PAYMENT_METHODS)[number]["key"];
      paymentDetails: string;
      notes: string;
      invoiceMention?: string;
      lines: LineItem[];
      discountKind: DiscountKind | "";
      discountValue: number;
      discountDetails: string;
      isFinalized?: boolean;
      finalizedAt?: string | null;
      lockedAt?: string | null;
      officialNumberAssignedAt?: string | null;
      officialSequenceYear?: number | null;
      officialSequenceValue?: number | null;
      isTemplate?: boolean;
      templateName?: string | null;
    };
  };

  type DevisSnapshot = {
    number: string;
    docDateISO: string;
    clientName: string;
    clientAddress: string;
    billingAddress?: string;
    billingPostalCode?: string;
    billingCity?: string;
    deliveryAddress?: string;
    deliveryPostalCode?: string;
    deliveryCity?: string;
    sameAddresses?: boolean;
    clientEmail: string;
    clientSiren?: string;
    clientVatNumber?: string;
    vatDispense?: boolean;
    operationCategory?: (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"];
    serviceDateMode?: ServiceDateMode;
    serviceDate?: string;
    servicePeriodStart?: string;
    servicePeriodEnd?: string;
    purchaseOrderReference?: string;
    depositKind?: "" | "percent" | "amount";
    depositValue?: string;
    paymentMethod?: (typeof PAYMENT_METHODS)[number]["key"];
    paymentDetails?: string;
    notes?: string;
    quoteMention?: string;
    validityDays: number;
    lines: LineItem[];
    discountKind: DiscountKind | "";
    discountValue: number;
    discountDetails: string;
  };

  const SAVES_TYPE = "facture" as const;
  type DocumentsTab = "saves" | "templates";

  const [draftsOpen, setDraftsOpen] = useState(false);
  const [documentsTab, setDocumentsTab] = useState<DocumentsTab>("saves");
  const [drafts, setDrafts] = useState<FactureDraft[]>([]);
  const [templates, setTemplates] = useState<FactureDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [isFinalized, setIsFinalized] = useState(false);
  const [finalizedAt, setFinalizedAt] = useState<string>("");
  const [finalizing, setFinalizing] = useState(false);
  const coreEditingLocked = isFinalized;

  useDocumentModalBodyLock(draftsOpen);

  const refreshSaves = async () => {
    setDraftsLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("doc_saves")
        .select("id,updated_at,name,payload")
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .eq("type", SAVES_TYPE)
        .order("updated_at", { ascending: false });

      if (error) throw error;

      const mapped: FactureDraft[] = (data ?? []).map((row: any) => ({
        id: row.id,
        updatedAtISO: row.updated_at,
        name: row.name,
        snapshot: row.payload ?? {},
      }));

      setDrafts(mapped.filter((item) => !item.snapshot?.isTemplate));
      setTemplates(mapped.filter((item) => !!item.snapshot?.isTemplate));
    } catch (e) {
      console.error(e);
    } finally {
      setDraftsLoading(false);
    }
  };

  useEffect(() => {
    void refreshSaves();
  }, []);

  const applyDraftSnapshot = (s: FactureDraft["snapshot"]) => {
    const legacyBilling = splitFrenchAddress(
      s.billingAddress || s.clientAddress || "",
    );
    const nextBillingAddress = legacyBilling.address;
    const nextBillingPostalCode =
      (s as any).billingPostalCode || legacyBilling.postal_code;
    const nextBillingCity = (s as any).billingCity || legacyBilling.city;
    const nextBillingFullAddress = buildFullCrmAddress(
      nextBillingAddress,
      nextBillingPostalCode,
      nextBillingCity,
    );
    const legacyDelivery = splitFrenchAddress(
      s.deliveryAddress || nextBillingFullAddress,
    );
    const nextSameAddresses =
      typeof s.sameAddresses === "boolean"
        ? s.sameAddresses
        : !s.deliveryAddress ||
          buildFullCrmAddress(
            legacyDelivery.address,
            (s as any).deliveryPostalCode || legacyDelivery.postal_code,
            (s as any).deliveryCity || legacyDelivery.city,
          ) === nextBillingFullAddress;
    const nextDeliveryAddress = nextSameAddresses
      ? nextBillingAddress
      : legacyDelivery.address;
    const nextDeliveryPostalCode = nextSameAddresses
      ? nextBillingPostalCode
      : (s as any).deliveryPostalCode || legacyDelivery.postal_code;
    const nextDeliveryCity = nextSameAddresses
      ? nextBillingCity
      : (s as any).deliveryCity || legacyDelivery.city;

    setNumber(s.number);
    setInvoiceDate(s.invoiceDate);
    setDueDate(s.dueDate);
    setClientName(s.clientName);
    setClientAddress(nextBillingFullAddress);
    setBillingAddress(nextBillingAddress);
    setBillingPostalCode(nextBillingPostalCode);
    setBillingCity(nextBillingCity);
    setDeliveryAddress(nextDeliveryAddress);
    setDeliveryPostalCode(nextDeliveryPostalCode);
    setDeliveryCity(nextDeliveryCity);
    setSameAddresses(nextSameAddresses);
    setProviderOverride((s.providerOverride || {}) as Partial<Profile>);
    setIsEditingProvider(false);
    setClientEmail(s.clientEmail);
    setClientSiren(s.clientSiren || "");
    setClientVatNumber(s.clientVatNumber || "");
    setClientType(normalizeClientType((s as any).clientType));
    setOperationCategory(
      (s.operationCategory as (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"]) ||
        "",
    );
    const nextServiceDateMode = inferServiceDateMode(s);
    setServiceDateMode(nextServiceDateMode);
    setServiceDate(nextServiceDateMode === "single" ? s.serviceDate || "" : "");
    setServicePeriodStart(
      nextServiceDateMode === "period" ? s.servicePeriodStart || "" : "",
    );
    setServicePeriodEnd(
      nextServiceDateMode === "period" ? s.servicePeriodEnd || "" : "",
    );
    setPurchaseOrderReference(s.purchaseOrderReference || "");
    setDepositKind((s.depositKind as "" | "percent" | "amount") || "");
    setDepositValue(s.depositValue || "");
    setVatOnDebits(!!s.vatOnDebits);
    setLateFeeRate(s.lateFeeRate || "");
    setFixedRecoveryFee40(
      typeof s.fixedRecoveryFee40 === "boolean" ? s.fixedRecoveryFee40 : true,
    );
    setDocumentKind(
      (s.documentKind as (typeof DOCUMENT_KIND_OPTIONS)[number]["key"]) ||
        "invoice",
    );
    setStatus(s.status);
    setPaymentMethod(s.paymentMethod);
    setPaymentDetails(s.paymentDetails);
    setNotes(s.notes);
    setInvoiceMention(
      s.invoiceMention || documentsSettings.invoice.mention || "",
    );
    setLines(s.lines);
    setDiscountKind(s.discountKind);
    setDiscountValue(s.discountValue);
    setDiscountDetails(s.discountDetails || "");
    setIsFinalized(!!s.isFinalized);
    setFinalizedAt(typeof s.finalizedAt === "string" ? s.finalizedAt : "");
  };

  useEffect(() => {
    const saveId =
      searchParams.get("saveId") || searchParams.get("docSaveId") || "";
    if (!saveId) return;

    let cancelled = false;

    const loadRequestedSave = async () => {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user) return;

      const { data, error } = await supabase
        .from("doc_saves")
        .select("id,payload")
        .eq("id", saveId)
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .eq("type", SAVES_TYPE)
        .maybeSingle();

      if (error) {
        console.error(error);
        if (!cancelled)
          setFormMessage({
            type: "error",
            text: i18nT("impossible_de_reouvrir_cette_facture_b35f4a6b"),
          });
        return;
      }

      if (!data?.payload) {
        if (!cancelled)
          setFormMessage({ type: "error", text: i18nT("facture_introuvable_ab2a4359") });
        return;
      }

      if (!cancelled) {
        applyDraftSnapshot(data.payload as FactureDraft["snapshot"]);
        setCurrentSaveId(data.id);
        setFormMessage({
          type: "success",
          text: i18nT("facture_reouverte_depuis_inrsend_d05c29b9"),
        });
      }
    };

    void loadRequestedSave();

    return () => {
      cancelled = true;
    };
  }, [searchParams, supabase]);

  useEffect(() => {
    const existingSaveId =
      searchParams.get("saveId") || searchParams.get("docSaveId") || "";
    if (existingSaveId) return;

    const devisSaveId =
      searchParams.get("fromDevisSaveId") ||
      searchParams.get("devisSaveId") ||
      "";
    if (!devisSaveId) return;

    let cancelled = false;

    const loadDevisForConversion = async () => {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user) return;

      const { data, error } = await supabase
        .from("doc_saves")
        .select("id,payload")
        .eq("id", devisSaveId)
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .eq("type", "devis")
        .maybeSingle();

      if (error) {
        console.error(error);
        if (!cancelled)
          setFormMessage({
            type: "error",
            text: i18nT("impossible_de_charger_ce_devis_pour_37592632"),
          });
        return;
      }

      const devis = data?.payload as DevisSnapshot | undefined;
      if (!devis) {
        if (!cancelled)
          setFormMessage({
            type: "error",
            text: i18nT("devis_introuvable_pour_la_conversion_b075b89b"),
          });
        return;
      }

      const now = new Date();
      const invoiceDateISO = now.toISOString().slice(0, 10);
      const dueDateISO = dateWithAddedDays(
        invoiceDateISO,
        documentsSettings.invoice.dueDays,
      );

      if (!cancelled) {
        setCurrentSaveId("");
        setIsFinalized(false);
        setFinalizedAt("");
        setNumber(generateNumber("FAC"));
        setInvoiceDate(invoiceDateISO);
        setDueDate(dueDateISO);
        const legacyBilling = splitFrenchAddress(
          devis.billingAddress || devis.clientAddress || "",
        );
        const nextBillingAddress = legacyBilling.address;
        const nextBillingPostalCode =
          (devis as any).billingPostalCode || legacyBilling.postal_code;
        const nextBillingCity =
          (devis as any).billingCity || legacyBilling.city;
        const nextBillingFullAddress = buildFullCrmAddress(
          nextBillingAddress,
          nextBillingPostalCode,
          nextBillingCity,
        );
        const legacyDelivery = splitFrenchAddress(
          devis.deliveryAddress || nextBillingFullAddress,
        );
        const nextSameAddresses =
          typeof devis.sameAddresses === "boolean"
            ? devis.sameAddresses
            : !devis.deliveryAddress ||
              buildFullCrmAddress(
                legacyDelivery.address,
                (devis as any).deliveryPostalCode || legacyDelivery.postal_code,
                (devis as any).deliveryCity || legacyDelivery.city,
              ) === nextBillingFullAddress;
        const nextDeliveryAddress = nextSameAddresses
          ? nextBillingAddress
          : legacyDelivery.address;
        const nextDeliveryPostalCode = nextSameAddresses
          ? nextBillingPostalCode
          : (devis as any).deliveryPostalCode || legacyDelivery.postal_code;
        const nextDeliveryCity = nextSameAddresses
          ? nextBillingCity
          : (devis as any).deliveryCity || legacyDelivery.city;

        setClientName(devis.clientName || "");
        setClientAddress(nextBillingFullAddress);
        setBillingAddress(nextBillingAddress);
        setBillingPostalCode(nextBillingPostalCode);
        setBillingCity(nextBillingCity);
        setDeliveryAddress(nextDeliveryAddress);
        setDeliveryPostalCode(nextDeliveryPostalCode);
        setDeliveryCity(nextDeliveryCity);
        setSameAddresses(nextSameAddresses);
        setClientEmail(devis.clientEmail || "");
        setClientSiren(devis.clientSiren || "");
        setClientVatNumber(devis.clientVatNumber || "");
        setOperationCategory(
          (devis.operationCategory as (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"]) ||
            "",
        );
        const nextServiceDateMode = inferServiceDateMode(devis);
        setServiceDateMode(nextServiceDateMode);
        setServiceDate(
          nextServiceDateMode === "single" ? devis.serviceDate || "" : "",
        );
        setServicePeriodStart(
          nextServiceDateMode === "period"
            ? devis.servicePeriodStart || ""
            : "",
        );
        setServicePeriodEnd(
          nextServiceDateMode === "period" ? devis.servicePeriodEnd || "" : "",
        );
        setPurchaseOrderReference(devis.purchaseOrderReference || "");
        setDepositKind((devis.depositKind as "" | "percent" | "amount") || "");
        setDepositValue(devis.depositValue || "");
        setVatOnDebits(documentsSettings.invoice.vatOnDebits);
        setLateFeeRate(documentsSettings.invoice.lateFeeRate);
        setFixedRecoveryFee40(documentsSettings.invoice.fixedRecoveryFee40);
        setDocumentKind(
          documentsSettings.invoice
            .documentKind as (typeof DOCUMENT_KIND_OPTIONS)[number]["key"],
        );
        setStatus(
          documentsSettings.invoice.status as
            | DocRecord["status"]
            | "en_attente_paiement"
            | "",
        );
        setPaymentMethod(
          ((devis.paymentMethod as (typeof PAYMENT_METHODS)[number]["key"]) ||
            documentsSettings.common
              .paymentMethod) as (typeof PAYMENT_METHODS)[number]["key"],
        );
        setPaymentDetails(
          devis.paymentDetails || documentsSettings.common.paymentDetails,
        );
        setNotes(
          devis.notes ||
            documentsSettings.common.notes ||
            `Facture créée depuis le devis ${devis.number || devisSaveId}.`,
        );
        setInvoiceMention(documentsSettings.invoice.mention);
        setLines(
          Array.isArray(devis.lines) && devis.lines.length
            ? devis.lines.map((line: LineItem, index: number) => ({
                ...line,
                id: line?.id || `l_${index + 1}`,
              }))
            : [
                {
                  id: "l_1",
                  label: i18nT("prestation_b51f479f"),
                  qty: 1,
                  unitPrice: 120,
                  vatRate: vatDispense ? 0 : 20,
                },
              ],
        );
        setDiscountKind(devis.discountKind || "");
        setDiscountValue(Number(devis.discountValue) || 0);
        setDiscountDetails(devis.discountDetails || "");
        setFormMessage({
          type: "success",
          text: i18nT("facture_preremplie_depuis_le_devis_value_dbbc57b2", { value0: devis.number || "sélectionné" }),
        });
      }
    };

    void loadDevisForConversion();

    return () => {
      cancelled = true;
    };
  }, [searchParams, supabase, vatDispense, documentsSettings]);

  const validateInvoiceAction = (options?: { requireEmail?: boolean }) => {
    const nextErrors: InvoiceFieldErrors = {};
    const requireEmail = !!options?.requireEmail;
    const normalizedBillingAddress = buildFullCrmAddress(
      billingAddress,
      billingPostalCode,
      billingCity,
    ).trim();
    const hasValidLine = lines.some(
      (line) =>
        (line.label || "").trim() &&
        Number(line.qty) > 0 &&
        Number(line.unitPrice) >= 0,
    );

    if (!clientType) nextErrors.clientType = "Type de client obligatoire.";
    if (!(clientName || "").trim())
      nextErrors.clientName = "Nom client obligatoire.";
    if (!billingAddress.trim())
      nextErrors.billingAddress = "Adresse obligatoire.";
    if (!billingPostalCode.trim())
      nextErrors.billingPostalCode = "Code postal obligatoire.";
    if (!billingCity.trim()) nextErrors.billingCity = "Ville obligatoire.";
    if (
      clientType &&
      clientType !== "particulier" &&
      !(clientSiren || "").trim()
    )
      nextErrors.clientSiren =
        "SIREN client obligatoire pour ce type de client.";
    if (!(number || "").trim())
      nextErrors.number = "Numéro de facture obligatoire.";
    if (!(invoiceDate || "").trim())
      nextErrors.invoiceDate = "Date de facture obligatoire.";
    if (!(dueDate || "").trim()) nextErrors.dueDate = "Échéance obligatoire.";
    if (clientType && clientType !== "particulier" && !operationCategory) {
      nextErrors.operationCategory =
        "Catégorie d’opération obligatoire pour ce type de client.";
      setAdvancedOpen(true);
    }
    if (!hasValidLine)
      nextErrors.lines =
        "Ajoutez au moins une prestation valide (libellé, quantité et prix HT).";

    const normalizedEmail = (clientEmail || "").trim();
    if (requireEmail) {
      if (!normalizedEmail)
        nextErrors.clientEmail =
          "Email client obligatoire pour envoyer par mail.";
      else if (!isValidEmail(normalizedEmail))
        nextErrors.clientEmail = "Email client invalide.";
    } else if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      nextErrors.clientEmail = "Email client invalide.";
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormMessage(null);
      return false;
    }
    return true;
  };

  const saveDraft = async (options?: { silent?: boolean }) => {
    const nowISO = new Date().toISOString();
    const finalNumber = number || generateNumber("FAC");
    if (!number) setNumber(finalNumber);

    const normalizedEmail = (clientEmail || "").trim();
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      setFieldErrors((prev) => ({
        ...prev,
        clientEmail: "Email client invalide.",
      }));
      setFormMessage(null);
      return null;
    }

    const normalizedBillingAddress = buildFullCrmAddress(
      billingAddress,
      billingPostalCode,
      billingCity,
    );
    const normalizedDeliveryAddress = sameAddresses
      ? normalizedBillingAddress
      : buildFullCrmAddress(deliveryAddress, deliveryPostalCode, deliveryCity);
    const savedServiceDate = serviceDateMode === "single" ? serviceDate : "";
    const savedServicePeriodStart =
      serviceDateMode === "period" ? servicePeriodStart : "";
    const savedServicePeriodEnd =
      serviceDateMode === "period" ? servicePeriodEnd : "";

    const snapshot: FactureDraft["snapshot"] = {
      number: finalNumber,
      invoiceDate: invoiceDate || new Date().toISOString().slice(0, 10),
      dueDate,
      clientName,
      clientAddress: normalizedBillingAddress,
      billingAddress: billingAddress.trim(),
      billingPostalCode: billingPostalCode.trim(),
      billingCity: billingCity.trim(),
      deliveryAddress: sameAddresses
        ? billingAddress.trim()
        : deliveryAddress.trim(),
      deliveryPostalCode: sameAddresses
        ? billingPostalCode.trim()
        : deliveryPostalCode.trim(),
      deliveryCity: sameAddresses ? billingCity.trim() : deliveryCity.trim(),
      sameAddresses,
      providerOverride,
      clientEmail,
      clientSiren,
      clientVatNumber,
      clientType,
      vatDispense,
      operationCategory,
      serviceDateMode,
      serviceDate: savedServiceDate,
      servicePeriodStart: savedServicePeriodStart,
      servicePeriodEnd: savedServicePeriodEnd,
      purchaseOrderReference,
      depositKind,
      depositValue,
      vatOnDebits,
      lateFeeRate,
      fixedRecoveryFee40,
      documentKind,
      status: (status as any) || "brouillon",
      paymentMethod,
      paymentDetails,
      notes,
      invoiceMention,
      lines,
      discountKind,
      discountValue: Number(discountValue) || 0,
      discountDetails,
      isFinalized,
      finalizedAt: finalizedAt || null,
      lockedAt: finalizedAt || null,
    };

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) return;

    const autoName =
      (clientName || "").trim() ||
      (clientEmail || "").trim() ||
      snapshot.number ||
      "Sauvegarde";

    const saveMutation = currentSaveId
      ? supabase
          .from("doc_saves")
          .update({
            name: autoName,
            payload: snapshot,
            updated_at: nowISO,
          })
          .eq("user_id", resolveActiveBrowserUserId(user.id))
          .eq("type", SAVES_TYPE)
          .eq("id", currentSaveId)
      : supabase.from("doc_saves").insert({
          user_id: resolveActiveBrowserUserId(user.id),
          type: SAVES_TYPE,
          name: autoName,
          payload: snapshot,
          updated_at: nowISO,
        });

    const { data: savedRows, error } = await saveMutation.select("id");

    if (error) {
      console.error(error);
      setFormMessage({
        type: "error",
        text: i18nT("impossible_d_enregistrer_cette_facture_pour_cd4c5608"),
      });
      return;
    }

    const savedId =
      (savedRows?.[0] as { id?: string } | undefined)?.id || currentSaveId;
    if (savedId) setCurrentSaveId(savedId);

    await refreshSaves();
    if (!options?.silent) {
      setDocumentsTab("saves");
      setDraftsOpen(true);
      setFormMessage({
        type: "success",
        text: currentSaveId ? "Facture mise à jour." : "Facture enregistrée.",
      });
    }

    return savedId as string | undefined;
  };

  const saveAsTemplate = async () => {
    const hasValidLine = hasReusableDocumentLine(lines);
    if (!hasValidLine) {
      setFieldErrors((prev) => ({
        ...prev,
        lines:
          "Ajoutez au moins une prestation valide avant d’enregistrer un modèle.",
      }));
      setFormMessage(null);
      return;
    }

    const templateName = await promptInrcy({
      title: i18nT("creer_un_modele_082a9b78"),
      message:
        i18nT("donnez_un_nom_a_ce_modele_df1c6b74"),
      defaultValue: "Modèle facture",
      placeholder: i18nT("nom_du_modele_68d49f67"),
      confirmLabel: i18nT("creer_modele_386adb21"),
      required: false,
    });
    if (templateName === null) return;

    const cleanName = templateName.trim() || "Modèle facture";
    const nowISO = new Date().toISOString();
    const savedServiceDate = serviceDateMode === "single" ? serviceDate : "";
    const savedServicePeriodStart =
      serviceDateMode === "period" ? servicePeriodStart : "";
    const savedServicePeriodEnd =
      serviceDateMode === "period" ? servicePeriodEnd : "";
    const snapshot = prepareTemplateSnapshot<FactureDraft["snapshot"]>(
      {
        providerOverride,
        vatDispense,
        operationCategory,
        serviceDateMode,
        serviceDate: savedServiceDate,
        servicePeriodStart: savedServicePeriodStart,
        servicePeriodEnd: savedServicePeriodEnd,
        purchaseOrderReference,
        depositKind,
        depositValue,
        vatOnDebits,
        lateFeeRate,
        fixedRecoveryFee40,
        documentKind,
        paymentMethod,
        paymentDetails,
        notes,
        invoiceMention,
        lines: cloneDocumentLines(lines),
        discountKind,
        discountValue: Number(discountValue) || 0,
        discountDetails,
      },
      cleanName,
    );

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) return;

    const { error } = await supabase.from("doc_saves").insert({
      user_id: resolveActiveBrowserUserId(user.id),
      type: SAVES_TYPE,
      name: cleanName,
      payload: snapshot,
      updated_at: nowISO,
    });

    if (error) {
      console.error(error);
      setFormMessage({
        type: "error",
        text: i18nT("impossible_d_enregistrer_ce_modele_pour_99e1aa63"),
      });
      return;
    }

    await refreshSaves();
    setDocumentsTab("templates");
    setDraftsOpen(true);
    setFormMessage({ type: "success", text: i18nT("modele_de_facture_enregistre_8ed67319") });
  };

  const applyTemplateSnapshot = (s: FactureDraft["snapshot"]) => {
    const now = new Date();
    const invoiceDateISO = now.toISOString().slice(0, 10);

    setCurrentSaveId("");
    setIsFinalized(false);
    setFinalizedAt("");
    setNumber(generateNumber("FAC"));
    setInvoiceDate(invoiceDateISO);
    setDueDate(
      dateWithAddedDays(invoiceDateISO, documentsSettings.invoice.dueDays),
    );

    setOperationCategory(
      (s.operationCategory as (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"]) ||
        (documentsSettings.common
          .operationCategory as (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"]),
    );
    const nextServiceDateMode = inferServiceDateMode(s);
    setServiceDateMode(nextServiceDateMode);
    setServiceDate(nextServiceDateMode === "single" ? s.serviceDate || "" : "");
    setServicePeriodStart(
      nextServiceDateMode === "period" ? s.servicePeriodStart || "" : "",
    );
    setServicePeriodEnd(
      nextServiceDateMode === "period" ? s.servicePeriodEnd || "" : "",
    );
    setPurchaseOrderReference(s.purchaseOrderReference || "");
    setDepositKind(
      (s.depositKind as "" | "percent" | "amount") ||
        documentsSettings.common.depositKind,
    );
    setDepositValue(
      s.depositValue ||
        (documentsSettings.common.depositKind
          ? documentsSettings.common.depositValue
          : ""),
    );
    setVatOnDebits(
      typeof s.vatOnDebits === "boolean"
        ? s.vatOnDebits
        : documentsSettings.invoice.vatOnDebits,
    );
    setLateFeeRate(s.lateFeeRate || documentsSettings.invoice.lateFeeRate);
    setFixedRecoveryFee40(
      typeof s.fixedRecoveryFee40 === "boolean"
        ? s.fixedRecoveryFee40
        : documentsSettings.invoice.fixedRecoveryFee40,
    );
    setDocumentKind(
      (s.documentKind as (typeof DOCUMENT_KIND_OPTIONS)[number]["key"]) ||
        (documentsSettings.invoice
          .documentKind as (typeof DOCUMENT_KIND_OPTIONS)[number]["key"]),
    );
    setStatus(
      documentsSettings.invoice.status as
        | DocRecord["status"]
        | "en_attente_paiement"
        | "",
    );
    setPaymentMethod(
      ((s.paymentMethod as (typeof PAYMENT_METHODS)[number]["key"]) ||
        documentsSettings.common
          .paymentMethod) as (typeof PAYMENT_METHODS)[number]["key"],
    );
    setPaymentDetails(
      s.paymentDetails || documentsSettings.common.paymentDetails,
    );
    setNotes(s.notes || documentsSettings.common.notes);
    setInvoiceMention(s.invoiceMention || documentsSettings.invoice.mention);
    setLines(
      Array.isArray(s.lines) && s.lines.length
        ? s.lines.map((line) => ({ ...line, id: uid("l") }))
        : [makeDefaultLine(documentsSettings, vatDispense, 120)],
    );
    setDiscountKind(s.discountKind || "");
    setDiscountValue(Number(s.discountValue) || 0);
    setDiscountDetails(s.discountDetails || "");
    setFieldErrors({});
    setDraftsOpen(false);
    setFormMessage({
      type: "success",
      text: i18nT("modele_applique_ajoutez_ou_verifiez_le_f1f8dd3d"),
    });
  };

  const addCurrentClientToCrm = async () => {
    const displayName = (clientName || "").trim();
    const email = (clientEmail || "").trim();
    const primaryAddress = buildFullCrmAddress(
      billingAddress,
      billingPostalCode,
      billingCity,
    ).trim();

    setFormMessage(null);
    setCrmActionMessage(null);

    if (!displayName && !email && !primaryAddress) {
      setCrmActionMessage({
        type: "error",
        text: i18nT("renseignez_au_moins_un_nom_un_7b57dac5"),
      });
      return;
    }

    setAddingToCrm(true);
    try {
      const response = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          siret: (clientSiren || "").trim(),
          vat_number: (clientVatNumber || "").trim(),
          email,
          address: (billingAddress || "").trim(),
          postal_code: (billingPostalCode || "").trim(),
          city: (billingCity || "").trim(),
          billing_address: (billingAddress || "").trim(),
          delivery_address: sameAddresses ? "" : (deliveryAddress || "").trim(),
          contact_type: "client",
          category: clientType || "particulier",
          notes: [
            `Ajouté depuis Factures`,
            purchaseOrderReference ? `PO: ${purchaseOrderReference}` : "",
          ]
            .filter(Boolean)
            .join(" — "),
        }),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          getSimpleFrenchErrorMessage(
            json?.error,
            "Impossible d’ajouter ce client au CRM.",
          ),
        );
      }

      setCrmActionMessage({ type: "success", text: i18nT("client_ajoute_au_crm_601a8cb4") });
    } catch (error) {
      setCrmActionMessage({
        type: "error",
        text: getSimpleFrenchErrorMessage(
          error,
          "Impossible d’ajouter ce client au CRM.",
        ),
      });
    } finally {
      setAddingToCrm(false);
    }
  };

  const finalizeInvoice = async (
    docSaveId: string,
    targetStatus:
      | "en_attente_paiement"
      | "envoye"
      | "paye" = "en_attente_paiement",
  ) => {
    setFinalizing(true);
    try {
      const res = await fetch("/api/factures/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docSaveId, targetStatus }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          getSimpleFrenchErrorMessage(
            json?.error,
            "Impossible de figer cette facture pour le moment.",
          ),
        );
      }

      const officialNumber =
        typeof json?.number === "string" && json.number ? json.number : number;
      const nextStatus =
        typeof json?.status === "string" && json.status
          ? (json.status as DocRecord["status"])
          : (targetStatus as DocRecord["status"]) || "en_attente_paiement";
      const nextFinalizedAt =
        typeof json?.finalizedAt === "string"
          ? json.finalizedAt
          : new Date().toISOString();

      setCurrentSaveId(docSaveId);
      setNumber(officialNumber);
      setStatus(nextStatus);
      setIsFinalized(true);
      setFinalizedAt(nextFinalizedAt);
      await refreshSaves();

      return {
        docSaveId,
        number: officialNumber,
        status: nextStatus,
        finalizedAt: nextFinalizedAt,
      };
    } catch (error) {
      const text = getSimpleFrenchErrorMessage(
        error,
        "Impossible de figer cette facture pour le moment.",
      );
      setFormMessage({ type: "error", text });
      return null;
    } finally {
      setFinalizing(false);
    }
  };

  const openDraft = (d: FactureDraft) => {
    applyDraftSnapshot(d.snapshot);
    setCurrentSaveId(d.id);
    setDraftsOpen(false);
  };

  const deleteDraft = async (id: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("doc_saves")
      .delete()
      .eq("user_id", resolveActiveBrowserUserId(user.id))
      .eq("type", SAVES_TYPE)
      .eq("id", id);

    if (currentSaveId === id) setCurrentSaveId("");
    await refreshSaves();
  };

  const print = async () => {
    setIsEditingProvider(false);
    await printWithIosSafariScale(waitForDomUpdate);
  };

  const waitForDomUpdate = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

  const buildPdfBlob = async (): Promise<Blob | null> => {
    if (typeof window === "undefined" || typeof document === "undefined") return null;

    setIsEditingProvider(false);
    await waitForDomUpdate();

    const el = previewRef.current;
    if (!el) return null;

    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const printPages = el.querySelector(`.${styles.documentPrintPages}`) as HTMLElement | null;

    if (printPages) {
      const staging = document.createElement("div");
      staging.className = styles.pdfExportStaging;

      const printPagesClone = printPages.cloneNode(true) as HTMLElement;
      const previewClasses =
        typeof el.className === "string" ? el.className : "";
      printPagesClone.className = `${printPagesClone.className} ${previewClasses}`.trim();
      printPagesClone.removeAttribute("aria-hidden");
      staging.appendChild(printPagesClone);
      document.body.appendChild(staging);

      try {
        await waitForDomUpdate();

        const pageEls = Array.from(
          printPagesClone.querySelectorAll(`.${styles.documentPrintPage}`),
        ) as HTMLElement[];

        if (pageEls.length) {
          for (const [index, pageEl] of pageEls.entries()) {
            const canvas = await html2canvas(pageEl, {
              scale: 2,
              useCORS: true,
              backgroundColor: "#ffffff",
              windowWidth: 794,
              windowHeight: 1123,
            });

            if (index > 0) pdf.addPage();
            pdf.addImage(
              canvas.toDataURL("image/png"),
              "PNG",
              0,
              0,
              pageWidth,
              pageHeight,
            );
          }

          return pdf.output("blob") as Blob;
        }
      } finally {
        staging.remove();
      }
    }

    const hiddenSelector = [
      styles.noPrint,
      styles.printHidden,
      styles.printHiddenCell,
    ]
      .filter(Boolean)
      .map((className) => `.${className}`)
      .join(", ");
    const hiddenEls = hiddenSelector
      ? (Array.from(el.querySelectorAll(hiddenSelector)) as HTMLElement[])
      : [];
    const printOnlyEls = Array.from(
      el.querySelectorAll(`.${styles.printOnly}`),
    ) as HTMLElement[];
    const previousHiddenDisplay = hiddenEls.map((node) => node.style.display);
    const previousPrintOnlyDisplay = printOnlyEls.map(
      (node) => node.style.display,
    );

    hiddenEls.forEach((node) => {
      node.style.display = "none";
    });
    printOnlyEls.forEach((node) => {
      node.style.display = "block";
    });

    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
    } finally {
      hiddenEls.forEach((node, index) => {
        node.style.display = previousHiddenDisplay[index] || "";
      });
      printOnlyEls.forEach((node, index) => {
        node.style.display = previousPrintOnlyDisplay[index] || "";
      });
    }

    const imgData = canvas.toDataURL("image/png");
    const imgProps = (pdf as any).getImageProperties(imgData);
    const imgWidth = pageWidth;
    const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

    let position = 0;
    let heightLeft = imgHeight;

    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    return pdf.output("blob") as Blob;
  };

  const uploadPdfAndOpenCompose = async (to: string, filename?: string) => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      setFormMessage({
        type: "error",
        text: i18nT("vous_devez_etre_connecte_pour_envoyer_0bc75018"),
      });
      return;
    }

    const docSaveId = await saveDraft({ silent: true });
    if (!docSaveId) {
      setFormMessage({
        type: "error",
        text: i18nT("veuillez_d_abord_sauvegarder_cette_facture_a29af67f"),
      });
      return;
    }

    const mailFinalizeStatus = status === "paye" ? "paye" : "envoye";
    const finalized = await finalizeInvoice(docSaveId, mailFinalizeStatus);
    if (!finalized) return;

    const officialNumber = finalized.number || number || generateNumber("FAC");
    if (!number || number !== officialNumber) setNumber(officialNumber);
    await waitForDomUpdate();

    const pdfBlob = await buildPdfBlob();
    if (!pdfBlob) {
      setFormMessage({
        type: "error",
        text: i18nT("impossible_de_generer_le_pdf_de_dda266e5"),
      });
      return;
    }

    const rawFilename =
      filename && filename.trim() ? filename : `${officialNumber}.pdf`;
    const safeName = rawFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${resolveActiveBrowserUserId(user.id)}/factures/${Date.now()}_${safeName}`;

    const { error: upErr } = await supabase.storage
      .from(ATTACH_BUCKET)
      .upload(key, pdfBlob, { contentType: "application/pdf", upsert: true });

    if (upErr) {
      console.error(upErr);
      setFormMessage({
        type: "error",
        text: i18nT("impossible_de_preparer_cette_facture_pour_374a080b"),
      });
      return;
    }

    const params = new URLSearchParams();
    params.set("compose", "1");
    params.set("to", to);
    params.set("attachKey", key);
    params.set("attachName", safeName);
    if (clientName?.trim()) params.set("clientName", clientName.trim());
    params.set("type", "facture");
    params.set("docSaveId", docSaveId);
    params.set("docType", "facture");
    params.set("docNumber", officialNumber || safeName.replace(/\.pdf$/i, ""));
    const mailTexts = buildDocumentMailTexts(
      "facture",
      clientExchangePreferences,
      clientName,
      officialNumber || safeName.replace(/\.pdf$/i, ""),
    );
    params.set("subject", mailTexts.subject);
    params.set("text", mailTexts.text);
    router.push(`/dashboard/mails?${params.toString()}`);
  };

  const paymentLabel = getDocumentPaymentLabel(clientExchangePreferences.clientLanguage, paymentMethod);
  const operationCategoryLabel = getDocumentOperationCategoryLabel(clientExchangePreferences.clientLanguage, operationCategory);
  const documentStatusLabel = getDocumentStatusLabel(clientExchangePreferences.clientLanguage, status);
  const documentTitle =
    documentKind === "deposit"
      ? documentClientTexts.titles.depositInvoice
      : documentKind === "credit_note"
        ? documentClientTexts.titles.creditNote
        : documentClientTexts.titles.invoice;

  const documentDesign = documentsSettings.common.design;
  const previewClassName = [
    styles.preview,
    documentDesign.preset === "business" ? styles.previewDesignBusiness : "",
    documentDesign.preset === "encadre" ? styles.previewDesignEncadre : "",
    documentDesign.preset === "signature" ? styles.previewDesignSignature : "",
    documentDesign.frame ? styles.previewFrame : "",
    documentDesign.coloredTotals ? styles.previewColoredTotals : "",
    documentDesign.coloredParties ? styles.previewColoredParties : "",
    documentDesign.accentColor === "violet" ? styles.previewAccentViolet : "",
    documentDesign.accentColor === "orange" ? styles.previewAccentOrange : "",
    documentDesign.accentColor === "green" ? styles.previewAccentGreen : "",
    documentDesign.accentColor === "gray" ? styles.previewAccentGray : "",
    documentDesign.accentColor === "rose" ? styles.previewAccentRose : "",
    documentDesign.accentColor === "teal" ? styles.previewAccentTeal : "",
    documentDesign.accentColor === "gold" ? styles.previewAccentGold : "",
    documentDesign.accentColor === "blue" ? styles.previewAccentBlue : "",
  ]
    .filter(Boolean)
    .join(" ");
  const invoicePrintPages = buildInvoicePrintPages(lines);

  return (
    <div className={`${dash.page} ${styles.editorPage}`}>
      <div className={styles.container}>
        {/* Formulaire */}
        <div className={styles.panel}>
          <div className={styles.panelToolbar}>
            <h1 className={styles.titleBadge}>{i18nT("creer_une_facture_13a9becd")}</h1>
            <button
              type="button"
              className={`${styles.closeBtn} ${styles.toolbarBtn}`}
              onClick={() => {
                void refreshSaves();
                setDocumentsTab("saves");
                setDraftsOpen(true);
              }}
            >
              {i18nT("documents_687c8286")}{" "}</button>
            <button
              type="button"
              className={`${styles.closeBtn} ${styles.toolbarBtn}`}
              onClick={async () => {
                const ok = await confirmInrcy({
                  eyebrow: i18nT("document_en_cours_7ee793c2"),
                  title: i18nT("reinitialiser_la_facture_56100e12"),
                  message:
                    i18nT("cette_action_supprimera_la_saisie_actuelle_336136f8"),
                  cancelLabel: i18nT("annuler_49ba3292"),
                  confirmLabel: i18nT("reinitialiser_e0e2ad54"),
                  variant: "danger",
                });
                if (!ok) return;

                setSelectedCrmContactId("");
                setCrmOpen(false);
                setFieldErrors({});
                setFormMessage(null);

                setClientName("");
                setClientEmail("");
                setClientSiren("");
                setClientVatNumber("");
                setClientType("");
                setClientAddress("");
                setBillingAddress("");
                setDeliveryAddress("");
                setSameAddresses(true);
                setOperationCategory(
                  documentsSettings.common
                    .operationCategory as (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"],
                );
                setServiceDateMode("single");
                setServiceDate("");
                setServicePeriodStart("");
                setServicePeriodEnd("");
                setPurchaseOrderReference("");
                setDepositKind(documentsSettings.common.depositKind);
                setDepositValue(
                  documentsSettings.common.depositKind
                    ? documentsSettings.common.depositValue
                    : "",
                );
                setVatOnDebits(documentsSettings.invoice.vatOnDebits);
                setLateFeeRate(documentsSettings.invoice.lateFeeRate);
                setFixedRecoveryFee40(
                  documentsSettings.invoice.fixedRecoveryFee40,
                );
                setDocumentKind(
                  documentsSettings.invoice
                    .documentKind as (typeof DOCUMENT_KIND_OPTIONS)[number]["key"],
                );

                setCurrentSaveId("");
                setIsFinalized(false);
                setFinalizedAt("");
                setNumber(generateNumber("FAC"));
                const d = new Date();
                const invoiceDateISO = d.toISOString().slice(0, 10);
                setInvoiceDate(invoiceDateISO);
                setDueDate(
                  dateWithAddedDays(
                    invoiceDateISO,
                    documentsSettings.invoice.dueDays,
                  ),
                );

                setStatus(
                  documentsSettings.invoice.status as
                    | DocRecord["status"]
                    | "en_attente_paiement"
                    | "",
                );
                setPaymentMethod(
                  documentsSettings.common
                    .paymentMethod as (typeof PAYMENT_METHODS)[number]["key"],
                );
                setPaymentDetails(documentsSettings.common.paymentDetails);
                setNotes(documentsSettings.common.notes);
                setInvoiceMention(documentsSettings.invoice.mention);

                setDiscountKind("");
                setDiscountValue(0);
                setDiscountDetails("");

                setLines([
                  makeDefaultLine(documentsSettings, vatDispense, 120),
                ]);
              }}
            >
              {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
            <button
              type="button"
              className={`${styles.closeBtn} ${styles.toolbarBtn} ${styles.switchBtnDevis}`}
              onClick={() => router.push("/dashboard/devis/new")}
            >
              {i18nT("devis_f7622f90")}{" "}</button>
            <button
              type="button"
              className={`${styles.closeBtn} ${styles.toolbarBtn}`}
              onClick={() => setSettingsOpen(true)}
            >
              {i18nT("reglages_00d63297")}{" "}</button>
            <button
              type="button"
              className={`${styles.closeBtn} ${styles.toolbarBtn}`}
              onClick={() => router.push("/dashboard")}
            >
              {i18nT("fermer_5ab4ec64")}{" "}</button>
          </div>

          <SettingsDrawer
            title={i18nT("reglages_par_defaut_6d661a73")}
            isOpen={settingsOpen}
            onClose={requestCloseSettings}
            closeOnBackdrop={false}
            closeOnEscape={false}
          >
            <DocumentsSettingsContent onUnsavedChange={setSettingsHasUnsavedChanges} />
          </SettingsDrawer>

          {isFinalized ? (
            <div
              style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 12,
                background: "rgba(34,197,94,0.12)",
                border: "1px solid rgba(34,197,94,0.35)",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {i18nT("facture_figee_avec_le_numero_officiel_2db76fbb")}{" "}
              <strong>{number || "—"}</strong>
              {finalizedAt ? (
                <> {" "}{i18nT("figee_le_a93d8a93")}{" "}{new Date(finalizedAt).toLocaleString("fr-FR")}</>
              ) : null}
            </div>
          ) : null}

          {draftsOpen ? (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                zIndex: 9999,
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                padding: "clamp(12px, 4vh, 32px) 16px",
                overflowY: "auto",
              }}
              onClick={() => setDraftsOpen(false)}
            >
              <div
                style={{
                  width: "min(720px, 100%)",
                  maxWidth: "calc(100vw - 32px)",
                  boxSizing: "border-box",
                  maxHeight: "min(86vh, 860px)",
                  overflowY: "auto",
                  overflowX: "hidden",
                  overscrollBehavior: "contain",
                  WebkitOverflowScrolling: "touch",
                  background: "#111",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 16,
                  padding: 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    padding: "14px 14px 10px",
                    background: "#111",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div style={{ fontWeight: 750, fontSize: 16 }}>{i18nT("documents_687c8286")}</div>
                  <button
                    type="button"
                    className={styles.closeBtn}
                    onClick={() => setDraftsOpen(false)}
                  >
                    {i18nT("fermer_5ab4ec64")}{" "}</button>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    padding: "10px 14px",
                    background: "#111",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    position: "sticky",
                    top: 52,
                    zIndex: 2,
                  }}
                >
                  <button
                    type="button"
                    className={
                      documentsTab === "saves"
                        ? styles.primaryBtn
                        : styles.ghostBtn
                    }
                    onClick={() => setDocumentsTab("saves")}
                  >
                    {i18nT("sauvegardes_64fb00cd")}{" "}</button>
                  <button
                    type="button"
                    className={
                      documentsTab === "templates"
                        ? styles.primaryBtn
                        : styles.ghostBtn
                    }
                    onClick={() => setDocumentsTab("templates")}
                  >
                    {i18nT("modeles_0f7183be")}{" "}</button>
                </div>

                {documentsTab === "saves" ? (
                  drafts.length === 0 ? (
                    <div style={{ padding: 14, opacity: 0.85 }}>
                      {i18nT("aucune_facture_sauvegardee_eb99154a")}{" "}</div>
                  ) : (
                    <div
                      style={{
                        padding: 14,
                        minWidth: 0,
                        overflowX: "hidden",
                        display: "grid",
                        gap: 10,
                        maxHeight: drafts.length > 10 ? "62vh" : undefined,
                        overflowY: drafts.length > 10 ? "auto" : undefined,
                        paddingRight: drafts.length > 10 ? 8 : 14,
                      }}
                    >
                      {drafts.map((d) => {
                        const label = d.snapshot.number || "(Sans numéro)";
                        const who = d.snapshot.clientName?.trim()
                          ? ` — ${d.snapshot.clientName.trim()}`
                          : "";
                        return (
                          <div
                            key={d.id}
                            style={{
                              display: "flex",
                              minWidth: 0,
                              width: "100%",
                              boxSizing: "border-box",
                              overflow: "hidden",
                              flexWrap: "wrap",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 10,
                              padding: 10,
                              border: "1px solid rgba(255,255,255,0.12)",
                              borderRadius: 14,
                              background: "rgba(255,255,255,0.04)",
                            }}
                          >
                            <div style={{ minWidth: 0, flex: "1 1 260px", maxWidth: "100%" }}>
                              <div
                                style={{
                                  fontWeight: 650,
                                  lineHeight: 1.25,
                                  whiteSpace: "normal",
                                  overflowWrap: "anywhere",
                                  wordBreak: "break-word",
                                }}
                              >
                                {label}
                                {who}
                              </div>
                              <div style={{ fontSize: 12, opacity: 0.8 }}>
                                {i18nT("sauvegarde_le_16d512aa")}{" "}
                                {new Date(d.updatedAtISO).toLocaleString(
                                  "fr-FR",
                                )}
                              </div>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                flex: "0 1 auto",
                                maxWidth: "100%",
                                gap: 8,
                                flexWrap: "wrap",
                                justifyContent: "flex-end",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => openDraft(d)}
                              >
                                {i18nT("ouvrir_42c07747")}{" "}</button>
                              <button
                                type="button"
                                className={styles.ghostBtn}
                                onClick={() => deleteDraft(d.id)}
                              >
                                {i18nT("supprimer_1acfc1c7")}{" "}</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : templates.length === 0 ? (
                  <div style={{ padding: 14, opacity: 0.85 }}>
                    {i18nT("aucun_modele_de_facture_pour_l_15fd45d2")}{" "}</div>
                ) : (
                  <div
                    style={{
                      padding: 14,
                      display: "grid",
                      gap: 10,
                      maxHeight: templates.length > 10 ? "62vh" : undefined,
                      overflowY: templates.length > 10 ? "auto" : undefined,
                      paddingRight: templates.length > 10 ? 8 : 14,
                    }}
                  >
                    {templates.map((d) => {
                      const label =
                        d.snapshot.templateName || d.name || "Modèle facture";
                      return (
                        <div
                          key={d.id}
                          style={{
                            display: "flex",
                            minWidth: 0,
                            width: "100%",
                            boxSizing: "border-box",
                            overflow: "hidden",
                            flexWrap: "wrap",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: 10,
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 14,
                            background: "rgba(255,255,255,0.04)",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: "1 1 260px", maxWidth: "100%" }}>
                            <div
                              style={{
                                fontWeight: 650,
                                lineHeight: 1.25,
                                whiteSpace: "normal",
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                              }}
                            >
                              {label}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.8 }}>
                              {i18nT("modele_enregistre_le_b7560023")}{" "}
                              {new Date(d.updatedAtISO).toLocaleString("fr-FR")}
                            </div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flex: "0 1 auto",
                              maxWidth: "100%",
                              gap: 8,
                              flexWrap: "wrap",
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => applyTemplateSnapshot(d.snapshot)}
                            >
                              {i18nT("utiliser_fb5e43ce")}{" "}</button>
                            <button
                              type="button"
                              className={styles.ghostBtn}
                              onClick={() => deleteDraft(d.id)}
                            >
                              {i18nT("supprimer_1acfc1c7")}{" "}</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <DocumentContactSection
            crmContainerRef={crmSelectRef}
            crmLoading={crmLoading}
            crmOpen={crmOpen}
            onToggleCrm={() => setCrmOpen((value) => !value)}
            crmButtonText={
              selectedCrmLabel ||
              (crmLoading
                ? "Chargement..."
                : "Importer / Rechercher un contact CRM")
            }
            crmQuery={crmQuery}
            onCrmQueryChange={setCrmQuery}
            filteredCrmContacts={filteredCrmContacts}
            getContactLabel={getDocumentCrmContactLabel}
            onSelectCrmContact={selectCrmContact}
            clientType={clientType}
            onClientTypeChange={(value) => {
              setClientType(value);
              clearFieldError("clientType");
              clearFieldError("clientSiren");
              clearFieldError("operationCategory" as any);
            }}
            fieldErrors={fieldErrors}
            addingToCrm={addingToCrm}
            addToCrmDisabled={finalizing || addingToCrm || coreEditingLocked}
            onAddCurrentClientToCrm={() => void addCurrentClientToCrm()}
            crmActionMessage={crmActionMessage}
            crmError={crmError}
            clientName={clientName}
            onClientNameChange={(value) => {
              setClientName(value);
              clearFieldError("clientName");
            }}
            clientEmail={clientEmail}
            onClientEmailChange={(value) => {
              setClientEmail(value);
              if (fieldErrors.clientEmail) {
                setFieldErrors((previous) => ({
                  ...previous,
                  clientEmail: undefined,
                }));
              }
            }}
            clientSiren={clientSiren}
            onClientSirenChange={(value) => {
              setClientSiren(value);
              clearFieldError("clientSiren");
            }}
            clientVatNumber={clientVatNumber}
            onClientVatNumberChange={setClientVatNumber}
            billingAddress={billingAddress}
            onBillingAddressChange={(value) => {
              setBillingAddress(value);
              clearFieldError("billingAddress");
            }}
            billingPostalCode={billingPostalCode}
            onBillingPostalCodeChange={(value) => {
              setBillingPostalCode(value);
              clearFieldError("billingPostalCode");
            }}
            billingCity={billingCity}
            onBillingCityChange={(value) => {
              setBillingCity(value);
              clearFieldError("billingCity");
            }}
            sameAddresses={sameAddresses}
            onSameAddressesChange={setSameAddresses}
            deliveryAddress={deliveryAddress}
            onDeliveryAddressChange={setDeliveryAddress}
            deliveryPostalCode={deliveryPostalCode}
            onDeliveryPostalCodeChange={setDeliveryPostalCode}
            deliveryCity={deliveryCity}
            onDeliveryCityChange={setDeliveryCity}
            editingLocked={coreEditingLocked}
          />
          <div className={styles.formBlock}>
            <div className={styles.formBlockHeader}>
              <div>
                <div className={styles.formBlockTitleRow}>
                  <span className={styles.formBlockIcon} aria-hidden="true">
                    🧾
                  </span>
                  <div className={styles.formBlockTitle}>{i18nT("infos_facture_fa8812ec")}</div>
                </div>
                <div className={styles.formBlockSubtitle}>
                  {i18nT("numero_dates_options_avancees_et_actions_3082e1e1")}{" "}</div>
              </div>
            </div>

            <div
              className={`${styles.compactThreeCol} ${styles.mobileStackGrid}`}
            >
              <div className={styles.field}>
                <label>
                  {i18nT("numero_de_facture_a19ac308")}{" "}<span className={styles.requiredMark}>*</span>
                </label>
                <input
                  value={number}
                  onChange={(e) => {
                    setNumber(e.target.value);
                    clearFieldError("number");
                  }}
                  placeholder="FAC-YYYYMMDD-XXXX"
                  disabled={coreEditingLocked}
                />
                {fieldErrors.number ? (
                  <div className={styles.fieldError}>{fieldErrors.number}</div>
                ) : null}
              </div>

              <div className={styles.field}>
                <label>
                  {i18nT("date_de_facture_f1edd0d6")}<span className={styles.requiredMark}>*</span>
                </label>
                <DocumentDateInput
                  value={invoiceDate}
                  onChange={(value) => {
                    setInvoiceDate(value);
                    clearFieldError("invoiceDate");
                    setDueDate(
                      dateWithAddedDays(
                        value,
                        documentsSettings.invoice.dueDays,
                      ),
                    );
                  }}
                  disabled={coreEditingLocked}
                />
                {fieldErrors.invoiceDate ? (
                  <div className={styles.fieldError}>
                    {fieldErrors.invoiceDate}
                  </div>
                ) : null}
              </div>

              <div className={styles.field}>
                <label>
                  {i18nT("echeance_f9a77ff6")}<span className={styles.requiredMark}>*</span>
                </label>
                <DocumentDateInput
                  value={dueDate}
                  onChange={(value) => {
                    setDueDate(value);
                    clearFieldError("dueDate");
                  }}
                  disabled={coreEditingLocked}
                />
                {fieldErrors.dueDate ? (
                  <div className={styles.fieldError}>{fieldErrors.dueDate}</div>
                ) : null}
              </div>
            </div>

            <details
              className={styles.advancedDetails}
              open={advancedOpen}
              onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
            >
              <summary className={styles.advancedSummary}>
                {i18nT("options_avancees_de_la_facture_ece5a072")}{" "}</summary>
              <div className={styles.advancedBody}>
                <div className={styles.advancedSection}>
                  <div className={styles.advancedSectionTitle}>{i18nT("document_e214b8a2")}</div>
                  <div className={styles.compactThreeCol}>
                    <div className={styles.field}>
                      <label>{i18nT("type_de_document_69938df4")}</label>
                      <select
                        value={documentKind}
                        onChange={(e) =>
                          setDocumentKind(
                            e.target
                              .value as (typeof DOCUMENT_KIND_OPTIONS)[number]["key"],
                          )
                        }
                        disabled={coreEditingLocked}
                      >
                        {DOCUMENT_KIND_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.labelKey ? i18nT(option.labelKey) : "—"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>
                        {i18nT("categorie_d_operation_298de450")}{" "}{clientType && clientType !== "particulier" ? (
                          <span className={styles.requiredMark}>*</span>
                        ) : null}
                      </label>
                      <select
                        value={operationCategory}
                        onChange={(e) => {
                          setOperationCategory(
                            e.target
                              .value as (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"],
                          );
                          clearFieldError("operationCategory");
                        }}
                        disabled={coreEditingLocked}
                      >
                        {OPERATION_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.labelKey ? i18nT(option.labelKey) : "—"}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.operationCategory ? (
                        <div className={styles.fieldError}>
                          {fieldErrors.operationCategory}
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.field}>
                      <label>{i18nT("statut_659499f3")}</label>
                      <select
                        value={status}
                        onChange={(e) =>
                          setStatus(
                            e.target.value as
                              | DocRecord["status"]
                              | "en_attente_paiement"
                              | "",
                          )
                        }
                        disabled={coreEditingLocked}
                      >
                        <option value="">—</option>
                        <option value="brouillon">{i18nT("brouillon_57d2d7a7")}</option>
                        <option value="en_attente_paiement">
                          {i18nT("en_attente_de_paiement_9b68eb63")}{" "}</option>
                        <option value="envoye">{i18nT("envoye_7b0a810d")}</option>
                        <option value="paye">{i18nT("paye_fa02fd68")}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className={styles.advancedSection}>
                  <div className={styles.advancedSectionTitle}>
                    {i18nT("acompte_paiement_72841894")}{" "}</div>
                  <div className={styles.compactThreeCol}>
                    <div className={styles.field}>
                      <label>{i18nT("acompte_79f9f101")}</label>
                      <select
                        value={depositKind}
                        onChange={(e) => {
                          const value = e.target.value as
                            | ""
                            | "percent"
                            | "amount";
                          setDepositKind(value);
                          if (!value) setDepositValue("");
                        }}
                        disabled={coreEditingLocked}
                      >
                        <option value="">—</option>
                        <option value="percent">{i18nT("pourcentage_e34218e3")}</option>
                        <option value="amount">{i18nT("montant_4adcd9fc")}</option>
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>{i18nT("valeur_acompte_18f70f89")}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={depositValue}
                        onChange={(e) => setDepositValue(e.target.value)}
                        placeholder={
                          depositKind === "amount" ? "Ex : 300" : "Ex : 30"
                        }
                        disabled={coreEditingLocked || !depositKind}
                      />
                    </div>
                    <div className={styles.field}>
                      <label>{i18nT("mode_de_paiement_71aed79c")}</label>
                      <select
                        value={paymentMethod}
                        onChange={(e) =>
                          setPaymentMethod(
                            e.target
                              .value as (typeof PAYMENT_METHODS)[number]["key"],
                          )
                        }
                        disabled={coreEditingLocked}
                      >
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method.key} value={method.key}>
                            {method.labelKey ? i18nT(method.labelKey) : "—"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className={styles.field} style={{ marginBottom: 0 }}>
                    <label>IBAN</label>
                    <input
                      value={paymentDetails}
                      onChange={(e) => setPaymentDetails(e.target.value)}
                      placeholder={i18nT("ex_iban_fr76_6fc76637")}
                      disabled={coreEditingLocked}
                    />
                  </div>
                </div>

                <div className={styles.advancedSection}>
                  <div className={styles.advancedSectionTitle}>
                    {i18nT("echeance_mentions_legales_804c2f47")}{" "}</div>
                  <div className={styles.compactThreeCol}>
                    <div className={styles.field}>
                      <label>{i18nT("penalites_de_retard_1668daa8")}</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lateFeeRate}
                        onChange={(e) => setLateFeeRate(e.target.value)}
                        placeholder={i18nT("ex_12_00_883dce79")}
                        disabled={coreEditingLocked}
                      />
                    </div>
                    <div className={styles.field}>
                      <label>{i18nT("tva_sur_les_debits_d46bfbae")}</label>
                      <label className={styles.toggleInputLike}>
                        <input
                          type="checkbox"
                          checked={vatOnDebits}
                          onChange={(e) => setVatOnDebits(e.target.checked)}
                          disabled={coreEditingLocked}
                        />
                        <span>{vatOnDebits ? i18nT("oui_eaa02f3f") : i18nT("non_a7219939")}</span>
                      </label>
                    </div>
                    <div className={styles.field}>
                      <label>{i18nT("indemnite_forfaitaire_de_40_8a3e9ec4")}</label>
                      <label className={styles.toggleInputLike}>
                        <input
                          type="checkbox"
                          checked={fixedRecoveryFee40}
                          onChange={(e) =>
                            setFixedRecoveryFee40(e.target.checked)
                          }
                          disabled={coreEditingLocked}
                        />
                        <span>{fixedRecoveryFee40 ? i18nT("oui_eaa02f3f") : i18nT("non_a7219939")}</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className={styles.advancedSection}>
                  <div className={styles.advancedSectionTitle}>{i18nT("prestation_b51f479f")}</div>
                  <ServiceDateFields
                    radioName="factureServiceDateMode"
                    mode={serviceDateMode}
                    onModeChange={updateServiceDateMode}
                    serviceDate={serviceDate}
                    onServiceDateChange={setServiceDate}
                    servicePeriodStart={servicePeriodStart}
                    onServicePeriodStartChange={setServicePeriodStart}
                    servicePeriodEnd={servicePeriodEnd}
                    onServicePeriodEndChange={setServicePeriodEnd}
                    disabled={coreEditingLocked}
                  />

                  <div className={styles.field} style={{ marginBottom: 0 }}>
                    <label>{i18nT("reference_commande_po_b40bb4c5")}</label>
                    <input
                      value={purchaseOrderReference}
                      onChange={(e) =>
                        setPurchaseOrderReference(e.target.value)
                      }
                      placeholder={i18nT("ex_bc_2026_014_po_7781_fa20f4e5")}
                      disabled={coreEditingLocked}
                    />
                  </div>
                </div>

                <NotesAndMentionsSection
                  notes={notes}
                  onNotesChange={setNotes}
                  mentionLabel={i18nT("mention_specifique_facture_48f660eb")}
                  mention={invoiceMention}
                  onMentionChange={setInvoiceMention}
                  mentionPlaceholder={i18nT("ex_aucun_escompte_pour_paiement_anticipe_8ec87ff7")}
                  disabled={coreEditingLocked}
                />
              </div>
            </details>

            <div className={styles.actionGrid}>
              <button
                type="button"
                onClick={() => {
                  void saveDraft();
                }}
                disabled={finalizing || addingToCrm}
              >
                <>
                  {i18nT("sauvegarder_9ada1439")}{" "}<span
                    className={styles.helpBubble}
                    title={i18nT("retrouvez_vos_sauvegardes_dans_factures_document_70c2c8ab")}
                  >
                    ?
                  </span>
                </>
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveAsTemplate();
                }}
                disabled={finalizing || addingToCrm}
              >
                <>
                  {i18nT("creer_modele_386adb21")}{" "}<span
                    className={styles.helpBubble}
                    title={i18nT("retrouvez_vos_modeles_dans_factures_documents_043506ec")}
                  >
                    ?
                  </span>
                </>
              </button>
              <button
                type="button"
                disabled={finalizing || addingToCrm || isFinalized}
                title={
                  isFinalized ? "Cette facture est déjà figée." : undefined
                }
                onClick={async () => {
                  if (!validateInvoiceAction()) return;
                  const docSaveId = await saveDraft({ silent: true });
                  if (!docSaveId) return;
                  const finalized = await finalizeInvoice(
                    docSaveId,
                    "en_attente_paiement",
                  );
                  if (finalized) {
                    setFormMessage({
                      type: "success",
                      text: i18nT("facture_figee_sous_le_numero_value_9af08308", { value0: finalized.number }),
                    });
                  }
                }}
              >
                {finalizing ? (
                  i18nT("figement_5b043868")
                ) : (
                  <>
                    {i18nT("figer_14a87a23")}{" "}<span
                      className={styles.helpBubble}
                      title={i18nT("fige_la_facture_avec_un_numero_dcfc41a8")}
                    >
                      ?
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={finalizing || addingToCrm}
                onClick={async () => {
                  if (!validateInvoiceAction({ requireEmail: true })) return;
                  if (!isFinalized) {
                    const ok = await confirmInrcy({
                      title: i18nT("figer_la_facture_10e7098e"),
                      message:
                        i18nT("l_envoi_par_mail_va_figer_c1a0ab4c"),
                      confirmLabel: i18nT("figer_et_envoyer_87694ed8"),
                      variant: "warning",
                    });
                    if (!ok) return;
                  }
                  const to = (clientEmail || "").trim();
                  await uploadPdfAndOpenCompose(to);
                }}
              >
                {finalizing ? (
                  i18nT("preparation_47305e12")
                ) : (
                  <>
                    {i18nT("envoyer_par_mail_e60a588c")}{" "}<span
                      className={styles.helpBubble}
                      title={i18nT("fige_le_document_si_besoin_prepare_45066c02")}
                    >
                      ?
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={print}
                disabled={finalizing || addingToCrm}
              >
                {i18nT("imprimer_pdf_2dd09ec2")}{" "}</button>
            </div>

            <div className={styles.requiredHint}>
              {i18nT("champs_obligatoires_selon_le_type_de_3140b9c9")}{" "}</div>

            {formMessage ? (
              <div
                className={`${styles.actionMessage} ${formMessage.type === "success" ? styles.actionMessageSuccess : styles.actionMessageError}`}
              >
                {formMessage.text}
              </div>
            ) : null}

            {vatDispense ? (
              <p style={{ marginTop: 12, opacity: 0.9 }}>
                {i18nT("tva_desactivee_9d51689a")}{" "}
                <strong>{i18nT("tva_non_applicable_article_293_b_ca29077b")}</strong>
              </p>
            ) : null}
          </div>
        </div>

        {/* Aperçu document */}
        <div className={previewClassName} ref={previewRef}>
          <div className={styles.previewHeader}>
            <div>
              <div className={styles.title}>{documentTitle}</div>
              <div>{number || "—"}</div>
              <div style={{ marginTop: 6, color: "#444" }}>
                {documentClientTexts.labels.date} :{" "}
                {invoiceDate
                  ? formatDocumentDate(invoiceDate)
                  : "—"}
                {dueDate ? (
                  <>
                    {" "}
                    · {documentClientTexts.labels.dueDate} : {formatDocumentDate(dueDate)}
                  </>
                ) : null}
              </div>
              {serviceDateMode === "single" && serviceDate ? (
                <div style={{ marginTop: 4, color: "#444" }}>
                  {documentClientTexts.labels.serviceDelivery} :{" "}
                  {formatDocumentDate(serviceDate)}
                </div>
              ) : null}
              {serviceDateMode === "period" &&
              (servicePeriodStart || servicePeriodEnd) ? (
                <div style={{ marginTop: 4, color: "#444" }}>
                  {documentClientTexts.labels.period} :{" "}
                  {servicePeriodStart
                    ? formatDocumentDate(servicePeriodStart)
                    : "—"}
                  {servicePeriodEnd
                    ? ` → ${formatDocumentDate(servicePeriodEnd)}`
                    : ""}
                </div>
              ) : null}
            </div>
            {profile?.logo_url ? (
              <div className={styles.logoBox} aria-label={i18nT("logo_83fce832")}>
                <img
                  src={profile.logo_url}
                  alt={i18nT("logo_83fce832")}
                  className={styles.logoImg}
                />
              </div>
            ) : null}
          </div>

          <DocumentParties
            providerLabel={documentClientTexts.labels.provider}
            clientLabel={documentClientTexts.labels.client}
            phoneLabel={documentClientTexts.labels.phone}
            vatLabel={documentClientTexts.labels.vat}
            deliveryAddressLabel={documentClientTexts.labels.deliveryAddress}
            providerData={providerData}
            allowProviderEditing
            isEditingProvider={isEditingProvider}
            onToggleProviderEditing={() =>
              setIsEditingProvider((previous) => !previous)
            }
            onResetProvider={() => setProviderOverride({})}
            onProviderFieldChange={(field, value) =>
              setProviderOverride((previous) => ({
                ...previous,
                [field]: value,
              }))
            }
            clientName={clientName}
            clientSiren={clientSiren}
            clientVatNumber={clientVatNumber}
            billingFullAddress={billingFullAddress}
            showDeliveryAddress={!sameAddresses && !!deliveryAddress}
            deliveryFullAddress={deliveryFullAddress}
            clientEmail={clientEmail}
          />

          <table className={styles.table}>
            <thead>
              <tr>
                <th>{documentClientTexts.labels.designation}</th>
                <th style={{ width: 70 }}>{documentClientTexts.labels.quantity}</th>
                <th style={{ width: 120 }}>{documentClientTexts.labels.unitPriceHT}</th>
                <th style={{ width: 90 }}>{documentClientTexts.labels.totalVAT}</th>
                <th style={{ width: 120, textAlign: "right" }}>{documentClientTexts.labels.totalHT}</th>
                <th
                  className={styles.printHiddenCell}
                  style={{ width: 0 }}
                ></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={l.id}>
                  <td>
                    <input
                      className={styles.printHidden}
                      value={l.label}
                      onChange={(e) =>
                        updateLine(l.id, { label: e.target.value })
                      }
                      placeholder={i18nT("ex_reparation_entretien_870432e7")}
                      disabled={coreEditingLocked}
                      style={{
                        width: "100%",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    />
                    <span className={styles.printOnly}>{l.label || "—"}</span>
                  </td>
                  <td>
                    <input
                      className={styles.printHidden}
                      type="number"
                      value={l.qty}
                      onChange={(e) =>
                        updateLine(l.id, { qty: Number(e.target.value) })
                      }
                      disabled={coreEditingLocked}
                      style={{
                        width: 64,
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    />
                    <span className={styles.printOnly}>{l.qty}</span>
                  </td>
                  <td>
                    <input
                      className={styles.printHidden}
                      type="number"
                      value={l.unitPrice}
                      onChange={(e) =>
                        updateLine(l.id, {
                          unitPrice: Number(e.target.value),
                        })
                      }
                      disabled={coreEditingLocked}
                      style={{
                        width: 110,
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    />
                    <span className={styles.printOnly}>
                      {formatDocumentMoney(l.unitPrice)}
                    </span>
                  </td>
                  <td>
                    <select
                      className={styles.printHidden}
                      value={vatDispense ? 0 : l.vatRate}
                      disabled={vatDispense || coreEditingLocked}
                      onChange={(e) =>
                        updateLine(l.id, { vatRate: Number(e.target.value) })
                      }
                      style={{
                        width: 80,
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    >
                      {VAT_OPTIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}%
                        </option>
                      ))}
                    </select>
                    <span className={styles.printOnly}>
                      {vatDispense ? 0 : l.vatRate}%
                    </span>
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatDocumentMoney(calcLineHT(l))}
                  </td>
                  <td
                    className={styles.printHiddenCell}
                    style={{ textAlign: "right" }}
                  >
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        className={styles.removeLineBtn}
                        onClick={() => removeLine(l.id)}
                        title={i18nT("supprimer_la_ligne_17611368")}
                        disabled={coreEditingLocked}
                      >
                        ×
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={`${styles.previewAddLineWrap} ${styles.noPrint}`}>
            <button
              type="button"
              className={styles.previewAddLineBtn}
              onClick={addLine}
              disabled={coreEditingLocked}
            >
              {i18nT("ajouter_une_prestation_1613d29a")}{" "}</button>
          </div>
          {fieldErrors.lines ? (
            <div className={styles.fieldError} style={{ marginTop: 6 }}>
              {fieldErrors.lines}
            </div>
          ) : null}

          <div
            className={styles.previewPrintSpacer}
            aria-hidden="true"
            style={{
              height: `${getInvoicePrintFooterSpacerMm(lines.length)}mm`,
            }}
          />

          <div className={styles.previewFinalFooter}>
            <div
              className={styles.previewBottomGrid}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 280px",
                marginTop: 18,
                gap: 24,
              }}
            >
            <div style={{ fontSize: 12, color: "#444", lineHeight: 1.4 }}>
              <div style={{ marginBottom: 8 }}>
                <strong>{documentClientTexts.labels.payment} :</strong> {paymentLabel}
                {paymentDetails ? <> — {paymentDetails}</> : null}
              </div>
              {operationCategory ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>{documentClientTexts.labels.category} :</strong> {operationCategoryLabel}
                </div>
              ) : null}
              {serviceDateMode === "single" && serviceDate ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>{documentClientTexts.labels.serviceDateDelivery} :</strong>{" "}
                  {formatDocumentDate(serviceDate)}
                </div>
              ) : null}
              {serviceDateMode === "period" &&
              (servicePeriodStart || servicePeriodEnd) ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>{documentClientTexts.labels.servicePeriod} :</strong>{" "}
                  {servicePeriodStart
                    ? formatDocumentDate(servicePeriodStart)
                    : "—"}
                  {servicePeriodEnd
                    ? ` → ${formatDocumentDate(servicePeriodEnd)}`
                    : ""}
                </div>
              ) : null}
              {purchaseOrderReference ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>{documentClientTexts.labels.purchaseOrderReference} :</strong>{" "}
                  {purchaseOrderReference}
                </div>
              ) : null}
              {depositKind && depositValue ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>{documentClientTexts.labels.deposit} :</strong>{" "}
                  {depositKind === "amount"
                    ? formatDocumentMoney(Number(depositValue) || 0)
                    : `${depositValue} %`}
                </div>
              ) : null}
              {vatOnDebits ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>{documentClientTexts.labels.vatOnDebits}</strong>
                </div>
              ) : null}
              {lateFeeRate ? (
                <div style={{ marginBottom: 6 }}>
                  <strong>{documentClientTexts.labels.lateFees} :</strong> {lateFeeRate} %
                </div>
              ) : null}
              {fixedRecoveryFee40 ? (
                <div style={{ marginBottom: 6 }}>
                  {i18nT("indemnite_forfaitaire_de_40_pour_frais_96b7a004")}{" "}</div>
              ) : null}
              {vatDispense ? (
                <div>
                  <strong>{documentClientTexts.labels.vatNotApplicable}</strong> {" "}{i18nT("article_293_b_du_cgi_da0560a3")}{" "}</div>
              ) : null}
              {notes ? <div style={{ marginTop: 8 }}>{notes}</div> : null}
              {invoiceMention ? (
                <div style={{ marginTop: 8 }}>{invoiceMention}</div>
              ) : null}
            </div>
            <div className={styles.previewTotalsBox}>
              <div style={{ marginBottom: 8 }} className={styles.noPrint}>
                <div style={{ fontWeight: 650, marginBottom: 6 }}>
                  {i18nT("remise_commerciale_c3564bdc")}{" "}</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr",
                    gap: 8,
                  }}
                >
                  <select
                    value={discountKind}
                    disabled={coreEditingLocked}
                    onChange={(e) => {
                      const v = e.target.value as any;
                      setDiscountKind(v);
                      if (!v) {
                        setDiscountValue(0);
                        setDiscountDetails("");
                      }
                    }}
                    style={{
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      padding: "10px 12px",
                      color: "#111",
                    }}
                  >
                    <option value="">{i18nT("aucune_e8f88273")}</option>
                    <option value="percent">%</option>
                    <option value="amount">€</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={discountValue}
                    onChange={(e) =>
                      setDiscountValue(Number(e.target.value) || 0)
                    }
                    placeholder={
                      discountKind === "percent" ? "Ex: 10" : "Ex: 50"
                    }
                    disabled={!discountKind || coreEditingLocked}
                    style={{
                      width: "100%",
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      padding: "10px 12px",
                      color: "#111",
                    }}
                  />
                  <textarea
                    value={discountDetails}
                    onChange={(e) => setDiscountDetails(e.target.value)}
                    placeholder={i18nT("detail_de_la_remise_optionnel_31f73b08")}
                    disabled={!discountKind || coreEditingLocked}
                    rows={2}
                    style={{
                      gridColumn: "1 / -1",
                      width: "100%",
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: 10,
                      padding: "10px 12px",
                      color: "#111",
                      resize: "vertical",
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span>{documentClientTexts.labels.totalHT}</span>
                <strong>{formatDocumentMoney(totals.totalHT)}</strong>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span>{documentClientTexts.labels.totalVAT}</span>
                <strong>{formatDocumentMoney(totals.totalTVA)}</strong>
              </div>
              <div
                className={styles.previewTotalsMain}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 10,
                  fontSize: 18,
                }}
              >
                <span>{documentClientTexts.labels.totalTTC}</span>
                <strong>{formatDocumentMoney(totals.totalTTC)}</strong>
              </div>
              {totals.discountTTC > 0 ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                  }}
                >
                  <span>{documentClientTexts.labels.discount}</span>
                  <strong>- {formatDocumentMoney(totals.discountTTC)}</strong>
                </div>
              ) : null}
              {discountDetails && totals.discountTTC > 0 ? (
                <div style={{ fontSize: 12, color: "#444", marginTop: 4 }}>
                  {discountDetails}
                </div>
              ) : null}
              {totals.discountTTC > 0 ? (
                <div
                  className={styles.previewTotalsMain}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                    fontSize: 18,
                  }}
                >
                  <span>{documentClientTexts.labels.totalDue}</span>
                  <strong>{formatDocumentMoney(totals.totalDue)}</strong>
                </div>
              ) : null}
              <div style={{ marginTop: 10, fontSize: 12, color: "#444" }}>
                <strong>{documentClientTexts.labels.status} :</strong> {documentStatusLabel}
              </div>
            </div>
            </div>
          </div>

          <div className={styles.documentPrintPages} aria-hidden="true">
            {invoicePrintPages.map((page, pageIndex) => (
              <section
                key={`invoice-print-page-${pageIndex}`}
                className={styles.documentPrintPage}
              >
                {page.includeHeader ? (
                  <>
                    <div className={styles.previewHeader}>
                      <div>
                        <div className={styles.title}>{documentTitle}</div>
                        <div>{number || "—"}</div>
                        <div style={{ marginTop: 6, color: "#444" }}>
                          {documentClientTexts.labels.date} : {invoiceDate ? formatDocumentDate(invoiceDate) : "—"}
                          {dueDate ? <> · {documentClientTexts.labels.dueDate} : {formatDocumentDate(dueDate)}</> : null}
                        </div>
                        {serviceDateMode === "single" && serviceDate ? (
                          <div style={{ marginTop: 4, color: "#444" }}>
                            {documentClientTexts.labels.serviceDelivery} : {formatDocumentDate(serviceDate)}
                          </div>
                        ) : null}
                        {serviceDateMode === "period" && (servicePeriodStart || servicePeriodEnd) ? (
                          <div style={{ marginTop: 4, color: "#444" }}>
                            {documentClientTexts.labels.period} : {servicePeriodStart ? formatDocumentDate(servicePeriodStart) : "—"}
                            {servicePeriodEnd ? ` → ${formatDocumentDate(servicePeriodEnd)}` : ""}
                          </div>
                        ) : null}
                      </div>
                      {profile?.logo_url ? (
                        <div className={styles.logoBox} aria-label={i18nT("logo_83fce832")}>
                          <img src={profile.logo_url} alt={i18nT("logo_83fce832")} className={styles.logoImg} />
                        </div>
                      ) : null}
                    </div>

                    <DocumentParties
                      providerLabel={documentClientTexts.labels.provider}
                      clientLabel={documentClientTexts.labels.client}
                      phoneLabel={documentClientTexts.labels.phone}
                      vatLabel={documentClientTexts.labels.vat}
                      deliveryAddressLabel={documentClientTexts.labels.deliveryAddress}
                      providerData={providerData}
                      clientName={clientName}
                      clientSiren={clientSiren}
                      clientVatNumber={clientVatNumber}
                      billingFullAddress={billingFullAddress}
                      showDeliveryAddress={!sameAddresses && !!deliveryAddress}
                      deliveryFullAddress={deliveryFullAddress}
                      clientEmail={clientEmail}
                    />
                  </>
                ) : page.lines.length ? (
                  <div className={styles.documentPrintContinuation}>{documentClientTexts.labels.continuation}</div>
                ) : null}

                {page.lines.length ? (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{documentClientTexts.labels.designation}</th>
                        <th style={{ width: 70 }}>{documentClientTexts.labels.quantity}</th>
                        <th style={{ width: 120 }}>{documentClientTexts.labels.unitPriceHT}</th>
                        <th style={{ width: 90 }}>{documentClientTexts.labels.totalVAT}</th>
                        <th style={{ width: 120, textAlign: "right" }}>{documentClientTexts.labels.totalHT}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.lines.map((l) => (
                        <tr key={`${pageIndex}-${l.id}`}>
                          <td>{l.label || "—"}</td>
                          <td>{l.qty}</td>
                          <td>{formatDocumentMoney(l.unitPrice)}</td>
                          <td>{vatDispense ? 0 : l.vatRate}%</td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatDocumentMoney(calcLineHT(l))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}

                {page.includeFooter ? (
                  <div className={styles.documentPrintFooter}>
                    <div className={styles.previewBottomGrid}>
                      <div style={{ fontSize: 12, color: "#444", lineHeight: 1.4 }}>
                        <div style={{ marginBottom: 8 }}><strong>{documentClientTexts.labels.payment} :</strong> {paymentLabel}{paymentDetails ? <> — {paymentDetails}</> : null}</div>
                        {operationCategory ? <div style={{ marginBottom: 6 }}><strong>{documentClientTexts.labels.category} :</strong> {operationCategoryLabel}</div> : null}
                        {serviceDateMode === "single" && serviceDate ? <div style={{ marginBottom: 6 }}><strong>{documentClientTexts.labels.serviceDateDelivery} :</strong> {formatDocumentDate(serviceDate)}</div> : null}
                        {serviceDateMode === "period" && (servicePeriodStart || servicePeriodEnd) ? <div style={{ marginBottom: 6 }}><strong>{documentClientTexts.labels.servicePeriod} :</strong> {servicePeriodStart ? formatDocumentDate(servicePeriodStart) : "—"}{servicePeriodEnd ? ` → ${formatDocumentDate(servicePeriodEnd)}` : ""}</div> : null}
                        {purchaseOrderReference ? <div style={{ marginBottom: 6 }}><strong>{documentClientTexts.labels.purchaseOrderReference} :</strong> {purchaseOrderReference}</div> : null}
                        {depositKind && depositValue ? <div style={{ marginBottom: 6 }}><strong>{documentClientTexts.labels.deposit} :</strong> {depositKind === "amount" ? formatDocumentMoney(Number(depositValue) || 0) : `${depositValue} %`}</div> : null}
                        {vatOnDebits ? <div style={{ marginBottom: 6 }}><strong>{documentClientTexts.labels.vatOnDebits}</strong></div> : null}
                        {lateFeeRate ? <div style={{ marginBottom: 6 }}><strong>{documentClientTexts.labels.lateFees} :</strong> {lateFeeRate} %</div> : null}
                        {fixedRecoveryFee40 ? <div style={{ marginBottom: 6 }}>{documentClientTexts.labels.recoveryFee40}</div> : null}
                        {vatDispense ? <div><strong>{documentClientTexts.labels.vatNotApplicable}</strong> {" "}{i18nT("article_293_b_du_cgi_da0560a3")}</div> : null}
                        {notes ? <div style={{ marginTop: 8 }}>{notes}</div> : null}
                        {invoiceMention ? <div style={{ marginTop: 8 }}>{invoiceMention}</div> : null}
                      </div>
                      <div className={styles.previewTotalsBox}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>{documentClientTexts.labels.totalHT}</span><strong>{formatDocumentMoney(totals.totalHT)}</strong></div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>{documentClientTexts.labels.totalVAT}</span><strong>{formatDocumentMoney(totals.totalTVA)}</strong></div>
                        <div className={styles.previewTotalsMain} style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 18 }}><span>{documentClientTexts.labels.totalTTC}</span><strong>{formatDocumentMoney(totals.totalTTC)}</strong></div>
                        {totals.discountTTC > 0 ? <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>{documentClientTexts.labels.discount}</span><strong>- {formatDocumentMoney(totals.discountTTC)}</strong></div> : null}
                        {discountDetails && totals.discountTTC > 0 ? <div style={{ fontSize: 12, color: "#444", marginTop: 4 }}>{discountDetails}</div> : null}
                        {totals.discountTTC > 0 ? <div className={styles.previewTotalsMain} style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 18 }}><span>{documentClientTexts.labels.totalDue}</span><strong>{formatDocumentMoney(totals.totalDue)}</strong></div> : null}
                        <div style={{ marginTop: 10, fontSize: 12, color: "#444" }}><strong>{documentClientTexts.labels.status} :</strong> {documentStatusLabel}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
