import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

let lastDroppedPaths: string[] = [];

// Setup global drag-drop listener via Tauri native window event
try {
  const appWindow = getCurrentWebviewWindow();
  appWindow.onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      lastDroppedPaths = event.payload.paths;
      
      // Dispatch a mock standard browser drop event to trigger App.tsx drop zone callbacks automatically!
      const mockEvent = new CustomEvent('drop');
      window.dispatchEvent(mockEvent);
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
