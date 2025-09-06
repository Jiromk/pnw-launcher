#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  fs::{self, File, OpenOptions},
  io::{Read, Write},
  path::{Path, PathBuf},
  sync::{Arc, Mutex},
  time::{Duration, Instant},
  thread,
};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use walkdir::WalkDir;

/* ========================= Config ========================= */

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct LauncherConfig {
  install_dir: Option<String>,
}

fn config_dir() -> std::result::Result<PathBuf, String> {
  // %APPDATA%/Roaming sur Windows
  let base = dirs::config_dir().ok_or("config_dir introuvable")?;
  Ok(base.join("PNW"))
}
fn config_path() -> std::result::Result<PathBuf, String> {
  Ok(config_dir()?.join("launcher.json"))
}
fn temp_zip_path() -> std::result::Result<PathBuf, String> {
  Ok(config_dir()?.join("download.tmp"))
}

fn read_config() -> LauncherConfig {
  let p = match config_path() {
    Ok(p) => p,
    Err(_) => return LauncherConfig::default(),
  };
  if let Ok(bytes) = fs::read(&p) {
    if let Ok(cfg) = serde_json::from_slice::<LauncherConfig>(&bytes) {
      return cfg;
    }
  }
  LauncherConfig::default()
}
fn write_config(cfg: &LauncherConfig) -> std::result::Result<(), String> {
  let dir = config_dir()?;
  if !dir.exists() {
    fs::create_dir_all(&dir).map_err(err)?;
  }
  let p = config_path()?;
  let json = serde_json::to_vec_pretty(cfg).map_err(err)?;
  fs::write(p, json).map_err(err)?;
  Ok(())
}

/* ========================= Manifest ========================= */

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Manifest {
  version: String,
  #[serde(alias = "downloadUrl", alias = "zip_url")]
  zip_url: String,
  #[serde(default)]
  game_exe: Option<String>,
  #[serde(default)]
  folder: Option<String>,
}

/* ========================= DL state ========================= */

#[derive(Default)]
struct DlInner {
  paused: bool,
  cancel: bool,
  tmp_path: Option<PathBuf>,
  downloaded: u64,
  total: u64,
  // fenêtre glissante (instant, bytes) pour calcul vitesse/ETA
  window: Vec<(Instant, u64)>,
  started: Option<Instant>,
}

#[derive(Default)]
struct AppState {
  dl: Arc<Mutex<DlInner>>,
}

/* ========================= Helpers ========================= */

fn default_install_dir() -> std::result::Result<PathBuf, String> {
  // %LOCALAPPDATA%/PNW/Game
  let base = dirs::data_local_dir().ok_or("data_local_dir introuvable")?;
  Ok(base.join("PNW").join("Game"))
}

fn install_dir() -> std::result::Result<PathBuf, String> {
  let cfg = read_config();
  if let Some(p) = cfg.install_dir {
    return Ok(PathBuf::from(p));
  }
  default_install_dir()
}

fn find_game_exe(dir: &PathBuf, exe_name: &str) -> std::result::Result<PathBuf, anyhow::Error> {
  let candidate = dir.join(exe_name);
  if candidate.exists() {
    return Ok(candidate);
  }
  for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
    let p = entry.path();
    if p.file_name().and_then(|n| n.to_str()) == Some(exe_name) {
      return Ok(p.to_path_buf());
    }
  }
  Err(anyhow::anyhow!("{} non trouvé", exe_name))
}

fn read_version(dir: &PathBuf) -> Result<String> {
  let v = fs::read_to_string(dir.join(".version"))?;
  Ok(v.trim().to_string())
}

fn write_version(dir: &PathBuf, v: &str) -> Result<()> {
  fs::write(dir.join(".version"), v)?;
  Ok(())
}

// empêche l'extraction de chemins dangereux + rejoint le répertoire d'install
fn sanitize_zip_path(base: &PathBuf, name: &str) -> PathBuf {
  let mut path = base.clone();
  for comp in name.split(['\\', '/']) {
    if comp == ".." || comp.contains(':') || comp.is_empty() {
      continue;
    }
    path.push(comp);
  }
  path
}

// convertit n'importe quelle erreur affichable en String
fn err<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

/* ========================= Commands ========================= */

#[tauri::command]
fn cmd_fetch_manifest(manifest_url: String) -> Result<Manifest, String> {
  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(30))
    .build()
    .map_err(err)?;
  let m: Manifest = client
    .get(manifest_url)
    .send()
    .and_then(|r| r.error_for_status())
    .map_err(err)?
    .json()
    .map_err(err)?;
  Ok(m)
}

#[tauri::command]
fn cmd_get_install_info() -> Result<serde_json::Value, String> {
  let dir = install_dir()?;
  let ver = read_version(&dir).ok();
  // nom par défaut si on ne sait pas (sera précisé par le manifest côté UI)
  let exe = find_game_exe(&dir, "Pokemon New World.exe").ok();
  Ok(serde_json::json!({
    "installDir": dir.to_string_lossy(),
    "version": ver,
    "hasGame": exe.is_some()
  }))
}

