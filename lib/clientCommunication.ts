export const DEFAULT_CLIENT_LANGUAGE = "fr" as const;

export const CLIENT_LANGUAGE_OPTIONS = [
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Deutsch" },
  { value: "nl", label: "Nederlands" },
  { value: "pt", label: "Português" },
  { value: "th", label: "ไทย" },
  { value: "zh", label: "中文（简体）" },
] as const;

export type ClientLanguageCode = (typeof CLIENT_LANGUAGE_OPTIONS)[number]["value"];
export type ClientDateFormat = "dd/MM/yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd" | "d MMMM yyyy";

export type ClientExchangePreferences = {
  clientLanguage: ClientLanguageCode;
  locale: string;
  timezone: string;
  dateFormat: ClientDateFormat;
  currency: string;
};

const LANGUAGE_VALUES = new Set<string>(CLIENT_LANGUAGE_OPTIONS.map((option) => option.value));

export function normalizeClientLanguage(value: unknown): ClientLanguageCode {
  const raw = String(value || "").trim().toLowerCase();
  if (LANGUAGE_VALUES.has(raw)) return raw as ClientLanguageCode;
  if (["english", "anglais"].includes(raw)) return "en";
  if (["spanish", "espagnol"].includes(raw)) return "es";
  if (["italian", "italien"].includes(raw)) return "it";
  if (["german", "allemand"].includes(raw)) return "de";
  if (["dutch", "neerlandais", "néerlandais"].includes(raw)) return "nl";
  if (["portuguese", "portugais"].includes(raw)) return "pt";
  if (["thai", "thailandais", "thaïlandais", "ภาษาไทย", "th-th"].includes(raw)) return "th";
  if (["chinese", "simplified chinese", "chinois", "chinois simplifié", "中文", "简体中文", "zh-cn", "zh_cn", "zh-hans"].includes(raw)) return "zh";
  return DEFAULT_CLIENT_LANGUAGE;
}

export function getClientLocale(language: unknown) {
  const lang = normalizeClientLanguage(language);
  if (lang === "en") return "en-GB";
  if (lang === "es") return "es-ES";
  if (lang === "it") return "it-IT";
  if (lang === "de") return "de-DE";
  if (lang === "nl") return "nl-NL";
  if (lang === "pt") return "pt-PT";
  if (lang === "th") return "th-TH";
  if (lang === "zh") return "zh-CN";
  return "fr-FR";
}

export function normalizeClientTimezone(value: unknown) {
  const raw = String(value || "").trim() || "Europe/Paris";
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return "Europe/Paris";
  }
}

export function normalizeClientDateFormat(value: unknown): ClientDateFormat {
  const raw = String(value || "").trim();
  if (raw === "MM/dd/yyyy") return "MM/dd/yyyy";
  if (raw === "yyyy-MM-dd") return "yyyy-MM-dd";
  if (raw === "d MMMM yyyy") return "d MMMM yyyy";
  return "dd/MM/yyyy";
}

export function buildClientExchangePreferences(row: unknown): ClientExchangePreferences {
  const data = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
  const clientLanguage = normalizeClientLanguage(data.client_language);
  return {
    clientLanguage,
    locale: getClientLocale(clientLanguage),
    timezone: normalizeClientTimezone(data.timezone),
    dateFormat: normalizeClientDateFormat(data.date_format),
    currency: String(data.currency || "EUR").trim().toUpperCase() || "EUR",
  };
}

export const DEFAULT_CLIENT_EXCHANGE_PREFERENCES = buildClientExchangePreferences(null);

function getDateParts(date: Date, prefs: ClientExchangePreferences) {
  const parts = new Intl.DateTimeFormat(prefs.locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: prefs.timezone,
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return { day: part("day"), month: part("month"), year: part("year") };
}

export function formatClientDateOnly(iso: string | null | undefined, prefs: ClientExchangePreferences) {
  const date = new Date(String(iso || ""));
  if (!Number.isFinite(date.getTime())) return "-";

  if (prefs.dateFormat === "yyyy-MM-dd") {
    const { day, month, year } = getDateParts(date, prefs);
    return `${year}-${month}-${day}`;
  }

  if (prefs.dateFormat === "MM/dd/yyyy") {
    const { day, month, year } = getDateParts(date, prefs);
    return `${month}/${day}/${year}`;
  }

  if (prefs.dateFormat === "d MMMM yyyy") {
    return new Intl.DateTimeFormat(prefs.locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: prefs.timezone,
    }).format(date);
  }

  const { day, month, year } = getDateParts(date, prefs);
  return `${day}/${month}/${year}`;
}

export function formatClientTimeOnly(iso: string | null | undefined, prefs: ClientExchangePreferences) {
  const date = new Date(String(iso || ""));
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(prefs.locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: prefs.timezone,
      }).format(date)
    : "-";
}

export function formatClientDateTime(iso: string | null | undefined, prefs: ClientExchangePreferences) {
  const dateLabel = formatClientDateOnly(iso, prefs);
  const timeLabel = formatClientTimeOnly(iso, prefs);
  if (dateLabel === "-" && timeLabel === "-") return String(iso || "-");
  if (timeLabel === "-") return dateLabel;
  return `${dateLabel} ${timeLabel}`;
}

export type CalendarClientTexts = {
  htmlLang: string;
  generic: {
    greeting: (name?: string) => string;
    professional: string;
    client: string;
    appointment: string;
    automaticMail: string;
  };
  labels: {
    date: string;
    time: string;
    reason: string;
    location: string;
    professional: string;
    phone: string;
    usefulInfo: string;
    requestedDate: string;
    requestedTime: string;
    yourMessage: string;
    email: string;
    appointmentReason: string;
    address: string;
    provider: string;
  };
  confirmation: {
    subjectCreated: (eventTitle: string) => string;
    subjectUpdated: (eventTitle: string) => string;
    titleCreated: string;
    titleUpdated: string;
    statusCreated: string;
    statusUpdated: string;
    introCreated: (companyName: string) => string;
    introUpdated: (companyName: string) => string;
    detailsTitle: string;
  };
  rejection: {
    subject: (companyName: string) => string;
    title: string;
    status: string;
    detailsTitle: string;
    intro: (companyName: string) => string;
    action: string;
    textTitle: string;
  };
  reminder: {
    offsetLabel: (minutes: number) => string;
    subject: (offsetLabel: string, eventTitle: string) => string;
    badgePrefix: string;
    title: string;
    intro: (dateTime: string, companyName: string) => string;
    sectionTitle: string;
    secondaryTitle: string;
    defaultUsefulInfo: string;
    contactPro: (proName: string) => string;
    openAddress: string;
    footer: string;
  };
};

function defaultOffsetLabel(minutes: number, unitBefore: string, hourSuffix = "h", minuteSuffix = "min") {
  if (minutes === 2880) return `48${hourSuffix} ${unitBefore}`;
  if (minutes === 1440) return `24${hourSuffix} ${unitBefore}`;
  if (minutes === 120) return `2${hourSuffix} ${unitBefore}`;
  if (minutes % 60 === 0) return `${minutes / 60}${hourSuffix} ${unitBefore}`;
  return `${minutes} ${minuteSuffix} ${unitBefore}`;
}

