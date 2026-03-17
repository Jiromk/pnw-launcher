#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use dirs;
use sysinfo::Disks;
use reqwest::blocking::Client;
use reqwest::header::{
    ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_RANGE, IF_RANGE, RANGE, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use discord_presence::models::rich_presence::{Activity, ActivityTimestamps};
use discord_presence::Client as DiscordClient;
use tauri::Emitter; // pour app.emit(...)
use tauri::{AppHandle, State};
use walkdir::WalkDir;
use zip::ZipArchive;

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
}
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Config {
    #[serde(default)]
    install_dir: Option<String>,
    #[serde(default)]
    install_etag: Option<String>,
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
const PNW_SITE_URL: &str = "https://www.pokemonnewworld.fr";
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
fn current_install_dir() -> Option<PathBuf> {
    let cfg = read_config();
    cfg.install_dir
        .map(PathBuf::from)
        .or_else(|| default_install_dir().ok())
}
fn ensure_install_dir() -> Result<PathBuf> {
    let dir = current_install_dir().ok_or_else(|| anyhow!("install_dir manquant"))?;
    if !dir.exists() {
        fs::create_dir_all(&dir).context("create install dir")?;
    }
    Ok(dir)
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

/// Restaure les dossiers Saves et Save du backup vers le nouveau game_dir (réinstallation).
fn restore_saves_from_backup(backup_dir: &Path, game_dir: &Path) {
    let backup_exe = match find_game_exe_in_dir(backup_dir, 10) {
        Some(p) => p,
        None => return,
    };
    let backup_game = match backup_exe.parent() {
        Some(p) => p.to_path_buf(),
        None => return,
    };
    for dir_name in ["Saves", "Save"] {
        let src = backup_game.join(dir_name);
        if !src.exists() || !src.is_dir() {
            continue;
        }
        let dst = game_dir.join(dir_name);
        let _ = copy_dir_recursive(&src, &dst);
    }
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
fn cmd_get_install_info() -> Result<serde_json::Value, String> {
    if let Some(dir) = current_install_dir() {
        let has_exe = find_game_exe_in_dir(&dir, 2).is_some();
        let ver = read_version(&dir).ok();
        let has_version = ver.is_some();
        let integrity = check_install_integrity(&dir);
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
    }))
}
#[tauri::command]
fn cmd_set_default_install_dir() -> Result<serde_json::Value, String> {
    let dir = default_install_dir().map_err(errs)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(errs)?;
    }
    let mut cfg = read_config();
    cfg.install_dir = Some(dir.to_string_lossy().to_string());
    write_config(&cfg).map_err(errs)?;
    Ok(json!({"ok":true,"installDir":dir.to_string_lossy()}))
}
#[tauri::command]
fn cmd_set_install_dir(path: String) -> Result<serde_json::Value, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        fs::create_dir_all(&p).map_err(errs)?;
    }
    let mut cfg = read_config();
    cfg.install_dir = Some(path.clone());
    write_config(&cfg).map_err(errs)?;
    Ok(json!({"ok":true,"installDir":path}))
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

    let tmp_path = temp_zip_path().map_err(errs)?;
    let temp_dir = tmp_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| tmp_path.clone());
    let install_root = read_config()
        .install_dir
        .map(PathBuf::from)
        .or_else(|| default_install_dir().ok())
        .unwrap_or_else(|| temp_dir.clone());
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
    let tmp_path = temp_zip_path().map_err(errs)?;
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
    let original_install_dir = cfg.install_dir.clone();
    let original_etag = cfg.install_etag.clone();
    let install_root = cfg
        .install_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or(default_install_dir().map_err(errs)?);
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
    let link = zip_url(manifest).to_string();
    if link.is_empty() {
        return Err("Manifest sans URL".into());
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
            let report = check_install_integrity(&existing_dir);
            if report.manifest_present && report.healthy {
                write_version(&existing_dir, &manifest.version).map_err(errs)?;
                write_install_snapshot(&existing_dir).map_err(errs)?;
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
            .append(downloaded > 0)
            .write(true)
            .truncate(downloaded == 0)
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

    let backup_dir = target_parent.join(".pnw_backup");
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir).map_err(errs)?;
    }
    if install_root.exists() {
        fs::rename(&install_root, &backup_dir).map_err(errs)?;
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
        restore_saves_from_backup(&backup_dir, &game_dir);
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

    cfg.install_dir = Some(game_dir.to_string_lossy().to_string());
    cfg.install_etag = etag.clone();
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

/* ============== Discord Rich Presence ============== */
/// kind: "menu" | "game" | "map" | "battle"
/// start_timestamp_secs: optionnel, pour afficher "Jouer depuis X" (temps de jeu)
/// details: optionnel, 2e ligne (ex. "Sacha • #01234 | Pokédex: 42 vus, 38 capturés | 12 h 30")
fn discord_build_activity(
    kind: &str,
    start_timestamp_secs: Option<u64>,
    details: Option<&str>,
) -> Activity {
    let (state_label, large_image_key) = match kind {
        "game" => ("En jeu", "pp1"),
        "map" => ("Sur la carte", "carte"),
        "battle" => ("En combat", "pp1"),
        _ => ("Dans le menu", "logo_2_0"),
    };
    let mut act = Activity::new()
        .state(state_label)
        .assets(|a| a.large_image(large_image_key).large_text(state_label))
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

fn discord_set_presence(
    client: &mut DiscordClient,
    kind: &str,
    start_timestamp_secs: Option<u64>,
    details: Option<&str>,
) -> Result<(), String> {
    let activity = discord_build_activity(kind, start_timestamp_secs, details);
    client.set_activity(|_| activity).map_err(errs).map(|_| ())
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
        let mut child = Command::new(&exe).current_dir(&dir).spawn().map_err(errs)?;
        let discord = state.discord.clone();
        let app_handle = app.clone();
        thread::spawn(move || {
            let _ = child.wait();
            if let Ok(mut client) = discord.lock() {
                let _ = discord_set_presence(&mut *client, "menu", None, None);
            }
            let _ = app_handle.emit("pnw://game-exited", ());
        });
        let start_ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if let Ok(mut client) = state.discord.lock() {
            let _ = discord_set_presence(&mut *client, "game", Some(start_ts), None);
        }
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
    let p = Path::new(&save_path);
    if !p.is_file() { return Ok(None); }
    let bytes = fs::read(p).map_err(errs)?;
    let modified = p.metadata().ok()
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

/* ============== Entrée ============== */
fn main() {
    let mut discord_client = DiscordClient::new(DISCORD_APP_ID);
    discord_client.start();
    let discord_arc = Arc::new(Mutex::new(discord_client));

    tauri::Builder::default()
        .manage(AppState {
            dl: Arc::new(Mutex::new(DlInner::default())),
            discord: discord_arc.clone(),
        })
        .setup(move |_app| {
            if let Ok(mut client) = discord_arc.lock() {
                let _ = discord_set_presence(&mut *client, "menu", None, None);
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init()) // <— IMPORTANT pour open() côté front
        .invoke_handler(tauri::generate_handler![
            cmd_fetch_manifest,
            cmd_get_install_info,
            cmd_set_install_dir,
            cmd_set_default_install_dir,
            cmd_check_disk_space_for_update,
            cmd_download_and_install,
            cmd_pause_download,
            cmd_resume_download,
            cmd_cancel_download,
            cmd_discord_set_presence,
            cmd_launch_game,
            cmd_insert_save,
            cmd_list_saves,
            cmd_get_save_blob,
            cmd_latest_save_blob,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au démarrage");
}
