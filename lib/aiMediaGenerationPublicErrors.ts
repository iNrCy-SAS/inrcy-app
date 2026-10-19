/** Public, allowlisted explanations shared by generation and read-only recovery.
 * Provider diagnostics are classification inputs only: never return their text.
 */
type Explanation = {
  status: number;
  reason: string;
  action: string;
  retryAfterSeconds?: number;
};

export const AI_MEDIA_PUBLIC_ERROR_CATALOG = {
  AI_MEDIA_CHARACTER_VOICE_INVALID: {
    status: 400,
    reason: "Un vocal de personnage est manquant, invalide ou expiré.",
    action: "Ajoutez à nouveau le vocal concerné et utilisez Wan 2.7 en mode Personnages.",
  },
  AI_MEDIA_CHARACTER_VOICE_UNAVAILABLE: {
    status: 503,
    reason: "Le vocal d’un personnage est momentanément indisponible.",
    action: "Réessayez dans quelques instants ou ajoutez à nouveau le vocal.",
  },
  AI_MEDIA_QUOTA_REACHED: {
    status: 403,
    reason: "Le solde disponible ne suffit pas pour cette génération.",
    action: "Choisissez un moteur moins coûteux, réduisez la durée ou rechargez vos crédits.",
  },
  AI_MEDIA_CREDIT_QUOTE_CHANGED: {
    status: 409,
    reason: "Le coût de la génération a changé depuis sa préparation.",
    action: "Actualisez le coût affiché, puis confirmez à nouveau la génération.",
  },
  AI_MEDIA_CREDITS_NOT_READY: {
    status: 503,
    reason: "Le portefeuille de crédits média est momentanément indisponible.",
    action: "Contactez l’assistance si le problème persiste. Recharger vos crédits ne corrigera pas cette indisponibilité.",
  },
  AI_MEDIA_ACCOUNT_ACCESS_DENIED: {
    status: 403,
    reason: "Votre session n’a pas accès à l’établissement de cette génération.",
    action: "Sélectionnez le bon établissement ou reconnectez-vous avant de réessayer.",
  },
  AI_MEDIA_IDEMPOTENCY_CONFLICT: {
    status: 409,
    reason: "Cette tentative existe déjà avec une autre demande.",
    action: "Revenez à votre demande et lancez une nouvelle génération.",
  },
  AI_MEDIA_GENERATED_NARRATION_INVALID: {
    status: 502,
    reason: "La voix off générée automatiquement n’a pas respecté la durée disponible.",
    action: "Réessayez ou choisissez une durée plus longue. Votre prompt n’a pas été identifié comme trop long ; c’est la préparation automatique de la narration qui a échoué.",
  },
  AI_MEDIA_EXACT_NARRATION_TOO_LONG: {
    status: 422,
    reason: "Le texte exact demandé pour la voix off est trop long pour cette durée.",
    action: "Raccourcissez les paroles entre guillemets ou augmentez la durée. Vos paroles exactes ne seront pas coupées automatiquement.",
  },
  AI_MEDIA_NARRATION_TOO_LONG: {
    status: 422,
    reason: "La voix off préparée est trop longue pour la durée choisie.",
    action: "Choisissez une durée plus longue ou demandez une narration plus courte. Si vous avez fourni des paroles exactes, raccourcissez-les.",
  },
  AI_MEDIA_DIALOGUE_TOO_LONG: {
    status: 422,
    reason: "Une réplique ne tient pas dans le plan vidéo prévu.",
    action: "Raccourcissez les répliques ou choisissez une durée plus longue avec plusieurs plans.",
  },
  AI_MEDIA_EXACT_TEXT_TOO_DENSE: {
    status: 422,
    reason: "Les textes ou les valeurs exactes demandés sont trop nombreux pour cette durée.",
    action: "Réduisez les éléments à afficher ou augmentez la durée de la vidéo.",
  },
  AI_MEDIA_EXACT_DIALOGUE_INVALID: {
    status: 422,
    reason: "Les paroles exactes n’ont pas pu être préparées en respectant votre demande.",
    action: "Indiquez des phrases complètes entre guillemets, adaptées à la durée choisie.",
  },
  AI_MEDIA_CHARACTER_DIALOGUE_MISSING: {
    status: 422,
    reason: "La préparation des répliques des personnages est incomplète.",
    action: "Précisez qui parle et les phrases à prononcer dans votre prompt, puis réessayez.",
  },
  AI_MEDIA_VIDEO_SPEECH_MISSING: {
    status: 422,
    reason: "Aucune parole n’a été détectée dans la vidéo créée par le moteur.",
    action: "Réessayez avec des répliques courtes ou choisissez un autre moteur.",
  },
  AI_MEDIA_VIDEO_SPEECH_INCOMPLETE: {
    status: 422,
    reason: "Une réplique s’interrompt avant la fin dans la vidéo créée.",
    action: "Raccourcissez les paroles ou augmentez la durée, puis relancez la génération.",
  },
  AI_MEDIA_VIDEO_SPEECH_REPEATED: {
    status: 422,
    reason: "Le contrôle audio a détecté des paroles répétées dans la vidéo.",
    action: "Réessayez ou choisissez un autre moteur pour obtenir un nouveau rendu.",
  },
  AI_MEDIA_VIDEO_SPEECH_MISMATCH: {
    status: 422,
    reason: "Les paroles de la vidéo ne correspondent pas aux répliques prévues.",
    action: "Indiquez des répliques courtes entre guillemets ou essayez un autre moteur.",
  },
  AI_MEDIA_VIDEO_NATIVE_SPEECH_REJECTED: {
    status: 422,
    reason: "Les paroles créées par le moteur n’ont pas passé le contrôle audio.",
    action: "Réessayez avec des répliques plus courtes ou choisissez un autre moteur.",
  },
  AI_MEDIA_CHARACTER_DIALOGUE_UNAVAILABLE: {
    status: 503,
    reason: "Le service n’a pas pu préparer les voix des personnages.",
    action: "Réessayez dans quelques instants. Si le problème persiste, contactez l’assistance.",
    retryAfterSeconds: 30,
  },
  AI_MEDIA_NARRATION_UNAVAILABLE: {
    status: 503,
    reason: "La préparation de la voix off a échoué.",
    action: "Réessayez dans quelques instants. Vous pouvez aussi désactiver la voix off si elle n’est pas nécessaire.",
    retryAfterSeconds: 30,
  },
  AI_MEDIA_VISIBLE_COPY_UNAVAILABLE: {
    status: 503,
    reason: "Le texte destiné au visuel n’a pas pu être préparé.",
    action: "Précisez le texte souhaité entre guillemets dans le prompt ou réessayez dans quelques instants.",
    retryAfterSeconds: 30,
  },
  AI_MEDIA_ACCOUNT_DAILY_SAFETY_LIMIT: {
    status: 429,
    reason: "Le plafond quotidien de sécurité IA de ce compte est atteint.",
    action: "Réessayez après le renouvellement du plafond ou contactez l’assistance. Recharger vos crédits ne relève pas ce plafond technique.",
  },
  AI_MEDIA_ACCOUNT_SAFETY_LIMIT: {
    status: 429,
    reason: "Un plafond de sécurité IA de ce compte est atteint.",
    action: "Réessayez plus tard ou contactez l’assistance. Ce plafond technique est distinct de votre solde de crédits.",
  },
  AI_MEDIA_GUARD_UNAVAILABLE: {
    status: 503,
    reason: "La vérification des limites de génération est momentanément indisponible.",
    action: "Patientez quelques minutes avant de réessayer.",
    retryAfterSeconds: 300,
  },
  AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED: {
    status: 503,
    reason: "Le fournisseur du moteur a atteint un plafond technique de quota ou de facturation.",
    action: "Choisissez un autre moteur ou contactez l’assistance. Votre prompt et votre solde de crédits iNrCy ne sont pas en cause.",
  },
  AI_MEDIA_GATEWAY_NOT_CONFIGURED: {
    status: 503,
    reason: "L’accès technique à ce moteur est indisponible.",
    action: "Choisissez un autre moteur ou contactez l’assistance. Modifier votre prompt ne résoudra pas ce problème.",
  },
  AI_MEDIA_VIDEO_CAPACITY_REACHED: {
    status: 429,
    reason: "Le moteur reçoit trop de demandes pour le moment.",
    action: "Patientez une minute avant de réessayer ou choisissez un autre moteur.",
    retryAfterSeconds: 60,
  },
  AI_MEDIA_GENERATION_TIMEOUT: {
    status: 504,
    reason: "Le moteur n’a pas terminé dans le délai disponible.",
    action: "Réessayez plus tard ou choisissez un autre moteur. Ce délai ne signifie pas que votre prompt a été refusé.",
    retryAfterSeconds: 30,
  },
  AI_MEDIA_CONNECTION_INTERRUPTED: {
    status: 502,
    reason: "La connexion au service de génération a été interrompue avant la fin.",
    action: "Vérifiez votre connexion, puis réessayez. Votre prompt n’a pas été identifié comme la cause de cet échec.",
  },
  AI_MEDIA_GENERATION_CANCELLED: {
    status: 499,
    reason: "La génération a été arrêtée à votre demande.",
    action: "Vous pouvez lancer une nouvelle génération lorsque vous le souhaitez.",
  },
  AI_MEDIA_GENERATION_EXPIRED: {
    status: 504,
    reason: "Cette tentative a expiré sans résultat récupérable.",
    action: "Vous pouvez lancer une nouvelle génération ou contacter l’assistance si cela se répète.",
  },
  AI_MEDIA_REFERENCE_POLICY_REJECTED: {
    status: 422,
    reason: "Le fournisseur a refusé une image de référence selon ses règles de sécurité.",
    action: "Retirez ou remplacez la référence concernée, puis réessayez. Un autre moteur peut appliquer des règles différentes.",
  },
  AI_MEDIA_CONTENT_POLICY_REJECTED: {
    status: 422,
    reason: "Le moteur a refusé la demande ou le rendu lors de son contrôle de sécurité.",
    action: "Vérifiez le brief et les références avant de modifier la demande. Les médias déjà créés sont conservés.",
  },
  AI_MEDIA_AUDIO_SAFETY_FILTERED: {
    status: 422,
    reason: "Le fournisseur a bloqué le rendu pendant le contrôle de sa piste audio.",
    action: "Réessayez ou ajustez les paroles et le son. Ce contrôle peut concerner le rendu créé, même si votre prompt est acceptable.",
  },
  AI_MEDIA_VIDEO_SAFETY_FILTERED: {
    status: 422,
    reason: "Le fournisseur a bloqué la demande ou le rendu selon ses règles de sécurité.",
    action: "Reformulez la scène ou remplacez les références sensibles. Le refus peut aussi concerner le contenu créé par le moteur.",
  },
  AI_MEDIA_IMAGE_IDENTITY_REFERENCE_REJECTED: {
    status: 422,
    reason: "Le moteur n’a pas pu respecter l’identité des personnes sur les photos de référence.",
    action: "Essayez des photos plus nettes, avec un visage bien visible, ou choisissez un autre moteur.",
  },
  AI_MEDIA_IMAGE_IDENTITY_MODEL_UNSUPPORTED: {
    status: 422,
    reason: "Ce moteur ne prend pas en charge les références d’identité nécessaires.",
    action: "Choisissez un moteur compatible avec les photos de référence.",
  },
  AI_MEDIA_VIDEO_IDENTITY_REFERENCE_REJECTED: {
    status: 422,
    reason: "Le moteur vidéo n’a pas pu préserver l’identité à partir des photos fournies.",
    action: "Essayez des photos plus nettes ou choisissez un autre moteur.",
  },
  AI_MEDIA_REFERENCE_REQUIRED: {
    status: 422,
    reason: "Ce moteur a besoin d’une image de référence pour créer cette vidéo.",
    action: "Ajoutez une image dans les critères ou choisissez un moteur qui accepte un prompt seul.",
  },
  AI_MEDIA_REFERENCES_UNSUPPORTED: {
    status: 422,
    reason: "Le moteur ne prend pas en charge cette sélection d’images de référence.",
    action: "Réduisez le nombre d’images ou choisissez un moteur compatible.",
  },
  AI_MEDIA_VIDEO_DURATION_INVALID: {
    status: 422,
    reason: "La durée choisie n’est pas compatible avec ce moteur et cette qualité.",
    action: "Choisissez une durée proposée pour ce moteur dans le bandeau du bas.",
  },
  AI_MEDIA_VIDEO_INSTRUCTION_TOO_COMPLEX: {
    status: 422,
    reason: "La consigne préparée par iNrStudio dépasse la taille acceptée par ce moteur.",
    action: "Essayez un autre moteur ou une demande plus courte. Même un prompt court peut atteindre cette limite après sa préparation par l’outil.",
  },
  AI_MEDIA_VIDEO_CONFIGURATION_REJECTED: {
    status: 502,
    reason: "Le moteur a refusé un paramètre technique de génération.",
    action: "Choisissez un autre moteur ou contactez l’assistance. Modifier le contenu du prompt ne corrige pas ce réglage.",
  },
  AI_MEDIA_VIDEO_PREPARATION_FAILED: {
    status: 502,
    reason: "iNrStudio n’a pas pu préparer un scénario compatible avec le moteur.",
    action: "Réessayez ou choisissez un autre moteur. Si cela se répète, contactez l’assistance.",
  },
  AI_MEDIA_IMAGE_PROVIDERS_UNAVAILABLE: {
    status: 503,
    reason: "Le service de génération d’images n’a pas pu produire de résultat.",
    action: "Réessayez dans quelques instants ou choisissez un autre moteur d’image.",
    retryAfterSeconds: 30,
  },
  AI_MEDIA_VIDEO_PROVIDER_UNAVAILABLE: {
    status: 503,
    reason: "Le service de génération est temporairement indisponible.",
    action: "Réessayez dans quelques instants ou choisissez un autre moteur.",
    retryAfterSeconds: 30,
  },
  AI_MEDIA_IMAGE_OUTPUT_INVALID: {
    status: 502,
    reason: "Le moteur a renvoyé une image inutilisable.",
    action: "Réessayez pour obtenir un nouveau rendu ou choisissez un autre moteur.",
  },
  AI_MEDIA_VIDEO_FILE_MISSING: {
    status: 502,
    reason: "Le moteur a terminé sans fournir de fichier vidéo utilisable.",
    action: "Réessayez ou choisissez un autre moteur.",
  },
  AI_MEDIA_VIDEO_DOWNLOAD_FAILED: {
    status: 502,
    reason: "Le fichier vidéo créé n’a pas pu être récupéré correctement.",
    action: "Réessayez dans quelques instants. Si le problème persiste, contactez l’assistance.",
  },
  AI_MEDIA_VIDEO_INCOMPLETE: {
    status: 502,
    reason: "Le moteur a renvoyé une vidéo incomplète ou illisible.",
    action: "Réessayez pour produire un nouveau rendu ou choisissez un autre moteur.",
  },
  AI_MEDIA_VIDEO_COMPOSITION_FAILED: {
    status: 502,
    reason: "Le montage final de la vidéo a échoué.",
    action: "Réessayez. Si cela se répète, contactez l’assistance avec le moteur et la durée choisis.",
  },
  AI_MEDIA_PREPARATION_OUTPUT_INVALID: {
    status: 502,
    reason: "La préparation automatique du média a renvoyé une réponse technique inutilisable.",
    action: "Réessayez dans quelques instants. Votre prompt n’a pas été identifié comme la cause de cet échec.",
  },
  AI_MEDIA_INVALID_REQUEST: {
    status: 400,
    reason: "Un réglage nécessaire à la génération est manquant ou incompatible.",
    action: "Vérifiez les indications du prompt et de l’onglet Critères, puis réessayez.",
  },
  AI_MEDIA_GENERATION_FAILED: {
    status: 502,
    reason: "La génération a échoué et le service n’a pas fourni de cause identifiable.",
    action: "Réessayez ou choisissez un autre moteur. Si cela se répète, indiquez à l’assistance le moteur et l’heure de la tentative.",
  },
} satisfies Record<string, Explanation>;

