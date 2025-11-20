
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
  if(type === 'cmd') div.classList.add('log-cmd');
  
  // strip colors if coming from raw terminal output sometimes
  const cleanMsg = msg.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  
  const time = new Date().toLocaleTimeString();
  div.innerText = `[${time}] ${cleanMsg}`;
  consoleOutput.appendChild(div);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Console Toolbar Actions
document.getElementById('btnClearLogs').addEventListener('click', () => {
  consoleOutput.innerHTML = '';
});

document.getElementById('btnCopyLogs').addEventListener('click', async () => {
  const text = consoleOutput.innerText;
  await window.api.copyToClipboard(text);
  
  const btn = document.getElementById('btnCopyLogs');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
  setTimeout(() => btn.innerHTML = originalHtml, 2000);
});

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

// --- PHP CACHE & DOWNLOADER LOGIC ---

// Cache for installed versions
let phpCache = {};

async function refreshPhpStatus() {
    try {
        phpCache = await window.api.getPhpCache();
        updatePhpUiState();
    } catch (e) {
        console.error("Failed to load PHP cache", e);
    }
}

const phpSelect = document.getElementById('phpVersionSelect');
const btnDownload = document.getElementById('btnDownloadPhp');
const phpPathInput = document.getElementById('phpPath');
const phpStatusBadge = document.getElementById('phpStatusBadge');

// Update UI based on selection and cache
function updatePhpUiState() {
    const selectedVer = phpSelect.value;
    const cached = phpCache[selectedVer];
    
    // Update dropdown options text
    Array.from(phpSelect.options).forEach(opt => {
        const ver = opt.value;
        const originalText = opt.getAttribute('data-orig') || opt.text;
        if (!opt.hasAttribute('data-orig')) opt.setAttribute('data-orig', originalText);
        
        if (phpCache[ver]) {
            opt.text = `✓ ${originalText} (Installed)`;
            opt.style.fontWeight = 'bold';
            opt.style.color = '#4ade80';
        } else {
            opt.text = originalText;
            opt.style.fontWeight = 'normal';
            opt.style.color = '#ccc';
        }
    });

    if (cached) {
        phpStatusBadge.innerHTML = '<span style="color:#4ade80"><i class="fa-solid fa-check-circle"></i> Ready to use</span>';
        btnDownload.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Re-Download';
        btnDownload.classList.add('secondary');
        
        // Auto-fill path if empty or pointing to another cache
        if (!phpPathInput.value || phpPathInput.value.includes('php-cache')) {
            phpPathInput.value = cached;
        }
    } else {
        phpStatusBadge.innerHTML = '<span style="color:#fbbf24"><i class="fa-solid fa-circle-exclamation"></i> Not installed</span>';
        btnDownload.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Download & Install';
        btnDownload.classList.remove('secondary');
        
        // Clear path if it was auto-filled before
        if (phpPathInput.value.includes('php-cache')) {
            phpPathInput.value = '';
        }
    }
}

// Listener for dropdown change
phpSelect.addEventListener('change', updatePhpUiState);

// Initial check on load
refreshPhpStatus();


if (window.api && window.api.onDownloadProgress) {
    window.api.onDownloadProgress((data) => {
        if(data.type === 'build-log') {
             // Build log stream
             if(data.error) log(data.msg, 'error');
             else log(data.msg, 'cmd');
             return;
        }

        const modal = document.getElementById('progressModal');
        const bar = document.getElementById('progressBar');
        const percentTxt = document.getElementById('progressPercent');
        const sizeTxt = document.getElementById('progressSize');
        const detailTxt = document.getElementById('progressDetail');

        modal.classList.add('active');
        
        const percentage = Math.round(data.percent);
        bar.style.width = `${percentage}%`;
        percentTxt.innerText = `${percentage}%`;
        detailTxt.innerText = data.status || 'Processing...';

        if(data.total) {
            const currentMB = (data.current / (1024 * 1024)).toFixed(1);
            const totalMB = (data.total / (1024 * 1024)).toFixed(1);
            sizeTxt.innerText = `${currentMB}/${totalMB} MB`;
        }
    });
}

