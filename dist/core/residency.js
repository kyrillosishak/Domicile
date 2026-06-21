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
const DEFAULT_ALLOWED_HOSTS = [
    'huggingface.co',
    'cdn-lfs.huggingface.co',
    'cdn-lfs-us-1.huggingface.co',
    'cdn.jsdelivr.net',
    'esm.sh',
    'raw.githubusercontent.com',
];
export class ResidencyViolationError extends Error {
    constructor(host) {
        super(`Residency violation: network egress to disallowed host '${host}'. Only model-weight hosts are permitted.`);
        this.host = host;
        this.name = 'ResidencyViolationError';
        Object.setPrototypeOf(this, ResidencyViolationError.prototype);
    }
}
export class ResidencyGuard {
    constructor(config = {}) {
        this.installed = false;
        this.allowed = new Set(config.allowedHosts ?? DEFAULT_ALLOWED_HOSTS);
        // Default: enabled unless explicitly disabled or production.
        this.enabled = config.enabled ?? !isProduction();
    }
    isAllowed(url) {
        try {
            const { hostname } = new URL(url);
            return this.allowed.has(hostname);
        }
        catch {
            // Relative URLs (same-origin) are always allowed.
            return true;
        }
    }
    assert(url) {
        if (!this.enabled)
            return;
        if (!this.isAllowed(url)) {
            throw new ResidencyViolationError(this.hostOf(url));
        }
    }
    /**
     * Install fetch/XHR instrumentation. Call once in dev/test entrypoints.
     * No-op if disabled or already installed.
     */
    install() {
        if (!this.enabled || this.installed)
            return;
        this.installed = true;
        this.originalFetch = globalThis.fetch;
        const self = this;
        globalThis.fetch = ((input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            self.assert(url);
            return self.originalFetch(input, init);
        });
        this.originalXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            self.assert(url);
            return self.originalXHROpen.call(this, method, url, ...rest);
        };
    }
    /** Restore original fetch/XHR. */
    restore() {
        if (!this.installed)
            return;
        if (this.originalFetch)
            globalThis.fetch = this.originalFetch;
        if (this.originalXHROpen)
            XMLHttpRequest.prototype.open = this.originalXHROpen;
        this.installed = false;
    }
    hostOf(url) {
        try {
            return new URL(url).hostname;
        }
        catch {
            return url;
        }
    }
}
function isProduction() {
    // Vite/Node env convention.
    try {
        return import.meta?.env?.PROD === true || process?.env?.NODE_ENV === 'production';
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=residency.js.map