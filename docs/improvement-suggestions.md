# Propositions d'amélioration du processus d'installation/mise à jour

## 1. Fiabiliser la détection de l'installation existante
`cmd_get_install_info` s'appuie désormais sur un fichier `install_manifest.json` généré à chaque installation/mise à jour. Ce snapshot recense le chemin relatif et la taille de tous les fichiers extraits. Lors du démarrage, la commande :

- compare la présence et la taille de ces fichiers pour renseigner `hasIntegrity` ;
- ajoute `missingFiles` et `hasManifest` au JSON renvoyé ;
- ne considère `hasGame` à `true` que si l'exécutable, `.version` **et** l'intégrité sont confirmés.

Les anciennes installations sans manifeste continuent de fonctionner mais un snapshot est régénéré dès la première installation réussie, réduisant fortement les faux positifs.

## 2. Ajouter un mode "réparer"
Lorsque `find_game_exe_in_dir` échoue ou qu'il manque un fichier manifeste, il pourrait être utile de proposer un flux "Réparer" dans l'UI :

- Déclencher `cmd_download_and_install` sur le même dossier sans demander de suppression préalable.
- Afficher une étape dédiée dans l'UI pour rassurer l'utilisateur.

Cela éviterait d'imposer une désinstallation complète pour corriger une installation corrompue.

## 3. Optimiser le système de mises à jour
Le backend mémorise maintenant l'`ETag` de l'archive installée (`Config.install_etag`). Lorsqu'un HEAD retourne le même `ETag` et que l'intégrité locale est validée, `run_download_and_install` :

- saute complètement le téléchargement ;
- réécrit `.version` et le snapshot pour refléter la version distante ;
- émet directement `stage: done` avec `reused: true`.

Cette vérification évite des téléchargements inutiles quand la version distante n'a pas changé ou a déjà été pré-téléchargée.

## 4. Sécuriser l'étape de téléchargement
`run_download_and_install` gère la reprise via Range/If-Range mais n'applique pas de vérification d'intégrité de l'archive une fois téléchargée. On pourrait :

- Ajouter un hash SHA-256 dans le manifeste et le vérifier après téléchargement avant extraction.
- Utiliser une signature numérique si l'équipe distribue des exécutables sensibles.

## 5. Mieux journaliser les étapes côté utilisateur
Les événements `pnw://progress` couvrent les étapes principales mais le lanceur n'écrit pas de journal persistant. Ajouter un log lisible (texte ou JSON) permettrait :

- De diagnostiquer les erreurs réseau (par exemple nombre de tentatives dans la boucle de téléchargement).
- D'envoyer un rapport plus complet au support utilisateur.

## 6. Gestion des mises à jour en arrière-plan
Aujourd'hui l'utilisateur doit déclencher explicitement l'installation. On pourrait proposer :

- Une tâche planifiée/cron qui lance `cmd_fetch_manifest` et pré-télécharge l'archive en arrière-plan.
- Un paramètre "Installer automatiquement" qui déclenche `startInstallOrUpdate` dès qu'une nouvelle version est disponible, après confirmation utilisateur la première fois.

## 7. Nettoyage et rollback
L'extraction se fait maintenant dans un dossier tampon `.pnw_staging` voisin de l'installation cible. Une fois l'extraction réussie :

- l'ancienne installation est déplacée dans `.pnw_backup` avant le swap ;
- le staging est renommé en dossier cible ;
- toute erreur d'écriture (`.version`, snapshot ou config) restaure automatiquement la sauvegarde.

Un backup de la version précédente reste donc disponible pour un rollback manuel en cas de problème après mise à jour.
