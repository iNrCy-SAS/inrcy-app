type AssistantCopy = {
  open: string;
  close: string;
  intro: string;
  prompt: string;
  placeholder: string;
  send: string;
  pending: string;
  retry: string;
  unavailable: string;
  timeout: string;
  newChat: string;
  you: string;
  suggestions: [string, string, string];
};
type CollaborationCopy = {
  collaboration: string;
  collaborating: string;
  activityUnconfirmed: string;
  activityStatuses: Record<"running" | "completed" | "blocked" | "failed", string>;
};
type OnboardingCopy = { onboardingGreeting: string; onboardingMessage: string; onboardingConnect: string; onboardingRequest: string };
const ONBOARDING_COPY: Record<string, OnboardingCopy> = {
  fr: { onboardingGreeting: "Bonjour et bienvenue chez iNrCy ! 👋", onboardingMessage: "Je suis iNr’Assistant. Je peux vous accompagner pas à pas pour connecter vos canaux et bien démarrer. Quel canal souhaitez-vous connecter en premier ?", onboardingConnect: "Connecter mes canaux", onboardingRequest: "Aidez-moi à connecter mon premier canal dans iNrCy." },
  en: { onboardingGreeting: "Hello and welcome to iNrCy! 👋", onboardingMessage: "I’m iNr’Assistant. I can guide you step by step to connect your channels and get started. Which channel would you like to connect first?", onboardingConnect: "Connect my channels", onboardingRequest: "Help me connect my first channel in iNrCy." },
  es: { onboardingGreeting: "¡Hola y bienvenido a iNrCy! 👋", onboardingMessage: "Soy iNr’Assistant. Puedo ayudarte paso a paso a conectar tus canales y empezar. ¿Qué canal quieres conectar primero?", onboardingConnect: "Conectar mis canales", onboardingRequest: "Ayúdame a conectar mi primer canal en iNrCy." },
  it: { onboardingGreeting: "Ciao e benvenuto su iNrCy! 👋", onboardingMessage: "Sono iNr’Assistant. Posso guidarti passo dopo passo per collegare i tuoi canali e iniziare. Quale canale vuoi collegare per primo?", onboardingConnect: "Collega i miei canali", onboardingRequest: "Aiutami a collegare il mio primo canale su iNrCy." },
  de: { onboardingGreeting: "Hallo und willkommen bei iNrCy! 👋", onboardingMessage: "Ich bin iNr’Assistant. Ich begleite dich Schritt für Schritt beim Verbinden deiner Kanäle und beim Einstieg. Welchen Kanal möchtest du zuerst verbinden?", onboardingConnect: "Meine Kanäle verbinden", onboardingRequest: "Hilf mir, meinen ersten Kanal mit iNrCy zu verbinden." },
  nl: { onboardingGreeting: "Hallo en welkom bij iNrCy! 👋", onboardingMessage: "Ik ben iNr’Assistant. Ik help je stap voor stap je kanalen te verbinden en te beginnen. Welk kanaal wil je als eerste verbinden?", onboardingConnect: "Mijn kanalen verbinden", onboardingRequest: "Help me mijn eerste kanaal met iNrCy te verbinden." },
  pt: { onboardingGreeting: "Olá e boas-vindas ao iNrCy! 👋", onboardingMessage: "Sou o iNr’Assistant. Posso acompanhar a ligação dos seus canais, passo a passo, para começar. Que canal pretende ligar primeiro?", onboardingConnect: "Ligar os meus canais", onboardingRequest: "Ajude-me a ligar o meu primeiro canal ao iNrCy." },
  th: { onboardingGreeting: "สวัสดีและยินดีต้อนรับสู่ iNrCy! 👋", onboardingMessage: "ฉันคือ iNr’Assistant ช่วยแนะนำการเชื่อมต่อช่องทางทีละขั้นตอนเพื่อเริ่มต้นใช้งานได้ คุณต้องการเชื่อมต่อช่องทางใดก่อน?", onboardingConnect: "เชื่อมต่อช่องทางของฉัน", onboardingRequest: "ช่วยฉันเชื่อมต่อช่องทางแรกใน iNrCy" },
  zh: { onboardingGreeting: "你好，欢迎使用 iNrCy！👋", onboardingMessage: "我是 iNr’Assistant。我可以一步步帮助你连接渠道并开始使用。你想先连接哪个渠道？", onboardingConnect: "连接我的渠道", onboardingRequest: "请帮我连接 iNrCy 中的第一个渠道。" },
};

