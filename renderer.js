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
    // Remove active class
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    
    // Add active class
    tab.classList.add('active');
    const target = tab.getAttribute('data-tab');
    document.getElementById(`tab-${target}`).classList.add('active');
    
    // Update header
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
    log('Error: PHP is enabled but no PHP Binary folder selected.', 'error');
    alert('Please select a PHP Binary Folder or disable PHP.');
    return;
  }

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
    nativeFrame: document.getElementById('nativeFrame').checked,
    center: document.getElementById('center').checked,

    // PHP
    enablePhp: enablePhp,
    phpPath: phpPath,
    phpPort: document.getElementById('phpPort').value || 8000,
    phpMemory: document.getElementById('phpMemory').value,
    phpUpload: document.getElementById('phpUpload').value,
    phpTime: document.getElementById('phpTime').value,
    phpExtensions: document.getElementById('phpExtensions').value,

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
      if (enablePhp) log('PHP binaries copied to project.', 'info');
      
      log('-----------------------------------');
      log('NEXT STEPS:', 'warn');
      log('1. Open terminal in your source folder.');
      log('2. Run "npm install"');
      log('3. Run "npm start" to test.');
      log('4. Run "npm run build" to create .exe');
      log('-----------------------------------');
    } else {
      log(`Generation Failed: ${result.error}`, 'error');
    }
  } catch (e) {
    log(`Unexpected Error: ${e.message}`, 'error');
  }
});