btnDownload.addEventListener('click', async () => {
  const version = phpSelect.value;
  const modal = document.getElementById('progressModal');
  
  log(`Initializing download for PHP ${version}...`, 'info');
  
  // Show modal immediately with 0%
  modal.classList.add('active');
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressPercent').innerText = '0%';
  document.getElementById('progressDetail').innerText = 'Connecting...';
  
  try {
    const result = await window.api.downloadPhp(version);
    
    modal.classList.remove('active'); 
    
    if (result.success) {
      log(`PHP ${version} installed successfully!`, 'success');
      log(`Location: ${result.path}`, 'info');
      
      // Refresh cache and UI
      await refreshPhpStatus();
      
      setTimeout(() => alert(`PHP ${version} downloaded and verified!`), 100);
    } else {
      log(`Download Error: ${result.error}`, 'error');
      alert(`Error: ${result.error}`);
    }
  } catch (e) {
    modal.classList.remove('active');
    log(`Error: ${e.message}`, 'error');
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

// Config Collector
function getAppConfig() {
  const sourcePath = document.getElementById('sourcePath').value;
  if (!sourcePath) {
    log('Error: Please select a Source Folder first.', 'error');
    alert('Please select a Web App Source Folder.');
    return null;
  }

  const enablePhp = document.getElementById('enablePhp').checked;
  const phpPath = document.getElementById('phpPath').value;
  
  if (enablePhp && !phpPath) {
    log('Error: PHP is enabled but no PHP folder selected/downloaded.', 'error');
    alert('Please select or download a PHP version.');
    return null;
  }

  const extraExt = document.getElementById('extraExtensions').value.split(',').map(s => s.trim()).filter(s => s);
  const finalExtensions = [...selectedExtensions, ...extraExt];

  return {
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
    nativeFrame: true, 
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
}

// Generate Only
document.getElementById('btnGenerateOnly').addEventListener('click', async () => {
  const config = getAppConfig();
  if(!config) return;

  log('Generating Configuration Files...', 'info');
  try {
    const result = await window.api.generateApp(config);
    if (result.success) {
       log('Configuration Generated Successfully.', 'success');
    } else {
       log(`Error: ${result.error}`, 'error');
    }
  } catch(e) {
    log(e.message, 'error');
  }
});

// Full Build
document.getElementById('btnBuildFull').addEventListener('click', async () => {
  const config = getAppConfig();
  if(!config) return;

  // 1. Generate
  log('--- STARTING AUTOMATED BUILD ---', 'info');
  log('Step 1: Generating Config...', 'info');
  
  const genResult = await window.api.generateApp(config);
  if (!genResult.success) {
    log(`Generation Failed: ${genResult.error}`, 'error');
    return;
  }
  log('Configuration files created.', 'success');

  // 2. Build via Main Process
  log('Step 2: Installing dependencies & Building...', 'info');
  log('NOTE: This requires Node.js to be installed on your system.', 'warn');
  
  const btn = document.getElementById('btnBuildFull');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Building...';

  try {
    const result = await window.api.buildApp(config.sourcePath);
    
    if (result.success) {
       log('---------------------------------', 'success');
       log('BUILD COMPLETED SUCCESSFULLY!', 'success');
       log('Check the "dist" folder inside your project.', 'info');
       log('---------------------------------', 'success');
       alert('Build Complete!');
    } else {
       log('---------------------------------', 'error');
       log('BUILD FAILED.', 'error');
       log('Please check the logs above for details.', 'error');
       log('Ensure Node.js is installed and accessible.', 'warn');
       log('---------------------------------', 'error');
    }
  } catch (e) {
     log(`Critical Error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-play-circle"></i> BUILD EXECUTABLE';
  }
});