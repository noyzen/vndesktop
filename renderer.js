// Navigation Logic
const tabs = document.querySelectorAll('.nav-item');
const contents = document.querySelectorAll('.tab-content');
const headerTitle = document.getElementById('header-title');

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
    headerTitle.innerText = tab.innerText.trim() + ' Settings';
  });
});

// Logger
const consoleOutput = document.getElementById('consoleOutput');
function log(msg, type = 'info') {
  const div = document.createElement('div');
  div.classList.add('log-line');
  if(type === 'success') div.classList.add('log-success');
  if(type === 'error') div.classList.add('log-error');
  if(type === 'info') div.classList.add('log-info');
  div.innerText = `> ${msg}`;
  consoleOutput.appendChild(div);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// File Pickers
document.getElementById('btnSelectSource').addEventListener('click', async () => {
  const path = await window.api.selectFolder();
  if (path) {
    document.getElementById('sourcePath').value = path;
    log(`Selected Source: ${path}`);
  }
});

document.getElementById('btnSelectIcon').addEventListener('click', async () => {
  const path = await window.api.selectFile(['png', 'ico', 'icns']);
  if (path) {
    document.getElementById('iconPath').value = path;
    log(`Selected Icon: ${path}`);
  }
});

// Generate Action
document.getElementById('btnGenerate').addEventListener('click', async () => {
  const config = {
    // Project
    appName: document.getElementById('appName').value || 'my-app',
    productName: document.getElementById('productName').value || 'My App',
    version: document.getElementById('appVersion').value || '1.0.0',
    author: document.getElementById('appAuthor').value || '',
    sourcePath: document.getElementById('sourcePath').value,
    entryPoint: document.getElementById('entryPoint').value,
    
    // Window
    width: parseInt(document.getElementById('winWidth').value) || 800,
    height: parseInt(document.getElementById('winHeight').value) || 600,
    minWidth: parseInt(document.getElementById('minWidth').value) || 0,
    minHeight: parseInt(document.getElementById('minHeight').value) || 0,
    resizable: document.getElementById('resizable').checked,
    fullscreenable: document.getElementById('fullscreenable').checked,
    kiosk: document.getElementById('kiosk').checked,
    saveState: document.getElementById('saveState').checked,
    frame: document.getElementById('frame').checked,
    center: document.getElementById('center').checked,

    // System
    trayIcon: document.getElementById('trayIcon').checked,
    minimizeToTray: document.getElementById('minimizeToTray').checked,
    singleInstance: document.getElementById('singleInstance').checked,
    devTools: document.getElementById('devTools').checked,
    userAgent: document.getElementById('userAgent').value,

    // Build
    iconPath: document.getElementById('iconPath').value,
    targetNsis: document.getElementById('targetNsis').checked,
    targetPortable: document.getElementById('targetPortable').checked,
    targetUnpacked: document.getElementById('targetUnpacked').checked,
  };

  if (!config.sourcePath) {
    log('Error: Please select a source folder.', 'error');
    return;
  }

  log('Starting generation process...', 'info');
  
  const result = await window.api.generateApp(config);
  
  if (result.success) {
    log('Configuration generated successfully!', 'success');
    log(`Files written to: ${config.sourcePath}`, 'success');
    log('-----------------------------------');
    log('INSTRUCTIONS TO BUILD:', 'info');
    log('1. Open a terminal in the source folder.');
    log('2. Run "npm install" to get Electron dependencies.');
    log('3. Run "npm run build" to create the executable.');
    log('-----------------------------------');
    log('A "build-app.bat" file has been created for your convenience.');
  } else {
    log(`Error: ${result.error}`, 'error');
  }
});