const CALENDAR_TEXTS: Record<ClientLanguageCode, CalendarClientTexts> = {
  fr: {
    htmlLang: "fr",
    generic: {
      greeting: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
      professional: "Votre professionnel",
      client: "Client",
      appointment: "Rendez-vous",
      automaticMail: "Mail automatique envoyé par iNr’Calendar.",
    },
    labels: {
      date: "Date",
      time: "Horaire",
      reason: "Motif",
      location: "Lieu",
      professional: "Interlocuteur",
      phone: "Téléphone",
      usefulInfo: "Informations utiles",
      requestedDate: "Date demandée",
      requestedTime: "Horaire demandé",
      yourMessage: "Votre message",
      email: "Email",
      appointmentReason: "Motif du rendez-vous",
      address: "Adresse",
      provider: "Intervenant",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `Confirmation de votre rendez-vous - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `Mise à jour de votre rendez-vous - ${eventTitle}`,
      titleCreated: "Votre rendez-vous est confirmé",
      titleUpdated: "Votre rendez-vous a été mis à jour",
      statusCreated: "RDV CONFIRMÉ",
      statusUpdated: "RDV MIS À JOUR",
      introCreated: (companyName) => `Votre rendez-vous avec ${companyName} est bien enregistré.`,
      introUpdated: (companyName) => `Votre rendez-vous avec ${companyName} a été modifié.`,
      detailsTitle: "Détails du rendez-vous",
    },
    rejection: {
      subject: (companyName) => `Votre demande de rendez-vous n'a pas pu être confirmée - ${companyName}`,
      title: "Votre demande n’a pas pu être confirmée",
      status: "DEMANDE NON CONFIRMÉE",
      detailsTitle: "Détails de la demande",
      intro: (companyName) => `Votre demande de rendez-vous avec ${companyName} n'a pas pu être confirmée sur ce créneau.`,
      action: "Vous pouvez choisir un autre créneau depuis l’iNr’Badge ou contacter directement le professionnel.",
      textTitle: "Votre demande n'a pas pu être confirmée",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "avant"),
      subject: (offsetLabel, eventTitle) => `Rappel de votre rendez-vous ${offsetLabel} - ${eventTitle}`,
      badgePrefix: "RAPPEL",
      title: "Votre rendez-vous approche",
      intro: (dateTime, companyName) => `Nous vous confirmons votre rendez-vous prévu le ${dateTime} avec ${companyName}.`,
      sectionTitle: "Votre confirmation",
      secondaryTitle: "Bon à savoir",
      defaultUsefulInfo: "Merci de prévoir quelques minutes d’avance si nécessaire. En cas d’imprévu, contactez directement votre interlocuteur.",
      contactPro: (proName) => `Contacter ${proName}`,
      openAddress: "Ouvrir l’adresse",
      footer: "Ce rappel vous est envoyé automatiquement par iNr'Calendar, un service iNrCy.",
    },
  },
  en: {
    htmlLang: "en",
    generic: {
      greeting: (name) => (name ? `Hello ${name},` : "Hello,"),
      professional: "Your professional",
      client: "Client",
      appointment: "Appointment",
      automaticMail: "Automatic email sent by iNr’Calendar.",
    },
    labels: {
      date: "Date",
      time: "Time",
      reason: "Reason",
      location: "Location",
      professional: "Contact person",
      phone: "Phone",
      usefulInfo: "Useful information",
      requestedDate: "Requested date",
      requestedTime: "Requested time",
      yourMessage: "Your message",
      email: "Email",
      appointmentReason: "Appointment reason",
      address: "Address",
      provider: "Provider",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `Appointment confirmation - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `Your appointment has been updated - ${eventTitle}`,
      titleCreated: "Your appointment is confirmed",
      titleUpdated: "Your appointment has been updated",
      statusCreated: "APPOINTMENT CONFIRMED",
      statusUpdated: "APPOINTMENT UPDATED",
      introCreated: (companyName) => `Your appointment with ${companyName} has been scheduled.`,
      introUpdated: (companyName) => `Your appointment with ${companyName} has been updated.`,
      detailsTitle: "Appointment details",
    },
    rejection: {
      subject: (companyName) => `Your appointment request could not be confirmed - ${companyName}`,
      title: "Your request could not be confirmed",
      status: "REQUEST NOT CONFIRMED",
      detailsTitle: "Request details",
      intro: (companyName) => `Your appointment request with ${companyName} could not be confirmed for this time slot.`,
      action: "You can choose another time slot from the iNr’Badge or contact the professional directly.",
      textTitle: "Your request could not be confirmed",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "before"),
      subject: (offsetLabel, eventTitle) => `Appointment reminder ${offsetLabel} - ${eventTitle}`,
      badgePrefix: "REMINDER",
      title: "Your appointment is coming up",
      intro: (dateTime, companyName) => `Your appointment is scheduled for ${dateTime} with ${companyName}.`,
      sectionTitle: "Your confirmation",
      secondaryTitle: "Good to know",
      defaultUsefulInfo: "Please plan to arrive a few minutes early if needed. If something comes up, contact your professional directly.",
      contactPro: (proName) => `Contact ${proName}`,
      openAddress: "Open address",
      footer: "This reminder is sent automatically by iNr'Calendar, an iNrCy service.",
    },
  },
  es: {
    htmlLang: "es",
    generic: {
      greeting: (name) => (name ? `Hola ${name},` : "Hola,"),
      professional: "Su profesional",
      client: "Cliente",
      appointment: "Cita",
      automaticMail: "Email automático enviado por iNr’Calendar.",
    },
    labels: {
      date: "Fecha",
      time: "Hora",
      reason: "Motivo",
      location: "Lugar",
      professional: "Interlocutor",
      phone: "Teléfono",
      usefulInfo: "Información útil",
      requestedDate: "Fecha solicitada",
      requestedTime: "Hora solicitada",
      yourMessage: "Su mensaje",
      email: "Email",
      appointmentReason: "Motivo de la cita",
      address: "Dirección",
      provider: "Profesional",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `Confirmación de su cita - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `Actualización de su cita - ${eventTitle}`,
      titleCreated: "Su cita está confirmada",
      titleUpdated: "Su cita ha sido actualizada",
      statusCreated: "CITA CONFIRMADA",
      statusUpdated: "CITA ACTUALIZADA",
      introCreated: (companyName) => `Su cita con ${companyName} ha sido registrada.`,
      introUpdated: (companyName) => `Su cita con ${companyName} ha sido modificada.`,
      detailsTitle: "Detalles de la cita",
    },
    rejection: {
      subject: (companyName) => `No se ha podido confirmar su solicitud de cita - ${companyName}`,
      title: "No se ha podido confirmar su solicitud",
      status: "SOLICITUD NO CONFIRMADA",
      detailsTitle: "Detalles de la solicitud",
      intro: (companyName) => `Su solicitud de cita con ${companyName} no ha podido confirmarse en este horario.`,
      action: "Puede elegir otro horario desde el iNr’Badge o contactar directamente con el profesional.",
      textTitle: "No se ha podido confirmar su solicitud",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "antes"),
      subject: (offsetLabel, eventTitle) => `Recordatorio de su cita ${offsetLabel} - ${eventTitle}`,
      badgePrefix: "RECORDATORIO",
      title: "Su cita se acerca",
      intro: (dateTime, companyName) => `Le confirmamos su cita prevista el ${dateTime} con ${companyName}.`,
      sectionTitle: "Su confirmación",
      secondaryTitle: "Información útil",
      defaultUsefulInfo: "Le recomendamos prever unos minutos de antelación si es necesario. En caso de imprevisto, contacte directamente con su interlocutor.",
      contactPro: (proName) => `Contactar con ${proName}`,
      openAddress: "Abrir dirección",
      footer: "Este recordatorio se envía automáticamente por iNr'Calendar, un servicio de iNrCy.",
    },
  },
  it: {
    htmlLang: "it",
    generic: {
      greeting: (name) => (name ? `Buongiorno ${name},` : "Buongiorno,"),
      professional: "Il suo professionista",
      client: "Cliente",
      appointment: "Appuntamento",
      automaticMail: "Email automatica inviata da iNr’Calendar.",
    },
    labels: {
      date: "Data",
      time: "Orario",
      reason: "Motivo",
      location: "Luogo",
      professional: "Referente",
      phone: "Telefono",
      usefulInfo: "Informazioni utili",
      requestedDate: "Data richiesta",
      requestedTime: "Orario richiesto",
      yourMessage: "Il suo messaggio",
      email: "Email",
      appointmentReason: "Motivo dell'appuntamento",
      address: "Indirizzo",
      provider: "Professionista",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `Conferma del suo appuntamento - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `Aggiornamento del suo appuntamento - ${eventTitle}`,
      titleCreated: "Il suo appuntamento è confermato",
      titleUpdated: "Il suo appuntamento è stato aggiornato",
      statusCreated: "APPUNTAMENTO CONFERMATO",
      statusUpdated: "APPUNTAMENTO AGGIORNATO",
      introCreated: (companyName) => `Il suo appuntamento con ${companyName} è stato registrato.`,
      introUpdated: (companyName) => `Il suo appuntamento con ${companyName} è stato modificato.`,
      detailsTitle: "Dettagli dell'appuntamento",
    },
    rejection: {
      subject: (companyName) => `La sua richiesta di appuntamento non ha potuto essere confermata - ${companyName}`,
      title: "La sua richiesta non ha potuto essere confermata",
      status: "RICHIESTA NON CONFERMATA",
      detailsTitle: "Dettagli della richiesta",
      intro: (companyName) => `La sua richiesta di appuntamento con ${companyName} non ha potuto essere confermata per questo orario.`,
      action: "Può scegliere un altro orario dall’iNr’Badge o contattare direttamente il professionista.",
      textTitle: "La sua richiesta non ha potuto essere confermata",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "prima"),
      subject: (offsetLabel, eventTitle) => `Promemoria del suo appuntamento ${offsetLabel} - ${eventTitle}`,
      badgePrefix: "PROMEMORIA",
      title: "Il suo appuntamento si avvicina",
      intro: (dateTime, companyName) => `Le confermiamo il suo appuntamento previsto il ${dateTime} con ${companyName}.`,
      sectionTitle: "La sua conferma",
      secondaryTitle: "Da sapere",
      defaultUsefulInfo: "La invitiamo a prevedere qualche minuto di anticipo se necessario. In caso di imprevisto, contatti direttamente il suo referente.",
      contactPro: (proName) => `Contattare ${proName}`,
      openAddress: "Aprire l’indirizzo",
      footer: "Questo promemoria è inviato automaticamente da iNr'Calendar, un servizio iNrCy.",
    },
  },
  de: {
    htmlLang: "de",
    generic: {
      greeting: (name) => (name ? `Guten Tag ${name},` : "Guten Tag,"),
      professional: "Ihr Dienstleister",
      client: "Kunde",
      appointment: "Termin",
      automaticMail: "Automatische E-Mail von iNr’Calendar.",
    },
    labels: {
      date: "Datum",
      time: "Uhrzeit",
      reason: "Anlass",
      location: "Ort",
      professional: "Ansprechpartner",
      phone: "Telefon",
      usefulInfo: "Nützliche Informationen",
      requestedDate: "Gewünschtes Datum",
      requestedTime: "Gewünschte Uhrzeit",
      yourMessage: "Ihre Nachricht",
      email: "E-Mail",
      appointmentReason: "Termin Anlass",
      address: "Adresse",
      provider: "Dienstleister",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `Bestätigung Ihres Termins - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `Aktualisierung Ihres Termins - ${eventTitle}`,
      titleCreated: "Ihr Termin ist bestätigt",
      titleUpdated: "Ihr Termin wurde aktualisiert",
      statusCreated: "TERMIN BESTÄTIGT",
      statusUpdated: "TERMIN AKTUALISIERT",
      introCreated: (companyName) => `Ihr Termin mit ${companyName} wurde eingetragen.`,
      introUpdated: (companyName) => `Ihr Termin mit ${companyName} wurde geändert.`,
      detailsTitle: "Termindetails",
    },
    rejection: {
      subject: (companyName) => `Ihre Terminanfrage konnte nicht bestätigt werden - ${companyName}`,
      title: "Ihre Anfrage konnte nicht bestätigt werden",
      status: "ANFRAGE NICHT BESTÄTIGT",
      detailsTitle: "Details der Anfrage",
      intro: (companyName) => `Ihre Terminanfrage mit ${companyName} konnte für dieses Zeitfenster nicht bestätigt werden.`,
      action: "Sie können über das iNr’Badge ein anderes Zeitfenster auswählen oder den Dienstleister direkt kontaktieren.",
      textTitle: "Ihre Anfrage konnte nicht bestätigt werden",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "vorher"),
      subject: (offsetLabel, eventTitle) => `Erinnerung an Ihren Termin ${offsetLabel} - ${eventTitle}`,
      badgePrefix: "ERINNERUNG",
      title: "Ihr Termin steht bevor",
      intro: (dateTime, companyName) => `Wir bestätigen Ihren Termin am ${dateTime} mit ${companyName}.`,
      sectionTitle: "Ihre Bestätigung",
      secondaryTitle: "Gut zu wissen",
      defaultUsefulInfo: "Bitte planen Sie bei Bedarf ein paar Minuten im Voraus ein. Bei Änderungen kontaktieren Sie bitte direkt Ihren Ansprechpartner.",
      contactPro: (proName) => `${proName} kontaktieren`,
      openAddress: "Adresse öffnen",
      footer: "Diese Erinnerung wird automatisch von iNr'Calendar, einem iNrCy-Service, gesendet.",
    },
  },
  nl: {
    htmlLang: "nl",
    generic: {
      greeting: (name) => (name ? `Hallo ${name},` : "Hallo,"),
      professional: "Uw professional",
      client: "Klant",
      appointment: "Afspraak",
      automaticMail: "Automatische e-mail verzonden door iNr’Calendar.",
    },
    labels: {
      date: "Datum",
      time: "Tijd",
      reason: "Reden",
      location: "Locatie",
      professional: "Contactpersoon",
      phone: "Telefoon",
      usefulInfo: "Nuttige informatie",
      requestedDate: "Gevraagde datum",
      requestedTime: "Gevraagde tijd",
      yourMessage: "Uw bericht",
      email: "E-mail",
      appointmentReason: "Reden van de afspraak",
      address: "Adres",
      provider: "Professional",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `Bevestiging van uw afspraak - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `Update van uw afspraak - ${eventTitle}`,
      titleCreated: "Uw afspraak is bevestigd",
      titleUpdated: "Uw afspraak is bijgewerkt",
      statusCreated: "AFSPRAAK BEVESTIGD",
      statusUpdated: "AFSPRAAK BIJGEWERKT",
      introCreated: (companyName) => `Uw afspraak met ${companyName} is geregistreerd.`,
      introUpdated: (companyName) => `Uw afspraak met ${companyName} is gewijzigd.`,
      detailsTitle: "Afspraakdetails",
    },
    rejection: {
      subject: (companyName) => `Uw afspraakverzoek kon niet worden bevestigd - ${companyName}`,
      title: "Uw verzoek kon niet worden bevestigd",
      status: "VERZOEK NIET BEVESTIGD",
      detailsTitle: "Verzoekdetails",
      intro: (companyName) => `Uw afspraakverzoek met ${companyName} kon niet worden bevestigd voor dit tijdslot.`,
      action: "U kunt via de iNr’Badge een ander tijdslot kiezen of rechtstreeks contact opnemen met de professional.",
      textTitle: "Uw verzoek kon niet worden bevestigd",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "van tevoren"),
      subject: (offsetLabel, eventTitle) => `Herinnering aan uw afspraak ${offsetLabel} - ${eventTitle}`,
      badgePrefix: "HERINNERING",
      title: "Uw afspraak komt eraan",
      intro: (dateTime, companyName) => `Wij bevestigen uw afspraak op ${dateTime} met ${companyName}.`,
      sectionTitle: "Uw bevestiging",
      secondaryTitle: "Goed om te weten",
      defaultUsefulInfo: "Plan indien nodig een paar minuten extra. Neem bij verhindering rechtstreeks contact op met uw contactpersoon.",
      contactPro: (proName) => `Contact opnemen met ${proName}`,
      openAddress: "Adres openen",
      footer: "Deze herinnering wordt automatisch verzonden door iNr'Calendar, een iNrCy-service.",
    },
  },
  pt: {
    htmlLang: "pt",
    generic: {
      greeting: (name) => (name ? `Olá ${name},` : "Olá,"),
      professional: "O seu profissional",
      client: "Cliente",
      appointment: "Marcação",
      automaticMail: "Email automático enviado por iNr’Calendar.",
    },
    labels: {
      date: "Data",
      time: "Hora",
      reason: "Motivo",
      location: "Local",
      professional: "Contacto",
      phone: "Telefone",
      usefulInfo: "Informações úteis",
      requestedDate: "Data solicitada",
      requestedTime: "Hora solicitada",
      yourMessage: "A sua mensagem",
      email: "Email",
      appointmentReason: "Motivo da marcação",
      address: "Morada",
      provider: "Profissional",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `Confirmação da sua marcação - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `Atualização da sua marcação - ${eventTitle}`,
      titleCreated: "A sua marcação está confirmada",
      titleUpdated: "A sua marcação foi atualizada",
      statusCreated: "MARCAÇÃO CONFIRMADA",
      statusUpdated: "MARCAÇÃO ATUALIZADA",
      introCreated: (companyName) => `A sua marcação com ${companyName} foi registada.`,
      introUpdated: (companyName) => `A sua marcação com ${companyName} foi alterada.`,
      detailsTitle: "Detalhes da marcação",
    },
    rejection: {
      subject: (companyName) => `O seu pedido de marcação não pôde ser confirmado - ${companyName}`,
      title: "O seu pedido não pôde ser confirmado",
      status: "PEDIDO NÃO CONFIRMADO",
      detailsTitle: "Detalhes do pedido",
      intro: (companyName) => `O seu pedido de marcação com ${companyName} não pôde ser confirmado neste horário.`,
      action: "Pode escolher outro horário no iNr’Badge ou contactar diretamente o profissional.",
      textTitle: "O seu pedido não pôde ser confirmado",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "antes"),
      subject: (offsetLabel, eventTitle) => `Lembrete da sua marcação ${offsetLabel} - ${eventTitle}`,
      badgePrefix: "LEMBRETE",
      title: "A sua marcação aproxima-se",
      intro: (dateTime, companyName) => `Confirmamos a sua marcação prevista para ${dateTime} com ${companyName}.`,
      sectionTitle: "A sua confirmação",
      secondaryTitle: "A saber",
      defaultUsefulInfo: "Recomendamos chegar alguns minutos antes, se necessário. Em caso de imprevisto, contacte diretamente o seu interlocutor.",
      contactPro: (proName) => `Contactar ${proName}`,
      openAddress: "Abrir morada",
      footer: "Este lembrete é enviado automaticamente por iNr'Calendar, um serviço iNrCy.",
    },
  },
  th: {
    htmlLang: "th",
    generic: {
      greeting: (name) => (name ? `สวัสดี ${name},` : "สวัสดี,"),
      professional: "ผู้ให้บริการของคุณ",
      client: "ลูกค้า",
      appointment: "การนัดหมาย",
      automaticMail: "อีเมลอัตโนมัติที่ส่งโดย iNr’Calendar",
    },
    labels: {
      date: "วันที่",
      time: "เวลา",
      reason: "เหตุผล",
      location: "สถานที่",
      professional: "ผู้ติดต่อ",
      phone: "โทรศัพท์",
      usefulInfo: "ข้อมูลที่เป็นประโยชน์",
      requestedDate: "วันที่ที่ขอ",
      requestedTime: "เวลาที่ขอ",
      yourMessage: "ข้อความของคุณ",
      email: "อีเมล",
      appointmentReason: "เหตุผลในการนัดหมาย",
      address: "ที่อยู่",
      provider: "ผู้ให้บริการ",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `ยืนยันการนัดหมายของคุณ - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `อัปเดตการนัดหมายของคุณ - ${eventTitle}`,
      titleCreated: "ยืนยันการนัดหมายของคุณแล้ว",
      titleUpdated: "อัปเดตการนัดหมายของคุณแล้ว",
      statusCreated: "ยืนยันการนัดหมายแล้ว",
      statusUpdated: "อัปเดตการนัดหมายแล้ว",
      introCreated: (companyName) => `บันทึกการนัดหมายของคุณกับ ${companyName} แล้ว`,
      introUpdated: (companyName) => `แก้ไขการนัดหมายของคุณกับ ${companyName} แล้ว`,
      detailsTitle: "รายละเอียดการนัดหมาย",
    },
    rejection: {
      subject: (companyName) => `ไม่สามารถยืนยันคำขอนัดหมายของคุณได้ - ${companyName}`,
      title: "ไม่สามารถยืนยันคำขอของคุณได้",
      status: "ยังไม่ยืนยันคำขอ",
      detailsTitle: "รายละเอียดคำขอ",
      intro: (companyName) => `ไม่สามารถยืนยันคำขอนัดหมายกับ ${companyName} ในช่วงเวลานี้ได้`,
      action: "คุณสามารถเลือกช่วงเวลาอื่นผ่าน iNr’Badge หรือติดต่อผู้ให้บริการโดยตรง",
      textTitle: "ไม่สามารถยืนยันคำขอของคุณได้",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "ล่วงหน้า"),
      subject: (offsetLabel, eventTitle) => `เตือนการนัดหมาย ${offsetLabel} - ${eventTitle}`,
      badgePrefix: "การแจ้งเตือน",
      title: "การนัดหมายของคุณใกล้เข้ามาแล้ว",
      intro: (dateTime, companyName) => `ขอยืนยันการนัดหมายของคุณในวันที่ ${dateTime} กับ ${companyName}`,
      sectionTitle: "การยืนยันของคุณ",
      secondaryTitle: "ข้อมูลที่ควรรู้",
      defaultUsefulInfo: "โปรดเผื่อเวลาเพิ่มอีกเล็กน้อยหากจำเป็น หากไม่สามารถมาตามนัดได้ โปรดติดต่อผู้ให้บริการโดยตรง",
      contactPro: (proName) => `ติดต่อ ${proName}`,
      openAddress: "เปิดที่อยู่",
      footer: "การแจ้งเตือนนี้ส่งโดยอัตโนมัติจาก iNr'Calendar ซึ่งเป็นบริการของ iNrCy",
    },
  },
  zh: {
    htmlLang: "zh-CN",
    generic: {
      greeting: (name) => (name ? `${name}，您好：` : "您好："),
      professional: "您的服务商",
      client: "客户",
      appointment: "预约",
      automaticMail: "此邮件由 iNr’Calendar 自动发送。",
    },
    labels: {
      date: "日期",
      time: "时间",
      reason: "事由",
      location: "地点",
      professional: "联系人",
      phone: "电话",
      usefulInfo: "实用信息",
      requestedDate: "申请日期",
      requestedTime: "申请时间",
      yourMessage: "您的留言",
      email: "电子邮件",
      appointmentReason: "预约事由",
      address: "地址",
      provider: "服务人员",
    },
    confirmation: {
      subjectCreated: (eventTitle) => `您的预约已确认 - ${eventTitle}`,
      subjectUpdated: (eventTitle) => `您的预约已更新 - ${eventTitle}`,
      titleCreated: "您的预约已确认",
      titleUpdated: "您的预约已更新",
      statusCreated: "预约已确认",
      statusUpdated: "预约已更新",
      introCreated: (companyName) => `您与 ${companyName} 的预约已登记。`,
      introUpdated: (companyName) => `您与 ${companyName} 的预约已修改。`,
      detailsTitle: "预约详情",
    },
    rejection: {
      subject: (companyName) => `无法确认您的预约申请 - ${companyName}`,
      title: "无法确认您的申请",
      status: "申请未确认",
      detailsTitle: "申请详情",
      intro: (companyName) => `无法确认您与 ${companyName} 在该时段的预约申请。`,
      action: "您可以通过 iNr’Badge 选择其他时段，或直接联系服务商。",
      textTitle: "无法确认您的申请",
    },
    reminder: {
      offsetLabel: (minutes) => defaultOffsetLabel(minutes, "前"),
      subject: (offsetLabel, eventTitle) => `预约提醒（${offsetLabel}）- ${eventTitle}`,
      badgePrefix: "提醒",
      title: "您的预约即将开始",
      intro: (dateTime, companyName) => `确认您将于 ${dateTime} 与 ${companyName} 进行预约。`,
      sectionTitle: "预约确认",
      secondaryTitle: "温馨提示",
      defaultUsefulInfo: "如有需要，请预留几分钟时间。如无法按时赴约，请直接联系您的服务商。",
      contactPro: (proName) => `联系 ${proName}`,
      openAddress: "打开地址",
      footer: "此提醒由 iNrCy 服务 iNr'Calendar 自动发送。",
    },
  },
};


export function formatClientCurrency(value: number, prefs: ClientExchangePreferences) {
  const amount = Number(value) || 0;
  const currency = String(prefs.currency || "EUR").trim().toUpperCase() || "EUR";
  try {
    return amount.toLocaleString(prefs.locale, { style: "currency", currency });
  } catch {
    return amount.toLocaleString(prefs.locale, { style: "currency", currency: "EUR" });
  }
}

export type DocumentKindForClient = "facture" | "devis" | "deposit" | "credit_note";

export type DocumentClientTexts = {
  titles: {
    invoice: string;
    depositInvoice: string;
    creditNote: string;
    quote: string;
  };
  labels: {
    date: string;
    dueDate: string;
    serviceDelivery: string;
    period: string;
    provider: string;
    client: string;
    phone: string;
    email: string;
    siren: string;
    vat: string;
    deliveryAddress: string;
    designation: string;
    quantity: string;
    unitPriceHT: string;
    totalHT: string;
    totalVAT: string;
    totalTTC: string;
    discount: string;
    totalDue: string;
    payment: string;
    category: string;
    serviceDateDelivery: string;
    servicePeriod: string;
    purchaseOrderReference: string;
    deposit: string;
    depositRequested: string;
    vatOnDebits: string;
    lateFees: string;
    recoveryFee40: string;
    vatNotApplicable: string;
    status: string;
    continuation: string;
    goodForAgreement: string;
    signature: string;
    pricesInCurrency: (currency: string) => string;
    quoteValidity: (days: number) => string;
  };
  paymentMethods: Record<string, string>;
  operationCategories: Record<string, string>;
  mail: {
    subjectInvoice: (ref: string) => string;
    subjectQuote: (ref: string) => string;
    bodyInvoice: (name: string, ref: string) => string;
    bodyQuote: (name: string, ref: string) => string;
  };
};

const DOCUMENT_TEXTS: Record<ClientLanguageCode, DocumentClientTexts> = {
  fr: {
    titles: { invoice: "FACTURE", depositInvoice: "FACTURE D’ACOMPTE", creditNote: "AVOIR", quote: "DEVIS" },
    labels: {
      date: "Date",
      dueDate: "Échéance",
      serviceDelivery: "Prestation / livraison",
      period: "Période",
      provider: "Prestataire",
      client: "Client",
      phone: "Tél",
      email: "Email",
      siren: "SIREN",
      vat: "TVA",
      deliveryAddress: "Adresse de livraison",
      designation: "Désignation",
      quantity: "Qté",
      unitPriceHT: "PU HT",
      totalHT: "Total HT",
      totalVAT: "TVA",
      totalTTC: "Total TTC",
      discount: "Remise",
      totalDue: "Total à payer",
      payment: "Paiement",
      category: "Catégorie",
      serviceDateDelivery: "Date de prestation / livraison",
      servicePeriod: "Période de prestation",
      purchaseOrderReference: "Référence commande / PO",
      deposit: "Acompte",
      depositRequested: "Acompte demandé",
      vatOnDebits: "TVA sur les débits",
      lateFees: "Pénalités de retard",
      recoveryFee40: "Indemnité forfaitaire de 40 € pour frais de recouvrement en cas de retard de paiement.",
      vatNotApplicable: "TVA non applicable",
      status: "Statut",
      continuation: "Suite des prestations",
      goodForAgreement: "Bon pour accord",
      signature: "Signature",
      pricesInCurrency: (currency) => `Les prix sont exprimés en ${currency}.`,
      quoteValidity: (days) => `Le devis est valable ${days} jours.`,
    },
    paymentMethods: { virement: "Virement bancaire", cb: "Carte bancaire", cheque: "Chèque", especes: "Espèces", abonnement: "Abonnement" },
    operationCategories: { vente: "Vente", prestation: "Prestation de services", mixte: "Vente + prestation" },
    mail: {
      subjectInvoice: (ref) => `Envoi de votre facture${ref ? ` ${ref}` : ""}`,
      subjectQuote: (ref) => `Envoi de votre devis${ref ? ` ${ref}` : ""}`,
      bodyInvoice: (name, ref) => [`Bonjour${name ? ` ${name}` : ""},`, "", `Veuillez trouver ci-joint votre facture${ref ? ` ${ref}` : ""}.`, "", "Je reste à votre disposition si besoin."].join("\n"),
      bodyQuote: (name, ref) => [`Bonjour${name ? ` ${name}` : ""},`, "", `Veuillez trouver ci-joint votre devis${ref ? ` ${ref}` : ""}.`, "", "Je reste disponible pour toute question ou modification."].join("\n"),
    },
  },
  en: {
    titles: { invoice: "INVOICE", depositInvoice: "DEPOSIT INVOICE", creditNote: "CREDIT NOTE", quote: "QUOTE" },
    labels: {
      date: "Date", dueDate: "Due date", serviceDelivery: "Service / delivery", period: "Period", provider: "Provider", client: "Client", phone: "Phone", email: "Email", siren: "SIREN", vat: "VAT", deliveryAddress: "Delivery address", designation: "Description", quantity: "Qty", unitPriceHT: "Unit price excl. tax", totalHT: "Total excl. tax", totalVAT: "VAT", totalTTC: "Total incl. tax", discount: "Discount", totalDue: "Amount due", payment: "Payment", category: "Category", serviceDateDelivery: "Service / delivery date", servicePeriod: "Service period", purchaseOrderReference: "Purchase order / PO reference", deposit: "Deposit", depositRequested: "Requested deposit", vatOnDebits: "VAT on debits", lateFees: "Late payment penalties", recoveryFee40: "Fixed recovery fee of €40 in case of late payment.", vatNotApplicable: "VAT not applicable", status: "Status", continuation: "Continuation of services", goodForAgreement: "Approved", signature: "Signature", pricesInCurrency: (currency) => `Prices are stated in ${currency}.`, quoteValidity: (days) => `This quote is valid for ${days} days.`,
    },
    paymentMethods: { virement: "Bank transfer", cb: "Card payment", cheque: "Cheque", especes: "Cash", abonnement: "Subscription" },
    operationCategories: { vente: "Sale", prestation: "Services", mixte: "Sale + services" },
    mail: { subjectInvoice: (ref) => `Your invoice${ref ? ` ${ref}` : ""}`, subjectQuote: (ref) => `Your quote${ref ? ` ${ref}` : ""}`, bodyInvoice: (name, ref) => [`Hello${name ? ` ${name}` : ""},`, "", `Please find attached your invoice${ref ? ` ${ref}` : ""}.`, "", "I remain available if needed."].join("\n"), bodyQuote: (name, ref) => [`Hello${name ? ` ${name}` : ""},`, "", `Please find attached your quote${ref ? ` ${ref}` : ""}.`, "", "I remain available for any questions or changes."].join("\n") },
  },
  es: {
    titles: { invoice: "FACTURA", depositInvoice: "FACTURA DE ANTICIPO", creditNote: "NOTA DE ABONO", quote: "PRESUPUESTO" },
    labels: {
      date: "Fecha", dueDate: "Vencimiento", serviceDelivery: "Servicio / entrega", period: "Periodo", provider: "Proveedor", client: "Cliente", phone: "Tel.", email: "Email", siren: "SIREN", vat: "IVA", deliveryAddress: "Dirección de entrega", designation: "Descripción", quantity: "Cant.", unitPriceHT: "Precio unitario sin IVA", totalHT: "Total sin IVA", totalVAT: "IVA", totalTTC: "Total con IVA", discount: "Descuento", totalDue: "Importe a pagar", payment: "Pago", category: "Categoría", serviceDateDelivery: "Fecha de servicio / entrega", servicePeriod: "Periodo de servicio", purchaseOrderReference: "Referencia de pedido / PO", deposit: "Anticipo", depositRequested: "Anticipo solicitado", vatOnDebits: "IVA sobre débitos", lateFees: "Penalizaciones por retraso", recoveryFee40: "Indemnización fija de 40 € por gastos de cobro en caso de retraso en el pago.", vatNotApplicable: "IVA no aplicable", status: "Estado", continuation: "Continuación de los servicios", goodForAgreement: "Aceptado", signature: "Firma", pricesInCurrency: (currency) => `Los precios están expresados en ${currency}.`, quoteValidity: (days) => `Este presupuesto es válido durante ${days} días.`,
    },
    paymentMethods: { virement: "Transferencia bancaria", cb: "Tarjeta bancaria", cheque: "Cheque", especes: "Efectivo", abonnement: "Suscripción" },
    operationCategories: { vente: "Venta", prestation: "Prestación de servicios", mixte: "Venta + servicios" },
    mail: { subjectInvoice: (ref) => `Envío de su factura${ref ? ` ${ref}` : ""}`, subjectQuote: (ref) => `Envío de su presupuesto${ref ? ` ${ref}` : ""}`, bodyInvoice: (name, ref) => [`Hola${name ? ` ${name}` : ""},`, "", `Adjunto encontrará su factura${ref ? ` ${ref}` : ""}.`, "", "Quedo a su disposición si lo necesita."].join("\n"), bodyQuote: (name, ref) => [`Hola${name ? ` ${name}` : ""},`, "", `Adjunto encontrará su presupuesto${ref ? ` ${ref}` : ""}.`, "", "Quedo a su disposición para cualquier pregunta o modificación."].join("\n") },
  },
  it: {
    titles: { invoice: "FATTURA", depositInvoice: "FATTURA DI ACCONTO", creditNote: "NOTA DI CREDITO", quote: "PREVENTIVO" },
    labels: {
      date: "Data", dueDate: "Scadenza", serviceDelivery: "Prestazione / consegna", period: "Periodo", provider: "Fornitore", client: "Cliente", phone: "Tel.", email: "Email", siren: "SIREN", vat: "IVA", deliveryAddress: "Indirizzo di consegna", designation: "Descrizione", quantity: "Qtà", unitPriceHT: "Prezzo unitario imponibile", totalHT: "Totale imponibile", totalVAT: "IVA", totalTTC: "Totale IVA inclusa", discount: "Sconto", totalDue: "Totale da pagare", payment: "Pagamento", category: "Categoria", serviceDateDelivery: "Data prestazione / consegna", servicePeriod: "Periodo della prestazione", purchaseOrderReference: "Riferimento ordine / PO", deposit: "Acconto", depositRequested: "Acconto richiesto", vatOnDebits: "IVA per cassa", lateFees: "Penali di ritardo", recoveryFee40: "Indennità forfettaria di 40 € per spese di recupero in caso di ritardo nel pagamento.", vatNotApplicable: "IVA non applicabile", status: "Stato", continuation: "Continuazione delle prestazioni", goodForAgreement: "Per accettazione", signature: "Firma", pricesInCurrency: (currency) => `I prezzi sono espressi in ${currency}.`, quoteValidity: (days) => `Il preventivo è valido per ${days} giorni.`,
    },
    paymentMethods: { virement: "Bonifico bancario", cb: "Carta bancaria", cheque: "Assegno", especes: "Contanti", abonnement: "Abbonamento" },
    operationCategories: { vente: "Vendita", prestation: "Prestazione di servizi", mixte: "Vendita + servizi" },
    mail: { subjectInvoice: (ref) => `Invio della sua fattura${ref ? ` ${ref}` : ""}`, subjectQuote: (ref) => `Invio del suo preventivo${ref ? ` ${ref}` : ""}`, bodyInvoice: (name, ref) => [`Buongiorno${name ? ` ${name}` : ""},`, "", `In allegato trova la sua fattura${ref ? ` ${ref}` : ""}.`, "", "Resto a disposizione se necessario."].join("\n"), bodyQuote: (name, ref) => [`Buongiorno${name ? ` ${name}` : ""},`, "", `In allegato trova il suo preventivo${ref ? ` ${ref}` : ""}.`, "", "Resto a disposizione per qualsiasi domanda o modifica."].join("\n") },
  },
  de: {
    titles: { invoice: "RECHNUNG", depositInvoice: "ABSCHLAGSRECHNUNG", creditNote: "GUTSCHRIFT", quote: "ANGEBOT" },
    labels: {
      date: "Datum", dueDate: "Fälligkeitsdatum", serviceDelivery: "Leistung / Lieferung", period: "Zeitraum", provider: "Anbieter", client: "Kunde", phone: "Tel.", email: "E-Mail", siren: "SIREN", vat: "MwSt.", deliveryAddress: "Lieferadresse", designation: "Beschreibung", quantity: "Menge", unitPriceHT: "Einzelpreis netto", totalHT: "Gesamt netto", totalVAT: "MwSt.", totalTTC: "Gesamt brutto", discount: "Rabatt", totalDue: "Zu zahlender Betrag", payment: "Zahlung", category: "Kategorie", serviceDateDelivery: "Leistungs- / Lieferdatum", servicePeriod: "Leistungszeitraum", purchaseOrderReference: "Bestell- / PO-Referenz", deposit: "Anzahlung", depositRequested: "Angeforderte Anzahlung", vatOnDebits: "MwSt. auf Sollbesteuerung", lateFees: "Verzugszinsen", recoveryFee40: "Pauschale Inkassogebühr von 40 € bei Zahlungsverzug.", vatNotApplicable: "MwSt. nicht anwendbar", status: "Status", continuation: "Fortsetzung der Leistungen", goodForAgreement: "Einverstanden", signature: "Unterschrift", pricesInCurrency: (currency) => `Die Preise sind in ${currency} angegeben.`, quoteValidity: (days) => `Dieses Angebot ist ${days} Tage gültig.`,
    },
    paymentMethods: { virement: "Banküberweisung", cb: "Kartenzahlung", cheque: "Scheck", especes: "Barzahlung", abonnement: "Abonnement" },
    operationCategories: { vente: "Verkauf", prestation: "Dienstleistungen", mixte: "Verkauf + Dienstleistungen" },
    mail: { subjectInvoice: (ref) => `Ihre Rechnung${ref ? ` ${ref}` : ""}`, subjectQuote: (ref) => `Ihr Angebot${ref ? ` ${ref}` : ""}`, bodyInvoice: (name, ref) => [`Guten Tag${name ? ` ${name}` : ""},`, "", `anbei finden Sie Ihre Rechnung${ref ? ` ${ref}` : ""}.`, "", "Bei Fragen stehe ich Ihnen gerne zur Verfügung."].join("\n"), bodyQuote: (name, ref) => [`Guten Tag${name ? ` ${name}` : ""},`, "", `anbei finden Sie Ihr Angebot${ref ? ` ${ref}` : ""}.`, "", "Für Fragen oder Änderungen stehe ich Ihnen gerne zur Verfügung."].join("\n") },
  },
  nl: {
    titles: { invoice: "FACTUUR", depositInvoice: "VOORSCHOTFACTUUR", creditNote: "CREDITNOTA", quote: "OFFERTE" },
    labels: {
      date: "Datum", dueDate: "Vervaldatum", serviceDelivery: "Dienst / levering", period: "Periode", provider: "Leverancier", client: "Klant", phone: "Tel.", email: "E-mail", siren: "SIREN", vat: "Btw", deliveryAddress: "Leveringsadres", designation: "Omschrijving", quantity: "Aantal", unitPriceHT: "Eenheidsprijs excl. btw", totalHT: "Totaal excl. btw", totalVAT: "Btw", totalTTC: "Totaal incl. btw", discount: "Korting", totalDue: "Te betalen bedrag", payment: "Betaling", category: "Categorie", serviceDateDelivery: "Datum dienst / levering", servicePeriod: "Dienstperiode", purchaseOrderReference: "Bestelreferentie / PO", deposit: "Voorschot", depositRequested: "Gevraagd voorschot", vatOnDebits: "Btw op debet", lateFees: "Boetes bij laattijdige betaling", recoveryFee40: "Forfaitaire invorderingsvergoeding van €40 bij laattijdige betaling.", vatNotApplicable: "Btw niet van toepassing", status: "Status", continuation: "Vervolg van de diensten", goodForAgreement: "Voor akkoord", signature: "Handtekening", pricesInCurrency: (currency) => `Prijzen zijn uitgedrukt in ${currency}.`, quoteValidity: (days) => `Deze offerte is ${days} dagen geldig.`,
    },
    paymentMethods: { virement: "Bankoverschrijving", cb: "Kaartbetaling", cheque: "Cheque", especes: "Contant", abonnement: "Abonnement" },
    operationCategories: { vente: "Verkoop", prestation: "Diensten", mixte: "Verkoop + diensten" },
    mail: { subjectInvoice: (ref) => `Uw factuur${ref ? ` ${ref}` : ""}`, subjectQuote: (ref) => `Uw offerte${ref ? ` ${ref}` : ""}`, bodyInvoice: (name, ref) => [`Hallo${name ? ` ${name}` : ""},`, "", `In bijlage vindt u uw factuur${ref ? ` ${ref}` : ""}.`, "", "Ik blijf beschikbaar indien nodig."].join("\n"), bodyQuote: (name, ref) => [`Hallo${name ? ` ${name}` : ""},`, "", `In bijlage vindt u uw offerte${ref ? ` ${ref}` : ""}.`, "", "Ik blijf beschikbaar voor vragen of wijzigingen."].join("\n") },
  },
  pt: {
    titles: { invoice: "FATURA", depositInvoice: "FATURA DE ADIANTAMENTO", creditNote: "NOTA DE CRÉDITO", quote: "ORÇAMENTO" },
    labels: {
      date: "Data", dueDate: "Vencimento", serviceDelivery: "Serviço / entrega", period: "Período", provider: "Prestador", client: "Cliente", phone: "Tel.", email: "Email", siren: "SIREN", vat: "IVA", deliveryAddress: "Morada de entrega", designation: "Descrição", quantity: "Qtd.", unitPriceHT: "Preço unitário sem IVA", totalHT: "Total sem IVA", totalVAT: "IVA", totalTTC: "Total com IVA", discount: "Desconto", totalDue: "Total a pagar", payment: "Pagamento", category: "Categoria", serviceDateDelivery: "Data de serviço / entrega", servicePeriod: "Período do serviço", purchaseOrderReference: "Referência de encomenda / PO", deposit: "Adiantamento", depositRequested: "Adiantamento solicitado", vatOnDebits: "IVA sobre débitos", lateFees: "Penalizações por atraso", recoveryFee40: "Indemnização fixa de 40 € por custos de cobrança em caso de atraso no pagamento.", vatNotApplicable: "IVA não aplicável", status: "Estado", continuation: "Continuação dos serviços", goodForAgreement: "Aceite", signature: "Assinatura", pricesInCurrency: (currency) => `Os preços são expressos em ${currency}.`, quoteValidity: (days) => `Este orçamento é válido por ${days} dias.`,
    },
    paymentMethods: { virement: "Transferência bancária", cb: "Cartão bancário", cheque: "Cheque", especes: "Dinheiro", abonnement: "Subscrição" },
    operationCategories: { vente: "Venda", prestation: "Prestação de serviços", mixte: "Venda + serviços" },
    mail: { subjectInvoice: (ref) => `Envio da sua fatura${ref ? ` ${ref}` : ""}`, subjectQuote: (ref) => `Envio do seu orçamento${ref ? ` ${ref}` : ""}`, bodyInvoice: (name, ref) => [`Olá${name ? ` ${name}` : ""},`, "", `Segue em anexo a sua fatura${ref ? ` ${ref}` : ""}.`, "", "Fico à disposição se necessário."].join("\n"), bodyQuote: (name, ref) => [`Olá${name ? ` ${name}` : ""},`, "", `Segue em anexo o seu orçamento${ref ? ` ${ref}` : ""}.`, "", "Fico à disposição para qualquer pergunta ou alteração."].join("\n") },
  },
  th: {
    titles: { invoice: "ใบแจ้งหนี้", depositInvoice: "ใบแจ้งหนี้เงินมัดจำ", creditNote: "ใบลดหนี้", quote: "ใบเสนอราคา" },
    labels: {
      date: "วันที่", dueDate: "วันครบกำหนด", serviceDelivery: "บริการ / การจัดส่ง", period: "ระยะเวลา", provider: "ผู้ให้บริการ", client: "ลูกค้า", phone: "โทร.", email: "อีเมล", siren: "SIREN", vat: "ภาษีมูลค่าเพิ่ม", deliveryAddress: "ที่อยู่จัดส่ง", designation: "รายการ", quantity: "จำนวน", unitPriceHT: "ราคาต่อหน่วยไม่รวมภาษี", totalHT: "รวมไม่รวมภาษี", totalVAT: "ภาษีมูลค่าเพิ่ม", totalTTC: "รวมภาษีแล้ว", discount: "ส่วนลด", totalDue: "ยอดที่ต้องชำระ", payment: "การชำระเงิน", category: "หมวดหมู่", serviceDateDelivery: "วันที่ให้บริการ / จัดส่ง", servicePeriod: "ระยะเวลาการให้บริการ", purchaseOrderReference: "เลขอ้างอิงคำสั่งซื้อ / PO", deposit: "เงินมัดจำ", depositRequested: "เงินมัดจำที่ขอ", vatOnDebits: "ภาษีมูลค่าเพิ่มตามใบแจ้งหนี้", lateFees: "ค่าปรับชำระล่าช้า", recoveryFee40: "ค่าธรรมเนียมติดตามหนี้แบบเหมาจ่าย 40 ยูโรในกรณีชำระเงินล่าช้า", vatNotApplicable: "ไม่อยู่ในขอบเขตภาษีมูลค่าเพิ่ม", status: "สถานะ", continuation: "รายการบริการต่อเนื่อง", goodForAgreement: "ยอมรับ", signature: "ลายเซ็น", pricesInCurrency: (currency) => `ราคาแสดงเป็นสกุล ${currency}`, quoteValidity: (days) => `ใบเสนอราคานี้มีอายุ ${days} วัน`,
    },
    paymentMethods: { virement: "โอนเงินผ่านธนาคาร", cb: "บัตรธนาคาร", cheque: "เช็ค", especes: "เงินสด", abonnement: "การสมัครสมาชิก" },
    operationCategories: { vente: "การขาย", prestation: "การให้บริการ", mixte: "การขาย + การให้บริการ" },
    mail: { subjectInvoice: (ref) => `ใบแจ้งหนี้ของคุณ${ref ? ` ${ref}` : ""}`, subjectQuote: (ref) => `ใบเสนอราคาของคุณ${ref ? ` ${ref}` : ""}`, bodyInvoice: (name, ref) => [`สวัสดี${name ? ` ${name}` : ""},`, "", `กรุณาดูใบแจ้งหนี้${ref ? ` ${ref}` : ""} ที่แนบมาพร้อมนี้`, "", "หากต้องการข้อมูลเพิ่มเติม โปรดติดต่อเรา"].join("\n"), bodyQuote: (name, ref) => [`สวัสดี${name ? ` ${name}` : ""},`, "", `กรุณาดูใบเสนอราคา${ref ? ` ${ref}` : ""} ที่แนบมาพร้อมนี้`, "", "หากมีคำถามหรือต้องการแก้ไข โปรดติดต่อเรา"].join("\n") },
  },
  zh: {
    titles: { invoice: "发票", depositInvoice: "预付款发票", creditNote: "贷项通知单", quote: "报价单" },
    labels: {
      date: "日期", dueDate: "到期日", serviceDelivery: "服务 / 交付", period: "期间", provider: "服务商", client: "客户", phone: "电话", email: "电子邮件", siren: "SIREN", vat: "增值税", deliveryAddress: "交付地址", designation: "项目说明", quantity: "数量", unitPriceHT: "未税单价", totalHT: "未税合计", totalVAT: "增值税", totalTTC: "含税合计", discount: "折扣", totalDue: "应付金额", payment: "付款", category: "类别", serviceDateDelivery: "服务 / 交付日期", servicePeriod: "服务期间", purchaseOrderReference: "采购订单 / PO 编号", deposit: "预付款", depositRequested: "要求的预付款", vatOnDebits: "按开票计征增值税", lateFees: "逾期付款罚金", recoveryFee40: "逾期付款时收取 40 欧元的固定追偿费用。", vatNotApplicable: "不适用增值税", status: "状态", continuation: "后续服务", goodForAgreement: "同意", signature: "签名", pricesInCurrency: (currency) => `价格以 ${currency} 表示。`, quoteValidity: (days) => `本报价单有效期为 ${days} 天。`,
    },
    paymentMethods: { virement: "银行转账", cb: "银行卡", cheque: "支票", especes: "现金", abonnement: "订阅" },
    operationCategories: { vente: "销售", prestation: "服务", mixte: "销售 + 服务" },
    mail: { subjectInvoice: (ref) => `您的发票${ref ? ` ${ref}` : ""}`, subjectQuote: (ref) => `您的报价单${ref ? ` ${ref}` : ""}`, bodyInvoice: (name, ref) => [name ? `${name}，您好：` : "您好：", "", `请查收随附的发票${ref ? ` ${ref}` : ""}。`, "", "如有需要，请随时与我们联系。"].join("\n"), bodyQuote: (name, ref) => [name ? `${name}，您好：` : "您好：", "", `请查收随附的报价单${ref ? ` ${ref}` : ""}。`, "", "如有任何问题或需要修改，请随时与我们联系。"].join("\n") },
  },
};

export function getDocumentClientTexts(language: unknown) {
  return DOCUMENT_TEXTS[normalizeClientLanguage(language)] || DOCUMENT_TEXTS.fr;
}

export function getDocumentPaymentLabel(language: unknown, key: unknown) {
  const value = String(key || "").trim();
  if (!value) return "—";
  const texts = getDocumentClientTexts(language);
  return texts.paymentMethods[value] || DOCUMENT_TEXTS.fr.paymentMethods[value] || value;
}

export function getDocumentOperationCategoryLabel(language: unknown, key: unknown) {
  const value = String(key || "").trim();
  if (!value) return "—";
  const texts = getDocumentClientTexts(language);
  return texts.operationCategories[value] || DOCUMENT_TEXTS.fr.operationCategories[value] || value;
}


const DOCUMENT_STATUS_TEXTS: Record<ClientLanguageCode, Record<string, string>> = {
  fr: { brouillon: "Brouillon", envoye: "Envoyé", paye: "Payé", en_attente_paiement: "En attente de paiement", accepte: "Accepté", annule: "Annulé" },
  en: { brouillon: "Draft", envoye: "Sent", paye: "Paid", en_attente_paiement: "Pending payment", accepte: "Accepted", annule: "Cancelled" },
  es: { brouillon: "Borrador", envoye: "Enviado", paye: "Pagado", en_attente_paiement: "Pendiente de pago", accepte: "Aceptado", annule: "Cancelado" },
  it: { brouillon: "Bozza", envoye: "Inviato", paye: "Pagato", en_attente_paiement: "In attesa di pagamento", accepte: "Accettato", annule: "Annullato" },
  de: { brouillon: "Entwurf", envoye: "Gesendet", paye: "Bezahlt", en_attente_paiement: "Zahlung ausstehend", accepte: "Akzeptiert", annule: "Storniert" },
  nl: { brouillon: "Concept", envoye: "Verzonden", paye: "Betaald", en_attente_paiement: "In afwachting van betaling", accepte: "Geaccepteerd", annule: "Geannuleerd" },
  pt: { brouillon: "Rascunho", envoye: "Enviado", paye: "Pago", en_attente_paiement: "Pagamento pendente", accepte: "Aceite", annule: "Cancelado" },
  th: { brouillon: "แบบร่าง", envoye: "ส่งแล้ว", paye: "ชำระแล้ว", en_attente_paiement: "รอชำระเงิน", accepte: "ยอมรับแล้ว", annule: "ยกเลิกแล้ว" },
  zh: { brouillon: "草稿", envoye: "已发送", paye: "已付款", en_attente_paiement: "待付款", accepte: "已接受", annule: "已取消" },
};

export function getDocumentStatusLabel(language: unknown, status: unknown) {
  const key = String(status || "").trim();
  if (!key) return "—";
  const lang = normalizeClientLanguage(language);
  return DOCUMENT_STATUS_TEXTS[lang]?.[key] || DOCUMENT_STATUS_TEXTS.fr[key] || key;
}

export function buildDocumentMailTexts(kind: "facture" | "devis", prefs: ClientExchangePreferences, clientName?: string, docRef?: string) {
  const texts = getDocumentClientTexts(prefs.clientLanguage).mail;
  const ref = String(docRef || "").trim();
  const name = String(clientName || "").trim();
  return kind === "facture"
    ? { subject: texts.subjectInvoice(ref), text: texts.bodyInvoice(name, ref) }
    : { subject: texts.subjectQuote(ref), text: texts.bodyQuote(name, ref) };
}

export function getCalendarClientTexts(language: unknown) {
  return CALENDAR_TEXTS[normalizeClientLanguage(language)] || CALENDAR_TEXTS.fr;
}
