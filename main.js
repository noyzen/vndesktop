
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { exec, spawn, execSync } = require('child_process');
const AdmZip = require('adm-zip'); 
const portfinder = require('portfinder');

// --- UTILS ---

// Robust Delete Helper (Fixes ENOTEMPTY and Locked File issues)
async function deleteFolderRobust(targetPath, isBackground = false) {
    if (!fs.existsSync(targetPath)) return;
    
    // Helper to check existence
    const exists = () => fs.existsSync(targetPath);

    // Extended retries to handle Antivirus scanning locks
    const maxRetries = 15; 
    for (let i = 0; i < maxRetries; i++) {
        try {
            // 1. Windows Shell Force Delete (Most effective for locked files)
            if (process.platform === 'win32') {
                try {
                    execSync(`rmdir /s /q "${targetPath}"`, { stdio: 'ignore' });
                } catch(e) {
                    // Fallback to Node native
                    fs.rmSync(targetPath, { recursive: true, force: true });
                }
            } else {
                fs.rmSync(targetPath, { recursive: true, force: true });
            }
            
            if (!exists()) return;

            // If it's the last retry, throw
            if (i === maxRetries - 1) throw new Error("Resource locked or permission denied.");

            // Exponential Backoff: 200ms, 300ms, 450ms...
            const delay = 200 * Math.pow(1.4, i);
            await new Promise(resolve => setTimeout(resolve, delay));

        } catch (e) {
            if (i === maxRetries - 1) {
                if (!isBackground) console.error(`Failed to delete ${targetPath}: ${e.message}`);
                if (!isBackground) throw e;
            }
        }
    }
}

// Clever "Move to Trash" strategy
// 1. Try System Temp (Cleanest, hides it from user)
// 2. Try Hidden Local Trash OUTSIDE dist (Keeps dist clean)
function forceMoveToTrash(targetPath) {
    const name = `trash_${path.basename(targetPath)}_${Date.now()}`;
    
    // Strategy A: System Temp (Using Shell Move for power)
    try {
        const tempDest = path.join(app.getPath('temp'), name);
        
        if (process.platform === 'win32') {
            execSync(`move "${targetPath}" "${tempDest}"`, { stdio: 'ignore' });
        } else {
            fs.renameSync(targetPath, tempDest);
        }
        return tempDest; 
    } catch (e) { /* EXDEV or perms */ }

    // Strategy B: Hidden local trash (Strictly OUTSIDE dist)
    try {
        // If targetPath is .../vnbuild/dist/win-unpacked
        // We want .../vnbuild/.trash
        
        const parentDir = path.dirname(targetPath); // .../dist
        const buildDir = path.dirname(parentDir);   // .../vnbuild
        
        // Safety: Only do this if we are in a 'dist' structure we recognize
        if (path.basename(parentDir) === 'dist') {
            const trashDir = path.join(buildDir, '.trash');
            if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
            
            const localDest = path.join(trashDir, name);
            
            if (process.platform === 'win32') {
                execSync(`move "${targetPath}" "${localDest}"`, { stdio: 'ignore' });
            } else {
                fs.renameSync(targetPath, localDest);
            }
            return localDest;
        }
    } catch (e) {
        return null;
    }
    return null;
}

async function prepareDistFolder(buildDir, sendLog) {
    const distPath = path.join(buildDir, 'dist');
    if (!fs.existsSync(distPath)) return true;

    sendLog("Cleaning output directory...");

    try {
        await deleteFolderRobust(distPath);
        return true;
    } catch (e) {
        sendLog("Standard clean failed (Locked). Attempting displacement strategy...");
        
        const trashPath = forceMoveToTrash(distPath);
        
        if (trashPath) {
            sendLog(`Moved locked folder to trash area. Build path is clear.`);
            // Fire and forget delete of the trash in background
            deleteFolderRobust(trashPath, true).catch(() => {});
            return true;
        } else {
            sendLog(`Critical: Could not move locked folder.`, true);
            return false;
        }
    }
}

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

// --- NODE.JS / BUILD ENGINE HELPERS ---

