import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import os from 'os';
import { exec, spawn } from 'child_process';
import url from 'url';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { auth } from './auth';
import { loadConfig, saveConfig } from './config';
import { WindowsActionExecutor } from './actions/windows';
import { ActionConfig, DeckConfig } from '../../shared/types';

// Load .env.local from project root or environment-specific locations
const envCandidates = [
  path.join(__dirname, '..', '..', '.env.local'), // Dev mode root
  path.join(__dirname, '..', '..', '..', '..', '.env.local'), // Packaged app.asar root
  path.join(process.cwd(), '.env.local'), // Current working directory
  path.join(path.dirname(process.execPath), '.env.local'), // Next to executable
];

let envPath = '';
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    envPath = p;
    break;
  }
}

if (envPath) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}



const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const actionExecutor = new WindowsActionExecutor();
const PORT = 5001;

// Find LAN IP
function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (ifaceList) {
      for (const net of ifaceList) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }
  return '127.0.0.1';
}

const LAN_IP = getLanIp();

let ngrokProcess: any = null;
let activeTunnelUrl: string | null = null;

function logDebug(msg: string) {
  const logPath = path.join(os.tmpdir(), 'webpcdeck-tunnel.log');
  const timestamp = new Date().toISOString();
  try {
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
  } catch (e) {
    // Ignore log write errors
  }
  console.log(msg);
}

function findNgrok(): string | null {
  const candidates = [
    path.join(process.cwd(), 'ngrok.exe'),
    path.join(process.cwd(), '..', 'ngrok.exe'),
    path.join(__dirname, '..', '..', 'ngrok.exe'),
    path.join(__dirname, '..', '..', '..', 'ngrok.exe'),
    path.join(__dirname, '..', '..', '..', '..', 'ngrok.exe'),
    path.join(__dirname, '..', '..', '..', '..', '..', 'app.asar.unpacked', 'ngrok.exe'),
    path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'ngrok.exe'),
    path.join(path.dirname(process.execPath), 'ngrok.exe'),
    'ngrok', // fallback: system PATH
  ];

  logDebug(`[Tunnel] Searching for ngrok.exe...`);
  for (const p of candidates) {
    if (p === 'ngrok') continue; // skip PATH check in loop
    
    // If path is inside app.asar, it must be run from app.asar.unpacked
    let targetPath = p;
    if (p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
      targetPath = p.replace('app.asar', 'app.asar.unpacked');
    }

    const exists = fs.existsSync(targetPath);
    logDebug(`[Tunnel] Checking: ${targetPath} (exists: ${exists})`);
    if (exists) return targetPath;
  }
  // Try system PATH as last resort
  return 'ngrok';
}

function startNgrokTunnel() {
  const authToken = process.env.NGROK_AUTH_TOKEN;
  const staticDomain = process.env.NGROK_STATIC_DOMAIN;

  if (!authToken || !staticDomain) {
    logDebug('[Tunnel] ⚠️  NGROK_AUTH_TOKEN or NGROK_STATIC_DOMAIN not set in environment. Tunnel not started.');
    logDebug('[Tunnel] Add these to your .env.local file to enable the permanent tunnel.');
    return;
  }

  const ngrokBin = findNgrok();
  if (!ngrokBin) {
    logDebug('[Tunnel] ❌ ngrok executable not found. Place ngrok.exe in c:\\webpcdeck\\');
    return;
  }

  // Since we have a static domain, the URL is known immediately — set it now
  activeTunnelUrl = `https://${staticDomain}`;
  logDebug(`🔗 NGROK PERMANENT TUNNEL URL: ${activeTunnelUrl}`);

  const args = [
    'http',
    `--authtoken=${authToken}`,
    `--domain=${staticDomain}`,
    `${PORT}`,
    '--log=stdout',
    '--log-format=json',
  ];

  logDebug(`[Tunnel] Spawning: ${ngrokBin} ${args.slice(0, -2).join(' ')} ${PORT} ...`);

  ngrokProcess = spawn(ngrokBin, args, { shell: false });

  ngrokProcess.stdout.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    logDebug(`[ngrok stdout] ${text}`);
  });

  ngrokProcess.stderr.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    logDebug(`[ngrok stderr] ${text}`);
  });

  ngrokProcess.on('error', (err: any) => {
    logDebug(`[Tunnel error] Failed to start ngrok: ${err.message}`);
    activeTunnelUrl = null;
  });

  ngrokProcess.on('close', (code: number) => {
    logDebug(`[Tunnel close] ngrok exited with code ${code}`);
    activeTunnelUrl = null;
    ngrokProcess = null;
  });
}

