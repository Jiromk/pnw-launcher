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
use reqwest::blocking::Client;
use reqwest::header::{USER_AGENT, RANGE, IF_RANGE, CONTENT_LENGTH, CONTENT_RANGE, ACCEPT_ENCODING};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, State};
use tauri::Emitter;               // pour app.emit(...)
use walkdir::WalkDir;
use zip::ZipArchive;

/* ============== Modèles ============== */
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
  #[serde(default)] version: String,
  #[serde(default, rename="zip_url")] zip_url: String,
  #[serde(default, rename="url")] url: String,
  #[serde(default, rename="downloadUrl")] download_url: String,
}
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Config { #[serde(default)] install_dir: Option<String> } // dossier du jeu (parent de l’exe)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SaveBlob { path: String, modified: u64, bytes_b64: String }
#[derive(Default)] struct DlInner {
  cancel: bool, paused: bool, started: Option<Instant>, tmp_path: Option<PathBuf>,
  downloaded: u64, total: u64, window: Vec<(Instant, u64)>,
}
struct AppState { dl: Arc<Mutex<DlInner>> }

/* ============== Constantes ============== */
const APP_DIR_NAME: &str = "PNW Launcher";
const TMP_ZIP_NAME: &str = "pnw_tmp.zip";
const EXACT_EXE_NAMES: [&str; 4] = [
  "Pokémon New World.exe", "Pokemon New World.exe", "PokemonNewWorld.exe", "PNW.exe",
];
const MAX_ATTEMPTS: usize = 6;

/* ============== Utils ============== */
fn errs<E: std::fmt::Display>(e: E) -> String { e.to_string() }
fn app_local_dir() -> Result<PathBuf> {
  let base = dirs::data_local_dir().ok_or_else(|| anyhow!("no data_local_dir()"))?;
  Ok(base.join(APP_DIR_NAME))
}
fn config_path() -> Result<PathBuf> { Ok(app_local_dir()?.join("config.json")) }
fn read_config() -> Config {
  if let Ok(p)=config_path(){ if let Ok(s)=fs::read_to_string(p){ if let Ok(v)=serde_json::from_str(&s){ return v; } } }
  Config::default()
}
fn write_config(cfg:&Config)->Result<()>{
  let dir=app_local_dir()?;
  if !dir.exists(){fs::create_dir_all(&dir)?;}
  fs::write(dir.join("config.json"),serde_json::to_vec_pretty(cfg)?)?;
  Ok(())
}
fn default_install_dir()->Result<PathBuf>{ Ok(app_local_dir()?.join("Game")) }
fn current_install_dir()->Option<PathBuf>{
  let cfg=read_config();
  cfg.install_dir.map(PathBuf::from).or_else(|| default_install_dir().ok())
}
fn ensure_install_dir()->Result<PathBuf>{
  let dir=current_install_dir().ok_or_else(|| anyhow!("install_dir manquant"))?;
  if !dir.exists(){ fs::create_dir_all(&dir).context("create install dir")?; }
  Ok(dir)
}
fn parse_total_from_content_range(s:&str)->Option<u64>{ s.rsplit('/').next()?.parse().ok() }
fn window_speed_eta(win:&[(Instant,u64)], downloaded:u64, total:u64)->(u64,Option<u64>){
  if win.len()<2 {return (0,None);}
  let (t0,b0)=win.first().unwrap(); let (t1,b1)=win.last().unwrap();
  let dt=t1.duration_since(*t0).as_secs_f64().max(0.001); let db=(b1-b0) as f64;
  let speed=(db/dt) as u64; let eta= if speed>0 && total>downloaded { Some(((total-downloaded) as f64/speed as f64) as u64) } else { None };
  (speed,eta)
}
fn is_exact_game_exe(name:&str)->bool{ EXACT_EXE_NAMES.iter().any(|n| name.eq_ignore_ascii_case(n)) }
fn find_game_exe_in_dir(dir:&Path,max_depth:usize)->Option<PathBuf>{
  for e in WalkDir::new(dir).follow_links(false).max_depth(max_depth).into_iter().filter_map(|e|e.ok()){
    let p=e.path(); if p.is_file(){ if let Some(n)=p.file_name().and_then(|x|x.to_str()){ if is_exact_game_exe(n){ return Some(p.to_path_buf()); } } }
  } None
}
fn read_version(game_dir:&Path)->Result<String>{ Ok(fs::read_to_string(game_dir.join(".version"))?.trim().to_string()) }
fn write_version(game_dir:&Path,v:&str)->Result<()>{
  if !game_dir.exists(){ fs::create_dir_all(game_dir)?; }
  fs::write(game_dir.join(".version"),v)?; Ok(())
}
fn sanitize_zip_path(base:&Path,name:&str)->PathBuf{
  let mut path=base.to_path_buf();
  for comp in name.split(['\\','/']){ if comp==".."||comp.contains(':')||comp.is_empty(){continue;} path.push(comp); }
  path
}
fn zip_url(m:&Manifest)->&str{
  if !m.download_url.is_empty(){&m.download_url}
  else if !m.zip_url.is_empty(){&m.zip_url}
  else if !m.url.is_empty(){&m.url}
  else{""}
}

