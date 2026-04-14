#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::{copy, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use chrono::{Datelike, Local};
use dirs;
use sysinfo::Disks;
use reqwest::blocking::Client;
use reqwest::header::{
    ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_RANGE, IF_RANGE, RANGE, USER_AGENT,
};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use discord_presence::models::rich_presence::{Activity, ActivityTimestamps};
use discord_presence::Client as DiscordClient;
use tauri::Emitter; // pour app.emit(...)
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;
use zip::ZipArchive;

mod psdk_data2;
mod battle_relay;

/* ============== Modèles ============== */
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    #[serde(default)]
    version: String,
    #[serde(default, rename = "zip_url")]
    zip_url: String,
    #[serde(default, rename = "url")]
    url: String,
    #[serde(default, rename = "downloadUrl")]
    download_url: String,
    #[serde(default, rename = "launcherBackgroundUrl")]
    launcher_background_url: Option<String>,
    #[serde(default, rename = "launcherSidebarImageUrl")]
    launcher_sidebar_image_url: Option<String>,
}
/// Réponse `GET /api/downloads/launcher-update` (camelCase JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherUpdateResponse {
    #[serde(default)]
    configured: bool,
    version: Option<String>,
    download_url: Option<String>,
}
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Config {
    #[serde(default)]
    install_dir: Option<String>,
    #[serde(default)]
    install_etag: Option<String>,
    /// "fr" | "en" — piste du jeu pour le manifest Launcher
    #[serde(default)]
    game_lang: Option<String>,
    /// Dernier dossier d’installation connu pour la piste FR (restauration au changement de langue).
    #[serde(default)]
    install_dir_fr: Option<String>,
    /// Dernier dossier d’installation connu pour la piste EN.
    #[serde(default)]
    install_dir_en: Option<String>,
} // dossier du jeu (parent de l’exe)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstallFileRecord {
    path: String,
    size: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstallSnapshot {
    files: Vec<InstallFileRecord>,
}
#[derive(Debug, Clone)]
struct IntegrityReport {
    manifest_present: bool,
    missing_files: usize,
    healthy: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SaveBlob {
    path: String,
    modified: u64,
    bytes_b64: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SaveEntry {
    path: String,
    name: String,
    modified: u64,
    size: u64,
}
#[derive(Default)]
struct DlInner {
    cancel: bool,
    paused: bool,
    started: Option<Instant>,
    tmp_path: Option<PathBuf>,
    downloaded: u64,
    total: u64,
    window: Vec<(Instant, u64)>,
}
struct AppState {
    dl: Arc<Mutex<DlInner>>,
    discord: Arc<Mutex<DiscordClient>>,
}

/* ============== Constantes ============== */
const DISCORD_APP_ID: u64 = 1483296386228289738;
const PNW_DOWNLOAD_PAGE_URL: &str = "https://www.pokemonnewworld.fr/telechargement";
const DISCORD_INVITE_URL: &str = "https://discord.gg/w5dfYbDNaq";
const APP_DIR_NAME: &str = "PNW Launcher";
const TMP_ZIP_NAME: &str = "pnw_tmp.zip";
const EXACT_EXE_NAMES: [&str; 4] = [
    "Pokémon New World.exe",
    "Pokemon New World.exe",
    "PokemonNewWorld.exe",
    "PNW.exe",
];
const MAX_ATTEMPTS: usize = 6;

/* ============== Utils ============== */
fn errs<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
fn app_local_dir() -> Result<PathBuf> {
    let base = dirs::data_local_dir().ok_or_else(|| anyhow!("no data_local_dir()"))?;
    Ok(base.join(APP_DIR_NAME))
}
/// Marque un fichier/dossier comme caché sur Windows (attrib +H).
#[cfg(target_os = "windows")]
fn set_hidden(path: &Path) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("attrib")
        .arg("+H")
        .arg(path.as_os_str())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .status();
}
#[cfg(not(target_os = "windows"))]
fn set_hidden(_path: &Path) {}

/// Crée le sous-dossier `sprite_cache/<sub>` et masque le dossier parent `sprite_cache` sur Windows.
fn ensure_sprite_cache_dir(sub: &str) -> Result<PathBuf, String> {
    let root = app_local_dir().map_err(errs)?.join("sprite_cache");
    let dir = root.join(sub);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(errs)?;
        set_hidden(&root);
    }
    Ok(dir)
}

fn config_path() -> Result<PathBuf> {
    Ok(app_local_dir()?.join("config.json"))
}
fn read_config() -> Config {
    if let Ok(p) = config_path() {
        if let Ok(s) = fs::read_to_string(p) {
            if let Ok(v) = serde_json::from_str(&s) {
                return v;
            }
        }
    }
    Config::default()
}
fn write_config(cfg: &Config) -> Result<()> {
    let dir = app_local_dir()?;
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    fs::write(dir.join("config.json"), serde_json::to_vec_pretty(cfg)?)?;
    Ok(())
}
fn default_install_dir() -> Result<PathBuf> {
    Ok(app_local_dir()?.join("Game"))
}
fn default_install_dir_for_lang(lang: &str) -> Result<PathBuf> {
    match lang {
        "en" => Ok(app_local_dir()?.join("Game (EN)")),
        _    => Ok(app_local_dir()?.join("Game")),  // FR = legacy, pas de cassure
    }
}

/// Returns the absolute path of today's log file under the launcher data dir.
/// Creates the `logs` subdirectory if missing.
fn log_file_path() -> Result<PathBuf> {
    let dir = app_local_dir()?.join("logs");
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    let date = Local::now().format("%Y-%m-%d");
    Ok(dir.join(format!("launcher-{}.log", date)))
}

/// Comparaison de chemins Windows (casse + slashs).
fn windows_paths_equivalent(a: &Path, b: &Path) -> bool {
    let sa = a.to_string_lossy().to_lowercase().replace('/', "\\");
    let sb = b.to_string_lossy().to_lowercase().replace('/', "\\");
    sa.trim_end_matches('\\') == sb.trim_end_matches('\\')
}

/// Le jeu doit être sous `...\PNW Launcher\Game`, jamais la racine `...\PNW Launcher\`
/// (même dossier que config, zips temporaires, ou un exe copié à la main).
/// Sinon `remove_dir_all` sur une « install sans exe » peut effacer tout le dossier données.
fn fix_install_dir_if_points_to_app_root(cfg: &mut Config) -> bool {
    let Some(ref id) = cfg.install_dir else {
        return false;
    };
    let Ok(app_l) = app_local_dir() else {
        return false;
    };
    let p = PathBuf::from(id);
    if windows_paths_equivalent(&p, &app_l) {
        cfg.install_dir = Some(app_l.join("Game").to_string_lossy().to_string());
        cfg.install_etag = None;
        return true;
    }
    false
}

fn normalize_game_install_root(cfg: &mut Config) -> Result<PathBuf, String> {
    if fix_install_dir_if_points_to_app_root(cfg) {
        write_config(cfg).map_err(errs)?;
    }
    let app_l = app_local_dir().map_err(errs)?;
    Ok(cfg
        .install_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| app_l.join("Game")))
}
fn is_bad_install_path_hint(s: &str) -> bool {
    let t = s.to_lowercase().replace('/', "\\");
    t.contains(".pnw_backup") || t.contains(".pnw_staging")
}
fn remember_install_dir_for_lang(cfg: &mut Config, lang: &str, path: &str) {
    if is_bad_install_path_hint(path) {
        return;
    }
    match lang {
        "en" => cfg.install_dir_en = Some(path.to_string()),
        "fr" => cfg.install_dir_fr = Some(path.to_string()),
        _ => {}
    }
}
fn remembered_dir_for_lang(cfg: &Config, lang: &str) -> Option<PathBuf> {
    let s = match lang {
        "en" => cfg.install_dir_en.as_deref(),
        _ => cfg.install_dir_fr.as_deref(),
    }?;
    if is_bad_install_path_hint(s) {
        return None;
    }
    let p = PathBuf::from(s);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}
/// Si les emplacements par langue sont vides : copier le `install_dir` actuel vers la langue courante.
fn migrate_install_dir_slots(cfg: &mut Config) -> bool {
    if cfg.install_dir_fr.is_some() || cfg.install_dir_en.is_some() {
        return false;
    }
    let gl = match cfg.game_lang.as_deref() {
        Some("fr") | Some("en") => cfg.game_lang.as_deref().unwrap(),
        _ => return false,
    };
    let Some(ref id) = cfg.install_dir else {
        return false;
    };
    if is_bad_install_path_hint(id) {
        return false;
    }
    if gl == "fr" {
        cfg.install_dir_fr = Some(id.clone());
    } else {
        cfg.install_dir_en = Some(id.clone());
    }
    true
}
/// Corrige un chemin invalide (ex. resté sur `.pnw_backup`) vers le dossier mémorisé ou le défaut.
fn sanitize_install_dir_config(cfg: &mut Config) -> bool {
    let Some(ref id) = cfg.install_dir else {
        return false;
    };
    if !is_bad_install_path_hint(id) {
        return false;
    }
    let gl = cfg.game_lang.as_deref().unwrap_or("fr");
    if let Some(p) = remembered_dir_for_lang(cfg, gl) {
        cfg.install_dir = Some(p.to_string_lossy().to_string());
        cfg.install_etag = None;
        return true;
    }
    if let Ok(def) = default_install_dir() {
        cfg.install_dir = Some(def.to_string_lossy().to_string());
        cfg.install_etag = None;
        return true;
    }
    false
}
fn current_install_dir() -> Option<PathBuf> {
    let mut cfg = read_config();
    let mut changed = false;
    if migrate_install_dir_slots(&mut cfg) {
        changed = true;
    }
    if sanitize_install_dir_config(&mut cfg) {
        changed = true;
    }
    if fix_install_dir_if_points_to_app_root(&mut cfg) {
        changed = true;
    }
    if changed {
        let _ = write_config(&cfg);
    }
    cfg.install_dir
        .map(PathBuf::from)
        .or_else(|| default_install_dir().ok())
}
fn parse_total_from_content_range(s: &str) -> Option<u64> {
    s.rsplit('/').next()?.parse().ok()
}
fn window_speed_eta(win: &[(Instant, u64)], downloaded: u64, total: u64) -> (u64, Option<u64>) {
    if win.len() < 2 {
        return (0, None);
    }
    let (t0, b0) = win.first().unwrap();
    let (t1, b1) = win.last().unwrap();
    let dt = t1.duration_since(*t0).as_secs_f64().max(0.001);
    let db = (b1 - b0) as f64;
    let speed = (db / dt) as u64;
    let eta = if speed > 0 && total > downloaded {
        Some(((total - downloaded) as f64 / speed as f64) as u64)
    } else {
        None
    };
    (speed, eta)
}
fn is_exact_game_exe(name: &str) -> bool {
    EXACT_EXE_NAMES.iter().any(|n| name.eq_ignore_ascii_case(n))
}
fn find_game_exe_in_dir(dir: &Path, max_depth: usize) -> Option<PathBuf> {
    for e in WalkDir::new(dir)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = e.path();
        if p.is_file() {
            if let Some(n) = p.file_name().and_then(|x| x.to_str()) {
                if is_exact_game_exe(n) {
                    return Some(p.to_path_buf());
                }
            }
        }
    }
    None
}
fn read_version(game_dir: &Path) -> Result<String> {
    Ok(fs::read_to_string(game_dir.join(".version"))?
        .trim()
        .to_string())
}
fn write_version(game_dir: &Path, v: &str) -> Result<()> {
    if !game_dir.exists() {
        fs::create_dir_all(game_dir)?;
    }
    fs::write(game_dir.join(".version"), v)?;
    Ok(())
}
fn restore_from_backup(target: &Path, backup: &Path) {
    let _ = fs::remove_dir_all(target);
    if backup.exists() {
        let _ = fs::rename(backup, target);
    }
}
fn install_manifest_path(dir: &Path) -> PathBuf {
    dir.join("install_manifest.json")
}
fn write_install_snapshot(dir: &Path) -> Result<()> {
    let mut files = Vec::new();
    for entry in WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Ok(rel) = path.strip_prefix(dir) {
                if rel == Path::new("install_manifest.json") {
                    continue;
                }
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                let size = fs::metadata(path)?.len();
                files.push(InstallFileRecord {
                    path: rel_str,
                    size,
                });
            }
        }
    }
    let snapshot = InstallSnapshot { files };
    fs::write(
        install_manifest_path(dir),
        serde_json::to_vec_pretty(&snapshot)?,
    )?;
    Ok(())
}
fn read_install_snapshot(dir: &Path) -> Option<InstallSnapshot> {
    let path = install_manifest_path(dir);
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}
fn check_install_integrity(dir: &Path) -> IntegrityReport {
    if let Some(snapshot) = read_install_snapshot(dir) {
        let mut missing = 0usize;
        for file in snapshot.files.iter() {
            let target = dir.join(&file.path);
            match fs::metadata(&target) {
                Ok(meta) if meta.len() == file.size => {}
                _ => missing += 1,
            }
        }
        IntegrityReport {
            manifest_present: true,
            missing_files: missing,
            healthy: missing == 0,
        }
    } else {
        IntegrityReport {
            manifest_present: false,
            missing_files: 0,
            healthy: false,
        }
    }
}
/// Retourne true si le chemin d'entrée zip est sous Saves/ ou Save/ (ne jamais écraser les saves).
fn zip_path_is_saves(name: &str) -> bool {
    let parts: Vec<&str> = name.split(['\\', '/']).filter(|s| !s.is_empty()).collect();
    parts
        .iter()
        .any(|p| p.eq_ignore_ascii_case("saves") || p.eq_ignore_ascii_case("save"))
}

/// Copie récursivement src vers dst (crée dst si besoin). Ne supprime pas dst avant.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    if !src.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dst).context("create_dir for copy")?;
    for e in fs::read_dir(src).context("read_dir src")? {
        let e = e?;
        let path = e.path();
        let name = e.file_name();
        let out = dst.join(&name);
        if path.is_dir() {
            copy_dir_recursive(&path, &out)?;
        } else {
            fs::copy(&path, &out).context("copy file")?;
        }
    }
    Ok(())
}

