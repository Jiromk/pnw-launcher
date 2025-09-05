export type Manifest = {
  version: string;
  zip_url: string;
  game_exe?: string; // défaut: Game.exe
  // optionnel: "folder" pour dézipper dans un sous-dossier
  folder?: string;
};
