// Serves a test online update to a console on the local network, over plain http (docs/updates.md):
// the folder with update.json, its signature and the files it names (the code, the asset pack, a
// .nro). Put the printed URL in sdmc:/switch/pokemon-showdown-nx/update-channel.txt. The update
// still needs a valid signature; the signed manifest holds every other file's hashes.
//
// Usage: node scripts/serve-update.mjs <folder> [--port=8080]

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const folder = path.resolve(process.argv.find((arg, i) => i > 1 && !arg.startsWith('--')) ?? 'dist/nro/update');
const port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice('--port='.length) ?? 8080);
if (!fs.existsSync(path.join(folder, 'update.json'))) {
  console.error(`No update.json in ${folder}`);
  process.exit(1);
}

const TYPES = { '.json': 'application/json', '.mjs': 'text/javascript', '.sig': 'text/plain' };

const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname).replace(/^\/+/, '');
  const file = path.join(folder, name);
  const stat = name && !name.includes('..') && !name.includes('/') && fs.existsSync(file) ? fs.statSync(file) : null;
  if (!stat?.isFile()) {
    response.writeHead(404).end();
    console.log(`404 ${request.socket.remoteAddress} /${name}`);
    return;
  }
  const started = Date.now();
  response.writeHead(200, { 'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream', 'content-length': stat.size });
  fs.createReadStream(file)
    .pipe(response)
    .on('finish', () => console.log(`200 ${request.socket.remoteAddress} /${name} · ${(stat.size / 1048576).toFixed(1)} MiB in ${((Date.now() - started) / 1000).toFixed(1)} s`));
});

server.listen(port, () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  console.log(`Serving ${folder} on port ${port}. For update-channel.txt:`);
  for (const address of addresses) console.log(`  http://${address}:${port}/update.json`);
});
