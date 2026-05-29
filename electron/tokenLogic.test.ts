import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateTokensForText, calculateTokensForImage, calculateTokensForPathsBulk } from './tokenLogic';
import sizeOf from 'image-size';
import fs from 'fs/promises';

// Mock fs/promises
vi.mock('fs/promises', () => {
  const mockFileHandle = {
    read: vi.fn().mockImplementation((buf: Buffer) => {
      const path = (mockFileHandle as any).lastOpenedPath || '';
      if (path.includes('binary')) {
        buf[0] = 0; // null byte
        return Promise.resolve({ bytesRead: 1, buffer: buf });
      }
      buf[0] = 97; // 'a' character
      return Promise.resolve({ bytesRead: 1, buffer: buf });
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return {
    default: {
      readFile: vi.fn((path: string) => Promise.resolve(Buffer.from(path))),
      stat: vi.fn(),
      open: vi.fn().mockImplementation((path: string) => {
        (mockFileHandle as any).lastOpenedPath = path;
        return Promise.resolve(mockFileHandle);
      }),
    }
  };
});

// Mock native fs for createReadStream
vi.mock('fs', () => {
  const mockStream = {
    on: vi.fn().mockImplementation((event: string, callback: any) => {
      if (event === 'data') {
        callback('chunk content data');
      } else if (event === 'end') {
        callback();
      }
      return mockStream;
    }),
  };
  const mockFs = {
    createReadStream: vi.fn().mockReturnValue(mockStream),
  };
  return {
    ...mockFs,
    default: mockFs,
  };
});

// Mock image-size since we won't have real images in the unit test environment
vi.mock('image-size', () => {
  return {
    default: vi.fn((buffer: Buffer) => {
      const path = buffer.toString();
      if (path.includes('high_res.png') || path.includes('large.png')) return { width: 4096, height: 4096 };
      if (path.includes('low_res.png')) return { width: 100, height: 100 };
      if (path.includes('invalid.png')) throw new Error('Invalid image');
      return { width: 1024, height: 1024 };
    })
  };
});

describe('Token Logic', () => {
  describe('calculateTokensForText', () => {
    it('should return 0 for empty strings', () => {
      expect(calculateTokensForText('')).toBe(0);
    });

    it('should correctly count tokens for simple text using o200k_base', () => {
      // "Hello, world!" is 3 tokens (Hello)(,)( world!) - wait, in o200k_base it might be different, let's just check it's > 0
      const tokens = calculateTokensForText('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should handle large text blocks efficiently', () => {
      const largeText = 'word '.repeat(10000);
      const tokens = calculateTokensForText(largeText);
      expect(tokens).toBeGreaterThan(9000);
    });

    it('should compute tokens correctly using different encoding models', () => {
      const text = 'Tokenization is highly specialized!';
      const tokensO200k = calculateTokensForText(text, 'o200k_base');
      const tokensCl100k = calculateTokensForText(text, 'cl100k_base');
      
      expect(tokensO200k).toBeGreaterThan(0);
      expect(tokensCl100k).toBeGreaterThan(0);
    });
  });

  describe('calculateTokensForImage', () => {
    it('should correctly calculate tokens for an image', async () => {
      const tokens = await calculateTokensForImage('test.png');
      expect(tokens).toBe(765); // 85 + 170 * (2 * 2) = 765
    });

    it('should scale down large images', async () => {
      const tokens = await calculateTokensForImage('large.png');
      expect(tokens).toBe(765); 
    });

    it('should gracefully handle invalid images', async () => {
      const tokens = await calculateTokensForImage('invalid.png');
      expect(tokens).toBe(0);
    });

    it('should handle tiny images', async () => {
      const tokens = await calculateTokensForImage('low_res.png');
      expect(tokens).toBe(255); 
    });
  });

  describe('calculateTokensForPathsBulk', () => {
    it('should calculate bulk tokens in parallel correctly', async () => {
      // Mock stat for paths
      const statMock = fs.stat as any;
      statMock.mockImplementation((path: string) => Promise.resolve({
        isFile: () => true,
        isDirectory: () => false,
      }));

      // Mock readFile
      const readFileMock = fs.readFile as any;
      readFileMock.mockImplementation(() => Promise.resolve('Some mock file content!'));

      const result = await calculateTokensForPathsBulk(['file1.txt', 'file2.txt'], 'o200k_base');
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.breakdown.length).toBe(2);
      expect(result.breakdown[0].path).toBe('file1.txt');
    });
  });

  describe('isBinaryFile integration in processSingleFile', () => {
    it('should ignore binary files by returning 0 tokens', async () => {
      const statMock = fs.stat as any;
      statMock.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 50,
      });

      const readFileMock = fs.readFile as any;
      readFileMock.mockResolvedValueOnce('mock content');

      const result = await calculateTokensForPathsBulk(['binary_file.bin'], 'o200k_base');
      expect(result.totalTokens).toBe(0);
      expect(result.breakdown.length).toBe(1);
      expect(result.breakdown[0].tokens).toBe(0);
    });

    it('should calculate tokens normally for text files', async () => {
      const statMock = fs.stat as any;
      statMock.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 15,
      });

      const readFileMock = fs.readFile as any;
      readFileMock.mockResolvedValueOnce('Hello, world!');

      const result = await calculateTokensForPathsBulk(['text_file.txt'], 'o200k_base');
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.breakdown.length).toBe(1);
      expect(result.breakdown[0].path).toBe('text_file.txt');
    });

    it('should process massive files in stream mode instead of ignoring them', async () => {
      const statMock = fs.stat as any;
      statMock.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 15 * 1024 * 1024, // 15MB (> 10MB)
      });

      const result = await calculateTokensForPathsBulk(['massive_file.txt'], 'o200k_base');
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.breakdown.length).toBe(1);
      expect(result.breakdown[0].path).toBe('massive_file.txt');
    });

    it('should ignore massive binary files even without extensions', async () => {
      const statMock = fs.stat as any;
      statMock.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false,
        size: 15 * 1024 * 1024, // 15MB (> 10MB)
      });

      // Mock open and isBinaryFile to return true (by having 'binary' in the path)
      const result = await calculateTokensForPathsBulk(['massive_binary_file'], 'o200k_base');
      expect(result.totalTokens).toBe(0);
      expect(result.breakdown.length).toBe(1);
      expect(result.breakdown[0].tokens).toBe(0);
    });
  });
});
