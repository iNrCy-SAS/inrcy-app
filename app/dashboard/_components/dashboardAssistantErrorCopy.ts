type ErrorCopy = { unavailable: string; memory: string; limit: string; session: string; input: string; conflict: string; timeout: string };

const COPY: Record<string, ErrorCopy> = {
  fr: {
    unavailable: "Je n’ai pas réussi à terminer ma réponse cette fois. Votre demande est conservée : vous pouvez réessayer dans un instant.",
    memory: "Je n’arrive pas à retrouver notre échange pour le moment. Votre demande est conservée ; réessayez dans un instant.",
    limit: "Vous avez atteint la limite d’utilisation de votre compte pour le moment. Vous pouvez consulter votre abonnement pour connaître vos possibilités.",
    session: "Je ne peux plus accéder à votre compte. Reconnectez-vous, puis reprenez notre échange.",
    input: "Je n’ai pas pu traiter cette demande telle quelle. Essayez de la raccourcir ou de la reformuler.",
    conflict: "Je ne peux pas reprendre cette demande telle quelle. Gardez votre texte et ouvrez une nouvelle conversation pour la reformuler.",
    timeout: "Ma réponse a pris trop de temps. Votre demande est conservée : réessayez pour vérifier ou reprendre le même travail.",
  },
  en: {
    unavailable: "I couldn’t finish my reply this time. Your request is saved; you can try again in a moment.",
    memory: "I can’t retrieve our conversation right now. Your request is saved; please try again shortly.",
    limit: "Your account has reached its usage limit for now. Check your subscription to see your options.",
    session: "I can no longer access your account. Sign in again, then resume our conversation.",
    input: "I couldn’t process this request as it stands. Try shortening or rephrasing it.",
    conflict: "I can’t resume this request as it stands. Keep your text and rephrase it in a new conversation.",
    timeout: "My reply took too long. Your request is saved; retry to check or resume the same work.",
  },
  es: {
    unavailable: "No he podido terminar mi respuesta. Tu solicitud está guardada; puedes reintentarlo en un momento.",
    memory: "Ahora no puedo recuperar nuestra conversación. Tu solicitud está guardada; inténtalo de nuevo en un momento.",
    limit: "Tu cuenta ha alcanzado su límite de uso por ahora. Consulta tu suscripción para ver tus opciones.",
    session: "Ya no puedo acceder a tu cuenta. Inicia sesión de nuevo y retoma nuestra conversación.",
    input: "No he podido procesar esta solicitud. Prueba a acortarla o reformularla.",
    conflict: "No puedo retomar esta solicitud. Guarda el texto y reformúlalo en una nueva conversación.",
    timeout: "Mi respuesta ha tardado demasiado. Tu solicitud está guardada; reintenta para comprobar o retomar el mismo trabajo.",
  },
  it: {
    unavailable: "Non sono riuscito a completare la risposta. La richiesta è conservata; puoi riprovare tra poco.",
    memory: "Non riesco a recuperare la conversazione. La richiesta è conservata; riprova tra poco.",
    limit: "Il tuo account ha raggiunto il limite di utilizzo. Consulta l’abbonamento per conoscere le opzioni.",
    session: "Non posso più accedere al tuo account. Accedi di nuovo e riprendi la conversazione.",
    input: "Non ho potuto elaborare questa richiesta. Prova ad accorciarla o riformularla.",
    conflict: "Non posso riprendere questa richiesta. Conserva il testo e riformulalo in una nuova conversazione.",
    timeout: "La risposta ha richiesto troppo tempo. La richiesta è conservata; riprova per verificare o riprendere lo stesso lavoro.",
  },
  de: {
    unavailable: "Ich konnte meine Antwort diesmal nicht fertigstellen. Deine Anfrage bleibt erhalten; versuche es gleich erneut.",
    memory: "Ich kann unser Gespräch gerade nicht abrufen. Deine Anfrage bleibt erhalten; versuche es gleich erneut.",
    limit: "Dein Konto hat vorerst sein Nutzungslimit erreicht. In deinem Abonnement findest du deine Möglichkeiten.",
    session: "Ich kann nicht mehr auf dein Konto zugreifen. Melde dich erneut an und setze unser Gespräch fort.",
    input: "Ich konnte diese Anfrage so nicht bearbeiten. Versuche sie zu kürzen oder umzuformulieren.",
    conflict: "Ich kann diese Anfrage so nicht fortsetzen. Bewahre deinen Text auf und formuliere ihn in einem neuen Gespräch um.",
    timeout: "Meine Antwort hat zu lange gedauert. Deine Anfrage bleibt erhalten; versuche es erneut, um dieselbe Arbeit zu prüfen oder fortzusetzen.",
  },
  nl: {
    unavailable: "Ik kon mijn antwoord niet afronden. Je verzoek blijft bewaard; probeer het zo opnieuw.",
    memory: "Ik kan ons gesprek nu niet ophalen. Je verzoek blijft bewaard; probeer het zo opnieuw.",
    limit: "Je account heeft voorlopig de gebruikslimiet bereikt. Bekijk je abonnement voor je mogelijkheden.",
    session: "Ik heb geen toegang meer tot je account. Meld je opnieuw aan en hervat ons gesprek.",
    input: "Ik kon dit verzoek zo niet verwerken. Probeer het korter te maken of anders te formuleren.",
    conflict: "Ik kan dit verzoek zo niet hervatten. Bewaar je tekst en formuleer die opnieuw in een nieuw gesprek.",
    timeout: "Mijn antwoord duurde te lang. Je verzoek blijft bewaard; probeer opnieuw om hetzelfde werk te controleren of te hervatten.",
  },
  pt: {
    unavailable: "Não consegui terminar a resposta desta vez. O seu pedido está guardado; pode tentar novamente dentro de momentos.",
    memory: "Não consigo recuperar a nossa conversa agora. O seu pedido está guardado; tente novamente dentro de momentos.",
    limit: "A sua conta atingiu o limite de utilização por agora. Consulte a sua subscrição para conhecer as opções.",
    session: "Já não consigo aceder à sua conta. Inicie sessão novamente e retome a conversa.",
    input: "Não consegui processar este pedido. Tente encurtá-lo ou reformulá-lo.",
    conflict: "Não consigo retomar este pedido. Guarde o texto e reformule-o numa nova conversa.",
    timeout: "A minha resposta demorou demasiado. O pedido está guardado; tente novamente para verificar ou retomar o mesmo trabalho.",
  },
  th: {
    unavailable: "ฉันตอบไม่สำเร็จในครั้งนี้ คำขอของคุณยังอยู่ ลองอีกครั้งในอีกสักครู่ได้",
    memory: "ฉันยังเรียกดูบทสนทนาของเราไม่ได้ คำขอของคุณยังอยู่ โปรดลองอีกครั้งในอีกสักครู่",
    limit: "บัญชีของคุณถึงขีดจำกัดการใช้งานแล้วในขณะนี้ ดูตัวเลือกได้ในการสมัครสมาชิก",
    session: "ฉันเข้าถึงบัญชีของคุณไม่ได้แล้ว โปรดเข้าสู่ระบบอีกครั้งแล้วสนทนาต่อ",
    input: "ฉันประมวลผลคำขอนี้ไม่ได้ โปรดลองย่อหรือเขียนใหม่",
    conflict: "ฉันดำเนินคำขอนี้ต่อไม่ได้ โปรดเก็บข้อความไว้แล้วเขียนใหม่ในบทสนทนาใหม่",
    timeout: "ฉันใช้เวลาตอบนานเกินไป คำขอของคุณยังอยู่ ลองอีกครั้งเพื่อตรวจสอบหรือทำงานเดิมต่อ",
  },
  zh: {
    unavailable: "这次我没能完成回复。你的请求已保留，可以稍后重试。",
    memory: "我暂时无法读取我们的对话。你的请求已保留，请稍后重试。",
    limit: "你的账户目前已达到使用限额。可在订阅中查看可用选项。",
    session: "我无法再访问你的账户。请重新登录，然后继续对话。",
    input: "我无法处理当前请求。请尝试缩短或重新表述。",
    conflict: "我无法继续当前请求。请保留文字，在新对话中重新表述。",
    timeout: "我的回复耗时过长。你的请求已保留，可重试以检查或继续同一项工作。",
  },
};

/** Never render an arbitrary API/provider message or diagnostic identifier. */
export function dashboardAssistantErrorCopy(locale: string, code?: unknown, status?: number): string {
  const copy = COPY[locale.toLowerCase().split("-")[0]] || COPY.fr;
  if (code === "assistant_memory_unavailable") return copy.memory;
  if (code === "ai_gateway_account_limit_reached" || code === "quota_exceeded") return copy.limit;
  if (code === "auth_required" || status === 401) return copy.session;
  if (code === "assistant_memory_conflict") return copy.conflict;
  if (code === "assistant_invalid_request" || code === "assistant_memory_invalid_request") return copy.input;
  if (code === "assistant_client_timeout" || code === "ai_operation_deadline_exceeded") return copy.timeout;
  return copy.unavailable;
}