export type AiMediaPublicErrorCode = keyof typeof AI_MEDIA_PUBLIC_ERROR_CATALOG;
export type AiMediaPublicError = Explanation & { code: AiMediaPublicErrorCode; message: string };

/** Bounded traversal; ignore prompts, URLs, headers, bodies and arbitrary metadata. */
function diagnosticText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  let remaining = 16_000;
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || remaining <= 0 || nodes++ > 60) return;
    if (typeof value === "string") {
      const part = value.slice(0, Math.min(4_000, remaining));
      parts.push(part); remaining -= part.length; return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { for (const item of value.slice(0, 8)) visit(item, depth + 1); return; }
    const record = value as Record<string, unknown>;
    for (const key of ["name", "code", "message", "error_code", "error_message", "cause", "error", "details", "error_details"]) {
      try { visit(record[key], depth + 1); } catch { /* A diagnostic getter cannot break the error response. */ }
    }
  };
  visit(error, 0);
  return parts.join("\n");
}

function explanation(code: AiMediaPublicErrorCode): AiMediaPublicError {
  const entry = AI_MEDIA_PUBLIC_ERROR_CATALOG[code];
  return { ...entry, code, message: `${entry.reason} ${entry.action}` };
}

const CONTENT_POLICY_REJECTION = /\bai_media_content_policy_rejected\b|\bcontent_policy_violation\b|\bmoderation_blocked\b|\bsafety_violation\b|\bcontent_filter\b|request was rejected by the safety system/;
const SAFETY_FILTER_REJECTION = /safety_filtered|content.moderat|safety filter|responsible ai|\bai_media_(?:reference_policy_rejected|audio_safety_filtered|video_safety_filtered)\b/;