fn is_save_folder_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("saves") || name.eq_ignore_ascii_case("save")
}

/// Tente path.strip_prefix(base), sinon canonicalize les deux (chemins Windows / casse).
fn strip_prefix_or_canonical(path: &Path, base: &Path) -> Result<PathBuf> {
    if let Ok(rel) = path.strip_prefix(base) {
        return Ok(rel.to_path_buf());
    }
    let pc = path.canonicalize().context("canonicalize (saves)")?;
    let bc = base.canonicalize().context("canonicalize base (saves)")?;
    pc.strip_prefix(&bc)
        .map(|p| p.to_path_buf())
        .map_err(|_| anyhow!("préfixe chemin saves"))
}

/// Crée `game_dir/Saves` si absent (le jeu s’y attend souvent même sans ZIP Saves).
fn ensure_saves_beside_exe(game_dir: &Path) -> Result<()> {
    let saves_beside_exe = game_dir.join("Saves");
    if !saves_beside_exe.exists() {
        fs::create_dir_all(&saves_beside_exe).context("création dossier Saves à côté de l’exe")?;
    }
    Ok(())
}

/// Restaure tous les dossiers nommés Saves/Save depuis `.pnw_backup` vers la nouvelle install.
/// - Sous le dossier parent de l’exe du backup : recopié au même chemin relatif sous `game_dir` (parent de l’exe actuel).
/// - Sinon (ex. Saves à la racine du backup alors que l’exe est dans un sous-dossier) : même chemin relatif depuis la racine du backup vers `install_root`.
/// - Si le backup ne contient aucun exe reconnu (dossier vide, coquille) : rien à copier (succès).
fn restore_saves_from_backup(
    backup_dir: &Path,
    install_root: &Path,
    game_dir: &Path,
) -> Result<()> {
    let Some(backup_exe) = find_game_exe_in_dir(backup_dir, 10) else {
        return ensure_saves_beside_exe(game_dir);
    };
    let backup_game = backup_exe
        .parent()
        .ok_or_else(|| anyhow!("chemin exécutable backup invalide"))?;

    let mut dirs: Vec<PathBuf> = Vec::new();
    for e in WalkDir::new(backup_dir)
        .follow_links(false)
        .max_depth(10)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            if is_save_folder_name(name) {
                dirs.push(p.to_path_buf());
            }
        }
    }
    dirs.sort_by_key(|p| p.components().count());

    for src in dirs {
        let dst = match strip_prefix_or_canonical(&src, backup_game) {
            Ok(rel) => game_dir.join(rel),
            Err(_) => {
                let rel = strip_prefix_or_canonical(&src, backup_dir)?;
                // Sauvegardes à la racine du backup (ex. `.pnw_backup/Saves`) alors que l’exe est dans
                // un sous-dossier : les fusionner à côté de l’exe (`game_dir/Saves`), pas sous
                // `install_root/Saves` où le jeu ne les lit pas.
                if rel.components().count() == 1 {
                    let leaf = rel
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("");
                    if is_save_folder_name(leaf) {
                        game_dir.join("Saves")
                    } else {
                        install_root.join(&rel)
                    }
                } else {
                    install_root.join(rel)
                }
            }
        };
        copy_dir_recursive(&src, &dst)
            .with_context(|| format!("copie des sauvegardes vers {}", dst.display()))?;
    }
    // Le ZIP peut ne créer aucun dossier Saves : garantir l’emplacement attendu par le jeu.
    ensure_saves_beside_exe(game_dir)
}

/// Sous-dossier de `save_backup` selon la langue du manifest (FR / anglais → AN).
fn save_backup_lang_subdir(game_lang: Option<&str>) -> &'static str {
    match game_lang {
        Some("en") => "save_backupAN",
        _ => "save_backupFR",
    }
}

/// Liste tous les dossiers nommés Saves/Save sous `root` (profondeur max 10).
fn collect_save_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for e in WalkDir::new(root)
        .follow_links(false)
        .max_depth(10)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
            if is_save_folder_name(name) {
                dirs.push(p.to_path_buf());
            }
        }
    }
    dirs.sort_by_key(|p| p.components().count());
    dirs
}

/// `base` = ex. `save_backup_21-03-2026` — si déjà pris, `base_2`, `base_3`, …
fn allocate_unique_child_folder(parent: &Path, base: &str) -> PathBuf {
    let first = parent.join(base);
    if !first.exists() {
        return first;
    }
    let mut n = 2u32;
    loop {
        let cand = parent.join(format!("{}_{}", base, n));
        if !cand.exists() {
            return cand;
        }
        n += 1;
        if n > 10_000 {
            return parent.join(format!("{}_{}", base, std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()));
        }
    }
}

/// Copie les dossiers Saves/Save de l’install actuelle vers
/// `%LOCALAPPDATA%\\PNW Launcher\\save_backup\\save_backupFR|save_backupAN\\save_backup_JJ-MM-AAAA[_N]\\`
/// — un seul dossier Saves : les fichiers vont **directement** dans le dossier daté (pas de sous-dossier dupliqué).
/// — plusieurs dossiers (Saves + Save, etc.) : sous-dossiers `save_backup_JJ-MM-AAAA_Saves`, `…_Save`, …
fn archive_saves_to_launcher_before_update(install_root: &Path, cfg: &Config) -> Result<()> {
    let save_dirs = collect_save_dirs(install_root);
    if save_dirs.is_empty() {
        return Ok(());
    }
    let launcher_data = app_local_dir().context("dossier données launcher")?;
    let lang_sub = save_backup_lang_subdir(cfg.game_lang.as_deref());
    let lang_root = launcher_data.join("save_backup").join(lang_sub);
    fs::create_dir_all(&lang_root).context("création save_backup/<lang>")?;

    let now = Local::now();
    let date_str = format!(
        "{:02}-{:02}-{:04}",
        now.day(),
        now.month(),
        now.year()
    );
    let outer_base = format!("save_backup_{}", date_str);
    let archive_root = allocate_unique_child_folder(&lang_root, &outer_base);
    fs::create_dir_all(&archive_root).context("création dossier archive daté")?;

    let inner_label = format!("save_backup_{}", date_str);
    let multiple = save_dirs.len() > 1;

    for src in save_dirs {
        let leaf = src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Saves");
        let dst = if multiple {
            archive_root.join(format!("{}_{}", inner_label, leaf))
        } else {
            archive_root.clone()
        };
        copy_dir_recursive(&src, &dst)
            .with_context(|| format!("archivage saves vers {}", dst.display()))?;
    }
    Ok(())
}

/// Si `dir` ne contient qu'un unique sous-dossier (et aucun fichier à la racine),
/// retourne ce sous-dossier. Sinon retourne `dir` inchangé.
/// Permet d'éviter l'imbrication quand le zip a un dossier racine unique.
fn unwrap_single_subfolder(dir: &Path) -> PathBuf {
    let entries: Vec<_> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return dir.to_path_buf(),
    };
    if entries.len() == 1 {
        let single = entries[0].path();
        if single.is_dir() {
            return single;
        }
    }
    dir.to_path_buf()
}

fn sanitize_zip_path(base: &Path, name: &str) -> PathBuf {
    let mut path = base.to_path_buf();
    for comp in name.split(['\\', '/']) {
        if comp == ".." || comp.contains(':') || comp.is_empty() {
            continue;
        }
        path.push(comp);
    }
    path
}
fn zip_url(m: &Manifest) -> &str {
    if !m.download_url.is_empty() {
        &m.download_url
    } else if !m.zip_url.is_empty() {
        &m.zip_url
    } else if !m.url.is_empty() {
        &m.url
    } else {
        ""
    }
}

/* ============== Commands ============== */
/// Taille déclarée par le serveur (HEAD Content-Length), si présente.
#[tauri::command]
fn cmd_http_head_content_length(url: String) -> Result<Option<u64>, String> {
    let url = url.trim();
    if url.is_empty() {
        return Ok(None);
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(errs)?;
    let resp = client
        .head(url)
        .header(USER_AGENT, "pnw-launcher")
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .map_err(errs)?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    Ok(resp
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok()))
}

#[tauri::command]
fn cmd_fetch_manifest(manifest_url: String) -> Result<Manifest, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(errs)?;
    Ok(client
        .get(manifest_url)
        .header(USER_AGENT, "pnw-launcher")
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(errs)?
        .json()
        .map_err(errs)?)
}

#[tauri::command]
fn cmd_fetch_launcher_update_info(url: String) -> Result<LauncherUpdateResponse, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(errs)?;
    let resp = client
        .get(url.trim())
        .header(USER_AGENT, "pnw-launcher")
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .map_err(errs)?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(resp.json().map_err(errs)?)
}

/// Recherche GTS complète en un seul appel : getPokemonList puis downloadWantedData × N.
/// Tourne dans un std::thread dédié pour éviter tout conflit avec le runtime async Tauri.
#[tauri::command]
fn cmd_gts_search(
    game_id: u32,
    species: u32,
    level_min: u32,
    level_max: u32,
    gender: i32,
) -> Result<String, String> {
    let handle = thread::spawn(move || -> Result<String, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(errs)?;

        let gts_post = |action: &str, params: &[(&str, String)]| -> Result<String, String> {
            let mut form: Vec<(&str, String)> = vec![("action", action.to_string())];
            form.extend(params.iter().map(|(k, v)| (*k, v.clone())));
            let resp = client
                .post(&base_url)
                .header(USER_AGENT, "pnw-launcher")
                .form(&form)
                .send()
                .map_err(errs)?;
            resp.text().map_err(errs)
        };

        let raw = gts_post("getPokemonList", &[
            ("id", "99999".into()),
            ("species", species.to_string()),
            ("levelMin", level_min.to_string()),
            ("levelMax", level_max.to_string()),
            ("gender", gender.to_string()),
        ])?;

        if raw.trim().is_empty() || raw.trim() == "nothing" {
            return Ok(json!({ "trades": [] }).to_string());
        }

        let ids: Vec<&str> = if raw.contains("/,,,/") {
            raw.split("/,,,/").collect()
        } else {
            raw.split(',').collect()
        };

        let mut trades = Vec::new();
        for id_str in ids.iter().take(30) {
            let id_str = id_str.trim();
            if id_str.is_empty() { continue; }
            let wanted_raw = match gts_post("downloadWantedData", &[("id", id_str.to_string())]) {
                Ok(v) => v,
                Err(_) => {
                    trades.push(json!({ "onlineId": id_str, "wanted": null }));
                    continue;
                }
            };
            if wanted_raw.trim().is_empty() {
                trades.push(json!({ "onlineId": id_str, "wanted": null }));
                continue;
            }
            let parts: Vec<i64> = wanted_raw
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            if parts.len() >= 4 {
                trades.push(json!({
                    "onlineId": id_str,
                    "wanted": {
                        "species": parts[0],
                        "levelMin": parts[1],
                        "levelMax": parts[2],
                        "gender": if parts[3] < 0 { 0 } else { parts[3] }
                    }
                }));
            } else {
                trades.push(json!({ "onlineId": id_str, "wanted": null }));
            }
        }

        Ok(json!({ "trades": trades }).to_string())
    });

    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

/// Blob Marshal du Pokémon déposé (`action=downloadPokemon`), texte brut (souvent base64 multiligne).
#[tauri::command]
fn cmd_gts_download_pokemon(game_id: u32, online_id: String) -> Result<String, String> {
    let handle = thread::spawn(move || -> Result<String, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(errs)?;
        let resp = client
            .post(&base_url)
            .header(USER_AGENT, "pnw-launcher")
            .form(&[("action", "downloadPokemon"), ("id", online_id.as_str())])
            .send()
            .map_err(errs)?;
        resp.text().map_err(errs)
    });
    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

