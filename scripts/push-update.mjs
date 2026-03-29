#!/usr/bin/env node
// scripts/push-update.mjs
// Envoie automatiquement la version et la signature au site après `tauri build`.
//
// Usage :
//   node scripts/push-update.mjs [--notes "Texte des changements"]
//
// Variables d'environnement requises :
//   LAUNCHER_PUSH_TOKEN  — Token secret (même valeur que sur le serveur)
//   PNW_SITE_URL         — URL du site (défaut : https://www.pokemonnewworld.fr)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Lecture de la version depuis tauri.conf.json ──
const confPath = path.join(ROOT, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(fs.readFileSync(confPath, "utf-8"));
const version = conf.version;
if (!version) {
  console.error("❌ Pas de version dans tauri.conf.json");
  process.exit(1);
}

// ── Recherche du fichier .sig ──
const bundleDir = path.join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");
let sigContent = "";
if (fs.existsSync(bundleDir)) {
  const sigFile = fs.readdirSync(bundleDir).find((f) => f.endsWith(".sig"));
  if (sigFile) {
    sigContent = fs.readFileSync(path.join(bundleDir, sigFile), "utf-8").trim();
  }
}
if (!sigContent) {
  console.error("❌ Fichier .sig introuvable dans", bundleDir);
  console.error("   As-tu lancé `tauri build` avec TAURI_SIGNING_PRIVATE_KEY ?");
  process.exit(1);
}

// ── Notes de mise à jour (optionnel via --notes) ──
let notes = "";
const notesIdx = process.argv.indexOf("--notes");
if (notesIdx !== -1 && process.argv[notesIdx + 1]) {
  notes = process.argv[notesIdx + 1];
}

// ── Envoi au site ──
const token = process.env.LAUNCHER_PUSH_TOKEN;
if (!token) {
  console.error("❌ Variable d'environnement LAUNCHER_PUSH_TOKEN manquante");
  process.exit(1);
}

const siteUrl = (process.env.PNW_SITE_URL || "https://www.pokemonnewworld.fr").replace(/\/$/, "");
const url = `${siteUrl}/api/downloads/launcher-push`;

console.log(`📤 Push v${version} vers ${siteUrl}...`);
console.log(`   Signature : ${sigContent.slice(0, 40)}…`);
if (notes) console.log(`   Notes : ${notes.slice(0, 60)}…`);

const resp = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ version, signature: sigContent, notes }),
});

if (resp.ok) {
  const data = await resp.json();
  console.log(`✅ Push réussi ! Version ${data.version} enregistrée sur le site.`);
} else {
  const text = await resp.text();
  console.error(`❌ Erreur ${resp.status} : ${text}`);
  process.exit(1);
}
