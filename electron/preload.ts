import { contextBridge, ipcRenderer, webUtils } from 'electron';

let lastDroppedPaths: string[] = [];

// Intercept drop events globally at the capture phase to preserve absolute file paths in the preload context
window.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files) {
    const files = Array.from(e.dataTransfer.files);
    lastDroppedPaths = files.map(f => {
      try {
        return webUtils.getPathForFile(f);
      } catch (err) {
        console.error('Failed to get absolute path for dropped file:', err);
        return '';
      }
    }).filter(Boolean);
  }
}, true);

contextBridge.exposeInMainWorld('electronAPI', {
  calculateTextTokens: (text: string, encoding?: string) => ipcRenderer.invoke('calculate-text-tokens', text, encoding),
  calculatePathTokens: (targetPath: string, encoding?: string) => ipcRenderer.invoke('calculate-path-tokens', targetPath, encoding),
  calculatePathsTokensBulk: (targetPaths: string[], encoding?: string) => ipcRenderer.invoke('calculate-paths-tokens-bulk', targetPaths, encoding),
  selectPaths: () => ipcRenderer.invoke('select-paths'),
  onScanProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('scan-progress', (event, data) => callback(data));
  },
  getLastDroppedPaths: () => {
    const paths = [...lastDroppedPaths];
    lastDroppedPaths = []; // consume
    return paths;
  }
});
