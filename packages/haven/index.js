/**
 * haven — DEPRECATED stub.
 *
 * The package was renamed to `domicile` (the residency thesis: data
 * domiciled on the device). This stub re-exports the full domicile API so
 * existing `npm install haven` consumers keep working, with a one-time
 * deprecation notice nudging them to migrate. It will be retired after two
 * domicile majors (PRODUCT_DESIGN.md A1).
 *
 * Migration:
 *   npm uninstall haven && npm install domicile
 *   - import { VectorDB } from 'haven'
 *   + import { Domicile } from 'domicile'   // VectorDB is re-exported too
 */

let warned = false;
function warnOnce() {
  if (warned || typeof process !== 'undefined' && process.env?.HAVEN_NO_DEPRECATION) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[haven] 'haven' has been renamed to 'domicile'. " +
      "Run `npm install domicile` and update your imports. " +
      "Set HAVEN_NO_DEPRECATION=1 to silence this. This stub retires after two domicile majors."
  );
}

warnOnce();

export * from 'domicile';
export { default } from 'domicile';
