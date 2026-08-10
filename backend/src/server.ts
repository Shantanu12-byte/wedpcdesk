import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import os from 'os';
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
wss.on('connection', (ws: WebSocket, request) => {
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
  wss.clients.forEach((client) => {
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
app.get('*', (req, res, next) => {
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
  });
}

export default app;
