/**
 * CLI command dispatch. Each command parses its own flags and delegates to the
 * engine. Keeps the entrypoint (index.ts) a thin argv parser.
 */

import { parseArgs } from 'node:util';

import { cmdInit } from './commands/init.js';
import { cmdServe } from './commands/serve.js';
import { cmdBench } from './commands/bench.js';
import { cmdExport } from './commands/export.js';
import { cmdImport } from './commands/import.js';
import { cmdCapabilities } from './commands/capabilities.js';

export async function runCommand(command: string, args: string[]): Promise<number> {
  switch (command) {
    case 'init':
      return cmdInit(args);
    case 'serve':
      return cmdServe(args);
    case 'bench':
      return cmdBench(args);
    case 'export':
      return cmdExport(args);
    case 'import':
      return cmdImport(args);
    case 'capabilities':
      return cmdCapabilities(args);
    default:
      return 1;
  }
}

/** Shared flag parser. Non-strict: unknown flags are tolerated. */
export function parseFlags(
  args: string[],
  options: {
    flags: Record<string, 'string' | 'boolean'>;
    allowPositionals?: boolean;
  }
): { values: Record<string, string | boolean | string[] | undefined>; positionals: string[] } {
  // Translate the shorthand `{flag: 'string'|'boolean'}` into Node's
  // `{flag: {type: 'string'|'boolean'}}` descriptor shape.
  const descriptor: Record<string, { type: 'string' | 'boolean' }> = {};
  for (const [k, v] of Object.entries(options.flags)) {
    descriptor[k] = { type: v };
  }
  const { values, positionals } = parseArgs({
    args,
    options: descriptor,
    allowPositionals: options.allowPositionals ?? true,
    strict: false,
  });
  return { values, positionals };
}
