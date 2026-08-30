# Filet de sécurité WordPress — inscriptions

Ce module observe, sans les modifier, l'appel HTTP actuel vers `https://app.inrcy.com/api/public/trial-signup` et la réponse du Webhook natif Elementor du formulaire `essai_inrcy_30j` (`405c24a`) si ce mécanisme est utilisé plus tard. Il ne remplace pas l'envoi, ne renvoie aucune inscription et ne modifie jamais un succès.

Il envoie un mail à `compte@inrcy.com` lorsque WordPress ne peut pas joindre l’application, reçoit une réponse invalide, une limitation `429`, ou une erreur technique que l’application n’a pas marquée comme prise en charge. Les erreurs de saisie, doublons et validation (`400`, `409`, `422`) sont ignorées, ainsi que le honeypot anti-spam.

Le premier envoi est immédiat. Une outbox WordPress non autoloadée est enregistrée atomiquement avant l’envoi. Si `wp_mail()` échoue ou si PHP s’arrête, Action Scheduler (avec WP-Cron en secours) reprend automatiquement l’alerte ; un sweeper contrôle les éléments en attente toutes les 5 minutes. Un lease SQL empêche deux workers d’envoyer simultanément. Les données du contact sont supprimées dès l’envoi, ou après 30 jours maximum si toute la messagerie reste indisponible.

Installation recommandée : installer l'archive depuis **Extensions > Ajouter une extension**, puis activer **iNrCy — Filet de sécurité inscription**. Cette méthode est réversible et WordPress vérifie le PHP à l'activation.

Le secret du webhook ne doit jamais rester dans son URL. Conserver la valeur côté serveur WordPress et l’envoyer dans l’en-tête `X-Trial-Signup-Secret` dès que le mécanisme de webhook actuel permet ce réglage.