const COPY: Record<string, AssistantCopy> = {
  fr: {
    open: "Ouvrir iNr’Assistant", close: "Fermer iNr’Assistant",
    intro: "Je vous aide à préparer vos contenus et à utiliser iNrCy.",
    prompt: "Comment puis-je vous aider ?", placeholder: "Votre demande…", send: "Envoyer",
    pending: "Je réfléchis…", retry: "Réessayer", unavailable: "La réponse n’a pas pu être obtenue. Réessayez dans un instant.",
    timeout: "La réponse prend trop de temps. Vous pouvez réessayer.", newChat: "Nouvelle conversation", you: "Vous",
    suggestions: ["Préparer une publication", "Connecter un canal", "Structurer l’ADN de mon entreprise"],
  },
  en: {
    open: "Open iNr’Assistant", close: "Close iNr’Assistant", intro: "I help you prepare content and use iNrCy.",
    prompt: "How can I help?", placeholder: "Your request…", send: "Send", pending: "Thinking…", retry: "Try again",
    unavailable: "The reply could not be retrieved. Please try again shortly.", timeout: "The reply is taking too long. You can try again.",
    newChat: "New conversation", you: "You", suggestions: ["Prepare a post", "Connect a channel", "Structure my business profile"],
  },
  es: {
    open: "Abrir iNr’Assistant", close: "Cerrar iNr’Assistant", intro: "Te ayudo a preparar contenido y a utilizar iNrCy.",
    prompt: "¿Cómo puedo ayudarte?", placeholder: "Tu solicitud…", send: "Enviar", pending: "Pensando…", retry: "Reintentar",
    unavailable: "No se ha podido obtener la respuesta. Inténtalo de nuevo en un momento.", timeout: "La respuesta tarda demasiado. Puedes reintentarlo.",
    newChat: "Nueva conversación", you: "Tú", suggestions: ["Preparar una publicación", "Conectar un canal", "Estructurar el perfil de mi empresa"],
  },
  it: {
    open: "Apri iNr’Assistant", close: "Chiudi iNr’Assistant", intro: "Ti aiuto a preparare contenuti e a utilizzare iNrCy.",
    prompt: "Come posso aiutarti?", placeholder: "La tua richiesta…", send: "Invia", pending: "Sto pensando…", retry: "Riprova",
    unavailable: "Impossibile ottenere la risposta. Riprova tra poco.", timeout: "La risposta richiede troppo tempo. Puoi riprovare.",
    newChat: "Nuova conversazione", you: "Tu", suggestions: ["Preparare una pubblicazione", "Collegare un canale", "Strutturare il profilo aziendale"],
  },
  de: {
    open: "iNr’Assistant öffnen", close: "iNr’Assistant schließen", intro: "Ich helfe dir, Inhalte vorzubereiten und iNrCy zu nutzen.",
    prompt: "Wie kann ich helfen?", placeholder: "Deine Anfrage…", send: "Senden", pending: "Ich denke nach…", retry: "Erneut versuchen",
    unavailable: "Die Antwort konnte nicht abgerufen werden. Versuche es gleich erneut.", timeout: "Die Antwort dauert zu lange. Du kannst es erneut versuchen.",
    newChat: "Neues Gespräch", you: "Du", suggestions: ["Einen Beitrag vorbereiten", "Einen Kanal verbinden", "Mein Unternehmensprofil strukturieren"],
  },
  nl: {
    open: "iNr’Assistant openen", close: "iNr’Assistant sluiten", intro: "Ik help je inhoud voor te bereiden en iNrCy te gebruiken.",
    prompt: "Hoe kan ik helpen?", placeholder: "Je vraag…", send: "Versturen", pending: "Even nadenken…", retry: "Opnieuw proberen",
    unavailable: "Het antwoord kon niet worden opgehaald. Probeer het zo opnieuw.", timeout: "Het antwoord duurt te lang. Je kunt het opnieuw proberen.",
    newChat: "Nieuw gesprek", you: "Jij", suggestions: ["Een bericht voorbereiden", "Een kanaal verbinden", "Mijn bedrijfsprofiel structureren"],
  },
  pt: {
    open: "Abrir iNr’Assistant", close: "Fechar iNr’Assistant", intro: "Ajudo a preparar conteúdos e a utilizar o iNrCy.",
    prompt: "Como posso ajudar?", placeholder: "O seu pedido…", send: "Enviar", pending: "A pensar…", retry: "Tentar novamente",
    unavailable: "Não foi possível obter a resposta. Tente novamente dentro de momentos.", timeout: "A resposta está a demorar demasiado. Pode tentar novamente.",
    newChat: "Nova conversa", you: "Você", suggestions: ["Preparar uma publicação", "Ligar um canal", "Estruturar o perfil da minha empresa"],
  },
  th: {
    open: "เปิด iNr’Assistant", close: "ปิด iNr’Assistant", intro: "ฉันช่วยคุณเตรียมเนื้อหาและใช้งาน iNrCy ได้",
    prompt: "มีอะไรให้ช่วยไหม?", placeholder: "คำขอของคุณ…", send: "ส่ง", pending: "กำลังคิด…", retry: "ลองอีกครั้ง",
    unavailable: "ไม่สามารถรับคำตอบได้ โปรดลองอีกครั้งในอีกสักครู่", timeout: "คำตอบใช้เวลานานเกินไป คุณสามารถลองอีกครั้งได้",
    newChat: "บทสนทนาใหม่", you: "คุณ", suggestions: ["เตรียมโพสต์", "เชื่อมต่อช่องทาง", "จัดโครงสร้างข้อมูลธุรกิจของฉัน"],
  },
  zh: {
    open: "打开 iNr’Assistant", close: "关闭 iNr’Assistant", intro: "我可以帮助你准备内容并使用 iNrCy。",
    prompt: "有什么可以帮你？", placeholder: "你的需求…", send: "发送", pending: "思考中…", retry: "重试",
    unavailable: "无法获取回复，请稍后重试。", timeout: "回复时间过长，你可以重试。",
    newChat: "新对话", you: "你", suggestions: ["准备一篇帖子", "连接渠道", "整理我的企业资料"],
  },
};