function getLocalNodePath() {
    const baseDir = path.join(app.getPath('userData'), 'node-env');
    if (!fs.existsSync(baseDir)) return null;
    
    try {
        const dirs = fs.readdirSync(baseDir);
        for (const d of dirs) {
            const fullPath = path.join(baseDir, d);
            if (fs.lstatSync(fullPath).isDirectory()) {
                const nodeExe = path.join(fullPath, 'node.exe');
                if (fs.existsSync(nodeExe)) return fullPath;
            }
        }
    } catch (e) {
        return null;
    }
    return null;
}

function getBuildEnv() {
    const local = getLocalNodePath();
    const env = { ...process.env };
    if (local) {
        env.PATH = local + path.delimiter + env.PATH;
    }
    return env;
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

// --- WINDOW STATE PERSISTENCE ---

const windowStateFile = path.join(app.getPath('userData'), 'main-window-state.json');

function getWindowState() {
  try {
    if (fs.existsSync(windowStateFile)) {
      return JSON.parse(fs.readFileSync(windowStateFile, 'utf8'));
    }
  } catch (e) {}
  return { width: 1200, height: 900 };
}

function saveWindowState(win) {
  if (!win) return;
  try {
    const bounds = win.getBounds();
    const state = {
      ...bounds,
      maximized: win.isMaximized()
    };
    fs.writeFileSync(windowStateFile, JSON.stringify(state));
  } catch (e) {}
}


// --- MAIN PROCESS ---

let mainWindow;

const createWindow = () => {
  const state = getWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121212',
    frame: true, 
    autoHideMenuBar: true, 
    title: "VisualNEO Desk",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'public/appicon.png')
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.loadFile('index.html');
  mainWindow.setMenu(null); 

  mainWindow.on('close', () => {
      saveWindowState(mainWindow);
  });
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

// PHP Handlers
ipcMain.handle('get-php-cache', async () => {
    const cacheDir = path.join(app.getPath('userData'), 'php-cache');
    const results = {};
    if (!fs.existsSync(cacheDir)) return results;
    
    ['8.3', '8.2', '8.1', '7.4'].forEach(ver => {
        const possiblePath = path.join(cacheDir, `php-${ver}`);
        if (fs.existsSync(possiblePath) && findPhpBinaryDir(possiblePath)) {
            results[ver] = findPhpBinaryDir(possiblePath);
        }
    });
    return results;
});

ipcMain.handle('get-php-extensions', async (event, phpPath) => {
    if (!phpPath || !fs.existsSync(phpPath)) return [];
    
    const extDir = path.join(phpPath, 'ext');
    if (!fs.existsSync(extDir)) return [];
    
    try {
        const files = fs.readdirSync(extDir);
        // Filter for .dll files starting with php_ (common convention) but robust enough for others
        return files
            .filter(f => f.endsWith('.dll'))
            .map(f => {
                // Return clean name (remove php_ prefix and .dll extension for display)
                const name = f;
                const simpleName = f.replace(/^php_/, '').replace(/\.dll$/, '');
                return { file: name, name: simpleName };
            });
    } catch (e) {
        return [];
    }
});

ipcMain.handle('add-php-extension', async (event, { phpPath, filePath }) => {
    if (!phpPath || !fs.existsSync(phpPath)) return { success: false, error: "Invalid PHP Path" };
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: "Invalid File" };
    
    const extDir = path.join(phpPath, 'ext');
    if (!fs.existsSync(extDir)) return { success: false, error: "PHP 'ext' directory not found" };
    
    try {
        const fileName = path.basename(filePath);
        const dest = path.join(extDir, fileName);
        fs.copyFileSync(filePath, dest);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('download-php', async (event, version) => {
  const cacheDir = path.join(app.getPath('userData'), 'php-cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const filenames = {
      '8.3': 'php-8.3.12-nts-Win32-vs16-x64.zip',
      '8.2': 'php-8.2.24-nts-Win32-vs16-x64.zip',
      '8.1': 'php-8.1.29-nts-Win32-vs16-x64.zip',
      '7.4': 'php-7.4.33-nts-Win32-vc15-x64.zip'
  };
  
  const filename = filenames[version];
  if (!filename) return { success: false, error: 'Unknown version' };

  const zipPath = path.join(cacheDir, filename);
  const extractPath = path.join(cacheDir, `php-${version}`);

  try {
    // Primary Release URL
    const primaryUrl = `https://windows.php.net/downloads/releases/${filename}`;
    // Archives URL (Older versions move here)
    const archiveUrl = `https://windows.php.net/downloads/releases/archives/${filename}`;
    
    // Priority URL: If 7.4, usually only in archives now.
    const urls = version === '7.4' ? [archiveUrl, primaryUrl] : [primaryUrl, archiveUrl];

    if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size < 5000000) {
        let downloaded = false;
        let lastError = null;

        for (const url of urls) {
             try {
                mainWindow.webContents.send('download-progress', { percent: 0, status: `Connecting to ${url.includes('archives') ? 'Archive' : 'Mirror'}...` });
                await downloadFile(url, zipPath, (percent, current, total) => {
                    mainWindow.webContents.send('download-progress', { percent, current, total, status: `Downloading PHP ${version}...` });
                });
                downloaded = true;
                break; // Success
             } catch (e) {
                lastError = e;
                console.log("Mirror failed", e.message);
                // Continue to next URL
             }
        }
        
        if (!downloaded) throw lastError || new Error("All download mirrors failed.");
    }

    mainWindow.webContents.send('download-progress', { percent: 100, status: 'Extracting...' });
    if (fs.existsSync(extractPath)) await deleteFolderRobust(extractPath);
    fs.mkdirSync(extractPath, { recursive: true });

    await extractZip(zipPath, extractPath);
    const finalPath = await verifyPhp(extractPath);

    return { success: true, path: finalPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- NODE.JS HANDLERS ---

ipcMain.handle('check-node-install', async () => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const env = getBuildEnv();
    
    return new Promise((resolve) => {
        exec(`${npmCmd} -v`, { env }, (err, stdout) => {
            if (err) {
                resolve({ installed: false, local: false });
            } else {
                const localPath = getLocalNodePath();
                resolve({ 
                    installed: true, 
                    version: stdout.trim(), 
                    local: !!localPath,
                    path: localPath || 'Global'
                });
            }
        });
    });
});

ipcMain.handle('install-node', async () => {
    const nodeDir = path.join(app.getPath('userData'), 'node-env');
    if (!fs.existsSync(nodeDir)) fs.mkdirSync(nodeDir, { recursive: true });
    
    const version = 'v20.18.0';
    const filename = `node-${version}-win-x64.zip`;
    const url = `https://nodejs.org/dist/${version}/${filename}`;
    const zipPath = path.join(nodeDir, filename);
    
    try {
        mainWindow.webContents.send('download-progress', { percent: 0, status: 'Connecting to nodejs.org...' });
        
        await downloadFile(url, zipPath, (percent, current, total) => {
            mainWindow.webContents.send('download-progress', { percent, current, total, status: 'Downloading Node.js (Portable)...' });
        });
        
        mainWindow.webContents.send('download-progress', { percent: 100, status: 'Extracting Engine...' });
        
        const items = fs.readdirSync(nodeDir);
        for(const i of items) {
            if(i !== filename) await deleteFolderRobust(path.join(nodeDir, i));
        }
        
        await extractZip(zipPath, nodeDir);
        
        const local = getLocalNodePath();
        if (!local) throw new Error("Extraction verification failed.");
        
        return { success: true, path: local };
    } catch(e) {
        return { success: false, error: e.message };
    }
});


// --- GENERATE & BUILD ---

ipcMain.handle('generate-app', async (event, config) => {
  try {
    const sourceRoot = config.sourcePath;
    const buildDir = path.join(sourceRoot, 'vnbuild');
    const wwwDir = path.join(buildDir, 'www');
    const binDir = path.join(buildDir, 'bin');
    
    // Clean intermediate folders but NOT dist yet
    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
    
    await deleteFolderRobust(wwwDir);
    await deleteFolderRobust(binDir);

    const exclusions = ['vnbuild', '.git', '.vscode', 'node_modules', 'dist', 'release', 'out'];
    fs.mkdirSync(wwwDir, { recursive: true });
    copyFolderRecursiveSync(sourceRoot, wwwDir, exclusions);
    
    // --- COPY APP ICON ---
    // We explicitly copy the icon to vnbuild so it is included in the bundle
    const iconDest = path.join(buildDir, 'app-icon.png');
    if (config.iconPath && fs.existsSync(config.iconPath)) {
        try { fs.copyFileSync(config.iconPath, iconDest); } catch(e) { console.error(e); }
    } else {
        // Fallback
        try { fs.copyFileSync(path.join(__dirname, 'public/appicon.png'), iconDest); } catch(e) {}
    }

    if (config.enablePhp && config.phpPath) {
       const phpDest = path.join(binDir, 'php');
       fs.mkdirSync(binDir, { recursive: true });
       copyFolderRecursiveSync(config.phpPath, phpDest, []);
       
       const phpExeCheck = path.join(phpDest, 'php.exe');
       if (!fs.existsSync(phpExeCheck)) {
           throw new Error("Failed to copy php.exe. Check source folder.");
       }
       
       // --- PHP.INI GENERATION ---
       let extensionStr = `extension_dir = "ext"\n`;
       
       // Iterate config extensions and add them. 
       // Note: In Windows PHP, some extensions are 'php_name.dll', some 'name'. 
       // The renderer sends the filename (e.g. 'php_curl.dll')
       if (config.phpExtensions) {
           config.phpExtensions.forEach(ext => {
               // Ensure we don't double 'dll' or 'php_' if user manually typed it badly, 
               // though the renderer sends exact filenames now.
               if (ext.trim()) {
                   extensionStr += `extension=${ext}\n`;
               }
           });
       }
       
       // Basic OpCache Config
       let opcacheStr = "";
       if (config.phpOpcache) {
           opcacheStr = `
[opcache]
zend_extension=php_opcache.dll
opcache.enable=1
opcache.enable_cli=1
opcache.memory_consumption=128
opcache.interned_strings_buffer=8
opcache.max_accelerated_files=4000
`;
       }

       const phpIni = `
[PHP]
engine = On
short_open_tag = On
max_execution_time = ${config.phpTime || 120}
memory_limit = ${config.phpMemory || "256M"}
post_max_size = ${config.phpUpload || "64M"}
upload_max_filesize = ${config.phpUpload || "64M"}
max_input_vars = 3000
display_errors = ${config.phpDisplayErrors ? "On" : "Off"}
display_startup_errors = ${config.phpDisplayErrors ? "On" : "Off"}
log_errors = On
error_log = php_errors.log
default_mimetype = "text/html"
default_charset = "UTF-8"
file_uploads = On
allow_url_fopen = On
cgi.force_redirect = 0
enable_dl = On
date.timezone = "${config.phpTimezone || 'UTC'}"

; --- EXTENSIONS ---
${extensionStr}

; --- OPCACHE ---
${opcacheStr}
`;
       fs.writeFileSync(path.join(phpDest, 'php.ini'), phpIni);
    }

    fs.writeFileSync(path.join(buildDir, 'package.json'), generatePackageJson(config));
    fs.writeFileSync(path.join(buildDir, 'main.js'), generateMainJs(config));
    fs.writeFileSync(path.join(buildDir, 'build.bat'), `@echo off\nnpm install && npm run build\npause`);

    const configFile = path.join(buildDir, 'visualneo.json');
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

    return { success: true };
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('build-app', async (event, sourceRoot) => {
    return new Promise(async (resolve, reject) => {
        const isWin = process.platform === 'win32';
        const npmCmd = isWin ? 'npm.cmd' : 'npm';
        const buildDir = path.join(sourceRoot, 'vnbuild');
        
        const sendLog = (msg, isError = false) => {
            mainWindow.webContents.send('download-progress', { type: 'build-log', msg, error: isError });
        };

        if (!fs.existsSync(buildDir)) {
            return resolve({ success: false, error: 'vnbuild not found. Generate config first.' });
        }

        // --- STEP 1: KILL RUNNING INSTANCES ---
        try {
            const configFile = path.join(buildDir, 'visualneo.json');
            if (fs.existsSync(configFile)) {
                const conf = JSON.parse(fs.readFileSync(configFile, 'utf8'));
                const execName = conf.productName + ".exe";
                sendLog(`Checking for running instances of ${execName}...`);
                try {
                    execSync(`taskkill /F /IM "${execName}"`, { stdio: 'ignore' });
                    sendLog('Closed running application instance.');
                } catch(e) { 
                    // Process was not running, safe to proceed
                }
            }
        } catch(e) {
            sendLog('Warning: Instance check skipped.', true);
        }

        // --- STEP 2: PREPARE DIST (RENAME STRATEGY) ---
        const distCleaned = await prepareDistFolder(buildDir, sendLog);
        if (!distCleaned) {
            return resolve({ success: false, error: 'Output folder is locked by System/Antivirus.' });
        }
        
        // --- STEP 3: BUILD START ---
        const buildEnv = getBuildEnv();
        const localPath = getLocalNodePath();
        
        if (localPath) sendLog('Using Local Node.js Engine: ' + localPath);
        else sendLog('Using Global Node.js Environment');

        exec(`${npmCmd} -v`, { env: buildEnv }, (err) => {
            if (err) {
                sendLog('Node.js/NPM not found. Please install Node.js in the Build tab.', true);
                return resolve({ success: false, error: 'NPM not found' });
            }

            sendLog(`Installing dependencies in ${buildDir}...`);
            const install = spawn(npmCmd, ['install'], { cwd: buildDir, shell: true, env: buildEnv });

            install.stdout.on('data', (d) => sendLog(d.toString()));
            install.stderr.on('data', (d) => sendLog(d.toString()));

            install.on('close', (code) => {
                if (code !== 0) {
                    sendLog(`npm install failed: code ${code}`, true);
                    return resolve({ success: false, error: 'Install failed' });
                }
                
                sendLog('Building application artifacts...');
                const build = spawn(npmCmd, ['run', 'build'], { cwd: buildDir, shell: true, env: buildEnv });
                
                build.stdout.on('data', (d) => sendLog(d.toString()));
                build.stderr.on('data', (d) => sendLog(d.toString()));

                build.on('close', (bCode) => {
                    if (bCode !== 0) {
                        sendLog(`Build failed: code ${bCode}`, true);
                        return resolve({ success: false, error: 'Build failed' });
                    }

                    // --- CLEANUP ---
                    // Increased timeout to 4s to allow Windows Defender to release locks on new .exe/.asar files
                    setTimeout(async () => {
                        try {
                            sendLog('Performing final cleanup...');
                            const configFile = path.join(buildDir, 'visualneo.json');
                            const distPath = path.join(buildDir, 'dist');
                            const junkExtensions = ['.yml', '.yaml', '.blockmap'];
                            let config = {};
                            
                            if (fs.existsSync(configFile)) config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

                            if (fs.existsSync(distPath)) {
                                const files = fs.readdirSync(distPath);
                                for (const f of files) {
                                    const fullPath = path.join(distPath, f);
                                    // Remove builder metadata files
                                    if (junkExtensions.some(ext => f.endsWith(ext))) {
                                        try { await deleteFolderRobust(fullPath, true); } catch(e) {}
                                    }
                                    
                                    // Remove unpacked folder if user didn't request it
                                    if (f === 'win-unpacked' && !config.targetUnpacked) {
                                        try {
                                            // Attempt robust deletion
                                            await deleteFolderRobust(fullPath);
                                            
                                            // Double check: If it still exists (locked?), force move it OUT of dist
                                            if (fs.existsSync(fullPath)) {
                                                forceMoveToTrash(fullPath);
                                            }
                                        } catch (delErr) {
                                            // Fallback
                                            forceMoveToTrash(fullPath);
                                        }
                                    }
                                }
                            }
                            
                            sendLog('Build Success!');
                            resolve({ success: true });
                        } catch(e) {
                            sendLog('Cleanup warning (minor): ' + e.message, false);
                            resolve({ success: true });
                        }
                    }, 4000); 
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

  const extraResources = [];
  if (c.enablePhp) {
      extraResources.push({ "from": "bin/php", "to": "php", "filter": ["**/*"] });
      extraResources.push({ "from": "www", "to": "www_source", "filter": ["**/*"] });
  }

  // Include the app-icon.png we copied in files list
  const files = c.enablePhp ? ["main.js", "app-icon.png"] : ["main.js", "app-icon.png", "www/**/*"];

  const buildConfig = {
    appId: `com.visualneo.${c.appName.replace(/\s+/g, '').toLowerCase()}`,
    productName: c.productName,
    files: files, 
    extraResources: extraResources,
    directories: { "output": "dist" },
    asar: true,
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
    dependencies: { },
    devDependencies: { "electron": "^29.1.5", "electron-builder": "^24.13.3" },
    build: buildConfig
  };

  return JSON.stringify(pkg, null, 2);
}

function generateMainJs(c) {
  return `const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// --- CONFIGURATION ---
const CONFIG = {
  title: "${c.productName}",
  entry: "${c.entryPoint}",
  usePhp: ${c.enablePhp},
  saveState: ${c.saveState},
  tray: ${c.trayIcon},
  minToTray: ${c.minimizeToTray},
  closeToTray: ${c.closeToTray},
  runBg: ${c.runBackground},
  singleInstance: ${c.singleInstance},
  kiosk: ${c.kiosk},
  contextMenu: ${c.contextMenu},
  nativeFrame: ${c.nativeFrame},
  showTaskbar: ${c.showTaskbar},
  dataMode: "${c.dataMode || 'static'}"
};

let mainWindow, tray = null, isQuitting = false, phpProcess = null, serverUrl = null;

const isDev = !app.isPackaged;
const appDataDir = app.getPath('userData');
const tempDir = app.getPath('temp');
const instanceId = 'vneo-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
const resourcesDir = isDev ? path.join(__dirname, 'bin') : process.resourcesPath;

function syncDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src);
  entries.forEach(entry => {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) syncDir(srcPath, destPath);
      else try { fs.copyFileSync(srcPath, destPath); } catch(e) {}
  });
}

const statePath = path.join(appDataDir, 'window-state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } 
  catch (e) { return { width: ${c.width}, height: ${c.height} }; }
}
function saveState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  fs.writeFileSync(statePath, JSON.stringify({ ...bounds, isMaximized: mainWindow.isMaximized() }));
}

async function setupEnvironment() {
    if (!CONFIG.usePhp) return { docRoot: null, phpDir: null };

    let runtimeRoot;
    if (CONFIG.dataMode === 'writable') {
        runtimeRoot = path.join(appDataDir, 'server_root');
    } else {
        // Unique path for every instance in static mode to prevent collision
        // We cleanup this folder on exit
        runtimeRoot = path.join(tempDir, CONFIG.title.replace(/[^a-zA-Z0-9]/g,''), instanceId);
    }

    const phpSource = path.join(resourcesDir, 'php');
    const wwwSource = isDev ? path.join(__dirname, 'www') : path.join(resourcesDir, 'www_source');

    if (!fs.existsSync(phpSource)) throw new Error("PHP Runtime missing in resources.");

    try {
        syncDir(wwwSource, runtimeRoot);
    } catch (e) {
        console.error("Setup Error", e);
    }

    return { docRoot: runtimeRoot, phpDir: phpSource };
}

async function startPhpServer() {
  if (!CONFIG.usePhp) return;
  
  return new Promise(async (resolve, reject) => {
    try {
      const env = await setupEnvironment();
      const phpExe = path.join(env.phpDir, 'php.exe');
      const phpIni = path.join(env.phpDir, 'php.ini');

      if (!fs.existsSync(phpExe)) return reject(new Error("PHP.exe not found at: " + phpExe));

      // Port 0 = OS assigns free port. Robust for multiple instances.
      phpProcess = spawn(phpExe, ['-S', '127.0.0.1:0', '-t', env.docRoot, '-c', phpIni], {
        cwd: env.docRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'] // pipe standard streams to capture port
      });

      let portFound = false;
      
      // Reduced timeout to 8s for better responsiveness on error
      const timer = setTimeout(() => {
          if(!portFound) {
              killPhp();
              reject(new Error("PHP Server startup timed out. Check if a firewall is blocking PHP."));
          }
      }, 8000);

      const checkOutput = (data) => {
          const str = data.toString();
          // FIX: Robust Regex matching. 
          // Matches "http://127.0.0.1:XXXX" whether it says "Listening on" or "Development Server..."
          const match = str.match(/http:\\/\\/127\\.0\\.0\\.1:(\\d+)/);
          
          if (match && !portFound) {
              portFound = true;
              clearTimeout(timer);
              serverUrl = \`http://127.0.0.1:\${match[1]}/\`;
              resolve(serverUrl);
          }
      };

      phpProcess.stdout.on('data', checkOutput);
      phpProcess.stderr.on('data', checkOutput);
      
      phpProcess.on('error', (err) => { clearTimeout(timer); reject(err); });
      phpProcess.on('close', (code) => { 
          if(!portFound) {
              clearTimeout(timer);
              reject(new Error("PHP Exited unexpectedly (Code: " + code + ")")); 
          }
      });

    } catch (e) { reject(e); }
  });
}

function killPhp() {
  if (phpProcess) {
    try {
        // Soft kill first
        process.kill(phpProcess.pid);
    } catch(e) {}
    
    try {
        // Aggressive force kill for Windows to release file locks
        if (process.platform === 'win32') {
             execSync(\`taskkill /pid \${phpProcess.pid} /f /t\`, { stdio: 'ignore' });
        }
    } catch(e) {}
    
    phpProcess = null;
  }
  
  // Clean up temp dir if in static mode
  if (CONFIG.dataMode === 'static') {
      try { 
          const tempRoot = path.join(tempDir, CONFIG.title.replace(/[^a-zA-Z0-9]/g,''), instanceId);
          if(fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch(e) {}
  }
}

function createWindow() {
  const state = CONFIG.saveState ? loadState() : { width: ${c.width}, height: ${c.height} };
  
  const winConfig = {
    width: state.width, height: state.height, x: state.x, y: state.y,
    minWidth: ${c.minWidth || 0}, minHeight: ${c.minHeight || 0},
    resizable: ${c.resizable}, fullscreenable: ${c.fullscreenable},
    kiosk: CONFIG.kiosk, frame: CONFIG.nativeFrame, center: ${c.center},
    autoHideMenuBar: true, 
    show: false, // Wait for ready-to-show
    skipTaskbar: !CONFIG.showTaskbar,
    title: CONFIG.title,
    backgroundColor: '#121212',
    webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: ${c.devTools} }
  };

  ${c.iconPath ? `winConfig.icon = path.join(__dirname, 'app-icon.png');` : ''}

  mainWindow = new BrowserWindow(winConfig);
  mainWindow.setMenu(null);
  if (CONFIG.saveState && state.isMaximized) mainWindow.maximize();

  if (CONFIG.usePhp && serverUrl) {
    mainWindow.loadURL(serverUrl + CONFIG.entry);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'www', CONFIG.entry));
  }
  
  ${c.userAgent ? `mainWindow.webContents.setUserAgent("${c.userAgent}");` : ''}
  
  // Visual Failsafe: If ready-to-show doesn't fire (e.g. blank page), show anyway after 3s
  const showTimer = setTimeout(() => {
      if(mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 3000);

  mainWindow.once('ready-to-show', () => {
      clearTimeout(showTimer);
      mainWindow.show();
  });

  mainWindow.webContents.on('unresponsive', () => {
      // Optional: Log or reload
  });

  // Tray Logic: Minimize
  mainWindow.on('minimize', (e) => {
    if (CONFIG.minToTray && tray) {
        e.preventDefault();
        mainWindow.hide();
    }
  });

  // Tray Logic: Close
  mainWindow.on('close', (e) => {
    if (CONFIG.saveState) saveState();
    
    if (CONFIG.closeToTray && tray && !isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      return; 
    }
    // If not closing to tray, standard close event proceeds
  });
  
  if (CONFIG.contextMenu) {
      mainWindow.webContents.on('context-menu', () => {
        Menu.buildFromTemplate([{ role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'reload' }]).popup();
      });
  }
}

function createTray() {
  if (!CONFIG.tray) return;
  const iconPath = path.join(__dirname, 'app-icon.png');

  try {
     if(fs.existsSync(iconPath)) {
         tray = new Tray(iconPath);
         tray.setToolTip(CONFIG.title);
         tray.setContextMenu(Menu.buildFromTemplate([
           { label: 'Open', click: () => mainWindow.show() },
           { label: 'Exit', click: () => { isQuitting = true; app.quit(); } }
         ]));
         tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show());
     }
  } catch (e) {
     if(mainWindow) mainWindow.setSkipTaskbar(false);
  }
}

const gotLock = CONFIG.singleInstance ? app.requestSingleInstanceLock() : true;
if (!gotLock) { app.quit(); } 
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  
  app.whenReady().then(async () => {
    try {
        await startPhpServer();
        createWindow();
        createTray();
    } catch(e) {
        dialog.showErrorBox("Startup Error", e.message);
        app.quit();
    }
  });
  
  app.on('window-all-closed', () => { 
      if (CONFIG.runBg && !isQuitting) {
          // Keep running
      } else {
          app.quit();
      }
  });
  
  // Clean shutdown hooks
  app.on('before-quit', () => { isQuitting = true; killPhp(); });
  app.on('will-quit', () => { killPhp(); });
}

// Ensure PHP is killed if the process crashes or exits unexpectedly
process.on('exit', () => killPhp());
`;
}