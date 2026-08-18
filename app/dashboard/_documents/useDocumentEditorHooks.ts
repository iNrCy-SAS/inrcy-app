"use client";

import { useTranslations } from "next-intl";


import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  DEFAULT_INRDOCUMENTS_SETTINGS,
  type InrDocumentsSettings,
} from "@/lib/inrdocumentsSettings";
import {
  DEFAULT_CLIENT_EXCHANGE_PREFERENCES,
  buildClientExchangePreferences,
  formatClientCurrency,
  formatClientDateOnly,
  getDocumentClientTexts,
  type ClientExchangePreferences,
} from "@/lib/clientCommunication";
import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { resolveProfileLogoUrl } from "@/lib/profileLogo";
import { createClient } from "@/lib/supabaseClient";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { useUnsavedExitGuard } from "../_hooks/useUnsavedExitGuard";
import {
  OPERATION_CATEGORY_OPTIONS,
  buildFullCrmAddress,
  normalizeAddressPart,
  normalizeClientType,
  splitFrenchAddress,
  type ClientType,
  type CrmContact,
  type Profile,
  type ServiceDateMode,
} from "./documentEditorShared";
import { uid, type DiscountKind, type LineItem } from "./docUtils";

export function useDocumentSettingsPanel() {
  const i18nT = useTranslations("documents");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsHasUnsavedChanges, setSettingsHasUnsavedChanges] =
    useState(false);

  useEffect(() => {
    if (!settingsOpen) setSettingsHasUnsavedChanges(false);
  }, [settingsOpen]);

  const { confirmExit: confirmSettingsExit } = useUnsavedExitGuard({
    active: settingsOpen,
    shouldBlock: settingsHasUnsavedChanges,
    onConfirmExit: () => setSettingsOpen(false),
    eyebrow: i18nT("reglages_par_defaut_6d661a73"),
    title: i18nT("quitter_sans_enregistrer_6208bd94"),
    message:
      i18nT("ces_reglages_contiennent_des_modifications_non_a3c8a17d"),
    confirmLabel: i18nT("fermer_sans_enregistrer_15fdc373"),
    cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
    variant: "warning",
  });

  const requestCloseSettings = useCallback(() => {
    void confirmSettingsExit();
  }, [confirmSettingsExit]);

  const [documentsSettings, setDocumentsSettings] =
    useState<InrDocumentsSettings>(DEFAULT_INRDOCUMENTS_SETTINGS);

  return {
    settingsOpen, setSettingsOpen, settingsHasUnsavedChanges,
    setSettingsHasUnsavedChanges, requestCloseSettings,
    documentsSettings, setDocumentsSettings,
  };
}

export function useDocumentProviderPreferences() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [clientExchangePreferences, setClientExchangePreferences] =
    useState<ClientExchangePreferences>(DEFAULT_CLIENT_EXCHANGE_PREFERENCES);
  const [isEditingProvider, setIsEditingProvider] = useState(false);
  const [providerOverride, setProviderOverride] = useState<Partial<Profile>>({});
  const vatDispense = !!profile?.vat_dispense;
  const providerData = {
    ...(profile || {}),
    ...(providerOverride || {}),
  } as Profile;

  const documentClientTexts = useMemo(
    () => getDocumentClientTexts(clientExchangePreferences.clientLanguage),
    [clientExchangePreferences.clientLanguage],
  );
  const formatDocumentDate = useCallback(
    (iso: string | null | undefined) =>
      formatClientDateOnly(iso, clientExchangePreferences),
    [clientExchangePreferences],
  );
  const formatDocumentMoney = useCallback(
    (value: number) =>
      formatClientCurrency(value, clientExchangePreferences),
    [clientExchangePreferences],
  );

  return {
    profile, setProfile, clientExchangePreferences, setClientExchangePreferences,
    isEditingProvider, setIsEditingProvider, providerOverride, setProviderOverride,
    vatDispense, providerData, documentClientTexts,
    formatDocumentDate, formatDocumentMoney,
  };
}

