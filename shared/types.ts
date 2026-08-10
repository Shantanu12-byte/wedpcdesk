export type ActionType = 'launch' | 'shortcut' | 'volume' | 'power' | 'command';

export interface ActionConfig {
  type: ActionType;
  launchPath?: string;
  shortcutKeys?: string;
  volumeType?: 'up' | 'down' | 'mute';
  powerType?: 'lock' | 'sleep' | 'minimize_all' | 'shutdown' | 'restart';
  commandStr?: string;
}

export interface ButtonConfig {
  id: string;
  label: string;
  icon: string; // Emoji or image URL/base64
  color: string; // Hex or CSS color
  action: ActionConfig;
  confirmBeforeRun: boolean;
}

export interface Profile {
  id: string;
  name: string;
  rows: number;
  cols: number;
  buttons: Record<string, ButtonConfig>; // Keyed by "row,col"
}

export interface DeckConfig {
  profiles: Profile[];
  activeProfileId: string;
}

export interface ServerState {
  lanIp: string;
  port: number;
  pairingCode: string;
  connectedClients: number;
}
