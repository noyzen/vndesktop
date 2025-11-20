
// View Management
const viewManager = document.getElementById('view-manager');
const viewEditor = document.getElementById('view-editor');
const projectListEl = document.getElementById('projectList');

// Navigation Logic
const tabs = document.querySelectorAll('.nav-item');
const contents = document.querySelectorAll('.tab-content');
const headerTitle = document.getElementById('header-title');
const phpToggle = document.getElementById('enablePhp');
const phpPanel = document.getElementById('phpPanel');
const phpDisabledMsg = document.getElementById('phpDisabledMsg');

// Project State
let currentProjectPath = null;
let selectedExtensions = new Set(['curl', 'gd', 'mbstring', 'sqlite3', 'openssl']);

// --- PROJECT MANAGER LOGIC ---

async function renderProjectList() {
  const projects = await window.api.getProjects();
  projectListEl.innerHTML = '';
  
  if(projects.length === 0) {
      projectListEl.innerHTML = '<div style="text-align:center; color:#555; padding:30px;">No recent projects. Click "New Project" to start.</div>';
      return;
  }

  projects.forEach((p, index) => {
      const card = document.createElement('div');
      card.className = 'project-card';
      if (index === 0) card.classList.add('last-used');
      
      const lastUsedDate = new Date(p.lastUsed).toLocaleDateString();
      const isLast = index === 0 ? '<span class="last-used-badge">Last Used</span>' : '';
      
      card.innerHTML = `
         <div class="project-info">
            <h3>${p.name}</h3>
            <p>${p.path}</p>
         </div>
         <div class="project-meta">
             ${isLast}
             <span style="font-size:0.8rem; color:#666;">${lastUsedDate}</span>
             <button class="btn-del-proj" data-id="${p.id}"><i class="fa-solid fa-times"></i></button>
         </div>
      `;
      
      // Click to open
      card.onclick = (e) => {
          if(e.target.closest('.btn-del-proj')) return;
          openProject(p.path);
      };
      
      // Delete
      const delBtn = card.querySelector('.btn-del-proj');
      delBtn.onclick = async (e) => {
          e.stopPropagation();
          if(confirm('Remove this project from the list? (Files will NOT be deleted)')) {
              await window.api.removeProject(p.id);
              renderProjectList();
          }
      };
      
      projectListEl.appendChild(card);
  });
}

// Add New Project
document.getElementById('btnNewProject').addEventListener('click', async () => {
   const path = await window.api.selectFolder();
   if(path) {
       await window.api.addProject(path);
       openProject(path);
   }
});

// Switch Views
function showEditor() {
    viewManager.classList.add('hidden');
    viewEditor.classList.remove('hidden');
}

function showManager() {
    viewEditor.classList.add('hidden');
    viewManager.classList.remove('hidden');
    renderProjectList();
    currentProjectPath = null;
}

// Open Project & Load Config
async function openProject(path) {
    currentProjectPath = path;
    const config = await window.api.loadProjectConfig(path);
    
    // Reset UI to defaults
    resetForm();
    document.getElementById('sourcePath').value = path;
    
    if (config) {
        populateForm(config);
        log(`Loaded project config from: ${path}`, 'success');
    } else {
        log(`New project initialized: ${path}`, 'info');
        // Set default name based on folder
        document.getElementById('productName').value = path.split(/[\\/]/).pop();
        document.getElementById('appName').value = path.split(/[\\/]/).pop().toLowerCase().replace(/\s+/g, '-');
    }
    
    showEditor();
}

// Back Button
document.getElementById('btnBackToProjects').addEventListener('click', async () => {
    // Auto save on exit?
    await saveCurrentConfig();
    showManager();
});

// Save Logic
async function saveCurrentConfig() {
    if (!currentProjectPath) return;
    const config = getAppConfig(); // Get current UI state
    if (config) {
        await window.api.saveProjectConfig(currentProjectPath, config);
        log('Project settings saved.', 'info');
    }
}

document.getElementById('btnQuickSave').addEventListener('click', async () => {
    await saveCurrentConfig();
    const btn = document.getElementById('btnQuickSave');
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Saved';
    setTimeout(() => btn.innerHTML = '<i class="fa-solid fa-save"></i> Save Settings', 2000);
});


// --- EDITOR UI LOGIC ---

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
  
  const cleanMsg = msg.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  
  const time = new Date().toLocaleTimeString();
  div.innerText = `[${time}] ${cleanMsg}`;
  consoleOutput.appendChild(div);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

document.getElementById('btnClearLogs').addEventListener('click', () => { consoleOutput.innerHTML = ''; });
document.getElementById('btnCopyLogs').addEventListener('click', async () => {
  await window.api.copyToClipboard(consoleOutput.innerText);
});

