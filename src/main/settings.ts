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

type MemorySettingsListener = (next: {
  allocatedVRAM: number | undefined;
  allocatedRAM: number | undefined;
}) => void;

const memoryListeners = new Set<MemorySettingsListener>();

export function onMemorySettingsChanged(
  listener: MemorySettingsListener,
): () => void {
  memoryListeners.add(listener);
  return () => memoryListeners.delete(listener);
}

function notifyMemoryListeners(settings: AppSettings) {
  const payload = {
    allocatedVRAM: settings.allocatedVRAM,
    allocatedRAM:  settings.allocatedRAM,
  };
  for (const listener of memoryListeners) {
    listener(payload);
  }
}

function ensureDirectory(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch (err) {
    console.error(`[Settings] Failed to ensure directory exists: ${dir}`, err);
    return false;
  }
}

export function loadSettings(): AppSettings {
  if (cachedSettings) return cachedSettings;

  let loadedSettings: AppSettings = { ...DEFAULT_SETTINGS };

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      loadedSettings = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (err) {
    console.error('[Settings] Failed to parse settings.json, using defaults.', err);
    loadedSettings = { ...DEFAULT_SETTINGS };
  }

  const dirCreated = ensureDirectory(loadedSettings.modelsDirectory);
  if (!dirCreated) {
    console.warn('[Settings] Falling back to default models directory.');
    loadedSettings.modelsDirectory = DEFAULT_MODELS_DIR;
    ensureDirectory(DEFAULT_MODELS_DIR);
  }

  cachedSettings = loadedSettings;
  return cachedSettings;
}

export function saveSettings(settings: AppSettings): void {
  const previous = cachedSettings;
  cachedSettings = settings;

  const dir = path.dirname(SETTINGS_FILE);
  if (ensureDirectory(dir)) {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Settings] Failed to write settings to disk:', err);
    }
  }

  // Notify listeners only when memory settings actually changed
  const vramChanged = previous?.allocatedVRAM !== settings.allocatedVRAM;
  const ramChanged  = previous?.allocatedRAM  !== settings.allocatedRAM;
  if (vramChanged || ramChanged) {
    console.log(
      `[Settings] Memory settings changed — ` +
      `VRAM: ${previous?.allocatedVRAM ?? '?'} → ${settings.allocatedVRAM ?? '?'} MB, ` +
      `RAM: ${previous?.allocatedRAM  ?? '?'} → ${settings.allocatedRAM  ?? '?'} MB`,
    );
    notifyMemoryListeners(settings);
  }
}

export function getModelsDirectory(): string {
  return loadSettings().modelsDirectory;
}
