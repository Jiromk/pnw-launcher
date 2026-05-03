//! battle_relay.rs — IPC fichier entre le launcher et le jeu pour le combat PvP.
//!
//! Le jeu (VMS modifié) écrit/lit des fichiers JSON dans `%LOCALAPPDATA%/PNW Launcher/battle/`.
//! Le launcher sert de relay via Supabase entre les deux joueurs.

use std::fs;
use std::path::{Path, PathBuf};

use crate::app_local_dir;

/// Dossier IPC pour le combat PvP.
fn battle_dir() -> Result<PathBuf, String> {
    let dir = app_local_dir().map_err(|e| e.to_string())?.join("battle");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Vrai si le fichier existe ET son mtime est >= `min_age_secs` secondes.
/// Utilisé pour ne PAS toucher les .tmp en cours d'écriture par le jeu —
/// seuls les .tmp vraiment orphelins (game crashed mid-rename) sont anciens.
fn is_stale(path: &Path, min_age_secs: u64) -> bool {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|mtime| mtime.elapsed().ok())
        .map(|elapsed| elapsed.as_secs() >= min_age_secs)
        .unwrap_or(false)
}

/// Lit et supprime `vms_outbox.json` (écrit par le jeu).
/// Retourne `None` si le fichier n'existe pas.
///
/// IMPORTANT — race vs l'écriture atomique du jeu :
/// Le jeu écrit `vms_outbox.json.tmp` puis fait `rename(.tmp, .json)`. Si on
/// "rescue" le .tmp dès qu'il existe, on vole l'opération de rename du jeu :
/// son rename échoue avec "No such file or directory" et le jeu boucle en
/// erreur sans jamais publier sa state → le launcher ne voit jamais
/// `state="battle"` et le combat reste stuck. Donc on ne rescue qu'un .tmp
/// vraiment ancien (>1s = le jeu a clairement crashé entre write et rename).
#[tauri::command]
pub fn cmd_battle_read_outbox() -> Result<Option<String>, String> {
    let dir = battle_dir()?;
    let path = dir.join("vms_outbox.json");
    let tmp_path = dir.join("vms_outbox.json.tmp");

    if tmp_path.exists() && !path.exists() && is_stale(&tmp_path, 1) {
        let _ = fs::rename(&tmp_path, &path);
    }

    if !path.exists() {
        return Ok(None);
    }
    match fs::read_to_string(&path) {
        Ok(content) => {
            let _ = fs::remove_file(&path);
            Ok(Some(content))
        }
        Err(_) => Ok(None), // Fichier verrouillé par le jeu, retry au prochain poll
    }
}

/// Écrit `vms_inbox.json` pour que le jeu lise les données du joueur distant.
///
/// Écriture atomique via tmp + rename : sinon, sur Windows, `fs::write` tronque
/// le fichier AVANT d'y écrire — le jeu qui lit l'inbox à ce moment précis lit un
/// fichier vide, le supprime, et perd le signal. Critique pour `opponent_left`.
#[tauri::command]
pub fn cmd_battle_write_inbox(data: String) -> Result<(), String> {
    let dir = battle_dir()?;
    let path = dir.join("vms_inbox.json");
    let tmp_path = dir.join("vms_inbox.json.tmp");

    fs::write(&tmp_path, &data).map_err(|e| format!("write tmp inbox: {}", e))?;

    // rename() sur Windows échoue si le fichier cible existe → remove puis rename.
    // Entre les deux, le jeu pourrait lire un inbox absent, ce qui est safe
    // (read_inbox retourne silencieusement, on retry à la prochaine frame).
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    fs::rename(&tmp_path, &path).map_err(|e| {
        // Si rename a échoué, on tente un cleanup du tmp pour ne pas le laisser traîner.
        let _ = fs::remove_file(&tmp_path);
        format!("rename inbox: {}", e)
    })?;

    Ok(())
}

