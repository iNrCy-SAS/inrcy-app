# Fichiers audio joints à iNrAssist

Le professionnel peut joindre un MP3 ou WAV depuis son appareil ou le bouton
« Audios de ma médiathèque », puis demander explicitement son import dans Mes
médias. Les limites natives restent 3 Mio, cinq minutes et quatre pièces jointes
(20 Mio au total). La validation décode localement le fichier pour contrôler sa
durée ; iNrAssist ne transcrit ni n’analyse le son.

L’original reste dans le stockage privé à rétention existante. L’import utilise
les endpoints natifs prepare/finalize et une réservation atomique empêchant les
doublons après une réponse perdue. Le propriétaire est revérifié avant et après
le transfert. Les fichiers déjà choisis dans la bibliothèque n’ont pas besoin
d’être réimportés.

Avant déploiement, avec l’environnement serveur habituel, exécuter le contrôle
en lecture seule :

```sh
node scripts/configure-assistant-audio-storage.mjs
```

Si les deux formats manquent, l’option explicite `--apply` ajoute uniquement
`audio/mpeg` et `audio/wav`. Le script conserve le bucket privé, sa limite de
20 Mio et tous ses types existants, puis relit le résultat. Il ne supprime aucun
objet. Ne déclarer l’audio prêt que lorsque le reçu contient `ready: true`.
La création d’un nouveau bucket via `provision-assistant-attachments.mjs` inclut
ces formats. Aucun changement de schéma ni d’accès public n’est requis.
