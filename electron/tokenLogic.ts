import { get_encoding, Tiktoken, TiktokenEncoding } from 'tiktoken';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import sizeOf from 'image-size';
import fg from 'fast-glob';

// Cache encoders to avoid memory leaks and slow re-initializations
const encoders: Record<string, Tiktoken> = {};

function getEncoder(encodingName: TiktokenEncoding): Tiktoken {
  if (!encoders[encodingName]) {
    try {
      encoders[encodingName] = get_encoding(encodingName);
    } catch (err) {
      console.warn(`Failed to load encoding ${encodingName}, falling back to o200k_base`, err);
      if (!encoders['o200k_base']) {
        encoders['o200k_base'] = get_encoding('o200k_base');
      }
      return encoders['o200k_base'];
    }
  }
  return encoders[encodingName];
}

export function calculateTokensForText(text: string, encoding: string = 'o200k_base'): number {
  if (!text) return 0;
  const enc = getEncoder(encoding as TiktokenEncoding);
  return enc.encode(text).length;
}

export async function calculateTokensForImage(imagePath: string): Promise<number> {
  try {
    const buffer = await fs.readFile(imagePath);
    const dimensions = sizeOf(buffer);
    if (!dimensions || !dimensions.width || !dimensions.height) return 0;

    const width = dimensions.width;
    const height = dimensions.height;

    // OpenAI Vision formula
    // 1. Scale down to fit within 2048x2048
    let w = width;
    let h = height;
    
    if (w > 2048 || h > 2048) {
      const ratio = Math.min(2048 / w, 2048 / h);
      w = w * ratio;
      h = h * ratio;
    }

    // 2. Scale such that the shortest side is 768
    const shortestSide = Math.min(w, h);
    if (shortestSide > 768) {
      const ratio = 768 / shortestSide;
      w = w * ratio;
      h = h * ratio;
    }

    // 3. Count 512x512 tiles
    const tilesW = Math.ceil(w / 512);
    const tilesH = Math.ceil(h / 512);
    const totalTiles = tilesW * tilesH;

    return 85 + (170 * totalTiles);
  } catch (error) {
    console.error(`Error calculating image tokens for ${imagePath}:`, error);
    return 0; // Likely unsupported image format or corrupted
  }
}

// Simple, zero-dependency concurrency-limiting parallel batch runner
async function pLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      const item = items[currentIndex];
      results[currentIndex] = await fn(item);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function calculateTokensForPath(
  targetPath: string,
  encoding: string = 'o200k_base'
): Promise<{ totalTokens: number, breakdown: { path: string, tokens: number }[] }> {
  try {
    const stat = await fs.stat(targetPath);
    let breakdown: { path: string, tokens: number }[] = [];
    let totalTokens = 0;

    if (stat.isFile()) {
      const tokens = await processSingleFile(targetPath, encoding);
      breakdown.push({ path: targetPath, tokens });
      totalTokens += tokens;
    } else if (stat.isDirectory()) {
      // Use fast-glob to aggressively ignore huge folders and binaries
      const entries = await fg(['**/*'], {
        cwd: targetPath,
        dot: true,
        absolute: true,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
          '**/venv/**',
          '**/.venv/**',
          '**/env/**',
          '**/.DS_Store',
          '**/*.{exe,dll,so,dylib,bin,zip,tar,gz,7z,rar,pdf,mp4,mp3,wav,webm}' // exclude common binary formats that we don't tokenize
        ]
      });

      // Bulletproof path ignore check to cover symlinks and nested package cases
      const filteredEntries = entries.filter(entry => {
        const normalized = entry.replace(/\\/g, '/').toLowerCase();
        return !(
          normalized.includes('/node_modules/') ||
          normalized.includes('/.git/') ||
          normalized.includes('/dist/') ||
          normalized.includes('/build/') ||
          normalized.includes('/.next/') ||
          normalized.includes('/venv/') ||
          normalized.includes('/.venv/') ||
          normalized.includes('/env/')
        );
      });

      // Process files inside directory in parallel batches of 15
      const tokensResults = await pLimit(filteredEntries, 15, (entry) => processSingleFile(entry, encoding));

      for (let i = 0; i < filteredEntries.length; i++) {
        const tokens = tokensResults[i];
        if (tokens > 0) {
          breakdown.push({ path: filteredEntries[i], tokens });
          totalTokens += tokens;
        }
      }
    }

    return { totalTokens, breakdown };
  } catch (error) {
    console.error(`Error processing path ${targetPath}:`, error);
    throw error;
  }
}

