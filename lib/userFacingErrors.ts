import { normalizeAppLanguage, type AppLanguageCode } from "@/lib/appLanguage";
import {
  getProviderPublicationErrorMessage,
  looksLikeEnglishErrorMessage,
} from "@/lib/publicationErrorFrench";
import { isMetaRateLimitError } from "@/lib/metaGraphErrorClassification";

export const FACEBOOK_RECONNECT_USER_MESSAGE = "Facebook à reconnecter. Rendez-vous dans Canaux.";
export const INSTAGRAM_RECONNECT_USER_MESSAGE = "Instagram à reconnecter. Rendez-vous dans Canaux.";
export const LINKEDIN_RECONNECT_USER_MESSAGE = "LinkedIn à reconnecter. Rendez-vous dans Canaux.";
export const GOOGLE_BUSINESS_RECONNECT_USER_MESSAGE = "Connexion Google Business à actualiser. Reconnectez le compte et cochez toutes les cases d’autorisation demandées par Google.";

type UserFacingErrorKey =
  | "generic"
  | "action_failed"
  | "rate_limit"
  | "not_available"
  | "network"
  | "ssl"
  | "credentials"
  | "timeout"
  | "session"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "service_unavailable"
  | "cancelled"
  | "expired"
  | "credits"
  | "period_limit"
  | "email_unconfirmed"
  | "video_required"
  | "vertical_video_required"
  | "file_too_large"
  | "file_format"
  | "media_missing"
  | "facebook_reconnect"
  | "instagram_reconnect"
  | "linkedin_reconnect"
  | "google_business_reconnect";

