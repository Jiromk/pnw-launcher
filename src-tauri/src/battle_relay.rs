//! battle_relay.rs — IPC fichier entre le launcher et le jeu pour le combat PvP.
//!
//! Le jeu (VMS modifié) écrit/lit des fichiers JSON dans `%LOCALAPPDATA%/PNW Launcher/battle/`.
//! Le launcher sert de relay via Supabase entre les deux joueurs.

use std::fs;
use std::path::PathBuf;

use crate::app_local_dir;

/// Dossier IPC pour le combat PvP.
fn battle_dir() -> Result<PathBuf, String> {
    let dir = app_local_dir().map_err(|e| e.to_string())?.join("battle");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Lit et supprime `vms_outbox.json` (écrit par le jeu).
/// Retourne `None` si le fichier n'existe pas.
/// Lit le .tmp d'abord (écriture atomique côté jeu).
#[tauri::command]
pub fn cmd_battle_read_outbox() -> Result<Option<String>, String> {
    let dir = battle_dir()?;
    let path = dir.join("vms_outbox.json");
    let tmp_path = dir.join("vms_outbox.json.tmp");

    // Nettoyer les .tmp orphelins (le jeu a écrit mais le rename a échoué)
    if tmp_path.exists() && !path.exists() {
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
#[tauri::command]
pub fn cmd_battle_write_inbox(data: String) -> Result<(), String> {
    let path = battle_dir()?.join("vms_inbox.json");
    fs::write(&path, data).map_err(|e| e.to_string())
}

/// Écrit `vms_trigger.json` pour déclencher un combat dans le jeu.
/// Retourne le chemin absolu du fichier créé.
#[tauri::command]
pub fn cmd_battle_write_trigger(data: String) -> Result<String, String> {
    let path = battle_dir()?.join("vms_trigger.json");
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Dossier des logs de combat persistants.
fn battle_logs_dir() -> Result<PathBuf, String> {
    let dir = app_local_dir().map_err(|e| e.to_string())?.join("battle_logs");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Sauvegarde un log de combat en JSON dans `battle_logs/`.
/// Le fichier est nommé `{date}_{roomCode}.json`.
#[tauri::command]
pub fn cmd_battle_save_log(data: String) -> Result<String, String> {
    let dir = battle_logs_dir()?;
    let now = chrono::Local::now();
    let filename = format!("{}.json", now.format("%Y-%m-%d_%H-%M-%S"));
    let path = dir.join(&filename);
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Supprime tous les fichiers du dossier battle/ (cleanup).
#[tauri::command]
pub fn cmd_battle_cleanup() -> Result<(), String> {
    let dir = battle_dir()?;
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}
