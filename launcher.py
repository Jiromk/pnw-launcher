# launcher.py — Python 3.10+ | pip install PySide6 requests
import sys, zipfile, shutil, tempfile, subprocess, requests, configparser
from datetime import datetime
from pathlib import Path
from PySide6 import QtCore, QtGui, QtWidgets

APP_NAME         = "Pokémon New World"
GITHUB_REPO      = "Jiromk/pnw-launcher"
MANIFEST_URL     = f"https://raw.githubusercontent.com/{GITHUB_REPO}/main/latest.json"
DEFAULT_GAME_EXE = "Game.exe"
CONFIG_PATH      = "launcher_config.ini"
LOGO_URL = ("https://images-ext-1.discordapp.net/external/"
            "8aBjWgdfMWrEKmwjq_N3mavMjtYTAXRSk9ApxLbvMTA/%3Fcb%3D20231013130752%26path-prefix%3Dfr/"
            "https/static.wikia.nocookie.net/pokemon-new-world-fr/images/e/e7/Ygdgydgzydz.png/"
            "revision/latest?format=webp&width=1522&height=856")

# Palette
CLR_BG, CLR_BG_ELEV = "#0b1222", "#0f1a33"
CLR_CARD, CLR_TEXT, CLR_MUTED = "#111a36", "#e8f0ff", "#9fb2d9"
CLR_ACCENT, CLR_ACCENT_2, CLR_SUCCESS = "#2e59c6", "#7ecdf2", "#29c46d"
RADIUS = 18

def fmt_size(n:int)->str:
    s=float(n); 
    for u in ["B","KB","MB","GB","TB"]:
        if s<1024: return f"{s:.1f} {u}"
        s/=1024
    return f"{s:.1f} PB"

def compare_versions(v1:str,v2:str)->int:
    try:
        a=[int(x) for x in v1.split(".")]; b=[int(x) for x in v2.split(".")]
        for i in range(max(len(a),len(b))):
            x=a[i] if i<len(a) else 0; y=b[i] if i<len(b) else 0
            if x>y: return 1
            if x<y: return -1
        return 0
    except: return 0

# ── Workers (réseau/IO en threads) ───────────────────────────────────────
class ManifestWorker(QtCore.QObject):
    finished = QtCore.Signal(dict, str)
    @QtCore.Slot()
    def run(self):
        try:
            r = requests.get(MANIFEST_URL, timeout=15); r.raise_for_status()
            self.finished.emit(r.json(), "")
        except Exception as e:
            self.finished.emit({}, str(e))

class DownloadWorker(QtCore.QObject):
    progress = QtCore.Signal(int,int)
    stepinfo = QtCore.Signal(str)
    done     = QtCore.Signal(str,str)
    def __init__(self, manifest:dict, game_dir:Path):
        super().__init__(); self.manifest=manifest; self.game_dir=game_dir; self._cancel=False
    @QtCore.Slot() 
    def cancel(self): self._cancel=True
    @QtCore.Slot()
    def run(self):
        try:
            url=self.manifest.get("downloadUrl")
            if not url: raise RuntimeError("URL de téléchargement manquante.")
            self.game_dir.mkdir(parents=True, exist_ok=True)

            tmp_zip = Path(tempfile.gettempdir())/"pnw_update.zip"
            self.stepinfo.emit("Téléchargement…")
            with requests.get(url, stream=True, timeout=30) as r:
                r.raise_for_status()
                total=int(r.headers.get("content-length",0)); got=0
                with open(tmp_zip,"wb") as f:
                    for chunk in r.iter_content(chunk_size=1<<14):
                        if self._cancel: raise RuntimeError("Téléchargement annulé.")
                        if not chunk: continue
                        f.write(chunk); got+=len(chunk); self.progress.emit(got,total)

            self.stepinfo.emit("Installation…")
            with zipfile.ZipFile(tmp_zip,"r") as zf:
                # backup simple
                bdir=self.game_dir/"backup"/datetime.now().strftime("%Y%m%d_%H%M%S")
                bdir.mkdir(parents=True, exist_ok=True)
                for f in ["Save1.rxdata","Save2.rxdata","Save3.rxdata","Save4.rxdata","Game.ini"]:
                    src=self.game_dir/f
                    if src.exists(): shutil.copy2(src, bdir/src.name)
                names=zf.namelist(); total_files=max(1,len(names))
                for i,n in enumerate(names,1):
                    if self._cancel: raise RuntimeError("Installation annulée.")
                    if n.endswith("/") or n=="manifest.json": continue
                    zf.extract(n,self.game_dir); self.progress.emit(i,total_files)

            (self.game_dir/"version.txt").write_text(self.manifest.get("version","0.0.0"),encoding="utf-8")
            try: tmp_zip.unlink(missing_ok=True)
            except: pass
            self.done.emit(self.manifest.get("version",""), "")
        except Exception as e:
            self.done.emit("", str(e))

