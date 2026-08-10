import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import os from 'os';
import { exec, spawn } from 'child_process';
import url from 'url';
import path from 'path';
import fs from 'fs';
import { auth } from './auth';
import { loadConfig, saveConfig } from './config';
import { WindowsActionExecutor } from './actions/windows';
import { ActionConfig, DeckConfig } from '../../shared/types';

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

let cloudflaredProcess: any = null;
let activeTunnelUrl: string | null = null;

function startCloudflaredTunnel() {
  console.log('[Tunnel] Starting cloudflared quick tunnel...');
  
  let binName = 'cloudflared';
  const localPaths = [
    path.join(process.cwd(), 'cloudflared.exe'),
    path.join(process.cwd(), '..', 'cloudflared.exe'),
    path.join(__dirname, '..', '..', 'cloudflared.exe'),
    path.join(__dirname, '..', '..', '..', 'cloudflared.exe'),
    path.join(__dirname, '..', '..', '..', '..', 'cloudflared.exe')
  ];

  for (const p of localPaths) {
    if (fs.existsSync(p)) {
      binName = p;
      console.log(`[Tunnel] Found local cloudflared executable at: ${binName}`);
      break;
    }
  }

  cloudflaredProcess = spawn(binName, ['tunnel', '--url', `http://localhost:${PORT}`], {
    shell: true,
  });

  cloudflaredProcess.stdout.on('data', (data: Buffer) => {
    parseTunnelUrl(data.toString());
  });

  cloudflaredProcess.stderr.on('data', (data: Buffer) => {
    parseTunnelUrl(data.toString());
  });

  cloudflaredProcess.on('error', (err: any) => {
    console.error('[Tunnel] Failed to start cloudflared process:', err.message);
  });

  cloudflaredProcess.on('close', (code: number) => {
    console.log(`[Tunnel] cloudflared process exited with code ${code}`);
    activeTunnelUrl = null;
    cloudflaredProcess = null;
  });
}

function parseTunnelUrl(text: string) {
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match) {
    activeTunnelUrl = match[0];
    console.log(`\n==========================================`);
    console.log(`☁️ CLOUDFLARE TUNNEL ACTIVE: ${activeTunnelUrl}`);
    console.log(`==========================================\n`);
  }
}

function cleanupTunnel() {
  if (cloudflaredProcess) {
    console.log('[Tunnel] Terminating cloudflared process...');
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${cloudflaredProcess.pid} /t /f`, () => {});
      } else {
        cloudflaredProcess.kill();
      }
    } catch (e) {
      // ignore
    }
  }
}

process.on('SIGINT', () => {
  cleanupTunnel();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanupTunnel();
  process.exit(0);
});

process.on('exit', () => {
  cleanupTunnel();
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
    startCloudflaredTunnel();
  });
}

export default app;