const LOCALIZED_ERROR_COPY: Record<AppLanguageCode, Record<UserFacingErrorKey, string>> = {
  fr: {
    generic: "Cette action n’a pas pu aboutir. Merci de réessayer.",
    action_failed: "L’action demandée n’a pas pu être finalisée. Merci de réessayer.",
    rate_limit: "Le service est très sollicité. Merci de réessayer dans quelques minutes.",
    not_available: "Cette action n’est pas encore disponible.",
    network: "Connexion au serveur impossible pour le moment. Merci de réessayer.",
    ssl: "La connexion sécurisée au serveur mail n’a pas pu être établie. Vérifiez ses réglages ou réessayez.",
    credentials: "Identifiant ou mot de passe incorrect. Vérifiez vos informations puis réessayez.",
    timeout: "Le serveur met trop de temps à répondre. Merci de réessayer.",
    session: "Votre session a expiré. Merci de vous reconnecter.",
    forbidden: "Vous n’avez pas l’autorisation d’effectuer cette action.",
    not_found: "L’information demandée est introuvable.",
    conflict: "Cette action est déjà en cours ou a déjà été effectuée.",
    invalid: "Certaines informations sont manquantes ou incorrectes.",
    service_unavailable: "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.",
    cancelled: "La connexion a été annulée.",
    expired: "Le lien ou l’accès a expiré. Merci de recommencer.",
    credits: "Vous n’avez pas assez de crédits pour cette action. Consultez votre solde et les options de recharge dans votre compte.",
    period_limit: "La limite de votre offre est atteinte pour cette période. Consultez votre offre et sa date de renouvellement dans votre compte.",
    email_unconfirmed: "Confirmez votre adresse e-mail avec le lien reçu avant de vous connecter.",
    video_required: "Ajoutez une vidéo avant de publier sur ce canal.",
    vertical_video_required: "Ajoutez une vidéo verticale au format 9:16 avant de publier sur ce canal.",
    file_too_large: "Ce fichier est trop volumineux. Choisissez un fichier plus léger ou réduisez sa taille avant de réessayer.",
    file_format: "Ce format de fichier n’est pas accepté. Choisissez l’un des formats indiqués dans l’application.",
    media_missing: "Le média enregistré n’est plus disponible. Choisissez un autre média ou lancez une nouvelle création.",
    facebook_reconnect: FACEBOOK_RECONNECT_USER_MESSAGE,
    instagram_reconnect: INSTAGRAM_RECONNECT_USER_MESSAGE,
    linkedin_reconnect: LINKEDIN_RECONNECT_USER_MESSAGE,
    google_business_reconnect: GOOGLE_BUSINESS_RECONNECT_USER_MESSAGE,
  },
  en: {
    generic: "This action could not be completed. Please try again.",
    action_failed: "The requested action could not be completed. Please try again.",
    rate_limit: "The service is busy right now. Please try again in a few minutes.",
    not_available: "This action is not available yet.",
    network: "We couldn’t connect to the server. Please try again.",
    ssl: "We couldn’t establish a secure connection to the mail server. Check its settings or try again.",
    credentials: "The username or password is incorrect. Check your details and try again.",
    timeout: "The server is taking too long to respond. Please try again.",
    session: "Your session has expired. Please sign in again.",
    forbidden: "You are not allowed to perform this action.",
    not_found: "The requested information could not be found.",
    conflict: "This action is already in progress or has already been completed.",
    invalid: "Some information is missing or incorrect.",
    service_unavailable: "The service is temporarily unavailable. Please try again in a few minutes.",
    cancelled: "The connection was cancelled.",
    expired: "The link or access has expired. Please start again.",
    credits: "You don’t have enough credits for this action. Check your balance and top-up options in your account.",
    period_limit: "You’ve reached your plan’s limit for this period. Check your plan and renewal date in your account.",
    email_unconfirmed: "Confirm your email address using the link you received before signing in.",
    video_required: "Add a video before publishing to this channel.",
    vertical_video_required: "Add a vertical video in 9:16 format before publishing to this channel.",
    file_too_large: "This file is too large. Choose a smaller file or reduce its size before trying again.",
    file_format: "This file format is not supported. Choose one of the formats listed in the application.",
    media_missing: "The saved media is no longer available. Choose another media item or start a new creation.",
    facebook_reconnect: "Facebook needs to be reconnected. Go to Channels.",
    instagram_reconnect: "Instagram needs to be reconnected. Go to Channels.",
    linkedin_reconnect: "LinkedIn needs to be reconnected. Go to Channels.",
    google_business_reconnect: "The Google Business connection needs updating. Reconnect it and select every permission requested by Google.",
  },
  es: {
    generic: "No se ha podido completar esta acción. Inténtalo de nuevo.",
    action_failed: "No se ha podido completar la acción solicitada. Inténtalo de nuevo.",
    rate_limit: "El servicio está muy solicitado. Inténtalo de nuevo en unos minutos.",
    not_available: "Esta acción todavía no está disponible.",
    network: "No se ha podido conectar con el servidor. Inténtalo de nuevo.",
    ssl: "No se ha podido establecer una conexión segura con el servidor de correo. Comprueba su configuración o inténtalo de nuevo.",
    credentials: "El usuario o la contraseña no son correctos. Comprueba los datos e inténtalo de nuevo.",
    timeout: "El servidor tarda demasiado en responder. Inténtalo de nuevo.",
    session: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
    forbidden: "No tienes permiso para realizar esta acción.",
    not_found: "No se ha encontrado la información solicitada.",
    conflict: "Esta acción ya está en curso o ya se ha realizado.",
    invalid: "Faltan algunos datos o no son correctos.",
    service_unavailable: "El servicio no está disponible temporalmente. Inténtalo de nuevo en unos minutos.",
    cancelled: "La conexión se ha cancelado.",
    expired: "El enlace o el acceso ha caducado. Vuelve a empezar.",
    credits: "No tienes suficientes créditos para esta acción. Consulta tu saldo y las opciones de recarga en tu cuenta.",
    period_limit: "Has alcanzado el límite de tu plan para este período. Consulta tu plan y su fecha de renovación en tu cuenta.",
    email_unconfirmed: "Confirma tu dirección de correo con el enlace recibido antes de iniciar sesión.",
    video_required: "Añade un vídeo antes de publicar en este canal.",
    vertical_video_required: "Añade un vídeo vertical en formato 9:16 antes de publicar en este canal.",
    file_too_large: "Este archivo es demasiado grande. Elige uno más pequeño o reduce su tamaño antes de volver a intentarlo.",
    file_format: "Este formato de archivo no es compatible. Elige uno de los formatos indicados en la aplicación.",
    media_missing: "El archivo guardado ya no está disponible. Elige otro archivo multimedia o inicia una nueva creación.",
    facebook_reconnect: "Hay que volver a conectar Facebook. Ve a Canales.",
    instagram_reconnect: "Hay que volver a conectar Instagram. Ve a Canales.",
    linkedin_reconnect: "Hay que volver a conectar LinkedIn. Ve a Canales.",
    google_business_reconnect: "Hay que actualizar la conexión de Google Business. Vuelve a conectarla y marca todos los permisos solicitados por Google.",
  },
  it: {
    generic: "Non è stato possibile completare questa azione. Riprova.",
    action_failed: "Non è stato possibile completare l’azione richiesta. Riprova.",
    rate_limit: "Il servizio è molto richiesto. Riprova tra qualche minuto.",
    not_available: "Questa azione non è ancora disponibile.",
    network: "Non è stato possibile connettersi al server. Riprova.",
    ssl: "Non è stato possibile stabilire una connessione sicura al server di posta. Controlla le impostazioni o riprova.",
    credentials: "Nome utente o password non corretti. Controlla i dati e riprova.",
    timeout: "Il server impiega troppo tempo a rispondere. Riprova.",
    session: "La sessione è scaduta. Accedi di nuovo.",
    forbidden: "Non hai l’autorizzazione per eseguire questa azione.",
    not_found: "Non è stato possibile trovare le informazioni richieste.",
    conflict: "Questa azione è già in corso o è già stata eseguita.",
    invalid: "Alcune informazioni mancano o non sono corrette.",
    service_unavailable: "Il servizio è temporaneamente indisponibile. Riprova tra qualche minuto.",
    cancelled: "La connessione è stata annullata.",
    expired: "Il link o l’accesso è scaduto. Ricomincia.",
    credits: "Non hai abbastanza crediti per questa azione. Controlla il saldo e le opzioni di ricarica nel tuo account.",
    period_limit: "Hai raggiunto il limite del tuo piano per questo periodo. Controlla il piano e la data di rinnovo nel tuo account.",
    email_unconfirmed: "Conferma il tuo indirizzo email con il link ricevuto prima di accedere.",
    video_required: "Aggiungi un video prima di pubblicare su questo canale.",
    vertical_video_required: "Aggiungi un video verticale in formato 9:16 prima di pubblicare su questo canale.",
    file_too_large: "Il file è troppo grande. Scegli un file più piccolo o riducine le dimensioni prima di riprovare.",
    file_format: "Questo formato di file non è supportato. Scegli uno dei formati indicati nell’applicazione.",
    media_missing: "Il contenuto multimediale salvato non è più disponibile. Scegline un altro o avvia una nuova creazione.",
    facebook_reconnect: "Facebook deve essere ricollegato. Vai su Canali.",
    instagram_reconnect: "Instagram deve essere ricollegato. Vai su Canali.",
    linkedin_reconnect: "LinkedIn deve essere ricollegato. Vai su Canali.",
    google_business_reconnect: "La connessione Google Business deve essere aggiornata. Ricollegala e seleziona tutte le autorizzazioni richieste da Google.",
  },
  de: {
    generic: "Diese Aktion konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
    action_failed: "Die angeforderte Aktion konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
    rate_limit: "Der Dienst ist gerade stark ausgelastet. Bitte versuchen Sie es in einigen Minuten erneut.",
    not_available: "Diese Aktion ist noch nicht verfügbar.",
    network: "Die Verbindung zum Server war nicht möglich. Bitte versuchen Sie es erneut.",
    ssl: "Eine sichere Verbindung zum Mailserver konnte nicht hergestellt werden. Prüfen Sie die Einstellungen oder versuchen Sie es erneut.",
    credentials: "Benutzername oder Passwort ist falsch. Prüfen Sie Ihre Angaben und versuchen Sie es erneut.",
    timeout: "Der Server antwortet zu langsam. Bitte versuchen Sie es erneut.",
    session: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
    forbidden: "Sie sind nicht berechtigt, diese Aktion auszuführen.",
    not_found: "Die angeforderten Informationen wurden nicht gefunden.",
    conflict: "Diese Aktion läuft bereits oder wurde schon ausgeführt.",
    invalid: "Einige Angaben fehlen oder sind nicht korrekt.",
    service_unavailable: "Der Dienst ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in einigen Minuten erneut.",
    cancelled: "Die Verbindung wurde abgebrochen.",
    expired: "Der Link oder Zugriff ist abgelaufen. Bitte beginnen Sie erneut.",
    credits: "Sie haben nicht genügend Guthaben für diese Aktion. Prüfen Sie Ihr Guthaben und die Aufladeoptionen in Ihrem Konto.",
    period_limit: "Das Limit Ihres Tarifs für diesen Zeitraum ist erreicht. Prüfen Sie Ihren Tarif und das Verlängerungsdatum in Ihrem Konto.",
    email_unconfirmed: "Bestätigen Sie Ihre E-Mail-Adresse über den erhaltenen Link, bevor Sie sich anmelden.",
    video_required: "Fügen Sie ein Video hinzu, bevor Sie auf diesem Kanal veröffentlichen.",
    vertical_video_required: "Fügen Sie ein vertikales Video im Format 9:16 hinzu, bevor Sie auf diesem Kanal veröffentlichen.",
    file_too_large: "Diese Datei ist zu groß. Wählen Sie eine kleinere Datei oder verkleinern Sie sie, bevor Sie es erneut versuchen.",
    file_format: "Dieses Dateiformat wird nicht unterstützt. Wählen Sie eines der in der Anwendung angegebenen Formate.",
    media_missing: "Das gespeicherte Medium ist nicht mehr verfügbar. Wählen Sie ein anderes Medium oder starten Sie eine neue Erstellung.",
    facebook_reconnect: "Facebook muss erneut verbunden werden. Öffnen Sie Kanäle.",
    instagram_reconnect: "Instagram muss erneut verbunden werden. Öffnen Sie Kanäle.",
    linkedin_reconnect: "LinkedIn muss erneut verbunden werden. Öffnen Sie Kanäle.",
    google_business_reconnect: "Die Google-Business-Verbindung muss aktualisiert werden. Verbinden Sie sie erneut und wählen Sie alle von Google angeforderten Berechtigungen aus.",
  },
  nl: {
    generic: "Deze actie kon niet worden voltooid. Probeer het opnieuw.",
    action_failed: "De gevraagde actie kon niet worden voltooid. Probeer het opnieuw.",
    rate_limit: "De dienst is momenteel druk. Probeer het over enkele minuten opnieuw.",
    not_available: "Deze actie is nog niet beschikbaar.",
    network: "Er kon geen verbinding met de server worden gemaakt. Probeer het opnieuw.",
    ssl: "Er kon geen veilige verbinding met de mailserver worden gemaakt. Controleer de instellingen of probeer het opnieuw.",
    credentials: "De gebruikersnaam of het wachtwoord is onjuist. Controleer uw gegevens en probeer het opnieuw.",
    timeout: "De server reageert te langzaam. Probeer het opnieuw.",
    session: "Uw sessie is verlopen. Meld u opnieuw aan.",
    forbidden: "U bent niet gemachtigd om deze actie uit te voeren.",
    not_found: "De gevraagde informatie kon niet worden gevonden.",
    conflict: "Deze actie wordt al uitgevoerd of is al uitgevoerd.",
    invalid: "Sommige gegevens ontbreken of zijn onjuist.",
    service_unavailable: "De dienst is tijdelijk niet beschikbaar. Probeer het over enkele minuten opnieuw.",
    cancelled: "De verbinding is geannuleerd.",
    expired: "De link of toegang is verlopen. Begin opnieuw.",
    credits: "U heeft niet genoeg credits voor deze actie. Bekijk uw saldo en opwaardeeropties in uw account.",
    period_limit: "U heeft de limiet van uw abonnement voor deze periode bereikt. Bekijk uw abonnement en de verlengdatum in uw account.",
    email_unconfirmed: "Bevestig uw e-mailadres via de ontvangen link voordat u zich aanmeldt.",
    video_required: "Voeg een video toe voordat u op dit kanaal publiceert.",
    vertical_video_required: "Voeg een verticale video in 9:16-formaat toe voordat u op dit kanaal publiceert.",
    file_too_large: "Dit bestand is te groot. Kies een kleiner bestand of verklein het voordat u het opnieuw probeert.",
    file_format: "Dit bestandsformaat wordt niet ondersteund. Kies een van de formaten die in de app staan.",
    media_missing: "Het opgeslagen mediabestand is niet meer beschikbaar. Kies een ander mediabestand of start een nieuwe creatie.",
    facebook_reconnect: "Facebook moet opnieuw worden verbonden. Ga naar Kanalen.",
    instagram_reconnect: "Instagram moet opnieuw worden verbonden. Ga naar Kanalen.",
    linkedin_reconnect: "LinkedIn moet opnieuw worden verbonden. Ga naar Kanalen.",
    google_business_reconnect: "De Google Business-verbinding moet worden bijgewerkt. Verbind opnieuw en selecteer alle door Google gevraagde toestemmingen.",
  },
  pt: {
    generic: "Não foi possível concluir esta ação. Tente novamente.",
    action_failed: "Não foi possível concluir a ação solicitada. Tente novamente.",
    rate_limit: "O serviço está muito solicitado. Tente novamente dentro de alguns minutos.",
    not_available: "Esta ação ainda não está disponível.",
    network: "Não foi possível ligar ao servidor. Tente novamente.",
    ssl: "Não foi possível estabelecer uma ligação segura ao servidor de correio. Verifique as definições ou tente novamente.",
    credentials: "O utilizador ou a palavra-passe estão incorretos. Verifique os dados e tente novamente.",
    timeout: "O servidor está a demorar demasiado a responder. Tente novamente.",
    session: "A sua sessão expirou. Inicie sessão novamente.",
    forbidden: "Não tem autorização para executar esta ação.",
    not_found: "Não foi possível encontrar a informação pedida.",
    conflict: "Esta ação já está em curso ou já foi concluída.",
    invalid: "Faltam algumas informações ou estão incorretas.",
    service_unavailable: "O serviço está temporariamente indisponível. Tente novamente dentro de alguns minutos.",
    cancelled: "A ligação foi cancelada.",
    expired: "A ligação ou o acesso expirou. Comece novamente.",
    credits: "Não tem créditos suficientes para esta ação. Consulte o saldo e as opções de recarga na sua conta.",
    period_limit: "Atingiu o limite do seu plano para este período. Consulte o plano e a data de renovação na sua conta.",
    email_unconfirmed: "Confirme o seu endereço de email através da ligação recebida antes de iniciar sessão.",
    video_required: "Adicione um vídeo antes de publicar neste canal.",
    vertical_video_required: "Adicione um vídeo vertical no formato 9:16 antes de publicar neste canal.",
    file_too_large: "Este ficheiro é demasiado grande. Escolha um mais pequeno ou reduza o tamanho antes de tentar novamente.",
    file_format: "Este formato de ficheiro não é suportado. Escolha um dos formatos indicados na aplicação.",
    media_missing: "O ficheiro multimédia guardado já não está disponível. Escolha outro ficheiro ou inicie uma nova criação.",
    facebook_reconnect: "É necessário ligar novamente o Facebook. Aceda a Canais.",
    instagram_reconnect: "É necessário ligar novamente o Instagram. Aceda a Canais.",
    linkedin_reconnect: "É necessário ligar novamente o LinkedIn. Aceda a Canais.",
    google_business_reconnect: "É necessário atualizar a ligação ao Google Business. Ligue novamente e selecione todas as autorizações pedidas pela Google.",
  },
  th: {
    generic: "ไม่สามารถดำเนินการนี้ให้เสร็จสิ้นได้ โปรดลองอีกครั้ง",
    action_failed: "ไม่สามารถดำเนินการตามที่ขอให้เสร็จสิ้นได้ โปรดลองอีกครั้ง",
    rate_limit: "ขณะนี้มีผู้ใช้บริการจำนวนมาก โปรดลองอีกครั้งในอีกไม่กี่นาที",
    not_available: "การดำเนินการนี้ยังไม่พร้อมใช้งาน",
    network: "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ในขณะนี้ โปรดลองอีกครั้ง",
    ssl: "ไม่สามารถสร้างการเชื่อมต่อที่ปลอดภัยกับเซิร์ฟเวอร์อีเมลได้ โปรดตรวจสอบการตั้งค่าหรือลองอีกครั้ง",
    credentials: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง โปรดตรวจสอบข้อมูลแล้วลองอีกครั้ง",
    timeout: "เซิร์ฟเวอร์ใช้เวลาตอบสนองนานเกินไป โปรดลองอีกครั้ง",
    session: "เซสชันของคุณหมดอายุแล้ว โปรดเข้าสู่ระบบอีกครั้ง",
    forbidden: "คุณไม่มีสิทธิ์ดำเนินการนี้",
    not_found: "ไม่พบข้อมูลที่ต้องการ",
    conflict: "การดำเนินการนี้กำลังดำเนินอยู่หรือเสร็จสิ้นแล้ว",
    invalid: "ข้อมูลบางส่วนขาดหายไปหรือไม่ถูกต้อง",
    service_unavailable: "บริการไม่พร้อมใช้งานชั่วคราว โปรดลองอีกครั้งในอีกไม่กี่นาที",
    cancelled: "การเชื่อมต่อถูกยกเลิกแล้ว",
    expired: "ลิงก์หรือสิทธิ์เข้าถึงหมดอายุแล้ว โปรดเริ่มใหม่อีกครั้ง",
    credits: "คุณมีเครดิตไม่เพียงพอสำหรับการดำเนินการนี้ โปรดตรวจสอบยอดคงเหลือและตัวเลือกเติมเครดิตในบัญชีของคุณ",
    period_limit: "คุณใช้ครบขีดจำกัดของแพ็กเกจสำหรับรอบนี้แล้ว โปรดตรวจสอบแพ็กเกจและวันต่ออายุในบัญชีของคุณ",
    email_unconfirmed: "โปรดยืนยันอีเมลผ่านลิงก์ที่ได้รับก่อนเข้าสู่ระบบ",
    video_required: "โปรดเพิ่มวิดีโอก่อนเผยแพร่ในช่องทางนี้",
    vertical_video_required: "โปรดเพิ่มวิดีโอแนวตั้งในรูปแบบ 9:16 ก่อนเผยแพร่ในช่องทางนี้",
    file_too_large: "ไฟล์นี้มีขนาดใหญ่เกินไป โปรดเลือกไฟล์ที่เล็กกว่าหรือลดขนาดไฟล์ก่อนลองอีกครั้ง",
    file_format: "ไม่รองรับไฟล์รูปแบบนี้ โปรดเลือกรูปแบบที่ระบุไว้ในแอปพลิเคชัน",
    media_missing: "สื่อที่บันทึกไว้ไม่พร้อมใช้งานแล้ว โปรดเลือกสื่ออื่นหรือเริ่มสร้างใหม่",
    facebook_reconnect: "ต้องเชื่อมต่อ Facebook ใหม่ ไปที่เมนูช่องทาง",
    instagram_reconnect: "ต้องเชื่อมต่อ Instagram ใหม่ ไปที่เมนูช่องทาง",
    linkedin_reconnect: "ต้องเชื่อมต่อ LinkedIn ใหม่ ไปที่เมนูช่องทาง",
    google_business_reconnect: "ต้องอัปเดตการเชื่อมต่อ Google Business โปรดเชื่อมต่อใหม่และเลือกสิทธิ์ทั้งหมดที่ Google ร้องขอ",
  },
  zh: {
    generic: "无法完成此操作，请重试。",
    action_failed: "无法完成所请求的操作，请重试。",
    rate_limit: "服务当前繁忙，请几分钟后重试。",
    not_available: "此操作尚不可用。",
    network: "目前无法连接服务器，请重试。",
    ssl: "无法与邮件服务器建立安全连接。请检查设置或重试。",
    credentials: "用户名或密码不正确。请检查信息后重试。",
    timeout: "服务器响应时间过长，请重试。",
    session: "您的会话已过期，请重新登录。",
    forbidden: "您无权执行此操作。",
    not_found: "找不到所请求的信息。",
    conflict: "此操作正在进行中或已经完成。",
    invalid: "部分信息缺失或不正确。",
    service_unavailable: "服务暂时不可用，请几分钟后重试。",
    cancelled: "连接已取消。",
    expired: "链接或访问权限已过期，请重新开始。",
    credits: "您的积分不足以执行此操作。请在账户中查看余额和充值选项。",
    period_limit: "您已达到本期套餐限额。请在账户中查看套餐和续期日期。",
    email_unconfirmed: "请先通过收到的链接验证电子邮件地址，然后再登录。",
    video_required: "请先添加视频，再发布到此渠道。",
    vertical_video_required: "请先添加9:16格式的竖屏视频，再发布到此渠道。",
    file_too_large: "此文件过大。请更换较小的文件，或缩小文件后重试。",
    file_format: "不支持此文件格式。请选择应用中列出的格式。",
    media_missing: "已保存的媒体不再可用。请选择其他媒体或重新创建。",
    facebook_reconnect: "需要重新连接 Facebook。请前往“渠道”。",
    instagram_reconnect: "需要重新连接 Instagram。请前往“渠道”。",
    linkedin_reconnect: "需要重新连接 LinkedIn。请前往“渠道”。",
    google_business_reconnect: "需要更新 Google Business 连接。请重新连接，并勾选 Google 要求的全部权限。",
  },
};