const IMAGE_EXTS = new Set(['.png', '.jpeg', '.jpg', '.webp', '.gif']);

const TEXT_EXTS = new Set([
  '.txt', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', 
  '.md', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs', 
  '.sh', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.sql',
  '.graphql', '.gql', '.properties', '.env', '.gitignore'
]);

const BINARY_EXTS = new Set([
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib',
  '.bin', '.mp4', '.mp3', '.wav', '.webm', '.ogg', '.m4a', '.avi', '.mkv', '.mov',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  '.epub', '.mobi', '.dmg', '.iso', '.pkg', '.apk', '.jar', '.war', '.db', '.sqlite',
  '.sqlite3', '.dat', '.dbf', '.log', '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.tiff', '.bmp', '.psd', '.ai'
]);

async function isBinaryFile(filePath: string): Promise<boolean> {
  let fileHandle: any = null;
  try {
    fileHandle = await fs.open(filePath, 'r');
    const allocSize = 1024;
    const { bytesRead, buffer } = await fileHandle.read(Buffer.alloc(allocSize), 0, allocSize, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // ignore
      }
    }
  }
}

async function calculateTokensForLargeFile(filePath: string, encoding: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let tokenCount = 0;
    try {
      const stream = createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 1024 * 1024 }); // 1MB chunks
      
      stream.on('data', async (chunk: string) => {
        stream.pause();
        tokenCount += calculateTokensForText(chunk, encoding);
        // Yield control to the event loop so Electron stays 100% responsive
        await new Promise(resolveYield => setImmediate(resolveYield));
        stream.resume();
      });
      
      stream.on('end', () => {
        resolve(tokenCount);
      });
      
      stream.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function processSingleFile(filePath: string, encoding: string): Promise<number> {
  const ext = path.extname(filePath).toLowerCase();
  
  if (IMAGE_EXTS.has(ext)) {
    return calculateTokensForImage(filePath);
  }

  // Fast path: if it's a known binary file extension, skip reading it entirely
  if (BINARY_EXTS.has(ext)) {
    return 0;
  }

  // Treat as text
  try {
    const stat = await fs.stat(filePath);

    // Run the binary check FIRST for unknown extensions to prevent reading massive binaries
    if (!TEXT_EXTS.has(ext)) {
      if (await isBinaryFile(filePath)) {
        console.warn(`Ignoring binary file: ${filePath}`);
        return 0;
      }
    }

    // Now, if it's a valid text file, handle massive sizes via streaming
    if (stat.size > 10 * 1024 * 1024) {
      console.warn(`Processing massive file in stream mode to prevent choking: ${filePath} (${stat.size} bytes)`);
      return await calculateTokensForLargeFile(filePath, encoding);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return calculateTokensForText(content, encoding);
  } catch (err) {
    // Possibly a binary file or unreadable, ignore
    return 0;
  }
}

export async function calculateTokensForPathsBulk(
  paths: string[],
  encoding: string = 'o200k_base'
): Promise<{ totalTokens: number, breakdown: { path: string, tokens: number }[] }> {
  let totalTokens = 0;
  const breakdown: { path: string, tokens: number }[] = [];

  // Run bulk paths in parallel batches of 5
  const results = await pLimit(paths, 5, async (targetPath) => {
    try {
      return await calculateTokensForPath(targetPath, encoding);
    } catch (err) {
      console.error(`Failed to calculate bulk path for ${targetPath}`, err);
      return { totalTokens: 0, breakdown: [] };
    }
  });

  for (const res of results) {
    totalTokens += res.totalTokens;
    breakdown.push(...res.breakdown);
  }

  return { totalTokens, breakdown };
}

