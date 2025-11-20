
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (extensions) => ipcRenderer.invoke('select-file', extensions),
  generateApp: (config) => ipcRenderer.invoke('generate-app', config),
  downloadPhp: (version) => ipcRenderer.invoke('download-php', version),
  buildApp: (targetPath) => ipcRenderer.invoke('build-app', targetPath),
  getPhpCache: () => ipcRenderer.invoke('get-php-cache'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openDistFolder: (path) => ipcRenderer.invoke('open-dist-folder', path),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_event, value) => callback(value)),
  
  // Project Manager
  getProjects: () => ipcRenderer.invoke('get-projects'),
  addProject: (path) => ipcRenderer.invoke('add-project', path),
  removeProject: (id) => ipcRenderer.invoke('remove-project', id),
  loadProjectConfig: (path) => ipcRenderer.invoke('load-project-config', path),
  saveProjectConfig: (path, config) => ipcRenderer.invoke('save-project-config', { folderPath: path, config }),

  // PHP Manager
  getPhpExtensions: (phpPath) => ipcRenderer.invoke('get-php-extensions', phpPath),
  addPhpExtension: (phpPath, filePath) => ipcRenderer.invoke('add-php-extension', { phpPath, filePath }),

  // Node.js Manager
  checkNode: () => ipcRenderer.invoke('check-node-install'),
  installNode: () => ipcRenderer.invoke('install-node')
});

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});