const UTILITY_COPY = {
  fr: { minimize: "Réduire la conversation", restore: "Reprendre la conversation", human: "Contacter l’équipe iNrCy", reviewTitle: "Votre demande à l’équipe iNrCy", reviewNote: "Relisez et ajustez ce message avant de l’envoyer. Rien n’est envoyé automatiquement.", copySummary: "Copier le message", emailDraft: "Ouvrir mon email", requestLabel: "Ma demande", exchangeLabel: "Dernier échange avec iNr’Assistant" },
  en: { minimize: "Minimize conversation", restore: "Resume conversation", human: "Contact the iNrCy team", reviewTitle: "Your request to the iNrCy team", reviewNote: "Review and edit this message before sending it. Nothing is sent automatically.", copySummary: "Copy message", emailDraft: "Open my email", requestLabel: "My request", exchangeLabel: "Last exchange with iNr’Assistant" },
  es: { minimize: "Minimizar conversación", restore: "Retomar conversación", human: "Contactar al equipo iNrCy", reviewTitle: "Tu solicitud al equipo iNrCy", reviewNote: "Revisa y edita el mensaje antes de enviarlo. No se envía nada automáticamente.", copySummary: "Copiar mensaje", emailDraft: "Abrir mi correo", requestLabel: "Mi solicitud", exchangeLabel: "Último intercambio con iNr’Assistant" },
  it: { minimize: "Riduci conversazione", restore: "Riprendi conversazione", human: "Contatta il team iNrCy", reviewTitle: "La tua richiesta al team iNrCy", reviewNote: "Controlla e modifica il messaggio prima di inviarlo. Nulla viene inviato automaticamente.", copySummary: "Copia messaggio", emailDraft: "Apri la mia email", requestLabel: "La mia richiesta", exchangeLabel: "Ultimo scambio con iNr’Assistant" },
  de: { minimize: "Gespräch minimieren", restore: "Gespräch fortsetzen", human: "iNrCy-Team kontaktieren", reviewTitle: "Deine Anfrage an das iNrCy-Team", reviewNote: "Prüfe und bearbeite die Nachricht vor dem Versand. Nichts wird automatisch gesendet.", copySummary: "Nachricht kopieren", emailDraft: "E-Mail öffnen", requestLabel: "Meine Anfrage", exchangeLabel: "Letzter Austausch mit iNr’Assistant" },
  nl: { minimize: "Gesprek verkleinen", restore: "Gesprek hervatten", human: "Contact met het iNrCy-team", reviewTitle: "Je verzoek aan het iNrCy-team", reviewNote: "Controleer en bewerk het bericht voordat je het verzendt. Er wordt niets automatisch verstuurd.", copySummary: "Bericht kopiëren", emailDraft: "Mijn e-mail openen", requestLabel: "Mijn verzoek", exchangeLabel: "Laatste gesprek met iNr’Assistant" },
  pt: { minimize: "Minimizar conversa", restore: "Retomar conversa", human: "Contactar a equipa iNrCy", reviewTitle: "O seu pedido à equipa iNrCy", reviewNote: "Reveja e ajuste a mensagem antes de a enviar. Nada é enviado automaticamente.", copySummary: "Copiar mensagem", emailDraft: "Abrir o meu email", requestLabel: "O meu pedido", exchangeLabel: "Última troca com iNr’Assistant" },
  th: { minimize: "ย่อบทสนทนา", restore: "กลับสู่บทสนทนา", human: "ติดต่อทีม iNrCy", reviewTitle: "คำขอถึงทีม iNrCy", reviewNote: "ตรวจสอบและแก้ไขข้อความก่อนส่ง ไม่มีการส่งโดยอัตโนมัติ", copySummary: "คัดลอกข้อความ", emailDraft: "เปิดอีเมลของฉัน", requestLabel: "คำขอของฉัน", exchangeLabel: "บทสนทนาล่าสุดกับ iNr’Assistant" },
  zh: { minimize: "最小化对话", restore: "继续对话", human: "联系 iNrCy 团队", reviewTitle: "你向 iNrCy 团队的请求", reviewNote: "发送前请检查并修改消息。不会自动发送任何内容。", copySummary: "复制消息", emailDraft: "打开我的邮件", requestLabel: "我的请求", exchangeLabel: "与 iNr’Assistant 的最近交流" },
};

