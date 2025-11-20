const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (extensions) => ipcRenderer.invoke('select-file', extensions),
  generateApp: (config) => ipcRenderer.invoke('generate-app', config),
  downloadPhp: (version) => ipcRenderer.invoke('download-php', version),
  // New listener for download progress
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_event, value) => callback(value))
});

contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});