#[tauri::command]
fn cmd_set_install_dir(path: String) -> Result<serde_json::Value, String> {
  let p = Path::new(&path);
  if !p.exists() {
    fs::create_dir_all(p).map_err(err)?;
  }
  let mut cfg = read_config();
  cfg.install_dir = Some(path.clone());
  write_config(&cfg)?;
  Ok(serde_json::json!({ "ok": true, "installDir": path }))
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

/* Lance la tâche en arrière-plan */
#[tauri::command]
fn cmd_download_and_install(
  app: tauri::AppHandle,
  state: State<AppState>,
  manifest: Manifest,
) -> Result<(), String> {
  let app_clone = app.clone();
  let dl_arc: Arc<Mutex<DlInner>> = state.dl.clone();
  let m = manifest.clone();
  thread::spawn(move || {
    if let Err(e) = run_download_and_install(&app_clone, &dl_arc, &m) {
      let _ = app_clone.emit("pnw://error", serde_json::json!({ "error": e }));
    }
  });
  Ok(())
}

#[tauri::command]
fn cmd_launch_game(exe_name: String) -> Result<(), String> {
  let dir = install_dir()?;
  let exe = find_game_exe(&dir, &exe_name).map_err(err)?;
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new(&exe)
      .current_dir(exe.parent().unwrap_or(&dir))
      .spawn()
      .map_err(err)?;
  }
  #[cfg(not(target_os = "windows"))]
  {
    std::process::Command::new(&exe).spawn().map_err(err)?;
  }
  Ok(())
}

/* Détection automatique d'un dossier de jeu déjà existant */
#[tauri::command]
fn cmd_autodetect_install(manifest: Option<Manifest>) -> Result<serde_json::Value, String> {
  let exe_name = manifest
    .as_ref()
    .and_then(|m| m.game_exe.clone())
    .unwrap_or_else(|| "Pokemon New World.exe".to_string());

  // Quelques racines probables
  let mut roots: Vec<PathBuf> = vec![];
  if let Some(p) = dirs::data_local_dir() {
    roots.push(p);
  }
  if let Some(p) = dirs::document_dir() {
    roots.push(p);
  }
  if let Some(p) = dirs::download_dir() {
    roots.push(p);
  }
  if let Some(p) = dirs::desktop_dir() {
    roots.push(p);
  }
  roots.push(PathBuf::from(r"C:\Program Files"));
  roots.push(PathBuf::from(r"C:\Program Files (x86)"));
  roots.push(PathBuf::from(r"C:\Games"));

  if let Ok(def) = default_install_dir() {
    if let Some(parent) = def.parent() {
      roots.push(parent.to_path_buf());
    }
  }

  let mut found: Option<PathBuf> = None;

  'outer: for root in roots {
    if !root.exists() {
      continue;
    }
    for entry in WalkDir::new(&root)
      .max_depth(5)
      .into_iter()
      .filter_map(|e| e.ok())
    {
      let p = entry.path();
      if p.file_name().and_then(|n| n.to_str()) == Some(&exe_name) {
        found = p.parent().map(|pp| pp.to_path_buf());
        break 'outer;
      }
      if p.file_name().and_then(|n| n.to_str()) == Some(".version") {
        found = p.parent().map(|pp| pp.to_path_buf());
        break 'outer;
      }
    }
  }

  if let Some(dir) = found {
    let mut cfg = read_config();
    cfg.install_dir = Some(dir.to_string_lossy().to_string());
    write_config(&cfg)?;
    return Ok(serde_json::json!({
      "found": true,
      "installDir": cfg.install_dir
    }));
  }

  Ok(serde_json::json!({
    "found": false,
    "reason": "Aucun exe ou .version trouvé"
  }))
}

/* ========================= Worker ========================= */

