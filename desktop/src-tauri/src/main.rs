// Domicile Desktop — Tauri shell.
//
// Intentionally minimal: the shell only hosts the webview. All engine logic
// (vector DB, RAG, LLM, custody) runs as JS/WASM inside the webview. The
// residency boundary (zero egress except cache-once model weights) holds
// identically — the Rust shell initiates no outbound network for user data.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Domicile Desktop");
}
