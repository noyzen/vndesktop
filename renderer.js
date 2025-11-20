
// View Elements
const viewManager = document.getElementById('view-manager');
const viewEditor = document.getElementById('view-editor');
const projectListEl = document.getElementById('projectList');

// Modals & Overlays
const successModal = document.getElementById('successModal');
const btnOpenDist = document.getElementById('btnOpenDist');
const btnCloseSuccess = document.getElementById('btnCloseSuccess');

// Navigation
const tabs = document.querySelectorAll('.nav-item');
const contents = document.querySelectorAll('.tab-content');
const headerTitle = document.getElementById('header-title');

// PHP Controls
const phpToggle = document.getElementById('enablePhp');
const phpPanel = document.getElementById('phpPanel');

// Data Mode Cards
const cardStatic = document.getElementById('card-static');
const cardWritable = document.getElementById('card-writable');

// State
let currentProjectPath = null;
let selectedExtensions = new Set(['curl', 'gd', 'mbstring', 'sqlite3', 'openssl', 'pdo_sqlite']);
let phpCache = {};

// --- UI HELPERS ---

function showManager() {
    viewEditor.classList.add('hidden');
    viewManager.classList.remove('hidden');
    currentProjectPath = null;
    renderProjectList();
}

function showEditor() {
    viewManager.classList.add('hidden');
    viewEditor.classList.remove('hidden');
}

function log(msg, type = 'info') {
    const consoleOutput = document.getElementById('consoleOutput');
    const div = document.createElement('div');
    div.className = `log-line log-${type}`;
    div.innerText = `> ${msg}`;
    consoleOutput.appendChild(div);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// --- PROJECT MANAGER ---

async function renderProjectList() {
    const projects = await window.api.getProjects();
    projectListEl.innerHTML = '';
    
    if(projects.length === 0) {
        projectListEl.innerHTML = `
            <div style="text-align:center; color:#555; padding:40px; background:rgba(255,255,255,0.02); border-radius:16px; border:2px dashed var(--border);">
                <i class="fa-solid fa-folder-open" style="font-size:2rem; margin-bottom:15px; opacity:0.5;"></i><br>
                No projects found.<br>Start something new!
            </div>`;
        return;
    }

    projects.forEach((p, idx) => {
        const el = document.createElement('div');
        el.className = 'project-card';
        if(idx === 0) el.classList.add('last-used');
        el.innerHTML = `
            <div class="project-info">
                <div style="color:white; font-weight:600; font-size:1.1rem;">${p.name}</div>
                <div style="color:#666; font-size:0.85rem; font-family:'Consolas', monospace; margin-top:4px;">${p.path}</div>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
                 <button class="btn-delete-project" title="Remove from List" onclick="deleteProject(event, ${p.id})">
                    <i class="fa-solid fa-trash"></i>
                 </button>
            </div>
        `;
        el.onclick = (e) => { if(!e.target.closest('button')) openProject(p.path); }
        projectListEl.appendChild(el);
    });
}

window.deleteProject = async (e, id) => {
    e.stopPropagation();
    if(confirm('Remove from recent list?')) {
        await window.api.removeProject(id);
        renderProjectList();
    }
};

document.getElementById('btnNewProject').onclick = async () => {
    const path = await window.api.selectFolder();
    if(path) {
        await window.api.addProject(path);
        openProject(path);
    }
};

// --- APP LOGIC ---

async function openProject(path) {
    currentProjectPath = path;
    const config = await window.api.loadProjectConfig(path);
    
    resetForm();
    document.getElementById('sourcePath').value = path;
    
    if(config) {
        populateForm(config);
        log(`Loaded project: ${config.appName}`);
    } else {
        // Defaults
        document.getElementById('productName').value = path.split(/[\\/]/).pop();
        document.getElementById('appName').value = 'com.myapp.' + Date.now();
        log('Initialized new project config');
    }
    
    showEditor();
}

document.getElementById('btnBackToProjects').onclick = async () => {
    await saveCurrentConfig();
    showManager();
};

document.getElementById('btnQuickSave').onclick = async () => {
    await saveCurrentConfig();
    log('Settings saved', 'success');
};

async function saveCurrentConfig() {
    if(!currentProjectPath) return;
    const config = getAppConfig();
    if(config) await window.api.saveProjectConfig(currentProjectPath, config);
}

// --- TABS & INTERACTIONS ---

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById(`tab-${target}`).classList.add('active');
        
        // Check Node when build tab opens
        if(target === 'build') checkNode();
    });
});

// PHP Logic
phpToggle.addEventListener('change', () => {
    phpPanel.style.display = phpToggle.checked ? 'block' : 'none';
    if(phpToggle.checked && !document.getElementById('phpPath').value) {
        // Try auto-fill from cache
        const ver = document.getElementById('phpVersionSelect').value;
        if(phpCache[ver]) document.getElementById('phpPath').value = phpCache[ver];
    }
});