function cleanupTunnel() {
  if (ngrokProcess) {
    console.log('[Tunnel] Terminating ngrok process...');
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${ngrokProcess.pid} /t /f`, () => {});
      } else {
        ngrokProcess.kill();
      }
    } catch (e) {
      // ignore
    }
  }
}

let smtcProcess: any = null;
let latestMediaState: any = { active: false };

function startSmtcBridge() {
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const srcCandidates = [
    path.join(__dirname, 'smtc_bridge.cs'),
    path.join(__dirname, '..', '..', 'src', 'smtc_bridge.cs'),
    path.join(process.cwd(), 'backend', 'src', 'smtc_bridge.cs'),
  ];
  let srcPath = '';
  for (const c of srcCandidates) {
    if (fs.existsSync(c)) {
      srcPath = c;
      break;
    }
  }
  const exePath = path.join(__dirname, 'smtc_bridge.exe');

  const spawnBridge = () => {
    if (!fs.existsSync(exePath)) {
      console.error('[SMTC] smtc_bridge.exe not found. Media integration disabled.');
      return;
    }
    console.log('[SMTC] Spawning smtc_bridge.exe...');
    smtcProcess = spawn(exePath, [], { shell: false });

    const rl = readline.createInterface({
      input: smtcProcess.stdout,
      terminal: false
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.log) {
          console.log('[SMTC Log]', parsed.log);
        } else if (parsed.error) {
          console.error('[SMTC Bridge Error]', parsed.error);
        } else {
          latestMediaState = parsed;
          broadcastToAll({ type: 'media_update', media: latestMediaState });
        }
      } catch (e) {
        console.log('[SMTC stdout]', trimmed);
      }
    });

    smtcProcess.stderr.on('data', (data: Buffer) => {
      console.error('[SMTC stderr]', data.toString().trim());
    });

    smtcProcess.on('close', (code: number) => {
      console.log(`[SMTC] Process exited with code ${code}. Restarting in 5s...`);
      smtcProcess = null;
      setTimeout(spawnBridge, 5000);
    });
  };

  if (fs.existsSync(cscPath) && fs.existsSync(srcPath)) {
    console.log('[SMTC] Compiling smtc_bridge.cs...');
    const args = [
      '/r:System.Runtime.dll',
      '/r:System.Runtime.InteropServices.WindowsRuntime.dll',
      '/r:System.Runtime.WindowsRuntime.dll',
      '/r:C:\\Windows\\System32\\WinMetadata\\Windows.Media.winmd',
      '/r:C:\\Windows\\System32\\WinMetadata\\Windows.Foundation.winmd',
      '/r:C:\\Windows\\System32\\WinMetadata\\Windows.Storage.winmd',
      `/out:${exePath}`,
      srcPath
    ];
    const compileProc = spawn(cscPath, args, { shell: false });
    compileProc.on('close', (code) => {
      if (code === 0) {
        console.log('[SMTC] Compilation successful.');
      } else {
        console.error('[SMTC] Compilation failed with code', code);
      }
      spawnBridge();
    });
  } else {
    spawnBridge();
  }
}

function cleanupSmtc() {
  if (smtcProcess) {
    console.log('[SMTC] Terminating SMTC process...');
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${smtcProcess.pid} /t /f`, () => {});
      } else {
        smtcProcess.kill();
      }
    } catch (e) {}
  }
}

