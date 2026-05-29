import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';

// Mock electron API
const mockCalculatePathTokens = vi.fn();
const mockCalculatePathsTokensBulk = vi.fn(() => Promise.resolve({ totalTokens: 100, breakdown: [{ path: 'test-file.js', tokens: 100 }] }));

let registeredHoverCallback: ((isHovering: boolean) => void) | null = null;

beforeEach(() => {
  mockCalculatePathTokens.mockReset();
  mockCalculatePathsTokensBulk.mockReset();
  mockCalculatePathsTokensBulk.mockImplementation(() => Promise.resolve({ totalTokens: 100, breakdown: [{ path: 'test-file.js', tokens: 100 }] }));
  registeredHoverCallback = null;
  const g = globalThis as unknown as { window?: { electronAPI?: unknown } };
  g.window = g.window || {};
  g.window.electronAPI = {
    calculatePathTokens: mockCalculatePathTokens,
    calculatePathsTokensBulk: mockCalculatePathsTokensBulk,
    onScanProgress: vi.fn(),
    selectPaths: vi.fn(() => Promise.resolve([])),
    onTauriHover: vi.fn((cb) => {
      registeredHoverCallback = cb;
      return () => { registeredHoverCallback = null; };
    }),
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

  it('updates UI on drag enter and leave', () => {
    render(<App />);
    const dragOverlay = screen.getByTestId('drag-overlay');
    expect(dragOverlay.className).toContain('opacity-0');
    
    // Simulate Tauri native drag enter
    act(() => {
      if (registeredHoverCallback) {
        registeredHoverCallback(true);
      }
    });
    expect(dragOverlay.className).toContain('opacity-100');
    
    // Simulate Tauri native drag leave
    act(() => {
      if (registeredHoverCallback) {
        registeredHoverCallback(false);
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
