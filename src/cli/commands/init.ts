/**
 * domicile init — scaffold a project from a residency-profile template.
 *
 * PRODUCT_DESIGN.md B9 / Phase 7 Integrator Pack. Writes a small, runnable
 * `index.ts` that wires `createDomicile()` with the template's model + scope
 * defaults, plus a package.json snippet. Templates encode residency profiles
 * (legal / health / blank).
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseFlags } from '../commands.js';

interface Template {
  name: string;
  matterScope?: string;
  embeddingModel: string;
  dimensions: number;
  llmHint: string;
  systemPrompt: string;
  readme: string;
}

const TEMPLATES: Record<string, Template> = {
  legal: {
    name: 'legal',
    matterScope: 'M-DEMO',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    llmHint: 'Llama-3.2-3B-Instruct (wllama) or Qwen2.5-7B (WebLLM)',
    systemPrompt:
      'You are a legal-research assistant operating under attorney-client privilege. ' +
      'Answer ONLY from the provided matter context. Cite each claim by [n]. ' +
      'If the context is insufficient, say so — never fabricate citations or statutes.',
    readme: 'Legal matter custody: matter-scoped RAG with privilege-aware prompts.',
  },
  health: {
    name: 'health',
    matterScope: 'PATIENT-DEMO',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    llmHint: 'Llama-3.2-3B-Instruct (wllama)',
    systemPrompt:
      'You are a clinical-record assistant. Use only the provided patient context. ' +
      'Do not infer diagnoses beyond the record. Flag uncertainty explicitly.',
    readme: 'Health-record custody: PHI stays on-device, scope-enforced per patient.',
  },
  blank: {
    name: 'blank',
    embeddingModel: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    llmHint: 'any',
    systemPrompt:
      'You are a helpful assistant. Answer from the provided context and cite by [n].',
    readme: 'Blank custody template — configure your own model, scope, and prompt.',
  },
};

export async function cmdInit(args: string[]): Promise<number> {
  const { values } = parseFlags(args, {
    flags: { template: 'string', out: 'string', help: 'boolean' },
  });

  if (values.help) {
    console.log(`domicile init — scaffold a project

Options:
  --template <legal|health|blank>   Residency profile (default: blank)
  --out <dir>                        Output directory (default: ./domicile-app)
  --help                             Show this help`);
    return 0;
  }

  const templateName = (values.template as string) ?? 'blank';
  const template = TEMPLATES[templateName];
  if (!template) {
    console.error(`Unknown template: ${templateName}. Choose legal|health|blank.`);
    return 1;
  }

  const outDir = resolve((values.out as string) ?? './domicile-app');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const entry = renderEntry(template);
  writeFileSync(resolve(outDir, 'index.ts'), entry);
  writeFileSync(resolve(outDir, 'README.md'), `# Domicile app\n\n${template.readme}\n`);
  writeFileSync(
    resolve(outDir, 'package.snippet.json'),
    JSON.stringify(
      {
        dependencies: {
          domicile: '^0.2.0',
        },
      },
      null,
      2
    ) + '\n'
  );

  console.log(`Scaffolded ${templateName} template in ${outDir}`);
  console.log(`  index.ts          createDomicile() wired with ${template.embeddingModel} (${template.dimensions}d)`);
  if (template.matterScope) console.log(`  matter scope       ${template.matterScope}`);
  console.log(`  suggested LLM      ${template.llmHint}`);
  console.log(`\nNext: cd ${outDir} && npm install domicile && npx tsx index.ts`);
  return 0;
}

function renderEntry(t: Template): string {
  return `// Scaffolded by \`domicile init --template ${t.name}\`.
// Domicile runs entirely on-device; no data egresses except model-weight
// downloads (cache-once). See docs/PRODUCT_DESIGN.md.

import { createDomicile, MCPServer, RAGPipelineManager, FallbackLLMProvider, WebLLMProvider, WllamaProvider } from 'domicile';

async function main() {
  const db = await createDomicile({
    storage: { dbName: '${t.name}-custody' },
    dimensions: ${t.dimensions},
    metric: 'cosine',
    indexType: 'hnsw',
    embedding: { model: '${t.embeddingModel}', cache: true },
  });

  // Insert a document (chunked + embedded on-device).
  await db.insert({ text: 'Hello from Domicile.', metadata: { source: 'seed' } });

  const results = await db.search({ text: 'hello', k: 3 });
  console.log('search hits:', results.map((r) => ({ id: r.id, score: r.score.toFixed(3) })));

  // Optional: mount the custody layer as an MCP server for an agent stack.
  // const mcp = new MCPServer({ vectorDB: db ${t.matterScope ? `, scope: { matterId: '${t.matterScope}', enforceOn: ['search','insert','delete','rag'] }` : ''} });
  // await mcp.serve('stdio');

  await db.dispose();
}

main().catch((err) => { console.error(err); process.exit(1); });
`;
}
