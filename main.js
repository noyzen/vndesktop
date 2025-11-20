const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec, spawn } = require('child_process');
const AdmZip = require('adm-zip'); // Requires: npm install adm-zip

// --- UTILS ---

function copyFolderRecursiveSync(source, target) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

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

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      // Handle Redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, dest, onProgress)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download (Status ${response.statusCode}) from ${url}`));
        return;
      }

      const totalLength = parseInt(response.headers['content-length'], 10);
      let downloadedLength = 0;

      const file = fs.createWriteStream(dest);
      
      response.on('data', (chunk) => {
        downloadedLength += chunk.length;
        file.write(chunk);
        if (totalLength && onProgress) {
          const percent = (downloadedLength / totalLength) * 100;
          onProgress(percent, downloadedLength, totalLength);
        }
      });

      response.on('end', () => {
        file.end();
        resolve();
      });

      response.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function extractZip(source, target) {
  return new Promise((resolve, reject) => {
    try {
      const zip = new AdmZip(source);
      zip.extractAllTo(target, true); // overwrite = true
      resolve();
    } catch (e) {
      reject(new Error("Extraction failed: " + e.message));
    }
  });
}

/**
 * Recursively finds the directory containing php.exe
 */
function findPhpBinaryDir(startDir) {
  const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
  
  // Check current dir
  if (fs.existsSync(path.join(startDir, phpExe))) {
    return startDir;
  }

  // Check subdirectories
  const files = fs.readdirSync(startDir);
  for (const file of files) {
    const fullPath = path.join(startDir, file);
    if (fs.lstatSync(fullPath).isDirectory()) {
      const found = findPhpBinaryDir(fullPath);
      if (found) return found;
    }
  }
  return null;
}

async function verifyPhp(rootDir) {
  const actualPhpDir = findPhpBinaryDir(rootDir);
  
  if (!actualPhpDir) {
    throw new Error("Verification Failed: php.exe not found in extracted archive.");
  }

  const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
  const phpPath = path.join(actualPhpDir, phpExe);

  return new Promise((resolve, reject) => {
    exec(`"${phpPath}" -v`, (err, stdout) => {
      if (err) {
        // Try to execute anyway, sometimes exit codes differ, but check stdout
        if (stdout && stdout.includes('PHP')) {
            resolve(actualPhpDir);
        } else {
            reject(new Error("Verification Failed: php executable is corrupt or incompatible."));
        }
      } else if (stdout.includes('PHP')) {
        resolve(actualPhpDir);
      } else {
        reject(new Error("Verification Failed: Unexpected output from PHP."));
      }
    });
  });
}

// --- MAIN PROCESS ---

let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121212',
    frame: true, 
    autoHideMenuBar: true, 
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'public/appicon.png')
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