// Data Mode Logic
function updateDataModeUI() {
    cardStatic.classList.remove('selected');
    cardWritable.classList.remove('selected');
    if(document.querySelector('input[name="dataMode"][value="static"]').checked) cardStatic.classList.add('selected');
    else cardWritable.classList.add('selected');
}
cardStatic.onclick = () => { cardStatic.querySelector('input').checked = true; updateDataModeUI(); };
cardWritable.onclick = () => { cardWritable.querySelector('input').checked = true; updateDataModeUI(); };

// PHP Extensions
function renderExtensions() {
    const grid = document.getElementById('extGrid');
    grid.innerHTML = '';
    const common = ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'openssl', 'pdo_sqlite', 'sqlite3', 'mysqli', 'pdo_mysql', 'soap'];
    
    common.forEach(ext => {
        const label = document.createElement('label');
        label.className = 'checkbox-card';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = selectedExtensions.has(ext);
        chk.onchange = () => { if(chk.checked) selectedExtensions.add(ext); else selectedExtensions.delete(ext); };
        
        // Custom styled checkbox elements
        const customCheck = document.createElement('span');
        customCheck.className = 'custom-check';
        
        const span = document.createElement('span');
        span.innerText = ext;
        
        label.appendChild(chk);
        label.appendChild(customCheck);
        label.appendChild(span);
        grid.appendChild(label);
    });
}

// --- FORM HANDLING ---

function resetForm() {
    document.getElementById('productName').value = 'My App';
    document.getElementById('appName').value = '';
    document.getElementById('appVersion').value = '1.0.0';
    document.getElementById('appAuthor').value = '';
    document.getElementById('entryPoint').value = 'index.html';
    document.getElementById('winWidth').value = 1280;
    document.getElementById('winHeight').value = 800;
    document.getElementById('phpPath').value = '';
    document.getElementById('enablePhp').checked = false;
    document.getElementById('targetNsis').checked = true;
    document.getElementById('targetPortable').checked = true;
    document.getElementById('targetUnpacked').checked = false;
    cardStatic.click();
    renderExtensions();
    phpToggle.dispatchEvent(new Event('change'));
}

function populateForm(c) {
    document.getElementById('productName').value = c.productName || '';
    document.getElementById('appName').value = c.appName || '';
    document.getElementById('appVersion').value = c.version || '1.0.0';
    document.getElementById('appAuthor').value = c.author || '';
    document.getElementById('entryPoint').value = c.entryPoint || 'index.html';
    document.getElementById('winWidth').value = c.width || 1280;
    document.getElementById('winHeight').value = c.height || 800;
    document.getElementById('minWidth').value = c.minWidth || 0;
    document.getElementById('minHeight').value = c.minHeight || 0;
    
    document.getElementById('resizable').checked = c.resizable;
    document.getElementById('fullscreenable').checked = c.fullscreenable;
    document.getElementById('center').checked = c.center;
    document.getElementById('saveState').checked = c.saveState;
    document.getElementById('kiosk').checked = c.kiosk;
    
    document.getElementById('enablePhp').checked = c.enablePhp;
    document.getElementById('phpPath').value = c.phpPath || '';
    document.getElementById('phpMemory').value = c.phpMemory || '256M';
    
    if(c.phpExtensions) selectedExtensions = new Set(c.phpExtensions);
    renderExtensions();
    
    // Tray / System
    document.getElementById('trayIcon').checked = c.trayIcon;
    document.getElementById('minimizeToTray').checked = c.minimizeToTray;
    document.getElementById('closeToTray').checked = c.closeToTray || false;
    document.getElementById('showTaskbar').checked = c.showTaskbar !== false; // default true
    
    document.getElementById('singleInstance').checked = c.singleInstance;
    document.getElementById('runBackground').checked = c.runBackground;
    document.getElementById('contextMenu').checked = c.contextMenu;
    document.getElementById('devTools').checked = c.devTools;
    document.getElementById('userAgent').value = c.userAgent || '';
    document.getElementById('iconPath').value = c.iconPath || '';
    
    document.getElementById('targetNsis').checked = c.targetNsis;
    document.getElementById('targetPortable').checked = c.targetPortable;
    document.getElementById('targetUnpacked').checked = c.targetUnpacked;
    
    if(c.dataMode === 'writable') cardWritable.click(); else cardStatic.click();
    
    phpToggle.dispatchEvent(new Event('change'));
}

