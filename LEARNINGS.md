# LEARNINGS.md: Engineering Insights & Architectural Pivots

This document tracks all critical engineering insights, optimization strategies, and resolved constraints for the `token-calculator` project, supporting the "Plan-Execute-Verify-Learn" loop.

## 1. Architectural Pivots & Build Constraints

### Vite 6 & Electron CommonJS Bundler Integration
- **Context**: In Vite 6 / Electron environments, setting `"type": "module"` in `package.json` breaks Node's runtime resolution because standard compiled outputs of Electron main/preload expect CommonJS loader contexts.
- **Resolution**: Removed `"type": "module"` from `package.json` and renamed the Vite config file to `vite.config.mts`. This tells Node to seamlessly compile the electron code to CommonJS, eliminating module loading warnings or execution exceptions. Do NOT restore `"type": "module"`.

### JSDOM Test Constraints
- **Context**: `jsdom` used in Vitest cannot easily mock advanced standard `DataTransfer` file structures or browser drop events without flaky behaviors.
- **Resolution**: Instead of simulating complex drop zones in JSDOM, initial render states and visual hover toggles are fully covered in `@testing-library/react`. Drop mechanics are verified securely through clean unit tests for the core logic layer (`electron/tokenLogic.test.ts`).

---

## 2. Memory & Performance Optimizations

### Encoder Memoization & Caching
- **Context**: Dynamically calling `tiktoken.get_encoding()` on every calculation or when switching between engines (dropdown changes) re-initializes WASM memory, which is computationally expensive and leads to rapid heap fragmentation or leak paths.
- **Resolution**: Implemented a global memoization cache `encoders: Record<string, Tiktoken>` in `electron/tokenLogic.ts`. Encoders are initialized on-demand exactly once, allowing instantaneous switching and lightning-fast local calculations ($O(1)$ lookup for encoder retrieval).

### Recursive Path Aggregation & Ignoring Rules
- **Context**: Scanning massive nested directories (e.g. `node_modules`, `.git`) crashes Electron main threads or locks performance.
- **Resolution**: Configured recursive scans with aggressive `fast-glob` exclusion filters (`node_modules`, `.git`, `.DS_Store`, common massive compressed archives and media formats). This keeps calculations fast and prevents reading massive binary payloads.

---

## 3. Dynamic UI state & Cumulative Drag-and-Drop

### Unified Dashboard & Multi-File Drops
- **Context**: Earlier designs swapped between a dropzone-only screen and a results-only screen, blocking users from dropping files sequentially.
- **Resolution**: Created a unified **Dashboard Layout**.
  - Sequential files are appended to a state Map keyed by file path. This provides automatic deduplication, ensuring that dropping the same file multiple times updates its state rather than creating redundant items.
  - Active files are recalculable on-the-fly. When a user changes the tokenizer engine in the header select dropdown, the app loops over active files and recalculates their tokens in the background, providing instantaneous visual feedback.

---

## 4. Performance & UX Polish (Upgrades)

### Zero-Dependency Binary File Guard
- **Context**: Directly reading arbitrary binary payloads (e.g. `.zip`, `.pdf`, `.mov`) into UTF-8 text parser consumes heavy memory/CPU and prints corrupt token counts.
- **Resolution**: Designed a simple `isBinaryFile` check using `fs.open` and checking the first 1KB for null bytes (`\0`). This acts as an efficient guard that keeps calculations secure, offline, and lightweight.

### Async UX loading & Cascaded Layouts
- **Context**: Engine transitions on massive checklists locked calculations silently. Long home paths (`/Users/suhaasnandeesh`) cluttered dashboard layout.
- **Resolution**:
  - Implemented glassmorphic recalculating loaders over the checklist area, giving immediate visual status.
  - Added a workspace formatting utility in `App.tsx` mapping absolute path prefixes to `~`, bolding active filenames, and rendering relative paths.
  - Added slide-in entries with dynamic cascade delays to provide premium kinetic feedback.
