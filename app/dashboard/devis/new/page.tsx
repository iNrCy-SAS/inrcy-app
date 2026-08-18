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
  VAT_OPTIONS,
  buildQuotePrintPages,
  getQuotePrintFooterSpacerMm,
  type QuoteFieldErrors,
} from "../../_documents/quoteDocumentEditor";
import {
  buildDocumentMailTexts,
  getDocumentOperationCategoryLabel,
  getDocumentPaymentLabel,
} from "@/lib/clientCommunication";

export default function NewDevisPage() {
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

  // IMPORTANT: stable SSR/CSR
  const [number, setNumber] = useState<string>("");
  const [docDateISO, setDocDateISO] = useState<string>(""); // pour affichage stable

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

  const [paymentMethod, setPaymentMethod] =
    useState<(typeof PAYMENT_METHODS)[number]["key"]>("");
  const [paymentDetails, setPaymentDetails] = useState("");
  const [notes, setNotes] = useState("");
  const [quoteMention, setQuoteMention] = useState("");

  // --- CRM: import d'un contact pour pré-remplir automatiquement
  const {
    crmContacts, setCrmContacts, crmLoading, setCrmLoading,
    crmError, setCrmError, selectedCrmContactId, setSelectedCrmContactId,
    formMessage, setFormMessage, crmActionMessage, setCrmActionMessage,
    fieldErrors, setFieldErrors, addingToCrm, setAddingToCrm,
    currentSaveId, setCurrentSaveId, crmOpen, setCrmOpen,
    advancedOpen, setAdvancedOpen, crmQuery, setCrmQuery,
    crmContainerRef: crmBoxRef,
  } = useDocumentCrmUiState<QuoteFieldErrors>();

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
      "(Sans nom)",
    );

  const { sortedCrmContacts, filteredCrmContacts, selectedCrmContact } =
    useDocumentCrmDirectory({
      contacts: crmContacts,
      query: crmQuery,
      selectedContactId: selectedCrmContactId,
      normalizeSortLabel: true,
    });

  useDocumentOutsideClose({
    active: crmOpen,
    containerRef: crmBoxRef,
    setOpen: setCrmOpen,
    eventTarget: "window",
  });

  const clearCrmSelection = () => {
    setSelectedCrmContactId("");
    setCrmQuery("");
    setCrmOpen(false);
  };

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

  const [validityDays, setValidityDays] = useState<number>(30);

  // Orientation: gérée globalement via <OrientationGuard />

  // IMPORTANT: id stable au 1er render
  const { lines, setLines, addLine, removeLine, updateLine, clearFieldError } =
    useDocumentLineEditor<QuoteFieldErrors>({
      vatDispense,
      initialUnitPrice: 100,
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
    setPaymentMethod(
      settings.common.paymentMethod as (typeof PAYMENT_METHODS)[number]["key"],
    );
    setPaymentDetails(settings.common.paymentDetails);
    setNotes(settings.common.notes);
    setQuoteMention(settings.quote.mention);
    setValidityDays(settings.quote.validityDays);
    setLines([makeDefaultLine(settings, vatDispense)]);
  };

  useEffect(() => {
    let cancelled = false;
    const shouldApplyDefaults = !(
      searchParams.get("saveId") || searchParams.get("docSaveId")
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

  useEffect(() => {
    setNumber(generateNumber("DEV"));
    setDocDateISO(new Date().toISOString().slice(0, 10));
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
  type DevisDraft = {
    id: string;
    updatedAtISO: string;
    name?: string | null;
    snapshot: {
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
      paymentMethod?: (typeof PAYMENT_METHODS)[number]["key"];
      paymentDetails?: string;
      notes?: string;
      quoteMention?: string;
      validityDays: number;
      lines: LineItem[];
      discountKind: DiscountKind | "";
      discountValue: number;
      discountDetails: string;
      status?: DocRecord["status"];
      isFinalized?: boolean;
      finalizedAt?: string | null;
      lockedAt?: string | null;
      isTemplate?: boolean;
      templateName?: string | null;
    };
  };

  const SAVES_TYPE = "devis" as const;
  type DocumentsTab = "saves" | "templates";

  const [draftsOpen, setDraftsOpen] = useState(false);
  const [documentsTab, setDocumentsTab] = useState<DocumentsTab>("saves");
  const [drafts, setDrafts] = useState<DevisDraft[]>([]);
  const [templates, setTemplates] = useState<DevisDraft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [isFinalized, setIsFinalized] = useState(false);
  const [finalizedAt, setFinalizedAt] = useState<string>("");
  const [finalizing, setFinalizing] = useState(false);

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

      const mapped: DevisDraft[] = (data ?? []).map((row: any) => ({
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
            text: i18nT("impossible_de_reouvrir_ce_devis_61080602"),
          });
        return;
      }

      if (!data?.payload) {
        if (!cancelled)
          setFormMessage({ type: "error", text: i18nT("devis_introuvable_d3cb961f") });
        return;
      }

      if (!cancelled) {
        applyDraftSnapshot(data.payload as DevisDraft["snapshot"]);
        setCurrentSaveId(data.id);
        setFormMessage({
          type: "success",
          text: i18nT("devis_reouvert_depuis_inrsend_7453e560"),
        });
      }
    };

    void loadRequestedSave();

    return () => {
      cancelled = true;
    };
  }, [searchParams, supabase]);

  const validateQuoteAction = (options?: { requireEmail?: boolean }) => {
    const nextErrors: QuoteFieldErrors = {};
    const requireEmail = !!options?.requireEmail;
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
      nextErrors.number = "Numéro de devis obligatoire.";
    if (!(docDateISO || "").trim())
      nextErrors.docDateISO = "Date du devis obligatoire.";
    if (!Number(validityDays) || Number(validityDays) < 1) {
      nextErrors.validityDays = "Durée de validité obligatoire.";
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

  const saveDraft = async (options?: {
    silent?: boolean;
    asFinalized?: boolean;
    targetStatus?: DocRecord["status"];
  }) => {
    const nowISO = new Date().toISOString();
    const nextFinalizedAt = options?.asFinalized
      ? finalizedAt || nowISO
      : finalizedAt;
    const finalNumber = number || generateNumber("DEV");
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

    const snapshot: DevisDraft["snapshot"] = {
      number: finalNumber,
      docDateISO: docDateISO || new Date().toISOString().slice(0, 10),
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
      paymentMethod,
      paymentDetails,
      notes,
      quoteMention,
      validityDays,
      lines,
      discountKind,
      discountValue: Number(discountValue) || 0,
      discountDetails,
      status: options?.targetStatus || (isFinalized ? "envoye" : "brouillon"),
      isFinalized: options?.asFinalized ? true : isFinalized,
      finalizedAt: options?.asFinalized ? nextFinalizedAt : finalizedAt || null,
      lockedAt: options?.asFinalized ? nextFinalizedAt : finalizedAt || null,
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
        text: i18nT("impossible_d_enregistrer_ce_devis_pour_0c405ca4"),
      });
      return;
    }

    const savedId =
      (savedRows?.[0] as { id?: string } | undefined)?.id || currentSaveId;
    if (savedId) setCurrentSaveId(savedId);
    if (options?.asFinalized) {
      setIsFinalized(true);
      setFinalizedAt(nextFinalizedAt);
    }

    await refreshSaves();
    if (!options?.silent) {
      setDocumentsTab("saves");
      setDraftsOpen(true);
      setFormMessage({
        type: "success",
        text: currentSaveId ? "Devis mis à jour." : "Devis enregistré.",
      });
    }

    return savedId as string | undefined;
  };

  const applyDraftSnapshot = (s: DevisDraft["snapshot"]) => {
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
    setDocDateISO(s.docDateISO);
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
    setPaymentMethod(
      (s.paymentMethod as (typeof PAYMENT_METHODS)[number]["key"]) || "",
    );
    setPaymentDetails(s.paymentDetails || "");
    setNotes(s.notes || "");
    setQuoteMention(s.quoteMention || documentsSettings.quote.mention || "");
    setValidityDays(s.validityDays);
    setLines(s.lines);
    setDiscountKind(s.discountKind);
    setDiscountValue(s.discountValue);
    setDiscountDetails(s.discountDetails || "");
    setIsFinalized(!!s.isFinalized);
    setFinalizedAt(typeof s.finalizedAt === "string" ? s.finalizedAt : "");
  };

  const convertCurrentDevisToInvoice = async () => {
    const devisSaveId = await saveDraft({ silent: true });
    if (!devisSaveId) {
      setFormMessage({
        type: "error",
        text: i18nT("impossible_de_preparer_ce_devis_pour_8c00cb3e"),
      });
      return;
    }

    router.push(
      `/dashboard/factures/new?fromDevisSaveId=${encodeURIComponent(devisSaveId)}`,
    );
  };

  const openDraft = (d: DevisDraft) => {
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
        i18nT("donnez_un_nom_a_ce_modele_d68e69b1"),
      defaultValue: "Modèle devis",
      placeholder: i18nT("nom_du_modele_68d49f67"),
      confirmLabel: i18nT("creer_modele_386adb21"),
      required: false,
    });
    if (templateName === null) return;

    const cleanName = templateName.trim() || "Modèle devis";
    const nowISO = new Date().toISOString();
    const savedServiceDate = serviceDateMode === "single" ? serviceDate : "";
    const savedServicePeriodStart =
      serviceDateMode === "period" ? servicePeriodStart : "";
    const savedServicePeriodEnd =
      serviceDateMode === "period" ? servicePeriodEnd : "";
    const snapshot = prepareTemplateSnapshot<DevisDraft["snapshot"]>(
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
        paymentMethod,
        paymentDetails,
        notes,
        quoteMention,
        validityDays,
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
    setFormMessage({ type: "success", text: i18nT("modele_de_devis_enregistre_5e0129b5") });
  };

  const applyTemplateSnapshot = (s: DevisDraft["snapshot"]) => {
    setCurrentSaveId("");
    setIsFinalized(false);
    setFinalizedAt("");
    setNumber(generateNumber("DEV"));
    setDocDateISO(new Date().toISOString().slice(0, 10));

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
    setPaymentMethod(
      ((s.paymentMethod as (typeof PAYMENT_METHODS)[number]["key"]) ||
        documentsSettings.common
          .paymentMethod) as (typeof PAYMENT_METHODS)[number]["key"],
    );
    setPaymentDetails(
      s.paymentDetails || documentsSettings.common.paymentDetails,
    );
    setNotes(s.notes || documentsSettings.common.notes);
    setQuoteMention(s.quoteMention || documentsSettings.quote.mention);
    setValidityDays(
      Number(s.validityDays) || documentsSettings.quote.validityDays,
    );
    setLines(
      Array.isArray(s.lines) && s.lines.length
        ? s.lines.map((line) => ({ ...line, id: uid("l") }))
        : [makeDefaultLine(documentsSettings, vatDispense)],
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

  const uploadPdfAndOpenCompose = async (to: string, filename: string) => {
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

    setFinalizing(true);
    const docSaveId = await saveDraft({
      silent: true,
      asFinalized: true,
      targetStatus: "envoye",
    });
    if (!docSaveId) {
      setFinalizing(false);
      setFormMessage({
        type: "error",
        text: i18nT("veuillez_d_abord_sauvegarder_ce_devis_fb5f0187"),
      });
      return;
    }

    const pdfBlob = await buildPdfBlob();
    if (!pdfBlob) {
      setFinalizing(false);
      setFormMessage({
        type: "error",
        text: i18nT("impossible_de_generer_le_pdf_de_397b9dee"),
      });
      return;
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${resolveActiveBrowserUserId(user.id)}/devis/${Date.now()}_${safeName}`;

    const { error: upErr } = await supabase.storage
      .from(ATTACH_BUCKET)
      .upload(key, pdfBlob, { contentType: "application/pdf", upsert: true });

    if (upErr) {
      console.error(upErr);
      setFinalizing(false);
      setFormMessage({
        type: "error",
        text: i18nT("impossible_de_preparer_ce_devis_pour_b40dc8d8"),
      });
      return;
    }

    const params = new URLSearchParams();
    params.set("compose", "1");
    params.set("to", to);
    params.set("attachKey", key);
    params.set("attachName", safeName);
    if (clientName?.trim()) params.set("clientName", clientName.trim());
    params.set("type", "devis");
    params.set("docSaveId", docSaveId);
    params.set("docType", "devis");
    params.set("docNumber", number || safeName.replace(/\.pdf$/i, ""));
    const mailTexts = buildDocumentMailTexts(
      "devis",
      clientExchangePreferences,
      clientName,
      number || safeName.replace(/\.pdf$/i, ""),
    );
    params.set("subject", mailTexts.subject);
    params.set("text", mailTexts.text);
    router.push(`/dashboard/mails?${params.toString()}`);
    setFinalizing(false);
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
            `Ajouté depuis Devis`,
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

  const crmButtonText = useMemo(() => {
    if (crmLoading) return "Chargement...";
    if (selectedCrmContact) {
      const name = getDocumentCrmContactLabel(selectedCrmContact);
      return selectedCrmContact.email
        ? `${name} — ${selectedCrmContact.email}`
        : name;
    }
    return "Importer / Rechercher un contact CRM";
  }, [crmLoading, selectedCrmContact]);

  const paymentLabel = useMemo(
    () => getDocumentPaymentLabel(clientExchangePreferences.clientLanguage, paymentMethod),
    [clientExchangePreferences.clientLanguage, paymentMethod],
  );
  const operationCategoryLabel = useMemo(
    () => getDocumentOperationCategoryLabel(clientExchangePreferences.clientLanguage, operationCategory),
    [clientExchangePreferences.clientLanguage, operationCategory],
  );
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
  const quotePrintPages = buildQuotePrintPages(lines);

  return (
    <div className={`${dash.page} ${styles.editorPage}`}>
      <div className={styles.container}>
        {/* Formulaire */}
        <div className={styles.panel}>
          <div className={styles.panelToolbar}>
            <h1 className={styles.titleBadge}>{i18nT("creer_un_devis_426c5610")}</h1>
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
                  title: i18nT("reinitialiser_le_devis_5d5e9060"),
                  message:
                    i18nT("cette_action_supprimera_la_saisie_actuelle_336136f8"),
                  cancelLabel: i18nT("annuler_49ba3292"),
                  confirmLabel: i18nT("reinitialiser_e0e2ad54"),
                  variant: "danger",
                });
                if (!ok) return;

                // CRM
                setSelectedCrmContactId("");
                setCrmOpen(false);
                setFieldErrors({});
                setFormMessage(null);

                // Client
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

                // Devis
                setCurrentSaveId("");
                setIsFinalized(false);
                setFinalizedAt("");
                setNumber(generateNumber("DEV"));
                setDocDateISO(new Date().toISOString().slice(0, 10));
                setValidityDays(documentsSettings.quote.validityDays);

                setDiscountKind("");
                setDiscountValue(0);
                setDiscountDetails("");

                // Lignes
                setLines([makeDefaultLine(documentsSettings, vatDispense)]);
              }}
            >
              {i18nT("reinitialiser_e0e2ad54")}{" "}</button>
            <button
              type="button"
              className={`${styles.closeBtn} ${styles.toolbarBtn} ${styles.switchBtnFactures}`}
              onClick={() => router.push("/dashboard/factures/new")}
            >
              {i18nT("factures_da35e4f2")}{" "}</button>
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
              {i18nT("devis_fige_1ce0a430")}{" "}<strong>{number || "—"}</strong>
              {finalizedAt ? (
                <> {" "}{i18nT("fige_le_c496e646")}{" "}{new Date(finalizedAt).toLocaleString("fr-FR")}</>
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
                padding: "clamp(12px, 4vh, 32px) 18px",
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
                  background: "#0b1220",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 16,
                  padding: 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    padding: "14px 14px 10px",
                    background: "#0b1220",
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
                    background: "#0b1220",
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
                      {i18nT("aucune_sauvegarde_pour_l_instant_a1039fd6")}{" "}</div>
                  ) : (
                    <div
                      style={{
                        padding: 14,
                        minWidth: 0,
                        overflowX: "hidden",
                        display: "grid",
                        gap: 8,
                        maxHeight: drafts.length > 10 ? "62vh" : undefined,
                        overflowY: drafts.length > 10 ? "auto" : undefined,
                        paddingRight: drafts.length > 10 ? 8 : 14,
                      }}
                    >
                      {drafts.map((d) => {
                        const s = d.snapshot;
                        const label = `${s.number || "(sans numéro)"} — ${s.clientName || "Client"}`;
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
                              padding: "10px 12px",
                              border: "1px solid rgba(255,255,255,0.12)",
                              borderRadius: 12,
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
                                onClick={() =>
                                  router.push(
                                    `/dashboard/factures/new?fromDevisSaveId=${encodeURIComponent(d.id)}`,
                                  )
                                }
                              >
                                {i18nT("facture_8c62da5d")}{" "}</button>
                              <button
                                type="button"
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
                    {i18nT("aucun_modele_de_devis_pour_l_68edf039")}{" "}</div>
                ) : (
                  <div
                    style={{
                      padding: 14,
                      display: "grid",
                      gap: 8,
                      maxHeight: templates.length > 10 ? "62vh" : undefined,
                      overflowY: templates.length > 10 ? "auto" : undefined,
                      paddingRight: templates.length > 10 ? 8 : 14,
                    }}
                  >
                    {templates.map((d) => {
                      const label =
                        d.snapshot.templateName || d.name || "Modèle devis";
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
                            padding: "10px 12px",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 12,
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
            crmContainerRef={crmBoxRef}
            crmLoading={crmLoading}
            crmOpen={crmOpen}
            onToggleCrm={() => setCrmOpen((value) => !value)}
            crmButtonText={crmButtonText}
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
            }}
            fieldErrors={fieldErrors}
            addingToCrm={addingToCrm}
            addToCrmDisabled={addingToCrm}
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
              clearFieldError("clientEmail");
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
            showOptionalSirenLabel
          />
          <div className={styles.formBlock}>
            <div className={styles.formBlockHeader}>
              <div>
                <div className={styles.formBlockTitleRow}>
                  <span className={styles.formBlockIcon} aria-hidden="true">
                    📄
                  </span>
                  <div className={styles.formBlockTitle}>{i18nT("infos_devis_ea800066")}</div>
                </div>
                <div className={styles.formBlockSubtitle}>
                  {i18nT("numero_date_options_avancees_et_actions_0f9de5c4")}{" "}</div>
              </div>
            </div>

            <div className={styles.twoCol}>
              <div className={styles.field}>
                <label>
                  {i18nT("numero_de_devis_fefc5f0c")}<span className={styles.requiredMark}>*</span>
                </label>
                <input
                  value={number}
                  onChange={(e) => {
                    setNumber(e.target.value);
                    clearFieldError("number");
                  }}
                  placeholder="DEV-YYYYMMDD-XXXX"
                />
                {fieldErrors.number ? (
                  <div className={styles.fieldError}>{fieldErrors.number}</div>
                ) : null}
              </div>

              <div className={styles.field}>
                <label>
                  {i18nT("date_du_devis_0029f3d6")}<span className={styles.requiredMark}>*</span>
                </label>
                <DocumentDateInput
                  value={docDateISO}
                  onChange={(value) => {
                    setDocDateISO(value);
                    clearFieldError("docDateISO");
                  }}
                />
                {fieldErrors.docDateISO ? (
                  <div className={styles.fieldError}>
                    {fieldErrors.docDateISO}
                  </div>
                ) : null}
              </div>
            </div>

            <details
              className={styles.advancedDetails}
              open={advancedOpen}
              onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
            >
              <summary className={styles.advancedSummary}>
                {i18nT("options_avancees_du_devis_729e502e")}{" "}</summary>
              <div className={styles.advancedBody}>
                <div className={styles.advancedSection}>
                  <div className={styles.advancedSectionTitle}>{i18nT("document_e214b8a2")}</div>
                  <div className={styles.compactThreeCol}>
                    <div className={styles.field}>
                      <label>
                        {i18nT("duree_de_validite_jours_f911e91b")}{" "}<span className={styles.requiredMark}>*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={validityDays}
                        onChange={(e) => {
                          setValidityDays(Number(e.target.value) || 1);
                          clearFieldError("validityDays");
                        }}
                      />
                      {fieldErrors.validityDays ? (
                        <div className={styles.fieldError}>
                          {fieldErrors.validityDays}
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.field}>
                      <label>{i18nT("categorie_d_operation_298de450")}</label>
                      <select
                        value={operationCategory}
                        onChange={(e) =>
                          setOperationCategory(
                            e.target
                              .value as (typeof OPERATION_CATEGORY_OPTIONS)[number]["key"],
                          )
                        }
                      >
                        {OPERATION_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.labelKey ? i18nT(option.labelKey) : "—"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>{i18nT("reference_commande_po_b40bb4c5")}</label>
                      <input
                        value={purchaseOrderReference}
                        onChange={(e) =>
                          setPurchaseOrderReference(e.target.value)
                        }
                        placeholder={i18nT("ex_bc_2026_014_po_7781_fa20f4e5")}
                      />
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
                        disabled={!depositKind}
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
                    />
                  </div>
                </div>

                <div className={styles.advancedSection}>
                  <div className={styles.advancedSectionTitle}>{i18nT("prestation_b51f479f")}</div>
                  <ServiceDateFields
                    radioName="devisServiceDateMode"
                    mode={serviceDateMode}
                    onModeChange={updateServiceDateMode}
                    serviceDate={serviceDate}
                    onServiceDateChange={setServiceDate}
                    servicePeriodStart={servicePeriodStart}
                    onServicePeriodStartChange={setServicePeriodStart}
                    servicePeriodEnd={servicePeriodEnd}
                    onServicePeriodEndChange={setServicePeriodEnd}
                  />
                </div>

                <NotesAndMentionsSection
                  notes={notes}
                  onNotesChange={setNotes}
                  mentionLabel={i18nT("mention_specifique_devis_5aa3c7d0")}
                  mention={quoteMention}
                  onMentionChange={setQuoteMention}
                  mentionPlaceholder={i18nT("ex_devis_valable_selon_disponibilite_2cc98990")}
                />
              </div>
            </details>

            <div className={styles.actionGrid}>
              <button
                type="button"
                onClick={() => {
                  void saveDraft();
                }}
                disabled={addingToCrm || finalizing}
              >
                <>
                  {i18nT("sauvegarder_9ada1439")}{" "}<span
                    className={styles.helpBubble}
                    title={i18nT("retrouvez_vos_sauvegardes_dans_devis_documents_8299724c")}
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
                disabled={addingToCrm || finalizing}
              >
                <>
                  {i18nT("creer_modele_386adb21")}{" "}<span
                    className={styles.helpBubble}
                    title={i18nT("retrouvez_vos_modeles_dans_devis_documents_bf383e21")}
                  >
                    ?
                  </span>
                </>
              </button>
              <button
                type="button"
                onClick={() => void convertCurrentDevisToInvoice()}
                disabled={finalizing}
              >
                {i18nT("convertir_en_facture_8db757b8")}{" "}</button>
              <button
                type="button"
                disabled={finalizing}
                onClick={async () => {
                  if (!validateQuoteAction({ requireEmail: true })) return;
                  if (!isFinalized) {
                    const ok = await confirmInrcy({
                      title: i18nT("figer_le_devis_7830ece8"),
                      message:
                        i18nT("l_envoi_par_mail_va_figer_c1a0ab4c"),
                      confirmLabel: i18nT("figer_et_envoyer_87694ed8"),
                      variant: "warning",
                    });
                    if (!ok) return;
                  }
                  const to = (clientEmail || "").trim();
                  const finalNumber = number || generateNumber("DEV");
                  if (!number) setNumber(finalNumber);

                  await uploadPdfAndOpenCompose(to, `${finalNumber}.pdf`);
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
              <button type="button" onClick={print} disabled={finalizing}>
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
              <div className={styles.title}>{documentClientTexts.titles.quote}</div>
              <div>{number || "—"}</div>
              <div style={{ marginTop: 6, color: "#444" }}>
                {documentClientTexts.labels.date} :{" "}
                {docDateISO
                  ? formatDocumentDate(docDateISO)
                  : "—"}
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
                  style={{ width: 44 }}
                ></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <input
                      className={styles.printHidden}
                      value={l.label}
                      onChange={(e) =>
                        updateLine(l.id, { label: e.target.value })
                      }
                      placeholder={i18nT("ex_entretien_boite_de_vitesse_e53c0c8d")}
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
                        updateLine(l.id, { unitPrice: Number(e.target.value) })
                      }
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
                      disabled={vatDispense}
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
              height: `${getQuotePrintFooterSpacerMm(lines.length)}mm`,
            }}
          />

          <div className={styles.previewFinalFooter}>
            <div
              className={styles.previewBottomGrid}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 260px",
                marginTop: 18,
                gap: 24,
              }}
            >
            <div style={{ fontSize: 12, color: "#444", lineHeight: 1.4 }}>
              <div>
                {documentClientTexts.labels.pricesInCurrency(clientExchangePreferences.currency)}{" "}
                {documentClientTexts.labels.quoteValidity(validityDays)}
              </div>
              {paymentMethod || paymentDetails ? (
                <div style={{ marginTop: 6 }}>
                  <strong>{documentClientTexts.labels.payment} :</strong> {paymentLabel}
                  {paymentDetails ? <> — {paymentDetails}</> : null}
                </div>
              ) : null}
              {notes ? <div style={{ marginTop: 6 }}>{notes}</div> : null}
              {quoteMention ? (
                <div style={{ marginTop: 6 }}>{quoteMention}</div>
              ) : null}
              {operationCategory ? (
                <div style={{ marginTop: 6 }}>
                  <strong>{documentClientTexts.labels.category} :</strong>{" "}
                  {
                    operationCategoryLabel
                  }
                </div>
              ) : null}
              {serviceDateMode === "single" && serviceDate ? (
                <div style={{ marginTop: 6 }}>
                  <strong>{documentClientTexts.labels.serviceDateDelivery} :</strong>{" "}
                  {formatDocumentDate(serviceDate)}
                </div>
              ) : null}
              {serviceDateMode === "period" &&
              (servicePeriodStart || servicePeriodEnd) ? (
                <div style={{ marginTop: 6 }}>
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
                <div style={{ marginTop: 6 }}>
                  <strong>{documentClientTexts.labels.purchaseOrderReference} :</strong>{" "}
                  {purchaseOrderReference}
                </div>
              ) : null}
              {depositKind && depositValue ? (
                <div style={{ marginTop: 6 }}>
                  <strong>{documentClientTexts.labels.depositRequested} :</strong>{" "}
                  {depositKind === "amount"
                    ? formatDocumentMoney(Number(depositValue) || 0)
                    : `${depositValue} %`}
                </div>
              ) : null}
              {vatDispense ? (
                <div style={{ marginTop: 6 }}>
                  <strong>{documentClientTexts.labels.vatNotApplicable}</strong> {" "}{i18nT("article_293_b_du_cgi_da0560a3")}{" "}</div>
              ) : null}
            </div>

            <div className={styles.previewTotalsBox}>
              <div className={styles.noPrint} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 650, marginBottom: 6 }}>
                  {i18nT("remise_commerciale_c3564bdc")}{" "}</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr",
                    gap: 8,
                  }}
                >
                  <select
                    value={discountKind}
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
                    disabled={!discountKind}
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
                    disabled={!discountKind}
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
            </div>
          </div>

          {/* ✅ Bon pour accord / Signature */}
          <div
            className={styles.previewSignatureGrid}
            style={{
              marginTop: 18,
              display: "grid",
              gridTemplateColumns: "1fr 260px",
              gap: 24,
              alignItems: "end",
            }}
          >
            <div />
            <div
              className={styles.previewSignatureBox}
              style={{
                border: "2px solid #111",
                borderRadius: 12,
                padding: 12,
                minHeight: 90,
              }}
            >
              <div style={{ fontWeight: 750, marginBottom: 6 }}>
                {documentClientTexts.labels.goodForAgreement}
              </div>
              <div style={{ fontSize: 12, color: "#444" }}>{documentClientTexts.labels.signature} :</div>
            </div>
          </div>
          </div>

          <div className={styles.documentPrintPages} aria-hidden="true">
            {quotePrintPages.map((page, pageIndex) => (
              <section
                key={`quote-print-page-${pageIndex}`}
                className={styles.documentPrintPage}
              >
                {page.includeHeader ? (
                  <>
                    <div className={styles.previewHeader}>
                      <div>
                        <div className={styles.title}>{documentClientTexts.titles.quote}</div>
                        <div>{number || "—"}</div>
                        <div style={{ marginTop: 6, color: "#444" }}>
                          {documentClientTexts.labels.date} : {docDateISO ? formatDocumentDate(docDateISO) : "—"}
                        </div>
                        {serviceDateMode === "single" && serviceDate ? (
                          <div style={{ marginTop: 4, color: "#444" }}>{documentClientTexts.labels.serviceDelivery} : {formatDocumentDate(serviceDate)}</div>
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
                        <div>{documentClientTexts.labels.pricesInCurrency(clientExchangePreferences.currency)} {documentClientTexts.labels.quoteValidity(validityDays)}</div>
                        {paymentMethod || paymentDetails ? <div style={{ marginTop: 6 }}><strong>{documentClientTexts.labels.payment} :</strong> {paymentLabel}{paymentDetails ? <> — {paymentDetails}</> : null}</div> : null}
                        {notes ? <div style={{ marginTop: 6 }}>{notes}</div> : null}
                        {quoteMention ? <div style={{ marginTop: 6 }}>{quoteMention}</div> : null}
                        {operationCategory ? <div style={{ marginTop: 6 }}><strong>{documentClientTexts.labels.category} :</strong> {operationCategoryLabel}</div> : null}
                        {serviceDateMode === "single" && serviceDate ? <div style={{ marginTop: 6 }}><strong>{documentClientTexts.labels.serviceDateDelivery} :</strong> {formatDocumentDate(serviceDate)}</div> : null}
                        {serviceDateMode === "period" && (servicePeriodStart || servicePeriodEnd) ? <div style={{ marginTop: 6 }}><strong>{documentClientTexts.labels.servicePeriod} :</strong> {servicePeriodStart ? formatDocumentDate(servicePeriodStart) : "—"}{servicePeriodEnd ? ` → ${formatDocumentDate(servicePeriodEnd)}` : ""}</div> : null}
                        {purchaseOrderReference ? <div style={{ marginTop: 6 }}><strong>{documentClientTexts.labels.purchaseOrderReference} :</strong> {purchaseOrderReference}</div> : null}
                        {depositKind && depositValue ? <div style={{ marginTop: 6 }}><strong>{documentClientTexts.labels.depositRequested} :</strong> {depositKind === "amount" ? formatDocumentMoney(Number(depositValue) || 0) : `${depositValue} %`}</div> : null}
                        {vatDispense ? <div style={{ marginTop: 6 }}><strong>{documentClientTexts.labels.vatNotApplicable}</strong> {" "}{i18nT("article_293_b_du_cgi_da0560a3")}</div> : null}
                      </div>
                      <div className={styles.previewTotalsBox}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>{documentClientTexts.labels.totalHT}</span><strong>{formatDocumentMoney(totals.totalHT)}</strong></div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span>{documentClientTexts.labels.totalVAT}</span><strong>{formatDocumentMoney(totals.totalTVA)}</strong></div>
                        <div className={styles.previewTotalsMain} style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 18 }}><span>{documentClientTexts.labels.totalTTC}</span><strong>{formatDocumentMoney(totals.totalTTC)}</strong></div>
                        {totals.discountTTC > 0 ? <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}><span>{documentClientTexts.labels.discount}</span><strong>- {formatDocumentMoney(totals.discountTTC)}</strong></div> : null}
                        {discountDetails && totals.discountTTC > 0 ? <div style={{ fontSize: 12, color: "#444", marginTop: 4 }}>{discountDetails}</div> : null}
                        {totals.discountTTC > 0 ? <div className={styles.previewTotalsMain} style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 18 }}><span>{documentClientTexts.labels.totalDue}</span><strong>{formatDocumentMoney(totals.totalDue)}</strong></div> : null}
                      </div>
                    </div>
                    <div className={styles.previewSignatureGrid}>
                      <div />
                      <div className={styles.previewSignatureBox} style={{ border: "2px solid #111", borderRadius: 12, padding: 12, minHeight: 90 }}>
                        <div style={{ fontWeight: 750, marginBottom: 6 }}>{documentClientTexts.labels.goodForAgreement}</div>
                        <div style={{ fontSize: 12, color: "#444" }}>{documentClientTexts.labels.signature} :</div>
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
