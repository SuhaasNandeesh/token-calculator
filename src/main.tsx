import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { invoke } from '@tauri-apps/api/core';

interface ElectronAPI {
  calculateTextTokens: (text: string, encoding?: string) => Promise<number>;
  calculatePathTokens: (targetPath: string, encoding?: string) => Promise<number>;
  calculatePathsTokensBulk: (targetPaths: string[], encoding?: string) => Promise<unknown>;
  selectPaths: () => Promise<string[]>;
  selectFolders: () => Promise<string[]>;
  onTauriDrop: (callback: (paths: string[]) => void) => () => void;
  onTauriHover: (callback: (isHovering: boolean) => void) => () => void;
  getLastDroppedPaths: () => string[];
  cancelCalculation: () => Promise<void>;
}

// Expose the mock electronAPI bridge to Tauri v2 backend commands
(window as unknown as { electronAPI: ElectronAPI }).electronAPI = {
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
  onTauriDrop: () => {
    return () => {};
  },
  onTauriHover: () => {
    return () => {};
  },
  getLastDroppedPaths: () => {
    return [];
  },
  cancelCalculation: async () => {
    return await invoke('cancel_calculation');
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