/// Scan complet du GTS : parcourt toutes les espèces fournies pour lister les dépôts actifs.
/// Émet `pnw://gts-browse-progress` au fur et à mesure du scan.
#[tauri::command]
async fn cmd_gts_browse_all(
    app: AppHandle,
    game_id: u32,
    known_ids: Vec<u32>,
    last_max_id: u32,
    extra_ids: Vec<u32>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        use std::sync::{Arc, Mutex};

        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(errs)?;

        // Construire la liste d'IDs à vérifier
        let mut all_ids: Vec<u32> = if !known_ids.is_empty() && last_max_id > 0 {
            // Mode incrémental : re-vérifier les IDs connus + scanner au-delà du max
            let new_scan_end = last_max_id + 3000; // marge pour les nouveaux dépôts
            let mut ids = known_ids.clone();
            for id in (last_max_id + 1)..=new_scan_end {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
            eprintln!(
                "[GTS browse] Mode incrémental — {} IDs connus + scan {}..{} = {} IDs",
                known_ids.len(), last_max_id + 1, new_scan_end, ids.len()
            );
            ids
        } else {
            // Mode complet : scanner tout de 1 à 20000
            let max_id: u32 = 20000;
            eprintln!("[GTS browse] Mode complet — IDs 1 à {}", max_id);
            (1..=max_id).collect()
        };
        // Toujours inclure les IDs supplémentaires (propre dépôt, extras launcher)
        for &eid in &extra_ids {
            if eid > 0 && !all_ids.contains(&eid) {
                all_ids.push(eid);
            }
        }
        all_ids.sort();
        all_ids.dedup();

        let total = all_ids.len();
        let entries: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
        let scanned: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));

        eprintln!("[GTS browse] Démarrage — {} IDs à vérifier", total);

        for chunk in all_ids.chunks(50) {
            std::thread::scope(|s| {
                let handles: Vec<_> = chunk
                    .iter()
                    .map(|&id| {
                        let client = &client;
                        let base_url = &base_url;
                        let entries = Arc::clone(&entries);
                        let scanned = Arc::clone(&scanned);
                        s.spawn(move || {
                            let id_str = id.to_string();
                            // downloadWantedData pour vérifier si l'ID est actif
                            let wanted_form = [
                                ("action", "downloadWantedData"),
                                ("id", id_str.as_str()),
                            ];
                            let wanted = match client
                                .post(base_url)
                                .header(USER_AGENT, "pnw-launcher")
                                .form(&wanted_form)
                                .send()
                                .and_then(|r| r.text())
                            {
                                Ok(v) => v,
                                Err(_) => {
                                    let mut sc = scanned.lock().unwrap();
                                    *sc += 1;
                                    return;
                                }
                            };

                            let wanted_trimmed = wanted.trim();
                            if wanted_trimmed.is_empty() {
                                let mut sc = scanned.lock().unwrap();
                                *sc += 1;
                                return;
                            }

                            // Dépôt actif ! Télécharger aussi le blob Pokémon
                            let blob_form = [
                                ("action", "downloadPokemon"),
                                ("id", id_str.as_str()),
                            ];
                            let blob = client
                                .post(base_url)
                                .header(USER_AGENT, "pnw-launcher")
                                .form(&blob_form)
                                .send()
                                .and_then(|r| r.text())
                                .unwrap_or_default();

                            let parts: Vec<i64> = wanted_trimmed
                                .split(',')
                                .filter_map(|s| s.trim().parse().ok())
                                .collect();

                            let entry = if parts.len() >= 4 {
                                json!({
                                    "onlineId": id_str,
                                    "blob": blob.trim(),
                                    "wanted": {
                                        "species": parts[0],
                                        "levelMin": parts[1],
                                        "levelMax": parts[2],
                                        "gender": if parts[3] < 0 { 0 } else { parts[3] }
                                    }
                                })
                            } else {
                                json!({
                                    "onlineId": id_str,
                                    "blob": blob.trim(),
                                    "wanted": null
                                })
                            };

                            entries.lock().unwrap().push(entry);

                            let mut sc = scanned.lock().unwrap();
                            *sc += 1;
                        })
                    })
                    .collect();

                for h in handles {
                    let _ = h.join();
                }
            });

            // Émettre la progression après chaque batch
            let sc = *scanned.lock().unwrap();
            let found = entries.lock().unwrap().len();
            let _ = app.emit(
                "pnw://gts-browse-progress",
                json!({ "scanned": sc, "total": total, "found": found }),
            );
        }

        let final_entries = entries.lock().unwrap();
        eprintln!(
            "[GTS browse] Terminé — {} IDs vérifiés, {} dépôts actifs trouvés",
            total, final_entries.len()
        );
        Ok(json!({ "entries": *final_entries }).to_string())
    }).await.map_err(|e| format!("Le thread GTS browse a paniqué: {}", e))?
}

/// Ouvre une URL dans le navigateur par défaut.
/// Sous Windows, `open::that` (ShellExecute) peut échouer avec « Classe non enregistrée » (COM / antivirus) ;
/// `cmd /c start` est en général plus fiable.
fn open_http_url(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let status = Command::new("cmd")
            .args(["/C", "start", "", url])
            .status()
            .map_err(errs)?;
        return if status.success() {
            Ok(())
        } else {
            Err("Impossible d'ouvrir l'URL (navigateur par défaut)".into())
        };
    }
    #[cfg(not(windows))]
    {
        open::that(url).map_err(errs)
    }
}

#[tauri::command]
fn cmd_open_url(url: String) -> Result<(), String> {
    let t = url.trim();
    if !t.starts_with("https://") && !t.starts_with("http://") {
        return Err("URL invalide".into());
    }
    open_http_url(t)
}

fn launcher_update_dest_path() -> Result<PathBuf> {
    Ok(app_local_dir()?.join("pnw_launcher_update.exe"))
}

struct LauncherInstallerProgressWriter<'a> {
    app: &'a AppHandle,
    file: std::fs::File,
    downloaded: u64,
    total: u64,
    last_emit: Instant,
}

impl Write for LauncherInstallerProgressWriter<'_> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let n = self.file.write(buf)?;
        self.downloaded += n as u64;
        if self.last_emit.elapsed() >= Duration::from_millis(120)
            || (self.total > 0 && self.downloaded >= self.total)
        {
            let _ = self.app.emit(
                "pnw://launcher-update-progress",
                json!({
                    "stage": "download",
                    "downloaded": self.downloaded,
                    "total": self.total
                }),
            );
            self.last_emit = Instant::now();
        }
        Ok(n)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

/// Télécharge l’installateur dans AppData puis lance le fichier (mise à jour du launcher sans passer par le navigateur).
fn run_download_launcher_installer(app: &AppHandle, url: &str) -> Result<(), String> {
    let dest = launcher_update_dest_path().map_err(errs)?;
    if dest.exists() {
        let _ = fs::remove_file(&dest);
    }
    let _ = app.emit(
        "pnw://launcher-update-progress",
        json!({ "stage": "download", "downloaded": 0, "total": 0 }),
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(7200))
        .connect_timeout(Duration::from_secs(45))
        .build()
        .map_err(errs)?;
    let mut resp = client
        .get(url)
        .header(USER_AGENT, "pnw-launcher")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(errs)?;
    let total = resp.content_length().unwrap_or(0);
    let file = fs::File::create(&dest).map_err(errs)?;
    let mut writer = LauncherInstallerProgressWriter {
        app,
        file,
        downloaded: 0,
        total,
        last_emit: Instant::now() - Duration::from_secs(1),
    };
    copy(&mut resp, &mut writer).map_err(errs)?;
    writer.file.sync_all().map_err(errs)?;
    drop(writer);
    // Fermer l’UI **avant** de lancer l’installateur : sinon le WebView peut traiter l’événement en retard
    // ou la fenêtre NSIS capte le focus avant le `setState` côté React.
    let _ = app.emit(
        "pnw://launcher-update-progress",
        json!({
            "stage": "done",
            "path": dest.to_string_lossy(),
        }),
    );
    // Laisser le front traiter `done` (fermeture du modal) avant de quitter le processus.
    thread::sleep(Duration::from_millis(450));
    // Sous Windows : `start` lance l’installateur NSIS dans un processus détaché (pas enfant du launcher).
    // Sinon le setup peut rester bloqué ou ne pas pouvoir remplacer l’exe tant que le launcher tourne.
    #[cfg(windows)]
    {
        let path_str = dest.to_string_lossy().to_string();
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .spawn()
            .map_err(errs)?;
    }
    #[cfg(not(windows))]
    {
        open::that(&dest).map_err(errs)?;
    }
    thread::sleep(Duration::from_millis(200));
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn cmd_download_launcher_installer(app: AppHandle, url: String) -> Result<(), String> {
    let t = url.trim().to_string();
    if !t.starts_with("https://") && !t.starts_with("http://") {
        return Err("URL invalide".into());
    }
    let app_clone = app.clone();
    thread::spawn(move || {
        if let Err(e) = run_download_launcher_installer(&app_clone, &t) {
            let _ = app_clone.emit("pnw://launcher-update-error", json!({"error": e}));
        }
    });
    Ok(())
}

fn local_remembered_dir_has_game(path: Option<&String>) -> bool {
    let Some(s) = path else {
        return false;
    };
    if is_bad_install_path_hint(s) {
        return false;
    }
    let p = PathBuf::from(s);
    p.exists() && find_game_exe_in_dir(&p, 10).is_some()
}

/// Dossier où se trouvent l’exe, `.version` et `install_manifest.json` (aligné sur `run_download_and_install`).
fn game_content_root(install_dir: &Path) -> PathBuf {
    find_game_exe_in_dir(install_dir, 10)
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| install_dir.to_path_buf())
}

#[tauri::command]
fn cmd_get_install_info() -> Result<serde_json::Value, String> {
    let mut cfg = read_config();
    let mut dirty = false;

    // Nettoyer les slots qui pointent vers des dossiers supprimés.
    if let Some(ref p) = cfg.install_dir_en {
        if !p.is_empty() && !PathBuf::from(p).exists() {
            cfg.install_dir_en = None;
            dirty = true;
        }
    }
    if let Some(ref p) = cfg.install_dir_fr {
        if !p.is_empty() && !PathBuf::from(p).exists() {
            cfg.install_dir_fr = None;
            dirty = true;
        }
    }
    if dirty {
        let _ = write_config(&cfg);
    }

    let game_lang = cfg.game_lang.clone();
    let has_local_en = local_remembered_dir_has_game(cfg.install_dir_en.as_ref());
    let has_local_fr = local_remembered_dir_has_game(cfg.install_dir_fr.as_ref());

    if let Some(dir) = current_install_dir() {
        let has_exe = find_game_exe_in_dir(&dir, 10).is_some();
        let content_root = game_content_root(&dir);
        let ver = read_version(&content_root).ok();
        let has_version = ver.is_some();
        let integrity = check_install_integrity(&content_root);
        let has_integrity = if integrity.manifest_present {
            integrity.healthy
        } else {
            has_exe && has_version
        };
        let has_game = has_exe && has_version && has_integrity;
        return Ok(json!({
          "installDir":dir.to_string_lossy(),
          "version":ver,
          "hasExe":has_exe,
          "hasVersion":has_version,
          "hasIntegrity":has_integrity,
          "missingFiles":integrity.missing_files,
          "hasManifest":integrity.manifest_present,
          "hasGame":has_game,
          "gameLang":game_lang,
          "hasLocalEnInstall":has_local_en,
          "hasLocalFrInstall":has_local_fr,
        }));
    }
    Ok(json!({
      "installDir":"",
      "version":serde_json::Value::Null,
      "hasExe":false,
      "hasVersion":false,
      "hasIntegrity":false,
      "missingFiles":0,
      "hasManifest":false,
      "hasGame":false,
      "gameLang":game_lang,
      "hasLocalEnInstall":has_local_en,
      "hasLocalFrInstall":has_local_fr,
    }))
}
#[tauri::command]
fn cmd_set_default_install_dir() -> Result<serde_json::Value, String> {
    let dir = default_install_dir().map_err(errs)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(errs)?;
    }
    let mut cfg = read_config();
    let path_str = dir.to_string_lossy().to_string();
    cfg.install_dir = Some(path_str.clone());
    let gl_opt = cfg.game_lang.clone();
    if let Some(gl) = gl_opt.as_deref() {
        if gl == "fr" || gl == "en" {
            remember_install_dir_for_lang(&mut cfg, gl, &path_str);
        }
    }
    write_config(&cfg).map_err(errs)?;
    Ok(json!({"ok":true,"installDir":dir.to_string_lossy()}))
}
#[tauri::command]
fn cmd_set_install_dir(path: String, remember_for_lang: Option<String>) -> Result<serde_json::Value, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        fs::create_dir_all(&p).map_err(errs)?;
    }
    let mut cfg = read_config();
    let prev = cfg.install_dir.clone();
    if prev.as_deref() != Some(path.as_str()) {
        cfg.install_etag = None;
    }
    // Changer de dossier pour une autre piste alors que `game_lang` est encore l’ancienne :
    // mémoriser d’abord l’emplacement actif (ex. EN AppData) avant d’écraser `install_dir`.
    if let Some(ref t) = remember_for_lang {
        let tnorm = t.trim().to_lowercase();
        if (tnorm == "fr" || tnorm == "en") && cfg.game_lang.as_deref() != Some(tnorm.as_str()) {
            let gl_owned = cfg.game_lang.clone();
            if let Some(ref gl) = gl_owned {
                if gl == "fr" || gl == "en" {
                    if let Some(ref old_p) = prev {
                        if !old_p.is_empty() && !is_bad_install_path_hint(old_p) {
                            remember_install_dir_for_lang(&mut cfg, gl.as_str(), old_p);
                        }
                    }
                }
            }
        }
    }

    cfg.install_dir = Some(path.clone());

    // Quelle piste mémoriser pour le nouveau chemin (ou la langue courante si pas de hint).
    let gl_mem = if let Some(ref s) = remember_for_lang {
        let t = s.trim().to_lowercase();
        if t == "fr" || t == "en" {
            Some(t)
        } else {
            None
        }
    } else {
        None
    };
    let gl_mem = gl_mem.or_else(|| {
        cfg.game_lang
            .as_ref()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| s == "fr" || s == "en")
    });
    if let Some(gl) = gl_mem.as_deref() {
        // Anti-collision : vérifier que le nouveau chemin n'est pas identique au slot de l'autre langue.
        let other_slot = match gl {
            "en" => cfg.install_dir_fr.as_deref(),
            _    => cfg.install_dir_en.as_deref(),
        };
        let collides = other_slot.map_or(false, |os| {
            windows_paths_equivalent(Path::new(&path), Path::new(os))
        });
        if collides {
            return Err(format!(
                "Ce dossier est déjà utilisé par l'autre langue ({}). Choisissez un dossier différent.",
                if gl == "en" { "FR" } else { "EN" }
            ));
        }
        remember_install_dir_for_lang(&mut cfg, gl, &path);
    }
    write_config(&cfg).map_err(errs)?;
    Ok(json!({"ok":true,"installDir":path}))
}

