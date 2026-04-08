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

/// Dossier des logs de combat (même dossier que le battle IPC).
fn battle_logs_dir() -> Result<PathBuf, String> {
    battle_dir()
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

/// Supprime les fichiers IPC du dossier battle/ (cleanup).
/// Préserve les fichiers de log (YYYY-MM-DD_*.json) et vms_debug.log.
#[tauri::command]
pub fn cmd_battle_cleanup() -> Result<(), String> {
    let dir = battle_dir()?;
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            if let Ok(entry) = entry {
                let name = entry.file_name().to_string_lossy().to_string();
                // Ne pas supprimer les logs de combat ni le debug log
                if name.starts_with("20") && name.ends_with(".json") { continue; }
                if name == "vms_debug.log" { continue; }
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}
