# Domicile Integrator Pack

Templates and hand-off tooling for integrators deploying Domicile into a
regulated vertical. PRODUCT_DESIGN.md A2 / A7 (Phase 7).

A residency profile bundles: an embedding model + dimensions, a default matter
scope, a system prompt appropriate to the vertical, and the scope-enforcement
flags. The `domicile init --template <profile>` command (src/cli/commands/init.ts)
scaffolds a project from one of these. The files here are the canonical
source for those templates, usable standalone.

## Profiles

- **legal** — attorney-client privilege: matter-scoped, privilege-aware prompt,
  citation-required. The flagship vertical (MARKET_ANALYSIS.md §3.1).
- **health** — PHI custody: per-patient scope, no-diagnosis-inference prompt.
- **blank** — configure your own model, scope, and prompt.

## Using a profile

```bash
# Scaffold a runnable app from a profile
npx domicile init --template legal --out ./my-firm-app

# Or hand-off an existing matter for another deployment
npx domicile export --db matter-204 --out matter-204.json
npx domicile import --db matter-204-copy --in matter-204.json
```

## Residency enforcement

Every profile enforces the residency boundary (docs/PRODUCT_DESIGN.md A6.1):
no package initiates outbound network for user data. Model-weight downloads are
the only egress, are cache-once, and are configurable to a self-hostable
origin via the `ModelSource` allowlist. The `ResidencyGuard` (test-only,
tree-shaken in prod) asserts this is machine-checkable.

## Hand-off / export

`domicile export --stream` produces NDJSON for large matters; `domicile import`
rehydrates into a fresh custody store. The serialized index is the HnswIndex
binary graph (compact, incrementally updateable) — not a giant JSON blob.

## Validating before deploy

```bash
npx domicile capabilities        # what this machine can run
npx domicile bench --sizes 1k,10k  # prove the index holds at your scale
```
