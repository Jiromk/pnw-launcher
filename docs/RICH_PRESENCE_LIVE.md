# Rich Presence en direct – état des lieux

## Dossiers analysés

- **`C:\Users\lamou\Desktop\PNW 0.6 Open Beta`** : installation du jeu (exe, Data/, Saves/, Game.yarb, RGSS104E = RPG Maker XP).
- **`Saves/`** : contient `input.yml` (config manette/clavier) et les sauvegardes **sans extension** : `Pokemon_Party-1`, `Pokemon_Party-2`, etc. Format **Ruby Marshal** (éventuellement compressé zlib/gzip).

## Ce qui existe déjà

- Le launcher met à jour Discord au **lancement** du jeu (`"En jeu"` + temps de jeu) et au **retour** (`"Dans le menu"`).
- Les **détails** (pseudo, temps de jeu) viennent du **profil** (API), pas du fichier save local.
- Le code prévoit déjà les états `"map"` et `"battle"` dans `discord_build_activity()` mais ils ne sont jamais utilisés.

## Peut-on avoir les infos en direct (carte, combat) ?

### 1. Fichiers sur disque

| Source | Carte actuelle | En combat |
|--------|-----------------|-----------|
| **Fichiers de save** (`Pokemon_Party-*`) | **Partiel** : le save contient l’état au moment de la **sauvegarde** (dont map). Donc on peut afficher la **dernière carte sauvegardée**, pas la carte à l’instant T. | **Non** : rien n’est écrit pendant le combat. |
| **Fichier d’état dédié** (ex. `game_state.json`) | **Oui**, si le **jeu** est modifié pour écrire à chaque changement de map (et de scène combat). | **Oui**, avec la même modification. |

Sans modifier l’exe du jeu, il n’y a **aucun fichier** mis à jour en continu (carte / combat). Seuls les saves sont mis à jour **au moment où le joueur sauvegarde**.

### 2. Lecture du dernier save (ce qu’on peut faire tout de suite)

- Pendant que le jeu tourne, le launcher peut **polling** (ex. toutes les 20–30 s) :
  - Lire le **dernier save** (le plus récent dans `Saves/`, déjà supporté par `cmd_latest_save_blob`).
  - **Parser le Marshal** (côté front avec `@hyrious/marshal` comme dans `scripts/inspect-save.mjs`, ou en Rust avec une crate / script externe) pour extraire :
    - **Map** : `map_id` (et si on a les noms de cartes dans `Data/`, le nom de la carte).
    - **Pseudo** : trainer name / player name.
  - Mettre à jour le Rich Presence : état `"map"`, détails du type `"Carte : [Nom] • Pseudo"`.

Résultat : on affiche la **dernière carte connue** (celle du dernier save), pas la carte en temps réel. Dès que le joueur sauvegarde à nouveau, on se met à jour.

### 3. Vraie infos en direct (carte + combat)

Deux options :

- **A) Modifier le jeu (recommandé si vous avez la main sur le code)**  
  Dans le projet RPG Maker / scripts Ruby du jeu, à chaque :
  - changement de map,
  - entrée / sortie de combat,  
  écrire un petit fichier (ex. `Saves/game_state.json`) :
  ```json
  { "map_id": 42, "map_name": "Bourg Palette", "scene": "Map" }
  ```
  ou `"scene": "Battle"`. Le launcher lit ce fichier en polling et met à jour le Rich Presence en direct.

- **B) Lecture mémoire (ReadProcessMemory)**  
  Lire la mémoire du processus `Pokémon New World.exe` pour retrouver `$game_map.map_id`, `$scene`, etc. Possible sous Windows mais **fragile** (offsets qui changent selon la version / build) et un peu intrusif. À réserver si vous ne pouvez pas modifier le jeu.

## Recommandation

1. **Court terme (sans modifier le jeu)**  
   - Implémenter un **polling** côté launcher : tant que le processus jeu est en cours, toutes les 20–30 s lire le dernier save, parser le Marshal pour `map_id` + pseudo, et mettre à jour le Rich Presence avec `"Sur la carte : [Nom]"` (en résolvant le nom de carte via les données du jeu si disponible).
   - Continuer à afficher "En jeu" avec le temps de session ; ne pas afficher "En combat" (pas d’info fiable).

2. **À moyen terme (si vous contrôlez le code du jeu)**  
   - Ajouter l’écriture de `Saves/game_state.json` (ou équivalent) à chaque changement de map et de scène combat, puis faire lire ce fichier par le launcher pour un Rich Presence vraiment en direct (carte + combat).

3. **Option avancée**  
   - Memory reading uniquement si modification du jeu impossible et que vous acceptez la maintenance des offsets.

## Fichiers utiles dans le launcher

- `src-tauri/src/main.rs` : `discord_build_activity` (déjà "map" / "battle"), `cmd_launch_game` (détection sortie de jeu), `cmd_latest_save_blob`, `all_saves_in_dir`.
- `scripts/inspect-save.mjs` : exemple de parsing Marshal (trainer, pokedex) ; à étendre pour `map_id` / map name.
- `marshal_reader.py` : lecteur Marshal en Python (PKPRT + 04 08) si vous voulez un script externe pour extraire map_id.

## Données Data/ du jeu

- `Data/` contient des `.dat` (0.dat, 1.dat, … Scripts.dat). Les noms de cartes sont souvent dans ces fichiers (MapInfos ou équivalent). Pour afficher "Carte : Bourg Palette" il faudra soit les extraire, soit garder un `map_id` brut dans le Rich Presence.
