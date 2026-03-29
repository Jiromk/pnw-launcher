# Pistes d’amélioration du launcher

Idées classées par thème, sans ordre de priorité. À piocher selon le temps et les besoins.

---

## 1. Fiabilité & erreurs

- **Bouton "Réessayer"** quand `status === "error"` : un bouton dédié à côté (ou à la place) du message d’erreur pour relancer le check / le téléchargement, au lieu de compter uniquement sur "Rafraîchir".
- **Messages d’erreur plus explicites** : distinguer "pas de réseau", "manifest introuvable (404)", "serveur injoignable", "erreur lors de l’extraction", etc. pour que l’utilisateur sache quoi faire.
- **Réessai automatique** : après un échec de fetch manifest ou de téléchargement, proposer un retry automatique (ex. 2–3 tentatives avec délai) avant d’afficher l’erreur définitive.
- **Moins de `.catch(() => {})`** : pour les appels non critiques, au minimum `console.warn` ou un petit toast pour ne pas masquer les problèmes en dev / support.

---

## 2. Mode hors-ligne & réseau

- **Détection hors-ligne** : si le fetch du manifest échoue (réseau coupé), afficher un bandeau "Pas de connexion – vous pouvez lancer le jeu si déjà installé" et garder le bouton "Jouer" actif.
- **Cache du manifest** : éviter de refetch à chaque `visibilitychange` ; garder le manifest en mémoire (ou avec un TTL court, ex. 5 min) pour limiter les requêtes.

---

## 3. UX au quotidien

- **Raccourci clavier "Jouer"** : ex. Entrée ou Ctrl+Enter quand le jeu est installé et à jour, pour lancer directement.
- **"Dernière vérification il y a X min"** : afficher à côté du statut pour que l’utilisateur sache s’il a besoin de rafraîchir.
- **Ouvrir le dossier du jeu** : un petit bouton (icône dossier / "Ouvrir") à côté du chemin d’installation qui ouvre l’explorateur sur ce dossier.
- **Lancer le jeu au démarrage** (option) : une option "Lancer le jeu au démarrage du launcher" si déjà installé et à jour, pour les utilisateurs qui n’ouvrent le launcher que pour jouer.

---

## 4. Téléchargement & mise à jour

- **Taille du téléchargement** : afficher "Téléchargement : XXX Mo" avant de lancer (si le manifest fournit la taille), pour éviter les mauvaises surprises.
- **Réduire en barre des tâches / tray** : option "Réduire pendant le téléchargement" avec notification à la fin (toast ou notification système).
- **Vérification d’intégrité** : si le manifest contient des hashes (checksums), vérifier les fichiers après téléchargement et signaler les fichiers corrompus.

---

## 5. Profil & sauvegardes

- **Sélection automatique du dernier save** : pré-sélectionner dans la liste le save avec la date de modification la plus récente (celui sur lequel le joueur joue en général).
- **Backup / export d’une save** : bouton "Exporter cette sauvegarde" pour copier le fichier vers un emplacement choisi par l’utilisateur.

---

## 6. Accessibilité & clarté

- **Labels pour les boutons icônes** : `aria-label` sur "Rafraîchir", "Choisir un dossier", etc., pour les lecteurs d’écran et le focus clavier.
- **Focus dans les modales** : focus trap et retour du focus à l’élément qui a ouvert la modale à la fermeture.

---

## 7. Infos & transparence

- **Version du launcher** : afficher la version (ex. en bas de la sidebar ou dans un "À propos") pour le support et les rapports de bug.
- **Changelog launcher** : un lien "Nouveautés" ou "Versions" qui ouvre une page ou une modale avec l’historique des versions du launcher (pas seulement du jeu).

---

## 8. Performance

- **Lazy load des vues** : charger les vues lourdes (Pokedex, BST, Items, etc.) à la demande (React.lazy + Suspense) pour accélérer l’affichage initial du launcher.
- **Éviter les re-renders inutiles** : mémoiser les callbacks passés aux vues (useCallback) et les composants coûteux (React.memo) si des lenteurs apparaissent.

---

## 9. Petit bonus

- **Thème / fond** : tu as déjà ThemeMenu ; on peut ajouter 1–2 thèmes prédéfinis (clair, sombre, "pokemon") pour ceux qui préfèrent un look différent.
- **Langue** : si un jour le launcher vise une audience non francophone, préparer les chaînes (i18n) dès maintenant évite un gros refactor plus tard.

---

En priorité, les plus impactants pour l’utilisateur sont souvent : **messages d’erreur clairs**, **bouton Réessayer**, **ouvrir le dossier du jeu**, **raccourci Jouer**, et **mode hors-ligne** (jouer sans réseau si déjà installé).
