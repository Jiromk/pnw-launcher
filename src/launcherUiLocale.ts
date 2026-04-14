/**
 * Textes de l’écran d’accueil (launcher) selon la langue du jeu choisie dans la config.
 */

export type UiLang = "fr" | "en";

/** Shape minimale d'un match banlist utilisée par la fonction locale `bannedInTeam`. */
export type BannedInTeamMatch = {
  banned: { name: string; form: number | null; reason: string };
  teamLabel: string;
  slotIdx: number;
};

/** Shape minimale d'une entrée invalide utilisée par la fonction locale `invalidStatsInTeam`. */
export type InvalidStatsMatch = {
  slotIdx: number;
  label: string;
  violations: Array<
    | { kind: "iv_over"; stat: "hp" | "atk" | "dfe" | "spd" | "ats" | "dfs"; value: number }
    | { kind: "ev_over"; stat: "hp" | "atk" | "dfe" | "spd" | "ats" | "dfs"; value: number }
    | { kind: "ev_total_over"; total: number }
  >;
};

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
      firstTimeNote: "Le launcher et le jeu seront installés dans AppData (C:\\Users\\…). Ce dossier est requis par Windows pour éviter les restrictions de permissions.",
      alreadyInstalled: "Déjà installé",
      alreadyInstalledSub: "J'ai déjà le jeu",
      footerHint: "Vous pourrez changer le dossier d'installation du jeu plus tard via le menu Dossier",
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
    gameUpdate: {
      title: "Mise à jour du jeu",
      subtitle: "Une nouvelle version du jeu est en cours d’installation.",
      current: "Version installée",
      newer: "Nouvelle version",
      status: {
        downloading: "Téléchargement en cours…",
        paused: "En pause",
        extracting: "Extraction…",
        reconnecting: "Reconnexion…",
      },
      remaining: "restant",
      pause: "Pause",
      resume: "Reprendre",
      cancel: "Annuler",
      notesTitle: (v: string) => `Nouveautés de la v${v}`,
      notesLoading: "Chargement des notes de mise à jour…",
      notesError: "Impossible de charger les notes de mise à jour.",
      notesEmpty: "Aucune note disponible pour cette version.",
      openNotesLink: "Voir les notes",
      hint: "Le jeu sera disponible dès la fin de l’installation. Ne fermez pas le launcher.",
    },
    battleTower: {
      nav: { home: "Accueil", lead: "Combat Lead", amical: "Combat Amical", profile: "Profil" },
      backToTower: "Retour à la tour",
      home: {
        title: "Tour de Combat",
        subtitle:
          "Affrontez les autres dresseurs dans des combats en temps réel. Deux modes, deux ambiances.",
        modes: {
          lead: {
            badge: "Compétitif",
            title: "Combat Lead",
            description:
              "Matchmaking classé basé sur votre elo. Affrontez des adversaires de votre niveau.",
          },
          amical: {
            badge: "Amical",
            title: "Combat Amical",
            description:
              "Défiez librement n'importe quel joueur en ligne. Aucun enjeu, pur fun.",
          },
        },
        statsTitle: "Vos statistiques",
        statsPlaceholder: "Statistiques à venir",
        statsHint:
          "Les statistiques PvP seront disponibles prochainement, avec le lancement du Combat Lead.",
        statLabels: {
          wins: "Victoires",
          losses: "Défaites",
          winrate: "Winrate",
          elo: "Rang elo",
        },
        info: {
          buttonAria: "Informations sur les règles de combat",
          title: "Règles & Conditions",
          subtitle: "Tout ce qu'il faut savoir avant de combattre",
          accessTitle: "Conditions d'accès",
          rules: {
            version: "Jeu installé à jour",
            iv: "IV ≤ 31 par statistique",
            ev: "EV ≤ 252 par stat / 510 au total",
            banlist: "Aucun Pokémon banni dans l'équipe",
          },
          rankedOnlyTag: "Combat Lead",
          banlistTitle: "Pokémons bannis",
          banlistScope: "Applicable uniquement en Combat Lead (classé)",
          banlistEmpty: "Aucun Pokémon n'est actuellement banni.",
          banlistLoading: "Chargement de la banlist…",
          banlistCount: (n: number) => `${n} entrée${n > 1 ? "s" : ""}`,
          formBase: "Forme de base",
          formLabel: (f: number) => `Forme ${f}`,
        },
      },
      lead: {
        title: "Combat Lead",
        subtitle: "Matchmaking classé",
        comingSoon: "Bientôt disponible",
        queueTitle: "Rejoindre la queue",
        queueSubtitle: "Trouvez un adversaire de votre niveau elo.",
        queueBtn: "Bientôt disponible",
        myRank: "Votre rang",
        leaderboardTitle: "Classement",
        leaderboardEmpty: "Classement à venir",
        footer:
          "Le matchmaking sera ouvert prochainement. Les stats et le leaderboard seront réinitialisés lors du lancement officiel.",
        columns: {
          rank: "Rang",
          player: "Joueur",
          elo: "Elo",
          wins: "V",
          losses: "D",
          winrate: "Winrate",
        },
      },
      amical: {
        title: "Combat Amical",
        subtitle: "Versus libre",
        sidebarTitle: "Joueurs en ligne",
        sidebarFilter: "Filtrer…",
        sidebarCount: (n: number) => `${n} en ligne`,
        sidebarEmpty: "Aucun joueur en ligne",
        emptyStateTitle: "Prêt au combat ?",
        emptyStateBody:
          "Sélectionnez un joueur dans la liste à droite pour afficher son profil et lancer un défi.",
        challengeBtn: "Défier",
        viewProfileBtn: "Voir son profil",
        statusAvailable: "Disponible",
        statusInGame: "En jeu",
        statusInBattle: "En combat",
        disabledBecauseInBattle: "Ce joueur est déjà en combat",
        disabledBecauseOwnBattle: "Vous avez déjà un combat en cours",
        disabledBecauseSelf: "C'est vous !",
        profileStatsTitle: "Statistiques du joueur",
        profileNoBio: "Aucune bio.",
      },
      profile: {
        title: "Profil de Combat",
        subtitle: "Votre parcours de dresseur PvP",
        anonymous: "Joueur",
        backToAmical: "Retour au Combat Amical",
        viewingOther: (name: string) => `Profil de ${name}`,
        stats: {
          wins: "Victoires",
          losses: "Défaites",
          winrate: "Winrate",
          elo: "Rang",
          lp: "LP",
          unranked: "Non classé",
        },
        filters: {
          all: "Tous",
          amical: "Amical",
          ranked: "Classé",
        },
        history: {
          title: "Historique des combats",
          loading: "Chargement de l'historique…",
          loadingMore: "Chargement des combats suivants…",
          endOfHistory: "Fin de l'historique",
          empty: "Aucun combat joué pour l'instant",
          emptyHint: "Lancez un défi pour écrire votre première page !",
          resultWin: "Victoire",
          resultLoss: "Défaite",
          resultDraw: "Match nul",
          typeAmical: "Amical",
          typeRanked: "Classé",
          vs: "vs",
          teamTitle: "Équipe utilisée",
          youLabel: "Vous",
          teamUnknown: "Équipe inconnue",
          durationLabel: "Durée :",
          lpGain: (n: number) => `+${n} LP`,
          lpLoss: (n: number) => `-${n} LP`,
          lpZero: "0 LP",
          timeAgoNow: "à l'instant",
          timeAgoMin: (n: number) => `il y a ${n} min`,
          timeAgoHour: (n: number) => `il y a ${n} h`,
          timeAgoDay: (n: number) => `il y a ${n} j`,
        },
      },
      banner: {
        incomingTitle: "Défi reçu !",
        incomingDesc: (name: string) => `${name} vous défie en combat`,
        accept: "Accepter",
        decline: "Refuser",
        sentTitle: "Défi envoyé",
        sentDesc: (name: string) => `En attente de ${name}...`,
        waitingTitle: "Lancement…",
        waitingDesc: "Préparation du combat dans le jeu",
        liveTitle: "EN DIRECT",
        liveDesc: (name: string) => `Combat contre ${name}`,
        spectators: (n: number) => `${n} spectateur${n > 1 ? "s" : ""}`,
        cancel: "Annuler",
        forfeit: "Abandonner",
        close: "Fermer",
        completeWin: "Victoire !",
        completeLoss: "Défaite...",
        completeDraw: "Match nul",
        completeGeneric: "Combat terminé !",
        forfeitReason: (name: string) => `${name} a abandonné le combat`,
        crashReason: (name: string) => `Problème technique de ${name}`,
        errorTitle: "Erreur",
      },
      errors: {
        gameNotRunning: "Lancez le jeu avant de défier un joueur !",
        gameNotRunningAccept: "Lancez le jeu avant d'accepter un combat !",
        serverUnavailable:
          "Connexion au serveur de combat non disponible. Réessayez.",
        bannedInTeam: (matches: BannedInTeamMatch[]) => {
          const lines = matches
            .map((m) => {
              const formPart = m.banned.form != null ? ` (forme ${m.banned.form})` : "";
              const reasonPart = m.banned.reason ? ` — ${m.banned.reason}` : "";
              return `• ${m.banned.name}${formPart}${reasonPart}`;
            })
            .join("\n");
          const count = matches.length;
          const plural = count > 1 ? "s" : "";
          return `Combat impossible : vous avez ${count} Pokémon${plural} banni${plural} dans votre équipe :\n\n${lines}\n\nRetirez-${count > 1 ? "les" : "le"} de votre équipe pour pouvoir combattre.`;
        },
        invalidStatsInTeam: (matches: InvalidStatsMatch[]) => {
          const statLabels: Record<string, string> = {
            hp: "PV", atk: "Atq", dfe: "Déf", spd: "Vit", ats: "Atq Spé", dfs: "Déf Spé",
          };
          const lines = matches
            .map((m) => {
              const details = m.violations.map((v) => {
                if (v.kind === "iv_over") return `  ▸ IV ${statLabels[v.stat]} : ${v.value} (max 31)`;
                if (v.kind === "ev_over") return `  ▸ EV ${statLabels[v.stat]} : ${v.value} (max 252)`;
                return `  ▸ EV total : ${v.total} (max 510)`;
              });
              return `◆ ${m.label}\n${details.join("\n")}`;
            })
            .join("\n\n");
          const count = matches.length;
          const plural = count > 1 ? "s" : "";
          return `Statistiques invalides détectées sur ${count} Pokémon${plural} :\n\n${lines}`;
        },
      },
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
      battleOutOfDateTitle: "Jeu non à jour",
      battleOutOfDateBody:
        "Votre version du jeu n'est pas à jour. Mettez le jeu à jour avant d'accéder à la Tour de Combat pour garantir un combat équitable entre tous les joueurs.",
      battleOutOfDateOk: "J'ai compris",
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
      firstTimeNote: "The launcher and game will be installed in AppData (C:\\Users\\…). This folder is required by Windows to avoid permission restrictions.",
      alreadyInstalled: "Already installed",
      alreadyInstalledSub: "I already have the game",
      footerHint: "You can change the game install folder later via the Folder menu",
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
    gameUpdate: {
      title: "Game update",
      subtitle: "A new version of the game is being installed.",
      current: "Installed version",
      newer: "New version",
      status: {
        downloading: "Downloading…",
        paused: "Paused",
        extracting: "Extracting…",
        reconnecting: "Reconnecting…",
      },
      remaining: "left",
      pause: "Pause",
      resume: "Resume",
      cancel: "Cancel",
      notesTitle: (v: string) => `What’s new in v${v}`,
      notesLoading: "Loading patch notes…",
      notesError: "Could not load patch notes.",
      notesEmpty: "No notes available for this version.",
      openNotesLink: "View notes",
      hint: "The game will be available as soon as installation completes. Don’t close the launcher.",
    },
    battleTower: {
      nav: { home: "Home", lead: "Combat Lead", amical: "Friendly Combat", profile: "Profile" },
      backToTower: "Back to tower",
      home: {
        title: "Battle Tower",
        subtitle:
          "Face other trainers in real-time battles. Two modes, two vibes.",
        modes: {
          lead: {
            badge: "Competitive",
            title: "Combat Lead",
            description:
              "Ranked matchmaking based on your elo. Face opponents at your level.",
          },
          amical: {
            badge: "Friendly",
            title: "Friendly Combat",
            description:
              "Freely challenge any online player. No stakes, just fun.",
          },
        },
        statsTitle: "Your statistics",
        statsPlaceholder: "Stats coming soon",
        statsHint:
          "PvP statistics will be available soon, alongside the Combat Lead launch.",
        statLabels: {
          wins: "Wins",
          losses: "Losses",
          winrate: "Winrate",
          elo: "Elo rank",
        },
        info: {
          buttonAria: "Battle rules and conditions",
          title: "Rules & Conditions",
          subtitle: "Everything you need to know before battling",
          accessTitle: "Access conditions",
          rules: {
            version: "Game installed and up to date",
            iv: "IV ≤ 31 per stat",
            ev: "EV ≤ 252 per stat / 510 total",
            banlist: "No banned Pokémon in your team",
          },
          rankedOnlyTag: "Ranked only",
          banlistTitle: "Banned Pokémon",
          banlistScope: "Applies only to Ranked Battles (Combat Lead)",
          banlistEmpty: "No Pokémon is currently banned.",
          banlistLoading: "Loading banlist…",
          banlistCount: (n: number) => `${n} entr${n > 1 ? "ies" : "y"}`,
          formBase: "Base form",
          formLabel: (f: number) => `Form ${f}`,
        },
      },
      lead: {
        title: "Combat Lead",
        subtitle: "Ranked matchmaking",
        comingSoon: "Coming soon",
        queueTitle: "Join the queue",
        queueSubtitle: "Find an opponent at your elo level.",
        queueBtn: "Coming soon",
        myRank: "Your rank",
        leaderboardTitle: "Leaderboard",
        leaderboardEmpty: "Leaderboard coming soon",
        footer:
          "Matchmaking will open shortly. Stats and leaderboard will be reset at the official launch.",
        columns: {
          rank: "Rank",
          player: "Player",
          elo: "Elo",
          wins: "W",
          losses: "L",
          winrate: "Winrate",
        },
      },
      amical: {
        title: "Friendly Combat",
        subtitle: "Free versus",
        sidebarTitle: "Online players",
        sidebarFilter: "Filter…",
        sidebarCount: (n: number) => `${n} online`,
        sidebarEmpty: "No players online",
        emptyStateTitle: "Ready to battle?",
        emptyStateBody:
          "Pick a player in the list on the right to view their profile and start a challenge.",
        challengeBtn: "Challenge",
        viewProfileBtn: "View profile",
        statusAvailable: "Available",
        statusInGame: "In game",
        statusInBattle: "In battle",
        disabledBecauseInBattle: "This player is already in a battle",
        disabledBecauseOwnBattle: "You already have a battle in progress",
        disabledBecauseSelf: "That's you!",
        profileStatsTitle: "Player statistics",
        profileNoBio: "No bio.",
      },
      profile: {
        title: "Battle Profile",
        subtitle: "Your PvP trainer journey",
        anonymous: "Player",
        backToAmical: "Back to Friendly Combat",
        viewingOther: (name: string) => `${name}'s profile`,
        stats: {
          wins: "Wins",
          losses: "Losses",
          winrate: "Winrate",
          elo: "Rank",
          lp: "LP",
          unranked: "Unranked",
        },
        filters: {
          all: "All",
          amical: "Casual",
          ranked: "Ranked",
        },
        history: {
          title: "Match history",
          loading: "Loading history…",
          loadingMore: "Loading more matches…",
          endOfHistory: "End of history",
          empty: "No matches yet",
          emptyHint: "Start a challenge to begin your journey!",
          resultWin: "Victory",
          resultLoss: "Defeat",
          resultDraw: "Draw",
          typeAmical: "Casual",
          typeRanked: "Ranked",
          vs: "vs",
          teamTitle: "Team used",
          youLabel: "You",
          teamUnknown: "Team unknown",
          durationLabel: "Duration:",
          lpGain: (n: number) => `+${n} LP`,
          lpLoss: (n: number) => `-${n} LP`,
          lpZero: "0 LP",
          timeAgoNow: "just now",
          timeAgoMin: (n: number) => `${n} min ago`,
          timeAgoHour: (n: number) => `${n} h ago`,
          timeAgoDay: (n: number) => `${n} d ago`,
        },
      },
      banner: {
        incomingTitle: "Challenge received!",
        incomingDesc: (name: string) => `${name} is challenging you`,
        accept: "Accept",
        decline: "Decline",
        sentTitle: "Challenge sent",
        sentDesc: (name: string) => `Waiting for ${name}...`,
        waitingTitle: "Launching…",
        waitingDesc: "Preparing the battle in-game",
        liveTitle: "LIVE",
        liveDesc: (name: string) => `Battle vs ${name}`,
        spectators: (n: number) => `${n} spectator${n > 1 ? "s" : ""}`,
        cancel: "Cancel",
        forfeit: "Forfeit",
        close: "Close",
        completeWin: "Victory!",
        completeLoss: "Defeat...",
        completeDraw: "Draw",
        completeGeneric: "Battle ended!",
        forfeitReason: (name: string) => `${name} forfeited the battle`,
        crashReason: (name: string) => `Technical issue with ${name}`,
        errorTitle: "Error",
      },
      errors: {
        gameNotRunning: "Launch the game before challenging a player!",
        gameNotRunningAccept: "Launch the game before accepting a battle!",
        serverUnavailable:
          "Battle server connection unavailable. Try again.",
        bannedInTeam: (matches: BannedInTeamMatch[]) => {
          const lines = matches
            .map((m) => {
              const formPart = m.banned.form != null ? ` (form ${m.banned.form})` : "";
              const reasonPart = m.banned.reason ? ` — ${m.banned.reason}` : "";
              return `• ${m.banned.name}${formPart}${reasonPart}`;
            })
            .join("\n");
          const count = matches.length;
          const plural = count > 1 ? "s" : "";
          return `Battle blocked: your team contains ${count} banned Pokémon${plural}:\n\n${lines}\n\nRemove ${count > 1 ? "them" : "it"} from your team to battle.`;
        },
        invalidStatsInTeam: (matches: InvalidStatsMatch[]) => {
          const statLabels: Record<string, string> = {
            hp: "HP", atk: "Atk", dfe: "Def", spd: "Spe", ats: "SpA", dfs: "SpD",
          };
          const lines = matches
            .map((m) => {
              const details = m.violations.map((v) => {
                if (v.kind === "iv_over") return `  ▸ IV ${statLabels[v.stat]}: ${v.value} (max 31)`;
                if (v.kind === "ev_over") return `  ▸ EV ${statLabels[v.stat]}: ${v.value} (max 252)`;
                return `  ▸ Total EV: ${v.total} (max 510)`;
              });
              return `◆ ${m.label}\n${details.join("\n")}`;
            })
            .join("\n\n");
          const count = matches.length;
          const plural = count > 1 ? "s" : "";
          return `Invalid stats detected on ${count} Pokémon${plural}:\n\n${lines}`;
        },
      },
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
      battleOutOfDateTitle: "Game out of date",
      battleOutOfDateBody:
        "Your game version is out of date. Please update the game before entering the Battle Tower to ensure fair matches between all players.",
      battleOutOfDateOk: "Got it",
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
