#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
  fs,
  io::{Read, Write},
  path::PathBuf,
  time::Duration
};
use serde::{Deserialize, Serialize};
use tauri::Emitter; // 👈 nécessaire pour .emit(...)
use anyhow::Result;
use std::fs::File;
use walkdir::WalkDir;

#[derive(Default)]
struct AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Manifest {
  version: String,
  zip_url: String,
  game_exe: Option<String>,
  folder: Option<String>,
}

#[tauri::command]
fn cmd_fetch_manifest(manifest_url: String) -> Result<Manifest, String> {
  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(30))
    .build().map_err(err)?;
  let m: Manifest = client.get(manifest_url).send()
    .and_then(|r| r.error_for_status())
    .map_err(err)?.json().map_err(err)?;
  Ok(m)
}

#[tauri::command]
fn cmd_get_install_info() -> Result<serde_json::Value, String> {
  let dir = install_dir()?;
  let ver = read_version(&dir).ok();
  Ok(serde_json::json!({ "installDir": dir.to_string_lossy(), "version": ver }))
}

#[tauri::command]
fn cmd_download_and_install(app: tauri::AppHandle, manifest: Manifest) -> Result<serde_json::Value, String> {
  let client = reqwest::blocking::Client::builder()
    .timeout(Duration::from_secs(600))
    .build().map_err(err)?;

  // 1) Download (blocking + Read + progress)
  let mut resp = client.get(&manifest.zip_url).send()
    .and_then(|r| r.error_for_status())
    .map_err(err)?;
  let total = resp.content_length().unwrap_or(0);

  let mut tmp = tempfile::NamedTempFile::new().map_err(err)?;
  let mut downloaded: u64 = 0;
  let mut buf = [0u8; 64 * 1024];
  loop {
    let n = resp.read(&mut buf).map_err(err)?;
    if n == 0 { break; }
    tmp.write_all(&buf[..n]).map_err(err)?;
    downloaded += n as u64;
    let _ = app.emit("pnw://progress", serde_json::json!({
      "downloaded": downloaded, "total": total, "stage": "download"
    }));
  }

  // 2) Extract
  let target = install_dir()?;
  if !target.exists() { fs::create_dir_all(&target).map_err(err)?; }

  let _ = app.emit("pnw://progress", serde_json::json!({
    "downloaded": 0, "total": 1, "stage": "extract"
  }));

  let f = File::open(tmp.path()).map_err(err)?;
  let mut archive = zip::ZipArchive::new(f).map_err(err)?;
  for i in 0..archive.len() {
    let mut file = archive.by_index(i).map_err(err)?;
    let outpath = sanitize_zip_path(&target, &file.name());

    if file.is_dir() {
      fs::create_dir_all(&outpath).map_err(err)?;
    } else {
      if let Some(p) = outpath.parent() { fs::create_dir_all(p).map_err(err)?; }
      let mut outfile = File::create(&outpath).map_err(err)?;
      std::io::copy(&mut file, &mut outfile).map_err(err)?;
      #[cfg(unix)]
      {
        use std::os::unix::fs::PermissionsExt;
        if let Some(mode) = file.unix_mode() {
          fs::set_permissions(&outpath, fs::Permissions::from_mode(mode)).ok();
        }
      }
    }
  }

  // 3) Version file
  write_version(&target, &manifest.version).ok();

  // 4) Find exe
  let exe_path = find_game_exe(&target, manifest.game_exe.as_deref().unwrap_or("Game.exe"))
    .map_err(err)?;

  Ok(serde_json::json!({
    "installDir": target.to_string_lossy(),
    "exePath": exe_path.to_string_lossy()
  }))
}

#[tauri::command]
fn cmd_launch_game(exe_name: String) -> Result<(), String> {
  let dir = install_dir()?;
  let exe = find_game_exe(&dir, &exe_name).map_err(err)?;
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new(&exe)
      .current_dir(exe.parent().unwrap_or(&dir))
      .spawn().map_err(err)?;
  }
  #[cfg(not(target_os = "windows"))]
  {
    std::process::Command::new(&exe).spawn().map_err(err)?;
  }
  Ok(())
}

fn install_dir() -> Result<PathBuf, String> {
  let base = dirs::data_local_dir().ok_or("data_local_dir introuvable")?;
  Ok(base.join("PNW").join("Game"))
}

fn find_game_exe(dir: &PathBuf, exe_name: &str) -> Result<PathBuf, anyhow::Error> {
  let candidate = dir.join(exe_name);
  if candidate.exists() { return Ok(candidate); }
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

fn sanitize_zip_path(base: &PathBuf, name: &str) -> PathBuf {
  let mut path = base.clone();
  for comp in name.split(['\\','/']) {
    if comp == ".." || comp.contains(':') { continue; }
    if comp.is_empty() { continue; }
    path.push(comp);
  }
  path
}

fn err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

fn main() {
  tauri::Builder::default()
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      cmd_fetch_manifest,
      cmd_get_install_info,
      cmd_download_and_install,
      cmd_launch_game
    ])
    .run(tauri::generate_context!())
    .expect("erreur tauri");
}