/// Réinitialise l’ETag enregistré pour forcer un nouveau téléchargement du ZIP
/// (ex. réinstallation volontaire quand la version locale est plus récente que le manifeste).
#[tauri::command]
fn cmd_clear_install_etag() -> Result<serde_json::Value, String> {
    let mut cfg = read_config();
    cfg.install_etag = None;
    write_config(&cfg).map_err(errs)?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
fn cmd_set_game_lang(lang: String) -> Result<serde_json::Value, String> {
    let lang = lang.trim().to_lowercase();
    if lang != "fr" && lang != "en" {
        return Err("lang doit être fr ou en".into());
    }
    let mut cfg = read_config();
    let _ = migrate_install_dir_slots(&mut cfg);
    let prev = cfg.game_lang.as_deref();

    // Mémoriser le dossier pour la langue qu’on quitte (si pas déjà rempli — ex. déjà enregistré par `cmd_set_install_dir`).
    if let Some(pl) = prev {
        if (pl == "fr" || pl == "en") && pl != lang.as_str() {
            let slot = if pl == "fr" {
                &mut cfg.install_dir_fr
            } else {
                &mut cfg.install_dir_en
            };
            if slot.is_none() {
                if let Some(ref id) = cfg.install_dir {
                    if !is_bad_install_path_hint(id) {
                        *slot = Some(id.clone());
                    }
                }
            }
        }
    }

    let switching = prev != Some(lang.as_str());
    if switching {
        cfg.install_etag = None;
    }
    cfg.game_lang = Some(lang.clone());

    // Au changement de piste : restaurer le dernier dossier connu pour cette langue.
    // Anti-collision : ne jamais pointer sur le même dossier que l'autre langue.
    if switching {
        let other_lang = if lang == "en" { "fr" } else { "en" };
        let other_dir = match other_lang {
            "en" => cfg.install_dir_en.clone(),
            _    => cfg.install_dir_fr.clone(),
        };

        let candidate = remembered_dir_for_lang(&cfg, &lang)
            .map(|p| p.to_string_lossy().to_string())
            .or_else(|| default_install_dir_for_lang(&lang).ok().map(|p| p.to_string_lossy().to_string()));

        if let Some(ref cand) = candidate {
            // Vérifier que le candidat n'est pas le même dossier que l'autre langue
            let collides = other_dir.as_ref().map_or(false, |od| {
                windows_paths_equivalent(Path::new(cand), Path::new(od))
            });
            if collides {
                // Collision détectée → utiliser le dossier par défaut spécifique à la langue
                if let Ok(def) = default_install_dir_for_lang(&lang) {
                    let def_str = def.to_string_lossy().to_string();
                    cfg.install_dir = Some(def_str.clone());
                    remember_install_dir_for_lang(&mut cfg, &lang, &def_str);
                }
            } else {
                cfg.install_dir = Some(cand.clone());
            }
            cfg.install_etag = None;
        }
    }

    write_config(&cfg).map_err(errs)?;
    Ok(json!({"ok":true,"gameLang":lang}))
}
#[tauri::command]
fn cmd_download_and_install(
    app: AppHandle,
    state: State<AppState>,
    manifest: Manifest,
) -> Result<(), String> {
    let dl_arc: Arc<Mutex<DlInner>> = state.dl.clone();
    thread::spawn(move || {
        if let Err(e) = run_download_and_install(&app, &dl_arc, &manifest) {
            let _ = app.emit("pnw://error", json!({"error":e}));
        }
    });
    Ok(())
}
fn temp_zip_path() -> Result<PathBuf> {
    Ok(app_local_dir()?.join(TMP_ZIP_NAME))
}

/// Fichier temporaire par URL du ZIP : évite de reprendre un téléchargement partiel d’une autre version / autre lien.
fn temp_zip_path_for_url(url: &str) -> Result<PathBuf> {
    let mut h = DefaultHasher::new();
    url.hash(&mut h);
    Ok(app_local_dir()?.join(format!("pnw_tmp_{:x}.zip", h.finish())))
}

/// Supprime l’ancien nom unique (avant hash d’URL) pour ne pas laisser un zip partiel ambigu.
fn remove_legacy_temp_zip_if_present() {
    if let Ok(p) = temp_zip_path() {
        if p.exists() {
            let _ = fs::remove_file(p);
        }
    }
}

/// Supprime le préfixe UNC Windows (\\?\) pour la comparaison de chemins.
fn strip_unc(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") {
        PathBuf::from(&s[4..])
    } else {
        p.to_path_buf()
    }
}

/// Retourne l'espace disque disponible (octets) pour le volume contenant `path`, ou None.
fn available_space_for_path(path: &Path) -> Option<u64> {
    let canonical = path.canonicalize().ok().unwrap_or_else(|| path.to_path_buf());
    let clean = strip_unc(&canonical);
    let disks = Disks::new_with_refreshed_list();
    let mut best: Option<(u64, usize)> = None;
    for disk in disks.list() {
        let mount = strip_unc(disk.mount_point());
        if clean.starts_with(&mount) {
            let len = mount.as_os_str().len();
            if best.map(|(_, l)| l < len).unwrap_or(true) {
                best = Some((disk.available_space(), len));
            }
        }
    }
    best.map(|(bytes, _)| bytes)
}

/// Vérifie si l'espace disque est suffisant pour la mise à jour (zip + staging + backup).
/// Retourne un JSON avec ok, message et les Go disponibles/requis.
#[tauri::command]
fn cmd_check_disk_space_for_update(manifest: Manifest) -> Result<serde_json::Value, String> {
    let link = zip_url(&manifest).to_string();
    if link.is_empty() {
        return Ok(json!({
            "ok": true,
            "requiredGb": null,
            "availableTempGb": null,
            "availableInstallGb": null,
            "message": "",
        }));
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(errs)?;
    let content_length: u64 = client
        .head(&link)
        .header(USER_AGENT, "pnw-launcher")
        .send()
        .ok()
        .and_then(|r| r.headers().get(CONTENT_LENGTH).and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok()))
        .unwrap_or(0);
    let zip_bytes = content_length.max(100_000_000); // au moins 100 Mo si HEAD échoue
    let required_install_bytes = zip_bytes * 3; // zip décompressé + staging + backup
    let required_temp_bytes = zip_bytes;

    let tmp_path = temp_zip_path_for_url(&link).map_err(errs)?;
    let temp_dir = tmp_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| tmp_path.clone());
    let mut cfg_disk = read_config();
    let install_root = normalize_game_install_root(&mut cfg_disk)?;
    let install_parent = install_root.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| install_root.clone());

    let available_temp = available_space_for_path(&temp_dir).unwrap_or(0);
    let available_install = available_space_for_path(&install_parent).unwrap_or(0);

    let to_gb = |b: u64| (b as f64) / 1_073_741_824.0;
    let available_temp_gb = to_gb(available_temp);
    let available_install_gb = to_gb(available_install);
    let required_temp_gb = to_gb(required_temp_bytes);
    let required_install_gb = to_gb(required_install_bytes);

    let ok_temp = available_temp >= required_temp_bytes;
    let ok_install = available_install >= required_install_bytes;
    let ok = ok_temp && ok_install;

    let message = if ok {
        String::new()
    } else if !ok_temp && !ok_install {
        format!(
            "Espace disque insuffisant. Environ {:.1} Go requis (dossier temporaire et installation), {:.1} Go et {:.1} Go disponibles. Libérez de l'espace puis réessayez.",
            required_temp_gb.max(required_install_gb),
            available_temp_gb,
            available_install_gb
        )
    } else if !ok_temp {
        format!(
            "Espace disque insuffisant sur le lecteur du dossier temporaire. Environ {:.1} Go requis, {:.1} Go disponibles. Libérez de l'espace puis réessayez.",
            required_temp_gb, available_temp_gb
        )
    } else {
        format!(
            "Espace disque insuffisant sur le lecteur d'installation. Environ {:.1} Go requis, {:.1} Go disponibles. Libérez de l'espace puis réessayez.",
            required_install_gb, available_install_gb
        )
    };

    Ok(json!({
        "ok": ok,
        "requiredGb": (required_temp_gb.max(required_install_gb) * 10.0).round() / 10.0,
        "availableTempGb": (available_temp_gb * 10.0).round() / 10.0,
        "availableInstallGb": (available_install_gb * 10.0).round() / 10.0,
        "message": message,
    }))
}
fn run_download_and_install(
    app: &AppHandle,
    dl: &Arc<Mutex<DlInner>>,
    manifest: &Manifest,
) -> Result<(), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(errs)?;
    let link = zip_url(manifest).to_string();
    if link.is_empty() {
        return Err("Manifest sans URL".into());
    }
    remove_legacy_temp_zip_if_present();
    let tmp_path = temp_zip_path_for_url(&link).map_err(errs)?;
    if let Some(p) = tmp_path.parent() {
        if !p.exists() {
            fs::create_dir_all(p).map_err(errs)?;
        }
    }
    let mut downloaded: u64 = if tmp_path.exists() {
        fs::metadata(&tmp_path).map_err(errs)?.len()
    } else {
        0
    };
    let mut total: u64 = 0;
    let mut cfg = read_config();
    let original_etag = cfg.install_etag.clone();
    let install_root = normalize_game_install_root(&mut cfg)?;
    let original_install_dir = cfg.install_dir.clone();
    let target_parent = install_root
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| install_root.clone());
    if !target_parent.exists() {
        fs::create_dir_all(&target_parent).map_err(errs)?;
    }
    {
        let mut s = dl.lock().unwrap();
        s.cancel = false;
        s.paused = false;
        s.window.clear();
        s.started = Some(Instant::now());
        s.tmp_path = Some(tmp_path.clone());
        s.downloaded = downloaded;
        s.total = 0;
        s.window.push((Instant::now(), downloaded));
    }

    let mut etag: Option<String> = None;
    if let Ok(head) = client
        .head(&link)
        .header(USER_AGENT, "pnw-launcher")
        .header(ACCEPT_ENCODING, "identity")
        .send()
    {
        if let Some(v) = head
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
        {
            total = v;
        }
        if let Some(v) = head.headers().get("ETag") {
            etag = v.to_str().ok().map(|s| s.trim_matches('"').to_string());
        }
    }
    let _ = app.emit(
        "pnw://progress",
        json!({"stage":"download","total":total,"downloaded":downloaded}),
    );

    if let (Some(ref et), Some(existing_dir)) =
        (etag.as_ref(), cfg.install_dir.as_ref().map(PathBuf::from))
    {
        if cfg.install_etag.as_ref() == Some(et) {
            let content_root = game_content_root(&existing_dir);
            let report = check_install_integrity(&content_root);
            if report.manifest_present && report.healthy {
                write_version(&content_root, &manifest.version).map_err(errs)?;
                write_install_snapshot(&content_root).map_err(errs)?;
                cfg.install_etag = Some(et.to_string());
                write_config(&cfg).map_err(errs)?;
                if tmp_path.exists() {
                    let _ = fs::remove_file(&tmp_path);
                }
                let _ = app.emit("pnw://progress", json!({"stage":"done","reused":true}));
                return Ok(());
            }
        }
    }

    // Si l'ETag serveur diffère de l'ETag enregistré (ou ETag config effacé par forceReinstall),
    // le fichier temp est potentiellement périmé (ex. downgrade) — on le supprime.
    if let Some(ref et) = etag {
        if cfg.install_etag.as_ref() != Some(et) && downloaded > 0 {
            let _ = fs::remove_file(&tmp_path);
            downloaded = 0;
        }
    }

    let mut attempt = 0usize;
    loop {
        if dl.lock().unwrap().cancel {
            return Err("annulé".into());
        }
        while dl.lock().unwrap().paused {
            let _ = app.emit("pnw://progress", json!({"stage":"paused"}));
            thread::sleep(Duration::from_millis(200));
            if dl.lock().unwrap().cancel {
                return Err("annulé".into());
            }
        }
        let mut req = client
            .get(&link)
            .header(USER_AGENT, "pnw-launcher")
            .header(ACCEPT_ENCODING, "identity");
        if downloaded > 0 {
            req = req.header(RANGE, format!("bytes={}-", downloaded));
            if let Some(et) = &etag {
                req = req.header(IF_RANGE, et.clone());
            }
        }
        let mut resp = match req.send() {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit("pnw://progress", json!({"stage":"reconnect"}));
                attempt += 1;
                if attempt > MAX_ATTEMPTS {
                    return Err(format!("échec réseau: {e}"));
                }
                thread::sleep(Duration::from_secs((2u64.pow(attempt as u32)).min(30)));
                continue;
            }
        };

        let status = resp.status();

        // 416 : plage invalide — souvent fichier déjà entier (Content-Range: bytes */taille)
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            if let Some(cr) = resp
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
            {
                if let Some(t) = parse_total_from_content_range(cr) {
                    total = t;
                    if total > 0 && downloaded >= total {
                        let _ = copy(&mut resp, &mut std::io::sink()).map_err(errs)?;
                        break;
                    }
                }
            }
            let _ = copy(&mut resp, &mut std::io::sink()).ok();
            let _ = fs::remove_file(&tmp_path);
            downloaded = 0;
            attempt += 1;
            if attempt > MAX_ATTEMPTS {
                return Err("échec après plusieurs tentatives (416)".into());
            }
            thread::sleep(Duration::from_secs((2u64.pow(attempt as u32)).min(30)));
            continue;
        }

        if !status.is_success() {
            let _ = copy(&mut resp, &mut std::io::sink()).ok();
            return Err(format!("HTTP {} lors du téléchargement", status));
        }

        // Reprise partielle : le serveur doit répondre 206. Un 200 renvoie tout le fichier — ne pas concaténer.
        let mut append_mode = downloaded > 0 && status == StatusCode::PARTIAL_CONTENT;
        if downloaded > 0 && status == StatusCode::OK {
            downloaded = 0;
            append_mode = false;
        }

        if let Some(v) = resp
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
        {
            if let Some(t) = parse_total_from_content_range(v) {
                total = t;
            }
        } else if let Some(v) = resp
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
        {
            if downloaded == 0 {
                total = v;
            }
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(append_mode)
            .write(true)
            .truncate(!append_mode)
            .open(&tmp_path)
            .map_err(errs)?;
        let mut buf = vec![0u8; 64 * 1024];
        let mut last_tick = Instant::now();
        loop {
            if dl.lock().unwrap().cancel {
                return Err("annulé".into());
            }
            while dl.lock().unwrap().paused {
                let _ = app.emit("pnw://progress", json!({"stage":"paused"}));
                thread::sleep(Duration::from_millis(150));
                if dl.lock().unwrap().cancel {
                    return Err("annulé".into());
                }
            }
            let n = resp.read(&mut buf).map_err(errs)?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(errs)?;
            downloaded += n as u64;
            {
                let mut s = dl.lock().unwrap();
                s.downloaded = downloaded;
                s.total = total;
                s.window.push((Instant::now(), downloaded));
                while s.window.len() > 30 {
                    s.window.remove(0);
                }
                let (speed_bps, eta_secs) = window_speed_eta(&s.window, downloaded, total);
                if last_tick.elapsed() >= Duration::from_millis(150) {
                    last_tick = Instant::now();
                    let _=app.emit("pnw://progress",json!({"stage":"download","downloaded":downloaded,"total":total,"speed_bps":speed_bps,"eta_secs":eta_secs}));
                }
            }
            if total > 0 && downloaded >= total {
                break;
            }
        }
        if total > 0 && downloaded >= total {
            break;
        }
        attempt += 1;
        if attempt > MAX_ATTEMPTS {
            return Err("échec après plusieurs tentatives".into());
        }
        thread::sleep(Duration::from_secs((2u64.pow(attempt as u32)).min(30)));
    }

    // Extraction
    let staging_dir = target_parent.join(".pnw_staging");
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).map_err(errs)?;
    }
    fs::create_dir_all(&staging_dir).map_err(errs)?;
    let file = match std::fs::File::open(&tmp_path) {
        Ok(f) => f,
        Err(e) => {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("Impossible d'ouvrir le zip : {e}"));
        }
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "Archive corrompue (supprimée, relancez la mise à jour) : {e}"
            ));
        }
    };
    let total_entries = archive.len();
    let mut last_extract_emit = std::time::Instant::now();
    let _ = app.emit("pnw://progress", json!({"stage":"extract","extracted":0,"total":total_entries}));
    let extract_result: Result<(), String> = (|| {
        for i in 0..total_entries {
            let mut f = archive.by_index(i).map_err(errs)?;
            let name_owned = f.name().to_string();
            if zip_path_is_saves(&name_owned) {
                if last_extract_emit.elapsed() >= Duration::from_millis(100) || i + 1 == total_entries {
                    let _ = app.emit("pnw://progress", json!({"stage":"extract","extracted":i+1,"total":total_entries}));
                    last_extract_emit = std::time::Instant::now();
                }
                continue;
            }
            let outpath = sanitize_zip_path(&staging_dir, &name_owned);
            if name_owned.ends_with('/') {
                fs::create_dir_all(&outpath).map_err(errs)?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).map_err(errs)?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath).map_err(errs)?;
                std::io::copy(&mut f, &mut outfile).map_err(errs)?;
            }
            if last_extract_emit.elapsed() >= Duration::from_millis(100) || i + 1 == total_entries {
                let _ = app.emit("pnw://progress", json!({"stage":"extract","extracted":i+1,"total":total_entries}));
                last_extract_emit = std::time::Instant::now();
            }
        }
        Ok(())
    })();
    if let Err(e) = extract_result {
        let _ = fs::remove_dir_all(&staging_dir);
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "Extraction échouée (archive supprimée, relancez la mise à jour) : {e}"
        ));
    }
    let _ = fs::remove_file(&tmp_path);

    // Si le zip contient un unique sous-dossier racine (ex. "PNW 0.6 Open Beta/"),
    // on "déballe" ce dossier pour éviter l'imbrication.
    let effective_staging = unwrap_single_subfolder(&staging_dir);

    if find_game_exe_in_dir(&effective_staging, 10).is_none() {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err("Exécutable introuvable après extraction".into());
    }

    // Copie des Saves vers %LOCALAPPDATA%\\PNW Launcher\\save_backup\\… avant remplacement de l’install
    if install_root.exists() {
        if let Err(e) = archive_saves_to_launcher_before_update(&install_root, &cfg) {
            let _ = app.emit(
                "pnw://save-backup-warning",
                json!({"warning": e.to_string()}),
            );
        }
    }

    let backup_dir = target_parent.join(".pnw_backup");
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir).map_err(errs)?;
    }
    if install_root.exists() {
        // Ne renommer en `.pnw_backup` que s’il y avait une vraie install (exe reconnu).
        // Sinon (dossier `Game` vide ou coquille avant 1ère install) : le supprimer pour libérer le nom.
        if find_game_exe_in_dir(&install_root, 10).is_some() {
            fs::rename(&install_root, &backup_dir).map_err(errs)?;
        } else {
            let _ = fs::remove_dir_all(&install_root);
        }
    }
    if let Err(e) = fs::rename(&effective_staging, &install_root) {
        let _ = fs::remove_dir_all(&staging_dir);
        let _ = fs::remove_dir_all(&effective_staging);
        restore_from_backup(&install_root, &backup_dir);
        return Err(errs(e));
    }
    // Nettoyage de la coquille staging restante (si on a déballé un sous-dossier)
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }

    let exe = find_game_exe_in_dir(&install_root, 10)
        .ok_or_else(|| "Exécutable introuvable après extraction".to_string())?;
    let game_dir = exe.parent().unwrap_or(&install_root).to_path_buf();
    if backup_dir.exists() {
        if let Err(e) = restore_saves_from_backup(&backup_dir, &install_root, &game_dir) {
            restore_from_backup(&install_root, &backup_dir);
            return Err(format!(
                "Échec restauration des sauvegardes : {}. L'installation précédente a été restaurée.",
                e
            ));
        }
    }
    if let Err(e) = write_version(&game_dir, &manifest.version) {
        restore_from_backup(&install_root, &backup_dir);
        cfg.install_dir = original_install_dir.clone();
        cfg.install_etag = original_etag.clone();
        let _ = write_config(&cfg);
        return Err(errs(e));
    }
    if let Err(e) = write_install_snapshot(&game_dir) {
        restore_from_backup(&install_root, &backup_dir);
        cfg.install_dir = original_install_dir.clone();
        cfg.install_etag = original_etag.clone();
        let _ = write_config(&cfg);
        return Err(errs(e));
    }

    let gd_str = game_dir.to_string_lossy().to_string();
    cfg.install_dir = Some(gd_str.clone());
    cfg.install_etag = etag.clone();
    let gl_opt = cfg.game_lang.clone();
    if let Some(gl) = gl_opt.as_deref() {
        if gl == "fr" || gl == "en" {
            remember_install_dir_for_lang(&mut cfg, gl, &gd_str);
        }
    }
    if let Err(e) = write_config(&cfg) {
        restore_from_backup(&install_root, &backup_dir);
        cfg.install_dir = original_install_dir;
        cfg.install_etag = original_etag;
        let _ = write_config(&cfg);
        return Err(errs(e));
    }

    if backup_dir.exists() {
        let _ = fs::remove_dir_all(&backup_dir);
    }

    let _ = app.emit("pnw://progress", json!({"stage":"done"}));
    Ok(())
}