export function dashboardAssistantCopy(locale: string) {
  const language = locale.toLowerCase().split("-")[0] as keyof typeof UTILITY_COPY;
  const nextSteps = { fr: "Je dois faire quoi ?", en: "What should I do next?", es: "¿Qué debo hacer ahora?", it: "Cosa devo fare adesso?", de: "Was soll ich als Nächstes tun?", nl: "Wat moet ik nu doen?", pt: "O que devo fazer agora?", th: "ฉันควรทำอะไรต่อ?", zh: "接下来我该做什么？" };
  const newReply = { fr: "Nouvelle réponse", en: "New reply", es: "Nueva respuesta", it: "Nuova risposta", de: "Neue Antwort", nl: "Nieuw antwoord", pt: "Nova resposta", th: "คำตอบใหม่", zh: "新回复" };
  const recovery = {
    fr: { reference: "Référence :", interrupted: "La conversation a été restaurée. La réponse a été interrompue ; réessayez pour vérifier ou reprendre la même demande." },
    en: { reference: "Reference:", interrupted: "Your conversation was restored. The reply was interrupted; retry to check or resume the same request." },
    es: { reference: "Referencia:", interrupted: "Se ha restaurado la conversación. La respuesta se interrumpió; reintenta para comprobar o retomar la misma solicitud." },
    it: { reference: "Riferimento:", interrupted: "La conversazione è stata ripristinata. La risposta si è interrotta; riprova per verificare o riprendere la stessa richiesta." },
    de: { reference: "Referenz:", interrupted: "Das Gespräch wurde wiederhergestellt. Die Antwort wurde unterbrochen. Versuche es erneut, um dieselbe Anfrage zu prüfen oder fortzusetzen." },
    nl: { reference: "Referentie:", interrupted: "Je gesprek is hersteld. Het antwoord werd onderbroken; probeer opnieuw om dezelfde aanvraag te controleren of te hervatten." },
    pt: { reference: "Referência:", interrupted: "A conversa foi restaurada. A resposta foi interrompida; tente novamente para verificar ou retomar o mesmo pedido." },
    th: { reference: "รหัสอ้างอิง:", interrupted: "กู้คืนบทสนทนาแล้ว คำตอบถูกขัดจังหวะ โปรดลองอีกครั้งเพื่อตรวจสอบหรือดำเนินคำขอเดิมต่อ" },
    zh: { reference: "参考编号：", interrupted: "对话已恢复。回复被中断；请重试以检查或继续同一请求。" },
  };
  const inProgress = {
    fr: "Votre demande est encore en cours. Réessayez dans quelques instants pour vérifier sa réponse.",
    en: "Your request is still in progress. Try again in a moment to check for its reply.",
    es: "Tu solicitud sigue en curso. Reintenta en un momento para comprobar la respuesta.",
    it: "La richiesta è ancora in corso. Riprova tra poco per controllare la risposta.",
    de: "Deine Anfrage wird noch bearbeitet. Versuche es gleich erneut, um nach der Antwort zu sehen.",
    nl: "Je aanvraag wordt nog verwerkt. Probeer het zo opnieuw om het antwoord te controleren.",
    pt: "O seu pedido ainda está em curso. Tente novamente dentro de momentos para verificar a resposta.",
    th: "คำขอของคุณยังอยู่ระหว่างดำเนินการ โปรดลองอีกครั้งในอีกสักครู่เพื่อตรวจสอบคำตอบ",
    zh: "你的请求仍在处理中。请稍后重试以检查回复。",
  };
  const history = {
    fr: { history: "Historique des conversations", historyLoading: "Chargement de l’historique…", historyEmpty: "Aucune conversation enregistrée pour le moment.", historyUnavailable: "L’historique du compte est momentanément indisponible. Cette conversation reste ouverte.", historyOlder: "Les 20 conversations récentes sont affichées. L’assistant peut retrouver les échanges plus anciens.", replaceDraft: "Votre brouillon sera remplacé. Voulez-vous ouvrir cette conversation ?", openConversation: "Ouvrir", keepDraft: "Garder mon brouillon" },
    en: { history: "Conversation history", historyLoading: "Loading history…", historyEmpty: "No saved conversations yet.", historyUnavailable: "Account history is temporarily unavailable. This conversation remains open.", historyOlder: "The 20 most recent conversations are shown. The assistant can find older exchanges.", replaceDraft: "Your draft will be replaced. Open this conversation?", openConversation: "Open", keepDraft: "Keep my draft" },
    es: { history: "Historial de conversaciones", historyLoading: "Cargando el historial…", historyEmpty: "Todavía no hay conversaciones guardadas.", historyUnavailable: "El historial de la cuenta no está disponible temporalmente. Esta conversación sigue abierta.", historyOlder: "Se muestran las 20 conversaciones más recientes. El asistente puede encontrar intercambios anteriores.", replaceDraft: "Se reemplazará tu borrador. ¿Abrir esta conversación?", openConversation: "Abrir", keepDraft: "Conservar mi borrador" },
    it: { history: "Cronologia delle conversazioni", historyLoading: "Caricamento della cronologia…", historyEmpty: "Nessuna conversazione salvata per il momento.", historyUnavailable: "La cronologia dell’account non è temporaneamente disponibile. Questa conversazione resta aperta.", historyOlder: "Sono mostrate le 20 conversazioni più recenti. L’assistente può ritrovare gli scambi precedenti.", replaceDraft: "La bozza verrà sostituita. Aprire questa conversazione?", openConversation: "Apri", keepDraft: "Conserva la bozza" },
    de: { history: "Gesprächsverlauf", historyLoading: "Verlauf wird geladen…", historyEmpty: "Noch keine gespeicherten Gespräche.", historyUnavailable: "Der Kontoverlauf ist vorübergehend nicht verfügbar. Dieses Gespräch bleibt geöffnet.", historyOlder: "Die 20 neuesten Gespräche werden angezeigt. Der Assistent kann ältere Gespräche finden.", replaceDraft: "Dein Entwurf wird ersetzt. Dieses Gespräch öffnen?", openConversation: "Öffnen", keepDraft: "Entwurf behalten" },
    nl: { history: "Gespreksgeschiedenis", historyLoading: "Geschiedenis laden…", historyEmpty: "Er zijn nog geen opgeslagen gesprekken.", historyUnavailable: "De accountgeschiedenis is tijdelijk niet beschikbaar. Dit gesprek blijft open.", historyOlder: "De 20 recentste gesprekken worden getoond. De assistent kan oudere gesprekken terugvinden.", replaceDraft: "Je concept wordt vervangen. Dit gesprek openen?", openConversation: "Openen", keepDraft: "Concept bewaren" },
    pt: { history: "Histórico de conversas", historyLoading: "A carregar o histórico…", historyEmpty: "Ainda não há conversas guardadas.", historyUnavailable: "O histórico da conta está temporariamente indisponível. Esta conversa continua aberta.", historyOlder: "São apresentadas as 20 conversas mais recentes. O assistente pode encontrar trocas anteriores.", replaceDraft: "O rascunho será substituído. Abrir esta conversa?", openConversation: "Abrir", keepDraft: "Manter o rascunho" },
    th: { history: "ประวัติบทสนทนา", historyLoading: "กำลังโหลดประวัติ…", historyEmpty: "ยังไม่มีบทสนทนาที่บันทึกไว้", historyUnavailable: "ประวัติบัญชีไม่พร้อมใช้งานชั่วคราว บทสนทนานี้ยังเปิดอยู่", historyOlder: "แสดงบทสนทนาล่าสุด 20 รายการ ผู้ช่วยสามารถค้นหาบทสนทนาที่เก่ากว่าได้", replaceDraft: "ข้อความร่างจะถูกแทนที่ ต้องการเปิดบทสนทนานี้ไหม?", openConversation: "เปิด", keepDraft: "เก็บข้อความร่างไว้" },
    zh: { history: "对话历史", historyLoading: "正在加载历史记录…", historyEmpty: "尚无已保存的对话。", historyUnavailable: "账户历史记录暂时不可用。当前对话仍保持打开。", historyOlder: "显示最近20段对话。助手可以查找更早的交流。", replaceDraft: "你的草稿将被替换。要打开此对话吗？", openConversation: "打开", keepDraft: "保留草稿" },
  };
  const position = {
    fr: { moveLeft: "Placer la fenêtre à gauche", moveRight: "Placer la fenêtre à droite" },
    en: { moveLeft: "Move window to the left", moveRight: "Move window to the right" },
    es: { moveLeft: "Mover la ventana a la izquierda", moveRight: "Mover la ventana a la derecha" },
    it: { moveLeft: "Sposta la finestra a sinistra", moveRight: "Sposta la finestra a destra" },
    de: { moveLeft: "Fenster nach links verschieben", moveRight: "Fenster nach rechts verschieben" },
    nl: { moveLeft: "Venster naar links verplaatsen", moveRight: "Venster naar rechts verplaatsen" },
    pt: { moveLeft: "Mover a janela para a esquerda", moveRight: "Mover a janela para a direita" },
    th: { moveLeft: "ย้ายหน้าต่างไปทางซ้าย", moveRight: "ย้ายหน้าต่างไปทางขวา" },
    zh: { moveLeft: "将窗口移到左侧", moveRight: "将窗口移到右侧" },
  };
  const media = {
    fr: { mediaProcessing: "Votre média est en cours de création.", mediaFailed: "La création du média n’a pas abouti.", mediaReady: "Média créé", mediaLibrary: "Voir dans mes médias", keepWorking: "Vous pouvez réduire cette fenêtre et continuer dans l’application." },
    en: { mediaProcessing: "Your media is being created.", mediaFailed: "Media creation failed.", mediaReady: "Created media", mediaLibrary: "View in my media", keepWorking: "You can minimize this window and continue using the app." },
    es: { mediaProcessing: "Tu contenido multimedia se está creando.", mediaFailed: "No se ha podido crear el contenido multimedia.", mediaReady: "Contenido creado", mediaLibrary: "Ver en mis medios", keepWorking: "Puedes minimizar esta ventana y seguir usando la aplicación." },
    it: { mediaProcessing: "Il contenuto multimediale è in creazione.", mediaFailed: "La creazione del contenuto non è riuscita.", mediaReady: "Contenuto creato", mediaLibrary: "Vedi nei miei media", keepWorking: "Puoi ridurre questa finestra e continuare a usare l’app." },
    de: { mediaProcessing: "Dein Medium wird erstellt.", mediaFailed: "Die Medienerstellung ist fehlgeschlagen.", mediaReady: "Erstelltes Medium", mediaLibrary: "In meinen Medien ansehen", keepWorking: "Du kannst dieses Fenster minimieren und die App weiter nutzen." },
    nl: { mediaProcessing: "Je media wordt gemaakt.", mediaFailed: "Het maken van de media is mislukt.", mediaReady: "Gemaakte media", mediaLibrary: "Bekijken in mijn media", keepWorking: "Je kunt dit venster verkleinen en de app blijven gebruiken." },
    pt: { mediaProcessing: "O seu conteúdo está a ser criado.", mediaFailed: "Não foi possível criar o conteúdo.", mediaReady: "Conteúdo criado", mediaLibrary: "Ver nos meus conteúdos", keepWorking: "Pode minimizar esta janela e continuar a utilizar a aplicação." },
    th: { mediaProcessing: "กำลังสร้างสื่อของคุณ", mediaFailed: "สร้างสื่อไม่สำเร็จ", mediaReady: "สื่อที่สร้างแล้ว", mediaLibrary: "ดูในสื่อของฉัน", keepWorking: "คุณสามารถย่อหน้าต่างนี้แล้วใช้งานแอปต่อได้" },
    zh: { mediaProcessing: "正在创建你的媒体。", mediaFailed: "媒体创建失败。", mediaReady: "已创建的媒体", mediaLibrary: "在我的媒体中查看", keepWorking: "你可以最小化此窗口并继续使用应用。" },
  };
  const collaboration: Record<string, CollaborationCopy> = {
    fr: { collaboration: "Collaboration", collaborating: "En collaboration avec", activityUnconfirmed: "À vérifier", activityStatuses: { running: "En cours", completed: "Terminé", blocked: "À préciser", failed: "Échec" } },
    en: { collaboration: "Collaboration", collaborating: "Collaborating with", activityUnconfirmed: "Check status", activityStatuses: { running: "Working", completed: "Done", blocked: "Needs input", failed: "Failed" } },
    es: { collaboration: "Colaboración", collaborating: "En colaboración con", activityUnconfirmed: "Por verificar", activityStatuses: { running: "En curso", completed: "Terminado", blocked: "Por aclarar", failed: "Error" } },
    it: { collaboration: "Collaborazione", collaborating: "In collaborazione con", activityUnconfirmed: "Da verificare", activityStatuses: { running: "In corso", completed: "Completato", blocked: "Da chiarire", failed: "Errore" } },
    de: { collaboration: "Zusammenarbeit", collaborating: "In Zusammenarbeit mit", activityUnconfirmed: "Status prüfen", activityStatuses: { running: "In Arbeit", completed: "Fertig", blocked: "Rückfrage", failed: "Fehler" } },
    nl: { collaboration: "Samenwerking", collaborating: "In samenwerking met", activityUnconfirmed: "Controleren", activityStatuses: { running: "Bezig", completed: "Klaar", blocked: "Vraag open", failed: "Mislukt" } },
    pt: { collaboration: "Colaboração", collaborating: "Em colaboração com", activityUnconfirmed: "Por verificar", activityStatuses: { running: "Em curso", completed: "Concluído", blocked: "Por esclarecer", failed: "Erro" } },
    th: { collaboration: "การทำงานร่วมกัน", collaborating: "ทำงานร่วมกับ", activityUnconfirmed: "ตรวจสอบสถานะ", activityStatuses: { running: "กำลังทำงาน", completed: "เสร็จแล้ว", blocked: "ต้องการข้อมูล", failed: "ไม่สำเร็จ" } },
    zh: { collaboration: "协作", collaborating: "正在协作：", activityUnconfirmed: "待确认", activityStatuses: { running: "进行中", completed: "已完成", blocked: "需补充", failed: "失败" } },
  };
  return { ...(COPY[language] || COPY.fr), ...(UTILITY_COPY[language] || UTILITY_COPY.fr), ...(media[language] || media.fr), ...(position[language] || position.fr), ...(recovery[language] || recovery.fr), ...(history[language] || history.fr), ...(collaboration[language] || collaboration.fr), ...(ONBOARDING_COPY[language] || ONBOARDING_COPY.fr), inProgress: inProgress[language] || inProgress.fr, nextSteps: nextSteps[language] || nextSteps.fr, newReply: newReply[language] || newReply.fr };
}
