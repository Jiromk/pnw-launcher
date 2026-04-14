#!/usr/bin/env node
// scripts/push-update.mjs
// Après `tauri build` : upload le .exe vers R2, puis push version + signature + URL au site.
//
// Usage :
//   node scripts/push-update.mjs [--notes "Texte des changements"]
//
// Variables d'environnement requises (dans .env.local) :
//   LAUNCHER_PUSH_TOKEN    — Token secret pour l'API du site
//   R2_ACCOUNT_ID          — Cloudflare R2 account ID
//   R2_ACCESS_KEY_ID       — R2 access key
//   R2_SECRET_ACCESS_KEY   — R2 secret key
//   R2_BUCKET_NAME         — Nom du bucket (défaut : pokemon-new-world)
//   R2_PUBLIC_URL          — URL publique du bucket R2
//   PNW_SITE_URL           — URL du site (défaut : https://www.pokemonnewworld.fr)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

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

// ── Répertoire du bundle NSIS ──
const bundleDir = path.join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");

// ── Recherche du fichier .sig correspondant à la version ──
let sigContent = "";
if (fs.existsSync(bundleDir)) {
  const allSigs = fs.readdirSync(bundleDir).filter((f) => f.endsWith(".sig"));
  const versionSig = allSigs.find((f) => f.includes(version));
  const sigFile = versionSig || allSigs.sort((a, b) => {
    const sa = fs.statSync(path.join(bundleDir, a)).mtimeMs;
    const sb = fs.statSync(path.join(bundleDir, b)).mtimeMs;
    return sb - sa;
  })[0];
  if (sigFile) {
    console.log(`🔑 Signature sélectionnée : ${sigFile}`);
    sigContent = fs.readFileSync(path.join(bundleDir, sigFile), "utf-8").trim();
  }
}
if (!sigContent) {
  console.error("❌ Fichier .sig introuvable dans", bundleDir);
  process.exit(1);
}

// ── Recherche du fichier .exe (setup) correspondant à la version ──
let exePath = "";
if (fs.existsSync(bundleDir)) {
  // Priorité : fichier contenant la version actuelle, sinon le plus récent
  const allExes = fs.readdirSync(bundleDir).filter((f) => f.endsWith(".exe"));
  const versionExe = allExes.find((f) => f.includes(version));
  const exeFile = versionExe || allExes.sort((a, b) => {
    const sa = fs.statSync(path.join(bundleDir, a)).mtimeMs;
    const sb = fs.statSync(path.join(bundleDir, b)).mtimeMs;
    return sb - sa;
  })[0];
  if (exeFile) {
    exePath = path.join(bundleDir, exeFile);
  }
}
if (!exePath) {
  console.error("❌ Fichier .exe introuvable dans", bundleDir);
  process.exit(1);
}

// ── Notes de mise à jour (via --notes "text" ou --notes-file "path") ──
let notes = "";
console.log(`🔍 argv: ${JSON.stringify(process.argv.slice(2))}`);
const notesIdx = process.argv.indexOf("--notes");
if (notesIdx !== -1 && process.argv[notesIdx + 1]) {
  notes = process.argv[notesIdx + 1];
  console.log(`📋 Notes via --notes: "${notes.slice(0, 60)}"`);
}
const notesFileIdx = process.argv.indexOf("--notes-file");
if (notesFileIdx !== -1 && process.argv[notesFileIdx + 1]) {
  const nfPath = process.argv[notesFileIdx + 1];
  console.log(`📋 Notes file path: "${nfPath}" (exists: ${fs.existsSync(nfPath)})`);
  if (fs.existsSync(nfPath)) {
    notes = fs.readFileSync(nfPath, "utf-8").trim();
    console.log(`📋 Notes lues du fichier (${notes.length} chars): "${notes.slice(0, 60)}"`);
  }
}

// ── Variables d'environnement ──
const token = process.env.LAUNCHER_PUSH_TOKEN;
if (!token) {
  console.error("❌ Variable LAUNCHER_PUSH_TOKEN manquante");
  process.exit(1);
}

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || "pokemon-new-world";
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_URL) {
  console.error("❌ Variables R2 manquantes (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL)");
  process.exit(1);
}

const siteUrl = (process.env.PNW_SITE_URL || "https://www.pokemonnewworld.fr").replace(/\/$/, "");

// ── 1. Upload .exe vers R2 (supprime l'ancien d'abord) ──
const exeFilename = path.basename(exePath);
const r2Key = exeFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
const exeSize = fs.statSync(exePath).size;

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// Suppression des anciens .exe launcher dans R2
try {
  console.log("🗑️  Recherche d'anciens launchers dans R2...");
  const list = await r2Client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, MaxKeys: 200 }));
  const oldKeys = (list.Contents || [])
    .map((o) => o.Key)
    .filter((k) => k && /PNW.Launcher.*\.exe/i.test(k) && k !== r2Key);
  if (oldKeys.length > 0) {
    for (const oldKey of oldKeys) {
      await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }));
      console.log(`   🗑️  Supprimé : ${oldKey}`);
    }
  } else {
    console.log("   Aucun ancien launcher trouvé.");
  }
} catch (err) {
  console.warn(`⚠️  Impossible de nettoyer R2 :`, err.message);
  // On continue quand même
}

// Upload du nouveau .exe
console.log(`📦 Upload ${exeFilename} (${(exeSize / 1024 / 1024).toFixed(1)} MB) vers R2...`);
try {
  const fileBuffer = fs.readFileSync(exePath);
  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: "application/x-msdownload",
    })
  );
  console.log(`✅ Upload R2 terminé : ${R2_PUBLIC_URL}/${r2Key}`);
} catch (err) {
  console.error(`❌ Erreur upload R2 :`, err.message);
  process.exit(1);
}

const launcherUrl = `${R2_PUBLIC_URL}/${r2Key}`;

// ── 2. Push version + signature + URL au site ──
console.log(`📤 Push v${version} vers ${siteUrl}...`);
console.log(`   Signature : ${sigContent.slice(0, 40)}…`);
console.log(`   URL : ${launcherUrl}`);
if (notes) console.log(`   Notes : ${notes.slice(0, 60)}…`);

const resp = await fetch(`${siteUrl}/api/downloads/launcher-push`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ version, signature: sigContent, notes, launcherUrl }),
});

if (resp.ok) {
  const data = await resp.json();
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║           ✅ MISE À JOUR PUBLIÉE !              ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Version  : ${data.version.padEnd(37)}║`);
  console.log(`║  .exe     : Uploadé sur R2                      ║`);
  console.log(`║  Signature: Envoyée au site                     ║`);
  console.log(`║  Site     : ${siteUrl.slice(0, 37).padEnd(37)}║`);
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");
} else {
  const text = await resp.text();
  console.error(`❌ Erreur ${resp.status} : ${text}`);
  process.exit(1);
}
