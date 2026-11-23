// Signs the online update that `npm run build:nro` wrote to dist/nro/update/ (docs/updates.md):
// update.json.sig is the ECDSA P-256 / SHA-256 signature (raw r||s, base64) of update.json's exact
// bytes. The app only takes an update whose manifest verifies with the public key it ships with
// (src/app/core/update/update-config.ts).
//
//   UPDATE_SIGNING_KEY="<PEM>" node scripts/sign-update.mjs     (CI: a repository secret)
//   node scripts/sign-update.mjs --key=<path to the PEM file>
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

const manifestPath = path.join(dir, 'update.json');
const manifest = fs.readFileSync(manifestPath);
const { file, sha256 } = JSON.parse(manifest.toString('utf8'));
const bundle = fs.readFileSync(path.join(dir, file));
if (crypto.createHash('sha256').update(bundle).digest('hex') !== sha256) throw new Error(`${file} doesn't match update.json`);

const key = crypto.createPrivateKey(pem);
const signature = crypto.sign('sha256', manifest, { key, dsaEncoding: 'ieee-p1363' });
if (!crypto.verify('sha256', manifest, { key: crypto.createPublicKey(key), dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Signature check failed');
fs.writeFileSync(path.join(dir, 'update.json.sig'), signature.toString('base64'));
const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-65).toString('base64');
console.log(`Signed update.json (${file}) with the key ${publicKey.slice(0, 12)}…`);