function getAppConfig() {
    const phpPath = document.getElementById('phpPath').value;
    const usePhp = document.getElementById('enablePhp').checked;
    if(usePhp && !phpPath) { alert('PHP Path is required'); return null; }

    const extraExt = document.getElementById('extraExtensions').value.split(',').map(s => s.trim()).filter(s => s);

    return {
        sourcePath: document.getElementById('sourcePath').value,
        productName: document.getElementById('productName').value,
        appName: document.getElementById('appName').value,
        version: document.getElementById('appVersion').value,
        author: document.getElementById('appAuthor').value,
        entryPoint: document.getElementById('entryPoint').value,
        width: parseInt(document.getElementById('winWidth').value),
        height: parseInt(document.getElementById('winHeight').value),
        minWidth: parseInt(document.getElementById('minWidth').value) || 0,
        minHeight: parseInt(document.getElementById('minHeight').value) || 0,
        resizable: document.getElementById('resizable').checked,
        fullscreenable: document.getElementById('fullscreenable').checked,
        center: document.getElementById('center').checked,
        saveState: document.getElementById('saveState').checked,
        kiosk: document.getElementById('kiosk').checked,
        enablePhp: usePhp,
        phpPath: phpPath,
        phpMemory: document.getElementById('phpMemory').value,
        phpUpload: document.getElementById('phpUpload').value,
        phpTime: document.getElementById('phpTime').value,
        phpExtensions: [...selectedExtensions, ...extraExt],
        
        trayIcon: document.getElementById('trayIcon').checked,
        minimizeToTray: document.getElementById('minimizeToTray').checked,
        closeToTray: document.getElementById('closeToTray').checked,
        showTaskbar: document.getElementById('showTaskbar').checked,
        
        singleInstance: document.getElementById('singleInstance').checked,
        runBackground: document.getElementById('runBackground').checked,
        contextMenu: document.getElementById('contextMenu').checked,
        devTools: document.getElementById('devTools').checked,
        userAgent: document.getElementById('userAgent').value,
        iconPath: document.getElementById('iconPath').value,
        targetNsis: document.getElementById('targetNsis').checked,
        targetPortable: document.getElementById('targetPortable').checked,
        targetUnpacked: document.getElementById('targetUnpacked').checked,
        dataMode: document.querySelector('input[name="dataMode"]:checked').value,
        nativeFrame: true
    };
}

// --- BUILD PROCESS ---

const btnBuild = document.getElementById('btnBuildFull');

btnBuild.onclick = async () => {
    const config = getAppConfig();
    if(!config) return;
    
    await saveCurrentConfig();
    
    // 1. ACTIVATE ANIMATION (INTERNAL)
    btnBuild.classList.add('loading');
    
    try {
        log('Initializing Build Sequence...');
        
        const genRes = await window.api.generateApp(config);
        if(!genRes.success) throw new Error(genRes.error);
        
        log('Configuration Generated.');
        log('Starting Electron Builder...');
        
        const buildRes = await window.api.buildApp(config.sourcePath);
        
        // 2. DEACTIVATE ANIMATION
        btnBuild.classList.remove('loading');
        
        if(buildRes.success) {
            successModal.classList.add('active');
            // Set click handler for the success modal button
            btnOpenDist.onclick = () => window.api.openDistFolder(config.sourcePath);
        } else {
            alert('Build Failed. Check log.');
        }
    } catch (e) {
        btnBuild.classList.remove('loading');
        alert('Error: ' + e.message);
        log(e.message, 'error');
    }
};

// Close Modal
btnCloseSuccess.onclick = () => {
    successModal.classList.remove('active');
};

// --- AUXILIARY HANDLERS ---

// Node Check
async function checkNode() {
    const status = document.getElementById('nodeStatus');
    const res = await window.api.checkNode();
    if(!res.installed) status.style.display = 'block';
    else status.style.display = 'none';
}

document.getElementById('btnInstallNode').onclick = async () => {
    const btn = document.getElementById('btnInstallNode');
    btn.innerText = "Downloading...";
    await window.api.installNode();
    btn.innerText = "Install Engine";
    checkNode();
};

// File Picking
document.getElementById('btnSelectPhp').onclick = async () => {
    const p = await window.api.selectFolder();
    if(p) document.getElementById('phpPath').value = p;
};
document.getElementById('btnSelectIcon').onclick = async () => {
    const p = await window.api.selectFile(['ico','png','icns']);
    if(p) document.getElementById('iconPath').value = p;
};

// PHP Download
document.getElementById('btnDownloadPhp').onclick = async () => {
    const ver = document.getElementById('phpVersionSelect').value;
    const btn = document.getElementById('btnDownloadPhp');
    const originalHtml = btn.innerHTML;
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    
    const res = await window.api.downloadPhp(ver);
    btn.innerHTML = originalHtml;
    
    if(res.success) {
        phpCache = await window.api.getPhpCache();
        document.getElementById('phpPath').value = res.path;
    } else {
        alert(res.error);
    }
};

// Listen for build logs
window.api.onDownloadProgress((data) => {
    if(data.type === 'build-log') {
        log(data.msg, data.error ? 'error' : 'info');
    }
});

// Init
renderProjectList();
window.api.getPhpCache().then(c => phpCache = c);