process.on('SIGINT', () => {
  cleanupTunnel();
  cleanupSmtc();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupTunnel();
  cleanupSmtc();
  process.exit(0);
});

process.on('exit', () => {
  cleanupTunnel();
  cleanupSmtc();
});


// Middleware: Authenticate incoming HTTP requests
function authenticateRequest(req: Request, res: Response, next: NextFunction) {
  const clientIp = req.socket.remoteAddress || req.ip;

  // Auto-approve local requests (disabled on Vercel where proxying routes through localhost)
  if (!process.env.VERCEL && auth.isLocalAddress(clientIp)) {
    return next();
  }

  // Check for pairing token for external requests
  const token = req.headers['x-pairing-token'] || req.query.token;
  if (typeof token === 'string' && auth.validateToken(token)) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized. Pairing required.' });
}

// REST Endpoints
app.get('/api/state', (req: Request, res: Response) => {
  const clientIp = req.socket.remoteAddress || req.ip;
  const isLocal = !process.env.VERCEL && auth.isLocalAddress(clientIp);

  res.json({
    lanIp: LAN_IP,
    port: PORT,
    // Only display actual pairing code to local clients for security
    pairingCode: isLocal ? auth.getPairingCode() : '******',
    connectedClients: wss.clients.size,
    isLocal,
    tunnelUrl: activeTunnelUrl,
  });
});

app.post('/api/pair', (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Pairing code required' });
  }

  const result = auth.pairDevice(code);
  if (result.success) {
    return res.json({ success: true, token: result.token });
  }

  return res.status(401).json({ error: 'Invalid pairing code' });
});

// Load config endpoint (requires auth if remote)
app.get('/api/config', authenticateRequest, (req: Request, res: Response) => {
  res.json(loadConfig());
});

// Save config endpoint (requires auth if remote)
app.post('/api/config', authenticateRequest, (req: Request, res: Response) => {
  const newConfig = req.body as DeckConfig;
  saveConfig(newConfig);
  broadcastToAll({ type: 'config_update', config: newConfig });
  res.json({ success: true });
});

// Calculate CPU load over a short interval
function getCpuUsage(): Promise<number> {
  const start = os.cpus();
  return new Promise((resolve) => {
    setTimeout(() => {
      const end = os.cpus();
      let idleDifference = 0;
      let totalDifference = 0;
      for (let i = 0; i < start.length; i++) {
        const s = start[i];
        const e = end[i];
        const sTotal = Object.values(s.times).reduce((a, b) => a + b, 0);
        const eTotal = Object.values(e.times).reduce((a, b) => a + b, 0);
        totalDifference += (eTotal - sTotal);
        idleDifference += (e.times.idle - s.times.idle);
      }
      const usage = totalDifference > 0 ? (1 - idleDifference / totalDifference) * 100 : 0;
      resolve(Math.round(usage));
    }, 100);
  });
}

function getCpuTemp(): Promise<number | null> {
  return new Promise((resolve) => {
    exec("powershell -Command \"(Get-Counter -Counter '\\Thermal Zone Information(*)\\Temperature' -ErrorAction SilentlyContinue).CounterSamples[0].CookedValue\"", (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
        return;
      }
      const kelvin = parseFloat(stdout.trim());
      if (isNaN(kelvin)) {
        resolve(null);
      } else {
        resolve(Math.round(kelvin - 273.15));
      }
    });
  });
}

function getGpuTemp(): Promise<number | null> {
  return new Promise((resolve) => {
    exec("nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits", (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(null);
        return;
      }
      const temp = parseInt(stdout.trim(), 10);
      if (isNaN(temp)) {
        resolve(null);
      } else {
        resolve(temp);
      }
    });
  });
}

