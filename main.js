const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// --- UTILS ---

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target);

  if (fs.lstatSync(source).isDirectory()) {
    const files = fs.readdirSync(source);
    files.forEach((file) => {
      const curSource = path.join(source, file);
      const curTarget = path.join(target, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
      }
    });
  }
}

// --- MAIN PROCESS ---

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121212',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'public/appicon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1e1e',
      symbolColor: '#ffffff',
      height: 35
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
    
    // 1. Handle PHP Integration
    if (config.enablePhp && config.phpPath) {
       const phpDest = path.join(targetDir, 'bin', 'php');
       if (!fs.existsSync(path.join(targetDir, 'bin'))) fs.mkdirSync(path.join(targetDir, 'bin'));
       
       // Copy PHP binaries
       copyFolderRecursiveSync(config.phpPath, phpDest);
       
       // Generate custom php.ini
       const extensions = config.phpExtensions.split(',').map(e => e.trim()).filter(e => e);
       let extensionStr = '';
       // Basic logic to determine extension dir (Windows usually 'ext')
       extensionStr += `extension_dir = "ext"\n`;
       extensions.forEach(ext => {
         extensionStr += `extension=php_${ext}.dll\n`;
       });

       const phpIni = `
[PHP]
engine = On
short_open_tag = On
max_execution_time = ${config.phpTime}
memory_limit = ${config.phpMemory}
post_max_size = ${config.phpUpload}
upload_max_filesize = ${config.phpUpload}
display_errors = Off
log_errors = On
error_log = php_errors.log
default_mimetype = "text/html"
default_charset = "UTF-8"
file_uploads = On
allow_url_fopen = On
${extensionStr}
`;
       fs.writeFileSync(path.join(phpDest, 'php.ini'), phpIni);
    }

    // 2. Generate package.json
    const packageJson = generatePackageJson(config);
    fs.writeFileSync(path.join(targetDir, 'package.json'), packageJson);

    // 3. Generate main.js (The Electron Host logic)
    const mainJs = generateMainJs(config);
    fs.writeFileSync(path.join(targetDir, 'main.js'), mainJs);

    // 4. Generate Build Scripts
    // Windows
    const buildBat = `@echo off
echo ---------------------------------------
echo  VisualNEO Desktop Builder
echo ---------------------------------------
echo.
echo 1. Installing Dependencies...
call npm install
echo.
echo 2. Building Application...
call npm run build
echo.
echo DONE! Check the 'dist' folder.
pause`;
    fs.writeFileSync(path.join(targetDir, 'build.bat'), buildBat);
    
    // Linux/Mac
    const buildSh = `#!/bin/bash
echo "Installing Dependencies..."
npm install
echo "Building Application..."
npm run build
echo "Done!"`;
    fs.writeFileSync(path.join(targetDir, 'build.sh'), buildSh);

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

  // Extra resources logic for PHP
  const extraResources = [];
  if (c.enablePhp) {
    extraResources.push({
      "from": "bin/php",
      "to": "php",
      "filter": ["**/*"]
    });
  }

  const buildConfig = {
    appId: `com.visualneo.${c.appName.replace(/\s+/g, '').toLowerCase()}`,
    productName: c.productName,
    files: [
      "**/*",
      "!bin", // Don't bundle bin folder into asar, we copy it via extraResources
      "!**/*.map"
    ],
    extraResources: extraResources,
    directories: { "output": "dist" },
    win: {
      target: targets,
      icon: c.iconPath ? path.basename(c.iconPath) : undefined
    },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      shortcutName: c.productName,
      createDesktopShortcut: true,
      createStartMenuShortcut: true
    }
  };

  const pkg = {
    name: c.appName.toLowerCase().replace(/\s+/g, '-'),
    version: c.version,
    description: `${c.productName} - Powered by VisualNEO`,
    main: "main.js",
    author: c.author,
    scripts: {
      "start": "electron .",
      "build": "electron-builder"
    },
    dependencies: {
      "portfinder": "^1.0.32" // Needed for PHP port safety
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
  return `/**
 * Generated by VisualNEO Desktop Builder
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const portfinder = require('portfinder');

// --- CONFIGURATION ---
const CONFIG = {
  title: "${c.productName}",
  entry: "${c.entryPoint}",
  usePhp: ${c.enablePhp},
  phpPort: ${c.phpPort},
  saveState: ${c.saveState},
  tray: ${c.trayIcon},
  minToTray: ${c.minimizeToTray},
  runBg: ${c.runBackground},
  singleInstance: ${c.singleInstance},
  kiosk: ${c.kiosk},
  contextMenu: ${c.contextMenu},
  nativeFrame: ${c.nativeFrame}
};

// --- GLOBALS ---
let mainWindow;
let tray = null;
let isQuitting = false;
let phpProcess = null;
let serverUrl = null;

// --- STATE MANAGEMENT ---
const statePath = path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    return { width: ${c.width}, height: ${c.height} };
  }
}

function saveState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const isMaximized = mainWindow.isMaximized();
  const state = { ...bounds, isMaximized };
  fs.writeFileSync(statePath, JSON.stringify(state));
}

// --- PHP SERVER LOGIC ---
async function startPhpServer() {
  return new Promise(async (resolve, reject) => {
    if (!CONFIG.usePhp) {
      // Static Mode
      serverUrl = null;
      resolve(null);
      return;
    }

    try {
      // Find open port
      const port = await portfinder.getPortPromise({ port: CONFIG.phpPort });
      
      // Determine PHP Path (Production vs Development)
      let phpBin = '';
      if (app.isPackaged) {
        phpBin = path.join(process.resourcesPath, 'php', 'php.exe');
      } else {
        phpBin = path.join(__dirname, 'bin', 'php', 'php.exe');
      }
      
      const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'app') : __dirname;
      const iniPath = path.join(path.dirname(phpBin), 'php.ini');

      console.log("Starting PHP on port " + port);
      console.log("Root: " + webRoot);
      
      // Spawn PHP Built-in Server
      phpProcess = spawn(phpBin, ['-S', '127.0.0.1:' + port, '-t', webRoot, '-c', iniPath], {
        cwd: webRoot // Important for relative paths in PHP
      });

      phpProcess.stdout.on('data', (data) => console.log(\`PHP: \${data}\`));
      phpProcess.stderr.on('data', (data) => console.error(\`PHP ERR: \${data}\`));

      phpProcess.on('close', (code) => {
        console.log(\`PHP exited with code \${code}\`);
      });

      serverUrl = \`http://127.0.0.1:\${port}/\`;
      resolve(serverUrl);

    } catch (e) {
      console.error("Failed to start PHP", e);
      reject(e);
    }
  });
}

function killPhp() {
  if (phpProcess) {
    phpProcess.kill();
    phpProcess = null;
  }
}

// --- MAIN WINDOW ---
function createWindow() {
  const state = CONFIG.saveState ? loadState() : { width: ${c.width}, height: ${c.height} };

  const winConfig = {
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: ${c.minWidth || 0},
    minHeight: ${c.minHeight || 0},
    resizable: ${c.resizable},
    fullscreenable: ${c.fullscreenable},
    kiosk: CONFIG.kiosk,
    frame: CONFIG.nativeFrame, 
    center: ${c.center},
    autoHideMenuBar: true, // Hide default menu but keep frame
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: ${c.devTools},
    }
  };
  
  ${c.iconPath ? `winConfig.icon = path.join(__dirname, '${path.basename(c.iconPath)}');` : ''}

  mainWindow = new BrowserWindow(winConfig);
  
  // Remove Menu Bar for "Native Frame" look without File/Edit menus
  mainWindow.setMenu(null);
  mainWindow.removeMenu();

  if (CONFIG.saveState && state.isMaximized) {
    mainWindow.maximize();
  }

  // Load Content
  if (CONFIG.usePhp && serverUrl) {
    // Load via PHP Server
    const fullUrl = serverUrl + CONFIG.entry;
    mainWindow.loadURL(fullUrl);
  } else if (CONFIG.entry.startsWith('http')) {
    // Remote URL
    mainWindow.loadURL(CONFIG.entry);
  } else {
    // Static File
    mainWindow.loadFile(CONFIG.entry);
  }

  ${c.userAgent ? `mainWindow.webContents.setUserAgent("${c.userAgent}");` : ''}

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // --- EVENT HANDLERS ---

  mainWindow.on('close', (event) => {
    if (CONFIG.saveState) saveState();
    
    // Tray Logic: If tray exists and not quitting explicitly, hide instead of close
    if (CONFIG.minToTray && tray && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  if (CONFIG.contextMenu) {
      // Basic Context Menu
      mainWindow.webContents.on('context-menu', (e, params) => {
        Menu.buildFromTemplate([
           { label: 'Copy', role: 'copy' },
           { label: 'Paste', role: 'paste' },
           { type: 'separator' },
           { label: 'Reload', role: 'reload' }
        ]).popup();
      });
  }
}

// --- TRAY ---
function createTray() {
  if (!CONFIG.tray) return;
  
  const iconName = ${c.iconPath ? `'${path.basename(c.iconPath)}'` : `'appicon.png'`};
  
  try {
     const trayIconPath = path.join(__dirname, iconName);
     // Check if exists, else fallback isn't easy in packed app, assume it's there
     tray = new Tray(trayIconPath);
     
     const contextMenu = Menu.buildFromTemplate([
       { label: 'Show Application', click: () => mainWindow.show() },
       { type: 'separator' },
       { label: 'Exit', click: () => { isQuitting = true; app.quit(); } }
     ]);
     
     tray.setToolTip(CONFIG.title);
     tray.setContextMenu(contextMenu);
     
     tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
        }
     });
  } catch (e) {
     console.log("Tray init error: " + e.message);
  }
}

// --- APP LIFECYCLE ---

if (CONFIG.singleInstance) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    });
    
    initApp();
  }
} else {
  initApp();
}

function initApp() {
  app.whenReady().then(async () => {
    await startPhpServer();
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // If background running is enabled, don't quit on window close (unless Mac)
    // But if user clicked "Quit" in tray, isQuitting is true.
    if (CONFIG.runBg && !isQuitting) {
       // Do nothing, keep app running in tray
    } else {
       if (process.platform !== 'darwin') app.quit();
    }
  });
  
  app.on('before-quit', () => {
    isQuitting = true;
    killPhp();
  });
  
  app.on('will-quit', () => {
    killPhp();
  });
}
`;
}