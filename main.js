const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Start the backend server (production mode only; dev mode uses ts-node-dev separately)
if (!isDev) {
  const backendPath = path.join(__dirname, 'backend', 'dist', 'backend', 'src', 'server.js');
  if (fs.existsSync(backendPath)) {
    require(backendPath);
  } else {
    console.log('Backend compiled server not found.');
  }
} else {
  console.log('Running in Development mode: Backend is handled by concurrent ts-node-dev watcher.');
}

// Build a tray icon purely from a data URL — no file required, never fails to load
function buildTrayIcon() {
  // 16x16 purple rounded square with 🎛️ feel — encoded as a simple SVG data URL
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
    <rect width="16" height="16" rx="3" fill="#4f46e5"/>
    <rect x="2" y="2" width="5" height="5" rx="1" fill="white" opacity="0.9"/>
    <rect x="9" y="2" width="5" height="5" rx="1" fill="white" opacity="0.9"/>
    <rect x="2" y="9" width="5" height="5" rx="1" fill="white" opacity="0.9"/>
    <rect x="9" y="9" width="5" height="5" rx="1" fill="white" opacity="0.9"/>
  </svg>`;
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return nativeImage.createFromDataURL(dataUrl);
}

function createTray() {
  try {
    const icon = buildTrayIcon();
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show WebPCDeck',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: 'Hide to Tray',
        click: () => {
          if (mainWindow) mainWindow.hide();
        }
      },
      { type: 'separator' },
      {
        label: 'Exit App',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('WebPCDeck - Macro Controller');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    console.log('System tray icon created successfully.');
  } catch (err) {
    // Tray is optional — app still works without it
    console.warn('Failed to create tray icon:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'WebPCDeck',
    backgroundColor: '#090d16',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Uncomment the next line to open DevTools for debugging:
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
  }

  // Hide to tray on close instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
