/**
 * Residency boundary enforcement.
 *
 * Domicile's moat is architectural privacy: user data never leaves the
 * device. This module makes that claim machine-checkable rather than
 * rhetorical. The only permitted egress is model-weight downloads, and
 * only to allowlisted hosts (configurable to a self-hostable origin).
 *
 * In production builds the hard guard is a no-op (tree-shaken) to avoid
 * runtime overhead; in dev/test it instruments `fetch`/`XMLHttpRequest`
 * and throws on any egress to a non-allowlisted host.
 */

export interface ResidencyConfig {
  /**
   * Hosts allowed for model-weight downloads. Default: Hugging Face CDN
   * and jsdelivr (where Transformers.js / WebLLM weights are served).
   * Set to a self-hostable origin for air-gapped/on-prem deployments.
   */
  allowedHosts?: string[];
  /** Enable the dev-mode hard guard. Default: true in dev, false in prod. */
  enabled?: boolean;
}

const DEFAULT_ALLOWED_HOSTS = [
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn.jsdelivr.net',
  'esm.sh',
  'raw.githubusercontent.com',
];

export class ResidencyViolationError extends Error {
  constructor(public readonly host: string) {
    super(`Residency violation: network egress to disallowed host '${host}'. Only model-weight hosts are permitted.`);
    this.name = 'ResidencyViolationError';
    Object.setPrototypeOf(this, ResidencyViolationError.prototype);
  }
}

export class ResidencyGuard {
  private allowed: Set<string>;
  private enabled: boolean;
  private installed = false;
  private originalFetch?: typeof fetch;
  private originalXHROpen?: typeof XMLHttpRequest.prototype.open;

  constructor(config: ResidencyConfig = {}) {
    this.allowed = new Set(config.allowedHosts ?? DEFAULT_ALLOWED_HOSTS);
    // Default: enabled unless explicitly disabled or production.
    this.enabled = config.enabled ?? !isProduction();
  }

  isAllowed(url: string): boolean {
    try {
      const { hostname } = new URL(url);
      return this.allowed.has(hostname);
    } catch {
      // Relative URLs (same-origin) are always allowed.
      return true;
    }
  }

  assert(url: string): void {
    if (!this.enabled) return;
    if (!this.isAllowed(url)) {
      throw new ResidencyViolationError(this.hostOf(url));
    }
  }

  /**
   * Install fetch/XHR instrumentation. Call once in dev/test entrypoints.
   * No-op if disabled or already installed.
   */
  install(): void {
    if (!this.enabled || this.installed) return;
    this.installed = true;

    this.originalFetch = globalThis.fetch;
    const self = this;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      self.assert(url);
      return self.originalFetch!(input, init);
    }) as typeof fetch;

    this.originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string, ...rest: any[]) {
      self.assert(url);
      return (self.originalXHROpen as any).call(this, method, url, ...rest);
    };
  }

  /** Restore original fetch/XHR. */
  restore(): void {
    if (!this.installed) return;
    if (this.originalFetch) globalThis.fetch = this.originalFetch;
    if (this.originalXHROpen) XMLHttpRequest.prototype.open = this.originalXHROpen;
    this.installed = false;
  }

  private hostOf(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }
}

function isProduction(): boolean {
  // Vite/Node env convention.
  try {
    return (import.meta as any)?.env?.PROD === true || process?.env?.NODE_ENV === 'production';
  } catch {
    return false;
  }
}
