import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ResidencyGuard, ResidencyViolationError } from './residency';

describe('ResidencyGuard', () => {
  let guard: ResidencyGuard;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    guard?.restore();
  });

  it('should allow same-origin relative URLs', () => {
    guard = new ResidencyGuard({ enabled: true });
    expect(guard.isAllowed('/api/local')).toBe(true);
    expect(guard.isAllowed('./relative')).toBe(true);
  });

  it('should allow allowed hosts by default', () => {
    guard = new ResidencyGuard({ enabled: true });
    expect(guard.isAllowed('https://huggingface.co/model')).toBe(true);
    expect(guard.isAllowed('https://cdn.jsdelivr.net/npm/package')).toBe(true);
  });

  it('should block disallowed hosts', () => {
    guard = new ResidencyGuard({ enabled: true });
    expect(guard.isAllowed('https://evil.com/steal')).toBe(false);
    expect(guard.isAllowed('https://analytics.tracker.com')).toBe(false);
  });

  it('should throw on disallowed host when enabled', () => {
    guard = new ResidencyGuard({ enabled: true });
    expect(() => guard.assert('https://evil.com/steal')).toThrow(ResidencyViolationError);
  });

  it('should not throw when disabled', () => {
    guard = new ResidencyGuard({ enabled: false });
    expect(() => guard.assert('https://evil.com/steal')).not.toThrow();
  });

  it('should respect custom allowed hosts', () => {
    guard = new ResidencyGuard({ enabled: true, allowedHosts: ['my-own-host.com'] });
    expect(guard.isAllowed('https://my-own-host.com/model')).toBe(true);
    expect(guard.isAllowed('https://huggingface.co/model')).toBe(false);
  });

  it('should install and restore fetch instrumentation', () => {
    const originalFetch = globalThis.fetch;
    guard = new ResidencyGuard({ enabled: true });
    guard.install();
    expect(globalThis.fetch).not.toBe(originalFetch);
    guard.restore();
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('should install and restore XHR instrumentation', () => {
    const originalOpen = XMLHttpRequest.prototype.open;
    guard = new ResidencyGuard({ enabled: true });
    guard.install();
    expect(XMLHttpRequest.prototype.open).not.toBe(originalOpen);
    guard.restore();
    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
  });

  it('should not double-install', () => {
    guard = new ResidencyGuard({ enabled: true });
    guard.install();
    const firstFetch = globalThis.fetch;
    guard.install();
    expect(globalThis.fetch).toBe(firstFetch);
  });
});

describe('ResidencyViolationError', () => {
  it('should include the violating host in message', () => {
    const err = new ResidencyViolationError('bad.com');
    expect(err.message).toContain('bad.com');
    expect(err.host).toBe('bad.com');
  });
});