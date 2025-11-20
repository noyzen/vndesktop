
// View Elements
const viewManager = document.getElementById('view-manager');
const viewEditor = document.getElementById('view-editor');
const projectListEl = document.getElementById('projectList');

// PM UI
const btnNewProject = document.getElementById('btnNewProject');
const nodeInstallContainer = document.getElementById('nodeInstallContainer');
const btnInstallNodeManager = document.getElementById('btnInstallNodeManager');
const installProgress = document.getElementById('installProgress');
const installProgressFill = document.getElementById('installProgressFill');
const installProgressText = document.getElementById('installProgressText');

// Modals & Overlays
const successModal = document.getElementById('successModal');
const btnOpenDist = document.getElementById('btnOpenDist');
const btnCloseSuccess = document.getElementById('btnCloseSuccess');

// Navigation
const tabs = document.querySelectorAll('.nav-item');
const contents = document.querySelectorAll('.tab-content');

// PHP Controls
const phpToggle = document.getElementById('enablePhp');
const phpPanel = document.getElementById('phpPanel');
const extGrid = document.getElementById('extGrid');
const extSearch = document.getElementById('extSearch');

// Data Mode Cards
const cardStatic = document.getElementById('card-static');
const cardWritable = document.getElementById('card-writable');

// State
let currentProjectPath = null;
let selectedExtensions = new Set(['php_curl.dll', 'php_gd.dll', 'php_mbstring.dll', 'php_sqlite3.dll', 'php_openssl.dll', 'php_pdo_sqlite.dll']);
let availableExtensions = []; 
let phpCache = {};

// --- UI HELPERS ---

function showManager() {
    viewEditor.classList.add('hidden');
    viewManager.classList.remove('hidden');
    currentProjectPath = null;
    
    // Re-run checks every time we return to manager
    checkSystemRequirements();
}

function showEditor() {
    viewManager.classList.add('hidden');
    viewEditor.classList.remove('hidden');
}

function log(msg, type = 'info') {
    const consoleOutput = document.getElementById('consoleOutput');
    const div = document.createElement('div');
    div.className = `log-line log-${type}`;
    // Strip potential ANSI colors if any leak through
    div.innerText = `> ${msg.replace(/\x1B\[\d+m/g, '')}`;
    consoleOutput.appendChild(div);
    
    // Smooth scroll to bottom
    setTimeout(() => {
        consoleOutput.scrollTo({ top: consoleOutput.scrollHeight, behavior: 'smooth' });
    }, 50);
}

document.getElementById('btnCopyLog').onclick = async () => {
    const text = document.getElementById('consoleOutput').innerText;
    await window.api.copyToClipboard(text);
    const btn = document.getElementById('btnCopyLog');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    setTimeout(() => { btn.innerHTML = original; }, 1500);
};

// --- STARTUP & DEPENDENCY CHECK ---

async function checkSystemRequirements() {
    // Warm up cache silently
    window.api.getPhpCache().then(c => phpCache = c);
    
    // Check Node
    const nodeCheck = await window.api.checkNode();
    
    if(nodeCheck.installed) {
        // System Ready
        btnNewProject.style.display = 'flex';
        nodeInstallContainer.style.display = 'none';
        projectListEl.classList.remove('disabled-area');
        renderProjectList();
    } else {
        // System Missing Node
        btnNewProject.style.display = 'none';
        nodeInstallContainer.style.display = 'flex';
        projectListEl.classList.add('disabled-area');
        renderProjectList(); // Render list but visualy disabled
    }
}

btnInstallNodeManager.onclick = async () => {
    btnInstallNodeManager.style.display = 'none';
    installProgress.style.display = 'block';
    
    const result = await window.api.installNode();
    
    if(result.success) {
        installProgressText.innerText = 'Installation Complete!';
        setTimeout(() => {
            installProgress.style.display = 'none';
            btnInstallNodeManager.style.display = 'inline-flex';
            checkSystemRequirements();
        }, 1000);
    } else {
        installProgress.style.display = 'none';
        btnInstallNodeManager.style.display = 'inline-flex';
        alert("Installation Failed: " + result.error);
    }
};

