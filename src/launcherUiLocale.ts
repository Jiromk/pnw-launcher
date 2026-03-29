/**
 * Textes de l’écran d’accueil (launcher) selon la langue du jeu choisie dans la config.
 */

export type UiLang = "fr" | "en";

export function uiLangFromGameLang(gameLang: "fr" | "en" | null): UiLang {
  return gameLang === "en" ? "en" : "fr";
}

/** Messages d’erreur (journal + toasts) selon la langue UI. */
export function formatErrorForUser(err: string | undefined, lang: UiLang): string {
  if (!err) return lang === "en" ? "Something went wrong." : "Une erreur est survenue.";
  const e = err.toLowerCase();
  if (e.includes("404") || e.includes("not found")) {
    return lang === "en"
      ? "File or page not found (404). Try again later."
      : "Fichier ou page introuvable (404). Réessayez plus tard.";
  }
  if (
    e.includes("échec réseau") ||
    e.includes("connection") ||
    e.includes("failed to fetch") ||
    e.includes("network") ||
    e.includes("refused") ||
    e.includes("timed out") ||
    e.includes("timeout")
  ) {
    return lang === "en"
      ? "Could not connect (network or server unreachable)."
      : "Connexion impossible (réseau ou serveur injoignable).";
  }
  if (e.includes("extraction") || e.includes("archive") || e.includes("zip") || e.includes("corromp")) {
    return lang === "en"
      ? "Extraction error or corrupted archive. Retry the update."
      : "Erreur d'extraction ou archive corrompue. Relancez la mise à jour.";
  }
  if (e.includes("annulé") || e.includes("cancel")) {
    return lang === "en" ? "Download canceled." : "Téléchargement annulé.";
  }
  if (e.includes("espace") || e.includes("disk") || e.includes("space")) {
    return lang === "en" ? "Insufficient disk space." : "Espace disque insuffisant.";
  }
  if (
    (e.includes("400") || e.includes("bad request")) &&
    (e.includes("lang=en") || e.includes("?lang=en"))
  ) {
    return lang === "en"
      ? "The English build is not published on the site yet (.zip + version in admin). Choose French for now or contact the team."
      : "La version anglaise du jeu n’est pas encore publiée sur le site (fichier .zip + version à renseigner dans l’admin). Choisissez le français en attendant, ou contactez l’équipe.";
  }
  return err;
}

export type LauncherUi = ReturnType<typeof getLauncherUi>;

