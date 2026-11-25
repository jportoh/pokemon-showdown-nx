// The update gate's screen in a browser, every state at once, to check its look without a console:
// builds native/preview/gate-preview.ts into dist/gate-preview/ and serves it on http://localhost:8090/
// (index.html: each state in light and dark; screen.html?view=…&appearance=…&theme=…: one, full size).
//
// Usage: node scripts/gate-preview.mjs [--theme=zafiro] [--port=8090]

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'dist/gate-preview');
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const theme = option('theme') ?? 'zafiro';
const port = Number(option('port') ?? 8090);

const VIEWS = ['checking', 'downloading', 'downloading-nro', 'installing', 'starting', 'nro-ready', 'installing-nro', 'install-failed', 'check-failed', 'needs-nro', 'start-failed'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'logo'), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, 'native/preview/gate-preview.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: path.join(out, 'gate-preview.js'),
  logLevel: 'warning',
});
fs.copyFileSync(path.join(root, 'public/logo/showdown-gold-120.png'), path.join(out, 'logo/showdown-gold-120.png'));
fs.writeFileSync(
  path.join(out, 'screen.html'),
  '<!doctype html><meta charset="utf-8"><title>Gate</title><style>html,body{margin:0;background:#000}canvas{display:block;width:1280px;height:720px}</style><canvas width="1280" height="720"></canvas><script type="module" src="gate-preview.js"></script>',
);
const cells = ['light', 'dark']
  .flatMap((appearance) => VIEWS.map((view) => `<figure><iframe src="screen.html?view=${view}&appearance=${appearance}&theme=${theme}" width="1280" height="720"></iframe><figcaption>${view} · ${appearance}</figcaption></figure>`))
  .join('');
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Gate preview</title><style>body{margin:16px;background:#222;color:#ddd;font:14px sans-serif;display:flex;flex-wrap:wrap;gap:16px}figure{margin:0;width:640px;height:380px;overflow:hidden}iframe{border:0;transform:scale(.5);transform-origin:0 0}figcaption{position:relative;top:-356px}</style>${cells}`,
);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
http
  .createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(out, name);
    if (name.includes('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  })
  .listen(port, () => console.log(`Gate preview (theme ${theme}): http://localhost:${port}/`));
