/**
 * Node environment shim for the browser-born engine.
 *
 * The engine's storage layer speaks IndexedDB. In Node there is no native
 * IndexedDB, so we install `fake-indexeddb` on the global before any storage
 * is constructed. `ensureNodeEnv()` is idempotent.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let installed = false;

export function ensureNodeEnv(): void {
  if (installed) return;
  // Lazy-load so the shim only affects CLI processes, not the library bundle.
  const fake = require('fake-indexeddb') as {
    indexedDB: any;
    IDBKeyRange: any;
  };
  (globalThis as any).indexedDB = fake.indexedDB;
  (globalThis as any).IDBKeyRange = fake.IDBKeyRange;
  installed = true;
}
