import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

let CONFIG_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'webpcdeck')
  : (process.env.APPDATA 
      ? path.join(process.env.APPDATA, 'WebPCDeck')
      : path.join(os.homedir(), '.webpcdeck'));

let TOKENS_FILE = path.join(CONFIG_DIR, 'tokens.json');

class AuthManager {
  private pairingCode: string = '';
  private validTokens: Set<string> = new Set();

  constructor() {
    this.generateNewPairingCode();
    this.loadTokens();
  }

  generateNewPairingCode(): string {
    // Generate a 6-digit random code
    this.pairingCode = Math.floor(100000 + Math.random() * 900000).toString();
    return this.pairingCode;
  }

  getPairingCode(): string {
    return this.pairingCode;
  }

  pairDevice(code: string): { success: boolean; token?: string } {
    if (code === this.pairingCode) {
      const token = uuidv4();
      this.validTokens.add(token);
      this.saveTokens();
      return { success: true, token };
    }
    return { success: false };
  }

  validateToken(token: string): boolean {
    return this.validTokens.has(token);
  }

  isLocalAddress(ip?: string): boolean {
    if (!ip) return false;
    // Handle all loopback variants without regex mangling:
    // - "127.0.0.1"           IPv4 loopback
    // - "::1"                 IPv6 loopback
    // - "::ffff:127.0.0.1"   IPv4-mapped IPv6 loopback
    // - "localhost"           hostname
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === 'localhost' ||
      ip === '::ffff:127.0.0.1' ||
      ip.startsWith('::ffff:127.')
    );
  }

  private loadTokens(): void {
    try {
      if (fs.existsSync(TOKENS_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
        if (Array.isArray(data)) {
          this.validTokens = new Set(data);
        }
      }
    } catch (err) {
      console.error('Failed to load pairing tokens:', err);
    }
  }

  private saveTokens(): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(
        TOKENS_FILE,
        JSON.stringify(Array.from(this.validTokens), null, 2),
        'utf-8'
      );
    } catch (err) {
      console.error('Failed to save pairing tokens:', err);
    }
  }
}

export const auth = new AuthManager();