#[tauri::command]
fn cmd_pause_download(state: State<AppState>) -> Result<(), String> {
    if let Ok(mut s) = state.dl.lock() {
        s.paused = true;
    }
    Ok(())
}
#[tauri::command]
fn cmd_resume_download(state: State<AppState>) -> Result<(), String> {
    if let Ok(mut s) = state.dl.lock() {
        s.paused = false;
    }
    Ok(())
}
#[tauri::command]
fn cmd_cancel_download(state: State<AppState>) -> Result<(), String> {
    if let Ok(mut s) = state.dl.lock() {
        s.cancel = true;
    }
    Ok(())
}

#[tauri::command]
fn cmd_append_log(level: String, message: String) -> Result<(), String> {
    let path = log_file_path().map_err(errs)?;
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("[{}] [{}] {}\n", timestamp, level, message);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(errs)?;
    file.write_all(line.as_bytes()).map_err(errs)?;
    Ok(())
}

/* ============== Discord Rich Presence ============== */
/// kind: "menu" | "game" | "map" | "battle"
/// start_timestamp_secs: optionnel, pour afficher "Jouer depuis X" (temps de jeu)
/// details: optionnel, 2e ligne (ex. "Sacha • #01234 | Pokédex: 42 vus, 38 capturés | 12 h 30")
fn discord_build_activity(
    kind: &str,
    start_timestamp_secs: Option<u64>,
    details: Option<&str>,
    state_override: Option<&str>,
    small_text: Option<&str>,
) -> Activity {
    let (default_state, large_image_key) = match kind {
        "game" => ("En jeu", "logojeu"),
        "map" => ("À l'aventure", "logojeu"),
        "battle" => ("En combat", "logojeu"),
        _ => ("Dans le menu", "logo_2_0"),
    };
    let state_label = state_override.unwrap_or(default_state);
    let small_text_val = small_text.unwrap_or("Pokemon New World");
    let mut act = Activity::new()
        .state(state_label)
        .assets(|a| a.large_image(large_image_key).large_text("Pokemon New World").small_image("pp1").small_text(small_text_val))
        .append_buttons(|b| b.label("Télécharger le jeu").url(PNW_DOWNLOAD_PAGE_URL))
        .append_buttons(|b| b.label("Rejoindre le Discord").url(DISCORD_INVITE_URL));
    act.name = Some("Pokemon New World".to_string());
    if let Some(d) = details {
        act.details = Some(d.to_string());
    }
    if let Some(ts) = start_timestamp_secs {
        act.timestamps = Some(ActivityTimestamps::new().start(ts));
    }
    act
}

/// Chemin du fichier d'état écrit par le script Ruby PNW_LauncherBridge
fn game_state_path() -> Option<PathBuf> {
    app_local_dir().ok().map(|d| d.join("game_state.json"))
}

/// Données de zones chargées depuis les fichiers du jeu
struct ZoneData {
    map_to_panel: std::collections::HashMap<u32, u32>,
    zone_names: Vec<String>,
}

impl ZoneData {
    fn load(game_root: &Path) -> Option<Self> {
        let map_to_panel = psdk_data2::read_map_to_zone(game_root).ok()?;
        let zone_names = psdk_data2::read_french_zone_names(game_root).ok()?;
        Some(Self { map_to_panel, zone_names })
    }

    fn zone_name_for_map(&self, map_id: u32) -> Option<&str> {
        let panel_id = self.map_to_panel.get(&map_id)?;
        let name = self.zone_names.get(*panel_id as usize)?;
        if name.is_empty() { None } else { Some(name.as_str()) }
    }
}

/// Lit le game_state.json et retourne le JSON brut pour le dashboard live.
/// Lit le fichier .trade_evolutions.json (caché) écrit par le bridge du jeu.
#[tauri::command]
fn cmd_read_trade_evolutions() -> Result<Option<String>, String> {
    let path = app_local_dir().map_err(errs)?.join(".trade_evolutions.json");
    if !path.is_file() { return Ok(None); }
    fs::read_to_string(&path).map(Some).map_err(errs)
}

/// Lit le game_state.json et retourne le JSON brut pour le dashboard live.
/// Retourne None si le fichier est absent, inactif ou stale (> 10s).
#[tauri::command]
fn cmd_read_game_state() -> Option<serde_json::Value> {
    let path = game_state_path()?;
    let content = fs::read_to_string(&path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;
    if v.get("active").and_then(|a| a.as_bool()) != Some(true) {
        return None;
    }
    if let Some(ts) = v.get("timestamp").and_then(|t| t.as_u64()) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if now.saturating_sub(ts) > 10 {
            return None;
        }
    }
    Some(v)
}

/// Lit le game_state.json et construit le kind + details pour le Rich Presence
/// Retourne (kind, details, state_override, small_text)
fn read_game_state_for_presence(path: &Path, zones: Option<&ZoneData>) -> Option<(String, String, Option<String>, Option<String>)> {
    let content = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;

    // Vérifier que le jeu est actif
    if v.get("active").and_then(|a| a.as_bool()) != Some(true) {
        return None;
    }

    // Vérifier que le timestamp n'est pas trop ancien (> 10s = jeu probablement fermé)
    if let Some(ts) = v.get("timestamp").and_then(|t| t.as_u64()) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if now.saturating_sub(ts) > 10 {
            return None;
        }
    }

    let in_battle = v.get("in_battle").and_then(|b| b.as_bool()).unwrap_or(false);
    let trainer_name = v.get("trainer_name").and_then(|t| t.as_str()).unwrap_or("");
    // Résoudre le nom de zone : priorité au map_name du JSON (écrit par le script Ruby),
    // fallback sur la résolution map_id -> panel_id -> zone_names depuis les data files
    let map_name_from_json = v.get("map_name").and_then(|m| m.as_str()).unwrap_or("");
    let resolved_zone = if !map_name_from_json.is_empty() {
        map_name_from_json
    } else {
        let map_id = v.get("map_id").and_then(|m| m.as_u64()).unwrap_or(0) as u32;
        zones
            .and_then(|z| z.zone_name_for_map(map_id))
            .unwrap_or("")
    };

    let kind = if in_battle { "battle" } else if !resolved_zone.is_empty() { "map" } else { "game" };

    // Small text : "Pseudo · X ¥"
    let money = v.get("money").and_then(|m| m.as_u64());
    let small_text = if !trainer_name.is_empty() {
        if let Some(m) = money {
            Some(format!("{} · {} ¥", trainer_name, m))
        } else {
            Some(trainer_name.to_string())
        }
    } else {
        None
    };

    if in_battle {
        let is_trainer_battle = v.get("is_trainer_battle").and_then(|b| b.as_bool()).unwrap_or(false);

        // Pokémon allié actif (bank 0)
        let ally_name = v.get("battle_ally")
            .and_then(|a| a.get("species"))
            .and_then(|s| s.as_str())
            .unwrap_or("");

        // Premier Pokémon adverse
        let foe_name = v.get("battle_foes")
            .and_then(|f| f.as_array())
            .and_then(|arr| arr.first())
            .and_then(|f| f.get("species"))
            .and_then(|s| s.as_str())
            .unwrap_or("");

        // Ligne details : "Phasmidalle vs Ratentif"
        let details = if !ally_name.is_empty() && !foe_name.is_empty() {
            format!("{} vs {}", ally_name, foe_name)
        } else if !ally_name.is_empty() {
            ally_name.to_string()
        } else if !foe_name.is_empty() {
            format!("vs {}", foe_name)
        } else {
            String::new()
        };

        // Ligne state : "En combat sauvage" ou "En combat vs <dresseur>"
        let state_line = if is_trainer_battle {
            let trainer_battle_names: Vec<&str> = v.get("trainer_battle_names")
                .and_then(|a| a.as_array())
                .map(|arr| arr.iter().filter_map(|n| n.as_str()).collect())
                .unwrap_or_default();
            if !trainer_battle_names.is_empty() {
                format!("En combat vs {}", trainer_battle_names.join(" & "))
            } else {
                "En combat dresseur".into()
            }
        } else {
            "En combat sauvage".into()
        };

        Some((kind.to_string(), details, Some(state_line), small_text))
    } else {
        // Hors combat : "Trainer · Zone"
        let mut parts: Vec<String> = Vec::new();
        if !trainer_name.is_empty() {
            parts.push(trainer_name.to_string());
        }
        if !resolved_zone.is_empty() {
            parts.push(resolved_zone.to_string());
        }
        let details = parts.join(" · ");
        Some((kind.to_string(), details, None, small_text))
    }
}

