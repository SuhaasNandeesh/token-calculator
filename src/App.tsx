import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { 
  Calculator, 
  UploadCloud, 
  CheckCircle, 
  FileType, 
  Package, 
  Trash2, 
  Search, 
  Plus, 
  FileCode, 
  Image as ImageIcon, 
  FileText, 
  X, 
  HelpCircle, 
  FolderOpen,
  ArrowUpDown,
  Sparkles,
  Copy
} from 'lucide-react';

interface BreakdownItem {
  path: string;
  tokens: number;
}

const ENGINE_DETAILS = {
  'o200k_base': { name: 'GPT-4o (o200k_base)', desc: 'Latest high-efficiency tokenizer for GPT-4o models' },
  'cl100k_base': { name: 'GPT-4 / GPT-3.5 (cl100k_base)', desc: 'Standard tokenizer for GPT-4, GPT-3.5-turbo' },
  'p50k_base': { name: 'Codex (p50k_base)', desc: 'Optimized for code, used in older Codex models' },
  'r50k_base': { name: 'GPT-3 Legacy (r50k_base)', desc: 'Legacy tokenizer for GPT-3, InstructGPT, and GPT-2' },
};

function App() {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownItem[]>([]);
  const [activeEngine, setActiveEngine] = useState<string>('o200k_base');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'name' | 'tokens' | 'none'>('none');
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const electron = (window as any).electronAPI;

  const formatPath = useCallback((filePath: string) => {
    let displayPath = filePath;
    const userHome = '/Users/suhaasnandeesh';
    if (displayPath.startsWith(userHome)) {
      displayPath = '~' + displayPath.slice(userHome.length);
    }
    const parts = displayPath.split(/[/\\]/);
    const fileName = parts.pop() || '';
    const folderPath = parts.join('/') || '/';
    return { fileName, folderPath, displayPath };
  }, []);

  const handleCopy = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => {
      setCopiedPath(null);
    }, 1500);
  }, []);

  // Handle clicking outside the custom select dropdown to close it
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsSelectOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update tokens when engine changes
  const handleEngineChange = async (newEngine: string) => {
    setActiveEngine(newEngine);
    setIsSelectOpen(false);
    if (breakdown.length === 0) return;

    setLoading(true);
    try {
      const activePaths = breakdown.map(item => item.path);
      const result = await electron.calculatePathsTokensBulk(activePaths, newEngine);
      setBreakdown(result.breakdown);
      setTotalTokens(result.totalTokens);
    } catch (error) {
      console.error("Failed to recalculate with new engine", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // Process dropped/selected files cumulatively
  const processPaths = async (paths: string[]) => {
    if (!electron) {
      alert("Electron API not available");
      return;
    }
    setLoading(true);
    try {
      const result = await electron.calculatePathsTokensBulk(paths, activeEngine);
      const newBreakdown = result.breakdown;

      setBreakdown(prev => {
        const map = new Map<string, number>();
        prev.forEach((item: BreakdownItem) => map.set(item.path, item.tokens));
        newBreakdown.forEach((item: BreakdownItem) => map.set(item.path, item.tokens));
        
        const updated = Array.from(map.entries()).map(([path, tokens]) => ({ path, tokens }));
        setTotalTokens(updated.reduce((sum, item) => sum + item.tokens, 0));
        return updated;
      });
    } catch (error) {
      console.error("Failed to process paths", error);
      alert("An error occurred during calculation");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounter.current = 0;
    
    // Retrieve absolute paths intercepted by the preload script during drop capture
    if (electron && electron.getLastDroppedPaths) {
      const paths = electron.getLastDroppedPaths();
      if (paths && paths.length > 0) {
        await processPaths(paths);
        return;
      }
    }

    // Fallback: Access nativeEvent to preserve Electron's absolute path property on File objects
    const dt = e.nativeEvent.dataTransfer || e.dataTransfer;
    const files = Array.from(dt.files || []);
    const paths = files.map(f => (f as any).path || f.name).filter(Boolean);
    
    if (paths.length > 0) {
      await processPaths(paths);
    }
  }, [electron, activeEngine, breakdown]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const paths = files.map(f => (f as any).path || f.name).filter(Boolean);
    if (paths.length > 0) {
      await processPaths(paths);
    }
    e.target.value = ''; // Reset input
  };

  const removeFile = (pathToRemove: string) => {
    setBreakdown(prev => {
      const updated = prev.filter(item => item.path !== pathToRemove);
      if (updated.length === 0) {
        setTotalTokens(null);
      } else {
        setTotalTokens(updated.reduce((sum, item) => sum + item.tokens, 0));
      }
      return updated;
    });
  };

  const clearAll = () => {
    setTotalTokens(null);
    setBreakdown([]);
    setSearchQuery('');
    setSortOrder('none');
  };

  const triggerFileSelector = async () => {
    if (electron && electron.selectPaths) {
      try {
        const selected = await electron.selectPaths();
        if (selected && selected.length > 0) {
          await processPaths(selected);
        }
      } catch (err) {
        console.error("Error opening dialog", err);
      }
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Helper to determine file icon and color category
  const getFileMetadata = (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
    const isCode = ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'yaml', 'yml', 'md', 'sh'].includes(ext);

    if (isImage) {
      return {
        icon: <ImageIcon className="w-3.5 h-3.5 text-purple-400" />,
        badgeBg: 'bg-purple-950/40 text-purple-300 border-purple-800/40',
        extName: ext.toUpperCase() || 'IMG'
      };
    } else if (isCode) {
      return {
        icon: <FileCode className="w-3.5 h-3.5 text-cyan-400" />,
        badgeBg: 'bg-cyan-950/40 text-cyan-300 border-cyan-800/40',
        extName: ext.toUpperCase()
      };
    } else {
      return {
        icon: <FileText className="w-3.5 h-3.5 text-amber-400" />,
        badgeBg: 'bg-amber-950/40 text-amber-300 border-amber-800/40',
        extName: ext.toUpperCase() || 'TXT'
      };
    }
  };

  // Compute text vs image stats dynamically
  const stats = useMemo(() => {
    let textTokens = 0;
    let imageTokens = 0;
    let textCount = 0;
    let imageCount = 0;

    breakdown.forEach(item => {
      const ext = item.path.split('.').pop()?.toLowerCase() || '';
      const isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
      if (isImg) {
        imageTokens += item.tokens;
        imageCount += 1;
      } else {
        textTokens += item.tokens;
        textCount += 1;
      }
    });

    const total = textTokens + imageTokens;
    return {
      textTokens,
      imageTokens,
      textCount,
      imageCount,
      textPercentage: total > 0 ? Math.round((textTokens / total) * 100) : 0,
      imagePercentage: total > 0 ? Math.round((imageTokens / total) * 100) : 0,
    };
  }, [breakdown]);

  // Filter and sort the file checklist items
  const processedBreakdown = useMemo(() => {
    let list = [...breakdown];
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      list = list.filter(item => {
        const fileName = item.path.split(/[/\\]/).pop() || '';
        return fileName.toLowerCase().includes(query) || item.path.toLowerCase().includes(query);
      });
    }

    if (sortOrder === 'name') {
      list.sort((a, b) => {
        const nameA = a.path.split(/[/\\]/).pop() || '';
        const nameB = b.path.split(/[/\\]/).pop() || '';
        return nameA.localeCompare(nameB);
      });
    } else if (sortOrder === 'tokens') {
      list.sort((a, b) => b.tokens - a.tokens);
    }

    return list;
  }, [breakdown, searchQuery, sortOrder]);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  return (
    <div 
      className="flex flex-col h-screen bg-neutral-950 text-neutral-100 font-sans relative overflow-hidden select-none" 
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Immersive Drag Overlay (Always in DOM, opacity-toggled) */}
      <div 
        data-testid="drag-overlay"
        className={`absolute inset-0 bg-neutral-950/85 backdrop-blur-md z-50 flex flex-col items-center justify-center border-2 border-dashed border-cyan-500/50 m-4 rounded-2xl transition-all duration-200 pointer-events-none ${
          isDragging ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        <div className="p-5 bg-cyan-950/30 rounded-full border border-cyan-500/40 shadow-lg shadow-cyan-500/5 mb-4 animate-bounce">
          <UploadCloud className="w-10 h-10 text-cyan-400" />
        </div>
        <p className="text-base font-bold text-cyan-400">Drop files or folders to add</p>
        <p className="text-xs text-neutral-500 mt-1.5 font-sans">Release to start calculating tokens locally</p>
      </div>

      {/* Decorative Background Glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-violet-600/10 blur-[120px] pointer-events-none" />

      {/* Hidden file input for non-electron fallbacks */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        multiple 
        className="hidden" 
      />
      {/* macOS Traffic Lights Spacer */}
      <div className="h-9 flex-shrink-0 bg-neutral-950/40 w-full" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Spacious Aligned Header: Positioned beautifully below traffic lights */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-neutral-900 bg-neutral-950/40 backdrop-blur-md z-40 flex-shrink-0">
        <div className="flex items-center space-x-2.5">
          <Calculator className="w-5.5 h-5.5 text-cyan-400" />
          <h1 className="text-xs font-bold tracking-tight bg-gradient-to-r from-white to-neutral-100 bg-clip-text text-transparent flex items-center gap-1">
            Token Calculator <Sparkles className="w-3 h-3 text-cyan-400/80" />
          </h1>
        </div>

        {/* Custom Engine Dropdown Menu (Click-transparent, solid styling) */}
        <div className="relative flex-shrink-0 z-50" ref={dropdownRef} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => setIsSelectOpen(prev => !prev)}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="flex items-center space-x-2 px-3 py-1.5 bg-neutral-900 border border-neutral-800 rounded-lg hover:border-neutral-700 hover:bg-neutral-855 active:scale-95 transition-all text-xs font-semibold text-neutral-300 shadow-md select-none animate-fade-in"
          >
            <span className="font-mono text-cyan-400 font-bold uppercase tracking-wide">{activeEngine}</span>
            <span className={`text-[8px] text-neutral-500 transition-transform duration-200 ${isSelectOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>

          {isSelectOpen && (
            <div 
              className="absolute right-0 mt-2 w-72 bg-neutral-950 border border-neutral-850 rounded-xl shadow-2xl p-2 animate-in fade-in slide-in-from-top-2 duration-150"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <div className="text-[9px] font-extrabold text-neutral-500 px-3 py-2 uppercase tracking-wider select-none border-b border-neutral-900/60 pb-1.5 mb-1.5">
                Select Tokenization Engine
              </div>
              <div className="space-y-1">
                {Object.entries(ENGINE_DETAILS).map(([key, details]) => (
                  <button
                    key={key}
                    onClick={() => handleEngineChange(key)}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-all flex flex-col ${
                      activeEngine === key 
                        ? 'bg-cyan-500/10 border border-cyan-500/30' 
                        : 'border border-transparent hover:bg-neutral-900/60'
                    }`}
                  >
                    <span className={`text-xs font-mono font-bold ${activeEngine === key ? 'text-cyan-400' : 'text-neutral-200'}`}>
                      {details.name}
                    </span>
                    <span className="text-[9px] text-neutral-555 mt-0.5 leading-normal select-none">
                      {details.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Spacious Focused Workspace Container */}
      <main className="flex-1 overflow-hidden p-6 flex flex-col min-h-0">
        {totalTokens === null ? (
          /* Initial Empty Drag-and-Drop Area */
          <div 
            data-testid="dropzone"
            className="flex-1 rounded-2xl border-2 border-dashed border-neutral-800 bg-neutral-900/20 hover:border-neutral-700 hover:bg-neutral-900/35 transition-all duration-300 flex flex-col items-center justify-center p-8 text-center"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {loading ? (
              <div className="flex flex-col items-center space-y-4 animate-pulse">
                <div className="p-4 bg-cyan-950/50 rounded-full border border-cyan-800/40 relative">
                  <div className="absolute inset-0 rounded-full border border-cyan-400 animate-ping opacity-40" />
                  <Package className="w-10 h-10 text-cyan-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-cyan-400">Scanning & calculating tokens...</p>
                  <p className="text-xs text-neutral-500 mt-1">Reading directories recursively, ignoring binaries</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-5 max-w-md" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <div className="p-4 bg-neutral-900/90 rounded-2xl border border-neutral-800 shadow-md">
                  <UploadCloud className="w-8 h-8 text-neutral-400 animate-bounce" />
                </div>
                <div>
                  <p className="text-base font-bold text-neutral-200">Drag & Drop files or folders here</p>
                  <p className="text-xs text-neutral-500 mt-1 max-w-xs mx-auto leading-normal">
                    Supports code, images, and nested structures recursively. 100% offline & secure.
                  </p>
                </div>
                <div className="pt-2">
                  <button 
                    onClick={triggerFileSelector}
                    className="px-5 py-2 bg-gradient-to-tr from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 border border-cyan-400/20 active:scale-95 rounded-xl text-xs font-semibold text-white transition-all shadow-lg shadow-cyan-500/10 flex items-center gap-1.5"
                  >
                    <FolderOpen className="w-3.5 h-3.5" /> Select Files or Folder
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Premium Focused Spacious Dashboard Layout (Completely Realignment-proof vertical flexbox) */
          <div 
            className="flex-1 flex flex-col justify-between rounded-2xl border border-neutral-900 bg-neutral-950/20 p-5 shadow-2xl relative min-h-0 gap-4" 
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            
            {/* Top Section: Compact Total Tokens Indicator & Telemetry */}
            <div className="flex flex-col items-center justify-center text-center py-2 flex-shrink-0 gap-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle className="w-5.5 h-5.5 text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.3)] animate-pulse" />
                <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-neutral-100 to-cyan-100 tracking-tighter select-text font-sans drop-shadow-[0_0_12px_rgba(255,255,255,0.08)]">
                  {formatNumber(totalTokens)}
                </div>
                <span className="text-[9px] text-neutral-400 font-extrabold uppercase tracking-widest bg-neutral-900/80 border border-neutral-800 px-2 py-0.5 rounded-md font-sans shadow-inner">
                  Tokens
                </span>
              </div>
              
              {/* Telemetry bar */}
              <div className="w-full max-w-md p-2.5 bg-neutral-900/35 border border-neutral-900/60 rounded-xl space-y-2 backdrop-blur-sm shadow-md">
                <div className="flex justify-between items-center text-[10px] font-bold text-neutral-400 px-1">
                  <span className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.4)] animate-pulse" />
                    Text: {stats.textCount} ({stats.textPercentage}%)
                  </span>
                  <span className="flex items-center gap-1.5 hover:text-purple-300 transition-colors">
                    <span className="w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.4)] animate-pulse" />
                    Image: {stats.imageCount} ({stats.imagePercentage}%)
                  </span>
                </div>
                <div className="flex h-2 w-full rounded-full bg-neutral-950 overflow-hidden border border-neutral-900/60 p-0.5">
                  {stats.textPercentage > 0 && (
                    <div 
                      style={{ width: `${stats.textPercentage}%` }} 
                      className={`bg-gradient-to-r from-cyan-500 to-teal-400 shadow-[0_0_8px_rgba(6,182,212,0.3)] transition-all duration-500 ${
                        stats.imagePercentage === 0 ? 'rounded-full' : 'rounded-l-full'
                      }`}
                    />
                  )}
                  {stats.imagePercentage > 0 && (
                    <div 
                      style={{ width: `${stats.imagePercentage}%` }} 
                      className={`bg-gradient-to-r from-purple-500 to-fuchsia-400 shadow-[0_0_8px_rgba(139,92,246,0.3)] transition-all duration-500 ${
                        stats.textPercentage === 0 ? 'rounded-full' : 'rounded-r-full'
                      }`}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Middle Section: Scrollable Breakdown Card checklist (Gaps and Heights strictly locked) */}
            <div className="flex-1 flex flex-col bg-neutral-950/60 border border-neutral-900 rounded-2xl p-4 min-h-0 relative shadow-inner">
              
              {/* Checklist toolbar */}
              <div className="flex items-center justify-between pb-3 border-b border-neutral-900/60 flex-shrink-0 gap-3">
                <h3 className="text-[10px] font-extrabold text-neutral-400 flex items-center gap-1.5 uppercase tracking-wider">
                  <FileType className="w-3.5 h-3.5 text-cyan-400 animate-pulse" /> File Breakdown
                </h3>
                
                {/* Search / Sort */}
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500" />
                    <input 
                      type="text"
                      placeholder="Filter files..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-40 pl-8 pr-6 py-1 bg-neutral-950 border border-neutral-900 focus:border-cyan-500/50 hover:border-neutral-800 rounded-lg text-[10px] font-semibold text-neutral-300 placeholder-neutral-600 transition-all outline-none shadow-sm"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-550 hover:text-neutral-300">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <button 
                    onClick={() => {
                      if (sortOrder === 'none') setSortOrder('name');
                      else if (sortOrder === 'name') setSortOrder('tokens');
                      else setSortOrder('none');
                    }}
                    title={`Sorting: ${sortOrder === 'none' ? 'None' : sortOrder === 'name' ? 'Name' : 'Tokens'}`}
                    className={`px-2 py-1 bg-neutral-950 border border-neutral-900 hover:border-neutral-800 rounded-lg text-[9px] font-bold transition-all flex items-center gap-1 active:scale-95 ${
                      sortOrder !== 'none' ? 'text-cyan-400 border-cyan-500/20' : 'text-neutral-500'
                    }`}
                  >
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    <span className="font-sans uppercase text-[8px] tracking-widest">
                      {sortOrder === 'none' ? 'Sort' : sortOrder === 'name' ? 'Name' : 'Tokens'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Scrollable Checklist container */}
              <div className="flex-1 overflow-y-auto py-2.5 space-y-1.5 pr-1 min-h-0 select-text relative custom-scrollbar">
                
                {/* Beautiful Glassmorphic Loading Overlay */}
                {loading && (
                  <div className="absolute inset-0 bg-neutral-950/70 backdrop-blur-[3px] z-20 flex flex-col items-center justify-center space-y-3 transition-all duration-300 rounded-xl animate-in fade-in">
                    <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin shadow-[0_0_15px_rgba(34,211,238,0.2)]" />
                    <span className="text-[10px] font-bold tracking-wider text-cyan-400 uppercase animate-pulse">
                      {breakdown.length === 0 ? "Scanning files..." : "Recalculating tokens..."}
                    </span>
                  </div>
                )}

                {loading && breakdown.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-neutral-550 space-y-2">
                    <div className="w-5 h-5 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
                    <span className="text-[10px] font-bold uppercase tracking-wider animate-pulse">Scanning files...</span>
                  </div>
                ) : processedBreakdown.length > 0 ? (
                  <>
                    {processedBreakdown.slice(0, 100).map((item, idx) => {
                      const meta = getFileMetadata(item.path);
                      const { fileName, folderPath } = formatPath(item.path);
                      return (
                        <div 
                          key={idx} 
                          className="flex justify-between items-center text-[10px] font-mono bg-neutral-950/30 hover:bg-neutral-900/30 py-2 px-3 rounded-xl border border-neutral-950 hover:border-neutral-900/80 group transition-all duration-200 shadow-sm animate-slide-in relative overflow-hidden"
                          style={{ animationDelay: `${Math.min(idx * 20, 300)}ms` }}
                        >
                          <div className="flex items-center space-x-2.5 min-w-0 flex-1 mr-4">
                            <span className="flex-shrink-0">{meta.icon}</span>
                            <div className="flex flex-col min-w-0">
                              <span className="truncate text-neutral-200 font-bold text-[13px] group-hover:text-cyan-400 transition-colors" title={item.path}>
                                {fileName}
                              </span>
                              <span className="truncate text-[9px] text-neutral-500 font-medium tracking-wide select-text mt-0.5" title={item.path}>
                                {folderPath}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2.5 flex-shrink-0">
                            <span className={`px-1.5 py-0.5 rounded-md border text-[8px] font-extrabold ${meta.badgeBg}`}>
                              {meta.extName}
                            </span>
                            <span className="text-cyan-400 font-bold text-xs bg-neutral-950 border border-neutral-900 px-2 py-0.5 rounded-lg min-w-[55px] text-right font-mono select-text shadow-sm">
                              {formatNumber(item.tokens)}
                            </span>
                            
                            <div className="flex items-center space-x-1 flex-shrink-0">
                              {/* Copy button with check/copy states */}
                              <button
                                onClick={() => handleCopy(item.path)}
                                className="p-1 text-neutral-500 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Copy absolute path"
                                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                              >
                                {copiedPath === item.path ? (
                                  <CheckCircle className="w-3.5 h-3.5 text-green-400 animate-in zoom-in-50 duration-200" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>

                              {/* Individual checklist deletion */}
                              <button
                                onClick={() => removeFile(item.path)}
                                className="p-1 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Remove file"
                                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {processedBreakdown.length > 100 && (
                      <div className="text-center py-2.5 text-[8px] font-extrabold text-neutral-500 bg-neutral-950/20 border border-neutral-900/40 rounded-xl font-mono tracking-widest">
                        + {processedBreakdown.length - 100} MORE FILES (USE SEARCH TO FILTER)
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-10 text-neutral-555 text-[10px] font-bold uppercase tracking-wider">
                    {searchQuery ? 'No matching files found' : 'Checklist is empty'}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Section: Action Buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-neutral-850/60 flex-shrink-0">
              <span className="text-[8px] text-neutral-500 font-extrabold uppercase font-mono tracking-wider">
                FILES: {breakdown.length}
              </span>
              
              <div className="flex space-x-1.5">
                <button 
                  onClick={triggerFileSelector}
                  className="px-2.5 py-1 bg-cyan-600/15 hover:bg-cyan-600/25 border border-cyan-500/20 rounded-lg text-[9px] font-extrabold text-cyan-400 active:scale-95 transition-all flex items-center gap-1 shadow-md shadow-cyan-500/2"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  <Plus className="w-2.5 h-2.5" /> Add items
                </button>
                <button 
                  onClick={clearAll}
                  className="px-2.5 py-1 bg-neutral-950 border border-neutral-850 hover:bg-neutral-900 rounded-lg text-[9px] font-extrabold text-neutral-400 hover:text-neutral-255 transition-all flex items-center gap-1"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  <X className="w-2.5 h-2.5" /> Clear All
                </button>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* Global application footer */}
      <footer className="px-6 py-3 border-t border-neutral-900 bg-neutral-950/60 backdrop-blur-md text-[10px] text-neutral-500 flex justify-between items-center z-10 flex-shrink-0">
        <span className="flex items-center gap-1">
          Global copy-tokenize shortcut: <kbd className="font-mono bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-850 text-neutral-400 font-bold select-text">Cmd+Opt+T</kbd>
        </span>
        <span className="flex items-center gap-1">
          <HelpCircle className="w-3 h-3 text-neutral-500" /> Offline Token Estimator
        </span>
      </footer>
    </div>
  );
}

export default App;
