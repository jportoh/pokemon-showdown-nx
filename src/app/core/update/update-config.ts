/** Where the online updates are published (docs/updates.md): the repository's GitHub releases. */
const REPO = 'jportoh/pokemon-showdown-nx';

/**
 * The latest release's manifest (GitHub redirects to the release's file); its signature and code
 * bundle sit next to it (`<manifest>.sig`, the manifest's `file`). Pre-releases are never "latest".
 */
const LATEST_MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/update.json`;

/**
 * For testing on a console: an https URL in this SD file replaces the latest release's manifest
 * (say, a pre-release's). Its updates still need a valid signature.
 */
export const CHANNEL_OVERRIDE_PATH = 'sdmc:/switch/pokemon-showdown-nx/update-channel.txt';

export function manifestUrl(override: string | null): string {
  return override && /^https:\/\/[^\s]+$/.test(override) ? override : LATEST_MANIFEST_URL;
}

/** A file next to the manifest (its signature, the code bundle). */
export function siblingUrl(manifest: string, file: string): string {
  return new URL(encodeURIComponent(file), manifest).toString();
}

/** The releases page, for the player when a new .nro is needed. */
export const RELEASES_PAGE = `github.com/${REPO}/releases`;

/**
 * The ECDSA P-256 public key (raw, uncompressed, base64) the manifests are signed with: CI signs
 * them with the UPDATE_SIGNING_KEY secret (scripts/sign-update.mjs). Changing it needs a new .nro.
 */
export const UPDATE_PUBLIC_KEY = 'BP7pIRU+L4NCaWGgyQpVD4uVvwRo8vGQ19wMxBJoy6kssX8camuk2oU0vhjODymQEn7sF15ReyKcWFrOnfUMG5Y=';
