import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';

// Mock electron API
const mockCalculatePathTokens = vi.fn();
const mockCalculatePathsTokensBulk = vi.fn(() => Promise.resolve({ totalTokens: 100, breakdown: [{ path: 'test-file.js', tokens: 100 }] }));

let registeredHoverEnterCallback: ((event: { payload: unknown }) => void) | null = null;
let registeredHoverLeaveCallback: ((event: { payload: unknown }) => void) | null = null;

vi.mock('@tauri-apps/api/webviewWindow', () => {
  return {
    getCurrentWebviewWindow: () => {
      return {
        listen: vi.fn((eventName: string, callback: (event: { payload: unknown }) => void) => {
          if (eventName === 'tauri://drag-enter') {
            registeredHoverEnterCallback = callback;
          } else if (eventName === 'tauri://drag-leave') {
            registeredHoverLeaveCallback = callback;
          }
          return Promise.resolve(() => {});
        })
      };
    }
  };
});

beforeEach(() => {
  mockCalculatePathTokens.mockReset();
  mockCalculatePathsTokensBulk.mockReset();
  mockCalculatePathsTokensBulk.mockImplementation(() => Promise.resolve({ totalTokens: 100, breakdown: [{ path: 'test-file.js', tokens: 100 }] }));
  registeredHoverEnterCallback = null;
  registeredHoverLeaveCallback = null;
  const g = globalThis as unknown as { window?: { electronAPI?: unknown } };
  g.window = g.window || {};
  g.window.electronAPI = {
    calculatePathTokens: mockCalculatePathTokens,
    calculatePathsTokensBulk: mockCalculatePathsTokensBulk,
    onScanProgress: vi.fn(),
    selectPaths: vi.fn(() => Promise.resolve([])),
    onTauriHover: vi.fn(),
    onTauriDrop: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
});

describe('App UI', () => {
  it('renders initial state correctly', () => {
    render(<App />);
    expect(screen.getByText('Token Calculator')).toBeTruthy();
    expect(screen.getByText('Drag & Drop files or folders here')).toBeTruthy();
  });

  it('updates UI on drag enter and leave', async () => {
    render(<App />);
    
    // Wait for async effect to resolve dynamic imports
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const dragOverlay = screen.getByTestId('drag-overlay');
    expect(dragOverlay.className).toContain('opacity-0');
    
    // Simulate Tauri native drag enter
    act(() => {
      if (registeredHoverEnterCallback) {
        registeredHoverEnterCallback({ payload: {} });
      }
    });
    expect(dragOverlay.className).toContain('opacity-100');
    
    // Simulate Tauri native drag leave
    act(() => {
      if (registeredHoverLeaveCallback) {
        registeredHoverLeaveCallback({ payload: {} });
      }
    });
    expect(dragOverlay.className).toContain('opacity-0');
  });

  it('updates selected engine when a dropdown option is clicked', async () => {
    render(<App />);
    
    // Find and click the dropdown toggle button
    const toggleButton = screen.getByText('o200k_base');
    expect(toggleButton).toBeTruthy();
    fireEvent.click(toggleButton);
    
    // Find the option for cl100k_base inside the opened dropdown menu
    const optionCl100k = screen.getByText('GPT-4 / GPT-3.5 (cl100k_base)');
    expect(optionCl100k).toBeTruthy();
    
    // Click the option
    fireEvent.click(optionCl100k);
    
    // Verify the toggle button now displays the selected engine cl100k_base
    expect(screen.getByText('cl100k_base')).toBeTruthy();
  });
});
