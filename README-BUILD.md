# Guide de compilation pour Windows

## Compilation

Pour créer le build de l'application, exécutez simplement:

```bash
npm run tauri:build
```

Cette commande va:
1. Compiler le frontend avec Vite
2. Compiler le backend Rust avec Tauri
3. Créer l'installateur NSIS

## Prérequis

Assurez-vous d'avoir installé:

- **Visual Studio 2026 ou 2022** (Community ou supérieur) avec:
  - Desktop development with C++
  - Windows 10/11 SDK
- **Rust** (installé via rustup)
- **Node.js et npm**
- **NSIS** (pour créer l'installateur)
  - Télécharger depuis: https://nsis.sourceforge.io/Download
  - Ajouter `C:\Program Files (x86)\NSIS` au PATH système Windows

## Diagnostic

Si vous rencontrez des problèmes de compilation, vous pouvez utiliser le script de diagnostic:

```powershell
powershell -ExecutionPolicy Bypass -File fix-rust-build.ps1
```

## Emplacement des fichiers générés

Après le build, vous trouverez:
- **Exécutable**: `src-tauri/target/release/pnw-launcher.exe`
- **Installateur**: `src-tauri/target/release/bundle/nsis/PNW Launcher_1.0.0_x64-setup.exe`





