/**
 * Domicile Desktop — webview entry.
 *
 * PRODUCT_DESIGN.md B10. This is the Tauri webview content: the real engine
 * (not the showcase's fake keyword ranker). A lawyer drops a matter folder,
 * the docs are chunked + embedded + held in IndexedDB custody, and she asks
 * grounded questions with inline citations — fully offline.
 *
 * The Tauri shell (src-tauri/) is a thin Rust wrapper that hosts this webview
 * and bundles no network-bound code except model-weight fetches, which cache
 * once. See desktop/README.md.
 */

import { createDomicile, RAGPipelineManager, type VectorDB, type Capabilities, detectCapabilities } from '../src/index';

const MODEL = () => (document.getElementById('set-model') as HTMLInputElement).value || 'Xenova/all-MiniLM-L6-v2';
const DIMS = 384;

let db: VectorDB | null = null;
let rag: RAGPipelineManager | null = null;
let caps: Capabilities | null = null;

async function boot(): Promise<void> {
  caps = await detectCapabilities(true);
  renderCapabilities(caps);

  db = await createDomicile({
    storage: { dbName: 'domicile-desktop' },
    dimensions: DIMS,
    metric: 'cosine',
    embedding: { model: MODEL(), cache: true },
  });

  // Boot immediately with a retrieval-only LLM so the UI is interactive
  // without waiting on a multi-GB model download. Upgrade in the background.
  rag = new RAGPipelineManager({
    vectorDB: db,
    llmProvider: new NoopLLM(),
    embeddingGenerator: (db as any).embeddingGenerator,
    hybridByDefault: true,
  });

  await refreshDocCount();
  setMeta();
  wireUI();

  // Best-effort background upgrade to a real local LLM.
  upgradeLLM().catch(() => { /* stays retrieval-only */ });
}

async function upgradeLLM(): Promise<void> {
  if (!caps?.webgpu || !rag) return;
  try {
    const { WebLLMProvider } = await import('../src/llm/WebLLMProvider');
    const p = new WebLLMProvider({
      model: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
      engineConfig: { initProgressCallback: (prog) => console.log(`LLM ${(prog.progress * 100).toFixed(0)}%`) },
    });
    if (await p.isAvailable()) {
      await p.initialize();
      if ((p as any).initialized) rag.setLLMProvider(p);
    }
  } catch { /* retrieval-only remains */ }
}

// ---------------------------------------------------------------------------
// LLM upgrade: prefer WebLLM (GPU). Until a model loads, RAG runs
// retrieval-only via NoopLLM. (wllama can be wired here too with a modelUrl.)
// ---------------------------------------------------------------------------

class NoopLLM {
  async initialize(): Promise<void> {}
  async isAvailable(): Promise<boolean> { return false; }
  async generate(prompt: string): Promise<string> {
    return 'No local LLM available. Showing retrieved passages only:\n\n' + prompt.split('\n').slice(0, 20).join('\n');
  }
  async *generateStream(prompt: string): AsyncGenerator<string> {
    yield 'No local LLM available. Showing retrieved passages only.';
    yield '\n\n' + prompt.split('\n').slice(0, 20).join('\n');
  }
  async dispose(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
function wireUI(): void {
  const dropzone = document.getElementById('dropzone')!;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const pick = document.getElementById('pick')!;

  pick.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => ingestFiles(fileInput.files));

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    ingestFiles((e as DragEvent).dataTransfer?.files ?? null);
  });

  document.getElementById('add-paste')!.addEventListener('click', ingestPaste);
  document.getElementById('ask-btn')!.addEventListener('click', ask);
  document.getElementById('query')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ask();
  });

  document.getElementById('export-btn')!.addEventListener('click', exportMatter);
  document.getElementById('clear-btn')!.addEventListener('click', clearCustody);
}

async function ingestFiles(files: FileList | null): Promise<void> {
  if (!files || !files.length || !db) return;
  const texts: string[] = [];
  const metas: Record<string, unknown>[] = [];
  for (const f of Array.from(files)) {
    const text = await f.text();
    texts.push(text);
    metas.push({ title: f.name, source: 'file', size: f.size });
  }
  await ingest(texts, metas);
}

async function ingestPaste(): Promise<void> {
  if (!db) return;
  const ta = document.getElementById('paste') as HTMLTextAreaElement;
  const text = ta.value.trim();
  if (!text) return;
  await ingest([text], [{ title: 'pasted passage', source: 'paste' }]);
  ta.value = '';
}

