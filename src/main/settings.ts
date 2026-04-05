import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface AppSettings {
  modelsDirectory: string;
  allocatedVRAM?: number;
  allocatedRAM?: number;
}

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_MODELS_DIR = path.join(app.getPath('userData'), 'models');

const DEFAULT_SETTINGS: AppSettings = {
  modelsDirectory: DEFAULT_MODELS_DIR,
};

let cachedSettings: AppSettings | null = null;

// Ensure the directory exists
function ensureDirectory(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadSettings(): AppSettings {
  if (cachedSettings) return cachedSettings;

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      cachedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } else {
      cachedSettings = { ...DEFAULT_SETTINGS };
    }
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }

  // Ensure models directory exists
  ensureDirectory(cachedSettings!.modelsDirectory);

  return cachedSettings!;
}

export function saveSettings(settings: AppSettings): void {
  cachedSettings = settings;
  const dir = path.dirname(SETTINGS_FILE);
  ensureDirectory(dir);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

export function getModelsDirectory(): string {
  return loadSettings().modelsDirectory;
}