function hasAuthSignal(raw: string): boolean {
  return matches(raw, [
    "authorization error",
    "autorisation error",
    "authorisation error",
    "not authorized",
    "not authorised",
    "unauthorized",
    "unauthorised",
    "permission",
    "permissions",
    "scope",
    "scopes",
    "insufficient",
    "access token",
    "oauth",
    "token expired",
    "expired token",
    "session has expired",
    "invalid_grant",
    "invalid token",
    "refresh token",
    "consent",
    "code 10",
    "code 190",
    "code 200",
    "(#10)",
    "(#190)",
    "(#200)",
    "401",
  ]);
}

export function isFacebookAuthorizationLikeMessage(input: unknown): boolean {
  const raw = normalizeRawMessage(input).toLowerCase();
  if (!raw) return false;
  if (isMetaRateLimitError({ message: raw })) return false;
  const hasFacebook = matches(raw, ["facebook", "meta", "graph", "page token", "page access", "pages_manage_posts", "pages_read_engagement"]);
  return hasFacebook && hasAuthSignal(raw);
}

export function isInstagramAuthorizationLikeMessage(input: unknown): boolean {
  const raw = normalizeRawMessage(input).toLowerCase();
  if (!raw) return false;
  if (isMetaRateLimitError({ message: raw })) return false;
  const hasInstagram = matches(raw, ["instagram", "ig_user", "ig user", "instagram_content_publish"]);
  return hasInstagram && hasAuthSignal(raw);
}

