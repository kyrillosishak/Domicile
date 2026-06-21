/**
 * Domicile CLI — the integrator-facing binary.
 *
 * PRODUCT_DESIGN.md B9. Commands:
 *   domicile init [--template legal|health|blank]
 *   domicile serve [--transport stdio|sse] [--matter M-204] [--db <name>]
 *   domicile bench [--sizes 1k,10k] [--dims 128]
 *   domicile export [--db <name>] [--out matter.json] [--stream]
 *   domicile import [--db <name>] [--in matter.json]
 *   domicile capabilities
 *
 * Uses Node's built-in `parseArgs` (no extra runtime dep). The browser-born
 * engine needs an IndexedDB shim in Node; we install `fake-indexeddb` on the
 * global before constructing any storage-backed VectorDB.
 *
 * This is the thin front-end; it delegates to `createDomicile()`, `MCPServer`,
 * `benchmarkSuite`, and `VectorDB` export/import.
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { runCommand } from './commands.js';
async function main() {
    const argv = process.argv.slice(2);
    const command = argv[0];
    const rest = argv.slice(1);
    if (!command || command === '--help' || command === '-h') {
        printHelp();
        process.exit(command ? 0 : 1);
    }
    if (command === '--version' || command === '-v') {
        console.log('domicile 0.2.0');
        process.exit(0);
    }
    const known = ['init', 'serve', 'bench', 'export', 'import', 'capabilities'];
    if (!known.includes(command)) {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
    try {
        const code = await runCommand(command, rest);
        process.exit(code ?? 0);
    }
    catch (err) {
        console.error(`domicile ${command}: ${err?.message ?? err}`);
        process.exit(1);
    }
}
function printHelp() {
    console.log(`domicile 0.2.0 — private-AI custody platform CLI

Usage:
  domicile <command> [options]

Commands:
  init          Scaffold a Domicile project from a template
  serve         Run the MCP server (stdio/SSE) over the custody layer
  bench         Run the HnswIndex vs Voy benchmark suite
  export        Export a database to JSON
  import        Import a database from JSON
  capabilities  Print this machine's detected runtime capabilities

Options:
  -h, --help     Show this help
  -v, --version  Print version

Run "domicile <command> --help" for command-specific options.`);
}
void main();
export { parseArgs, readFileSync, writeFileSync, existsSync, mkdirSync, resolve, dirname, join };
//# sourceMappingURL=index.js.map