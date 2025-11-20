// Navigation Logic
const tabs = document.querySelectorAll('.nav-item');
const contents = document.querySelectorAll('.tab-content');
const headerTitle = document.getElementById('header-title');
const phpToggle = document.getElementById('enablePhp');
const phpPanel = document.getElementById('phpPanel');
const phpDisabledMsg = document.getElementById('phpDisabledMsg');

// Icon map for headers
const tabIcons = {
  'project': '<i class="fa-solid fa-folder-open"></i>',
  'window': '<i class="fa-solid fa-desktop"></i>',
  'php': '<i class="fa-brands fa-php"></i>',
  'system': '<i class="fa-solid fa-cogs"></i>',
  'build': '<i class="fa-solid fa-hammer"></i>'
};

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    const target = tab.getAttribute('data-tab');
    document.getElementById(`tab-${target}`).classList.add('active');
    
    const icon = tabIcons[target] || '';
    headerTitle.innerHTML = `${icon} ${tab.innerText.trim()}`;
  });
});

// PHP Toggle Logic
phpToggle.addEventListener('change', () => {
  if(phpToggle.checked) {
    phpPanel.classList.remove('hidden');
    phpDisabledMsg.classList.add('hidden');
  } else {
    phpPanel.classList.add('hidden');
    phpDisabledMsg.classList.remove('hidden');
  }
});

