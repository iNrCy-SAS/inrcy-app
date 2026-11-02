import { LineItem, uid } from "./docUtils";
export { prepareCommercialTemplateSnapshot as prepareTemplateSnapshot } from "@/lib/commercialDocumentTemplate";

export function hasReusableDocumentLine(lines: LineItem[]) {
  return Array.isArray(lines) && lines.some((line) => (line.label || "").trim() && Number(line.qty) > 0 && Number(line.unitPrice) >= 0);
}

export function cloneDocumentLines(lines: LineItem[]) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({ ...line, id: uid("l") }));
}