fn run_download_and_install(
  app: &tauri::AppHandle,
  dl: &Arc<Mutex<DlInner>>,
  manifest: &Manifest,
) -> Result<(), String> {
  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(600))
    .build()
    .map_err(err)?;

  // chemins + état
  let tmp_path = {
    let p = temp_zip_path()?;
    if let Some(d) = p.parent() {
      if !d.exists() {
        fs::create_dir_all(d).map_err(err)?;
      }
    }
    p
  };

  let start_at: u64 = if tmp_path.exists() {
    fs::metadata(&tmp_path).map_err(err)?.len()
  } else {
    0
  };
  {
    let mut s = dl.lock().unwrap();
    s.cancel = false;
    s.paused = false;
    s.window.clear();
    s.started = Some(Instant::now());
    s.tmp_path = Some(tmp_path.clone());
    s.downloaded = start_at;
  }

  // HEAD pour connaître la taille totale
  let head = client.head(&manifest.zip_url).send().map_err(err)?;
  let total = head
    .headers()
    .get(reqwest::header::CONTENT_LENGTH)
    .and_then(|v| v.to_str().ok())
    .and_then(|s| s.parse::<u64>().ok())
    .unwrap_or(0);
  {
    let mut s = dl.lock().unwrap();
    s.total = total;
    s.window.push((Instant::now(), start_at));
  }

  // Requête GET avec Range si reprise
  let mut req = client.get(&manifest.zip_url);
  if start_at > 0 {
    req = req.header(reqwest::header::RANGE, format!("bytes={}-", start_at));
  }
  let mut resp = req.send().and_then(|r| r.error_for_status()).map_err(err)?;

  // Fichier de sortie (append)
  let mut out = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&tmp_path)
    .map_err(err)?;

  let mut buf = [0u8; 64 * 1024];
  loop {
    // pause/annulation
    {
      let mut s = dl.lock().unwrap();
      if s.cancel {
        let _ = fs::remove_file(&tmp_path);
        let _ = app.emit("pnw://progress", serde_json::json!({"stage":"canceled"}));
        return Err("annulé".into());
      }
      while s.paused {
        let _ = app.emit("pnw://progress", serde_json::json!({
          "stage":"paused","downloaded": s.downloaded,"total": s.total,"eta_secs": null,"speed_bps": 0
        }));
        thread::sleep(Duration::from_millis(200));
      }
    }

    let n = resp.read(&mut buf).map_err(err)?;
    if n == 0 {
      break;
    }
    out.write_all(&buf[..n]).map_err(err)?;

    // progression + ETA/débit
    let (downloaded, total, eta, speed) = {
      let mut s = dl.lock().unwrap();
      s.downloaded += n as u64;
      let now = Instant::now();
      let downloaded_now = s.downloaded;
      s.window.push((now, downloaded_now));
      // fenêtre 3 secondes
      while s
        .window
        .first()
        .map_or(false, |(t, _)| now.duration_since(*t).as_secs_f32() > 3.0)
      {
        s.window.remove(0);
      }
      let speed = if s.window.len() >= 2 {
        let (t0, b0) = s.window.first().cloned().unwrap();
        let (t1, b1) = s.window.last().cloned().unwrap();
        let dt = t1.duration_since(t0).as_secs_f64().max(0.001);
        ((b1 as f64 - b0 as f64) / dt) as u64
      } else {
        0
      };
      let remaining = s.total.saturating_sub(downloaded_now);
      let eta = if speed > 0 {
        Some((remaining as f64 / speed as f64) as u64)
      } else {
        None
      };
      (downloaded_now, s.total, eta, speed)
    };

    let _ = app.emit(
      "pnw://progress",
      serde_json::json!({"stage":"download","downloaded": downloaded,"total": total,"eta_secs": eta,"speed_bps": speed}),
    );
  }

  // Extraction
  let target = install_dir()?;
  if !target.exists() {
    fs::create_dir_all(&target).map_err(err)?;
  }
  let _ = app.emit(
    "pnw://progress",
    serde_json::json!({"stage":"extract","downloaded":0,"total":1}),
  );

  let f = File::open(&tmp_path).map_err(err)?;
  let mut archive = zip::ZipArchive::new(f).map_err(err)?;

  // On N’ÉCRASE PAS le dossier Saves/ existant
  let saves_dir = target.join("Saves");
  let mut extracted_count = 0usize;

  for i in 0..archive.len() {
    let mut file = archive.by_index(i).map_err(err)?;
    let outpath = sanitize_zip_path(&target, file.name());

    // Si c'est dans Saves/, on saute (préservation)
    if outpath
      .components()
      .any(|c| c.as_os_str().to_string_lossy().eq_ignore_ascii_case("Saves"))
    {
      continue;
    }

    if file.is_dir() {
      fs::create_dir_all(&outpath).map_err(err)?;
    } else {
      if let Some(p) = outpath.parent() {
        fs::create_dir_all(p).map_err(err)?;
      }
      let mut outfile = File::create(&outpath).map_err(err)?;
      std::io::copy(&mut file, &mut outfile).map_err(err)?;
      #[cfg(unix)]
      {
        use std::os::unix::fs::PermissionsExt;
        if let Some(mode) = file.unix_mode() {
          fs::set_permissions(&outpath, fs::Permissions::from_mode(mode)).ok();
        }
      }
      extracted_count += 1;
    }
  }

  // Nettoyage + version
  let _ = fs::remove_file(&tmp_path);
  {
    let mut s = dl.lock().unwrap();
    s.tmp_path = None;
    s.window.clear();
  }
  // écrit le nouvel identifiant de version
  write_version(&target, &manifest.version).ok();

  // assure l’existence du dossier Saves
  if !saves_dir.exists() {
    let _ = fs::create_dir_all(&saves_dir);
  }

  let _ = app.emit("pnw://progress", serde_json::json!({ "stage":"done", "extracted": extracted_count }));
  Ok(())
}

/* ========================= main ========================= */

fn main() {
  tauri::Builder::default()
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      cmd_fetch_manifest,
      cmd_get_install_info,
      cmd_set_install_dir,
      cmd_pause_download,
      cmd_resume_download,
      cmd_cancel_download,
      cmd_download_and_install,
      cmd_launch_game,
      cmd_autodetect_install
    ])
    .run(tauri::generate_context!())
    .expect("erreur tauri");
}