/* ============== Commands ============== */
#[tauri::command]
fn cmd_fetch_manifest(manifest_url:String)->Result<Manifest,String>{
  let client=Client::builder().timeout(Duration::from_secs(30)).build().map_err(errs)?;
  Ok(client.get(manifest_url).header(USER_AGENT,"pnw-launcher").header(ACCEPT_ENCODING,"identity")
    .send().and_then(|r|r.error_for_status()).map_err(errs)?.json().map_err(errs)?)
}
#[tauri::command]
fn cmd_get_install_info()->Result<serde_json::Value,String>{
  if let Some(dir)=current_install_dir(){
    let has_exe=find_game_exe_in_dir(&dir,2).is_some();
    let ver=read_version(&dir).ok(); let has_version=ver.is_some();
    return Ok(json!({"installDir":dir.to_string_lossy(),"version":ver,"hasExe":has_exe,"hasVersion":has_version,"hasGame":has_exe}));
  }
  Ok(json!({"installDir":"","version":serde_json::Value::Null,"hasExe":false,"hasVersion":false,"hasGame":false}))
}
#[tauri::command]
fn cmd_set_default_install_dir()->Result<serde_json::Value,String>{
  let dir=default_install_dir().map_err(errs)?; if !dir.exists(){fs::create_dir_all(&dir).map_err(errs)?;}
  let mut cfg=read_config(); cfg.install_dir=Some(dir.to_string_lossy().to_string()); write_config(&cfg).map_err(errs)?;
  Ok(json!({"ok":true,"installDir":dir.to_string_lossy()}))
}
#[tauri::command]
fn cmd_set_install_dir(path:String)->Result<serde_json::Value,String>{
  let p=PathBuf::from(&path); if !p.exists(){fs::create_dir_all(&p).map_err(errs)?;}
  let mut cfg=read_config(); cfg.install_dir=Some(path.clone()); write_config(&cfg).map_err(errs)?;
  Ok(json!({"ok":true,"installDir":path}))
}
#[tauri::command]
fn cmd_download_and_install(app:AppHandle, state:State<AppState>, manifest:Manifest)->Result<(),String>{
  let dl_arc:Arc<Mutex<DlInner>>=state.dl.clone();
  thread::spawn(move||{ if let Err(e)=run_download_and_install(&app,&dl_arc,&manifest){ let _=app.emit("pnw://error",json!({"error":e})); }});
  Ok(())
}
fn temp_zip_path()->Result<PathBuf>{ Ok(app_local_dir()?.join(TMP_ZIP_NAME)) }
fn run_download_and_install(app:&AppHandle, dl:&Arc<Mutex<DlInner>>, manifest:&Manifest)->Result<(),String>{
  let client=Client::builder().timeout(Duration::from_secs(60)).build().map_err(errs)?;
  let tmp_path=temp_zip_path().map_err(errs)?; if let Some(p)=tmp_path.parent(){ if !p.exists(){fs::create_dir_all(p).map_err(errs)?;} }
  let mut downloaded:u64= if tmp_path.exists(){fs::metadata(&tmp_path).map_err(errs)?.len()} else{0}; let mut total:u64=0;
  { let mut s=dl.lock().unwrap(); s.cancel=false; s.paused=false; s.window.clear(); s.started=Some(Instant::now()); s.tmp_path=Some(tmp_path.clone()); s.downloaded=downloaded; s.total=0; s.window.push((Instant::now(),downloaded)); }
  let link=zip_url(manifest).to_string(); if link.is_empty(){ return Err("Manifest sans URL".into()); }

  let mut etag:Option<String>=None;
  if let Ok(head)=client.head(&link).header(USER_AGENT,"pnw-launcher").header(ACCEPT_ENCODING,"identity").send(){
    if let Some(v)=head.headers().get(CONTENT_LENGTH).and_then(|v|v.to_str().ok()).and_then(|s|s.parse::<u64>().ok()){ total=v; }
    if let Some(v)=head.headers().get("ETag"){ etag=v.to_str().ok().map(|s|s.trim_matches('"').to_string()); }
  }
  let _=app.emit("pnw://progress",json!({"stage":"download","total":total,"downloaded":downloaded}));

  let mut attempt=0usize;
  loop{
    if dl.lock().unwrap().cancel { return Err("annulé".into()); }
    while dl.lock().unwrap().paused { let _=app.emit("pnw://progress",json!({"stage":"paused"})); thread::sleep(Duration::from_millis(200)); if dl.lock().unwrap().cancel { return Err("annulé".into()); } }
    let mut req=client.get(&link).header(USER_AGENT,"pnw-launcher").header(ACCEPT_ENCODING,"identity");
    if downloaded>0 { req=req.header(RANGE,format!("bytes={}-",downloaded)); if let Some(et)=&etag{ req=req.header(IF_RANGE,et.clone()); } }
    let mut resp=match req.send(){ Ok(r)=>r, Err(e)=>{ let _=app.emit("pnw://progress",json!({"stage":"reconnect"})); attempt+=1; if attempt>MAX_ATTEMPTS { return Err(format!("échec réseau: {e}")); } thread::sleep(Duration::from_secs((2u64.pow(attempt as u32)).min(30))); continue; } };
    if let Some(v)=resp.headers().get(CONTENT_RANGE).and_then(|v|v.to_str().ok()){ if let Some(t)=parse_total_from_content_range(v){ total=t; } }
    else if let Some(v)=resp.headers().get(CONTENT_LENGTH).and_then(|v|v.to_str().ok()).and_then(|s|s.parse::<u64>().ok()){ if downloaded==0 { total=v; } }

    let mut file=OpenOptions::new().create(true).append(downloaded>0).write(true).truncate(downloaded==0).open(&tmp_path).map_err(errs)?;
    let mut buf=vec![0u8;64*1024]; let mut last_tick=Instant::now();
    loop{
      if dl.lock().unwrap().cancel { return Err("annulé".into()); }
      while dl.lock().unwrap().paused { let _=app.emit("pnw://progress",json!({"stage":"paused"})); thread::sleep(Duration::from_millis(150)); if dl.lock().unwrap().cancel { return Err("annulé".into()); } }
      let n=resp.read(&mut buf).map_err(errs)?; if n==0 { break; } file.write_all(&buf[..n]).map_err(errs)?; downloaded+=n as u64;
      { let mut s=dl.lock().unwrap(); s.downloaded=downloaded; s.total=total; s.window.push((Instant::now(),downloaded)); while s.window.len()>30 { s.window.remove(0); }
        let (speed_bps,eta_secs)=window_speed_eta(&s.window,downloaded,total);
        if last_tick.elapsed()>=Duration::from_millis(150){ last_tick=Instant::now(); let _=app.emit("pnw://progress",json!({"stage":"download","downloaded":downloaded,"total":total,"speed_bps":speed_bps,"eta_secs":eta_secs})); } }
      if total>0 && downloaded>=total { break; }
    }
    if total>0 && downloaded>=total { break; }
    attempt+=1; if attempt>MAX_ATTEMPTS { return Err("échec après plusieurs tentatives".into()); }
    thread::sleep(Duration::from_secs((2u64.pow(attempt as u32)).min(30)));
  }

  // Extraction
  let _=app.emit("pnw://progress",json!({"stage":"extract"}));
  let install_root= { let cfg_dir=current_install_dir().unwrap_or(default_install_dir().map_err(errs)?); if !cfg_dir.exists(){fs::create_dir_all(&cfg_dir).map_err(errs)?;} cfg_dir };
  let file=std::fs::File::open(&tmp_path).map_err(errs)?; let mut archive=ZipArchive::new(file).map_err(errs)?;
  for i in 0..archive.len(){
    let mut f=archive.by_index(i).map_err(errs)?; let outpath=sanitize_zip_path(&install_root,f.name());
    if f.name().ends_with('/') { fs::create_dir_all(&outpath).map_err(errs)?; }
    else { if let Some(p)=outpath.parent(){ if !p.exists(){fs::create_dir_all(p).map_err(errs)?;} } let mut outfile=std::fs::File::create(&outpath).map_err(errs)?; std::io::copy(&mut f,&mut outfile).map_err(errs)?; }
  }
  let _=fs::remove_file(&tmp_path);

  // Pointe la config sur le dossier contenant l'EXE et écrit .version à côté
  if let Some(exe)=find_game_exe_in_dir(&install_root,10){
    let game_dir=exe.parent().unwrap_or(&install_root).to_path_buf();
    write_version(&game_dir,&manifest.version).map_err(errs)?;
    let mut cfg=read_config(); cfg.install_dir=Some(game_dir.to_string_lossy().to_string()); write_config(&cfg).map_err(errs)?;
  } else {
    write_version(&install_root,&manifest.version).map_err(errs)?;
  }
  let _=app.emit("pnw://progress",json!({"stage":"done"}));
  Ok(())
}