export function isLinkedInAuthorizationLikeMessage(input: unknown): boolean {
  const raw = normalizeRawMessage(input).toLowerCase();
  if (!raw) return false;
  const hasLinkedIn = matches(raw, ["linkedin", "urn:li", "restli", "member", "organization"]);
  return hasLinkedIn && hasAuthSignal(raw);
}

export function isGoogleBusinessAuthorizationLikeMessage(input: unknown): boolean {
  const raw = normalizeRawMessage(input).toLowerCase();
  if (!raw) return false;
  const hasGoogleBusiness = matches(raw, ["google business", "gmb", "business profile", "mybusiness", "fiche google"]);
  return hasGoogleBusiness && hasAuthSignal(raw);
}

export function getSimpleFrenchErrorMessage(input: unknown, fallback = "Cette action n'a pas pu aboutir. Merci de réessayer."): string {
  fallback = safeFallback(fallback, "fr");
  const explicitCodeKey = resolveExplicitErrorCodeKey(input);
  if (explicitCodeKey) return LOCALIZED_ERROR_COPY.fr[explicitCodeKey];
  const raw = normalizeRawMessage(input);
  const knownKey = resolveStructuredErrorKey(input);
  if (knownKey) return LOCALIZED_ERROR_COPY.fr[knownKey];
  if (!raw) return fallback;
  if (looksLikeFrenchMessage(raw) && !looksTechnical(raw) && !looksLikeEnglishErrorMessage(raw)) return sanitizeSentence(raw);

  const message = raw.toLowerCase();

  const providerMessage =
    getProviderPublicationErrorMessage(
      message.includes("pinterest") ||
        message.includes("same width/height ratios") ||
        message.includes("same aspect ratio")
        ? "pinterest"
        : message.includes("tiktok") ||
            message.includes("url_ownership_unverified") ||
            message.includes("url properties have not been verified")
          ? "tiktok"
          : message.includes("instagram")
            ? "instagram"
            : message.includes("facebook") || message.includes("meta graph")
              ? "facebook"
              : message.includes("linkedin")
                ? "linkedin"
                : message.includes("google business") || message.includes("gmb")
                  ? "gmb"
                  : message.includes("youtube")
                    ? "youtube_shorts"
                    : "site_web",
      raw,
    );
  if (providerMessage) return providerMessage;

  if (isFacebookAuthorizationLikeMessage(raw)) {
    return FACEBOOK_RECONNECT_USER_MESSAGE;
  }

  if (isInstagramAuthorizationLikeMessage(raw)) {
    return INSTAGRAM_RECONNECT_USER_MESSAGE;
  }

  if (isLinkedInAuthorizationLikeMessage(raw)) {
    return LINKEDIN_RECONNECT_USER_MESSAGE;
  }

  if (isGoogleBusinessAuthorizationLikeMessage(raw)) {
    return GOOGLE_BUSINESS_RECONNECT_USER_MESSAGE;
  }

  if (matches(message, ["fetch_failed:429", "summary_failed:429", "rate limit", "rate-limit", "too many requests", "quota exceeded", "quotas atteints", "quota backend unavailable", "rate limiter unavailable", "too_many_requests", "resource_exhausted"])) {
    return "Quotas atteints, merci de réessayer dans quelques minutes.";
  }

  if (matches(message, ["fetch_failed:501", "summary_failed:501", "501", "not implemented"])) {
    return "Cette action n'est pas encore disponible.";
  }

  if (matches(message, ["insufficient authentication scopes", "request had insufficient authentication scopes"])) {
    return "Compte Google à reconnecter : recommencez la connexion et cochez toutes les cases d’autorisation demandées par Google.";
  }

  if (matches(message, ["aucune propriété ga4 ne correspond à ce domaine", "aucune propriete ga4 ne correspond a ce domaine"])) {
    return "Aucune propriété GA4 ne correspond à ce domaine sur ce compte Google.";
  }

  if (matches(message, ["failed to fetch", "networkerror", "network request failed", "load failed", "fetch failed", "impossible de joindre le serveur", "network error", "econnreset", "econnrefused", "enotfound", "socket hang up"])) {
    return "Connexion au serveur impossible pour le moment. Merci de réessayer.";
  }

  if (matches(message, ["self-signed certificate", "self signed certificate", "certificate chain", "unable to verify the first certificate", "unable to get local issuer certificate", "hostname/ip does not match certificate", "certificate has expired", "certificate not yet valid"])) {
    return "Le serveur mail présente un certificat SSL non reconnu. Vérifiez les réglages du serveur ou réessayez avec la tolérance SSL activée.";
  }

  if (matches(message, [
    "client authentication failed",
    "invalid_client",
    "invalid client",
    "invalid_client_secret",
    "invalid_client_id"
  ])) {
    return "Configuration LinkedIn incorrecte : vérifiez Client ID, Client Secret et URL de redirection.";
  }

  if (matches(message, ["authentication failed", "invalid login", "invalid credentials for smtp", "username and password not accepted", "535 5.7.1", "login failed"])) {
    return "Identifiant ou mot de passe incorrect pour ce serveur mail.";
  }

  if (matches(message, ["timeout", "timed out", "deadline exceeded", "aborterror", "this operation was aborted"])) {
    return "Le serveur met trop de temps à répondre. Merci de réessayer.";
  }

  if (matches(message, ["insufficient permissions to access this data", "(#10)", "access this data"])) {
    return "Désolé, cette publication Instagram ne peut pas être supprimée depuis l'application : vérifiez la connexion Meta Business et réessayez ou supprimez-la depuis Instagram.";
  }

  if (matches(message, ["401", "unauthorized", "not authenticated", "non authentifi", "session", "jwt expired", "refresh token", "auth session missing", "invalid refresh token"])) {
    return "Votre session a expiré. Merci de vous reconnecter.";
  }

  if (matches(message, ["403", "forbidden", "access denied", "origin not allowed", "non autoris"])) {
    return "Vous n'avez pas l'autorisation pour effectuer cette action.";
  }

  if (matches(message, ["404", "not found", "introuvable", "missing id", "identifiant manquant", "aucun abonnement stripe trouvé"])) {
    return "L'information demandée est introuvable.";
  }

  if (matches(message, ["jeton expiré", "token expired", "expired token", "expired link"])) {
    return "Le lien ou l'accès a expiré. Merci de recommencer.";
  }

  if (matches(message, ["409", "already", "already exists", "duplicate", "conflit"])) {
    return "Cette action est déjà en cours ou a déjà été effectuée.";
  }

  if (matches(message, ["400", "422", "unprocessable", "invalid", "body json invalide", "bad request", "type d'action invalide", "produit inconnu", "solde ui insuffisant", "identifiant de compte manquant", "configuration serveur incomplète", "missing channels", "missing idea", "email manquant", "plan invalide", "aucune ligne importable", "renseigne ", "json invalide", "missing accountid", "missing to", "missing email", "missing domain", "missing token", "missing access token", "missing imageurl", "missing iguserid", "smtp config missing", "site url invalid or missing", "invalid token", "invalid source", "filereader error", "impossible de lire ce fichier", "format du jeton invalide", "signature du jeton invalide", "contenu du jeton invalide", "lien d'accès est invalide", "port invalide", "numéro de port", "configuration smtp incomplète", "configuration d'envoi de la messagerie est incomplète", "paramètres invalides", "parametres invalides", "organisation manquante", "source ou produit manquant", "source invalide", "produit invalide", "lien du site manquant ou invalide", "merci de renseigner l'identifiant et le mot de passe", "identifiant et mot de passe requis", "compte instagram non connecté", "compte linkedin non connecté", "compte instagram non connecte", "compte linkedin non connecte", "domaine manquant", "identifiant manquant"])) {
    return "Certaines informations sont manquantes ou incorrectes.";
  }

  if (matches(message, ["500", "502", "503", "504", "server error", "internal server error", "unknown error", "unknown", "unhandled", "db read failed", "db insert failed", "db upsert failed", "userinfo fetch failed", "oauth callback failed", "oauth_config_missing", "oauth_callback_failed", "invalid_state", "missing_state", "token_exchange_failed", "overview_failed", "openai", "ai gateway", "service ia", "stripe error", "webhook error", "stripe customer manquant", "getpublicurl returned empty", "invalid dataurl", "optimized image url unavailable", "missing openai_api_key", "bad payload", "rate limiting unavailable", "ga4 admin request failed", "gsc sites.list failed", "inrstats_opportunities_failed", "actus", "issue-token"])) {
    return "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.";
  }


  if (matches(message, ["access_denied", "user_denied", "access denied by user", "consent denied"])) {
    return "La connexion a été annulée.";
  }

  if (matches(message, ["invalid login credentials", "email not confirmed", "invalid credentials"])) {
    return "Identifiants incorrects. Vérifiez vos informations puis réessayez.";
  }

  if (matches(message, ["email rate limit exceeded", "over_email_send_rate_limit", "email link is invalid or has expired", "otp expired"])) {
    return "Le lien n'est plus valide ou l'envoi est temporairement limité. Merci de réessayer dans quelques minutes.";
  }

  if (matches(message, [
    "variante vidéo",
    "variante video",
    "version canonique de la vidéo",
    "version canonique de la video",
    "vidéo est encore en préparation",
    "video est encore en preparation",
    "doit être préparée en mp4",
    "doit etre preparee en mp4",
    "durée de la vidéo",
    "duree de la video",
    "résolution de la vidéo",
    "resolution de la video",
  ])) {
    return sanitizeSentence(raw);
  }

  if (matches(message, ["photo upload failed", "facebook feed post failed", "linkedin publish failed", "gmb create post error", "instagram", "publish error", "performance api error", "runreport failed", "gsc query failed", "microsoft send failed", "imap send failed", "token refresh failed", "db update failed", "google business", "facebook", "linkedin", "tiktok", "pinterest", "mail account not found", "missing_access_token", "google_calendar_integration_removed", "instagram optimized image url unavailable", "storage upload", "upload failed", "signature-image", "image upload", "invalid mime type"])) {
    return "L'action demandée n'a pas pu être finalisée pour le moment. Merci de réessayer.";
  }


  if (matches(message, ["google a expiré", "connexion google expirée", "connexion google expiree"])) {
    return "La connexion Google a expiré. Merci de reconnecter votre compte.";
  }

  if (matches(message, ["compte google business invalide", "compte linkedin invalide", "connexion linkedin invalide", "boîte outlook introuvable", "boite outlook introuvable", "compte imap introuvable", "source invalide"])) {
    return "La connexion concernée n'est pas valide ou n'est plus disponible.";
  }

  if (matches(message, ["facebook n’est pas encore correctement relié", "facebook n'est pas encore correctement relie", "instagram n’est pas encore correctement relié", "instagram n'est pas encore correctement relie", "linkedin n’est pas encore correctement relié", "linkedin n'est pas encore correctement relie", "google business n’est pas encore correctement reliée", "google business n'est pas encore correctement reliee"])) {
    return "Le compte concerné n'est pas encore correctement connecté.";
  }

  if (matches(message, ["maximum 5 images", "instagram nécessite au moins 1 image", "instagram necessite au moins 1 image", "le contenu est vide"])) {
    return sanitizeSentence(raw);
  }

  if (looksTechnical(raw) || looksLikeEnglishErrorMessage(raw)) {
    return fallback;
  }

  return looksLikeFrenchMessage(raw) ? sanitizeSentence(raw) : fallback;
}