/// Écrit `vms_trigger.json` pour déclencher un combat dans le jeu.
/// Retourne le chemin absolu du fichier créé.
#[tauri::command]
pub fn cmd_battle_write_trigger(data: String) -> Result<String, String> {
    let path = battle_dir()?.join("vms_trigger.json");
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Sous-dossier des logs de combat persistants.
fn battle_logs_dir() -> Result<PathBuf, String> {
    let dir = battle_dir()?.join("logs");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Nombre max de logs conservés. Les plus anciens sont supprimés.
const MAX_BATTLE_LOGS: usize = 100;

/// Sauvegarde un log de combat en JSON dans `battle_logs/`.
/// Supprime automatiquement les plus anciens si > MAX_BATTLE_LOGS.
#[tauri::command]
pub fn cmd_battle_save_log(data: String) -> Result<String, String> {
    let dir = battle_logs_dir()?;
    let now = chrono::Local::now();
    let filename = format!("{}.json", now.format("%Y-%m-%d_%H-%M-%S"));
    let path = dir.join(&filename);
    fs::write(&path, &data).map_err(|e| e.to_string())?;

    // Cleanup : garder seulement les MAX_BATTLE_LOGS plus récents
    if let Ok(entries) = fs::read_dir(&dir) {
        let mut files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
            .collect();
        if files.len() > MAX_BATTLE_LOGS {
            files.sort_by_key(|e| e.file_name());
            for old in &files[..files.len() - MAX_BATTLE_LOGS] {
                let _ = fs::remove_file(old.path());
            }
        }
    }

    Ok(path.to_string_lossy().into_owned())
}

/// Crée `vms_party_request` pour demander au jeu d'écrire la party live.
/// Le jeu le détecte dans Graphics.update, écrit `vms_live_party.json`,
/// puis supprime la requête.
#[tauri::command]
pub fn cmd_battle_request_live_party() -> Result<(), String> {
    let dir = battle_dir()?;
    // Supprimer l'ancienne réponse pour détecter la nouvelle
    let response = dir.join("vms_live_party.json");
    let _ = fs::remove_file(&response);
    // Créer le fichier de requête (contenu vide, seule l'existence compte)
    let request = dir.join("vms_party_request");
    fs::write(&request, "").map_err(|e| e.to_string())
}

/// Lit `vms_live_party.json` (réponse du jeu à la requête ci-dessus).
/// Retourne `None` si le fichier n'existe pas encore (le jeu n'a pas encore répondu).
#[tauri::command]
pub fn cmd_battle_read_live_party() -> Result<Option<String>, String> {
    let dir = battle_dir()?;
    let path = dir.join("vms_live_party.json");
    let tmp_path = dir.join("vms_live_party.json.tmp");

    // Nettoyer les .tmp orphelins — voir cmd_battle_read_outbox pour le pourquoi
    // du check d'âge (vs race avec le rename atomique du jeu).
    if tmp_path.exists() && !path.exists() && is_stale(&tmp_path, 1) {
        let _ = fs::rename(&tmp_path, &path);
    }

    if !path.exists() {
        return Ok(None);
    }
    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(_) => Ok(None),
    }
}

/// Supprime UNIQUEMENT les fichiers IPC du dossier battle/ (cleanup).
/// Preserve vms_debug.log et le sous-dossier logs/ pour garder l'historique de debug.
///
/// IMPORTANT : on ne supprime PAS les `.tmp` récents. Le jeu écrit son outbox
/// via `write(.tmp) + rename(.tmp, .json)`. Si on supprime `vms_outbox.json.tmp`
/// pendant que le jeu est entre ces deux étapes, son rename échoue avec
/// "No such file" → le jeu boucle en erreur et le combat reste stuck.
/// On garde la suppression pour les `.tmp` >= 2s (vrais orphelins) seulement.
#[tauri::command]
pub fn cmd_battle_cleanup() -> Result<(), String> {
    let dir = battle_dir()?;
    if dir.exists() {
        // Fichiers finaux : suppression directe, jamais en cours d'écriture par le jeu.
        let final_files = [
            "vms_outbox.json",
            "vms_inbox.json",
            "vms_trigger.json",
        ];
        for filename in final_files.iter() {
            let path = dir.join(filename);
            if path.exists() {
                let _ = fs::remove_file(&path);
            }
        }

        // Fichiers .tmp : suppression UNIQUEMENT si vraiment orphelins (>=2s).
        // Sinon on race avec le rename atomique du jeu.
        let tmp_files = ["vms_outbox.json.tmp", "vms_inbox.json.tmp"];
        for filename in tmp_files.iter() {
            let path = dir.join(filename);
            if path.exists() && is_stale(&path, 2) {
                let _ = fs::remove_file(&path);
            }
        }
    }
    Ok(())
}

/// Vérifie si `vms_inbox.json` existe encore. Utilisé pour savoir si le jeu a
/// consommé le dernier message écrit (le jeu supprime l'inbox après l'avoir lu).
#[tauri::command]
pub fn cmd_battle_inbox_exists() -> Result<bool, String> {
    let dir = battle_dir()?;
    let path = dir.join("vms_inbox.json");
    Ok(path.exists())
}

/// Lit et supprime `vms_bet_done.json` (écrit par le jeu après un transfert de pari).
/// Retourne `None` si le fichier n'existe pas encore.
#[tauri::command]
pub fn cmd_battle_read_bet_done() -> Result<Option<String>, String> {
    let dir = battle_dir()?;
    let path = dir.join("vms_bet_done.json");
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&path);
    Ok(Some(raw))
}