fn discord_set_presence(
    client: &mut DiscordClient,
    kind: &str,
    start_timestamp_secs: Option<u64>,
    details: Option<&str>,
    state_override: Option<&str>,
    small_text: Option<&str>,
) -> Result<(), String> {
    let activity = discord_build_activity(kind, start_timestamp_secs, details, state_override, small_text);
    // Retry jusqu'à 3 fois avec délai si la connexion n'est pas encore établie
    for attempt in 0..3 {
        match client.set_activity(|_| activity.clone()) {
            Ok(_) => return Ok(()),
            Err(e) => {
                if attempt < 2 {
                    thread::sleep(Duration::from_millis(500));
                } else {
                    return Err(errs(e));
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn cmd_discord_set_presence(
    state: State<AppState>,
    kind: String,
    start_timestamp_secs: Option<u64>,
    details: Option<String>,
) -> Result<(), String> {
    if let Ok(mut client) = state.discord.lock() {
        discord_set_presence(
            &mut *client,
            &kind,
            start_timestamp_secs,
            details.as_deref(),
            None,
            None,
        )?;
    }
    Ok(())
}

#[tauri::command]
fn cmd_launch_game(
    app: AppHandle,
    state: State<AppState>,
    _exe_name: String,
) -> Result<(), String> {
    let dir = current_install_dir().ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let exe =
        find_game_exe_in_dir(&dir, 2).ok_or_else(|| "Exécutable PNW introuvable".to_string())?;
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        use std::sync::atomic::{AtomicBool, Ordering};

        let mut child = Command::new(&exe).current_dir(&dir).spawn().map_err(errs)?;
        let game_running = Arc::new(AtomicBool::new(true));

        // Thread d'attente de fin de jeu
        let discord_exit = state.discord.clone();
        let app_handle = app.clone();
        let game_running_flag = game_running.clone();
        thread::spawn(move || {
            let _ = child.wait();
            game_running_flag.store(false, Ordering::SeqCst);
            if let Ok(mut client) = discord_exit.lock() {
                let _ = discord_set_presence(&mut *client, "menu", None, None, None, None);
            }
            let _ = app_handle.emit("pnw://game-exited", ());
            // Nettoyer le fichier d'état
            if let Some(p) = game_state_path() {
                let _ = fs::remove_file(p);
            }
        });

        let start_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if let Ok(mut client) = state.discord.lock() {
            let _ = discord_set_presence(&mut *client, "game", Some(start_ts), None, None, None);
        }

        // Thread de polling du game_state.json pour Rich Presence en temps réel
        let discord_poll = state.discord.clone();
        let game_dir = dir.clone();
        thread::spawn(move || {
            let state_path = match game_state_path() {
                Some(p) => p,
                None => return,
            };
            let mut last_details = String::new();
            let mut last_kind = String::from("game");

            // Charger les données de zones depuis les fichiers du jeu
            let zone_data = ZoneData::load(&game_dir);

            // Attendre un peu que le jeu démarre
            thread::sleep(Duration::from_secs(5));

            let mut last_state_override: Option<String> = None;
            let mut last_small_text: Option<String> = None;
            while game_running.load(Ordering::SeqCst) {
                if let Some((kind, details, state_ov, sm_text)) = read_game_state_for_presence(&state_path, zone_data.as_ref()) {
                    // Ne mettre à jour que si l'état a changé
                    if kind != last_kind || details != last_details || state_ov != last_state_override || sm_text != last_small_text {
                        if let Ok(mut client) = discord_poll.lock() {
                            let _ = discord_set_presence(
                                &mut *client,
                                &kind,
                                Some(start_ts),
                                if details.is_empty() { None } else { Some(&details) },
                                state_ov.as_deref(),
                                sm_text.as_deref(),
                            );
                        }
                        last_kind = kind;
                        last_details = details;
                        last_state_override = state_ov;
                        last_small_text = sm_text;
                    }
                }
                thread::sleep(Duration::from_secs(3));
            }
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        Command::new(&exe).current_dir(&dir).spawn().map_err(errs)?;
    }
    Ok(())
}

/* Saves */
fn is_in_saves_dir(path: &Path) -> bool {
    path.ancestors().any(|a| {
        a.file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.eq_ignore_ascii_case("saves") || n.eq_ignore_ascii_case("save"))
            .unwrap_or(false)
    })
}
const SKIP_SAVE_EXTS: &[&str] = &[
    ".yml", ".yaml", ".json", ".txt", ".ini", ".log", ".md", ".cfg", ".xml", ".toml", ".bak",
];
fn is_candidate_save(name: &str, size: u64) -> bool {
    if size < 512 { return false; }
    let lower = name.to_ascii_lowercase();
    for ext in SKIP_SAVE_EXTS {
        if lower.ends_with(ext) { return false; }
    }
    true
}
fn natord_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek(), bi.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            _ => {}
        }
        let ac = *ai.peek().unwrap();
        let bc = *bi.peek().unwrap();
        if ac.is_ascii_digit() && bc.is_ascii_digit() {
            let mut an = 0u64;
            while ai.peek().map_or(false, |c| c.is_ascii_digit()) {
                an = an * 10 + ai.next().unwrap().to_digit(10).unwrap() as u64;
            }
            let mut bn = 0u64;
            while bi.peek().map_or(false, |c| c.is_ascii_digit()) {
                bn = bn * 10 + bi.next().unwrap().to_digit(10).unwrap() as u64;
            }
            match an.cmp(&bn) {
                std::cmp::Ordering::Equal => continue,
                o => return o,
            }
        }
        match ac.to_ascii_lowercase().cmp(&bc.to_ascii_lowercase()) {
            std::cmp::Ordering::Equal => { ai.next(); bi.next(); }
            o => return o,
        }
    }
}
fn all_saves_in_dir(game_dir: &Path) -> Vec<(PathBuf, std::fs::Metadata)> {
    let mut saves = Vec::new();
    for e in WalkDir::new(game_dir)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = e.path();
        if !p.is_file() { continue; }
        if !is_in_saves_dir(p) { continue; }
        let meta = match p.metadata().ok() {
            Some(m) => m,
            None => continue,
        };
        let name = match p.file_name().and_then(|x| x.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !is_candidate_save(name, meta.len()) { continue; }
        saves.push((p.to_path_buf(), meta));
    }
    saves.sort_by(|a, b| {
        let na = a.0.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let nb = b.0.file_name().and_then(|n| n.to_str()).unwrap_or("");
        natord_cmp(na, nb)
    });
    saves
}
/// Parse un nom de save "BaseName-123" ou "BaseName-123.ext" -> (base, num, ext).
fn parse_save_base_num(name: &str) -> Option<(&str, u64, &str)> {
    let name = name.trim();
    let (stem, ext) = if let Some(dot) = name.rfind('.') {
        (&name[..dot], &name[dot..])
    } else {
        (name, "")
    };
    let dash = stem.rfind('-')?;
    let num_part = stem.get(dash + 1..)?;
    if num_part.is_empty() || !num_part.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let num: u64 = num_part.parse().ok()?;
    let base = stem.get(..dash)?;
    Some((base, num, ext))
}

#[tauri::command]
fn cmd_insert_save(source_path: String) -> Result<String, String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let exe = find_game_exe_in_dir(&game_dir, 2)
        .ok_or_else(|| "Exécutable PNW introuvable — installez d'abord le jeu".to_string())?;
    let game_root = exe.parent().unwrap_or(&game_dir);
    let saves_dir = game_root.join("Saves");
    if !saves_dir.exists() {
        fs::create_dir_all(&saves_dir).map_err(errs)?;
    }
    let src = Path::new(&source_path);
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Nom de fichier invalide".to_string())?;

    let dest_name: std::borrow::Cow<str> = if let Some((base, _incoming_num, ext)) = parse_save_base_num(file_name) {
        let existing = all_saves_in_dir(&game_dir);
        let mut max_num = 0u64;
        for (path, _) in &existing {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if let Some((b, n, _)) = parse_save_base_num(name) {
                if b == base && n > max_num {
                    max_num = n;
                }
            }
        }
        let next = max_num + 1;
        std::borrow::Cow::Owned(format!("{}-{}{}", base, next, ext))
    } else {
        std::borrow::Cow::Borrowed(file_name)
    };

    let dest = saves_dir.join(dest_name.as_ref());
    fs::copy(src, &dest).map_err(errs)?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn cmd_list_saves() -> Result<Vec<SaveEntry>, String> {
    let game_dir = match current_install_dir() {
        Some(p) => p,
        None => return Ok(vec![]),
    };
    let saves = all_saves_in_dir(&game_dir);
    Ok(saves
        .into_iter()
        .enumerate()
        .map(|(i, (path, meta))| {
            let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("?").to_string();
            SaveEntry {
                path: path.to_string_lossy().to_string(),
                name: if fname.contains('.') { fname } else { format!("Save {}", i + 1) },
                modified: meta.modified().unwrap_or(UNIX_EPOCH)
                    .duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
                size: meta.len(),
            }
        })
        .collect())
}

#[tauri::command]
fn cmd_get_save_blob(save_path: String) -> Result<Option<SaveBlob>, String> {
    // Sécurité : valider que le chemin est bien dans le dossier Saves du jeu
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let saves_dir = game_dir.join("Saves");
    
    let p = Path::new(&save_path);
    if !p.is_file() { return Ok(None); }
    
    // Canonicaliser les chemins pour éviter les attaques path traversal (../)
    let canonical_path = p.canonicalize().map_err(errs)?;
    let canonical_saves = saves_dir.canonicalize().unwrap_or_else(|_| saves_dir.clone());
    
    // Vérifier que le fichier est bien dans le dossier Saves
    if !canonical_path.starts_with(&canonical_saves) {
        return Err("Accès refusé : le fichier n'est pas dans le dossier Saves".to_string());
    }
    
    let bytes = fs::read(&canonical_path).map_err(errs)?;
    let modified = canonical_path.metadata().ok()
        .and_then(|m| m.modified().ok())
        .map(|t| t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs())
        .unwrap_or(0);
    let b64 = general_purpose::STANDARD.encode(bytes);
    Ok(Some(SaveBlob {
        path: save_path,
        modified,
        bytes_b64: b64,
    }))
}

#[tauri::command]
fn cmd_latest_save_blob() -> Result<Option<SaveBlob>, String> {
    let game_dir = match current_install_dir() {
        Some(p) => p,
        None => return Ok(None),
    };
    let saves = all_saves_in_dir(&game_dir);
    if let Some((path, meta)) = saves.into_iter().next() {
        let bytes = fs::read(&path).map_err(errs)?;
        let b64 = general_purpose::STANDARD.encode(bytes);
        let modified = meta.modified().unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        return Ok(Some(SaveBlob {
            path: path.to_string_lossy().to_string(),
            modified,
            bytes_b64: b64,
        }));
    }
    Ok(None)
}

/// Liste des noms d’attaques en français depuis `Data/2.dat` (index = ID interne PSDK).
#[tauri::command]
fn cmd_psdk_french_skill_names() -> Result<String, String> {
    let game_dir = current_install_dir().ok_or_else(|| {
        String::from("Dossier du jeu introuvable.")
    })?;
    let names = psdk_data2::read_french_skill_names(&game_dir)?;
    serde_json::to_string(&names).map_err(errs)
}

/// Liste des noms de talents en français depuis `Data/2.dat` (index = ID interne PSDK).
#[tauri::command]
fn cmd_psdk_french_ability_names() -> Result<String, String> {
    let game_dir = current_install_dir().ok_or_else(|| {
        String::from("Dossier du jeu introuvable.")
    })?;
    let names = psdk_data2::read_french_ability_names(&game_dir)?;
    serde_json::to_string(&names).map_err(errs)
}

/// Liste des noms d’objets en français (singulier) depuis `Data/2.dat` (index = ID interne PSDK).
#[tauri::command]
fn cmd_psdk_french_item_names() -> Result<String, String> {
    let game_dir = current_install_dir().ok_or_else(|| {
        String::from("Dossier du jeu introuvable.")
    })?;
    let names = psdk_data2::read_french_item_names(&game_dir)?;
    serde_json::to_string(&names).map_err(errs)
}

/// Liste des noms d’espèces en français depuis `Data/2.dat` (index = ID interne PSDK / GTS).
#[tauri::command]
fn cmd_psdk_french_species_names() -> Result<String, String> {
    let game_dir = current_install_dir().ok_or_else(|| {
        String::from(
            "Dossier du jeu introuvable. Installez Pokémon New World ou définissez le dossier d’installation.",
        )
    })?;
    let names = psdk_data2::read_french_species_names(&game_dir)?;
    serde_json::to_string(&names).map_err(errs)
}

/* ============== Sprites shiny (VD cache) ============== */

/// Lit un sprite depuis un fichier Yuki::VD (Virtual Directory) du jeu.
/// Format VD : [4 octets ptr_index_LE] [entrées: 4 octets taille_LE + données] ... [Marshal hash à ptr_index]
fn vd_read_entry(vd_path: &Path, filename: &str) -> Result<Vec<u8>> {
    use std::io::{Read as _, Seek, SeekFrom};
    let mut f = fs::File::open(vd_path)?;

    // Lire le pointeur vers l'index (4 octets LE au début)
    let mut ptr_buf = [0u8; 4];
    f.read_exact(&mut ptr_buf)?;
    let ptr = u32::from_le_bytes(ptr_buf) as u64;

    // Lire le blob Marshal à la fin du fichier (l'index)
    f.seek(SeekFrom::Start(ptr))?;
    let mut index_data = Vec::new();
    f.read_to_end(&mut index_data)?;

    // Parser le Marshal hash : on cherche le filename dans les paires clé→offset
    let offset = marshal_hash_lookup(&index_data, filename)
        .ok_or_else(|| anyhow!("Sprite '{}' introuvable dans le VD", filename))?;

    // Lire l'entrée : [4 octets taille LE][données PNG]
    f.seek(SeekFrom::Start(offset as u64))?;
    let mut size_buf = [0u8; 4];
    f.read_exact(&mut size_buf)?;
    let size = u32::from_le_bytes(size_buf) as usize;
    let mut data = vec![0u8; size];
    f.read_exact(&mut data)?;
    Ok(data)
}

/// Lookup minimaliste dans un Marshal hash Ruby (format 04 08 { ... }).
/// Cherche une clé String et retourne la valeur Integer (offset).
fn marshal_hash_lookup(data: &[u8], key: &str) -> Option<u32> {
    // Le Marshal commence par 04 08, puis le type tag
    if data.len() < 3 || data[0] != 0x04 || data[1] != 0x08 {
        return None;
    }
    let mut pos = 2;
    let tag = *data.get(pos)?;
    pos += 1;
    if tag != b'{' {
        return None; // pas un hash
    }
    let count = marshal_read_fixnum(data, &mut pos)?;

    for _ in 0..count {
        // Lire la clé
        let k = marshal_read_string_value(data, &mut pos)?;
        // Lire la valeur (integer = offset)
        let v = marshal_read_int_value(data, &mut pos)?;
        if k == key {
            return Some(v as u32);
        }
    }
    None
}

fn marshal_read_fixnum(data: &[u8], pos: &mut usize) -> Option<i64> {
    let c = *data.get(*pos)? as i8;
    *pos += 1;
    if c == 0 {
        return Some(0);
    }
    if c >= 5 {
        return Some((c as i64) - 5);
    }
    if c <= -5 {
        return Some((c as i64) + 5);
    }
    if c > 0 {
        let n_bytes = c as usize;
        let mut n: u64 = 0;
        for i in 0..n_bytes {
            n |= (*data.get(*pos)? as u64) << (8 * i);
            *pos += 1;
        }
        Some(n as i64)
    } else {
        let n_bytes = (-c) as usize;
        let mut n: u64 = 0;
        for i in 0..n_bytes {
            n |= (*data.get(*pos)? as u64) << (8 * i);
            *pos += 1;
        }
        let mask = (1u64 << (n_bytes * 8)) - 1;
        n ^= mask;
        Some(-(n as i64) - 1)
    }
}

/// Lit une valeur Marshal qui doit être un String (tag '"' ou 'I' wrapping '"').
fn marshal_read_string_value(data: &[u8], pos: &mut usize) -> Option<String> {
    let tag = *data.get(*pos)?;
    *pos += 1;
    match tag {
        b'"' => {
            let len = marshal_read_fixnum(data, pos)? as usize;
            let s = std::str::from_utf8(data.get(*pos..*pos + len)?).ok()?.to_string();
            *pos += len;
            Some(s)
        }
        b'I' => {
            // Instance var wrapper — recurse for the inner string, then skip ivars
            let s = marshal_read_string_value(data, pos)?;
            let ivar_count = marshal_read_fixnum(data, pos)?;
            for _ in 0..ivar_count {
                // skip symbol key
                marshal_skip_value(data, pos)?;
                // skip value
                marshal_skip_value(data, pos)?;
            }
            Some(s)
        }
        _ => None,
    }
}

/// Lit une valeur Marshal qui doit être un Integer (tag 'i').
fn marshal_read_int_value(data: &[u8], pos: &mut usize) -> Option<i64> {
    let tag = *data.get(*pos)?;
    *pos += 1;
    if tag == b'i' {
        marshal_read_fixnum(data, pos)
    } else {
        None
    }
}

/// Skip un élément Marshal quelconque (suffisant pour les types rencontrés dans l'index VD).
fn marshal_skip_value(data: &[u8], pos: &mut usize) -> Option<()> {
    let tag = *data.get(*pos)?;
    *pos += 1;
    match tag {
        b'0' | b'T' | b'F' => Some(()), // nil, true, false
        b'i' => { marshal_read_fixnum(data, pos)?; Some(()) }
        b'"' => {
            let len = marshal_read_fixnum(data, pos)? as usize;
            *pos += len;
            Some(())
        }
        b':' => {
            let len = marshal_read_fixnum(data, pos)? as usize;
            *pos += len;
            Some(())
        }
        b';' => { marshal_read_fixnum(data, pos)?; Some(()) }
        b'I' => {
            marshal_skip_value(data, pos)?;
            let n = marshal_read_fixnum(data, pos)?;
            for _ in 0..n {
                marshal_skip_value(data, pos)?;
                marshal_skip_value(data, pos)?;
            }
            Some(())
        }
        _ => None,
    }
}

#[tauri::command]
/// Génère les variantes de clé VD à essayer pour un sprite.
/// Priorité GIF (animé) avant PNG.
/// Ex: species=4, form=None → ["4.gif", "004.gif", "4", "004"]
/// Ex: species=257, form=Some(1) → ["257_01.gif", "257_01", ...]
fn vd_key_candidates(species_id: u32, form: Option<u32>) -> Vec<String> {
    let mut keys = Vec::new();
    match form {
        Some(f) if f > 0 => {
            // GIF en priorité
            keys.push(format!("{}_{:02}.gif", species_id, f));
            if species_id < 1000 {
                keys.push(format!("{:03}_{:02}.gif", species_id, f));
            }
            // PNG en fallback
            keys.push(format!("{}_{:02}", species_id, f));
            if species_id < 1000 {
                keys.push(format!("{:03}_{:02}", species_id, f));
            }
            // Forme _30 (alternate) en fallback
            keys.push(format!("{}_{:02}", species_id, 30 + f));
            if species_id < 1000 {
                keys.push(format!("{:03}_{:02}", species_id, 30 + f));
            }
        }
        _ => {
            // GIF en priorité
            keys.push(format!("{}.gif", species_id));
            if species_id < 1000 {
                keys.push(format!("{:03}.gif", species_id));
            }
            // PNG en fallback
            keys.push(format!("{}", species_id));
            if species_id < 1000 {
                keys.push(format!("{:03}", species_id));
            }
        }
    }
    keys
}

/// Essaie d'extraire un sprite du VD en testant plusieurs variantes de clé.
/// Accepte PNG et GIF. Retourne (data, mime_type).
fn vd_try_sprite(vd_path: &Path, species_id: u32, form: Option<u32>) -> Option<(Vec<u8>, &'static str)> {
    let candidates = vd_key_candidates(species_id, form);
    for key in &candidates {
        if let Ok(data) = vd_read_entry(vd_path, key) {
            if data.len() >= 4 && &data[..4] == b"\x89PNG" {
                return Some((data, "image/png"));
            }
            if data.len() >= 6 && &data[..6] == b"GIF89a" {
                return Some((data, "image/gif"));
            }
            if data.len() >= 6 && &data[..6] == b"GIF87a" {
                return Some((data, "image/gif"));
            }
        }
    }
    None
}

#[tauri::command]
fn cmd_get_normal_sprite(species_id: u32, form: Option<u32>) -> Result<Option<String>, String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;

    let vd_key = match form {
        Some(f) if f > 0 => format!("{}_{:02}", species_id, f),
        _ => format!("{}", species_id),
    };

    let cache_dir = app_local_dir().map_err(errs)?.join("sprite_cache").join("normal");
    let cache_path = cache_dir.join(format!("{}.dat", vd_key));

    if cache_path.is_file() {
        let data = fs::read(&cache_path).map_err(errs)?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        let mime = if data.len() >= 4 && &data[..4] == b"\x89PNG" { "image/png" } else { "image/gif" };
        return Ok(Some(format!("data:{};base64,{}", mime, b64)));
    }

    let vd_path = game_dir.join("pokemonsdk").join("master").join("poke_front");
    if vd_path.is_file() {
        if let Some((data, mime)) = vd_try_sprite(&vd_path, species_id, form) {
            ensure_sprite_cache_dir("normal")?;
            fs::write(&cache_path, &data).map_err(errs)?;

            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            return Ok(Some(format!("data:{};base64,{}", mime, b64)));
        }
    }

    // Fallback: chercher dans les loose files de graphics/pokedex/pokefront/
    let loose_dir = game_dir.join("graphics").join("pokedex").join("pokefront");
    if loose_dir.is_dir() {
        let candidates = normal_file_candidates(species_id, form);
        for name in &candidates {
            let file_path = loose_dir.join(name);
            if file_path.is_file() {
                let data = fs::read(&file_path).map_err(errs)?;
                ensure_sprite_cache_dir("normal")?;
                fs::write(&cache_path, &data).map_err(errs)?;

                use base64::Engine;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
                let mime = detect_sprite_mime(&data);
                return Ok(Some(format!("data:{};base64,{}", mime, b64)));
            }
        }
    }

    Ok(None)
}

#[tauri::command]
fn cmd_get_shiny_sprite(species_id: u32, form: Option<u32>) -> Result<Option<String>, String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;

    let vd_key = match form {
        Some(f) if f > 0 => format!("{}_{:02}", species_id, f),
        _ => format!("{}", species_id),
    };

    let cache_dir = app_local_dir().map_err(errs)?.join("sprite_cache").join("shiny");
    let cache_path = cache_dir.join(format!("{}.dat", vd_key));

    if cache_path.is_file() {
        let data = fs::read(&cache_path).map_err(errs)?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        let mime = if data.len() >= 4 && &data[..4] == b"\x89PNG" { "image/png" } else { "image/gif" };
        return Ok(Some(format!("data:{};base64,{}", mime, b64)));
    }

    let vd_path = game_dir.join("pokemonsdk").join("master").join("poke_front_s");
    if !vd_path.is_file() {
        return Ok(None);
    }

    let (data, mime) = match vd_try_sprite(&vd_path, species_id, form) {
        Some(r) => r,
        None => return Ok(None),
    };

    ensure_sprite_cache_dir("shiny")?;
    fs::write(&cache_path, &data).map_err(errs)?;

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(Some(format!("data:{};base64,{}", mime, b64)))
}

