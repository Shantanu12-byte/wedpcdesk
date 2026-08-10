import fs from 'fs';
import path from 'path';
import os from 'os';
import { DeckConfig, Profile } from '../../shared/types';

let CONFIG_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'webpcdeck')
  : (process.env.APPDATA 
      ? path.join(process.env.APPDATA, 'WebPCDeck')
      : path.join(os.homedir(), '.webpcdeck'));

let CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_PROFILE: Profile = {
  id: 'default',
  name: 'Default Profile',
  rows: 3,
  cols: 5,
  buttons: {
    '0,0': {
      id: 'vol-up',
      label: 'Volume Up',
      icon: '🔊',
      color: '#4f46e5',
      action: { type: 'volume', volumeType: 'up' },
      confirmBeforeRun: false,
    },
    '0,1': {
      id: 'vol-down',
      label: 'Volume Down',
      icon: '🔉',
      color: '#4f46e5',
      action: { type: 'volume', volumeType: 'down' },
      confirmBeforeRun: false,
    },
    '0,2': {
      id: 'vol-mute',
      label: 'Mute',
      icon: '🔇',
      color: '#e11d48',
      action: { type: 'volume', volumeType: 'mute' },
      confirmBeforeRun: false,
    },
    '1,0': {
      id: 'min-all',
      label: 'Show Desktop',
      icon: '🖥️',
      color: '#0891b2',
      action: { type: 'power', powerType: 'minimize_all' },
      confirmBeforeRun: false,
    },
    '1,1': {
      id: 'lock-pc',
      label: 'Lock Screen',
      icon: '🔒',
      color: '#d97706',
      action: { type: 'power', powerType: 'lock' },
      confirmBeforeRun: true,
    },
    '1,2': {
      id: 'notepad',
      label: 'Notepad',
      icon: '📝',
      color: '#16a34a',
      action: { type: 'launch', launchPath: 'notepad.exe' },
      confirmBeforeRun: false,
    },
  },
};

const DEFAULT_CONFIG: DeckConfig = {
  profiles: [DEFAULT_PROFILE],
  activeProfileId: 'default',
};

export function loadConfig(): DeckConfig {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    if (!fs.existsSync(CONFIG_FILE)) {
      saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }

    const rawData = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(rawData) as DeckConfig;
  } catch (error) {
    console.error('Error loading config, falling back to default:', error);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: DeckConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving config:', error);
  }
}

export function getExportableConfigPath(): string {
  return CONFIG_FILE;
}