window.api.onDownloadProgress((data) => {
    if(data.type === 'build-log') {
        log(data.msg, data.error ? 'error' : 'info');
        return;
    }
    // Install Progress
    if(!viewManager.classList.contains('hidden')) {
        const p = Math.round(data.percent);
        installProgressFill.style.width = `${p}%`;
        installProgressText.innerText = data.status || `${p}%`;
    }
});

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

    const trashIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" style="width:14px;height:14px;fill:currentColor;"><path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>`;

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
                    ${trashIconSvg}
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
        document.getElementById('productName').value = 'VisualNEO Desk Project';
        document.getElementById('appName').value = 'com.visualneodesk.' + Date.now();
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
        
        if(target === 'build') checkNode();
        if(target === 'php' && document.getElementById('enablePhp').checked) loadExtensions(); 
    });
});

phpToggle.addEventListener('change', () => {
    const isEnabled = phpToggle.checked;
    phpPanel.style.display = isEnabled ? 'block' : 'none';
    if(isEnabled) {
        if(!document.getElementById('phpPath').value) {
            const ver = document.getElementById('phpVersionSelect').value;
            if(phpCache[ver]) document.getElementById('phpPath').value = phpCache[ver];
        }
        loadExtensions();
    }
});

function updateDataModeUI() {
    cardStatic.classList.remove('selected');
    cardWritable.classList.remove('selected');
    if(document.querySelector('input[name="dataMode"][value="static"]').checked) cardStatic.classList.add('selected');
    else cardWritable.classList.add('selected');
}
cardStatic.onclick = () => { cardStatic.querySelector('input').checked = true; updateDataModeUI(); };
cardWritable.onclick = () => { cardWritable.querySelector('input').checked = true; updateDataModeUI(); };

// --- EXTENSION MANAGER ---

async function loadExtensions() {
    const phpPath = document.getElementById('phpPath').value;
    const loader = document.getElementById('extLoader');
    const error = document.getElementById('extError');
    
    extGrid.innerHTML = '';
    error.style.display = 'none';

    if(!phpPath) {
        error.innerText = "PHP Path not selected.";
        error.style.display = 'block';
        return;
    }

    loader.style.display = 'block';
    availableExtensions = await window.api.getPhpExtensions(phpPath);
    loader.style.display = 'none';
    
    if(!availableExtensions || availableExtensions.length === 0) {
        error.innerText = "No extensions found in 'ext' folder. Is this a valid PHP directory?";
        error.style.display = 'block';
    } else {
        renderExtensions();
    }
}

function renderExtensions() {
    extGrid.innerHTML = '';
    const filter = extSearch.value.toLowerCase();
    
    availableExtensions.forEach(ext => {
        if(filter && !ext.name.toLowerCase().includes(filter)) return;
        const label = document.createElement('label');
        label.className = 'checkbox-card';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = selectedExtensions.has(ext.file);
        chk.onchange = () => { if(chk.checked) selectedExtensions.add(ext.file); else selectedExtensions.delete(ext.file); };
        const customCheck = document.createElement('span');
        customCheck.className = 'custom-check';
        const span = document.createElement('span');
        span.innerText = ext.name; 
        span.title = ext.file; 
        label.appendChild(chk);
        label.appendChild(customCheck);
        label.appendChild(span);
        extGrid.appendChild(label);
    });
}

extSearch.addEventListener('input', renderExtensions);

document.getElementById('btnAddExt').onclick = async () => {
    const phpPath = document.getElementById('phpPath').value;
    if(!phpPath) { alert("Please select a PHP folder first."); return; }
    const file = await window.api.selectFile(['dll']);
    if(file) {
        const res = await window.api.addPhpExtension(phpPath, file);
        if(res.success) { await loadExtensions(); alert("Extension installed successfully!"); } 
        else { alert("Failed to install extension: " + res.error); }
    }
};

// --- FORM HANDLING ---