/// Génère les noms de fichiers candidats pour un sprite normal (loose files).
fn normal_file_candidates(species_id: u32, form: Option<u32>) -> Vec<String> {
    let mut keys = Vec::new();
    match form {
        Some(f) if f > 0 => {
            keys.push(format!("{}_{:02}.gif", species_id, f));
            if species_id < 1000 {
                keys.push(format!("{:03}_{:02}.gif", species_id, f));
            }
            keys.push(format!("{}_{:02}.png", species_id, f));
            if species_id < 1000 {
                keys.push(format!("{:03}_{:02}.png", species_id, f));
            }
        }
        _ => {}
    }
    keys.push(format!("{}.gif", species_id));
    if species_id < 1000 {
        keys.push(format!("{:03}.gif", species_id));
    }
    keys.push(format!("{}.png", species_id));
    if species_id < 1000 {
        keys.push(format!("{:03}.png", species_id));
    }
    keys
}

/// Génère les noms de fichiers candidats pour un sprite alt shiny (loose files, suffixe "a").
fn alt_shiny_file_candidates(species_id: u32, form: Option<u32>) -> Vec<String> {
    let mut keys = Vec::new();
    match form {
        Some(f) if f > 0 => {
            // GIF en priorité
            keys.push(format!("{}a_{:02}.gif", species_id, f));
            if species_id < 1000 {
                keys.push(format!("{:03}a_{:02}.gif", species_id, f));
            }
            keys.push(format!("{}a_{:02}.png", species_id, f));
            if species_id < 1000 {
                keys.push(format!("{:03}a_{:02}.png", species_id, f));
            }
        }
        _ => {}
    }
    // Sans forme (fallback) — GIF en priorité
    keys.push(format!("{}a.gif", species_id));
    if species_id < 1000 {
        keys.push(format!("{:03}a.gif", species_id));
    }
    keys.push(format!("{}a.png", species_id));
    if species_id < 1000 {
        keys.push(format!("{:03}a.png", species_id));
    }
    keys
}

/// Détecte le MIME d'un fichier sprite par ses magic bytes.
fn detect_sprite_mime(data: &[u8]) -> &'static str {
    if data.len() >= 4 && &data[..4] == b"\x89PNG" {
        "image/png"
    } else {
        "image/gif"
    }
}

#[tauri::command]
fn cmd_get_alt_shiny_sprite(species_id: u32, form: Option<u32>) -> Result<Option<String>, String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;

    let vd_key = match form {
        Some(f) if f > 0 => format!("{}a_{:02}", species_id, f),
        _ => format!("{}a", species_id),
    };

    let cache_dir = app_local_dir().map_err(errs)?.join("sprite_cache").join("alt_shiny");
    let cache_path = cache_dir.join(format!("{}.dat", vd_key));

    if cache_path.is_file() {
        let data = fs::read(&cache_path).map_err(errs)?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        let mime = detect_sprite_mime(&data);
        return Ok(Some(format!("data:{};base64,{}", mime, b64)));
    }

    // Chercher dans les loose files de graphics/pokedex/pokefrontshiny/
    let loose_dir = game_dir.join("graphics").join("pokedex").join("pokefrontshiny");
    if !loose_dir.is_dir() {
        return Ok(None);
    }

    let candidates = alt_shiny_file_candidates(species_id, form);
    for name in &candidates {
        let file_path = loose_dir.join(name);
        if file_path.is_file() {
            let data = fs::read(&file_path).map_err(errs)?;
            ensure_sprite_cache_dir("alt_shiny")?;
            fs::write(&cache_path, &data).map_err(errs)?;

            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            let mime = detect_sprite_mime(&data);
            return Ok(Some(format!("data:{};base64,{}", mime, b64)));
        }
    }

    Ok(None)
}

/* ============== GTS Deposit & Save Write ============== */

/// Vérifie si le jeu PNW est en cours d'exécution (empêche l'écriture de la save).
#[tauri::command]
fn cmd_is_game_running() -> bool {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All);
    for proc in sys.processes().values() {
        let name = proc.name().to_string_lossy().to_ascii_lowercase();
        if name.contains("pokémon new world") || name.contains("pokemon new world")
            || name == "game.exe" || name == "pnw.exe"
        {
            return true;
        }
    }
    false
}

