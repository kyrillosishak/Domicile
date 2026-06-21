# Domicile Desktop

The reference product — the thing a lawyer actually uses. Drop a matter
folder, ask grounded questions with inline citations, fully offline. This is
the showcase made real: where the showcase runs a fake keyword ranker,
Desktop runs the true Domicile engine.

PRODUCT_DESIGN.md B10.

## Form factor: Tauri

Tauri (not Electron): a Rust shell, ~10 MB, lower memory, no Chromium bundle.
The webview runs the Domicile engine. The privacy argument is cleaner with a
small, auditable binary, and no network-bound code is bundled except model
weights, which cache once.

The webview content lives here (`index.html`, `styles.css`, `main.ts`). The
Tauri shell wraps it.

## Running the webview (dev)

The webview is a plain ES module app that imports the engine from `../src`.
During development you can serve it with Vite alongside the library:

```bash
# from the repo root — build the library, then serve the desktop folder
npm run build
npx serve desktop   # or any static server with the right MIME for .ts
```

For a real build, wire `desktop/` as the Tauri `frontendDist` (see
`src-tauri/tauri.conf.json`) and run `tauri build`.

## What it does

1. **Matter workspace** — drop files or paste text. Documents are chunked
   (passage-level, 256-token sliding window), embedded on-device, and held in
   IndexedDB custody. A progress bar reports passage count.
2. **Ask** — streaming RAG. Retrieves passages (hybrid BM25 + dense by
   default, optional cross-encoder rerank), streams a generated answer, and
   renders inline citation chips bound to the source passages.
3. **Custody panel** — the live capability matrix (WebGPU / WASM / SIMD /
   SharedArrayBuffer / IndexedDB), engine + index + document count + device
   tier, and an always-zero egress counter (asserted by the residency guard).
4. **Settings** — embedding model, matter id, hybrid/rerank toggles, export
   the matter, clear custody.

## LLM behavior

The app boots **retrieval-only** (no model download blocks startup) and
upgrades to a local LLM in the background when WebGPU is available
(Llama-3.2-3B-Instruct via WebLLM by default). Until the model loads, Ask
returns the retrieved passages directly. This mirrors the `FallbackLLMProvider`
cascade: GPU → WASM → retrieval-only.

## Tauri shell

A minimal shell config is in `desktop/src-tauri/`. The shell's only job is to
host the webview; all engine logic runs in JS/WASM inside it. The residency
boundary (zero egress except cache-once model weights) holds identically.
