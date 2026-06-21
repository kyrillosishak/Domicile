/**
 * domicile export — dump a database to JSON.
 *
 * Uses the streaming export so large corpora don't blow memory: each yielded
 * chunk is written as a newline-delimited JSON record (NDJSON) when --stream
 * is set, or assembled into one JSON object otherwise.
 */

import { writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { parseFlags } from '../commands.js';
import { ensureNodeEnv } from '../env.js';

export async function cmdExport(args: string[]): Promise<number> {
  const { values } = parseFlags(args, {
    flags: {
      db: 'string',
      out: 'string',
      stream: 'boolean',
      'embedding-model': 'string',
      dimensions: 'string',
      help: 'boolean',
    },
  });

  if (values.help) {
    console.log(`domicile export — export a database to JSON

Options:
  --db <name>                     IndexedDB database name (default: domicile-mcp)
  --out <file>                    Output file (default: ./export.json)
  --stream                        Write NDJSON (one chunk per line) for large corpora
  --embedding-model <id>          Embedding model id (must match the DB's)
  --dimensions <n>                Embedding dimensions (must match the DB's)
  --help                          Show this help`);
    return 0;
  }

  ensureNodeEnv();

  const dbName = (values.db as string) ?? 'domicile-mcp';
  const out = resolve((values.out as string) ?? './export.json');
  const stream = Boolean(values.stream);
  const embeddingModel = (values['embedding-model'] as string) ?? 'Xenova/all-MiniLM-L6-v2';
  const dimensions = Number(values.dimensions ?? 384);

  const { createDomicile } = await import('../../index.js');
  const db = await createDomicile({
    storage: { dbName },
    dimensions,
    metric: 'cosine',
    embedding: { model: embeddingModel, cache: true },
  });

  if (stream) {
    const ws = createWriteStream(out);
    let records = 0;
    for await (const chunk of db.exportStream()) {
      ws.write(JSON.stringify(chunk) + '\n');
      if (chunk.type === 'vectors') records += chunk.data.length;
    }
    await new Promise<void>((res, rej) => ws.end((err: Error | null | undefined) => (err ? rej(err) : res())));
    console.log(`Exported ${records} vectors (streamed/NDJSON) to ${out}`);
  } else {
    const data = await db.export();
    writeFileSync(out, JSON.stringify(data, null, 2));
    console.log(`Exported ${data.vectors.length} vectors to ${out}`);
  }

  await db.dispose();
  return 0;
}
