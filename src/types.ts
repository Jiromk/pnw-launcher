export type Manifest = {
  version: string;
  downloadUrl?: string;
  zip_url?: string;
  game_exe?: string;
  folder?: string;
  name?: string;
  releaseDate?: string;
  minimumLauncherVersion?: string;
  changelog?: any;
  downloadSize?: number;
  files?: any[];
  requirements?: any;
  integrity?: any;
};
