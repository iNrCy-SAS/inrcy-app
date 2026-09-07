function normalizedInstruction(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .slice(0, 800);
}

/**
 * Le numéro professionnel reste hors du prompt et n'est utilisé que lorsque
 * la consigne ponctuelle demande explicitement de l'afficher dans le visuel.
 */
export function isAiMediaProfilePhoneDisplayRequested(value: unknown) {
  const original = String(value ?? "");
  const instruction = normalizedInstruction(original);
  if (!instruction) return false;

  const phoneSignal =
    /\b(?:numero(?:\s+de)?\s+(?:telephone|tel|contact)|coordonnees?(?:\s+telephoniques?)?|telephone|tel|phone(?:\s+number)?|whatsapp|telefono|telefonnummer|telefon|telefone|telefoonnummer)\b/.test(
      instruction,
    ) ||
    /\b(?:mon|notre|votre|son|leur)\s+numero\b/.test(instruction) ||
    /(?:^|\D)\+?\d(?:[\s()./-]*\d){5,}(?=\D|$)/.test(instruction) ||
    /(?:电话号码|联系电话|手机号|โทรศัพท์|เบอร์โทร|หมายเลขโทรศัพท์)/u.test(original);
  if (!phoneSignal) return false;

  const physicalDeviceOnly =
    /\b(?:smartphone|telephone\s+(?:portable|mobile)|ecran\s+(?:du|de)\s+telephone|dans\s+la\s+main|sur\s+(?:la\s+)?table|sur\s+(?:le\s+)?bureau)\b/.test(
      instruction,
    ) &&
    !/\b(?:numero|coordonnees|du\s+pro|professionnel|entreprise|profil|appeler|joindre|contact|whatsapp)\b/.test(
      instruction,
    );
  if (physicalDeviceOnly) return false;

  const negativeSignal =
    /\b(?:sans|pas\s+de|masquer|cacher|retirer|supprimer|omettre|exclure|without|hide|remove|exclude|sin|ocultar|quitar|ohne|verbergen|entfernen|sem|esconder|rimuovere)\b.{0,45}\b(?:numero|coordonnees|telephone|tel|phone|whatsapp|telefono|telefon|telefone|telefoonnummer)\b/.test(
      instruction,
    ) ||
    /\b(?:ne|n)\b.{0,35}\b(?:pas|jamais|plus)\b.{0,55}\b(?:numero|coordonnees|telephone|tel|phone|whatsapp)\b/.test(
      instruction,
    ) ||
    /(?:不要|不显示|隐藏).{0,12}(?:电话号码|联系电话|手机号)|(?:ไม่|ห้าม).{0,18}(?:โทรศัพท์|เบอร์โทร)/u.test(
      original,
    );
  if (negativeSignal) return false;

  const displaySignal =
    /\b(?:affich\w*|ajout\w*|integr\w*|inscri\w*|ecri\w*|mentionn\w*|met(?:s|tre|tons|tez|tent|tr\w*)?|mett\w*|plac\w*|indiqu\w*|figur\w*|visible|display\w*|show\w*|add\w*|include\w*|write\w*|put\w*|mostrar\w*|anad\w*|poner\w*|incluir\w*|anzeigen\w*|hinzufug\w*|zeigen\w*|adicionar\w*|inserir\w*)\b/.test(
      instruction,
    ) ||
    /\b(?:sur|dans|on|in)\s+(?:l\s+|the\s+)?(?:image|visuel|media|photo|affiche|creation|visual|picture|design)\b/.test(
      instruction,
    ) ||
    /(?:显示|添加|写上|放在).{0,18}(?:电话号码|联系电话|手机号)|(?:แสดง|เพิ่ม|ใส่).{0,22}(?:โทรศัพท์|เบอร์โทร)/u.test(
      original,
    );

  return displaySignal;
}

/** Retourne uniquement le numéro réellement enregistré, jamais celui du brief. */
export function cleanAiMediaProfilePhone(value: unknown) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (!normalized) return "";

  const direct = /^[+\d][\d\s().\-/]{4,38}\d$/.test(normalized)
    ? normalized
    : normalized.match(/\+?\d[\d\s().\-/]{4,38}\d/)?.[0]?.trim() || "";
  const digitCount = direct.replace(/\D/g, "").length;
  return digitCount >= 6 && digitCount <= 18 ? direct : "";
}
