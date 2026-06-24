import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseFlags, runCommand } from './commands.js';

describe('CLI commands', () => {
  describe('parseFlags', () => {
    it('should parse string flags', () => {
      const { values, positionals } = parseFlags(['--db', 'test', '--out', 'file.json'], {
        flags: { db: 'string', out: 'string' },
      });
      expect(values.db).toBe('test');
      expect(values.out).toBe('file.json');
      expect(positionals).toEqual([]);
    });

    it('should parse boolean flags', () => {
      const { values } = parseFlags(['--stream', '--help'], {
        flags: { stream: 'boolean', help: 'boolean' },
      });
      expect(values.stream).toBe(true);
      expect(values.help).toBe(true);
    });

    it('should handle missing flags', () => {
      const { values } = parseFlags([], {
        flags: { db: 'string', stream: 'boolean' },
      });
      expect(values.db).toBeUndefined();
      expect(values.stream).toBeUndefined(); // boolean flags default to undefined, not false
    });

    it('should handle positionals', () => {
      const { values, positionals } = parseFlags(['positional1', 'positional2', '--db', 'test'], {
        flags: { db: 'string' },
        allowPositionals: true,
      });
      expect(positionals).toEqual(['positional1', 'positional2']);
      expect(values.db).toBe('test');
    });

    it('should handle flags with equals', () => {
      const { values } = parseFlags(['--db=test', '--out=file.json'], {
        flags: { db: 'string', out: 'string' },
      });
      expect(values.db).toBe('test');
      expect(values.out).toBe('file.json');
    });
  });

  describe('runCommand', () => {
    it('should return 1 for unknown command', async () => {
      const result = await runCommand('unknown', []);
      expect(result).toBe(1);
    });

    it('should call init command', async () => {
      // We can't easily test the actual command without mocking fs
      // Just verify the dispatch works
      const result = await runCommand('init', ['--help']);
      expect(result).toBe(0);
    });

    it('should call capabilities command', async () => {
      const result = await runCommand('capabilities', ['--help']);
      expect(result).toBe(0);
    });

    it('should call export command', async () => {
      const result = await runCommand('export', ['--help']);
      expect(result).toBe(0);
    });

    it('should call import command', async () => {
      const result = await runCommand('import', ['--help']);
      expect(result).toBe(0);
    });

    it('should call serve command', async () => {
      const result = await runCommand('serve', ['--help']);
      expect(result).toBe(0);
    });

    it('should call bench command', async () => {
      const result = await runCommand('bench', ['--help']);
      expect(result).toBe(0);
    });
  });
});