export function getLocalizedErrorMessage(
  input: unknown,
  language: AppLanguageCode | string | null | undefined,
  fallback?: string,
  options: { allowUnknownMessage?: boolean } = {},
): string {
  const normalizedLanguage = normalizeAppLanguage(language);
  const raw = normalizeRawMessage(input);
  const localizedFallback = safeFallback(fallback, normalizedLanguage);
  const explicitCodeKey = resolveExplicitErrorCodeKey(input);
  if (explicitCodeKey) return LOCALIZED_ERROR_COPY[normalizedLanguage][explicitCodeKey];
  if (raw === localizedFallback) return localizedFallback;
  if ((Object.values(LOCALIZED_ERROR_COPY[normalizedLanguage]) as string[]).includes(raw)) return raw;
  const existingCopyKey = (Object.keys(LOCALIZED_ERROR_COPY.fr) as UserFacingErrorKey[])
    .find(key => LOCALIZED_ERROR_COPY.fr[key] === raw);
  if (existingCopyKey) return LOCALIZED_ERROR_COPY[normalizedLanguage][existingCopyKey];
  const structuredKey = resolveStructuredErrorKey(input, options.allowUnknownMessage !== false);
  if (structuredKey) return LOCALIZED_ERROR_COPY[normalizedLanguage][structuredKey];
  if (looksTechnical(raw) && resolveUserFacingErrorKey(input, "") === "generic") return localizedFallback;
  const frenchMessage = getSimpleFrenchErrorMessage(input);
  const key = resolveUserFacingErrorKey(input, frenchMessage);
  if (key === "generic") {
    if (options.allowUnknownMessage === false) return localizedFallback;
    if (normalizedLanguage === "fr" && frenchMessage !== LOCALIZED_ERROR_COPY.fr.generic && frenchMessage !== getSimpleFrenchErrorMessage(null)) return frenchMessage;
    if (normalizedLanguage === "en" && raw && !looksTechnical(raw) && looksLikeEnglishErrorMessage(raw)) return sanitizeSentence(raw);
    return localizedFallback;
  }
  if (key) return LOCALIZED_ERROR_COPY[normalizedLanguage][key];
  if (options.allowUnknownMessage === false) return localizedFallback;
  if (!raw || looksTechnical(raw) || looksLikeEnglishErrorMessage(raw)) return localizedFallback;
  // A translated caller fallback keeps the action context when an unknown
  // server sentence is written in another language. Never display diagnostics.
  if (normalizedLanguage !== "fr" && fallback && looksLikeFrenchMessage(raw)) return localizedFallback;
  if (normalizedLanguage !== "fr" && looksLikeFrenchMessage(raw)) return LOCALIZED_ERROR_COPY[normalizedLanguage].generic;
  return normalizedLanguage === "fr" ? frenchMessage : sanitizeSentence(raw);
}

