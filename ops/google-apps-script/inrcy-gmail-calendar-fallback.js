var INRCY_CONFIG = Object.freeze({
  calendarId: "c_b9ac6e7b3c917520e13e2ea49e8ffcc2cf4d12d1b48d518628a66a8c46f25b35@group.calendar.google.com",
  expectedSubject: "Nouvelle inscription iNrCy",
  gmailQuery: 'in:anywhere from:(monitoring@inrcy.com) subject:"Nouvelle inscription iNrCy" newer_than:30d -label:"iNrCy/Agenda - traite"',
  timeZone: "Europe/Paris",
  durationMinutes: 60,
  startAtIso: "2026-09-05T16:00:00Z",
  processedProperty: "INRCY_PROCESSED_GMAIL_MESSAGES",
  processedLabel: "iNrCy/Agenda - traite",
  cooldownProperty: "INRCY_GMAIL_COOLDOWN_UNTIL",
  cooldownAttemptProperty: "INRCY_GMAIL_QUOTA_FAILURES",
  gmailCooldownBaseHours: 2,
  gmailCooldownMaxHours: 12,
  maxThreadsPerRun: 25,
  triggerHours: 1
});

/**
 * À lancer une seule fois si le déclencheur doit être recréé.
 * Supprime uniquement les anciens déclencheurs de synchroniserInscriptions,
 * installe un passage toutes les heures, puis lance un premier rattrapage.
 * L'API iNrCy crée désormais le rappel immédiatement ; ce script est seulement
 * un filet de récupération et doit donc ménager strictement le quota Gmail.
 */
