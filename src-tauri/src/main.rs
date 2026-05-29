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

#[tauri::command]
fn calculate_paths_tokens_bulk(target_paths: Vec<String>, encoding: Option<String>) -> Result<BulkResult, String> {
    let enc_name = encoding.unwrap_or_else(|| "o200k_base".to_string());
    
    let mut breakdown = Vec::new();
    let mut total_tokens = 0;

    for tp in target_paths {
        let path = Path::new(&tp);
        if !path.exists() {
            continue;
        }

        let mut path_tokens = 0;
        if path.is_file() {
            path_tokens = count_file_tokens(path, &enc_name);
        } else {
            let walker = WalkDir::new(path).into_iter().filter_entry(|e| !should_ignore(e.path()));
            for entry in walker {
                if let Ok(entry) = entry {
                    let p = entry.path();
                    if p.is_file() {
                        path_tokens += count_file_tokens(p, &enc_name);
                    }
                }
            }
        }

        total_tokens += path_tokens;
        breakdown.push(BreakdownItem {
            path: tp,
            tokens: path_tokens,
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
        .set_title("Select Files or Folders")
        .pick_files();

    if let Some(paths) = files {
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
            select_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