/// Écrit un blob (base64) dans un fichier de save, en créant d'abord un backup `.bak`.
/// Retourne le chemin du backup créé.
#[tauri::command]
fn cmd_write_save_blob(save_path: String, bytes_b64: String) -> Result<String, String> {
    let p = Path::new(&save_path);
    if !p.is_file() {
        return Err("Le fichier de sauvegarde n'existe pas.".to_string());
    }
    // Sécurité : vérifier que le fichier est dans le dossier Saves
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let saves_dir = game_dir.join("Saves");
    let canonical_path = p.canonicalize().map_err(errs)?;
    let canonical_saves = saves_dir.canonicalize().unwrap_or_else(|_| saves_dir.clone());
    if !canonical_path.starts_with(&canonical_saves) {
        return Err("Accès refusé : le fichier n'est pas dans le dossier Saves".to_string());
    }
    // Décoder le base64
    let bytes = general_purpose::STANDARD.decode(bytes_b64.as_bytes()).map_err(errs)?;
    if bytes.len() < 512 {
        return Err("Données trop petites pour être une save valide.".to_string());
    }
    // Créer le backup
    let bak_path = canonical_path.with_extension("bak");
    fs::copy(&canonical_path, &bak_path).map_err(errs)?;
    // Écrire la nouvelle save
    fs::write(&canonical_path, &bytes).map_err(errs)?;
    Ok(bak_path.to_string_lossy().to_string())
}

/// Sauvegarde les critères bonus GTS du launcher dans un fichier JSON.
#[tauri::command]
fn cmd_gts_save_extras(online_id: u32, json_data: String) -> Result<(), String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let extras_dir = game_dir.join("Saves").join("gts_extras");
    fs::create_dir_all(&extras_dir).map_err(errs)?;
    let file_path = extras_dir.join(format!("{}.json", online_id));
    fs::write(&file_path, json_data.as_bytes()).map_err(errs)?;
    Ok(())
}

/// Lit les critères bonus GTS du launcher depuis le fichier JSON.
#[tauri::command]
fn cmd_gts_read_extras(online_id: u32) -> Result<Option<String>, String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let file_path = game_dir.join("Saves").join("gts_extras").join(format!("{}.json", online_id));
    if !file_path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&file_path).map_err(errs)?;
    Ok(Some(content))
}

/// Supprime les critères bonus GTS du launcher.
#[tauri::command]
fn cmd_gts_delete_extras(online_id: u32) -> Result<(), String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let file_path = game_dir.join("Saves").join("gts_extras").join(format!("{}.json", online_id));
    if file_path.is_file() {
        fs::remove_file(&file_path).map_err(errs)?;
    }
    Ok(())
}

/// Liste tous les onlineId ayant un fichier extras (= dépôts launcher).
#[tauri::command]
fn cmd_gts_list_extras_ids() -> Result<Vec<u32>, String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let extras_dir = game_dir.join("Saves").join("gts_extras");
    if !extras_dir.is_dir() {
        return Ok(vec![]);
    }
    let mut ids = Vec::new();
    for entry in fs::read_dir(&extras_dir).map_err(errs)? {
        if let Ok(e) = entry {
            if let Some(name) = e.path().file_stem().and_then(|s| s.to_str()) {
                if let Ok(id) = name.parse::<u32>() {
                    ids.push(id);
                }
            }
        }
    }
    Ok(ids)
}

/// Sauvegarde le cache browse GTS sur disque (Saves/gts_browse_cache.json).
#[tauri::command]
fn cmd_gts_save_browse_cache(json_data: String) -> Result<(), String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let saves_dir = game_dir.join("Saves");
    fs::create_dir_all(&saves_dir).map_err(errs)?;
    let file_path = saves_dir.join("gts_browse_cache.json");
    fs::write(&file_path, json_data.as_bytes()).map_err(errs)?;
    Ok(())
}

/// Lit le cache browse GTS depuis le disque.
#[tauri::command]
fn cmd_gts_read_browse_cache() -> Result<Option<String>, String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let file_path = game_dir.join("Saves").join("gts_browse_cache.json");
    if !file_path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&file_path).map_err(errs)?;
    Ok(Some(content))
}

/// Ajoute une entrée à l'historique des échanges GTS.
#[tauri::command]
fn cmd_gts_append_history(json_entry: String) -> Result<(), String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let saves_dir = game_dir.join("Saves");
    fs::create_dir_all(&saves_dir).map_err(errs)?;
    let file_path = saves_dir.join("gts_history.json");

    let mut history: Vec<serde_json::Value> = if file_path.is_file() {
        let content = fs::read_to_string(&file_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&content).unwrap_or_else(|_| Vec::new())
    } else {
        Vec::new()
    };

    let entry: serde_json::Value = serde_json::from_str(&json_entry)
        .map_err(|e| format!("JSON invalide: {}", e))?;
    history.push(entry);

    // Garder seulement les 100 derniers échanges
    if history.len() > 100 {
        history = history.split_off(history.len() - 100);
    }

    let json_out = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Sérialisation échouée: {}", e))?;
    fs::write(&file_path, json_out.as_bytes()).map_err(errs)?;
    Ok(())
}

/// Lit l'historique des échanges GTS.
#[tauri::command]
fn cmd_gts_read_history() -> Result<String, String> {
    let game_dir = current_install_dir()
        .ok_or_else(|| "Dossier du jeu non défini".to_string())?;
    let file_path = game_dir.join("Saves").join("gts_history.json");
    if !file_path.is_file() {
        return Ok("[]".to_string());
    }
    let content = fs::read_to_string(&file_path).map_err(errs)?;
    Ok(content)
}

/// Upload un Pokémon sur le serveur GTS (action=uploadPokemon).
#[tauri::command]
fn cmd_gts_upload_pokemon(
    game_id: u32,
    online_id: u32,
    pokemon_b64: String,
    species: u32,
    level: u32,
    gender: i32,
    wanted_species: u32,
    wanted_level_min: u32,
    wanted_level_max: u32,
    wanted_gender: i32,
) -> Result<String, String> {
    let handle = thread::spawn(move || -> Result<String, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(errs)?;
        let resp = client
            .post(&base_url)
            .header(USER_AGENT, "pnw-launcher")
            .form(&[
                ("action", "uploadPokemon"),
                ("id", &online_id.to_string()),
                ("pokemon", &pokemon_b64),
                ("species", &species.to_string()),
                ("level", &level.to_string()),
                ("gender", &gender.to_string()),
                ("Wspecies", &wanted_species.to_string()),
                ("WlevelMin", &wanted_level_min.to_string()),
                ("WlevelMax", &wanted_level_max.to_string()),
                ("Wgender", &wanted_gender.to_string()),
            ])
            .send()
            .map_err(errs)?;
        resp.text().map_err(errs)
    });
    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

/// Vérifie si le joueur a déjà un Pokémon déposé (action=hasPokemonUploaded).
#[tauri::command]
fn cmd_gts_has_pokemon_uploaded(game_id: u32, online_id: u32) -> Result<bool, String> {
    let handle = thread::spawn(move || -> Result<bool, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(errs)?;
        let resp = client
            .post(&base_url)
            .header(USER_AGENT, "pnw-launcher")
            .form(&[
                ("action", "hasPokemonUploaded"),
                ("id", &online_id.to_string()),
            ])
            .send()
            .map_err(errs)?;
        let body = resp.text().map_err(errs)?;
        Ok(body.trim() == "yes")
    });
    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

/// Télécharge les données « wanted » (espèce/niveaux/genre) du Pokémon déposé.
#[tauri::command]
fn cmd_gts_download_wanted_data(game_id: u32, online_id: u32) -> Result<String, String> {
    let handle = thread::spawn(move || -> Result<String, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(errs)?;
        let resp = client
            .post(&base_url)
            .header(USER_AGENT, "pnw-launcher")
            .form(&[
                ("action", "downloadWantedData"),
                ("id", &online_id.to_string()),
            ])
            .send()
            .map_err(errs)?;
        let body = resp.text().map_err(errs)?;
        Ok(body)
    });
    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

/// Supprime le Pokémon déposé du joueur (action=deletePokemon).
#[tauri::command]
fn cmd_gts_delete_pokemon(game_id: u32, online_id: u32, withdraw: bool) -> Result<bool, String> {
    let handle = thread::spawn(move || -> Result<bool, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(errs)?;
        let resp = client
            .post(&base_url)
            .header(USER_AGENT, "pnw-launcher")
            .form(&[
                ("action", "deletePokemon"),
                ("id", &online_id.to_string()),
                ("withdraw", if withdraw { "y" } else { "n" }),
            ])
            .send()
            .map_err(errs)?;
        let body = resp.text().map_err(errs)?;
        Ok(body.trim() == "success")
    });
    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

/// Vérifie si le dépôt du joueur a été pris par un échange (action=isTaken).
#[tauri::command]
fn cmd_gts_is_taken(game_id: u32, online_id: u32) -> Result<bool, String> {
    let handle = thread::spawn(move || -> Result<bool, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(errs)?;
        let resp = client
            .post(&base_url)
            .header(USER_AGENT, "pnw-launcher")
            .form(&[
                ("action", "isTaken"),
                ("id", &online_id.to_string()),
            ])
            .send()
            .map_err(errs)?;
        let body = resp.text().map_err(errs)?;
        Ok(body.trim() == "yes")
    });
    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

#[tauri::command]
fn cmd_gts_take_pokemon(game_id: u32, online_id: u32) -> Result<bool, String> {
    let handle = thread::spawn(move || -> Result<bool, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(errs)?;
        let resp = client
            .post(&base_url)
            .header(USER_AGENT, "pnw-launcher")
            .form(&[
                ("action", "setTaken"),
                ("id", &online_id.to_string()),
            ])
            .send()
            .map_err(errs)?;
        let body = resp.text().map_err(errs)?;
        Ok(body.trim() == "success")
    });
    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

#[tauri::command]
fn cmd_gts_upload_new_pokemon(game_id: u32, online_id: u32, pokemon_b64: String) -> Result<bool, String> {
    let handle = thread::spawn(move || -> Result<bool, String> {
        let base_url = format!("http://gts.kawasemi.de/api.php?i={}", game_id);
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(errs)?;
        let resp = client
            .post(&base_url)
            .header(USER_AGENT, "pnw-launcher")
            .form(&[
                ("action", "uploadNewPokemon"),
                ("id", &online_id.to_string()),
                ("pokemon", &pokemon_b64),
            ])
            .send()
            .map_err(errs)?;
        let body = resp.text().map_err(errs)?;
        Ok(body.trim() == "success")
    });
    handle.join().map_err(|_| "Le thread GTS a paniqué.".to_string())?
}

/* ============== Entrée ============== */
fn main() {
    let mut discord_client = DiscordClient::new(DISCORD_APP_ID);
    discord_client.start();
    // Laisser le temps au client Discord de se connecter
    thread::sleep(Duration::from_millis(500));
    let discord_arc = Arc::new(Mutex::new(discord_client));

    tauri::Builder::default()
        .manage(AppState {
            dl: Arc::new(Mutex::new(DlInner::default())),
            discord: discord_arc.clone(),
        })
        .setup(move |app| {
            if let Ok(mut client) = discord_arc.lock() {
                let _ = discord_set_presence(&mut *client, "menu", None, None, None, None);
            }
            // Activer les DevTools en release (clic droit > Inspecter)
            #[cfg(feature = "devtools")]
            if let Some(w) = app.get_webview_window("main") {
                w.open_devtools();
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init()) // <— IMPORTANT pour open() côté front
        .plugin(tauri_plugin_updater::Builder::new().build()) // Auto-update du launcher
        .invoke_handler(tauri::generate_handler![
            cmd_http_head_content_length,
            cmd_fetch_manifest,
            // cmd_fetch_launcher_update_info est remplacé par tauri-plugin-updater
            cmd_gts_search,
            cmd_gts_browse_all,
            cmd_gts_download_pokemon,
            cmd_psdk_french_species_names,
            cmd_psdk_french_skill_names,
            cmd_psdk_french_ability_names,
            cmd_psdk_french_item_names,
            cmd_open_url,
            // cmd_download_launcher_installer est remplacé par tauri-plugin-updater
            cmd_get_install_info,
            cmd_set_install_dir,
            cmd_set_default_install_dir,
            cmd_set_game_lang,
            cmd_clear_install_etag,
            cmd_check_disk_space_for_update,
            cmd_download_and_install,
            cmd_pause_download,
            cmd_resume_download,
            cmd_cancel_download,
            cmd_append_log,
            cmd_discord_set_presence,
            cmd_launch_game,
            cmd_insert_save,
            cmd_list_saves,
            cmd_get_save_blob,
            cmd_latest_save_blob,
            cmd_get_normal_sprite,
            cmd_get_shiny_sprite,
            cmd_get_alt_shiny_sprite,
            cmd_is_game_running,
            cmd_write_save_blob,
            cmd_gts_upload_pokemon,
            cmd_gts_has_pokemon_uploaded,
            cmd_gts_download_wanted_data,
            cmd_gts_delete_pokemon,
            cmd_gts_is_taken,
            cmd_gts_take_pokemon,
            cmd_gts_upload_new_pokemon,
            cmd_gts_save_extras,
            cmd_gts_read_extras,
            cmd_gts_delete_extras,
            cmd_gts_list_extras_ids,
            cmd_gts_save_browse_cache,
            cmd_gts_read_browse_cache,
            cmd_gts_append_history,
            cmd_gts_read_history,
            cmd_read_trade_evolutions,
            cmd_read_game_state,
            battle_relay::cmd_battle_read_outbox,
            battle_relay::cmd_battle_request_live_party,
            battle_relay::cmd_battle_read_live_party,
            battle_relay::cmd_battle_write_inbox,
            battle_relay::cmd_battle_write_trigger,
            battle_relay::cmd_battle_cleanup,
            battle_relay::cmd_battle_save_log,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage");
}
