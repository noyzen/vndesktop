
const { contextBridge } = require('electron');

// Expose protected methods that allow the renderer process to use
// the Node.js process.versions API without exposing the entire object.
contextBridge.exposeInMainWorld('versions', {
  node: () => process.versions.node,
  chrome: () => process.versions.chrome,
  electron: () => process.versions.electron,
});
