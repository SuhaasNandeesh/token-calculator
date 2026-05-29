import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

let lastDroppedPaths: string[] = [];
let dropCallback: ((paths: string[]) => void) | null = null;
let hoverCallback: ((isHovering: boolean) => void) | null = null;

// Setup global drag-drop listener via Tauri native window event
try {
  const appWindow = getCurrentWebviewWindow();
  appWindow.onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      lastDroppedPaths = event.payload.paths;
      if (dropCallback) {
        dropCallback(event.payload.paths);
      }
    } else if (event.payload.type === 'enter' || event.payload.type === 'over') {
      if (hoverCallback) {
        hoverCallback(true);
      }
    } else if (event.payload.type === 'leave') {
      if (hoverCallback) {
        hoverCallback(false);
      }
    }
  });
} catch (err) {
  console.error("Failed to register Tauri native drag-drop event", err);
}

// Expose the mock electronAPI bridge to Tauri v2 backend commands
(window as any).electronAPI = {
  calculateTextTokens: async (text: string, encoding?: string) => {
    return await invoke('calculate_text_tokens', { text, encoding });
  },
  calculatePathTokens: async (targetPath: string, encoding?: string) => {
    return await invoke('calculate_path_tokens', { targetPath, encoding });
  },
  calculatePathsTokensBulk: async (targetPaths: string[], encoding?: string) => {
    return await invoke('calculate_paths_tokens_bulk', { targetPaths, encoding });
  },
  selectPaths: async () => {
    return await invoke('select_paths');
  },
  selectFolders: async () => {
    return await invoke('select_folders');
  },
  onTauriDrop: (callback: (paths: string[]) => void) => {
    dropCallback = callback;
    return () => {
      dropCallback = null;
    };
  },
  onTauriHover: (callback: (isHovering: boolean) => void) => {
    hoverCallback = callback;
    return () => {
      hoverCallback = null;
    };
  },
  getLastDroppedPaths: () => {
    const paths = [...lastDroppedPaths];
    lastDroppedPaths = []; // consume
    return paths;
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
