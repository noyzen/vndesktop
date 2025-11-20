const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'public/appicon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#252526',
      symbolColor: '#ffffff',
      height: 30
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenu(null);
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC HANDLERS ---

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.handle('select-file', async (event, extensions) => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Images', extensions: extensions || ['png', 'ico'] }],
    properties: ['openFile']
  });
  return result.filePaths[0];
});

ipcMain.handle('generate-app', async (event, config) => {
  try {
    const targetDir = config.sourcePath;
    
    // 1. Generate package.json
    const packageJson = generatePackageJson(config);
    fs.writeFileSync(path.join(targetDir, 'package.json'), packageJson);

    // 2. Generate main.js (The Electron Host logic)
    const mainJs = generateMainJs(config);
    fs.writeFileSync(path.join(targetDir, 'main.js'), mainJs);

    // 3. Copy Icon if provided, otherwise we assume user handles it or standard icon
    // Note: In a real app, we would copy the file. For now, we update config to point to it.
    
    // 4. Generate Build Script (Simple helper)
    const buildBat = `@echo off
echo Installing dependencies...
call npm install
echo Building Application...
call npm run build
pause`;
    fs.writeFileSync(path.join(targetDir, 'build-app.bat'), buildBat);

    return { success: true };
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

// --- GENERATORS ---

function generatePackageJson(c) {
  const targets = [];
  if (c.targetNsis) targets.push("nsis");
  if (c.targetPortable) targets.push("portable");
  if (c.targetUnpacked) targets.push("dir");

  // Construct build config
  const buildConfig = {
    appId: `com.visualneo.${c.appName.replace(/\s+/g, '').toLowerCase()}`,
    productName: c.productName,
    files: ["**/*"],
    directories: { "output": "dist" },
    win: {
      target: targets,
      icon: c.iconPath ? path.basename(c.iconPath) : undefined
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      shortcutName: c.productName
    }
  };

  const pkg = {
    name: c.appName.toLowerCase().replace(/\s+/g, '-'),
    version: c.version,
    description: `${c.productName} - Desktop Application`,
    main: "main.js",
    author: c.author,
    scripts: {
      "start": "electron .",
      "build": "electron-builder"
    },
    devDependencies: {
      "electron": "^29.1.5",
      "electron-builder": "^24.13.3"
    },
    build: buildConfig
  };

  return JSON.stringify(pkg, null, 2);
}

function generateMainJs(c) {
  // We inject the configuration directly into the generated code variables
  return `
const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// --- CONFIGURATION ---
const APP_TITLE = "${c.productName}";
const ENTRY_FILE = "${c.entryPoint}"; // e.g., index.html
const SAVE_STATE = ${c.saveState};
const TRAY_ENABLED = ${c.trayIcon};
const MIN_TO_TRAY = ${c.minimizeToTray};
const SINGLE_INSTANCE = ${c.singleInstance};
const IS_KIOSK = ${c.kiosk};
const CONTEXT_MENU = false; // Can be exposed to settings later

let mainWindow;
let tray = null;
let isQuitting = false;

// --- STATE MANAGEMENT ---
const statePath = path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    return { width: ${c.width}, height: ${c.height}, x: undefined, y: undefined, isMaximized: false };
  }
}

function saveState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const isMaximized = mainWindow.isMaximized();
  const state = { ...bounds, isMaximized };
  fs.writeFileSync(statePath, JSON.stringify(state));
}

// --- MAIN WINDOW ---
function createWindow() {
  const state = SAVE_STATE ? loadState() : { width: ${c.width}, height: ${c.height} };

  const winConfig = {
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: ${c.minWidth || 0},
    minHeight: ${c.minHeight || 0},
    resizable: ${c.resizable},
    fullscreenable: ${c.fullscreenable},
    kiosk: IS_KIOSK,
    frame: ${c.frame},
    center: ${c.center},
    show: false, // Wait until ready-to-show
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: ${c.devTools},
    }
  };
  
  ${c.iconPath ? `winConfig.icon = path.join(__dirname, '${path.basename(c.iconPath)}');` : ''}

  mainWindow = new BrowserWindow(winConfig);
  
  if (SAVE_STATE && state.isMaximized) {
    mainWindow.maximize();
  }

  // Load Content
  if (ENTRY_FILE.startsWith('http')) {
    mainWindow.loadURL(ENTRY_FILE);
  } else {
    mainWindow.loadFile(ENTRY_FILE);
  }

  ${c.userAgent ? `mainWindow.webContents.setUserAgent("${c.userAgent}");` : ''}

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Tray Behavior
  mainWindow.on('close', (event) => {
    if (SAVE_STATE) saveState();
    
    if (MIN_TO_TRAY && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  // External links open in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Remove Default Menu?
  mainWindow.setMenu(null); 
}

// --- TRAY ---
function createTray() {
  if (!TRAY_ENABLED) return;
  
  const iconName = ${c.iconPath ? `'${path.basename(c.iconPath)}'` : `'appicon.png'`}; 
  // Note: In generated app, ensure icon exists or fallback
  try {
     // Simplistic approach for icon path
     tray = new Tray(path.join(__dirname, iconName));
     const contextMenu = Menu.buildFromTemplate([
       { label: 'Show App', click: () => mainWindow.show() },
       { type: 'separator' },
       { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
     ]);
     tray.setToolTip(APP_TITLE);
     tray.setContextMenu(contextMenu);
     
     tray.on('click', () => mainWindow.show());
  } catch (e) {
     console.log("Tray icon loading failed or optional.");
  }
}

// --- APP LIFECYCLE ---

if (SINGLE_INSTANCE) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.show();
      }
    });
    
    startApp();
  }
} else {
  startApp();
}

function startApp() {
  app.whenReady().then(() => {
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  
  app.on('before-quit', () => {
    isQuitting = true;
  });
}
`;
}