ipcMain.handle('download-php', async (event, version) => {
  try {
    // Specific Filenames for versions
    const filenames = {
      '8.3': 'php-8.3.12-nts-Win32-vs16-x64.zip',
      '8.2': 'php-8.2.24-nts-Win32-vs16-x64.zip',
      '8.1': 'php-8.1.29-nts-Win32-vs16-x64.zip'
    };
    
    const filename = filenames[version];
    if (!filename) throw new Error('Unknown version selected');

    // Smart URLs: Try Release, then Archive
    const primaryUrl = `https://windows.php.net/downloads/releases/${filename}`;
    const archiveUrl = `https://windows.php.net/downloads/releases/archives/${filename}`;

    const cacheDir = path.join(app.getPath('userData'), 'php-cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const zipPath = path.join(cacheDir, filename);
    // Extract to a clean folder named just by version key (e.g. php-8.3)
    const extractPath = path.join(cacheDir, `php-${version}`);

    // 1. Download
    // Check if zip exists and is valid (>1MB)
    let needsDownload = true;
    if (fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1000000) {
        needsDownload = false;
    }

    if (needsDownload) {
       try {
          mainWindow.webContents.send('download-progress', { percent: 0, status: 'Downloading from primary mirror...' });
          await downloadFile(primaryUrl, zipPath, (percent, current, total) => {
            mainWindow.webContents.send('download-progress', { percent, current, total, status: 'Downloading...' });
          });
       } catch (e) {
          console.log("Primary download failed, trying archive...", e.message);
          mainWindow.webContents.send('download-progress', { percent: 0, status: 'Trying archive mirror...' });
          await downloadFile(archiveUrl, zipPath, (percent, current, total) => {
            mainWindow.webContents.send('download-progress', { percent, current, total, status: 'Downloading from archive...' });
          });
       }
    }

    // 2. Extract
    mainWindow.webContents.send('download-progress', { percent: 100, status: 'Extracting archive...' });
    
    // Clean previous extraction
    if (fs.existsSync(extractPath)) {
      try { fs.rmSync(extractPath, { recursive: true, force: true }); } catch(e) {}
    }
    fs.mkdirSync(extractPath, { recursive: true });

    await extractZip(zipPath, extractPath);

    // 3. Verify and Locate
    mainWindow.webContents.send('download-progress', { percent: 100, status: 'Verifying installation...' });
    const finalPath = await verifyPhp(extractPath);

    return { success: true, path: finalPath };

  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-app', async (event, config) => {
  try {
    const targetDir = config.sourcePath;
    
    // 1. Handle PHP Integration
    if (config.enablePhp && config.phpPath) {
       const phpDest = path.join(targetDir, 'bin', 'php');
       if (fs.existsSync(phpDest)) {
         fs.rmSync(phpDest, { recursive: true, force: true });
       }
       fs.mkdirSync(path.join(targetDir, 'bin'), { recursive: true });
       
       // Copy PHP binaries
       copyFolderRecursiveSync(config.phpPath, phpDest);
       
       // Generate custom php.ini
       let extensionStr = '';
       extensionStr += `extension_dir = "ext"\n`;
       
       config.phpExtensions.forEach(ext => {
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
cgi.force_redirect = 0
enable_dl = Off
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
    const buildBat = `@echo off
echo Installing Dependencies...
call npm install
echo Building Application...
call npm run build
echo DONE!
pause`;
    fs.writeFileSync(path.join(targetDir, 'build.bat'), buildBat);
    
    const buildSh = `#!/bin/bash
npm install
npm run build`;
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
      "!bin",
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
      "portfinder": "^1.0.32"
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

async function startPhpServer() {
  return new Promise(async (resolve, reject) => {
    if (!CONFIG.usePhp) {
      serverUrl = null;
      resolve(null);
      return;
    }

    try {
      const port = await portfinder.getPortPromise({ port: CONFIG.phpPort });
      
      let phpBin = '';
      if (app.isPackaged) {
        phpBin = path.join(process.resourcesPath, 'php', 'php.exe');
      } else {
        phpBin = path.join(__dirname, 'bin', 'php', 'php.exe');
      }
      
      const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'app') : __dirname;
      const iniPath = path.join(path.dirname(phpBin), 'php.ini');

      console.log("Starting PHP on port " + port);
      
      phpProcess = spawn(phpBin, ['-S', '127.0.0.1:' + port, '-t', webRoot, '-c', iniPath], {
        cwd: webRoot
      });

      phpProcess.stdout.on('data', (data) => console.log(\`PHP: \${data}\`));
      phpProcess.stderr.on('data', (data) => console.error(\`PHP ERR: \${data}\`));

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
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: ${c.devTools},
    }
  };
  
  ${c.iconPath ? `winConfig.icon = path.join(__dirname, '${path.basename(c.iconPath)}');` : ''}

  mainWindow = new BrowserWindow(winConfig);
  mainWindow.setMenu(null);
  mainWindow.removeMenu();

  if (CONFIG.saveState && state.isMaximized) {
    mainWindow.maximize();
  }

  if (CONFIG.usePhp && serverUrl) {
    const fullUrl = serverUrl + CONFIG.entry;
    mainWindow.loadURL(fullUrl);
  } else if (CONFIG.entry.startsWith('http')) {
    mainWindow.loadURL(CONFIG.entry);
  } else {
    mainWindow.loadFile(CONFIG.entry);
  }

  ${c.userAgent ? `mainWindow.webContents.setUserAgent("${c.userAgent}");` : ''}

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (CONFIG.saveState) saveState();
    
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

function createTray() {
  if (!CONFIG.tray) return;
  
  const iconName = ${c.iconPath ? `'${path.basename(c.iconPath)}'` : `'appicon.png'`};
  
  try {
     const trayIconPath = path.join(__dirname, iconName);
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
    if (CONFIG.runBg && !isQuitting) {
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