export function getLauncherUi(L: UiLang) {
  const fr = {
    sidebar: {
      openMenu: "Ouvrir le menu",
      closeMenu: "Fermer le menu",
      navHome: "Launcher",
      contact: "Contacter l'équipe",
    },
    offline: {
      title: "Pas de connexion",
      hint: "— Vous pouvez lancer le jeu si déjà installé.",
    },
    refresh: "Rafraîchir",
    installGame: "Installer le jeu",
    updateGame: "Mettre à jour",
    play: "Jouer",
    installDir: "Répertoire d'installation",
    notDefined: "Non défini",
    statusNotInstalled: "Non installé",
    statusUpdateAvailable: "Mise à jour disponible",
    statusUpToDate: "À jour",
    /** Installation locale plus récente que gameVersion sur le manifest (rétrogradation admin). */
    statusLocalNewer: "Plus récent que le site",
    /** Bouton pour télécharger la build publiée (souvent une « rétrogradation » volontaire). */
    installPublishedVersion: "Réinstaller la version du site",
    gameLanguage: "Langue du jeu",
    enChecking: "English (vérification…)",
    enUnavailable: "English (indisponible)",
    folderMenu: "Dossier",
    folderChoose: "Choisir un dossier…",
    folderInsertSave: "Insérer une save",
    progress: {
      downloading: "Téléchargement en cours…",
      paused: "En pause",
      extracting: "Extraction…",
      reconnecting: "Reconnexion…",
      remaining: "restant",
    },
    pause: "Pause",
    resume: "Reprendre",
    cancel: "Annuler",
    profile: {
      title: "Profil joueur",
      reading: "Lecture de la sauvegarde…",
      noSave: "Aucune sauvegarde trouvée. Lance le jeu au moins une fois pour créer un profil.",
      readError: "Impossible de lire la save (voir Journal).",
      seen: "vus",
      caught: "capturés",
      money: "Argent",
      time: "Temps",
      start: "Début",
      team: "Équipe",
      levelShort: "Nv.",
      boss: "Boss",
      bossBeat: (n: number) => `Boss ${n} vaincu`,
      bossUnknown: (n: number) => `Boss ${n}`,
    },
    journal: {
      title: "Journal",
      empty: "Aucun événement pour le moment.",
    },
    migration: {
      title: "Langue de votre installation",
      body:
        "Le launcher ne savait pas quelle langue était installée. Indiquez la langue du build actuellement sur ce PC (pour comparer les mises à jour avec la bonne piste).",
      enUnavailable: "Piste anglaise indisponible sur le serveur",
      enUnavailableBadge: "Indisponible",
    },
    langSwitch: {
      title: "Changer la langue du jeu",
      nextArchiveBefore: "Le prochain téléchargement utilisera l’archive",
      nextArchiveAfter: ".",
      archiveFr: "française",
      archiveEn: "anglaise",
      archiveUnknown: "—",
      replaceLead:
        "Remplacer — mise à jour ou réinstallation dans le dossier ci-dessous (les sauvegardes de ce dossier sont conservées comme d’habitude).",
      otherFolderLead:
        "Autre dossier — gardez l’installation actuelle sur le disque et installez l’autre langue ailleurs. Le launcher utilisera le nouveau chemin pour « Jouer » et les mises à jour.",
      replaceBtn: "Remplacer dans le dossier actuel",
      pickFolderBtn: "Choisir un autre dossier…",
    },
    welcome: {
      title: "Bienvenue sur PNW Launcher",
      pickLang: "Quelle langue de jeu voulez-vous utiliser ?",
      hint:
        "Les versions française et anglaise peuvent avoir des numéros différents — le bon build sera téléchargé selon votre choix.",
      buildFr: "Build FR",
      buildEn: "Build EN",
      enChecking: "Vérification…",
      enUnavailable: "Indisponible",
      enTitleUnavailable: "Build anglais indisponible ou fichier trop petit sur le serveur",
      enTitleLoading: "Vérification du serveur…",
      enTrackWarn:
        "La piste anglaise n’est pas utilisable (manifest absent, fichier trop léger, ou archive invalide côté serveur). Utilisez le français jusqu’à ce qu’un ZIP valide soit publié.",
      firstTimeQ: "Est-ce votre première fois sur Pokémon New World ?",
      firstTime: "Première fois",
      firstTimeSub: "Je n'ai jamais joué",
      alreadyInstalled: "Déjà installé",
      alreadyInstalledSub: "J'ai déjà le jeu",
      footerHint: "Vous pourrez changer le dossier d'installation plus tard via le menu Dossier",
    },
    installPrompt: {
      title: "Jeu non trouvé",
      confirm: "Installer maintenant",
      later: "Plus tard",
      body1: "Nous n'avons pas trouvé Pokémon New World sur votre ordinateur.",
      body2:
        "Voulez-vous l'installer maintenant ? Le jeu sera installé dans le dossier par défaut (AppData\\Local\\PNW Launcher).",
    },
    launcherSelfUpdate: {
      title: "Mise à jour du launcher",
      subtitle: "Une nouvelle version de l’application est disponible. Le téléchargement se fait dans le launcher.",
      current: "Version installée",
      newer: "Nouvelle version",
      download: "Télécharger l’installateur",
      downloading: "Téléchargement…",
      later: "Plus tard",
      hint:
        "Le fichier est enregistré puis l’installateur se lance automatiquement. Le launcher se ferme tout seul pour permettre la mise à jour (NSIS ne peut pas remplacer l’exe tant qu’il tourne). Rouvrez-le ensuite.",
      notesTitle: "Nouveautés",
    },
    scan: {
      default: "Recherche du jeu…",
      manual: "Recherche manuelle du jeu...",
    },
    log: {
      downloadCanceled: "Téléchargement annulé",
      installComplete: "✅ Installation/Mise à jour terminée",
      manifestNoUrl: "Manifest sans URL",
      diskCheckFailed: (d: string) => `Vérification espace disque : ${d}`,
      profileParseFail: "⚠️ Profil: échec de lecture de la sauvegarde",
      profileError: (d: string) => `⚠️ Profil: ${d}`,
      enBuildHint:
        "ℹ️ Build anglais non publié sur le site : repassez en Français ou configurez windowsEn + gameVersionEn.",
      enLocalSwitch:
        "ℹ️ Manifeste EN indisponible — le lanceur utilise votre installation anglaise déjà présente sur le disque.",
      offlineCanPlay: "📴 Mode hors-ligne : vous pouvez lancer le jeu.",
      updateAvailable: (lv: string, rv: string) => `⚠️ Mise à jour disponible : v${lv} → v${rv}`,
      launcherUpdateAvailable: (cv: string, rv: string) =>
        `🚀 Mise à jour du launcher : v${cv} → v${rv}`,
      launcherInstallerDone:
        "✅ Téléchargement terminé — l’installateur se lance et le launcher va se fermer pour la mise à jour.",
      autoUpdateStarted: (v: string) => `🔄 Mise à jour automatique lancée → v${v}`,
      gameUpToDate: (v: string) => `✅ Jeu à jour (v${v})`,
      localNewerThanSite: (lv: string, rv: string) =>
        `ℹ️ Installation locale v${lv} plus récente que la version publiée sur le site (v${rv}). Vous pouvez jouer tel quel ou réinstaller la build du site.`,
      downloadPlanned: (langLabel: string, v: string) => `🌐 Téléchargement prévu : ${langLabel} (v${v})`,
      buildLangFr: "français",
      buildLangEn: "anglais",
      newInstall: "🆕 Nouvelle installation",
      selectionCanceled: "ℹ️ Sélection annulée",
      gameFolderSet: (path: string) => `📁 Dossier du jeu défini : ${path}`,
      folderSet: (path: string) => `📁 Dossier défini : ${path}`,
      selectionError: (d: string) => `Erreur sélection : ${d}`,
      noGameFound: "ℹ️ Aucun jeu détecté",
      gameDetected: (path: string) => `✅ Jeu trouvé : ${path}`,
      detectFailed: (d: string) => `Détection échouée : ${d}`,
      saveImported: (path: string) => `💾 Save importée : ${path}`,
      saveImportFailed: (d: string) => `Import save échoué : ${d}`,
      launchGame: "🎮 Lancement du jeu...",
      launchFailed: (d: string) => `Impossible de lancer : ${d}`,
      folderPickCanceled: "ℹ️ Choix du dossier annulé — langue inchangée.",
      installDirUpdated: (path: string) => `📁 Installation pointée vers : ${path}`,
      folderError: (d: string) => `Dossier : ${d}`,
    },
    launcherMenu: {
      button: "Menu",
      gts: "GTS (Échanges)",
      gtsAria: "Ouvrir le Global Trade System",
    },
    themeMenu: {
      button: "Thème",
      appearance: "Apparence",
      dark: "Sombre",
      light: "Clair",
      titleDark: "Thème sombre",
      titleLight: "Thème clair",
      accent: "Couleur d’accent",
      customColor: "Personnalisée…",
      wallpaper: "Fond d’écran",
      default: "Par défaut",
      chooseFile: "Choisir un fichier…",
      dialogPickBg: "Choisir une image de fond",
      filterImages: "Images",
    },
    pfpMenu: {
      button: "Avatar",
      bundled: "Icônes incluses",
      noIconsBefore: "Aucune icône trouvée dans",
      localImage: "Image locale…",
      default: "Par défaut",
      dialogPick: "Choisir une image d’avatar",
      filterImages: "Images",
    },
    pickFolderDialog: (gameBuildLang: "fr" | "en") =>
      gameBuildLang === "en" ? "Dossier pour la version anglaise" : "Dossier pour la version française",
  };

  const en = {
    sidebar: {
      openMenu: "Open menu",
      closeMenu: "Close menu",
      navHome: "Home",
      contact: "Contact the team",
    },
    offline: {
      title: "No connection",
      hint: "— You can launch the game if it is already installed.",
    },
    refresh: "Refresh",
    installGame: "Install game",
    updateGame: "Update",
    play: "Play",
    installDir: "Installation folder",
    notDefined: "Not set",
    statusNotInstalled: "Not installed",
    statusUpdateAvailable: "Update available",
    statusUpToDate: "Up to date",
    statusLocalNewer: "Newer than server",
    installPublishedVersion: "Reinstall site version",
    gameLanguage: "Game language",
    enChecking: "English (checking…)",
    enUnavailable: "English (unavailable)",
    folderMenu: "Folder",
    folderChoose: "Choose a folder…",
    folderInsertSave: "Import a save file",
    progress: {
      downloading: "Downloading…",
      paused: "Paused",
      extracting: "Extracting…",
      reconnecting: "Reconnecting…",
      remaining: "left",
    },
    pause: "Pause",
    resume: "Resume",
    cancel: "Cancel",
    profile: {
      title: "Player profile",
      reading: "Reading save…",
      noSave: "No save found. Launch the game at least once to create a profile.",
      readError: "Could not read save (see Log).",
      seen: "seen",
      caught: "caught",
      money: "Money",
      time: "Time",
      start: "Started",
      team: "Team",
      levelShort: "Lv.",
      boss: "Boss",
      bossBeat: (n: number) => `Boss ${n} defeated`,
      bossUnknown: (n: number) => `Boss ${n}`,
    },
    journal: {
      title: "Log",
      empty: "No events yet.",
    },
    migration: {
      title: "Your installation language",
      body:
        "The launcher didn’t know which language was installed. Pick the language of the build currently on this PC (so updates use the correct track).",
      enUnavailable: "English track unavailable on the server",
      enUnavailableBadge: "Unavailable",
    },
    langSwitch: {
      title: "Change game language",
      nextArchiveBefore: "The next download will use the",
      nextArchiveAfter: " build archive.",
      archiveFr: "French",
      archiveEn: "English",
      archiveUnknown: "—",
      replaceLead:
        "Replace — update or reinstall in the folder below (saves in this folder are kept as usual).",
      otherFolderLead:
        "Other folder — keep the current installation on disk and install the other language elsewhere. The launcher will use the new path for “Play” and updates.",
      replaceBtn: "Replace in the current folder",
      pickFolderBtn: "Choose another folder…",
    },
    welcome: {
      title: "Welcome to PNW Launcher",
      pickLang: "Which game language do you want to use?",
      hint:
        "French and English builds may have different version numbers — the correct build will be downloaded based on your choice.",
      buildFr: "FR build",
      buildEn: "EN build",
      enChecking: "Checking…",
      enUnavailable: "Unavailable",
      enTitleUnavailable: "English build unavailable or file too small on the server",
      enTitleLoading: "Checking server…",
      enTrackWarn:
        "The English track cannot be used (missing manifest, file too small, or invalid archive on the server). Use French until a valid ZIP is published.",
      firstTimeQ: "Is this your first time playing Pokémon New World?",
      firstTime: "First time",
      firstTimeSub: "I’ve never played",
      alreadyInstalled: "Already installed",
      alreadyInstalledSub: "I already have the game",
      footerHint: "You can change the install folder later via the Folder menu",
    },
    installPrompt: {
      title: "Game not found",
      confirm: "Install now",
      later: "Later",
      body1: "We couldn’t find Pokémon New World on this computer.",
      body2:
        "Do you want to install it now? The game will be installed in the default folder (AppData\\Local\\PNW Launcher).",
    },
    launcherSelfUpdate: {
      title: "Launcher update",
      subtitle: "A new version is available. The download runs inside the launcher.",
      current: "Installed version",
      newer: "New version",
      download: "Download installer",
      downloading: "Downloading…",
      later: "Later",
      hint:
        "The file is saved and the installer starts automatically. The launcher will close on its own so the setup can update the executable (it cannot be replaced while the app is running). Reopen it afterward.",
      notesTitle: "What's new",
    },
    scan: {
      default: "Searching for the game…",
      manual: "Searching manually…",
    },
    log: {
      downloadCanceled: "Download canceled",
      installComplete: "✅ Installation/update complete",
      manifestNoUrl: "Manifest has no URL",
      diskCheckFailed: (d: string) => `Disk space check: ${d}`,
      profileParseFail: "⚠️ Profile: failed to read save data",
      profileError: (d: string) => `⚠️ Profile: ${d}`,
      enBuildHint:
        "ℹ️ English build not published on the site: switch to French or set windowsEn + gameVersionEn in admin.",
      enLocalSwitch:
        "ℹ️ English manifest unavailable — using your local English install on disk.",
      offlineCanPlay: "📴 Offline: you can still launch the game.",
      updateAvailable: (lv: string, rv: string) => `⚠️ Update available: v${lv} → v${rv}`,
      launcherUpdateAvailable: (cv: string, rv: string) =>
        `🚀 Launcher update available: v${cv} → v${rv}`,
      launcherInstallerDone:
        "✅ Download finished — the installer is starting and the launcher will close for the update.",
      autoUpdateStarted: (v: string) => `🔄 Auto-update started → v${v}`,
      gameUpToDate: (v: string) => `✅ Game is up to date (v${v})`,
      localNewerThanSite: (lv: string, rv: string) =>
        `ℹ️ Local install v${lv} is newer than the published version (v${rv}). You can play as is or reinstall the site build.`,
      downloadPlanned: (langLabel: string, v: string) => `🌐 Planned download: ${langLabel} (v${v})`,
      buildLangFr: "French",
      buildLangEn: "English",
      newInstall: "🆕 New installation",
      selectionCanceled: "ℹ️ Selection canceled",
      gameFolderSet: (path: string) => `📁 Game folder set to: ${path}`,
      folderSet: (path: string) => `📁 Folder set to: ${path}`,
      selectionError: (d: string) => `Selection error: ${d}`,
      noGameFound: "ℹ️ No game detected",
      gameDetected: (path: string) => `✅ Game found: ${path}`,
      detectFailed: (d: string) => `Detection failed: ${d}`,
      saveImported: (path: string) => `💾 Save imported: ${path}`,
      saveImportFailed: (d: string) => `Save import failed: ${d}`,
      launchGame: "🎮 Launching game...",
      launchFailed: (d: string) => `Could not launch: ${d}`,
      folderPickCanceled: "ℹ️ Folder choice canceled — language unchanged.",
      installDirUpdated: (path: string) => `📁 Install path set to: ${path}`,
      folderError: (d: string) => `Folder: ${d}`,
    },
    launcherMenu: {
      button: "Menu",
      gts: "GTS (Trades)",
      gtsAria: "Open Global Trade System",
    },
    themeMenu: {
      button: "Theme",
      appearance: "Appearance",
      dark: "Dark",
      light: "Light",
      titleDark: "Dark theme",
      titleLight: "Light theme",
      accent: "Accent color",
      customColor: "Custom…",
      wallpaper: "Wallpaper",
      default: "Default",
      chooseFile: "Choose a file…",
      dialogPickBg: "Choose a background image",
      filterImages: "Images",
    },
    pfpMenu: {
      button: "Avatar",
      bundled: "Bundled icons",
      noIconsBefore: "No icons found in",
      localImage: "Local image…",
      default: "Default",
      dialogPick: "Choose an avatar image",
      filterImages: "Images",
    },
    pickFolderDialog: (gameBuildLang: "fr" | "en") =>
      gameBuildLang === "en" ? "Folder for the English version" : "Folder for the French version",
  };

  return L === "en" ? en : fr;
}