export function useDocumentClientForm() {
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientSiren, setClientSiren] = useState("");
  const [clientVatNumber, setClientVatNumber] = useState("");
  const [clientType, setClientType] = useState<ClientType>("");
  const [billingAddress, setBillingAddress] = useState("");
  const [billingPostalCode, setBillingPostalCode] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPostalCode, setDeliveryPostalCode] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [sameAddresses, setSameAddresses] = useState(true);
  const [operationCategory, setOperationCategory] =
    useState<(typeof OPERATION_CATEGORY_OPTIONS)[number]["key"]>("");
  const [serviceDateMode, setServiceDateMode] =
    useState<ServiceDateMode>("single");
  const [serviceDate, setServiceDate] = useState("");
  const [servicePeriodStart, setServicePeriodStart] = useState("");
  const [servicePeriodEnd, setServicePeriodEnd] = useState("");
  const [purchaseOrderReference, setPurchaseOrderReference] = useState("");
  const [depositKind, setDepositKind] =
    useState<"" | "percent" | "amount">("");
  const [depositValue, setDepositValue] = useState("");
  const [discountKind, setDiscountKind] = useState<DiscountKind | "">("");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountDetails, setDiscountDetails] = useState<string>("");

  const updateServiceDateMode = (mode: ServiceDateMode) => {
    setServiceDateMode(mode);
    if (mode === "single") {
      setServicePeriodStart("");
      setServicePeriodEnd("");
    } else {
      setServiceDate("");
    }
  };

  const billingFullAddress = buildFullCrmAddress(
    billingAddress,
    billingPostalCode,
    billingCity,
  );
  const deliveryFullAddress = buildFullCrmAddress(
    deliveryAddress,
    deliveryPostalCode,
    deliveryCity,
  );

  const setPrimaryClientAddress = (value: string) => {
    const parsed = splitFrenchAddress(value);
    setBillingAddress(parsed.address);
    setBillingPostalCode(parsed.postal_code);
    setBillingCity(parsed.city);
    setClientAddress(
      buildFullCrmAddress(parsed.address, parsed.postal_code, parsed.city),
    );
    if (sameAddresses) {
      setDeliveryAddress(parsed.address);
      setDeliveryPostalCode(parsed.postal_code);
      setDeliveryCity(parsed.city);
    }
  };

  useEffect(() => {
    const full = buildFullCrmAddress(
      billingAddress,
      billingPostalCode,
      billingCity,
    );
    setClientAddress(full);
    if (!sameAddresses) return;
    setDeliveryAddress(billingAddress);
    setDeliveryPostalCode(billingPostalCode);
    setDeliveryCity(billingCity);
  }, [sameAddresses, billingAddress, billingPostalCode, billingCity]);

  return {
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
  };
}

type FormMessage = {
  type: "error" | "success";
  text: string;
};

export function useDocumentCrmUiState<
  TFieldErrors extends object,