class LogoWorker(QtCore.QObject):
    finished = QtCore.Signal(QtGui.QPixmap)
    def __init__(self,url:str): super().__init__(); self.url=url
    @QtCore.Slot()
    def run(self):
        try:
            r=requests.get(self.url, timeout=15); r.raise_for_status()
            img=QtGui.QImage.fromData(r.content)
            pix=QtGui.QPixmap.fromImage(img).scaledToHeight(160, QtCore.Qt.SmoothTransformation)
        except:
            pix=QtGui.QPixmap(160,160); pix.fill(QtGui.QColor(CLR_ACCENT))
        self.finished.emit(pix)

# ── UI ───────────────────────────────────────────────────────────────────
class Card(QtWidgets.QFrame):
    def __init__(self): 
        super().__init__(); self.setObjectName("Card")
        eff=QtWidgets.QGraphicsDropShadowEffect(blurRadius=24,xOffset=0,yOffset=8); eff.setColor(QtGui.QColor(0,0,0,160))
        self.setGraphicsEffect(eff)

class Launcher(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__(); self.setWindowTitle(f"{APP_NAME} — Launcher")
        self.setMinimumSize(980,720); self.setStyleSheet(self._qss())
        self.game_dir = Path(self._load_game_path()); self.cur_ver=self._read_version()
        self._build_ui(); self._load_logo_async(LOGO_URL)
        QtCore.QTimer.singleShot(600, self.check_updates_silent)

    def _qss(self)->str:
        return f"""
        QWidget {{
          background: qlineargradient(x1:0,y1:0,x2:0,y2:1, stop:0 {CLR_BG}, stop:1 {CLR_BG_ELEV});
          color:{CLR_TEXT}; font-family:"Outfit", Segoe UI, Roboto, Helvetica, Arial; font-size:14px;
        }}
        QLabel#SubTitle {{ color:{CLR_MUTED}; font-size:13px; }}
        QLabel#CardTitle {{ font-weight:600; font-size:16px; color:{CLR_ACCENT_2}; }}
        QFrame#Card {{ background:{CLR_CARD}; border:1px solid rgba(126,205,242,0.10); border-radius:{RADIUS}px; }}
        QTextEdit#Changelog {{ background:rgba(255,255,255,0.04); border:1px solid rgba(126,205,242,0.12);
                               border-radius:{RADIUS-6}px; padding:12px; }}
        QPushButton {{ border:none; padding:12px 16px; border-radius:{RADIUS-6}px; font-weight:600; }}
        QPushButton[big="true"] {{ padding:16px 22px; font-size:16px; }}
        QPushButton[kind="accent"] {{ background:{CLR_ACCENT}; }}
        QPushButton[kind="muted"]  {{ background:#1b2444; color:{CLR_MUTED}; }}
        QPushButton[kind="success"]{{ background:{CLR_SUCCESS}; }}
        QPushButton:hover {{ background:{CLR_ACCENT_2}; }}
        QProgressBar {{ background:rgba(255,255,255,0.06); border:1px solid rgba(126,205,242,0.12);
                        border-radius:{RADIUS-8}px; height:20px; text-align:center; }}
        QProgressBar::chunk {{ background:{CLR_ACCENT}; border-radius:{RADIUS-8}px; }}
        """

    def _build_ui(self):
        w=QtWidgets.QWidget(); self.setCentralWidget(w)
        root=QtWidgets.QVBoxLayout(w); root.setContentsMargins(20,20,20,20); root.setSpacing(16)

        hero=Card(); hero_lay=QtWidgets.QVBoxLayout(hero); hero_lay.setContentsMargins(20,20,20,20); hero_lay.setSpacing(8)
        self.logo_lbl=QtWidgets.QLabel(alignment=QtCore.Qt.AlignCenter); self.logo_lbl.setObjectName("Logo"); self.logo_lbl.setMinimumHeight(140)
        hero_lay.addWidget(self.logo_lbl)
        sub=QtWidgets.QLabel("Launcher Officiel"); sub.setObjectName("SubTitle"); sub.setAlignment(QtCore.Qt.AlignCenter)
        hero_lay.addWidget(sub)

        info=QtWidgets.QHBoxLayout()
        self.installed_lbl=QtWidgets.QLabel(f"Version installée : {self.cur_ver}")
        self.available_lbl=QtWidgets.QLabel("")
        info.addWidget(self.installed_lbl); info.addStretch(1); info.addWidget(self.available_lbl)
        hero_lay.addLayout(info)

        bar=QtWidgets.QHBoxLayout()
        self.play_btn=self._btn("JOUER",kind="success",big=True,cb=self.launch_game)
        self.update_btn=self._btn("Vérifier les mises à jour",cb=self.check_updates)
        self.settings_btn=self._btn("Paramètres",kind="muted",cb=self.open_settings)
        bar.addWidget(self.play_btn,2); bar.addWidget(self.update_btn,1); bar.addWidget(self.settings_btn,0)
        hero_lay.addLayout(bar)

        ch=Card(); ch_lay=QtWidgets.QVBoxLayout(ch)
        title=QtWidgets.QLabel("Notes de mise à jour"); title.setObjectName("CardTitle")
        self.changelog=QtWidgets.QTextEdit(readOnly=True); self.changelog.setObjectName("Changelog")
        self.changelog.setText("Bienvenue dans Pokémon New World !\n\nClique sur « Vérifier les mises à jour » pour commencer.")
        ch_lay.addWidget(title); ch_lay.addWidget(self.changelog)

        prog=Card(); p_lay=QtWidgets.QVBoxLayout(prog)
        self.status_lbl=QtWidgets.QLabel("")
        self.progress=QtWidgets.QProgressBar(); self.progress.setValue(0); self.progress.setTextVisible(True); self.progress.setFormat("")
        prog.setVisible(False); p_lay.addWidget(self.status_lbl); p_lay.addWidget(self.progress)
        self.card_prog=prog

        root.addWidget(hero); root.addWidget(ch,3); root.addWidget(prog)
        self._refresh_install_state()

    def _btn(self,text,kind="accent",big=False,cb=None):
        b=QtWidgets.QPushButton(text); b.setProperty("kind",kind)
        if big: b.setProperty("big",True)
        if cb: b.clicked.connect(cb)
        return b

    # State
    def _load_game_path(self)->str:
        cfg=configparser.ConfigParser()
        if Path(CONFIG_PATH).exists():
            cfg.read(CONFIG_PATH,encoding="utf-8")
            return cfg.get("Game","path",fallback="game")
        return "game"

    def _save_game_path(self,path:str):
        cfg=configparser.ConfigParser(); cfg["Game"]={"path":path}
        with open(CONFIG_PATH,"w",encoding="utf-8") as f: cfg.write(f)

    def _read_version(self)->str:
        vf=self.game_dir/"version.txt"
        try: return vf.read_text(encoding="utf-8").strip() if vf.exists() else "0.0.0"
        except: return "0.0.0"

    def _set_version(self,v:str):
        (self.game_dir/"version.txt").write_text(v,encoding="utf-8")
        self.installed_lbl.setText(f"Version installée : {v}")

    def _refresh_install_state(self):
        exe=self.game_dir/DEFAULT_GAME_EXE
        self.play_btn.setEnabled(exe.exists())
        self.play_btn.setText("JOUER" if exe.exists() else "INSTALLER")

    # Logo (thread-safe)
    def _load_logo_async(self,url:str):
        self._logo_worker=LogoWorker(url)
        self._logo_thread=QtCore.QThread(self)
        self._logo_worker.moveToThread(self._logo_thread)
        self._logo_thread.started.connect(self._logo_worker.run)
        self._logo_worker.finished.connect(self._on_logo_ready)
        self._logo_worker.finished.connect(self._logo_thread.quit)
        self._logo_worker.finished.connect(self._logo_worker.deleteLater)
        self._logo_thread.finished.connect(self._logo_thread.deleteLater)
        self._logo_thread.start()

    @QtCore.Slot(QtGui.QPixmap)
    def _on_logo_ready(self,pix:QtGui.QPixmap):
        self.logo_lbl.setPixmap(pix)
        QtWidgets.QApplication.setWindowIcon(QtGui.QIcon(pix))

    # Updates
    def check_updates_silent(self): self._run_manifest(silent=True)
    def check_updates(self): self._run_manifest(silent=False)

    def _run_manifest(self,silent:bool):
        self.update_btn.setEnabled(False); self.available_lbl.setText("Vérification…")
        self._mw=ManifestWorker(); self._t=QtCore.QThread(self)
        self._mw.moveToThread(self._t)
        self._t.started.connect(self._mw.run)
        self._mw.finished.connect(lambda m,e: self._on_manifest_done(m,e,silent))
        self._mw.finished.connect(self._t.quit)
        self._mw.finished.connect(self._mw.deleteLater)
        self._t.finished.connect(self._t.deleteLater)
        self._t.start()

    def _on_manifest_done(self,manifest:dict,err:str,silent:bool):
        self.update_btn.setEnabled(True)
        if err:
            self.available_lbl.setText("")
            if not silent: QtWidgets.QMessageBox.critical(self,"Erreur",f"Impossible de vérifier les mises à jour:\n{err}")
            return
        latest=manifest.get("version","0.0.0")
        ch_fr=manifest.get("changelog",{}).get("fr","Pas de notes de version.")
        dl_sz=manifest.get("downloadSize",0); cur=self._read_version()

        if compare_versions(latest,cur)>0:
            self.available_lbl.setText(f"✨ Version {latest} disponible")
            self.changelog.setPlainText(f"Nouvelle version : {latest}\nTaille : {fmt_size(dl_sz)}\n\n{ch_fr}")
            if silent: return
            if QtWidgets.QMessageBox.question(self,"Mise à jour",
                    f"Installer la {latest} ? ({fmt_size(dl_sz)})",
                    QtWidgets.QMessageBox.Yes|QtWidgets.QMessageBox.No)==QtWidgets.QMessageBox.Yes:
                self._start_download(manifest)
        else:
            self.available_lbl.setText("")
            if not silent: QtWidgets.QMessageBox.information(self,"À jour","Votre jeu est déjà à jour ✅")

    def _start_download(self,manifest:dict):
        self.card_prog.setVisible(True); self.status_lbl.setText("Préparation…")
        self.progress.setRange(0,100); self.progress.setValue(0)
        self._dw=DownloadWorker(manifest,self.game_dir); self._dt=QtCore.QThread(self)
        self._dw.moveToThread(self._dt)
        self._dt.started.connect(self._dw.run)
        self._dw.progress.connect(self._on_progress)
        self._dw.stepinfo.connect(self.status_lbl.setText)
        self._dw.done.connect(self._on_done)
        self._dw.done.connect(self._dt.quit)
        self._dw.done.connect(self._dw.deleteLater)
        self._dt.finished.connect(self._dt.deleteLater)
        self._dt.start()

    @QtCore.Slot(int,int)
    def _on_progress(self,a:int,b:int):
        if b<=0: self.progress.setRange(0,0); return
        self.progress.setRange(0,100); pct=int(a/b*100)
        self.progress.setValue(max(0,min(100,pct)))
        self.progress.setFormat(f"{pct}% — {fmt_size(a)} / {fmt_size(b)}")

    @QtCore.Slot(str,str)
    def _on_done(self,version:str,err:str):
        if err:
            self.status_lbl.setText("Échec"); QtWidgets.QMessageBox.critical(self,"Erreur de mise à jour",err)
        else:
            self.status_lbl.setText("Terminé ✅")
            if version: self._set_version(version)
            self._refresh_install_state()
            QtWidgets.QMessageBox.information(self,"Mise à jour",f"Le jeu a été mis à jour en {version} !")

    def launch_game(self):
        exe=self.game_dir/DEFAULT_GAME_EXE
        if not exe.exists():
            QtWidgets.QMessageBox.warning(self,"Non installé","Lance « Vérifier les mises à jour » pour installer le jeu."); return
        try: subprocess.Popen([str(exe)], cwd=str(self.game_dir))
        except Exception as e: QtWidgets.QMessageBox.critical(self,"Erreur",f"Impossible de lancer le jeu:\n{e}")

    def open_settings(self):
        dlg=QtWidgets.QDialog(self); dlg.setWindowTitle("Paramètres"); dlg.setStyleSheet(self._qss()); dlg.setMinimumWidth(520)
        lay=QtWidgets.QVBoxLayout(dlg)
        card=Card(); form=QtWidgets.QFormLayout(card)
        path_edit=QtWidgets.QLineEdit(str(self.game_dir))
        browse=QtWidgets.QPushButton("Parcourir…")
        row=QtWidgets.QHBoxLayout(); row.addWidget(path_edit,1); row.addWidget(browse,0)
        form.addRow("Dossier du jeu :",row)
        browse.clicked.connect(lambda: path_edit.setText(QtWidgets.QFileDialog.getExistingDirectory(self,"Choisir le dossier du jeu",str(self.game_dir)) or path_edit.text()))
        btns=QtWidgets.QDialogButtonBox(QtWidgets.QDialogButtonBox.Save|QtWidgets.QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept); btns.rejected.connect(dlg.reject)
        lay.addWidget(card); lay.addWidget(btns)
        if dlg.exec():
            new_dir=Path(path_edit.text().strip())
            if new_dir!=self.game_dir:
                self.game_dir=new_dir; self._save_game_path(str(new_dir))
                self._set_version(self._read_version()); self._refresh_install_state()

def main():
    app=QtWidgets.QApplication(sys.argv); app.setApplicationName(APP_NAME); app.setStyle("Fusion")
    win=Launcher()
    geo=win.frameGeometry(); geo.moveCenter(QtGui.QGuiApplication.primaryScreen().availableGeometry().center()); win.move(geo.topLeft())
    win.show(); sys.exit(app.exec())

if __name__=="__main__": main()
