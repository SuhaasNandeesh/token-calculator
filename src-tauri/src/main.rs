// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![recursion_limit = "512"]

use std::fs::File;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;
use tiktoken_rs::{o200k_base_singleton, cl100k_base_singleton, p50k_base_singleton, r50k_base_singleton};
use serde::Serialize;
use rfd::FileDialog;
use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;

static CANCEL_FLAG: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));

#[derive(Serialize)]
struct BreakdownItem {
    path: String,
    tokens: usize,
}

#[derive(Serialize)]
struct BulkResult {
    breakdown: Vec<BreakdownItem>,
    #[serde(rename = "totalTokens")]
    total_tokens: usize,
}

fn count_tokens_with_encoder(text: &str, encoding: &str) -> usize {
    match encoding {
        "o200k_base" => o200k_base_singleton().lock().encode_with_special_tokens(text).len(),
        "cl100k_base" => cl100k_base_singleton().lock().encode_with_special_tokens(text).len(),
        "p50k_base" => p50k_base_singleton().lock().encode_with_special_tokens(text).len(),
        "r50k_base" => r50k_base_singleton().lock().encode_with_special_tokens(text).len(),
        _ => 0,
    }
}

// Fast binary file check: scan first 1KB for null bytes
fn is_binary_file(path: &Path) -> bool {
    if let Ok(mut file) = File::open(path) {
        let mut buffer = [0; 1024];
        if let Ok(bytes_read) = file.read(&mut buffer) {
            for &byte in &buffer[..bytes_read] {
                if byte == 0 {
                    return true;
                }
            }
        }
    }
    false
}

fn should_ignore(path: &Path) -> bool {
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        let lower = name.to_lowercase();
        if lower == "node_modules" 
            || lower == ".git" 
            || lower == "dist" 
            || lower == "dist-electron" 
            || lower == "release" 
            || lower == ".ds_store" 
            || lower == "target" 
            || lower == "build"
        {
            return true;
        }
    }
    false
}

fn count_file_tokens(path: &Path, encoding: &str) -> usize {
    if is_binary_file(path) {
        return 0;
    }
    if let Ok(mut file) = File::open(path) {
        let mut contents = String::new();
        if file.read_to_string(&mut contents).is_ok() {
            return count_tokens_with_encoder(&contents, encoding);
        }
    }
    0
}

#[tauri::command]
fn calculate_text_tokens(text: String, encoding: Option<String>) -> usize {
    let enc_name = encoding.unwrap_or_else(|| "o200k_base".to_string());
    count_tokens_with_encoder(&text, &enc_name)
}

#[tauri::command]
fn calculate_path_tokens(target_path: String, encoding: Option<String>) -> Result<usize, String> {
    let enc_name = encoding.unwrap_or_else(|| "o200k_base".to_string());
    let path = Path::new(&target_path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", target_path));
    }

    if path.is_file() {
        return Ok(count_file_tokens(path, &enc_name));
    }

    let mut total = 0;
    let walker = WalkDir::new(path).into_iter().filter_entry(|e| !should_ignore(e.path()));

    for entry in walker {
        if let Ok(entry) = entry {
            let p = entry.path();
            if p.is_file() {
                total += count_file_tokens(p, &enc_name);
            }
        }
    }

    Ok(total)
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    processed: usize,
    total: usize,
    #[serde(rename = "currentFile")]
    current_file: String,
    #[serde(rename = "currentTokens")]
    current_tokens: usize,
}

#[tauri::command]
fn cancel_calculation() {
    CANCEL_FLAG.store(true, Ordering::Relaxed);
}

#[tauri::command]
async fn calculate_paths_tokens_bulk(
    window: tauri::Window,
    target_paths: Vec<String>,
    encoding: Option<String>
) -> Result<BulkResult, String> {
    let enc_name = encoding.unwrap_or_else(|| "o200k_base".to_string());
    
    // Reset cancellation flag
    CANCEL_FLAG.store(false, Ordering::Relaxed);

    // Initialize path token map for bulk aggregation
    let mut path_tokens_map = std::collections::HashMap::new();
    for tp in &target_paths {
        path_tokens_map.insert(tp.clone(), 0);
    }

    // Phase 1: Fast pre-scan discovery of candidate files
    let mut all_files = Vec::new();
    for tp in &target_paths {
        let path = Path::new(tp);
        if !path.exists() {
            continue;
        }

        if path.is_file() {
            all_files.push((tp.clone(), path.to_path_buf()));
        } else {
            let walker = WalkDir::new(path).into_iter().filter_entry(|e| !should_ignore(e.path()));
            for entry in walker {
                if let Ok(entry) = entry {
                    let p = entry.path();
                    if p.is_file() {
                        all_files.push((tp.clone(), p.to_path_buf()));
                    }
                }
            }
        }
    }

    let total_files = all_files.len();
    let mut total_tokens = 0;

    // Phase 2: Non-blocking token calculations with progress feedback
    for (idx, (root_path, file_path)) in all_files.iter().enumerate() {
        // Check for cancellation signal
        if CANCEL_FLAG.load(Ordering::Relaxed) {
            return Err("Scan cancelled by user".into());
        }

        let file_tokens = count_file_tokens(file_path, &enc_name);
        total_tokens += file_tokens;

        if let Some(tokens) = path_tokens_map.get_mut(root_path) {
            *tokens += file_tokens;
        }

        // Optimized Emitter: Stream progress periodically to avoid IPC channel flooding
        let is_last = idx == total_files - 1;
        let should_emit = is_last || (idx + 1) % (total_files / 100).max(1) == 0;
        
        if should_emit {
            let progress = ProgressPayload {
                processed: idx + 1,
                total: total_files,
                current_file: file_path.to_string_lossy().into_owned(),
                current_tokens: total_tokens,
            };
            window.emit("scan-progress", progress).ok();
        }
    }

    // Assemble final breakdown result matching the original frontend API
    let mut breakdown = Vec::new();
    for tp in target_paths {
        let tokens = *path_tokens_map.get(&tp).unwrap_or(&0);
        breakdown.push(BreakdownItem {
            path: tp,
            tokens,
        });
    }

    Ok(BulkResult {
        breakdown,
        total_tokens,
    })
}

#[tauri::command]
fn select_paths() -> Vec<String> {
    let files = FileDialog::new()
        .set_title("Select Files")
        .pick_files();

    if let Some(paths) = files {
        return paths.into_iter().map(|p| p.to_string_lossy().into_owned()).collect();
    }
    
    Vec::new()
}

#[tauri::command]
fn select_folders() -> Vec<String> {
    let folders = FileDialog::new()
        .set_title("Select Folders")
        .pick_folders();

    if let Some(paths) = folders {
        return paths.into_iter().map(|p| p.to_string_lossy().into_owned()).collect();
    }
    
    Vec::new()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            calculate_text_tokens,
            calculate_path_tokens,
            calculate_paths_tokens_bulk,
            select_paths,
            select_folders,
            cancel_calculation
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
