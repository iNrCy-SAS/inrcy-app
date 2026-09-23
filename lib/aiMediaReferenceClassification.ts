export type AiMediaReferenceRole = "character" | "environment" | "product";

export function inferRequiredReferenceRole(fileName: string): AiMediaReferenceRole {
  const normalized = String(fileName || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
  if (/person|portrait|visage|equipe|team|collaborateur|dirigeant/.test(normalized)) {
    return "character";
  }
  if (/decor|lieu|local|boutique|atelier|bureau|environment/.test(normalized)) {
    return "environment";
  }
  return "product";
}

export function classifyAppendedReference(args: {
  fileName: string;
  detectedPerson: boolean | null;
}): { role: AiMediaReferenceRole; usage: "required" | "inspiration" } {
  const nameRole = inferRequiredReferenceRole(args.fileName);
  const role = args.detectedPerson === true
    ? "character"
    : args.detectedPerson === false && nameRole === "character"
      ? "product"
      : nameRole;
  return {
    role,
    usage: role === "character" ? "required" : "inspiration",
  };
}
