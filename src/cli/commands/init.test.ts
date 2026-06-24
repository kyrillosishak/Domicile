import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cmdInit } from './init.ts';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

describe('cmdInit', () => {
  const testDir = resolve(tmpdir(), `domicile-test-${Date.now()}`);

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should show help and return 0', async () => {
    const result = await cmdInit(['--help']);
    expect(result).toBe(0);
  });

  it('should scaffold blank template by default', async () => {
    const outDir = resolve(testDir, 'blank-test');
    const result = await cmdInit(['--out', outDir]);
    expect(result).toBe(0);
    expect(existsSync(resolve(outDir, 'index.ts'))).toBe(true);
    expect(existsSync(resolve(outDir, 'README.md'))).toBe(true);
    expect(existsSync(resolve(outDir, 'package.snippet.json'))).toBe(true);
  });

  it('should scaffold legal template', async () => {
    const outDir = resolve(testDir, 'legal-test');
    const result = await cmdInit(['--template', 'legal', '--out', outDir]);
    expect(result).toBe(0);
    const indexContent = readFileSync(resolve(outDir, 'index.ts'), 'utf-8');
    expect(indexContent).toContain('legal-custody');
    expect(indexContent).toContain('M-DEMO');
    expect(indexContent).toContain('Xenova/all-MiniLM-L6-v2');
  });

  it('should scaffold health template', async () => {
    const outDir = resolve(testDir, 'health-test');
    const result = await cmdInit(['--template', 'health', '--out', outDir]);
    expect(result).toBe(0);
    const indexContent = readFileSync(resolve(outDir, 'index.ts'), 'utf-8');
    expect(indexContent).toContain('health-custody');
    expect(indexContent).toContain('PATIENT-DEMO');
  });

  it('should scaffold blank template', async () => {
    const outDir = resolve(testDir, 'blank-test-2');
    const result = await cmdInit(['--template', 'blank', '--out', outDir]);
    expect(result).toBe(0);
    const indexContent = readFileSync(resolve(outDir, 'index.ts'), 'utf-8');
    expect(indexContent).toContain('blank-custody');
  });

  it('should return 1 for unknown template', async () => {
    const result = await cmdInit(['--template', 'unknown', '--out', resolve(testDir, 'unknown')]);
    expect(result).toBe(1);
  });

  it('should include correct dependencies in package.snippet.json', async () => {
    const outDir = resolve(testDir, 'deps-test');
    await cmdInit(['--out', outDir]);
    const pkgContent = readFileSync(resolve(outDir, 'package.snippet.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    expect(pkg.dependencies['@kyrillosishak/domicile']).toBeDefined();
  });

  it('should use custom out directory', async () => {
    const customDir = resolve(tmpdir(), `domicile-custom-${Date.now()}`);
    try {
      const result = await cmdInit(['--out', customDir]);
      expect(result).toBe(0);
      expect(existsSync(resolve(customDir, 'index.ts'))).toBe(true);
    } finally {
      if (existsSync(customDir)) rmSync(customDir, { recursive: true, force: true });
    }
  });
});