export function getClientErrorLanguage(): AppLanguageCode {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("inrcy_app_language_v1");
      if (stored) return normalizeAppLanguage(stored);
    } catch {
      // The page locale remains available when browser storage is blocked.
    }
  }
  return typeof document !== "undefined" ? normalizeAppLanguage(document.documentElement.lang) : "fr";
}

export function getClientUserFacingErrorMessage(input: unknown, fallback?: string, options: { allowUnknownMessage?: boolean } = {}): string {
  return getLocalizedErrorMessage(input, getClientErrorLanguage(), fallback, options);
}

export async function getLocalizedApiError(
  res: Response,
  language: AppLanguageCode | string | null | undefined,
  fallback?: string,
): Promise<string> {
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json: unknown = await res.clone().json().catch(() => null);
      return getLocalizedErrorMessage(
        errorWithResponseStatus(json, res.status),
        language,
        fallback,
      );
    }
    const text = await res.clone().text().catch(() => "");
    return getLocalizedErrorMessage(errorWithResponseStatus(text, res.status), language, fallback);
  } catch {
    return getLocalizedErrorMessage({ status: res.status }, language, fallback);
  }
}

export async function getClientUserFacingApiError(res: Response, fallback?: string): Promise<string> {
  return getLocalizedApiError(res, getClientErrorLanguage(), fallback);
}

