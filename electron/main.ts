import { app, BrowserWindow, globalShortcut, ipcMain, clipboard, Notification, dialog } from 'electron';
import path from 'path';
import { calculateTokensForText, calculateTokensForPath, calculateTokensForPathsBulk } from './tokenLogic';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

let mainWindow: BrowserWindow | null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    titleBarStyle: 'hiddenInset',
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Global Shortcut for Tokenizing Selected Text
  globalShortcut.register('CommandOrControl+Option+T', async () => {
    try {
      // Save current clipboard
      const previousClipboard = clipboard.readText();

      // Trigger Cmd+C to copy selected text via AppleScript (macOS only)
      if (process.platform === 'darwin') {
        await execPromise(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`);
        // Wait a bit for the clipboard to update
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        // Fallback for Windows/Linux - might require external tools like robotjs or xclip
        // We will just read whatever is currently in clipboard for now
      }

      const selectedText = clipboard.readText();
      
      if (selectedText && selectedText !== previousClipboard) {
        const tokens = calculateTokensForText(selectedText);
        new Notification({
          title: 'Token Calculator',
          body: `Selected text is ${tokens.toLocaleString()} tokens.`
        }).show();
        
        // Restore clipboard
        clipboard.writeText(previousClipboard);
      } else if (selectedText === previousClipboard && selectedText) {
        // Same text or nothing new copied
        const tokens = calculateTokensForText(selectedText);
        new Notification({
          title: 'Token Calculator',
          body: `Clipboard is ${tokens.toLocaleString()} tokens.`
        }).show();
      }

    } catch (err) {
      console.error('Failed to get selected text', err);
    }
  });

  setupIpc();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

function setupIpc() {
  ipcMain.handle('calculate-text-tokens', (event, text: string, encoding?: string) => {
    return calculateTokensForText(text, encoding);
  });

  ipcMain.handle('calculate-path-tokens', async (event, targetPath: string, encoding?: string) => {
    return await calculateTokensForPath(targetPath, encoding);
  });

  ipcMain.handle('calculate-paths-tokens-bulk', async (event, targetPaths: string[], encoding?: string) => {
    return await calculateTokensForPathsBulk(targetPaths, encoding);
  });

  ipcMain.handle('select-paths', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Files or Folders',
      buttonLabel: 'Select',
      properties: ['openFile', 'openDirectory', 'multiSelections']
    });
    if (result.canceled) return [];
    return result.filePaths;
  });
}
