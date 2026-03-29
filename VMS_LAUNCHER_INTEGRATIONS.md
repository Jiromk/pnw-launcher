# Intégrations VMS → Launcher PNW — Classées par difficulté

## Context
Document de toutes les fonctionnalités extraites des fichiers VMS (02000 VMS) implantables dans le Launcher PNW (Tauri/Rust + React/TypeScript). Classement par difficulté croissante avec fichiers à modifier et prérequis.

---

# NIVEAU 1 — FACILE (quelques heures)

---

## 1.1 Indicateur "Serveur PvP en ligne / hors ligne"

**Source VMS** : `VMS_Config.rb` → `HOST = "54.36.183.33"`, `PORT = 25565`, protocole UDP
**But** : Afficher un badge vert/rouge dans la sidebar ou le dashboard pour indiquer si le serveur multijoueur est joignable.

### Comment
- Côté Rust : nouvelle commande Tauri `cmd_check_vms_status()` qui tente une connexion UDP vers le serveur avec un timeout court (2-3s). Retourne `true`/`false`.
- Côté React : state `vmsOnline` avec un `setInterval` toutes les 60s pour re-vérifier. Afficher une pastille verte/rouge + texte.
- `std::net::UdpSocket` est dans la lib standard Rust, aucune dépendance supplémentaire.

### Fichiers à modifier
| Fichier | Action |
|---|---|
| `src-tauri/src/main.rs` | Ajouter `cmd_check_vms_status` + l'enregistrer dans `.invoke_handler()` |
| `src/Sidebar.tsx` ou `src/App.tsx` | State + affichage du badge |
| `src/launcherUiLocale.ts` | Traductions FR/EN ("PvP : En ligne", "PvP: Online") |

### Prérequis
- Aucun. Le serveur VMS existant suffit, pas besoin de le modifier.

### Estimation : ~1-2h

---

## 1.2 Messages d'erreur VMS localisés dans le Launcher

**Source VMS** : `VMS_Config.rb` → constantes `SERVER_INACTIVE`, `CLUSTER_FULL`, `DIFFERENT_VERSION`, `DISCONNECTED`, `BATTLE_WAITING`, `PLAYER_DISCONNECT`, etc.
**But** : Réutiliser ces messages dans le launcher quand on affiche le statut serveur ou des erreurs de matchmaking.

### Comment
Ajouter dans `launcherUiLocale.ts` les équivalents FR/EN de chaque message VMS : serveur inactif, salle pleine, version différente, déconnexion, attente adversaire, joueur déconnecté.

### Fichiers à modifier
| Fichier | Action |
|---|---|
| `src/launcherUiLocale.ts` | Ajouter les messages VMS FR/EN |

### Estimation : ~30min

---

## 1.3 Stats PvP (Victoires / Défaites) dans le profil joueur

**Source VMS** : `VMS_Battle.rb` → `$game_variables[396]` (victoires), `$game_variables[397]` (défaites)
**But** : Afficher les stats W/L PvP dans la vue profil du launcher.

### Comment
- Parsing : dans `profile.ts`, chercher `$game_variables` (ou `@variables`) dans l'arbre Marshal avec `bfs`, puis lire les index 396 et 397.
- Types : ajouter `pvpWins` et `pvpLosses` à `PlayerProfile` dans `types.ts`.
- UI : afficher un bloc "PvP Record" avec victoires/défaites dans `TeamView.tsx`.

### Fichiers à modifier
| Fichier | Action |
|---|---|
| `src/types.ts` | Ajouter `pvpWins`, `pvpLosses` à `PlayerProfile` |
| `src/profile.ts` | Extraire `$game_variables[396]` et `[397]` lors du parsing |
| `src/views/TeamView.tsx` | Afficher le bloc stats PvP |
| `src/launcherUiLocale.ts` | Textes "Victoires PvP" / "PvP Wins" |

