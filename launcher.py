#!/usr/bin/env python3
"""
Pokemon New World Launcher
Launcher avec mise à jour automatique
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import json
import hashlib
import os
import sys
import requests
import threading
import zipfile
import subprocess
from pathlib import Path
import configparser
from datetime import datetime
import shutil
import tempfile

class PokemonNewWorldLauncher:
    def __init__(self, root):
        self.root = root
        self.root.title("Pokemon New World Launcher")
        self.root.geometry("900x650")
        self.root.resizable(False, False)
        
        # Configuration
        self.config_file = "launcher_config.ini"
        self.version_file = "launcher_version.txt"
        self.launcher_version = "1.0.0"
        self.game_exe = "Game.exe"  # Nom de l'exécutable du jeu
        
        # URLs
        self.github_repo = "Jiromk/pnw-launcher"
        self.manifest_url = f"https://raw.githubusercontent.com/{self.github_repo}/main/latest.json"
        
        # Paths
        self.game_path = self.load_game_path()
        self.current_version = self.get_current_version()
        
        # Variables d'état
        self.is_downloading = False
        self.is_checking = False
        self.download_cancelled = False
        self.total_size = 0
        self.downloaded_size = 0
        
        # Configuration de style
        self.setup_styles()
        
        # Interface
        self.setup_ui()
        
        # Vérification automatique au démarrage
        self.root.after(500, self.check_updates_silent)
    
    def setup_styles(self):
        """Configure les styles de l'interface"""
        style = ttk.Style()
        style.theme_use('clam')
        
        # Couleurs personnalisées
        self.colors = {
            'bg': '#2b2b2b',
            'fg': '#ffffff',
            'button': '#4a90e2',
            'button_hover': '#357abd',
            'success': '#5cb85c',
            'danger': '#d9534f',
            'warning': '#f0ad4e',
            'text_bg': '#3c3c3c'
        }
        
        self.root.configure(bg=self.colors['bg'])
    
    def load_game_path(self):
        """Charge le chemin du jeu depuis la configuration"""
        config = configparser.ConfigParser()
        if os.path.exists(self.config_file):
            config.read(self.config_file)
            return config.get('Game', 'path', fallback='game')
        return 'game'
    
    def save_game_path(self, path):
        """Sauvegarde le chemin du jeu"""
        config = configparser.ConfigParser()
        config['Game'] = {'path': path}
        with open(self.config_file, 'w') as f:
            config.write(f)
        self.game_path = path
    
    def get_current_version(self):
        """Récupère la version actuelle du jeu"""
        version_file = os.path.join(self.game_path, 'version.txt')
        if os.path.exists(version_file):
            try:
                with open(version_file, 'r') as f:
                    return f.read().strip()
            except:
                pass
        return "0.0.0"
    
    def set_current_version(self, version):
        """Met à jour la version actuelle"""
        self.current_version = version
        version_file = os.path.join(self.game_path, 'version.txt')
        os.makedirs(self.game_path, exist_ok=True)
        with open(version_file, 'w') as f:
            f.write(version)
        self.version_label.config(text=f"Version installée : {version}")
    
    def setup_ui(self):
        """Configuration de l'interface utilisateur"""
        # Frame principal avec padding
        main_frame = tk.Frame(self.root, bg=self.colors['bg'], padx=30, pady=20)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Titre avec logo (si disponible)
        title_frame = tk.Frame(main_frame, bg=self.colors['bg'])
        title_frame.pack(fill=tk.X, pady=(0, 20))
        
        title_label = tk.Label(title_frame, text="Pokemon New World", 
                              font=('Arial', 28, 'bold'),
                              bg=self.colors['bg'], fg=self.colors['fg'])
        title_label.pack()
        
        subtitle_label = tk.Label(title_frame, text="Launcher Officiel", 
                                 font=('Arial', 12),
                                 bg=self.colors['bg'], fg='#888888')
        subtitle_label.pack()
        
        # Frame d'informations
        info_frame = tk.Frame(main_frame, bg=self.colors['bg'])
        info_frame.pack(fill=tk.X, pady=(0, 15))
        
        # Version actuelle
        self.version_label = tk.Label(info_frame, 
                                     text=f"Version installée : {self.current_version}",
                                     font=('Arial', 11),
                                     bg=self.colors['bg'], fg=self.colors['fg'])
        self.version_label.pack(side=tk.LEFT)
        
        # Version disponible
        self.available_version_label = tk.Label(info_frame, 
                                               text="",
                                               font=('Arial', 11),
                                               bg=self.colors['bg'], fg=self.colors['success'])
        self.available_version_label.pack(side=tk.LEFT, padx=(20, 0))
        
        # Statut
        self.status_label = tk.Label(info_frame,
                                    text="",
                                    font=('Arial', 11),
                                    bg=self.colors['bg'], fg=self.colors['warning'])
        self.status_label.pack(side=tk.RIGHT)
        
        # Zone de changelog
        changelog_frame = tk.Frame(main_frame, bg=self.colors['bg'])
        changelog_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 15))
        
        changelog_label = tk.Label(changelog_frame, text="Notes de mise à jour :",
                                  font=('Arial', 12, 'bold'),
                                  bg=self.colors['bg'], fg=self.colors['fg'])
        changelog_label.pack(anchor=tk.W, pady=(0, 5))
        
        # Frame pour le text widget avec bordure
        text_frame = tk.Frame(changelog_frame, bg='#555555', bd=1)
        text_frame.pack(fill=tk.BOTH, expand=True)
        
        # Textbox pour changelog
        self.changelog_text = tk.Text(text_frame, height=15, width=80,
                                     wrap=tk.WORD, 
                                     bg=self.colors['text_bg'],
                                     fg=self.colors['fg'],
                                     font=('Consolas', 10),
                                     bd=0, padx=10, pady=10)
        self.changelog_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        # Scrollbar pour changelog
        scrollbar = ttk.Scrollbar(text_frame, orient=tk.VERTICAL,
                                 command=self.changelog_text.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.changelog_text.config(yscrollcommand=scrollbar.set)
        
        # Message par défaut
        self.changelog_text.insert('1.0', "Bienvenue dans Pokemon New World !\n\n" +
                                  "Cliquez sur 'Vérifier les mises à jour' pour commencer.")
        self.changelog_text.config(state=tk.DISABLED)
        
        # Frame de progression
        progress_frame = tk.Frame(main_frame, bg=self.colors['bg'])
        progress_frame.pack(fill=tk.X, pady=(0, 15))
        
        # Label de progression
        self.progress_label = tk.Label(progress_frame, text="",
                                     font=('Arial', 10),
                                     bg=self.colors['bg'], fg=self.colors['fg'])
        self.progress_label.pack(anchor=tk.W)
        
        # Barre de progression
        self.progress_bar = ttk.Progressbar(progress_frame, length=600,
                                           mode='determinate',
                                           style='TProgressbar')
        
        # Détails de téléchargement
        self.download_details = tk.Label(progress_frame, text="",
                                       font=('Arial', 9),
                                       bg=self.colors['bg'], fg='#888888')
        
        # Frame des boutons
        button_frame = tk.Frame(main_frame, bg=self.colors['bg'])
        button_frame.pack(fill=tk.X)
        
        # Bouton Jouer
        self.play_button = tk.Button(button_frame, 
                                    text="JOUER",
                                    font=('Arial', 14, 'bold'),
                                    bg=self.colors['success'],
                                    fg='white',
                                    width=15, height=2,
                                    command=self.launch_game,
                                    relief=tk.FLAT,
                                    cursor='hand2')
        self.play_button.pack(side=tk.LEFT, padx=(0, 10))
        
        # Bouton Vérifier les mises à jour
        self.update_button = tk.Button(button_frame,
                                      text="Vérifier les\nmises à jour",
                                      font=('Arial', 11),
                                      bg=self.colors['button'],
                                      fg='white',
                                      width=15, height=2,
                                      command=self.check_updates,
                                      relief=tk.FLAT,
                                      cursor='hand2')
        self.update_button.pack(side=tk.LEFT, padx=(0, 10))
        
        # Bouton Paramètres
        self.settings_button = tk.Button(button_frame,
                                        text="Paramètres",
                                        font=('Arial', 11),
                                        bg='#555555',
                                        fg='white',
                                        width=12, height=2,
                                        command=self.open_settings,
                                        relief=tk.FLAT,
                                        cursor='hand2')
        self.settings_button.pack(side=tk.RIGHT)
        
        # Vérifier si le jeu est installé
        self.check_game_installed()
    
    def check_game_installed(self):
        """Vérifie si le jeu est installé"""
        game_exe_path = os.path.join(self.game_path, self.game_exe)
        if not os.path.exists(game_exe_path):
            self.play_button.config(state=tk.DISABLED, 
                                  text="INSTALLER",
                                  bg='#888888')
            self.status_label.config(text="⚠ Jeu non installé", fg=self.colors['warning'])
        else:
            self.play_button.config(state=tk.NORMAL)
    
    def check_updates_silent(self):
        """Vérifie les mises à jour silencieusement au démarrage"""
        threading.Thread(target=self._check_updates_thread, args=(True,), daemon=True).start()
    
    def check_updates(self):
        """Lance la vérification des mises à jour"""
        if self.is_checking or self.is_downloading:
            return
        
        self.update_button.config(state=tk.DISABLED, text="Vérification...")
        threading.Thread(target=self._check_updates_thread, args=(False,), daemon=True).start()
    
    def _check_updates_thread(self, silent=False):
        """Thread de vérification des mises à jour"""
        self.is_checking = True
        
        try:
            # Télécharger le manifest
            response = requests.get(self.manifest_url, timeout=10)
            response.raise_for_status()
            manifest = response.json()
            
            latest_version = manifest.get('version', '0.0.0')
            
            # Comparer les versions
            if self.compare_versions(latest_version, self.current_version) > 0:
                if not silent:
                    self.root.after(0, self._show_update_available, manifest)
                else:
                    self.root.after(0, lambda: self.available_version_label.config(
                        text=f"✨ Version {latest_version} disponible"))
            else:
                if not silent:
                    self.root.after(0, self._show_no_update)
                    
        except requests.RequestException as e:
            if not silent:
                self.root.after(0, lambda: messagebox.showerror(
                    "Erreur", f"Impossible de vérifier les mises à jour:\n{str(e)}"))
        except Exception as e:
            if not silent:
                self.root.after(0, lambda: messagebox.showerror(
                    "Erreur", f"Erreur lors de la vérification:\n{str(e)}"))
        finally:
            self.is_checking = False
            self.root.after(0, lambda: self.update_button.config(
                state=tk.NORMAL, text="Vérifier les\nmises à jour"))
    
    def _show_update_available(self, manifest):
        """Affiche qu'une mise à jour est disponible"""
        version = manifest.get('version', 'inconnue')
        changelog = manifest.get('changelog', {}).get('fr', 'Pas de notes de version')
        size = manifest.get('downloadSize', 0)
        
        self.available_version_label.config(text=f"✨ Version {version} disponible")
        
        # Afficher le changelog
        self.changelog_text.config(state=tk.NORMAL)
        self.changelog_text.delete('1.0', tk.END)
        self.changelog_text.insert('1.0', f"Nouvelle version disponible : {version}\n\n")
        self.changelog_text.insert(tk.END, f"Taille du téléchargement : {self.format_size(size)}\n\n")
        self.changelog_text.insert(tk.END, changelog)
        self.changelog_text.config(state=tk.DISABLED)
        
        # Demander si on installe
        if messagebox.askyesno("Mise à jour disponible",
                              f"La version {version} est disponible.\n\n" +
                              f"Taille : {self.format_size(size)}\n\n" +
                              "Voulez-vous l'installer maintenant ?"):
            self.download_update(manifest)
    
    def _show_no_update(self):
        """Affiche qu'aucune mise à jour n'est disponible"""
        self.status_label.config(text="✓ À jour", fg=self.colors['success'])
        messagebox.showinfo("Pas de mise à jour", 
                           "Votre jeu est déjà à jour !")
    
    def download_update(self, manifest):
        """Télécharge et installe une mise à jour"""
        if self.is_downloading:
            return
        
        self.is_downloading = True
        self.download_cancelled = False
        
        # Désactiver les boutons
        self.play_button.config(state=tk.DISABLED)
        self.update_button.config(state=tk.DISABLED, text="Annuler")
        self.update_button.config(command=self.cancel_download, state=tk.NORMAL)
        
        # Afficher la progression
        self.progress_label.config(text="Préparation du téléchargement...")
        self.progress_label.pack()
        self.progress_bar.pack(fill=tk.X, pady=(5, 0))
        self.download_details.pack()
        
        # Lancer le téléchargement dans un thread
        threading.Thread(target=self._download_thread, args=(manifest,), daemon=True).start()
    
    def _download_thread(self, manifest):
        """Thread de téléchargement"""
        try:
            download_url = manifest.get('downloadUrl')
            if not download_url:
                raise Exception("URL de téléchargement non trouvée")
            
            # Créer le dossier du jeu s'il n'existe pas
            os.makedirs(self.game_path, exist_ok=True)
            
            # Télécharger le fichier
            temp_file = os.path.join(tempfile.gettempdir(), 'pnw_update.zip')
            
            self.root.after(0, lambda: self.progress_label.config(
                text="Téléchargement en cours..."))
            
            response = requests.get(download_url, stream=True, timeout=30)
            response.raise_for_status()
            
            total_size = int(response.headers.get('content-length', 0))
            self.total_size = total_size
            self.downloaded_size = 0
            
            with open(temp_file, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if self.download_cancelled:
                        raise Exception("Téléchargement annulé")
                    
                    if chunk:
                        f.write(chunk)
                        self.downloaded_size += len(chunk)
                        
                        # Mettre à jour la progression
                        progress = (self.downloaded_size / total_size * 100) if total_size > 0 else 0
                        self.root.after(0, self._update_progress, progress)
            
            if self.download_cancelled:
                return
            
            # Extraire la mise à jour
            self.root.after(0, lambda: self.progress_label.config(
                text="Installation de la mise à jour..."))
            
            with zipfile.ZipFile(temp_file, 'r') as zip_ref:
                # Créer un backup si demandé
                if os.path.exists(os.path.join(self.game_path, self.game_exe)):
                    self._create_backup()
                
                # Extraire les fichiers
                total_files = len(zip_ref.namelist())
                for i, file in enumerate(zip_ref.namelist(), 1):
                    if self.download_cancelled:
                        raise Exception("Installation annulée")
                    
                    # Ignorer le manifest.json dans l'archive
                    if file == 'manifest.json':
                        continue
                    
                    zip_ref.extract(file, self.game_path)
                    progress = (i / total_files * 100)
                    self.root.after(0, self._update_progress, progress)
                    self.root.after(0, lambda f=file, i=i, t=total_files: 
                                  self.download_details.config(
                                      text=f"Extraction {i}/{t}: {os.path.basename(f)}"))
            
            # Mettre à jour la version
            self.set_current_version(manifest.get('version'))
            
            # Nettoyer
            os.remove(temp_file)
            
            # Succès
            self.root.after(0, self._update_complete, manifest)
            
        except Exception as e:
            self.root.after(0, self._update_failed, str(e))
        finally:
            self.is_downloading = False
            self.root.after(0, self._reset_ui)
    
    def _create_backup(self):
        """Crée une sauvegarde avant la mise à jour"""
        backup_dir = os.path.join(self.game_path, 'backup', 
                                 datetime.now().strftime('%Y%m%d_%H%M%S'))
        os.makedirs(backup_dir, exist_ok=True)
        
        # Copier les fichiers importants
        important_files = ['Save1.rxdata', 'Save2.rxdata', 'Save3.rxdata', 
                         'Save4.rxdata', 'Game.ini']
        
        for file in important_files:
            src = os.path.join(self.game_path, file)
            if os.path.exists(src):
                dst = os.path.join(backup_dir, file)
                shutil.copy2(src, dst)
    
    def _update_progress(self, progress):
        """Met à jour la barre de progression"""
        self.progress_bar['value'] = progress
        if self.total_size > 0:
            downloaded_mb = self.downloaded_size / 1024 / 1024
            total_mb = self.total_size / 1024 / 1024
            self.progress_label.config(
                text=f"Téléchargement : {downloaded_mb:.1f} MB / {total_mb:.1f} MB ({progress:.1f}%)")
    
    def _update_complete(self, manifest):
        """Mise à jour terminée avec succès"""
        version = manifest.get('version')
        messagebox.showinfo("Mise à jour terminée",
                           f"Le jeu a été mis à jour vers la version {version} !")
        self.status_label.config(text="✓ À jour", fg=self.colors['success'])
        self.check_game_installed()
    
    def _update_failed(self, error):
        """Échec de la mise à jour"""
        messagebox.showerror("Erreur de mise à jour",
                            f"La mise à jour a échoué :\n{error}")
        self.status_label.config(text="✗ Échec", fg=self.colors['danger'])
    
    def _reset_ui(self):
        """Réinitialise l'interface après le téléchargement"""
        self.progress_bar.pack_forget()
        self.progress_label.pack_forget()
        self.download_details.pack_forget()
        
        self.play_button.config(state=tk.NORMAL)
        self.update_button.config(state=tk.NORMAL, 
                                text="Vérifier les\nmises à jour",
                                command=self.check_updates)
        
        self.check_game_installed()
    
    def cancel_download(self):
        """Annule le téléchargement en cours"""
        if messagebox.askyesno("Annuler", "Voulez-vous vraiment annuler le téléchargement ?"):
            self.download_cancelled = True
    
    def launch_game(self):
        """Lance le jeu"""
        game_exe_path = os.path.join(self.game_path, self.game_exe)
        
        if not os.path.exists(game_exe_path):
            messagebox.showerror("Erreur", 
                               "Le jeu n'est pas installé !\n" +
                               "Cliquez sur 'Vérifier les mises à jour' pour l'installer.")
            return
        
        try:
            # Lancer le jeu
            subprocess.Popen([game_exe_path], cwd=self.game_path)
            
            # Optionnel : fermer le launcher
            if messagebox.askyesno("Fermer le launcher", 
                                  "Voulez-vous fermer le launcher ?"):
                self.root.quit()
        except Exception as e:
            messagebox.showerror("Erreur", f"Impossible de lancer le jeu :\n{str(e)}")
    
    def open_settings(self):
        """Ouvre la fenêtre des paramètres"""
        settings_window = tk.Toplevel(self.root)
        settings_window.title("Paramètres")
        settings_window.geometry("400x300")
        settings_window.resizable(False, False)
        settings_window.configure(bg=self.colors['bg'])
        
        # Frame principal
        main_frame = tk.Frame(settings_window, bg=self.colors['bg'], padx=20, pady=20)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # Titre
        title_label = tk.Label(main_frame, text="Paramètres",
                              font=('Arial', 16, 'bold'),
                              bg=self.colors['bg'], fg=self.colors['fg'])
        title_label.pack(pady=(0, 20))
        
        # Chemin du jeu
        path_label = tk.Label(main_frame, text="Dossier du jeu :",
                            font=('Arial', 11),
                            bg=self.colors['bg'], fg=self.colors['fg'])
        path_label.pack(anchor=tk.W)
        
        path_frame = tk.Frame(main_frame, bg=self.colors['bg'])
        path_frame.pack(fill=tk.X, pady=(5, 15))
        
        path_entry = tk.Entry(path_frame, font=('Arial', 10), width=35)
        path_entry.pack(side=tk.LEFT, padx=(0, 10))
        path_entry.insert(0, self.game_path)
        
        def browse_folder():
            folder = filedialog.askdirectory(title="Sélectionner le dossier du jeu")
            if folder:
                path_entry.delete(0, tk.END)
                path_entry.insert(0, folder)
        
        browse_button = tk.Button(path_frame, text="Parcourir",
                                 command=browse_folder)
        browse_button.pack(side=tk.LEFT)
        
        # Boutons
        button_frame = tk.Frame(main_frame, bg=self.colors['bg'])
        button_frame.pack(side=tk.BOTTOM, fill=tk.X, pady=(20, 0))
        
        def save_settings():
            new_path = path_entry.get()
            if new_path != self.game_path:
                self.save_game_path(new_path)
                self.current_version = self.get_current_version()
                self.version_label.config(text=f"Version installée : {self.current_version}")
                self.check_game_installed()
            settings_window.destroy()
        
        save_button = tk.Button(button_frame, text="Sauvegarder",
                              bg=self.colors['success'], fg='white',
                              command=save_settings, width=12)
        save_button.pack(side=tk.LEFT, padx=(0, 10))
        
        cancel_button = tk.Button(button_frame, text="Annuler",
                                bg='#555555', fg='white',
                                command=settings_window.destroy, width=12)
        cancel_button.pack(side=tk.LEFT)
    
    def compare_versions(self, v1, v2):
        """Compare deux versions (format X.Y.Z)"""
        try:
            parts1 = [int(x) for x in v1.split('.')]
            parts2 = [int(x) for x in v2.split('.')]
            
            for i in range(max(len(parts1), len(parts2))):
                p1 = parts1[i] if i < len(parts1) else 0
                p2 = parts2[i] if i < len(parts2) else 0
                
                if p1 > p2:
                    return 1
                elif p1 < p2:
                    return -1
            
            return 0
        except:
            return 0
    
    def format_size(self, size_bytes):
        """Formate une taille en bytes vers une forme lisible"""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size_bytes < 1024.0:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.1f} TB"


def main():
    """Point d'entrée du programme"""
    root = tk.Tk()
    app = PokemonNewWorldLauncher(root)
    
    # Centrer la fenêtre
    root.update_idletasks()
    x = (root.winfo_screenwidth() // 2) - (root.winfo_width() // 2)
    y = (root.winfo_screenheight() // 2) - (root.winfo_height() // 2)
    root.geometry(f'+{x}+{y}')
    
    root.mainloop()


if __name__ == "__main__":
    main()