function resetForm() {
    document.getElementById('productName').value = 'VisualNEO Desk Project';
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
    document.getElementById('phpTimezone').value = 'UTC';
    document.getElementById('phpOpcache').checked = true;
    document.getElementById('phpDisplayErrors').checked = false;
    cardStatic.click();
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
    document.getElementById('phpUpload').value = c.phpUpload || '64M';
    document.getElementById('phpTime').value = c.phpTime || '120';
    document.getElementById('phpTimezone').value = c.phpTimezone || 'UTC';
    document.getElementById('phpOpcache').checked = c.phpOpcache !== false; 
    document.getElementById('phpDisplayErrors').checked = c.phpDisplayErrors || false;
    if(c.phpExtensions) selectedExtensions = new Set(c.phpExtensions);
    document.getElementById('trayIcon').checked = c.trayIcon;
    document.getElementById('minimizeToTray').checked = c.minimizeToTray;
    document.getElementById('closeToTray').checked = c.closeToTray || false;
    document.getElementById('showTaskbar').checked = c.showTaskbar !== false; 
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
    return {
        sourcePath: document.getElementById('sourcePath').value,
        productName: document.getElementById('productName').value || "My App",
        appName: document.getElementById('appName').value || "com.myapp." + Date.now(),
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
        enablePhp: usePhp, phpPath: phpPath,
        phpMemory: document.getElementById('phpMemory').value,
        phpUpload: document.getElementById('phpUpload').value,
        phpTime: document.getElementById('phpTime').value,
        phpTimezone: document.getElementById('phpTimezone').value,
        phpOpcache: document.getElementById('phpOpcache').checked,
        phpDisplayErrors: document.getElementById('phpDisplayErrors').checked,
        phpExtensions: [...selectedExtensions],
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
    btnBuild.classList.add('loading');
    document.getElementById('consoleOutput').innerHTML = '<div class="log-line">> Initializing...</div>';
    try {
        log('Initializing Build Sequence...');
        const genRes = await window.api.generateApp(config);
        if(!genRes.success) {
            if (genRes.error === 'MISSING_ICON') {
                alert("Icon Missing!\n\nPlease select an .ico or .png file.");
                document.querySelector('[data-tab="build"]').click();
                const btn = document.getElementById('btnSelectIcon');
                btn.style.borderColor = 'red'; btn.style.boxShadow = '0 0 10px red';
                setTimeout(() => { btn.style.borderColor = ''; btn.style.boxShadow = ''; }, 2000);
                btnBuild.classList.remove('loading'); return;
            }
            throw new Error(genRes.error);
        }
        log('Configuration Generated.');
        log('Starting Electron Builder...');
        const buildRes = await window.api.buildApp(config.sourcePath);
        btnBuild.classList.remove('loading');
        if(buildRes.success) {
            successModal.classList.add('active');
            btnOpenDist.onclick = () => window.api.openDistFolder(config.sourcePath);
        } else { 
            log('Build Failed. Please check the error above.', 'error'); 
            alert('Build Process Failed. See console log for details.');
        }
    } catch (e) {
        btnBuild.classList.remove('loading');
        alert('Error: ' + e.message);
        log(e.message, 'error');
    }
};

btnCloseSuccess.onclick = () => { successModal.classList.remove('active'); };

// --- AUXILIARY HANDLERS ---

async function checkNode() {
    const status = document.getElementById('nodeStatus');
    const res = await window.api.checkNode();
    if(!res.installed) status.style.display = 'block';
    else status.style.display = 'none';
    return res;
}

document.getElementById('btnInstallNode').onclick = async () => {
    const btn = document.getElementById('btnInstallNode');
    btn.innerText = "Downloading...";
    await window.api.installNode();
    btn.innerText = "Install Engine";
    checkNode();
};

document.getElementById('btnSelectPhp').onclick = async () => {
    const p = await window.api.selectFolder();
    if(p) { 
        document.getElementById('phpPath').value = p; 
        loadExtensions(); 
    }
};
document.getElementById('btnSelectIcon').onclick = async () => {
    const p = await window.api.selectFile(['ico','png','icns']);
    if(p) document.getElementById('iconPath').value = p;
};

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
        loadExtensions();
        alert(`PHP ${ver} downloaded!`);
    } else { alert(res.error); }
};

// Startup
showManager();
    