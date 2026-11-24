// Signs the online update that `npm run build:nro` wrote to dist/nro/update/ (docs/updates.md):
// update.json.sig is the ECDSA P-256 / SHA-256 signature (raw r||s, base64) of update.json's exact
// bytes. The app only takes an update whose manifest verifies with the public key it ships with
// (src/app/core/update/update-config.ts).
//
//   UPDATE_SIGNING_KEY="<PEM>" node scripts/sign-update.mjs     (CI: a repository secret)
//   node scripts/sign-update.mjs --key=<path to the PEM file>
//   node scripts/sign-update.mjs --check    only checks the key (CI, on every push to main)
//
// The key must be the pair of the public key the app ships with: a wrong one fails here, not on the
// players' consoles (they would reject every update it signs).
//
// The private key never goes in the repository. If it is lost, a new key pair means a new .nro (the
// public key is inside the app's code).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'dist/nro/update');
const keyOption = process.argv.find((arg) => arg.startsWith('--key='))?.slice('--key='.length);
const pem = keyOption ? fs.readFileSync(keyOption, 'utf8') : process.env.UPDATE_SIGNING_KEY;
if (!pem) {
  console.error('No signing key: set UPDATE_SIGNING_KEY or pass --key=<file>.');
  process.exit(1);
}

let key;
try {
  key = crypto.createPrivateKey(pem);
} catch (error) {
  console.error(`The signing key isn't a valid PEM private key (${error instanceof Error ? error.message : error}). Paste the whole file, BEGIN and END lines included.`);
  process.exit(1);
}
const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-65).toString('base64');
const shipped = /UPDATE_PUBLIC_KEY = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'src/app/core/update/update-config.ts'), 'utf8'))?.[1];
if (publicKey !== shipped) {
  console.error(`The signing key (public ${publicKey.slice(0, 12)}…) isn't the pair of the app's UPDATE_PUBLIC_KEY (${shipped?.slice(0, 12)}…).`);
  process.exit(1);
}
if (process.argv.includes('--check')) {
  console.log(`The signing key matches the app's public key (${publicKey.slice(0, 12)}…).`);
  process.exit(0);
}
const manifest = fs.readFileSync(path.join(dir, 'update.json'));
const { file, sha256 } = JSON.parse(manifest.toString('utf8'));
const bundle = fs.readFileSync(path.join(dir, file));
if (crypto.createHash('sha256').update(bundle).digest('hex') !== sha256) throw new Error(`${file} doesn't match update.json`);
const signature = crypto.sign('sha256', manifest, { key, dsaEncoding: 'ieee-p1363' });
if (!crypto.verify('sha256', manifest, { key: crypto.createPublicKey(key), dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Signature check failed');
fs.writeFileSync(path.join(dir, 'update.json.sig'), signature.toString('base64'));
console.log(`Signed update.json (${file}) with the key ${publicKey.slice(0, 12)}…`);