#[tauri::command] fn cmd_pause_download(state:State<AppState>)->Result<(),String>{ if let Ok(mut s)=state.dl.lock(){s.paused=true;} Ok(()) }
#[tauri::command] fn cmd_resume_download(state:State<AppState>)->Result<(),String>{ if let Ok(mut s)=state.dl.lock(){s.paused=false;} Ok(()) }
#[tauri::command] fn cmd_cancel_download(state:State<AppState>)->Result<(),String>{ if let Ok(mut s)=state.dl.lock(){s.cancel=true;} Ok(()) }

#[tauri::command]
fn cmd_launch_game(_exe_name:String)->Result<(),String>{
  let dir=current_install_dir().ok_or_else(||"Dossier du jeu non défini".to_string())?;
  let exe=find_game_exe_in_dir(&dir,2).ok_or_else(||"Exécutable PNW introuvable".to_string())?;
  #[cfg(target_os="windows")] { use std::process::Command; Command::new(&exe).current_dir(&dir).spawn().map_err(errs)?; }
  Ok(())
}

/* Saves */
fn looks_like_save_file(name:&str)->bool{ name.ends_with(".rxdata")||name.ends_with(".sav")||name.eq_ignore_ascii_case("Game.rxdata") }
fn latest_save_from_dir(game_dir:&Path)->Option<(PathBuf,SystemTime)>{
  for e in WalkDir::new(game_dir).max_depth(4).into_iter().filter_map(|e|e.ok()){
    let p=e.path(); if p.is_file(){ if let Some(n)=p.file_name().and_then(|x|x.to_str()){ if looks_like_save_file(n){ let m=p.metadata().ok()?.modified().ok()?; return Some((p.to_path_buf(),m)); } } }
  } None
}
#[tauri::command]
fn cmd_latest_save_blob()->Result<Option<SaveBlob>,String>{
  let game_dir=match current_install_dir(){ Some(p)=>p, None=>return Ok(None) };
  if let Some((path,mtime))=latest_save_from_dir(&game_dir){
    let bytes=fs::read(&path).map_err(errs)?; let b64=general_purpose::STANDARD.encode(bytes);
    let modified=mtime.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    return Ok(Some(SaveBlob{path:path.to_string_lossy().to_string(),modified,bytes_b64:b64}));
  }
  Ok(None)
}

/* ============== Entrée ============== */
fn main() {
  tauri::Builder::default()
    .manage(AppState{ dl: Arc::new(Mutex::new(DlInner::default())) })
    .plugin(tauri_plugin_dialog::init())  // <— IMPORTANT pour open() côté front
    .invoke_handler(tauri::generate_handler![
      cmd_fetch_manifest,
      cmd_get_install_info,
      cmd_set_install_dir,
      cmd_set_default_install_dir,
      cmd_download_and_install,
      cmd_pause_download,
      cmd_resume_download,
      cmd_cancel_download,
      cmd_launch_game,
      cmd_latest_save_blob,
    ])
    .run(tauri::generate_context!())
    .expect("erreur au démarrage");
}
