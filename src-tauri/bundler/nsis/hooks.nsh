; Hooks NSIS Tauri 2 — macros : NSIS_HOOK_PREINSTALL, NSIS_HOOK_POSTINSTALL,
; NSIS_HOOK_PREUNINSTALL, NSIS_HOOK_POSTUNINSTALL
; (voir https://v2.tauri.app/distribute/windows-installer/ )

; --- PREINSTALL : marqueur pour distinguer mise à jour vs désinstallation ---
; Ce hook s'exécute UNIQUEMENT quand l'installeur tourne (install ou mise à jour),
; JAMAIS lors d'une désinstallation standalone via Ajout/Suppression de programmes.
!macro NSIS_HOOK_PREINSTALL
  CreateDirectory "$LOCALAPPDATA\PNW Launcher"
  FileOpen $0 "$LOCALAPPDATA\PNW Launcher\.pnw_updating" w
  FileWrite $0 "1"
  FileClose $0
!macroend

; --- POSTINSTALL : nettoyer le marqueur une fois l'installation terminée ---
; Sans ça, sur une première install (pas d'ancien désinstalleur), le marqueur
; resterait indéfiniment et bloquerait toute future désinstallation.
!macro NSIS_HOOK_POSTINSTALL
  Delete "$LOCALAPPDATA\PNW Launcher\.pnw_updating"
!macroend

; --- POSTUNINSTALL : nettoyage conditionnel ---
!macro NSIS_HOOK_POSTUNINSTALL
  ; Raccourcis legacy
  Delete "$DESKTOP\Pokemon New World.lnk"
  Delete "$SMPROGRAMS\Pokemon New World\Launcher.lnk"
  RMDir "$SMPROGRAMS\Pokemon New World"

  ; Vérifier si c'est une mise à jour (marqueur créé par PREINSTALL)
  IfFileExists "$LOCALAPPDATA\PNW Launcher\.pnw_updating" 0 _pnw_not_updating
    ; === MISE À JOUR : ne toucher à rien (jeu, config, saves) ===
    Delete "$LOCALAPPDATA\PNW Launcher\.pnw_updating"
    Delete "$LOCALAPPDATA\PNW Launcher\pnw_launcher_update.exe"
    Goto _pnw_done

  _pnw_not_updating:
    ; === DÉSINSTALLATION depuis Ajout/Suppression de programmes ===
    IntCmp $DeleteAppDataCheckboxState 1 _pnw_full_cleanup _pnw_light_cleanup _pnw_light_cleanup

  _pnw_full_cleanup:
    ; Checkbox cochée → suppression complète (jeu + config + saves)
    RMDir /r /REBOOTOK "$LOCALAPPDATA\PNW Launcher"
    Goto _pnw_done

  _pnw_light_cleanup:
    ; Checkbox non cochée → temporaires seulement, garder jeu + config + saves
    Delete "$LOCALAPPDATA\PNW Launcher\pnw_launcher_update.exe"
    Delete "$LOCALAPPDATA\PNW Launcher\.pnw_updating"
    Delete "$LOCALAPPDATA\PNW Launcher\.pnw_hook_ran"

  _pnw_done:
!macroend
