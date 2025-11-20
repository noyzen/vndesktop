
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { exec, spawn } = require('child_process');
const AdmZip = require('adm-zip'); 
const portfinder = require('portfinder');

// --- UTILS ---

function copyFolderRecursiveSync(source, target, exclusions = []) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

  if (fs.lstatSync(source).isDirectory()) {
    const files = fs.readdirSync(source);
    files.forEach((file) => {
      if (exclusions.includes(file)) return;

      const curSource = path.join(source, file);
      const curTarget = path.join(target, file);
      try {
        if (fs.lstatSync(curSource).isDirectory()) {
          copyFolderRecursiveSync(curSource, curTarget, exclusions);
        } else {
          fs.copyFileSync(curSource, curTarget);
        }
      } catch (e) {
        console.warn(`Skipped file ${file}: ${e.message}`);
      }
    });
  }
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const uri = new URL(url);
    const pkg = uri.protocol === 'https:' ? https : http;
    
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    };

    const request = pkg.get(url, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, dest, onProgress)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download. Status Code: ${response.statusCode}`));
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
        fs.stat(dest, (err, stats) => {
            if (err) {
                reject(err);
            } else if (stats.size < 1024 * 1024) { 
                fs.unlink(dest, () => {});
                reject(new Error("Downloaded file is too small/corrupt."));
            } else {
                resolve();
            }
        });
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
      zip.extractAllTo(target, true);
      resolve();
    } catch (e) {
      reject(new Error("Extraction failed: " + e.message));
    }
  });
}

function findPhpBinaryDir(startDir) {
  const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
  if (fs.existsSync(path.join(startDir, phpExe))) return startDir;

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
  if (!actualPhpDir) throw new Error("Verification Failed: php.exe not found.");

  const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
  const phpPath = path.join(actualPhpDir, phpExe);

  return new Promise((resolve, reject) => {
    exec(`"${phpPath}" -v`, (err, stdout) => {
      if (err && !stdout.includes('PHP')) {
        reject(new Error("Verification Failed: php executable is incompatible."));
      } else if (stdout.includes('PHP')) {
        resolve(actualPhpDir);
      } else {
        reject(new Error("Verification Failed: Unexpected output from PHP."));
      }
    });
  });
}

// --- PROJECT MANAGER PERSISTENCE ---

const projectsFile = path.join(app.getPath('userData'), 'projects.json');

function getProjectsList() {
  try {
    if (!fs.existsSync(projectsFile)) return [];
    return JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveProjectsList(list) {
  fs.writeFileSync(projectsFile, JSON.stringify(list, null, 2));
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

// --- IPC HANDLERS ---

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.filePaths[0];
});

ipcMain.handle('select-file', async (event, extensions) => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Files', extensions: extensions || ['*'] }],
    properties: ['openFile']
  });
  return result.filePaths[0];
});

ipcMain.handle('copy-to-clipboard', async (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('open-dist-folder', async (event, projectPath) => {
    const distPath = path.join(projectPath, 'vnbuild', 'dist');
    if (fs.existsSync(distPath)) {
        await shell.openPath(distPath);
        return true;
    }
    return false;
});

// Project Manager Handlers
ipcMain.handle('get-projects', () => getProjectsList());

ipcMain.handle('add-project', async (e, folderPath) => {
  const list = getProjectsList();
  const existing = list.find(p => p.path === folderPath);
  const timestamp = Date.now();
  
  if (existing) {
    existing.lastUsed = timestamp;
  } else {
    list.unshift({
      id: timestamp,
      path: folderPath,
      name: path.basename(folderPath),
      lastUsed: timestamp
    });
  }
  
  // Sort by last used
  list.sort((a, b) => b.lastUsed - a.lastUsed);
  saveProjectsList(list);
  return list;
});

ipcMain.handle('remove-project', async (e, id) => {
  let list = getProjectsList();
  list = list.filter(p => p.id !== id);
  saveProjectsList(list);
  return list;
});

ipcMain.handle('load-project-config', async (e, folderPath) => {
  try {
    const configFile = path.join(folderPath, 'vnbuild', 'visualneo.json');
    if (fs.existsSync(configFile)) {
      return JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }
  } catch (e) {
    console.error("Failed to load config", e);
  }
  return null;
});

ipcMain.handle('save-project-config', async (e, { folderPath, config }) => {
  try {
    const buildDir = path.join(folderPath, 'vnbuild');
    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
    
    const configFile = path.join(buildDir, 'visualneo.json');
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    
    // Update last used
    const list = getProjectsList();
    const p = list.find(x => x.path === folderPath);
    if(p) { 
        p.lastUsed = Date.now(); 
        list.sort((a, b) => b.lastUsed - a.lastUsed);
        saveProjectsList(list);
    }
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-php-cache', async () => {
    const cacheDir = path.join(app.getPath('userData'), 'php-cache');
    const results = {};
    if (!fs.existsSync(cacheDir)) return results;
    
    ['8.3', '8.2', '8.1'].forEach(ver => {
        const possiblePath = path.join(cacheDir, `php-${ver}`);
        if (fs.existsSync(possiblePath) && findPhpBinaryDir(possiblePath)) {
            results[ver] = findPhpBinaryDir(possiblePath);
        }
    });
    return results;
});

ipcMain.handle('download-php', async (event, version) => {
  const cacheDir = path.join(app.getPath('userData'), 'php-cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const filenames = {
      '8.3': 'php-8.3.12-nts-Win32-vs16-x64.zip',
      '8.2': 'php-8.2.24-nts-Win32-vs16-x64.zip',
      '8.1': 'php-8.1.29-nts-Win32-vs16-x64.zip'
  };
  
  const filename = filenames[version];
  if (!filename) return { success: false, error: 'Unknown version' };

  const zipPath = path.join(cacheDir, filename);
  const extractPath = path.join(cacheDir, `php-${version}`);

  try {
    const primaryUrl = `https://windows.php.net/downloads/releases/${filename}`;
    const archiveUrl = `https://windows.php.net/downloads/releases/archives/${filename}`;

    if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 5000000) {
       try {
          mainWindow.webContents.send('download-progress', { percent: 0, status: 'Connecting...' });
          await downloadFile(primaryUrl, zipPath, (percent, current, total) => {
            mainWindow.webContents.send('download-progress', { percent, current, total, status: 'Downloading...' });
          });
       } catch (e) {
          mainWindow.webContents.send('download-progress', { percent: 0, status: 'Trying archive...' });
          await downloadFile(archiveUrl, zipPath, (percent, current, total) => {
            mainWindow.webContents.send('download-progress', { percent, current, total, status: 'Downloading archive...' });
          });
       }
    }

    mainWindow.webContents.send('download-progress', { percent: 100, status: 'Extracting...' });
    if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true, force: true });
    fs.mkdirSync(extractPath, { recursive: true });

    await extractZip(zipPath, extractPath);
    const finalPath = await verifyPhp(extractPath);

    return { success: true, path: finalPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate-app', async (event, config) => {
  try {
    const sourceRoot = config.sourcePath;
    const buildDir = path.join(sourceRoot, 'vnbuild');
    const wwwDir = path.join(buildDir, 'www');
    const binDir = path.join(buildDir, 'bin');
    const distDir = path.join(buildDir, 'dist');
    
    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
    
    // Clean previous build files
    if (fs.existsSync(wwwDir)) fs.rmSync(wwwDir, { recursive: true, force: true });
    if (fs.existsSync(binDir)) fs.rmSync(binDir, { recursive: true, force: true });
    if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true, force: true });

    const exclusions = ['vnbuild', '.git', '.vscode', 'node_modules', 'dist', 'release', 'out'];
    fs.mkdirSync(wwwDir, { recursive: true });
    copyFolderRecursiveSync(sourceRoot, wwwDir, exclusions);

    if (config.enablePhp && config.phpPath) {
       const phpDest = path.join(binDir, 'php');
       fs.mkdirSync(binDir, { recursive: true });
       copyFolderRecursiveSync(config.phpPath, phpDest, []);
       
       const phpExeCheck = path.join(phpDest, 'php.exe');
       if (!fs.existsSync(phpExeCheck)) {
           throw new Error("Failed to copy php.exe. Check source folder.");
       }
       
       let extensionStr = `extension_dir = "ext"\n`;
       if (config.phpExtensions) {
           config.phpExtensions.forEach(ext => extensionStr += `extension=php_${ext}.dll\n`);
       }

       const phpIni = `
[PHP]
engine = On
short_open_tag = On
max_execution_time = ${config.phpTime || 120}
memory_limit = ${config.phpMemory || "256M"}
post_max_size = ${config.phpUpload || "64M"}
upload_max_filesize = ${config.phpUpload || "64M"}
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

    fs.writeFileSync(path.join(buildDir, 'package.json'), generatePackageJson(config));
    fs.writeFileSync(path.join(buildDir, 'main.js'), generateMainJs(config));
    fs.writeFileSync(path.join(buildDir, 'build.bat'), `@echo off\nnpm install && npm run build\npause`);

    // Save config persistence
    const configFile = path.join(buildDir, 'visualneo.json');
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

    return { success: true };
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('build-app', async (event, sourceRoot) => {
    return new Promise((resolve, reject) => {
        const isWin = process.platform === 'win32';
        const npmCmd = isWin ? 'npm.cmd' : 'npm';
        const buildDir = path.join(sourceRoot, 'vnbuild');
        
        const sendLog = (msg, isError = false) => {
            mainWindow.webContents.send('download-progress', { type: 'build-log', msg, error: isError });
        };

        if (!fs.existsSync(buildDir)) {
            return resolve({ success: false, error: 'vnbuild not found. Generate config first.' });
        }

        exec(`${npmCmd} -v`, (err) => {
            if (err) {
                sendLog('Node.js/NPM not found in PATH.', true);
                return resolve({ success: false, error: 'NPM not found' });
            }

            sendLog(`Installing dependencies in ${buildDir}...`);
            const install = spawn(npmCmd, ['install'], { cwd: buildDir, shell: true });

            install.stdout.on('data', (d) => sendLog(d.toString()));
            install.stderr.on('data', (d) => sendLog(d.toString()));

            install.on('close', (code) => {
                if (code !== 0) {
                    sendLog(`npm install failed: code ${code}`, true);
                    return resolve({ success: false, error: 'Install failed' });
                }
                
                sendLog('Building application...');
                const build = spawn(npmCmd, ['run', 'build'], { cwd: buildDir, shell: true });
                
                build.stdout.on('data', (d) => sendLog(d.toString()));
                build.stderr.on('data', (d) => sendLog(d.toString()));

                build.on('close', (bCode) => {
                    if (bCode !== 0) {
                        sendLog(`Build failed: code ${bCode}`, true);
                        return resolve({ success: false, error: 'Build failed' });
                    }
                    sendLog('Build Success!');
                    resolve({ success: true });
                });
            });
        });
    });
});

// --- GENERATORS ---

function generatePackageJson(c) {
  const targets = [];
  if (c.targetNsis) targets.push("nsis");
  if (c.targetPortable) targets.push("portable");
  if (c.targetUnpacked) targets.push("dir");

  const buildConfig = {
    appId: `com.visualneo.${c.appName.replace(/\s+/g, '').toLowerCase()}`,
    productName: c.productName,
    files: ["main.js", "www/**/*"],
    extraResources: c.enablePhp ? [{ "from": "bin/php", "to": "php", "filter": ["**/*"] }] : [],
    directories: { "output": "dist" },
    asar: false,
    win: { target: targets, icon: c.iconPath ? path.basename(c.iconPath) : undefined },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true }
  };

  const pkg = {
    name: c.appName.toLowerCase().replace(/\s+/g, '-'),
    version: c.version,
    description: c.productName,
    main: "main.js",
    author: c.author,
    scripts: { "start": "electron .", "build": "electron-builder" },
    dependencies: { "portfinder": "^1.0.32" },
    devDependencies: { "electron": "^29.1.5", "electron-builder": "^24.13.3" },
    build: buildConfig
  };

  return JSON.stringify(pkg, null, 2);
}

function generateMainJs(c) {
  return `const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const portfinder = require('portfinder');

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

let mainWindow, tray = null, isQuitting = false, phpProcess = null, serverUrl = null;

const webRoot = path.join(__dirname, 'www');
const statePath = path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } 
  catch (e) { return { width: ${c.width}, height: ${c.height} }; }
}

