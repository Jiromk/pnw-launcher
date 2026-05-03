//! game_window.rs — Localisation de la fenêtre du jeu PNW via Win32.
//!
//! Utilisé par l'overlay chat PVP pour se positionner à droite du jeu.
//! On passe par le PID (déjà détecté par sysinfo) puis EnumWindows pour
//! trouver la HWND associée — plus robuste qu'un match sur le titre.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct GameWindowRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub is_fullscreen: bool,
}

#[cfg(windows)]
fn find_game_pids() -> Vec<u32> {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All);
    let mut pids = Vec::new();
    for proc in sys.processes().values() {
        let name = proc.name().to_string_lossy().to_ascii_lowercase();
        if name.contains("pokémon new world") || name.contains("pokemon new world")
            || name == "game.exe" || name == "pnw.exe"
        {
            pids.push(proc.pid().as_u32());
        }
    }
    pids
}

#[cfg(windows)]
struct EnumState {
    target_pids: Vec<u32>,
    found: Option<windows_sys::Win32::Foundation::HWND>,
}

#[cfg(windows)]
unsafe extern "system" fn enum_proc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::BOOL {
    use windows_sys::Win32::Foundation::{FALSE, RECT, TRUE};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
    };

    let state = unsafe { &mut *(lparam as *mut EnumState) };
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return TRUE;
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if !state.target_pids.contains(&pid) {
        return TRUE;
    }
    // Skip les fenêtres invisibles/petites (tray, tooltips RGSS, splash 1x1)
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return TRUE;
    }
    if rect.right - rect.left < 200 || rect.bottom - rect.top < 200 {
        return TRUE;
    }
    state.found = Some(hwnd);
    FALSE // stop énumération
}

#[cfg(windows)]
pub fn find_game_window_rect() -> Option<GameWindowRect> {
    use windows_sys::Win32::Foundation::{LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowRect};

    let pids = find_game_pids();
    if pids.is_empty() {
        return None;
    }
    let mut state = EnumState {
        target_pids: pids,
        found: None,
    };
    unsafe { EnumWindows(Some(enum_proc), &mut state as *mut _ as LPARAM) };
    let hwnd = state.found?;

    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return None;
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;

    // Détection plein écran : fenêtre couvre l'intégralité du moniteur.
    // Couvre aussi le borderless windowed fullscreen (très commun pour les jeux).
    let mut is_fullscreen = false;
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if !monitor.is_null() {
        let mut mi: MONITORINFO = unsafe { std::mem::zeroed() };
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if unsafe { GetMonitorInfoW(monitor, &mut mi) } != 0 {
            let mw = mi.rcMonitor.right - mi.rcMonitor.left;
            let mh = mi.rcMonitor.bottom - mi.rcMonitor.top;
            is_fullscreen = width >= mw
                && height >= mh
                && rect.left <= mi.rcMonitor.left
                && rect.top <= mi.rcMonitor.top;
        }
    }

    Some(GameWindowRect {
        x: rect.left,
        y: rect.top,
        width,
        height,
        is_fullscreen,
    })
}

#[cfg(not(windows))]
pub fn find_game_window_rect() -> Option<GameWindowRect> {
    None
}

/// Retourne la position/taille de la fenêtre du jeu PNW (ou null si pas trouvée).
/// `is_fullscreen` est true si la fenêtre couvre tout son moniteur (cas où
/// l'overlay chat doit être caché).
#[tauri::command]
pub fn cmd_get_game_window_rect() -> Option<GameWindowRect> {
    find_game_window_rect()
}
