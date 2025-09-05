# Pokemon New World Launcher

Système de mise à jour automatique pour Pokemon New World.

## 🎮 Pour les joueurs

Le launcher permet de :
- ✅ Télécharger automatiquement les mises à jour
- ✅ Vérifier l'intégrité des fichiers
- ✅ Lancer le jeu directement
- ✅ Consulter les notes de mise à jour

### Installation

1. Téléchargez le launcher depuis [la section Releases](https://github.com/Jiromk/pnw-launcher/releases)
2. Placez le launcher dans un dossier dédié
3. Lancez le launcher et laissez-le télécharger le jeu

## 🔧 Pour les développeurs

### Structure du projet

```
pnw-launcher/
├── manifests/          # Historique des versions
├── patches/            # Archives des patchs
├── scripts/            # Scripts de build
├── latest.json         # Manifest de la dernière version
└── CHANGELOG.md        # Historique des changements
```

### Créer une nouvelle mise à jour

1. Préparez les fichiers du jeu mis à jour
2. Utilisez le script de création de patch :
   ```bash
   python scripts/create_patch.py VERSION CHEMIN_JEU --changelog-fr "Notes en FR"
   ```
3. Committez et créez un tag :
   ```bash
   git add .
   git commit -m "Release vX.X.X"
   git tag -a vX.X.X -m "Version X.X.X"
   git push origin main --tags
   ```
4. Uploadez le patch dans la release GitHub

### Format du manifest

Le fichier `latest.json` contient :
- Version actuelle
- URL de téléchargement
- Liste des fichiers avec leurs hash
- Notes de mise à jour multilingues

## 📦 Téléchargements

- **Launcher** : [Télécharger la dernière version](https://github.com/Jiromk/pnw-launcher/releases/latest)
- **Jeu complet** : Via le launcher

## 🤝 Support

Pour toute question ou problème :
- Ouvrez une [Issue](https://github.com/Jiromk/pnw-launcher/issues)
- Contactez l'équipe sur Discord

## 📄 License

© 2025 Pokemon New World Team