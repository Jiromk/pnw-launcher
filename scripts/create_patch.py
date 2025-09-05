#!/usr/bin/env python3
"""
Script de création de patch pour Pokemon New World
Usage: python create_patch.py [version] [dossier_jeu]
"""

import os
import json
import hashlib
import zipfile
from datetime import datetime
from pathlib import Path
import shutil
import argparse

class PatchCreator:
    def __init__(self, game_path, version, previous_version=None):
        self.game_path = Path(game_path)
        self.version = version
        self.previous_version = previous_version
        self.output_dir = Path("patches")
        self.output_dir.mkdir(exist_ok=True)
        
        # Fichiers à exclure
        self.exclude_patterns = [
            "*.log", "*.tmp", "*.bak", 
            "Save*.rxdata", "save*.dat",
            "launcher_config.ini", "version.txt"
        ]
        
    def calculate_file_hash(self, filepath):
        """Calcule le hash SHA256 d'un fichier"""
        sha256_hash = hashlib.sha256()
        with open(filepath, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()
    
    def should_exclude(self, filepath):
        """Vérifie si un fichier doit être exclu"""
        name = os.path.basename(filepath)
        for pattern in self.exclude_patterns:
            if pattern.startswith("*") and name.endswith(pattern[1:]):
                return True
            elif pattern == name:
                return True
        return False
    
    def scan_game_files(self):
        """Scanne tous les fichiers du jeu"""
        files_data = []
        
        for root, dirs, files in os.walk(self.game_path):
            # Exclure certains dossiers
            dirs[:] = [d for d in dirs if d not in ['.git', '__pycache__', 'patches']]
            
            for file in files:
                filepath = Path(root) / file
                
                if self.should_exclude(str(filepath)):
                    continue
                
                relative_path = filepath.relative_to(self.game_path)
                
                file_info = {
                    "path": str(relative_path).replace("\\", "/"),
                    "hash": f"sha256:{self.calculate_file_hash(filepath)}",
                    "size": os.path.getsize(filepath),
                    "action": "update"
                }
                
                files_data.append(file_info)
        
        return files_data
    
    def create_manifest(self, changelog_fr="", changelog_en=""):
        """Crée le fichier manifest.json"""
        files_data = self.scan_game_files()
        
        manifest = {
            "name": "Pokemon New World",
            "version": self.version,
            "releaseDate": datetime.now().isoformat() + "Z",
            "minimumLauncherVersion": "1.0.0",
            "changelog": {
                "fr": changelog_fr or f"## Version {self.version}\n- Mise à jour",
                "en": changelog_en or f"## Version {self.version}\n- Update"
            },
            "downloadUrl": f"https://github.com/YOUR_USERNAME/pokemon-new-world-updates/releases/download/v{self.version}/patch_{self.version}.zip",
            "files": files_data,
            "requirements": {
                "minimumRAM": 2048,
                "diskSpace": 500000000
            }
        }
        
        # Calculer la taille totale
        total_size = sum(f["size"] for f in files_data)
        manifest["downloadSize"] = total_size
        
        return manifest
    
    def create_patch_archive(self, manifest):
        """Crée l'archive ZIP du patch"""
        patch_name = f"patch_{self.version}.zip"
        patch_path = self.output_dir / patch_name
        
        print(f"Création du patch {patch_name}...")
        
        with zipfile.ZipFile(patch_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Ajouter tous les fichiers du jeu
            for file_info in manifest["files"]:
                file_path = self.game_path / file_info["path"]
                if file_path.exists():
                    arcname = file_info["path"]
                    zipf.write(file_path, arcname)
                    print(f"  Ajout: {arcname}")
            
            # Ajouter le manifest dans l'archive
            manifest_str = json.dumps(manifest, indent=2, ensure_ascii=False)
            zipf.writestr("manifest.json", manifest_str)
        
        # Calculer le hash de l'archive
        archive_hash = self.calculate_file_hash(patch_path)
        archive_size = os.path.getsize(patch_path)
        
        # Mettre à jour le manifest avec les infos de l'archive
        manifest["integrity"] = {
            "archiveHash": f"sha256:{archive_hash}",
            "archiveSize": archive_size
        }
        
        print(f"✅ Patch créé: {patch_path}")
        print(f"   Taille: {archive_size / 1024 / 1024:.2f} MB")
        print(f"   Hash: {archive_hash}")
        
        return patch_path, manifest
    
    def create_delta_patch(self, previous_manifest_path):
        """Crée un patch delta (seulement les fichiers modifiés)"""
        with open(previous_manifest_path, 'r', encoding='utf-8') as f:
            previous_manifest = json.load(f)
        
        previous_files = {f["path"]: f["hash"] for f in previous_manifest["files"]}
        current_files = self.scan_game_files()
        
        delta_files = []
        
        for file_info in current_files:
            path = file_info["path"]
            
            # Nouveau fichier ou fichier modifié
            if path not in previous_files or previous_files[path] != file_info["hash"]:
                file_info["action"] = "add" if path not in previous_files else "update"
                delta_files.append(file_info)
        
        # Fichiers supprimés
        for old_path in previous_files:
            if not any(f["path"] == old_path for f in current_files):
                delta_files.append({
                    "path": old_path,
                    "action": "delete"
                })
        
        return delta_files
    
    def save_manifest(self, manifest):
        """Sauvegarde le manifest"""
        # Sauvegarder dans le dossier manifests
        manifests_dir = Path("manifests")
        manifests_dir.mkdir(exist_ok=True)
        
        version_manifest = manifests_dir / f"{self.version}.json"
        with open(version_manifest, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        
        # Sauvegarder comme latest.json
        with open("latest.json", 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Manifest sauvegardé: {version_manifest}")
        print(f"✅ latest.json mis à jour")
    
    def create_version_file(self):
        """Crée un fichier version.txt dans le jeu"""
        version_file = self.game_path / "version.txt"
        with open(version_file, 'w') as f:
            f.write(self.version)
        print(f"✅ Fichier version.txt créé: {self.version}")

def main():
    parser = argparse.ArgumentParser(description="Créateur de patch pour Pokemon New World")
    parser.add_argument("version", help="Numéro de version (ex: 1.2.0)")
    parser.add_argument("game_path", help="Chemin vers le dossier du jeu")
    parser.add_argument("--previous", help="Chemin vers le manifest de la version précédente (pour delta patch)")
    parser.add_argument("--changelog-fr", help="Changelog en français", default="")
    parser.add_argument("--changelog-en", help="Changelog en anglais", default="")
    parser.add_argument("--delta", action="store_true", help="Créer un patch delta (seulement les modifications)")
    
    args = parser.parse_args()
    
    # Vérifier que le dossier du jeu existe
    if not os.path.exists(args.game_path):
        print(f"❌ Erreur: Le dossier {args.game_path} n'existe pas")
        return
    
    creator = PatchCreator(args.game_path, args.version)
    
    # Créer le manifest
    print(f"📦 Création du patch version {args.version}")
    print(f"📂 Dossier du jeu: {args.game_path}")
    
    if args.delta and args.previous:
        print("🔄 Mode delta: création d'un patch différentiel")
        # TODO: Implémenter le patch delta
        manifest = creator.create_manifest(args.changelog_fr, args.changelog_en)
        manifest["files"] = creator.create_delta_patch(args.previous)
    else:
        print("📋 Scan des fichiers du jeu...")
        manifest = creator.create_manifest(args.changelog_fr, args.changelog_en)
    
    # Créer l'archive
    patch_path, updated_manifest = creator.create_patch_archive(manifest)
    
    # Sauvegarder le manifest
    creator.save_manifest(updated_manifest)
    
    # Créer le fichier version
    creator.create_version_file()
    
    print("\n✨ Patch créé avec succès!")
    print(f"📦 Archive: {patch_path}")
    print("\n📝 Prochaines étapes:")
    print("1. Committez latest.json et le manifest dans manifests/")
    print("2. Créez une release GitHub avec le tag v" + args.version)
    print("3. Uploadez le fichier patch_" + args.version + ".zip dans la release")
    print("4. Mettez à jour l'URL dans latest.json avec l'URL réelle de téléchargement")

if __name__ == "__main__":
    main()