### Prérequis
- Le joueur doit avoir joué au moins un combat PvP pour que les variables existent.
- Vérifier que `$game_variables` est bien accessible dans la save (si c'est un objet `Game_Variables < Array` de PSDK, adapter le parcours BFS).

### Estimation : ~2-3h

---

# NIVEAU 2 — MOYEN (1 journée)

---

## 2.1 Interface de Matchmaking (Codes Room)

**Source VMS** : `VMS_UI.rb` → `generate_room_code` (rand 100000..999999), `create_room`, `join_room`, `input_room_code`
**But** : Permettre aux joueurs de créer/rejoindre un salon PvP depuis le launcher, puis lancer le jeu automatiquement avec le code.

### Flow utilisateur
- Bouton "PvP" dans la sidebar → Écran PvP
- **Créer un groupe** : génère un code 6 chiffres, l'affiche avec bouton copier, lance le jeu avec `--vms_code=XXXX --vms_role=host`
- **Rejoindre un groupe** : champ de saisie 6 chiffres, bouton rejoindre, lance le jeu avec `--vms_code=XXXX --vms_role=join`
- Affiche le statut serveur + un aperçu de l'équipe du joueur

### Comment
- Côté React : créer une nouvelle vue `PvPView.tsx` avec la logique de génération de code (même algo que VMS_UI.rb : random entre 100000 et 999999), un champ de saisie pour le code, et les boutons créer/rejoindre.
- Côté Rust : nouvelle commande `cmd_launch_game_pvp(code, is_host)` similaire à `cmd_launch_game()` mais qui passe des arguments CLI supplémentaires au .exe du jeu.
- Côté jeu PSDK : modifier le jeu pour lire `ARGV` au démarrage et déclencher `VMS.join(code)` automatiquement si les arguments sont présents.

### Fichiers à modifier/créer
| Fichier | Action |
|---|---|
| `src/views/PvPView.tsx` | **CRÉER** — Vue complète matchmaking |
| `src-tauri/src/main.rs` | Ajouter `cmd_launch_game_pvp` |
| `src/Sidebar.tsx` | Ajouter entrée "PvP" dans le menu |
| `src/App.tsx` | Ajouter le routing vers PvPView |
| `src/launcherUiLocale.ts` | Textes FR/EN du matchmaking |

### Prérequis
- **Modification côté jeu PSDK** : le jeu doit lire les arguments CLI et déclencher la connexion VMS automatiquement. Sans cela, le launcher affiche juste le code et le joueur le saisit manuellement in-game.
- Le serveur VMS doit être en ligne.

### Estimation : ~4-6h (launcher) + ~2h (côté jeu)

---

## 2.2 Validation d'équipe PvP depuis le Launcher

**Source VMS** : `VMS_Utilities.rb` → `valid_party?` et `party_summary`
**But** : Avant de lancer un match PvP, vérifier depuis le launcher que l'équipe du joueur est valide (1-6 Pokémon, tous en vie).

### Comment
- Réplication directe de la logique `valid_party?` en TypeScript : vérifier que l'équipe contient entre 1 et 6 Pokémon. Note : les HP courants ne sont pas toujours accessibles depuis le parsing save, donc la vérification "tous vivants" est limitée.
- Charger la save la plus récente (`cmd_latest_save_blob`), parser avec `parseProfile()`, afficher l'équipe avec sprites (réutiliser les composants de `TeamView.tsx`).
- Boutons Create/Join désactivés si équipe invalide.

### Fichiers à modifier
| Fichier | Action |
|---|---|
| `src/views/PvPView.tsx` | Ajouter validation + affichage équipe |

### Prérequis
- Le parsing `profile.ts` fonctionne déjà.

### Estimation : ~2-3h

---

## 2.3 Résumé d'équipe format VMS (Discord RPC enrichi)

**Source VMS** : `VMS_Utilities.rb` → `party_summary`
**But** : Afficher un résumé textuel compact de l'équipe dans le matchmaking et le Discord Rich Presence.

### Comment
- Fonction utilitaire qui génère un texte du type `"Pikachu Lv.50, Mewtwo Lv.100, ..."` à partir de l'équipe parsée.
- Injecter ce résumé dans `cmd_discord_set_presence` pour enrichir le Rich Presence Discord pendant une session PvP.

### Fichiers à modifier
| Fichier | Action |
|---|---|
| `src/App.tsx` | Enrichir l'appel Discord RPC avec le résumé d'équipe |

### Estimation : ~1h

---

# NIVEAU 3 — AVANCÉ (plusieurs jours)

---

## 3.1 Vue "Joueurs en ligne" (nécessite modification serveur)

**Source VMS** : `VMS_Connection.rb` → `VMS::Player` (id, name, trainer_type, party, state), `get_players`, `get_player_count`
**But** : Afficher dans le launcher la liste des joueurs connectés au serveur VMS avec leurs équipes.

### Pourquoi c'est avancé
Le serveur VMS utilise un protocole binaire (Zlib + Marshal) sur UDP. Le launcher ne peut pas parler ce protocole. Il faut soit :
- **Option A (recommandé)** : Ajouter un petit serveur HTTP (Sinatra/WEBrick) à côté du serveur VMS qui expose des endpoints REST (`/api/status`, `/api/players`, `/api/player/:id`). Le format de party serait le hash `encrypt_pokemon()` → directement mappable vers `TeamMember`.
- **Option B** : Un bridge WebSocket qui traduit entre le protocole VMS et JSON.

### Mapping des données VMS → Launcher
Les champs de `encrypt_pokemon()` sont quasi-identiques à `TeamMember` existant. Seuls les champs supplémentaires sont à considérer :

| Champ VMS | Présent dans TeamMember ? | Action |
|---|---|---|
| `hp`, `max_hp` | Non | Ajouter si on veut afficher la barre de vie |
| `atk/dfe/spd/ats/dfs` (stats calculées) | Non | Ajouter pour les stats finales |
| `ev_hp/atk/dfe/spd/ats/dfs` | Non | Ajouter pour affichage complet |
| `status`, `status_count` | Non | Optionnel (empoisonné, etc.) |
| `loyalty` (bonheur) | Non | Optionnel |
| `captured_with` (ball) | Non | Optionnel (cosmétique) |
| `moves[].pp/ppmax` | Non (on a juste `moves: number[]`) | Ajouter pour les PP |

### Fichiers à créer/modifier
| Fichier | Action |
|---|---|
| **Serveur VMS** (Ruby) | Ajouter API HTTP (`/api/status`, `/api/players`) |
| `src/views/PvPView.tsx` | Section "Joueurs en ligne" |
| `src/types.ts` | Types `VmsPlayer`, `VmsPokemon` |
| `src-tauri/src/main.rs` | Commande `cmd_vms_get_players` |

### Prérequis
- **Modification du serveur VMS** pour exposer une API HTTP
- Le serveur doit partager l'état des `VMS::Player` en mémoire avec l'API HTTP

### Estimation : ~2-3 jours (dont serveur)

---

## 3.2 Historique de matchs PvP complet

**Source VMS** : `VMS_Battle.rb` → résultats de combat, noms adversaires
**But** : Afficher un historique détaillé des combats PvP (adversaire, résultat, date).

### Pourquoi c'est avancé
Actuellement, le jeu ne stocke que 2 compteurs (var 396/397). Pour un historique complet, il faut modifier `VMS_Battle.rb` côté jeu pour sauvegarder chaque match dans une variable supplémentaire (ex: `$game_variables[398]` = array de hashes avec opponent, result, date, opponent_party). Côté launcher, extraire cette variable depuis la save et l'afficher dans une table.

### Fichiers à modifier
| Fichier | Action |
|---|---|
| **VMS_Battle.rb** (jeu) | Sauvegarder l'historique dans une variable |
| `src/profile.ts` | Extraire la variable d'historique |
| `src/views/PvPView.tsx` | Afficher la table historique |
| `src/types.ts` | Type `PvPMatch` |

### Prérequis
- Modification du script VMS_Battle.rb côté jeu
- Le format doit rester sérialisable par Marshal

### Estimation : ~1-2 jours

---

## 3.3 Chat PvP / Messagerie entre joueurs

**Source VMS** : `VMS_Connection.rb` → infrastructure socket, `send_message`, `process_player_data`
**But** : Permettre aux joueurs de communiquer via le launcher pendant l'attente de match.

### Pourquoi c'est avancé
- Le protocole VMS actuel ne supporte pas les messages texte (seulement player_data)
- Il faudrait étendre le serveur VMS ou utiliser un service tiers (WebSocket, Firebase, etc.)
- Questions de modération et sécurité à gérer

### Estimation : ~3-5 jours

---

# RÉSUMÉ PAR DIFFICULTÉ

| # | Feature | Difficulté | Temps | Source VMS | Modif serveur ? | Modif jeu ? |
|---|---|---|---|---|---|---|
| 1.1 | Badge serveur en ligne/hors ligne | Facile | ~1-2h | VMS_Config | Non | Non |
| 1.2 | Messages VMS localisés FR/EN | Facile | ~30min | VMS_Config | Non | Non |
| 1.3 | Stats PvP W/L dans profil | Facile | ~2-3h | VMS_Battle | Non | Non |
| 2.1 | Interface matchmaking (codes room) | Moyen | ~4-6h | VMS_UI | Non | Oui (lire ARGV) |
| 2.2 | Validation équipe PvP | Moyen | ~2-3h | VMS_Utilities | Non | Non |
| 2.3 | Résumé équipe (Discord RPC) | Moyen | ~1h | VMS_Utilities | Non | Non |
| 3.1 | Liste joueurs en ligne | Avancé | ~2-3j | VMS_Connection | Oui (API HTTP) | Non |
| 3.2 | Historique matchs détaillé | Avancé | ~1-2j | VMS_Battle | Non | Oui (save history) |
| 3.3 | Chat entre joueurs | Avancé | ~3-5j | VMS_Connection | Oui (extend proto) | Oui |

---

# ORDRE D'IMPLÉMENTATION RECOMMANDÉ

1. **1.2** Messages localisés (base pour tout le reste)
2. **1.1** Badge serveur (feedback visuel immédiat)
3. **1.3** Stats PvP W/L (enrichit le profil existant)
4. **2.3** Résumé équipe Discord RPC (quick win)
5. **2.2** Validation équipe PvP (prépare le matchmaking)
6. **2.1** Interface matchmaking (feature complète)
7. **3.1** Joueurs en ligne (si API serveur disponible)
8. **3.2** Historique matchs (si save étendue côté jeu)
9. **3.3** Chat (optionnel, complexe)
