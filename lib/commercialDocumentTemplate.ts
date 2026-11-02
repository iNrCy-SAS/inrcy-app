/** Shared native template projection. Client identity and official document state are never copied. */
export type CommercialTemplateKind = "quote" | "invoice";
const common = ["providerOverride", "vatDispense", "operationCategory", "serviceDateMode", "purchaseOrderReference", "depositKind", "depositValue", "paymentMethod", "paymentDetails", "notes", "discountKind", "discountDetails"];
const specific = { quote: ["quoteMention", "validityDays"], invoice: ["vatOnDebits", "lateFeeRate", "fixedRecoveryFee40", "documentKind", "invoiceMention"] };
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function prepareCommercialTemplateSnapshot<T extends Record<string, unknown>>(snapshot: Partial<T>, templateName: string): T {
  return { ...snapshot, number: "", invoiceDate: "", docDateISO: "", dueDate: "", clientName: "", clientAddress: "",
    billingAddress: "", billingPostalCode: "", billingCity: "", deliveryAddress: "", deliveryPostalCode: "", deliveryCity: "",
    sameAddresses: true, clientEmail: "", clientSiren: "", clientVatNumber: "", clientType: "", status: "brouillon",
    isFinalized: false, finalizedAt: null, lockedAt: null, isTemplate: true, templateName } as unknown as T;
}

export function createCommercialTemplateSnapshot(kind: CommercialTemplateKind, value: unknown, templateName: string, lineId: (index: number) => string) {
  const source = row(value);
  if (!templateName.trim() || templateName.length > 120 || !["quote", "invoice"].includes(kind) || !Array.isArray(source.lines) || source.lines.length > 200 ||
    !source.lines.some(value => { const line = row(value); return typeof line.label === "string" && line.label.trim() && Number(line.qty) > 0 && Number(line.unitPrice) >= 0; })) throw new Error("Ajoutez au moins une prestation valide et un nom de modèle.");
  const snapshot: Record<string, unknown> = Object.fromEntries([...common, ...specific[kind]].filter(key => key in source).map(key => [key, source[key]]));
  snapshot.serviceDate = source.serviceDateMode === "single" ? source.serviceDate : "";
  snapshot.servicePeriodStart = source.serviceDateMode === "period" ? source.servicePeriodStart : "";
  snapshot.servicePeriodEnd = source.serviceDateMode === "period" ? source.servicePeriodEnd : "";
  snapshot.lines = source.lines.map((value, index) => ({ ...row(value), id: lineId(index) }));
  snapshot.discountValue = Number(source.discountValue) || 0;
  return prepareCommercialTemplateSnapshot(snapshot, templateName.trim());
}