>() {
  const [crmContacts, setCrmContacts] = useState<CrmContact[]>([]);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [selectedCrmContactId, setSelectedCrmContactId] = useState<string>("");
  const [formMessage, setFormMessage] = useState<FormMessage | null>(null);
  const [crmActionMessage, setCrmActionMessage] =
    useState<FormMessage | null>(null);
  const [fieldErrors, setFieldErrors] = useState<TFieldErrors>({} as TFieldErrors);
  const [addingToCrm, setAddingToCrm] = useState(false);
  const [currentSaveId, setCurrentSaveId] = useState<string>("");
  const [crmOpen, setCrmOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [crmQuery, setCrmQuery] = useState("");
  const crmContainerRef = useRef<HTMLDivElement | null>(null);

  return {
    crmContacts, setCrmContacts, crmLoading, setCrmLoading,
    crmError, setCrmError, selectedCrmContactId, setSelectedCrmContactId,
    formMessage, setFormMessage, crmActionMessage, setCrmActionMessage,
    fieldErrors, setFieldErrors, addingToCrm, setAddingToCrm,
    currentSaveId, setCurrentSaveId, crmOpen, setCrmOpen,
    advancedOpen, setAdvancedOpen, crmQuery, setCrmQuery,
    crmContainerRef,
  };
}

type LineFieldErrors = { lines?: string };

export function useDocumentLineEditor<TFieldErrors extends LineFieldErrors>({
  vatDispense,
  initialUnitPrice,
  setFieldErrors,
}: {
  vatDispense: boolean;
  initialUnitPrice: number;
  setFieldErrors: Dispatch<SetStateAction<TFieldErrors>>;
}) {
  const i18nT = useTranslations("documents");
  const [lines, setLines] = useState<LineItem[]>([
    {
      id: "l_1",
      label: i18nT("prestation_b51f479f"),
      qty: 1,
      unitPrice: initialUnitPrice,
      vatRate: 20,
    },
  ]);

  const clearFieldError = (field: keyof TFieldErrors) => {
    setFieldErrors((prev) =>
      prev[field] ? { ...prev, [field]: undefined } : prev,
    );
  };

  const addLine = () => {
    clearFieldError("lines");
    setLines((prev) => [
      ...prev,
      {
        id: uid("l"),
        label: "",
        qty: 1,
        unitPrice: 0,
        vatRate: vatDispense ? 0 : 20,
      },
    ]);
  };

  const removeLine = (id: string) => {
    clearFieldError("lines");
    setLines((prev) =>
      prev.length > 1 ? prev.filter((line) => line.id !== id) : prev,
    );
  };

  const updateLine = (id: string, patch: Partial<LineItem>) => {
    clearFieldError("lines");
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  };

  return { lines, setLines, addLine, removeLine, updateLine, clearFieldError };
}

function normalizeCrmLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function getDocumentCrmContactLabel(contact: CrmContact) {
  return (
    (contact.company_name && contact.company_name.trim()) ||
    [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() ||
    (contact.last_name || "").trim() ||
    (contact.email || "").trim() ||
    "—"
  );
}

function getDocumentCrmContactSearchText(contact: CrmContact) {
  return [
    getDocumentCrmContactLabel(contact),
    contact.email,
    contact.phone,
    contact.address,
    contact.billing_address,
    contact.delivery_address,
    contact.city,
    contact.postal_code,
    contact.siret,
    contact.vat_number,
  ]
    .filter(Boolean)
    .join(" ");
}

export function useDocumentCrmDirectory({
  contacts,
  query,
  selectedContactId,
  normalizeSortLabel,
}: {
  contacts: CrmContact[];
  query: string;
  selectedContactId: string;
  normalizeSortLabel: boolean;
}) {
  const sortedCrmContacts = useMemo(() => {
    const copy = [...contacts];
    copy.sort((a, b) => {
      const aLabel = getDocumentCrmContactLabel(a);
      const bLabel = getDocumentCrmContactLabel(b);
      const aKey = normalizeSortLabel ? normalizeCrmLabel(aLabel) : aLabel;
      const bKey = normalizeSortLabel ? normalizeCrmLabel(bLabel) : bLabel;
      return aKey.localeCompare(bKey, "fr", { sensitivity: "base" });
    });
    return copy;
  }, [contacts, normalizeSortLabel]);

  const filteredCrmContacts = useMemo(() => {
    const normalizedQuery = normalizeCrmLabel(query);
    if (!normalizedQuery) return sortedCrmContacts;
    return sortedCrmContacts.filter((contact) =>
      normalizeCrmLabel(getDocumentCrmContactSearchText(contact)).includes(
        normalizedQuery,
      ),
    );
  }, [query, sortedCrmContacts]);

  const selectedCrmContact = useMemo(() => {
    if (!selectedContactId) return null;
    return (
      contacts.find(
        (contact) => String(contact.id) === String(selectedContactId),
      ) || null
    );
  }, [contacts, selectedContactId]);

  const selectedCrmLabel = selectedCrmContact
    ? getDocumentCrmContactLabel(selectedCrmContact) +
      (selectedCrmContact.email ? ` — ${selectedCrmContact.email}` : "")
    : "";

  return {
    sortedCrmContacts,
    filteredCrmContacts,
    selectedCrmContact,
    selectedCrmLabel,
  };
}

type SearchParamsReader = {
  get(name: string): string | null;
};

type DocumentClientFormApi = ReturnType<typeof useDocumentClientForm>;

type ClientPrefillForm = Pick<
  DocumentClientFormApi,
  | "setClientName"
  | "setClientAddress"
  | "setClientEmail"
  | "setClientSiren"
  | "setClientVatNumber"
  | "setBillingAddress"
  | "setBillingPostalCode"
  | "setBillingCity"
  | "setDeliveryAddress"
  | "setDeliveryPostalCode"
  | "setDeliveryCity"
>;

export function useDocumentClientQueryPrefill(
  searchParams: SearchParamsReader,
  form: ClientPrefillForm,
) {
  useEffect(() => {
    const name =
      searchParams.get("clientName") || searchParams.get("name") || "";
    const email =
      searchParams.get("clientEmail") || searchParams.get("email") || "";
    const address =
      searchParams.get("clientAddress") || searchParams.get("address") || "";
    const siren = searchParams.get("clientSiren") || "";
    const vatNumber = searchParams.get("clientVatNumber") || "";
    const billing = searchParams.get("billingAddress") || "";
    const billingPostal =
      searchParams.get("billingPostalCode") ||
      searchParams.get("postal_code") ||
      "";
    const billingCityParam =
      searchParams.get("billingCity") || searchParams.get("city") || "";
    const delivery = searchParams.get("deliveryAddress") || "";

    if (name) form.setClientName((previous) => previous || name);
    if (email) form.setClientEmail((previous) => previous || email);
    if (siren) form.setClientSiren((previous) => previous || siren);
    if (vatNumber) form.setClientVatNumber((previous) => previous || vatNumber);

    if (address) {
      form.setClientAddress((previous) => previous || address);
      const parsed = splitFrenchAddress(billing || address);
      form.setBillingAddress((previous) => previous || parsed.address);
      form.setBillingPostalCode(
        (previous) => previous || billingPostal || parsed.postal_code,
      );
      form.setBillingCity(
        (previous) => previous || billingCityParam || parsed.city,
      );
      const parsedDelivery = splitFrenchAddress(delivery || billing || address);
      form.setDeliveryAddress(
        (previous) => previous || parsedDelivery.address,
      );
      form.setDeliveryPostalCode(
        (previous) => previous || billingPostal || parsedDelivery.postal_code,
      );
      form.setDeliveryCity(
        (previous) => previous || billingCityParam || parsedDelivery.city,
      );
      return;
    }

    if (billing) {
      const parsed = splitFrenchAddress(billing);
      form.setBillingAddress((previous) => previous || parsed.address);
      form.setBillingPostalCode(
        (previous) => previous || billingPostal || parsed.postal_code,
      );
      form.setBillingCity(
        (previous) => previous || billingCityParam || parsed.city,
      );
    }

    if (delivery) {
      const parsedDelivery = splitFrenchAddress(delivery);
      form.setDeliveryAddress(
        (previous) => previous || parsedDelivery.address,
      );
      form.setDeliveryPostalCode(
        (previous) => previous || billingPostal || parsedDelivery.postal_code,
      );
      form.setDeliveryCity(
        (previous) => previous || billingCityParam || parsedDelivery.city,
      );
    }
  }, []);
}

export function useDocumentCrmContactsLoader({
  setContacts,
  setLoading,
  setError,
}: {
  setContacts: Dispatch<SetStateAction<CrmContact[]>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}) {
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/crm/contacts?all=1", {
          method: "GET",
        });
        const json = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            getClientUserFacingErrorMessage(
              json?.error,
              "Impossible de charger les contacts CRM.",
            ),
          );
        }

        const contacts: CrmContact[] = Array.isArray(json?.contacts)
          ? json.contacts
          : [];
        if (!cancelled) setContacts(contacts);
      } catch (error: unknown) {
        if (!cancelled) {
          setError(
            getClientUserFacingErrorMessage(
              error,
              "Impossible de charger les contacts CRM.",
            ),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);
}

type CrmContactApplicationForm = Pick<
  DocumentClientFormApi,
  | "setClientName"
  | "setClientEmail"
  | "setClientSiren"
  | "setClientVatNumber"
  | "setClientType"
  | "setBillingAddress"
  | "setBillingPostalCode"
  | "setBillingCity"
  | "setClientAddress"
  | "setSameAddresses"
  | "setDeliveryAddress"
  | "setDeliveryPostalCode"
  | "setDeliveryCity"
>;

export function applyDocumentCrmContact(
  contact: CrmContact,
  form: CrmContactApplicationForm,
  unnamedLabel: string,
) {
  const contactLabel = getDocumentCrmContactLabel(contact);
  const displayName = contactLabel === "—" ? unnamedLabel : contactLabel;
  const billingParsed = splitFrenchAddress(
    contact.billing_address || contact.address || "",
  );
  const deliveryParsed = splitFrenchAddress(
    contact.delivery_address || contact.address || "",
  );
  const nextBillingPostal =
    normalizeAddressPart(contact.postal_code) || billingParsed.postal_code;
  const nextBillingCity =
    normalizeAddressPart(contact.city) || billingParsed.city;
  const fullAddress = buildFullCrmAddress(
    billingParsed.address,
    nextBillingPostal,
    nextBillingCity,
  );
  const fullDeliveryAddress = buildFullCrmAddress(
    deliveryParsed.address,
    nextBillingPostal,
    nextBillingCity,
  );

  form.setClientName(displayName);
  form.setClientEmail((contact.email || "").trim());
  form.setClientSiren((contact.siret || "").trim());
  form.setClientVatNumber((contact.vat_number || "").trim());
  form.setClientType(
    normalizeClientType(contact.category) ||
      (contact.siret || contact.company_name
        ? "professionnel"
        : "particulier"),
  );
  form.setBillingAddress(billingParsed.address);
  form.setBillingPostalCode(nextBillingPostal);
  form.setBillingCity(nextBillingCity);
  form.setClientAddress(fullAddress);

  if (fullDeliveryAddress && fullDeliveryAddress !== fullAddress) {
    form.setSameAddresses(false);
    form.setDeliveryAddress(deliveryParsed.address);
    form.setDeliveryPostalCode(nextBillingPostal);
    form.setDeliveryCity(nextBillingCity);
    return;
  }

  form.setSameAddresses(true);
  form.setDeliveryAddress(billingParsed.address);
  form.setDeliveryPostalCode(nextBillingPostal);
  form.setDeliveryCity(nextBillingCity);
}

export function useDocumentOutsideClose({
  active,
  containerRef,
  setOpen,
  eventTarget,
  attachWhenInactive = false,
}: {
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  eventTarget: "window" | "document";
  attachWhenInactive?: boolean;
}) {
  useEffect(() => {
    if (!attachWhenInactive && !active) return;

    const onDown = (event: MouseEvent) => {
      if (attachWhenInactive && !active) return;
      const element = containerRef.current;
      if (!element) return;
      if (event.target instanceof Node && !element.contains(event.target)) {
        setOpen(false);
      }
    };

    if (eventTarget === "window") {
      window.addEventListener("mousedown", onDown);
      return () => window.removeEventListener("mousedown", onDown);
    }

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [active, attachWhenInactive, containerRef, eventTarget, setOpen]);
}

type DocumentSupabaseClient = ReturnType<typeof createClient>;

export function useDocumentProfileLoader({
  supabase,
  setProfile,
  setClientExchangePreferences,
}: {
  supabase: DocumentSupabaseClient;
  setProfile: Dispatch<SetStateAction<Profile | null>>;
  setClientExchangePreferences: Dispatch<
    SetStateAction<ClientExchangePreferences>
  >;
}) {
  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) return;

      const { data } = await supabase
        .from("profiles")
        .select(
          "user_id,company_legal_name,hq_address,hq_zip,hq_city,contact_email,phone,siren,rcs_city,vat_number,vat_dispense,logo_url,logo_path",
        )
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .single();

      const { data: businessProfile } = await supabase
        .from("business_profiles")
        .select("client_language, timezone, date_format, currency, updated_at")
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setClientExchangePreferences(
        buildClientExchangePreferences(businessProfile),
      );

      const resolvedLogo = await resolveProfileLogoUrl(supabase, {
        logo_path: data?.logo_path ?? null,
        logo_url: data?.logo_url ?? null,
      });

      setProfile(
        data
          ? ({
              ...(data as Profile),
              logo_url: resolvedLogo.logoUrl,
              logo_path: resolvedLogo.logoPath,
            } as Profile)
          : null,
      );
    };

    void load();
  }, [supabase]);
}

export function useDocumentModalBodyLock(active: boolean) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [active]);
}
