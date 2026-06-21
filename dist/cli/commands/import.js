/**
 * domicile import — load a database from JSON produced by `domicile export`.
 *
 * Accepts both forms `domicile export` can write:
 *   - single-object JSON (default), or
 *   - NDJSON stream (`export --stream`): one `{type, data}` record per line,
 *     with `metadata` / `vectors` / `index` chunks. We reassemble these into
 *     the `ExportData` shape the engine's `import()` expects, streaming the
 *     file line-by-line so large corpora don't have to be held whole.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseFlags } from '../commands.js';
import { ensureNodeEnv } from '../env.js';
/** True if `raw` looks like an NDJSON stream (≥2 top-level JSON lines). */
export function looksLikeNdjson(raw) {
    let lines = 0;
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t)
            continue;
        if (!t.startsWith('{') || !t.endsWith('}'))
            return false; // pretty-printed object spans lines
        lines++;
        if (lines >= 2)
            return true;
    }
    return false;
}
/** Reassemble an NDJSON stream into the `ExportData` shape `import()` expects. */
export function parseNdjson(raw) {
    const data = {
        version: '1.0.0',
        config: {},
        vectors: [],
        index: '',
        metadata: { exportedAt: 0, vectorCount: 0, dimensions: 0 },
    };
    let records = 0;
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t)
            continue;
        const rec = JSON.parse(t);
        switch (rec.type) {
            case 'metadata': {
                const m = rec.data;
                data.version = m.version ?? data.version;
                data.config = m.config ?? data.config;
                data.metadata = m.metadata ?? data.metadata;
                break;
            }
            case 'vectors': {
                const batch = rec.data;
                for (const v of batch)
                    data.vectors.push(v);
                records += batch.length;
                break;
            }
            case 'index': {
                data.index = rec.data ?? '';
                break;
            }
            default:
                // Unknown chunk type — ignore for forward-compat.
                break;
        }
    }
    if (data.metadata.vectorCount === 0) {
        data.metadata.vectorCount = records;
    }
    return data;
}
export async function cmdImport(args) {
    const { values } = parseFlags(args, {
        flags: {
            db: 'string',
            in: 'string',
            'embedding-model': 'string',
            dimensions: 'string',
            help: 'boolean',
        },
    });
    if (values.help) {
        console.log(`domicile import — import a database from JSON

Options:
  --db <name>                     IndexedDB database name (default: domicile-mcp)
  --in <file>                     Input file (default: ./export.json); accepts
                                  single-object JSON or NDJSON from 'export --stream'
  --embedding-model <id>          Embedding model id (must match the export's)
  --dimensions <n>                Embedding dimensions (must match the export's)
  --help                          Show this help`);
        return 0;
    }
    ensureNodeEnv();
    const dbName = values.db ?? 'domicile-mcp';
    const input = resolve(values.in ?? './export.json');
    const embeddingModel = values['embedding-model'] ?? 'Xenova/all-MiniLM-L6-v2';
    const dimensions = Number(values.dimensions ?? 384);
    // Decide NDJSON vs single-object from the file contents.
    const raw = readFileSync(input, 'utf-8');
    const data = looksLikeNdjson(raw)
        ? parseNdjson(raw)
        : JSON.parse(raw);
    const { createDomicile } = await import('../../index.js');
    const db = await createDomicile({
        storage: { dbName },
        dimensions,
        metric: 'cosine',
        embedding: { model: embeddingModel, cache: true },
    });
    await db.import(data);
    console.log(`Imported ${data.vectors?.length ?? 0} vectors into ${dbName}`);
    await db.dispose();
    return 0;
}
//# sourceMappingURL=import.js.map