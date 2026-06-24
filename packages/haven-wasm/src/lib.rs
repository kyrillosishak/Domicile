use wasm_bindgen::prelude::*;
use js_sys::Array;

#[wasm_bindgen]
pub fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Array {
    let mut chunks = Vec::new();
    // A simple word-based chunker for demonstration
    let words: Vec<&str> = text.split_whitespace().collect();
    
    if words.is_empty() {
        return Array::new();
    }
    
    let mut i = 0;
    while i < words.len() {
        let end = std::cmp::min(i + chunk_size, words.len());
        let chunk = words[i..end].join(" ");
        chunks.push(chunk);
        
        if end == words.len() {
            break;
        }
        
        i += chunk_size.saturating_sub(overlap).max(1);
    }
    
    let js_array = Array::new();
    for chunk in chunks {
        js_array.push(&JsValue::from_str(&chunk));
    }
    js_array
}

#[wasm_bindgen]
pub fn quantize_f32_to_i8(embeddings: &[f32]) -> Vec<i8> {
    embeddings.iter().map(|&x| {
        let scaled = x * 127.0;
        if scaled > 127.0 {
            127
        } else if scaled < -128.0 {
            -128
        } else {
            scaled as i8
        }
    }).collect()
}