// PHP Extensions
const defaultExtensions = [
  'curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'openssl', 
  'pdo_sqlite', 'sqlite3', 'mysqli', 'pdo_mysql', 'exif', 'soap'
];
const extGrid = document.getElementById('extGrid');

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
  if(selectedExtensions.has(ext)) selectedExtensions.delete(ext);
  else selectedExtensions.add(ext);
  renderExtensions();
}

// --- PHP DOWNLOADER ---
let phpCache = {};
async function refreshPhpStatus() {
    try {
        phpCache = await window.api.getPhpCache();
        updatePhpUiState();
    } catch (e) {}
}

const phpSelect = document.getElementById('phpVersionSelect');
const btnDownload = document.getElementById('btnDownloadPhp');
const phpPathInput = document.getElementById('phpPath');
const phpStatusBadge = document.getElementById('phpStatusBadge');

function updatePhpUiState() {
    const selectedVer = phpSelect.value;
    const cached = phpCache[selectedVer];
    
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
        if (!phpPathInput.value || phpPathInput.value.includes('php-cache')) phpPathInput.value = cached;
    } else {
        phpStatusBadge.innerHTML = '<span style="color:#fbbf24"><i class="fa-solid fa-circle-exclamation"></i> Not installed</span>';
        btnDownload.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Download & Install';
        btnDownload.classList.remove('secondary');
        if (phpPathInput.value.includes('php-cache')) phpPathInput.value = '';
    }
}

phpSelect.addEventListener('change', updatePhpUiState);
refreshPhpStatus();

if (window.api && window.api.onDownloadProgress) {
    window.api.onDownloadProgress((data) => {
        if(data.type === 'build-log') {
             if(data.error) log(data.msg, 'error'); else log(data.msg, 'cmd');
             return;
        }
        const modal = document.getElementById('progressModal');
        modal.classList.add('active');
        const percentage = Math.round(data.percent);
        document.getElementById('progressBar').style.width = `${percentage}%`;
        document.getElementById('progressPercent').innerText = `${percentage}%`;
        document.getElementById('progressDetail').innerText = data.status || 'Processing...';
        if(data.total) {
            document.getElementById('progressSize').innerText = `${(data.current / 1048576).toFixed(1)}/${(data.total / 1048576).toFixed(1)} MB`;
        }
    });
}