/** A content refusal requires review, not another identical paid submission.
 * Account spending/safety limits and transport failures remain retryable.
 */
export function isAiMediaContentPolicyRejection(error: unknown): boolean {
  const text = diagnosticText(error).toLowerCase();
  return CONTENT_POLICY_REJECTION.test(text) || SAFETY_FILTER_REJECTION.test(text);
}

/** Order matters: a precise nested cause takes priority over a generic wrapper. */
export function classifyAiMediaGenerationError(error: unknown): AiMediaPublicError | null {
  const raw = diagnosticText(error);
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const plain = text.replace(/[_-]+/g, " ");
  const match = (pattern: RegExp) => pattern.test(text);
  const result = (code: AiMediaPublicErrorCode) => explanation(code);
  if (match(/\bvoice_(?:reference_(?:invalid_or_expired|missing)|audio_\w+|account_invalid)\b|ai_video_reference_voice_(?:url_missing|assignment_invalid)/)) return result("AI_MEDIA_CHARACTER_VOICE_INVALID");
  if (match(/\bvoice_(?:storage_unavailable|reference_unavailable)\b/)) return result("AI_MEDIA_CHARACTER_VOICE_UNAVAILABLE");
  // These are iNrCy wallet/session failures, never supplier billing failures.
  if (match(/\bai_media_quota_reached\b/)) return result("AI_MEDIA_QUOTA_REACHED");
  if (match(/\bai_media_credit_quote_changed\b/)) return result("AI_MEDIA_CREDIT_QUOTE_CHANGED");
  if (match(/\bai_media_(?:credits_not_ready|quota_unavailable)\b/)) return result("AI_MEDIA_CREDITS_NOT_READY");
  if (match(/\bai_media_account_access_denied\b/)) return result("AI_MEDIA_ACCOUNT_ACCESS_DENIED");
  if (match(/\bai_media_idempotency_conflict\b/)) return result("AI_MEDIA_IDEMPOTENCY_CONFLICT");
  if (match(/\bai_media_generation_cancelled\b/)) return result("AI_MEDIA_GENERATION_CANCELLED");
  if (match(/ai_media_generated_narration_invalid/)) return result("AI_MEDIA_GENERATED_NARRATION_INVALID");
  if (match(/\bai_media_exact_narration_too_long\b/)) return result("AI_MEDIA_EXACT_NARRATION_TOO_LONG");
  if (/texte exact.{0,20}voix off.{0,20}trop long/.test(plain)) return result("AI_MEDIA_EXACT_NARRATION_TOO_LONG");
  if (/voix off.{0,35}trop longue|narration.{0,20}too long/.test(plain)) return result("AI_MEDIA_NARRATION_TOO_LONG");
  if (/replique.{0,30}trop longue|dialogue.{0,20}too long/.test(plain)) return result("AI_MEDIA_DIALOGUE_TOO_LONG");
  if (/trop de textes ou de valeurs exactes/.test(plain)) return result("AI_MEDIA_EXACT_TEXT_TOO_DENSE");
  if (/limite quotidienne de securite/.test(plain)) return result("AI_MEDIA_ACCOUNT_DAILY_SAFETY_LIMIT");
  if (match(/monthly spending cap|billing[_ ]hard[_ ]limit|insufficient_quota|quota.{0,80}(?:exceed|exhaust)|exceed.{0,80}(?:quota|spending|budget)|credit balance.{0,40}(?:insufficient|exhaust|low)|insufficient.{0,20}(?:credits|funds)/)) return result("AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED");
  if (match(/ai_gateway_account_limit_reached/)) return result("AI_MEDIA_ACCOUNT_SAFETY_LIMIT");
  if (match(/ai_gateway_guard_unavailable/)) return result("AI_MEDIA_GUARD_UNAVAILABLE");
  if (match(/ai_media_exact_dialogue_unfit/)) return result("AI_MEDIA_EXACT_DIALOGUE_INVALID");
  if (/preparation des voix des personnages est incomplete/.test(plain)) return result("AI_MEDIA_CHARACTER_DIALOGUE_MISSING");
  if (match(/ai_media_free_native_character_speech_unusable|ai_media_character_dialogue_quality_unverified/)) {
    if (match(/spoken_dialogue_missing|provider_fallback/)) return result("AI_MEDIA_VIDEO_SPEECH_MISSING");
    // A wrong name, value or negation is the primary problem even when the
    // unrelated transcript also contains a loop. A conforming line with an
    // extra repetition keeps the more precise repeated-speech explanation.
    if (match(/spoken_critical_value_mismatch/)) return result("AI_MEDIA_VIDEO_SPEECH_MISMATCH");
    if (match(/spoken_dialogue_incomplete/)) return result("AI_MEDIA_VIDEO_SPEECH_INCOMPLETE");
    if (match(/spoken_dialogue_repeated/)) return result("AI_MEDIA_VIDEO_SPEECH_REPEATED");
    if (match(/spoken_dialogue_mismatch/)) return result("AI_MEDIA_VIDEO_SPEECH_MISMATCH");
    return result("AI_MEDIA_VIDEO_NATIVE_SPEECH_REJECTED");
  }
  if (match(/photorealistic children|input images.{0,100}(?:not allowed|not supported)|reference.{0,50}image.{0,60}reject/)) return result("AI_MEDIA_REFERENCE_POLICY_REJECTED");
  if (CONTENT_POLICY_REJECTION.test(text)) return result("AI_MEDIA_CONTENT_POLICY_REJECTED");
  if (match(/(?:safety_filtered|content.moderat|safety filter|responsible ai)/)) {
    if (match(/audio|soundtrack|piste sonore/)) return result("AI_MEDIA_AUDIO_SAFETY_FILTERED");
    return result("AI_MEDIA_VIDEO_SAFETY_FILTERED");
  }
  if (match(/ai_image_identity_not_generated/)) return result("AI_MEDIA_IMAGE_IDENTITY_REFERENCE_REJECTED");
  if (match(/ai_image_identity_model_unsupported/)) return result("AI_MEDIA_IMAGE_IDENTITY_MODEL_UNSUPPORTED");
  if (match(/ai_video_identity_reference_rejected/)) return result("AI_MEDIA_VIDEO_IDENTITY_REFERENCE_REJECTED");
  if (match(/(?:ai_gateway|ai_video_\w+)_(?:credentials_missing|credentials_rejected|permission_denied)|invalid api key|authentication_error/)) return result("AI_MEDIA_GATEWAY_NOT_CONFIGURED");
  if (match(/invalid.resolution|delivery mode is not supported|parameter is only supported|isn.t supported by this model|persongeneration.{0,80}not supported|ai_video_\w+_(?:configuration_rejected|model_invalid)|ai_media_model_invalid/)) return result("AI_MEDIA_VIDEO_CONFIGURATION_REJECTED");
  if (match(/rate_limited|too_many_requests|rate limit|high load|too many requests/)) return result("AI_MEDIA_VIDEO_CAPACITY_REACHED");
  if (match(/timeouterror|fetch_timeout|timed out|ai_video_\w+_timeout/)) return result("AI_MEDIA_GENERATION_TIMEOUT");
  if (match(/responseaborted|aborterror|econnreset|connection.{0,20}(?:closed|reset|aborted)/)) return result("AI_MEDIA_CONNECTION_INTERRUPTED");
  if (match(/ai_media_video_reference_required/)) return result("AI_MEDIA_REFERENCE_REQUIRED");
  if (match(/ai_media_video_references_unsupported/)) return result("AI_MEDIA_REFERENCES_UNSUPPORTED");
  if (match(/ai_media_video_duration_invalid/)) return result("AI_MEDIA_VIDEO_DURATION_INVALID");
  if (match(/ai_video_instruction_contract_too_long/)) return result("AI_MEDIA_VIDEO_INSTRUCTION_TOO_COMPLEX");
  if (match(/ai_video_\w+_scene_count_invalid|ai_video_provider_contract_incomplete/)) return result("AI_MEDIA_VIDEO_PREPARATION_FAILED");
  if (match(/ai_gateway_invalid_output|aijsonresponsenormalizationerror/)) return result("AI_MEDIA_PREPARATION_OUTPUT_INVALID");
  if (match(/ai_media_narration_(?:unavailable|failed)/)) return result("AI_MEDIA_NARRATION_UNAVAILABLE");
  if (match(/ai_media_character_dialogue_unavailable/)) return result("AI_MEDIA_CHARACTER_DIALOGUE_UNAVAILABLE");
  if (match(/ai_media_visible_copy_unavailable/)) return result("AI_MEDIA_VISIBLE_COPY_UNAVAILABLE");
  if (match(/ai_image_(?:identity_)?generation_unavailable/)) return result("AI_MEDIA_IMAGE_PROVIDERS_UNAVAILABLE");
  if (match(/ai_image_provider_output_invalid|ai_image_exact_contact_composition_failed/)) return result("AI_MEDIA_IMAGE_OUTPUT_INVALID");
  if (match(/ai_media_essential_video_composition_failed/)) return result("AI_MEDIA_VIDEO_COMPOSITION_FAILED");
  if (match(/ai_video_\w+_video_missing|ai_video_gateway_output_count_invalid/)) return result("AI_MEDIA_VIDEO_FILE_MISSING");
  if (match(/ai_video_\w+_(?:download_failed|clip_not_mp4|clip_too_large)/)) return result("AI_MEDIA_VIDEO_DOWNLOAD_FAILED");
  if (match(/ai_video_\w+_(?:clip_empty|interaction_id_missing|operation_id_missing|clip_set_incomplete)|ai_original_video_(?:clip_contract_failed|output_contract_failed|render_failed)|ai_video_gateway_mp4_invalid/)) return result("AI_MEDIA_VIDEO_INCOMPLETE");
  if (match(/ai_video_\w+_(?:unavailable|network_failed|model_unavailable)|service.{0,25}unavailable|internal server error|econnrefused|fetch failed/)) return result("AI_MEDIA_VIDEO_PROVIDER_UNAVAILABLE");
  // Canonical codes survive persistence; never echo arbitrary stored messages.
  for (const code of Object.keys(AI_MEDIA_PUBLIC_ERROR_CATALOG) as AiMediaPublicErrorCode[]) {
    if (new RegExp(`\\b${code}\\b`, "i").test(raw)) return result(code);
  }
  if (match(/invalid_ai_media_request/)) return result("AI_MEDIA_INVALID_REQUEST");
  return null;
}

export function getAiMediaGenerationPublicError(error: unknown, options: { expired?: boolean } = {}): AiMediaPublicError {
  if (options.expired) return explanation("AI_MEDIA_GENERATION_EXPIRED");
  return classifyAiMediaGenerationError(error) ?? explanation("AI_MEDIA_GENERATION_FAILED");
}