function saveState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const isMaximized = mainWindow.isMaximized();
  fs.writeFileSync(statePath, JSON.stringify({ ...bounds, isMaximized }));
}

async function startPhpServer() {
  return new Promise(async (resolve, reject) => {
    if (!CONFIG.usePhp) { serverUrl = null; return resolve(null); }

    try {
      const port = await portfinder.getPortPromise({ port: CONFIG.phpPort });
      let phpBin;
      if (app.isPackaged) {
         phpBin = path.join(process.resourcesPath, 'php', 'php.exe');
      } else {
         phpBin = path.join(__dirname, 'bin', 'php', 'php.exe');
      }
      
      if (!fs.existsSync(phpBin)) {
         return reject(new Error("PHP binary not found at: " + phpBin));
      }
      
      const iniPath = path.join(path.dirname(phpBin), 'php.ini');
      
      phpProcess = spawn(phpBin, ['-S', '127.0.0.1:' + port, '-t', webRoot, '-c', iniPath], {
        cwd: webRoot,
        stdio: 'ignore',
        windowsHide: true
      });

      phpProcess.on('error', (err) => {
        console.error('Failed to spawn PHP:', err);
      });

      serverUrl = \`http://127.0.0.1:\${port}/\`;
      setTimeout(resolve, 500, serverUrl); 

    } catch (e) {
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
    width: state.width, height: state.height, x: state.x, y: state.y,
    minWidth: ${c.minWidth || 0}, minHeight: ${c.minHeight || 0},
    resizable: ${c.resizable}, fullscreenable: ${c.fullscreenable},
    kiosk: CONFIG.kiosk, frame: CONFIG.nativeFrame, center: ${c.center},
    autoHideMenuBar: true, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: ${c.devTools} }
  };
  
  ${c.iconPath ? `winConfig.icon = path.join(__dirname, '${path.basename(c.iconPath)}');` : ''}

  mainWindow = new BrowserWindow(winConfig);
  mainWindow.setMenu(null);

  if (CONFIG.saveState && state.isMaximized) mainWindow.maximize();

  if (CONFIG.usePhp && serverUrl) {
    mainWindow.loadURL(serverUrl + CONFIG.entry);
  } else if (CONFIG.entry.startsWith('http')) {
    mainWindow.loadURL(CONFIG.entry);
  } else {
    mainWindow.loadFile(path.join(webRoot, CONFIG.entry));
  }

  ${c.userAgent ? `mainWindow.webContents.setUserAgent("${c.userAgent}");` : ''}

  mainWindow.once('ready-to-show', () => mainWindow.show());
  
  mainWindow.on('close', (e) => {
    if (CONFIG.saveState) saveState();
    if (CONFIG.minToTray && tray && !isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  if (CONFIG.contextMenu) {
      mainWindow.webContents.on('context-menu', () => {
        Menu.buildFromTemplate([{ label: 'Copy', role: 'copy' }, { label: 'Paste', role: 'paste' }, { type: 'separator' }, { label: 'Reload', role: 'reload' }]).popup();
      });
  }
}

function createTray() {
  if (!CONFIG.tray) return;
  let iconPath = path.join(__dirname, ${c.iconPath ? `'${path.basename(c.iconPath)}'` : `'appicon.png'`});
  if (!fs.existsSync(iconPath) && app.isPackaged) iconPath = path.join(process.resourcesPath, ${c.iconPath ? `'${path.basename(c.iconPath)}'` : `'appicon.png'`});
  
  try {
     tray = new Tray(iconPath);
     tray.setToolTip(CONFIG.title);
     tray.setContextMenu(Menu.buildFromTemplate([
       { label: 'Show', click: () => mainWindow.show() },
       { label: 'Exit', click: () => { isQuitting = true; app.quit(); } }
     ]));
     tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show());
  } catch (e) {}
}

const gotLock = CONFIG.singleInstance ? app.requestSingleInstanceLock() : true;
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
       if (mainWindow.isMinimized()) mainWindow.restore();
       mainWindow.focus();
    }
  });
  
  app.whenReady().then(async () => {
    await startPhpServer();
    createWindow();
    createTray();
  });
  
  app.on('window-all-closed', () => { if (CONFIG.runBg && !isQuitting) {} else if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { isQuitting = true; killPhp(); });
}
`;
}