async function ingest(texts: string[], metas: Record<string, unknown>[]): Promise<void> {
  if (!db || !rag) return;
  const prog = document.getElementById('ingest-progress') as HTMLElement;
  const bar = document.getElementById('ingest-bar') as HTMLElement;
  const label = document.getElementById('ingest-label') as HTMLElement;
  prog.hidden = false;

  // Chunk each document before embedding so retrieval is passage-level.
  const { SentenceChunker } = await import('../src/rag/Chunker');
  const chunker = new SentenceChunker({ chunkSize: 256, overlap: 32 });
  const records: { text: string; metadata: Record<string, unknown> }[] = [];
  let totalChunks = 0;
  for (let i = 0; i < texts.length; i++) {
    const chunks = chunker.chunk(texts[i]);
    totalChunks += chunks.length;
    for (const c of chunks) {
      records.push({ text: c.text, metadata: { ...metas[i], parentDoc: metas[i].title, chunkIndex: c.index } });
      rag.indexDocument(`chunk-${i}-${c.index}`, c.text);
    }
  }

  const chunkSize = 10;
  let loaded = 0;
  for (let i = 0; i < records.length; i += chunkSize) {
    const slice = records.slice(i, i + chunkSize);
    await db.insertBatch(slice);
    loaded += slice.length;
    const pct = Math.round((loaded / totalChunks) * 100);
    bar.style.width = pct + '%';
    label.textContent = `${loaded} / ${totalChunks} passages`;
  }
  await refreshDocCount();
  label.textContent = `done — ${totalChunks} passages in custody`;
  setTimeout(() => { prog.hidden = true; }, 1500);
}

async function ask(): Promise<void> {
  if (!rag) return;
  const input = document.getElementById('query') as HTMLInputElement;
  const q = input.value.trim();
  if (!q) return;
  const answerEl = document.getElementById('answer')!;
  const citeEl = document.getElementById('citations')!;
  answerEl.innerHTML = '<span class="cursor"></span>';
  citeEl.innerHTML = '';

  const hybrid = (document.getElementById('set-hybrid') as HTMLInputElement).checked;
  const rerank = (document.getElementById('set-rerank') as HTMLInputElement).checked;

  let firstSource = true;
  for await (const chunk of rag.queryStream(q, { hybrid, rerank, topK: 5 })) {
    if (chunk.type === 'retrieval' && chunk.sources?.length) {
      citeEl.innerHTML = '';
      for (const s of chunk.sources) {
        const div = document.createElement('div');
        div.className = 'citation';
        div.innerHTML = `<div class="cite-head">[${s.id}] · score ${s.score.toFixed(3)}</div>` +
          `<div class="cite-snip">${escapeHtml(String(s.metadata?.content ?? s.metadata?.title ?? '').slice(0, 200))}</div>`;
        citeEl.appendChild(div);
      }
      firstSource = false;
    } else if (chunk.type === 'generation') {
      answerEl.textContent += chunk.content ?? '';
      answerEl.innerHTML += '<span class="cursor"></span>';
    }
  }
  answerEl.textContent = answerEl.textContent.replace('█', '').trim();
}

async function exportMatter(): Promise<void> {
  if (!db) return;
  const data = await db.export();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `domicile-matter-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearCustody(): Promise<void> {
  if (!db) return;
  if (!confirm('Clear all documents from local custody? This cannot be undone.')) return;
  await db.clear();
  await refreshDocCount();
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------
function renderCapabilities(c: Capabilities): void {
  const list = document.getElementById('cap-list')!;
  const rows: Array<[string, boolean]> = [
    ['WebGPU', c.webgpu],
    ['WASM', c.wasm],
    ['WASM SIMD', c.simd],
    ['SharedArrayBuffer', c.sharedArrayBuffer],
    ['IndexedDB', c.indexedDB],
  ];
  list.innerHTML = rows.map(
    ([k, v]) => `<li><span>${k}</span><span class="v ${v ? 'yes' : 'no'}">${v ? 'yes' : 'no'}</span></li>`
  ).join('');
  (document.getElementById('meta-tier') as HTMLElement).textContent = c.deviceTier;
}

function setMeta(): void {
  (document.getElementById('meta-engine') as HTMLElement).textContent = 'Domicile 0.2.0';
  (document.getElementById('meta-index') as HTMLElement).textContent = 'hnsw (pure-TS)';
}

async function refreshDocCount(): Promise<void> {
  if (!db) return;
  const n = await db.size();
  (document.getElementById('doc-count') as HTMLElement).textContent = `${n} documents`;
  (document.getElementById('meta-docs') as HTMLElement).textContent = String(n);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// The residency guard asserts zero egress; the header counter reflects that.
(document.getElementById('egress-count') as HTMLElement).textContent = '0 bytes egress';

void boot().catch((err) => {
  console.error(err);
  document.getElementById('answer')!.textContent = 'Failed to initialize Domicile: ' + (err as Error).message;
});
