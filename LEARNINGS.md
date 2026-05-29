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

---

## 5. Electron-Builder Packaging & GitHub Release Setup
- **Context**: Creating production-ready installers for Vite-based Electron applications requires configuring `electron-builder` correctly inside `package.json` to avoid packaging native module bloat and ensuring built assets are ignored by Git.
- **Resolution**:
  - Configured `electron-builder` with custom output to `release/`.
  - Added `/release` to `.gitignore` to prevent committing massive packaged files (`.dmg` ~128MB, `.zip` ~124MB).
  - Pushed git tag `v0.0.1` and established a structured, repeatable automated/manual pipeline to publish releases to GitHub.

---

## 6. Framework Migration: Electron to Tauri v2 for 95% Size Reduction
- **Context**: The bundled Electron application baseline size is over 114MB due to packaging Chromium and Node.js. For a simple offline tokenizer, this was computationally and structurally bloated.
- **Resolution**:
  - Migrated to **Tauri v2** using macOS's native WebKit engine.
  - Rewrote the directory crawler and BPE tokenizing logic in highly optimized **Rust** using `tiktoken-rs` and `walkdir` (zero-cloning with lock-based singleton mutexes).
  - Shrank the DMG installer size from **114.1 MB** down to **5.0 MB** (a ~95% reduction!).
  - Exposed a mock `electronAPI` window object in `src/main.tsx` that mapped original React IPC calls directly to Tauri's `invoke` API, allowing the entire React frontend to compile and run with **zero code modifications**!
  - Resolved `dispatch2` dependency bitflags compilation limit reached error by adding `#![recursion_limit = "512"]` inside `main.rs` and the cached dependency files.

---

## 7. Tauri v2 Native Event Interception & Drag-and-Drop Resolution
- **Context**: In Tauri v2, when `dragDropEnabled` is `true` (default), Tauri's native layer intercepts all window drop events. This bypasses HTML5 DOM-level drag-and-drop events (like React's `onDrop`), rendering elements unresponsive.
- **Resolution**:
  - **Window Scope Constraint**: In Tauri v2, native drag-and-drop events (`tauri://drag-drop`, `tauri://drag-enter`, `tauri://drag-leave`) are targeted *specifically* at the window webview and are not emitted globally. Standard global `listen(...)` calls from `@tauri-apps/api/event` may fail to capture them.
  - **Direct Listener Registry**: Shifted the listeners directly inside the React component mount phase (`useEffect`) in `App.tsx` by performing a dynamic import of `@tauri-apps/api/webviewWindow` and calling `getCurrentWebviewWindow().listen(...)` on the active window. This completely avoids any pre-load/module loading race conditions.
  - **Conflict Avoidance**: HTML5 drag enter/leave handlers in React are simplified to only run `e.preventDefault()`, leaving the `isDragging` overlay state to be controlled purely by Tauri's native window events.
  - **Config Override**: Explicitly declared `"dragDropEnabled": true` and `"label": "main"` inside `tauri.conf.json`'s window parameters to ensure the OS-level drag-drop delegate is compiled and bound correctly on macOS.

---

## 8. Mixed Pickers Limitation & Dedicated Controls
- **Context**: Native file dialog packages on macOS (like `rfd` under Tauri) cannot simultaneously select mixed targets (individual files and full folders recursively) in a single dialog action.
- **Resolution**:
  - Split the toolbar controls into side-by-side **"Add Files"** and **"Add Folder"** buttons.
  - Exposed dedicated native Rust commands (`select_paths` and `select_folders`) utilizing RFD's `pick_files()` and `pick_folders()` APIs, providing an extremely clean and intuitive folder scanning experience.

---

## 9. Code Quality & Type Safety Compliance
- **Context**: Strict ESLint rules (`@typescript-eslint/no-explicit-any`) and TypeScript compiler constraints block builds when `any` casting is used for window or event overrides.
- **Resolution**:
  - Replaced all raw `any` assertions with a strongly typed `ElectronAPI` interface mapping inside both `src/App.tsx` and `src/main.tsx`.
  - Cast environment globals safely via `unknown` checks, resulting in a **100% warning-free and error-free TypeScript compile and lint check**.

---

## 10. Stray Mount Volume Build Errors (`bundle_dmg.sh` failure)
- **Context**: If a previous compilation is interrupted or if the generated DMG is still mounted on the macOS host under `/Volumes/`, subsequent Tauri compilations will crash during the `bundle_dmg.sh` phase due to mount collisions.
- **Resolution**:
  - Cleaned up active disk mounts using macOS native `hdiutil detach "/Volumes/Token Calculator"` (and variants), restoring a completely clean mount list and enabling pristine compilations.

---

## 11. Tauri v2 macOS Draggability, Drop Races, & App Zipping
- **Context**: Custom-framed windows in Tauri v2 on macOS do not support Electron-specific `WebkitAppRegion` drag variables, rendering the window locked and immovable. Additionally, registering overlapping standard HTML5 drop events alongside Tauri's native `tauri://drag-drop` listener triggers parallel execution paths that race and cause folder/file crawler silent calculation errors.
- **Resolution**:
  - **Draggability**: Replaced `WebkitAppRegion` with `data-tauri-drag-region` on the macOS top Traffic Lights Spacer and the header's left-aligned title wrapper. Removed all redundant `no-drag` inline overrides across JSX tags as they are no-ops in Tauri.
  - **Drag-and-Drop Race Avoidance**: Stripped React/HTML5 `onDrop` and `onDragEnter/Leave/Over` handlers from JSX components. Added a simple global window `dragover` and `drop` event listener in `useEffect` that calls `e.preventDefault()`, allowing Tauri's native event listeners to receive absolute paths recursively without any UI races or browser navigation defaults.
  - **Pristine Archiving**: Compiling Tauri bundles yields a `.dmg` and a `.app` package. To zip the `.app` package cleanly for macOS while preserving directory permissions, symlinks, and macOS resource forks, utilized the macOS native `ditto -c -k --sequesterRsrc --keepParent` command instead of standard `zip`.

---

## 12. Background Scanning, Progress Emitters, & User Cancellation UX (v0.0.5)
- **Context**: Performing recursive directory walks and BPE tokenizations for huge folders directly in a standard Tauri command blocking loop freezes the application's single UI thread, triggering macOS "spinning beach ball" crashes.
- **Resolution**:
  - **Tokio Thread Spawning**: Converted the Tauri Rust command into an `async fn`. This automatically spawns the computation on Tokio's multi-threaded background pool, leaving the main UI loop fully responsive.
  - **Two-Phase Crawling**: Split the background engine into two distinct phases: Phase 1 pre-scans paths to count total files in milliseconds, and Phase 2 loops to calculate tokens. This allows the frontend to show an exact progress completion percentage (processed vs. total files) from the first second.
  - **Optimized Progress Emitting**: Streamed progress payloads (`window.emit("scan-progress", ...)`) periodically (throttled at ~1% steps using a modulo constraint) to prevent the Tauri IPC bridge from flooding and locking up the frontend render loop.
  - **Atomic User Cancellation**: Implemented an atomic cancel static reference `CANCEL_FLAG: LazyLock<AtomicBool>` and `cancel_calculation` command. Checked `CANCEL_FLAG` on every file iteration, allowing immediate, safe computation terminations without leaking resources.
  - **TypeScript Interface Syncing**: Declared mock-bridge mappings in `src/main.tsx` and mirrored the matching `cancelCalculation` promise signatures in the `ElectronAPI` interface of `src/App.tsx`, eliminating compiler type conflicts.