btnDownload.addEventListener('click', async () => {
  const version = phpSelect.value;
  const modal = document.getElementById('progressModal');
  modal.classList.add('active');
  try {
    const result = await window.api.downloadPhp(version);
    modal.classList.remove('active'); 
    if (result.success) {
      log(`PHP ${version} installed.`, 'success');
      await refreshPhpStatus();
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (e) { modal.classList.remove('active'); }
});

// File Pickers
document.getElementById('btnSelectPhp').addEventListener('click', async () => {
  const path = await window.api.selectFolder();
  if (path) document.getElementById('phpPath').value = path;
});
document.getElementById('btnSelectIcon').addEventListener('click', async () => {
  const path = await window.api.selectFile(['png', 'ico', 'icns']);
  if (path) document.getElementById('iconPath').value = path;
});

// Form Helper
function resetForm() {
    document.getElementById('appName').value = 'my-electron-app';
    document.getElementById('productName').value = 'My Awesome App';
    document.getElementById('appVersion').value = '1.0.0';
    document.getElementById('appAuthor').value = 'VisualNEO User';
    document.getElementById('entryPoint').value = 'index.html';
    document.getElementById('winWidth').value = 1280;
    document.getElementById('winHeight').value = 800;
    document.getElementById('resizable').checked = true;
    document.getElementById('fullscreenable').checked = true;
    document.getElementById('saveState').checked = true;
    document.getElementById('kiosk').checked = false;
    document.getElementById('enablePhp').checked = false;
    document.getElementById('phpPath').value = '';
    document.getElementById('phpPort').value = 8000;
    selectedExtensions = new Set(['curl', 'gd', 'mbstring', 'sqlite3', 'openssl']);
    renderExtensions();
    document.getElementById('extraExtensions').value = '';
    phpToggle.dispatchEvent(new Event('change'));
}

function populateForm(c) {
    document.getElementById('appName').value = c.appName || '';
    document.getElementById('productName').value = c.productName || '';
    document.getElementById('appVersion').value = c.version || '1.0.0';
    document.getElementById('appAuthor').value = c.author || '';
    document.getElementById('entryPoint').value = c.entryPoint || 'index.html';
    document.getElementById('winWidth').value = c.width || 1280;
    document.getElementById('winHeight').value = c.height || 800;
    document.getElementById('minWidth').value = c.minWidth || 0;
    document.getElementById('minHeight').value = c.minHeight || 0;
    
    document.getElementById('resizable').checked = c.resizable;
    document.getElementById('fullscreenable').checked = c.fullscreenable;
    document.getElementById('kiosk').checked = c.kiosk;
    document.getElementById('saveState').checked = c.saveState;
    document.getElementById('center').checked = c.center;
    
    document.getElementById('enablePhp').checked = c.enablePhp;
    if(c.phpPath) document.getElementById('phpPath').value = c.phpPath;
    document.getElementById('phpPort').value = c.phpPort || 8000;
    document.getElementById('phpMemory').value = c.phpMemory || '256M';
    document.getElementById('phpUpload').value = c.phpUpload || '64M';
    document.getElementById('phpTime').value = c.phpTime || 120;
    
    selectedExtensions = new Set(c.phpExtensions || []);
    renderExtensions();
    
    document.getElementById('trayIcon').checked = c.trayIcon;
    document.getElementById('minimizeToTray').checked = c.minimizeToTray;
    document.getElementById('runBackground').checked = c.runBackground;
    document.getElementById('singleInstance').checked = c.singleInstance;
    document.getElementById('devTools').checked = c.devTools;
    document.getElementById('contextMenu').checked = c.contextMenu;
    document.getElementById('userAgent').value = c.userAgent || '';
    document.getElementById('iconPath').value = c.iconPath || '';
    
    document.getElementById('targetNsis').checked = c.targetNsis;
    document.getElementById('targetPortable').checked = c.targetPortable;
    document.getElementById('targetUnpacked').checked = c.targetUnpacked;
    
    phpToggle.dispatchEvent(new Event('change'));
}

function getAppConfig() {
  const sourcePath = document.getElementById('sourcePath').value;
  if (!sourcePath) return null;

  const enablePhp = document.getElementById('enablePhp').checked;
  const phpPath = document.getElementById('phpPath').value;
  if (enablePhp && !phpPath) {
    alert('Please select a PHP folder.');
    return null;
  }

  const extraExt = document.getElementById('extraExtensions').value.split(',').map(s => s.trim()).filter(s => s);
  return {
    appName: document.getElementById('appName').value,
    productName: document.getElementById('productName').value,
    version: document.getElementById('appVersion').value,
    author: document.getElementById('appAuthor').value,
    sourcePath: sourcePath,
    entryPoint: document.getElementById('entryPoint').value,
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
    enablePhp: enablePhp,
    phpPath: phpPath,
    phpPort: document.getElementById('phpPort').value,
    phpMemory: document.getElementById('phpMemory').value,
    phpUpload: document.getElementById('phpUpload').value,
    phpTime: document.getElementById('phpTime').value,
    phpExtensions: [...selectedExtensions, ...extraExt],
    trayIcon: document.getElementById('trayIcon').checked,
    minimizeToTray: document.getElementById('minimizeToTray').checked,
    runBackground: document.getElementById('runBackground').checked,
    singleInstance: document.getElementById('singleInstance').checked,
    devTools: document.getElementById('devTools').checked,
    contextMenu: document.getElementById('contextMenu').checked,
    userAgent: document.getElementById('userAgent').value,
    iconPath: document.getElementById('iconPath').value,
    targetNsis: document.getElementById('targetNsis').checked,
    targetPortable: document.getElementById('targetPortable').checked,
    targetUnpacked: document.getElementById('targetUnpacked').checked,
  };
}

// Actions
document.getElementById('btnGenerateOnly').addEventListener('click', async () => {
  const config = getAppConfig();
  if(!config) return;
  await window.api.saveProjectConfig(currentProjectPath, config);
  const result = await window.api.generateApp(config);
  if (result.success) log('Configuration Generated.', 'success');
  else log(`Error: ${result.error}`, 'error');
});

document.getElementById('btnBuildFull').addEventListener('click', async () => {
  const config = getAppConfig();
  if(!config) return;
  
  await window.api.saveProjectConfig(currentProjectPath, config);
  
  log('--- STARTING BUILD ---', 'info');
  const genResult = await window.api.generateApp(config);
  if (!genResult.success) { log(`Gen Failed: ${genResult.error}`, 'error'); return; }
  
  const btn = document.getElementById('btnBuildFull');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Building...';

  try {
    const result = await window.api.buildApp(config.sourcePath);
    if (result.success) {
       log('BUILD COMPLETED!', 'success');
       alert('Build Complete!');
    } else {
       log('BUILD FAILED.', 'error');
    }
  } catch (e) { log(e.message, 'error'); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play-circle"></i> BUILD EXECUTABLE'; }
});

// Initial Render
renderProjectList();