function installerAutomatisation() {
  var properties = PropertiesService.getScriptProperties();
  properties.deleteProperty(INRCY_CONFIG.cooldownProperty);
  properties.deleteProperty(INRCY_CONFIG.cooldownAttemptProperty);

  ScriptApp.getProjectTriggers()
    .filter(function (trigger) {
      return trigger.getHandlerFunction() === "synchroniserInscriptions";
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger("synchroniserInscriptions")
    .timeBased()
    .everyHours(INRCY_CONFIG.triggerHours)
    .create();

  synchroniserInscriptions();
}

/**
 * Filet de récupération : crée un rappel jaune uniquement si l'API iNrCy ne
 * l'a pas déjà créé. Les fils traités sont exclus avant leur chargement afin
 * de limiter strictement les appels Gmail.
 */
function synchroniserInscriptions() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    console.log("Synchronisation ignorée : une exécution est déjà en cours.");
    return;
  }

  var properties = PropertiesService.getScriptProperties();

  try {
    var now = Date.now();
    var cooldownUntil = Number(
      properties.getProperty(INRCY_CONFIG.cooldownProperty) || "0"
    );
    if (cooldownUntil > now) {
      console.log(
        "Synchronisation Gmail en pause jusqu'au " +
          new Date(cooldownUntil).toISOString() +
          " (protection du quota)."
      );
      return;
    }
    if (cooldownUntil) {
      properties.deleteProperty(INRCY_CONFIG.cooldownProperty);
    }

    var calendar = CalendarApp.getCalendarById(INRCY_CONFIG.calendarId);
    if (!calendar) {
      throw new Error("Agenda partagé iNrCy introuvable ou inaccessible.");
    }

    var processed = lireMessagesTraites_(properties);
    var minimumDate = new Date(INRCY_CONFIG.startAtIso);
    var label =
      GmailApp.getUserLabelByName(INRCY_CONFIG.processedLabel) ||
      GmailApp.createLabel(INRCY_CONFIG.processedLabel);
    var threads = GmailApp.search(
      INRCY_CONFIG.gmailQuery,
      0,
      INRCY_CONFIG.maxThreadsPerRun
    );
    if (!threads.length) {
      console.log("Synchronisation terminée : aucun nouveau fil Gmail.");
      return;
    }

    var messagesByThread = GmailApp.getMessagesForThreads(threads);
    var stats = {
      threads: threads.length,
      created: 0,
      existing: 0,
      ignored: 0,
      failed: 0
    };

    for (var threadIndex = 0; threadIndex < threads.length; threadIndex += 1) {
      var thread = threads[threadIndex];
      var messages = messagesByThread[threadIndex] || [];
      var threadCanBeLabeled = true;
      messages.sort(function (a, b) {
        return a.getDate().getTime() - b.getDate().getTime();
      });

      for (var messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
        var message = messages[messageIndex];
        var messageId = message.getId();
        if (processed[messageId]) continue;
        if (message.getDate().getTime() < minimumDate.getTime()) {
          processed[messageId] = Date.now();
          stats.ignored += 1;
          continue;
        }
        if (!message.getSubject().trim().startsWith(INRCY_CONFIG.expectedSubject)) {
          stats.ignored += 1;
          continue;
        }

        try {
          var body = message.getPlainBody();
          var start = extraireDateInscription_(body) || message.getDate();
          var end = new Date(
            start.getTime() + INRCY_CONFIG.durationMinutes * 60000
          );
          var firstName = champ_(body, "Prenom") || champ_(body, "Prénom");
          var lastName = champ_(body, "Nom");
          var company = champ_(body, "Societe") || champ_(body, "Société");
          var contactEmail = champ_(body, "E-mail") || champ_(body, "Email");
          var prospectUserId = champ_(body, "User ID");
          var fullName = [firstName, lastName].filter(Boolean).join(" ");
          var title = "Inscription - A traiter";
          if (fullName && fullName !== "-") title += " - " + fullName;
          if (company && company !== "-" && company !== "–") {
            title += " - " + company;
          }

          var sourceLink =
            "https://mail.google.com/mail/?authuser=compte@inrcy.com#all/" +
            thread.getId();
          var description = [
            "STATUT : A traiter",
            "Couleurs conseillees : jaune = a traiter, bleu = appele, vert = valide, rouge = refuse.",
            "",
            body.trim().slice(0, 6500),
            "",
            "Mail source : " + sourceLink,
            "ID message Gmail : " + messageId
          ].join("\n");

          var alreadyExists = calendar
            .getEvents(
              new Date(start.getTime() - 60000),
              new Date(end.getTime() + 60000)
            )
            .some(function (event) {
              var eventDescription = event.getDescription() || "";
              if (
                eventDescription.indexOf("ID message Gmail : " + messageId) !==
                -1
              ) {
                return true;
              }
              if (prospectUserId && typeof event.getTag === "function") {
                try {
                  if (event.getTag("prospectUserId") === prospectUserId) {
                    return true;
                  }
                } catch (tagError) {
                  // CalendarApp peut masquer une propriété privée créée par API.
                }
              }
              return Boolean(
                contactEmail &&
                  normaliser_(eventDescription).indexOf(
                    normaliser_(contactEmail)
                  ) !== -1
              );
            });

          if (!alreadyExists) {
            var event = calendar.createEvent(title.slice(0, 250), start, end, {
              description: description
            });
            event.setColor(CalendarApp.EventColor.YELLOW);
            stats.created += 1;
          } else {
            stats.existing += 1;
          }
          processed[messageId] = Date.now();
        } catch (messageError) {
          if (estErreurQuotaGmail_(messageError)) throw messageError;
          threadCanBeLabeled = false;
          stats.failed += 1;
          console.error(
            "Échec du message Gmail " + messageId + " : " + String(messageError)
          );
        }
      }

      if (threadCanBeLabeled) label.addToThread(thread);
    }

    enregistrerMessagesTraites_(properties, processed);
    properties.deleteProperty(INRCY_CONFIG.cooldownProperty);
    properties.deleteProperty(INRCY_CONFIG.cooldownAttemptProperty);
    console.log("Synchronisation terminée : " + JSON.stringify(stats));
  } catch (error) {
    if (estErreurQuotaGmail_(error)) {
      var quotaFailures = Math.max(
        1,
        Number(
          properties.getProperty(INRCY_CONFIG.cooldownAttemptProperty) || "0"
        ) + 1
      );
      var pauseHours = Math.min(
        INRCY_CONFIG.gmailCooldownMaxHours,
        INRCY_CONFIG.gmailCooldownBaseHours *
          Math.pow(2, Math.min(quotaFailures - 1, 4))
      );
      var pauseUntil = Date.now() + pauseHours * 60 * 60 * 1000;
      properties.setProperty(
        INRCY_CONFIG.cooldownAttemptProperty,
        String(quotaFailures)
      );
      properties.setProperty(INRCY_CONFIG.cooldownProperty, String(pauseUntil));
      console.warn(
        "Quota Gmail atteint. Synchronisation mise en pause jusqu'au " +
          new Date(pauseUntil).toISOString() +
          " (tentative " + quotaFailures + ", pause " + pauseHours +
          " h). Les mails restent dans Gmail et seront rattrapés ensuite."
      );
      return;
    }
    console.error("Échec de synchronisation : " + String(error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function estErreurQuotaGmail_(error) {
  var message = String(
    error && error.message ? error.message : error || ""
  ).toLowerCase();
  return (
    message.indexOf("gmail") !== -1 &&
    (message.indexOf("service invoked too many times") !== -1 ||
      message.indexOf("limit exceeded") !== -1 ||
      message.indexOf("quota") !== -1)
  );
}

function champ_(body, label) {
  var expected = normaliser_(label) + ":";
  var lines = String(body || "").split(/\r?\n/);
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i].trim();
    if (normaliser_(line).indexOf(expected) === 0) {
      return line.slice(line.indexOf(":") + 1).trim();
    }
  }
  return "";
}

function normaliser_(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extraireDateInscription_(body) {
  var raw = champ_(body, "Date");
  var match = raw.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})[^\d]+(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) return null;
  var formatted =
    [pad2_(match[1]), pad2_(match[2]), match[3]].join("/") +
    " " +
    [pad2_(match[4]), pad2_(match[5]), pad2_(match[6] || "0")].join(":");
  try {
    return Utilities.parseDate(
      formatted,
      INRCY_CONFIG.timeZone,
      "dd/MM/yyyy HH:mm:ss"
    );
  } catch (error) {
    return null;
  }
}

function pad2_(value) {
  return ("0" + String(value)).slice(-2);
}

function lireMessagesTraites_(properties) {
  try {
    return JSON.parse(
      properties.getProperty(INRCY_CONFIG.processedProperty) || "{}"
    );
  } catch (error) {
    return {};
  }
}

function enregistrerMessagesTraites_(properties, processed) {
  var compact = Object.keys(processed)
    .sort(function (a, b) {
      return processed[b] - processed[a];
    })
    .slice(0, 3000)
    .reduce(function (result, key) {
      result[key] = processed[key];
      return result;
    }, {});
  properties.setProperty(
    INRCY_CONFIG.processedProperty,
    JSON.stringify(compact)
  );
}