// Logger
const consoleOutput = document.getElementById('consoleOutput');
function log(msg, type = 'info') {
  const div = document.createElement('div');
  div.classList.add('log-line');
  if(type === 'success') div.classList.add('log-success');
  if(type === 'error') div.classList.add('log-error');
  if(type === 'info') div.classList.add('log-info');
  if(type === 'warn') div.classList.add('log-warn');
  
  const time = new Date().toLocaleTimeString();
  div.innerText = `[${time}] ${msg}`;
  consoleOutput.appendChild(div);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// --- PHP EXTENSION MANAGER UI ---
const defaultExtensions = [
  'curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'openssl', 
  'pdo_sqlite', 'sqlite3', 'mysqli', 'pdo_mysql', 'exif', 'soap'
];

const extGrid = document.getElementById('extGrid');
const selectedExtensions = new Set(['curl', 'gd', 'mbstring', 'sqlite3', 'openssl']);

function renderExtensions() {
  extGrid.innerHTML = '';
  defaultExtensions.forEach(ext => {
    const el = document.createElement('div');
    el.classList.add('ext-card');
    if(selectedExtensions.has(ext)) el.classList.add('selected');
    el.innerText = ext;
    el.onclick = () => toggleExtension(ext);
    extGrid.appendChild(el);
  });
}

function toggleExtension(ext) {
  if(selectedExtensions.has(ext)) {
    selectedExtensions.delete(ext);
  } else {
    selectedExtensions.add(ext);
  }
  renderExtensions();
}

renderExtensions();

// --- DOWNLOADER LOGIC ---
document.getElementById('btnDownloadPhp').addEventListener('click', async () => {
  const version = document.getElementById('phpVersionSelect').value;
  log(`Starting download for PHP ${version}... Please wait.`, 'info');
  
  document.getElementById('btnDownloadPhp').disabled = true;
  document.getElementById('btnDownloadPhp').innerText = "Downloading...";
  
  try {
    const result = await window.api.downloadPhp(version);
    if (result.success) {
      document.getElementById('phpPath').value = result.path;
      log(`PHP ${version} installed successfully at: ${result.path}`, 'success');
    } else {
      log(`Download Error: ${result.error}`, 'error');
    }
  } catch (e) {
    log(`Error: ${e.message}`, 'error');
  } finally {
    document.getElementById('btnDownloadPhp').disabled = false;
    document.getElementById('btnDownloadPhp').innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Download & Install';
  }
});


// File Pickers
document.getElementById('btnSelectSource').addEventListener('click', async () => {
  const path = await window.api.selectFolder();
  if (path) {
    document.getElementById('sourcePath').value = path;
    log(`Selected Project Source: ${path}`);
  }
});

document.getElementById('btnSelectPhp').addEventListener('click', async () => {
  const path = await window.api.selectFolder();
  if (path) {
    document.getElementById('phpPath').value = path;
    log(`Selected PHP Binary Folder: ${path}`);
  }
});

document.getElementById('btnSelectIcon').addEventListener('click', async () => {
  const path = await window.api.selectFile(['png', 'ico', 'icns']);
  if (path) {
    document.getElementById('iconPath').value = path;
    log(`Selected App Icon: ${path}`);
  }
});

// Generate Action
document.getElementById('btnGenerate').addEventListener('click', async () => {
  // Validation
  const sourcePath = document.getElementById('sourcePath').value;
  if (!sourcePath) {
    log('Error: Please select a Source Folder first.', 'error');
    alert('Please select a Web App Source Folder.');
    return;
  }

  const enablePhp = document.getElementById('enablePhp').checked;
  const phpPath = document.getElementById('phpPath').value;
  
  if (enablePhp && !phpPath) {
    log('Error: PHP is enabled but no PHP folder selected/downloaded.', 'error');
    alert('Please select or download a PHP version.');
    return;
  }

  // Merge Extensions
  const extraExt = document.getElementById('extraExtensions').value.split(',').map(s => s.trim()).filter(s => s);
  const finalExtensions = [...selectedExtensions, ...extraExt];

  const config = {
    // Project
    appName: document.getElementById('appName').value || 'my-app',
    productName: document.getElementById('productName').value || 'My App',
    version: document.getElementById('appVersion').value || '1.0.0',
    author: document.getElementById('appAuthor').value || '',
    sourcePath: sourcePath,
    entryPoint: document.getElementById('entryPoint').value,
    
    // Window
    width: parseInt(document.getElementById('winWidth').value) || 1024,
    height: parseInt(document.getElementById('winHeight').value) || 768,
    minWidth: parseInt(document.getElementById('minWidth').value) || 0,
    minHeight: parseInt(document.getElementById('minHeight').value) || 0,
    resizable: document.getElementById('resizable').checked,
    fullscreenable: document.getElementById('fullscreenable').checked,
    kiosk: document.getElementById('kiosk').checked,
    saveState: document.getElementById('saveState').checked,
    nativeFrame: true, // Enforced in this version
    center: document.getElementById('center').checked,

    // PHP
    enablePhp: enablePhp,
    phpPath: phpPath,
    phpPort: document.getElementById('phpPort').value || 8000,
    phpMemory: document.getElementById('phpMemory').value,
    phpUpload: document.getElementById('phpUpload').value,
    phpTime: document.getElementById('phpTime').value,
    phpExtensions: finalExtensions,

    // System
    trayIcon: document.getElementById('trayIcon').checked,
    minimizeToTray: document.getElementById('minimizeToTray').checked,
    runBackground: document.getElementById('runBackground').checked,
    singleInstance: document.getElementById('singleInstance').checked,
    devTools: document.getElementById('devTools').checked,
    contextMenu: document.getElementById('contextMenu').checked,
    userAgent: document.getElementById('userAgent').value,

    // Build
    iconPath: document.getElementById('iconPath').value,
    targetNsis: document.getElementById('targetNsis').checked,
    targetPortable: document.getElementById('targetPortable').checked,
    targetUnpacked: document.getElementById('targetUnpacked').checked,
  };

  log('Starting Application Generation...', 'info');
  
  try {
    const result = await window.api.generateApp(config);
    
    if (result.success) {
      log('SUCCESS! Application generated.', 'success');
      log(`Target: ${config.sourcePath}`, 'info');
      
      log('-----------------------------------');
      log('NEXT STEPS:', 'warn');
      log('1. Open terminal in your source folder.');
      log('2. Run "npm install"');
      log('3. Run "npm run build"');
      log('-----------------------------------');
    } else {
      log(`Generation Failed: ${result.error}`, 'error');
    }
  } catch (e) {
    log(`Unexpected Error: ${e.message}`, 'error');
  }
});