function resolveUserFacingErrorKey(input: unknown, frenchMessage: string): UserFacingErrorKey | null {
  const raw = normalizeRawMessage(input).toLowerCase();
  const message = `${raw} ${frenchMessage.toLowerCase()}`;

  if (matches(message, ["quota backend unavailable", "quota unavailable", "rate limiter unavailable", "quota indisponible"])) return "service_unavailable";
  if (matches(message, ["rate limit", "rate-limit", "too many requests", "quotas atteints", "429", "resource_exhausted", "application request limit", "user request limit"])) return "rate_limit";
  if (isFacebookAuthorizationLikeMessage(input)) return "facebook_reconnect";
  if (isInstagramAuthorizationLikeMessage(input)) return "instagram_reconnect";
  if (isLinkedInAuthorizationLikeMessage(input)) return "linkedin_reconnect";
  if (isGoogleBusinessAuthorizationLikeMessage(input)) return "google_business_reconnect";
  if (matches(message, ["not implemented", "501", "not available"])) return "not_available";
  if (matches(message, ["failed to fetch", "networkerror", "network request failed", "load failed", "fetch failed", "econnreset", "econnrefused", "enotfound", "socket hang up"])) return "network";
  if (matches(message, ["certificate", "ssl", "unable to verify", "issuer certificate"])) return "ssl";
  if (matches(message, ["invalid login", "invalid credentials", "authentication failed", "login failed", "535 5.7.1", "username and password"])) return "credentials";
  if (matches(message, ["timeout", "timed out", "deadline exceeded", "aborterror", "this operation was aborted"])) return "timeout";
  if (matches(message, ["jwt expired", "session has expired", "auth session missing", "401", "unauthorized", "not authenticated", "session a expir", "session has expired"])) return "session";
  if (matches(message, ["403", "forbidden", "access denied", "not allowed", "non autoris"])) return "forbidden";
  if (matches(message, ["404", "not found", "introuvable"])) return "not_found";
  if (matches(message, ["409", "already exists", "duplicate", "conflit"])) return "conflict";
  if (matches(message, ["400", "422", "unprocessable", "bad request", "missing ", "invalid", "incorrect", "incomplète", "incomplete"])) return "invalid";
  if (matches(message, ["access_denied", "user_denied", "consent denied", "connexion a été annulée", "connexion a ete annulee"])) return "cancelled";
  if (matches(message, ["expired link", "expired access", "accès a expiré", "acces a expire", "jeton expiré", "jeton expire"])) return "expired";
  if (matches(message, ["500", "502", "503", "504", "server error", "internal server error", "service unavailable", "temporairement indisponible", "temporanément indisponible", "momentanément indisponible"])) return "service_unavailable";
  if (matches(message, ["l'action demandée n'a pas pu être finalisée", "l’action demandée n’a pas pu être finalisée", "action requested could not be completed"])) return "action_failed";
  if (looksTechnical(raw) || looksLikeEnglishErrorMessage(raw)) return "generic";
  return null;
}

export async function getSimpleFrenchApiError(res: Response, fallback?: string): Promise<string> {
  return getLocalizedApiError(res, "fr", fallback);
}

export function fallbackForStatus(status?: number, fallback?: string): string {
  if (fallback) return safeFallback(fallback, "fr");
  if (status === 429) return "Quotas atteints, merci de réessayer dans quelques minutes.";
  if (status === 501) return "Cette action n'est pas encore disponible.";
  if (status === 401) return "Votre session a expiré. Merci de vous reconnecter.";
  if (status === 403) return "Vous n'avez pas l'autorisation pour effectuer cette action.";
  if (status === 404) return "L'information demandée est introuvable.";
  if (status && status >= 500) return "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.";
  return "Cette action n'a pas pu aboutir. Merci de réessayer.";
}

function normalizeRawMessage(input: unknown): string {
  return extractMessage(input, new Set(), 0);
}