// System Performance Metrics REST endpoint
app.get('/api/performance', authenticateRequest, async (req: Request, res: Response) => {
  try {
    const [cpuLoad, cpuTemp, gpuTemp] = await Promise.all([
      getCpuUsage(),
      getCpuTemp(),
      getGpuTemp()
    ]);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    res.json({
      cpu: cpuLoad,
      cpuTemp,
      gpuTemp,
      totalMem,
      freeMem,
      usedMem: totalMem - freeMem,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve performance metrics' });
  }
});

// Trigger action endpoint — no auth required (actions only run on the local machine)
// Security for remote phones is enforced at the WebSocket + config level
app.post('/api/action', async (req: Request, res: Response) => {
  const clientIp = req.socket.remoteAddress || req.ip || 'unknown';
  const action = req.body as ActionConfig;
  console.log(`[ACTION] ip=${clientIp} type=${action.type}`, JSON.stringify(action));
  const result = await actionExecutor.execute(action);
  if (result.success) {
    res.json({ success: true });
  } else {
    console.error(`[ACTION ERROR]`, result.error);
    res.status(500).json({ error: result.error });
  }
});

// Control media via C# SMTC bridge
app.post('/api/media/control', (req: Request, res: Response) => {
  const { action } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'Action is required' });
  }
  if (smtcProcess && smtcProcess.stdin) {
    smtcProcess.stdin.write(`${action}\n`);
    res.json({ success: true });
  } else {
    res.status(503).json({ error: 'SMTC bridge is not running' });
  }
});

// WebSocket Server Integration
server.on('upgrade', (request, socket, head) => {
  const parsedUrl = url.parse(request.url || '', true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/ws') {
    // Authenticate WS upgrade request
    const clientIp = request.socket.remoteAddress;
    const isLocal = auth.isLocalAddress(clientIp);

    const token = parsedUrl.query.token;
    const isAuthorized = isLocal || (typeof token === 'string' && auth.validateToken(token));

    if (!isAuthorized) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// WS Client management
wss.on('connection', (ws: WebSocket, request: any) => {
  console.log('WS Client connected');

  // Immediately send initial state
  ws.send(JSON.stringify({ type: 'init', config: loadConfig() }));
  
  // Immediately send the latest media state as well
  ws.send(JSON.stringify({ type: 'media_update', media: latestMediaState }));

  // Note: WebSocket client-to-server messages are retired.
  // The connection is kept purely for pushing config updates to paired clients.
  ws.on('message', (message: string) => {
    console.log('WS Client sent unexpected message:', message);
  });

  ws.on('close', () => {
    console.log('WS Client disconnected');
  });
});

// Broadcast helper
function broadcastToAll(message: any) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Serve static frontend files
const frontendDistPath = fs.existsSync(path.join(__dirname, '..', '..', 'frontend', 'dist'))
  ? path.join(__dirname, '..', '..', 'frontend', 'dist')
  : path.join(__dirname, '..', '..', '..', 'frontend', 'dist');

app.use(express.static(frontendDistPath));

// Fallback all non-API requests to React index.html
app.get('*', (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Handle startup errors (like port already in use) before we start listening
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[FATAL ERROR] Port ${PORT} is already in use.`);
    console.error(`Another instance of WebPCDeck or a conflicting service is running.`);
    console.error(`Please close it or run: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

// Start Server if not on Vercel
if (!process.env.VERCEL) {
  server.listen({ port: PORT, host: '0.0.0.0' }, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
    console.log(`LAN reachable at http://${LAN_IP}:${PORT}`);
    console.log(`\n==========================================`);
    console.log(`🔑 ACTIVE PAIRING CODE: ${auth.getPairingCode()}`);
    console.log(`==========================================\n`);
    startNgrokTunnel();
    startSmtcBridge();
  });
}

export default app;
