/**
 * One place that names this package for runtime code.
 *
 * The Host cannot always read its own package.json (a bundled entry may run from
 * a flat install), and the settings panel is a browser bundle, so both sides
 * import this constant instead of repeating the literal. `scripts/verify-package.mjs`
 * fails the build when it drifts from package.json, which keeps the rename honest.
 */
export const PACKAGE_NAME = '@luyanci/dsh-im';

/** Unscoped file stem npm uses for this package's tarball. */
export function tarballFileName(version) {
  return `${PACKAGE_NAME.slice(PACKAGE_NAME.lastIndexOf('/') + 1)}-${version}.tgz`;
}

/** The exact tarball path a release of this package must live at. */
export function tarballPath(version) {
  return `/${PACKAGE_NAME}/-/${tarballFileName(version)}`;
}