function sanitizeSentence(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Cette action n'a pas pu aboutir. Merci de réessayer.";
  if (looksTechnical(trimmed)) return "Cette action n'a pas pu aboutir. Merci de réessayer.";
  const cleaned = trimmed
    .replace(/(^erreur\s*:?\s*)/i, "")
    .replace(/(^error\s*:?\s*)/i, "")
    .trim();
  const sentence = cleaned || "Cette action n'a pas pu aboutir. Merci de réessayer.";
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function matches(message: string, needles: string[]) {
  return needles.some((needle) => /^\d{3}$/.test(needle)
    ? new RegExp(`^(?:http(?: status)?[ :_-]*)?${needle}(?:\\b|$)`, "i").test(message)
    : message.includes(needle));
}

function looksTechnical(raw: string) {
  if (/^[a-z\d]+(?:[_.:-][a-z\d]+)+$/i.test(raw)) return true;
  return raw.length > 800 || /(^http\s?\d+$)|(^[\s]*[\[{])|(^[a-z\d]+(?:[_.][a-z\d]+){2,}$)|(<!doctype|<html|<script|stack|trace|sql|sqlstate|postgres|postgrest|pgrst|supabase|graphql|prisma|drizzle|oauth|jwt|token|unexpected token|syntaxerror|typeerror|referenceerror|filereader|api[_ -]?key|authorization|bearer\s|client_secret|client_id|secret\s*[:=]|password\s*[:=]|node:|errno|\beconn|violates|constraint|relation .* does not exist|column .* does not exist|permission denied for table|invalid input syntax|unhandled rejection|\{.*\}|\[object object\]|https?:\/\/[^\s]*[?&](?:sig|signature|key|credential|x-amz-|x-goog-)|\bat \S+.*:\d+:\d+|[A-Z]:\\|\/var\/|\/home\/)/i.test(raw);
}

function safeFallback(fallback: string | undefined, language: AppLanguageCode): string {
  if (!fallback?.trim() || looksTechnical(fallback)) return LOCALIZED_ERROR_COPY[language].generic;
  if (language !== "fr" && looksLikeFrenchMessage(fallback)) {
    const key = (Object.keys(LOCALIZED_ERROR_COPY.fr) as UserFacingErrorKey[]).find(key => LOCALIZED_ERROR_COPY.fr[key] === fallback.trim());
    return key ? LOCALIZED_ERROR_COPY[language][key] : LOCALIZED_ERROR_COPY[language].generic;
  }
  return fallback.trim();
}

function extractMessage(input: unknown, visited: Set<unknown>, depth: number): string {
  if (typeof input === "string") return input.trim();
  if (!input || typeof input !== "object" || depth > 3 || visited.has(input)) return "";
  visited.add(input);
  const record = input as Record<string, unknown>;
  for (const field of ["user_message", "userMessage", "message", "error", "statusText"]) {
    const message = extractMessage(record[field], visited, depth + 1);
    if (message) return message;
  }
  return "";
}

function errorWithResponseStatus(input: unknown, status: number): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? { ...(input as Record<string, unknown>), status }
    : { message: typeof input === "string" ? input : "", status };
}

function looksLikeFrenchMessage(raw: string): boolean {
  return /(?:^|[^\p{L}])(?:votre|vous|veuillez|merci|réessayez|reessayez|réessayer|reessayer|renseignez|connexion|chargement|enregistrement|enregistrer|fichier|compte|données|donnees|crédits|erreur|échec|echec|cet|cette|aucun|paiement|facturation|abonnement|charger|déconnecter|deconnecter|pour|doit|doivent|être|avec|au moins|pas pu|ajoutez|saisissez|sélectionnez|taille|valeur|titre|texte|mot de passe|déjà|en cours|autorisation|impossible|vérifiez|incorrect)(?=$|[^\p{L}])/iu.test(raw);
}

/** Codes/statuses are classification inputs only. They are never UI copy. */
function resolveExplicitErrorCodeKey(input: unknown): UserFacingErrorKey | null {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const code = record.error_code || record.code || record.errorCode || nested.error_code || nested.code || nested.errorCode
    || (typeof input === "string" && /^[a-z][a-z\d_.-]+$/i.test(input.trim()) ? input.trim() : "");
  // Isolate machine context from any reused public copy or provider sentence.
  // HTTP-only field validation and channel reconnect heuristics retain their
  // existing paths when no explicit known code is present.
  return typeof code === "string" && code ? resolveStructuredErrorKey({ code }) : null;
}

function resolveStructuredErrorKey(input: unknown, preserveReadableMessage = true): UserFacingErrorKey | null {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const codeValue = record.error_code || record.code || nested.code || (typeof input === "string" && /^[a-z][a-z\d_.-]+$/i.test(input.trim()) ? input.trim() : "");
  const code = typeof codeValue === "string" ? codeValue.toLowerCase() : "";
  const raw = normalizeRawMessage(input).toLowerCase();
  const signal = `${code} ${raw}`;
  if (/^(?:invalid_client|invalid_client_id|invalid_client_secret|oauth_config_missing|ai_gateway_auth)$/.test(code) || /client authentication failed|invalid[_ ]client(?:[_ ]secret|[_ ]id)?|missing .*(?:api[_ -]?key|client_secret|client_id)|configuration serveur incompl/.test(raw)) return "service_unavailable";
  if (code === "ai_media_result_unavailable" || /média enregistré n[’']est plus disponible|saved media is no longer available/.test(raw)) return "media_missing";
  if (/^(?:file_too_large|payload_too_large|entity_too_large)$/.test(code) || /(?:file|image|video|payload|entity) (?:is )?too large/.test(raw) || Number(record.status) === 413) return "file_too_large";
  if (/^(?:unsupported_media_type|unsupported_file_format|file_format_invalid)$/.test(code) || /unsupported (?:media type|file format|image format)|invalid mime type/.test(raw) || Number(record.status) === 415) return "file_format";
  if (/vid[ée]o (?:est )?obligatoire|video (?:is )?required/.test(raw)) return /vertical.*9:16|9:16.*vertical/.test(raw) ? "vertical_video_required" : "video_required";
  if (/\b(?:ai_media_quota_reached|insufficient_credits|credits_insufficient|credit_balance_insufficient)\b/.test(code) || /(?:not enough|insufficient) credits|cr[ée]dits? (?:disponibles? )?insuffisant|solde (?:de cr[ée]dits? )?insuffisant/.test(raw)) return "credits";
  if (/^(?:ai_quota_reached|quota_reached|plan_limit_reached|monthly_limit_reached)$/.test(code) || /quota (?:mensuel|de votre offre|de la p[ée]riode).*(?:atteint|[ée]puis[ée])/.test(raw)) return "period_limit";
  if (code === "email_not_confirmed" || raw.includes("email not confirmed")) return "email_unconfirmed";
  if (/quota.*unavailable|rate_limiter_unavailable|guard_unavailable|quota_invariant/.test(signal)) return "service_unavailable";
  if (/^(?:rate_limit_burst|booster_generation_burst_limit|ai_gateway_rate_limit|over_request_rate_limit|over_email_send_rate_limit|resource_exhausted|too_many_requests)$/.test(code)) return "rate_limit";
  if (/^(?:invalid_credentials|invalid_login_credentials)$/.test(code)) return "credentials";
  if (/^(?:session_not_found|session_expired|refresh_token_not_found|bad_jwt|not_authenticated|unauthorized|unauthenticated)$/.test(code)) return "session";
  if (/^(?:forbidden|permission_denied|access_forbidden)$/.test(code)) return "forbidden";
  if (/^(?:not_found|resource_not_found)$/.test(code)) return "not_found";
  if (/^(?:bad gateway|internal server error|service unavailable)$/i.test(raw)) return "service_unavailable";
  if (/^(?:gateway timeout|request timeout)$/i.test(raw)) return "timeout";
  if (/^(?:access_denied|user_denied|consent_denied)$/.test(code)) return "cancelled";
  if (/^(?:otp_expired|flow_state_expired|link_expired)$/.test(code)) return "expired";
  if (isFacebookAuthorizationLikeMessage(input)) return "facebook_reconnect";
  if (isInstagramAuthorizationLikeMessage(input)) return "instagram_reconnect";
  if (isLinkedInAuthorizationLikeMessage(input)) return "linkedin_reconnect";
  if (isGoogleBusinessAuthorizationLikeMessage(input)) return "google_business_reconnect";
  const status = Number(record.status);
  // Keep a readable application validation sentence rather than replacing its
  // useful field names/limits with an HTTP summary. Unsafe text stays private.
  if (preserveReadableMessage && raw && looksLikeFrenchMessage(raw) && !looksTechnical(raw) && !looksLikeEnglishErrorMessage(raw)) return null;
  if (status === 401) return "session";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (status === 501) return "not_available";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500 && status <= 599) return "service_unavailable";
  if (status === 400 || status === 422) return "invalid";
  return null;
}
