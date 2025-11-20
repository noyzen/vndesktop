
window.addEventListener('DOMContentLoaded', () => {
  const infoElement = document.getElementById('info');

  const nodeVersion = window.versions.node();
  const chromeVersion = window.versions.chrome();
  const electronVersion = window.versions.electron();

  infoElement.innerText = `Node.js: ${nodeVersion} | Chromium: ${chromeVersion} | Electron: ${electronVersion}`;
});
