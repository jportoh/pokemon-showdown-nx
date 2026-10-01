// Turns the Angular production build into a bundle the Brewser console can run.
//
// Brewser's console runtime is a custom engine, not Chrome (verified on device): every <script>
// runs as a classic script, so Angular's ES module output (imports between main and its chunks) can't
// start. We re-bundle it into a single classic IIFE `app.js`. The stylesheet is plain CSS (the app is
// one WebGL canvas) and is copied as Angular wrote it.
//
// Usage: `npm run build:brewser` (or `npm run build:brewser:diag` to show an on-screen boot report).
// Output: dist/pokemon-showdown-brewser/brewser/ and dist/pokemon-showdown-brewser/brewser.zip

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(root, 'dist/pokemon-showdown-brewser');
const browserDir = path.join(distDir, 'browser');
const outDir = path.join(distDir, 'brewser');
const zipPath = path.join(distDir, 'brewser.zip');
const withDiagnostics = process.argv.includes('--diag');

async function main() {
  if (!fs.existsSync(browserDir)) {
    throw new Error(`${path.relative(root, browserDir)} not found. Run "ng build" first.`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  fs.copyFileSync(findOne(browserDir, /^styles-.*\.css$/), path.join(outDir, 'styles.css'));
  await buildJs(findOne(browserDir, /^main-.*\.js$/));
  fs.writeFileSync(path.join(outDir, 'index.html'), buildHtml(fs.readFileSync(path.join(browserDir, 'index.html'), 'utf8')));
  copyStaticFiles();
  writeZip(outDir, zipPath);

  console.log(`Brewser bundle written to ${path.relative(root, outDir)}`);
  console.log(`Zip ready to upload: ${path.relative(root, zipPath)}`);
  if (withDiagnostics) console.log('On-screen boot diagnostics are included in this build.');
}

function findOne(dir, pattern) {
  const matches = fs.readdirSync(dir).filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(`Expected one file matching ${pattern} in ${dir}, found ${matches.length}.`);
  }
  return path.join(dir, matches[0]);
}

// ---------------------------------------------------------------- JS

async function buildJs(mainJs) {
  const markers = withDiagnostics ? diagnosticMarkers() : { banner: '', footer: '' };
  const result = await esbuild.build({
    entryPoints: [mainJs],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2022',
    write: false,
    logLevel: 'warning',
    banner: { js: STYLE_POLYFILL + TIMER_POLYFILL + markers.banner },
    footer: { js: markers.footer },
  });
  fs.writeFileSync(path.join(outDir, 'app.js'), patchTextUpdates(result.outputFiles[0].text));
}

// Brewser's element.style lacks removeProperty(), which Angular calls whenever a [style.x] binding
// becomes null (NgOptimizedImage has several), throwing on every change detection. These map the
// dash-case methods onto camelCase properties, which Brewser does support. Plain ES5 on purpose.
// window.__bwStylePolyfill reports the outcome for the --diag build.
const STYLE_POLYFILL = `(function () {
  try {
    var style = document.documentElement.style;
    var missing = typeof style.removeProperty !== 'function' || typeof style.setProperty !== 'function' || typeof style.getPropertyValue !== 'function';
    if (!missing) { window.__bwStylePolyfill = 'native'; return; }
    var proto = Object.getPrototypeOf(style);
    if (!proto || proto === Object.prototype) { window.__bwStylePolyfill = 'missing, not patchable'; return; }
    var camel = function (name) {
      return name.indexOf('--') === 0 ? name : name.replace(/-([a-z])/g, function (_, letter) { return letter.toUpperCase(); });
    };
    if (typeof style.removeProperty !== 'function') {
      proto.removeProperty = function (name) { var key = camel(name); var old = this[key]; this[key] = ''; return old == null ? '' : String(old); };
    }
    if (typeof style.setProperty !== 'function') {
      proto.setProperty = function (name, value) { this[camel(name)] = value == null ? '' : String(value); };
    }
    if (typeof style.getPropertyValue !== 'function') {
      proto.getPropertyValue = function (name) { var value = this[camel(name)]; return value == null ? '' : String(value); };
    }
    window.__bwStylePolyfill = 'patched';
  } catch (error) {
    window.__bwStylePolyfill = 'failed: ' + (error && error.message);
  }
})();
`;

// Angular schedules renders with `setTimeout(fn)` (no delay argument). The app stopped refreshing on
// the Brewser console until a navigation forced a render, which fits an engine that mishandles a
// missing delay. Per spec a missing delay means 0, so passing 0 explicitly is a no-op everywhere
// else. The --diag build reports the raw behavior (it measures before this runs).
const TIMER_POLYFILL = `(function () {
  try {
    var wrap = function (original) {
      return function (handler, delay) {
        var args = Array.prototype.slice.call(arguments);
        if (delay === undefined || delay === null) args[1] = 0;
        return original.apply(window, args);
      };
    };
    window.setTimeout = wrap(window.setTimeout);
    window.setInterval = wrap(window.setInterval);
  } catch (error) {}
})();
`;

// Angular updates every text binding with `node.nodeValue = value`. On Brewser that edit is often
// not repainted when other DOM changes happen in the same task (verified on device: the text froze,
// while replacing an element's children with textContent updated fine). After the edit, the same
// node is taken out and put back in place: a child-list mutation, which Brewser does repaint, that
// keeps the node's identity (Angular holds a reference to it).
const SET_VALUE = /setValue\(([\w$]+),([\w$]+)\)\{\1\.nodeValue=\2\}/g;

function patchTextUpdates(js) {
  const matches = js.match(SET_VALUE) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `Expected Angular's DomRenderer.setValue once in app.js, found ${matches.length}. ` +
        'Angular may have changed it: update SET_VALUE in scripts/build-brewser.mjs.',
    );
  }
  return js.replace(
    SET_VALUE,
    (_, node, value) =>
      `setValue(${node},${value}){${node}.nodeValue=${value};var p=${node}.parentNode;if(p){var s=${node}.nextSibling;p.removeChild(${node});p.insertBefore(${node},s)}}`,
  );
}

// ---------------------------------------------------------------- HTML and static files

function buildHtml(source) {
  if (source.includes('data-beasties')) {
    throw new Error('index.html has inlined critical CSS. Keep "inlineCritical": false in the production config.');
  }
  const html = source
    .replace(/\s*<link rel="stylesheet"[^>]*>/g, '')
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
    .replace(/\s*<script[^>]*type="module"[^>]*><\/script>/g, '');
  const diagnostics = withDiagnostics ? diagnosticMarkup() : '';
  // Diagnostics go first in <body>: the app fills the viewport and body has overflow hidden,
  // so anything after <app-root> would be off screen.
  return html
    .replace(/\s*<\/head>/, '\n  <link rel="stylesheet" href="styles.css">\n</head>')
    .replace(/<body>\s*/, `<body>\n${diagnostics}  `)
    .replace(/\s*<\/body>/, '\n  <script src="app.js"></script>\n</body>');
}

function copyStaticFiles() {
  const bundled = /^(index\.html|main-.*\.js|chunk-.*\.js|styles-.*\.css|.*\.map)$/;
  for (const entry of fs.readdirSync(browserDir)) {
    if (bundled.test(entry)) continue;
    fs.cpSync(path.join(browserDir, entry), path.join(outDir, entry), { recursive: true });
  }
}

// ---------------------------------------------------------------- Diagnostics (--diag)

function diagnosticMarkers() {
  const set = (text) => `(function(){var e=document.getElementById("bw-diag-appjs");if(e)e.textContent=${JSON.stringify(text)};})();`;
  return {
    banner: set('app.js: started, did not finish'),
    footer: set('app.js: ran to the end'),
  };
}

// Plain elements and simple styles only: combined positioning/overflow styles blank the page on
// Brewser. The log box uses a fixed height with overflow-y:auto (verified on device) so it can't
// push the app off screen, shows the newest entry first, and collapses repeated entries into a
// counter. It starts non-empty because an element growing from zero height can overlap the
// content below it.
function diagnosticMarkup() {
  return `  <div style="color:#ffffff;background:#000000;padding:4px;">
    <p id="bw-diag-appjs" style="margin:0;">app.js: DID NOT RUN</p>
    <p id="bw-diag-app" style="margin:0;">Angular: waiting...</p>
    <div id="bw-diag-log" style="height:140px;overflow-y:auto;background:#222222;font-family:monospace;font-size:13px;">
      <p style="margin:0;">Log (newest first)</p>
    </div>
  </div>
  <script>
    (function () {
      var seen = {};
      function log(message) {
        var box = document.getElementById('bw-diag-log');
        if (!box) return;
        var key = message.slice(0, 300);
        var entry = seen[key];
        if (entry) {
          entry.count++;
          entry.node.textContent = '(x' + entry.count + ') ' + message;
          return;
        }
        var node = document.createElement('p');
        node.style.margin = '0';
        node.style.whiteSpace = 'pre-wrap';
        node.textContent = message;
        box.insertBefore(node, box.firstChild);
        seen[key] = { count: 1, node: node };
      }
      function describe(value) {
        if (!value || typeof value !== 'object') return String(value);
        var message = value.message ? String(value.name || 'Error') + ': ' + value.message : String(value);
        var frames = value.stack ? String(value.stack).split('\\n') : [];
        var kept = [];
        for (var i = 0; i < frames.length && kept.length < 3; i++) {
          if (frames[i] && frames[i].indexOf(value.message) === -1) kept.push(frames[i].replace(/^\\s+/, '  '));
        }
        return message + (kept.length ? '\\n' + kept.join('\\n') : '');
      }
      window.onerror = function (message, source, line, column, error) {
        log('[error] ' + (error ? describe(error) : message) + '\\n  @ ' + source + ':' + line + ':' + column);
      };
      if (window.addEventListener) {
        window.addEventListener('unhandledrejection', function (event) {
          log('[unhandled rejection] ' + describe(event.reason));
        });
      }
      if (window.console && console.error) {
        var originalError = console.error;
        console.error = function () {
          var parts = [];
          for (var i = 0; i < arguments.length; i++) parts.push(describe(arguments[i]));
          log('[console.error] ' + parts.join(' '));
          return originalError.apply(console, arguments);
        };
      }
      log('User agent: ' + navigator.userAgent);
      log('style polyfill: ' + (window.__bwStylePolyfill || 'app.js not run yet'));

      // Raw timer behavior, measured before app.js (and its timer polyfill) runs. Angular schedules
      // renders with setTimeout(fn) (no delay) raced against requestAnimationFrame.
      var started = new Date().getTime();
      var elapsed = function () { return (new Date().getTime() - started) + ' ms'; };
      window.setTimeout(function () { log('[timers] setTimeout without delay fired after ' + elapsed()); });
      window.setTimeout(function () { log('[timers] setTimeout(fn, 0) fired after ' + elapsed()); }, 0);
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function () { log('[timers] requestAnimationFrame fired after ' + elapsed()); });
      } else {
        log('[timers] requestAnimationFrame: not available');
      }
      window.setTimeout(function () { log('[timers] check done at ' + elapsed() + ' (a missing line above never fired)'); }, 3000);

      // Navigation debugging: what receives each click, whether Angular's RouterLink handled it
      // (defaultPrevented after bubbling), and whether the URL changes.
      function describeNode(node) {
        var parts = [];
        for (var i = 0; node && i < 4; i++, node = node.parentNode) {
          if (node.nodeType === 3) { parts.push('#text'); continue; }
          if (!node.tagName) { parts.push(node.nodeName || String(node)); break; }
          var cls = typeof node.className === 'string' ? node.className.split(' ').slice(0, 2).join('.') : '';
          var href = node.getAttribute && node.getAttribute('href');
          parts.push(node.tagName.toLowerCase() + (cls ? '.' + cls : '') + (href ? '[href=' + href + ']' : ''));
        }
        return parts.join(' < ') || String(node);
      }
      if (document.addEventListener) {
        document.addEventListener('click', function (event) {
          var atPoint = document.elementFromPoint ? document.elementFromPoint(event.clientX, event.clientY) : null;
          log('[click] target: ' + describeNode(event.target) + ' @ ' + event.clientX + ',' + event.clientY +
            (atPoint && atPoint !== event.target ? '\\n  elementFromPoint: ' + describeNode(atPoint) : ''));
        }, true);
        window.addEventListener('click', function (event) {
          log('[click] after handlers, defaultPrevented=' + event.defaultPrevented + ', url=' + window.location.hash);
          // Which Angular components are really in the DOM once a navigation settles: tells stale
          // paint apart from elements that were never removed.
          // Walks childNodes rather than getElementsByTagName('*'), which returned nothing on
          // Brewser, and reports the total so an empty API result can't pass as an empty page.
          window.setTimeout(function () {
            var names = [];
            var total = 0;
            function walk(node) {
              for (var child = node.firstChild; child; child = child.nextSibling) {
                if (child.nodeType !== 1) continue;
                total++;
                var tag = String(child.tagName || child.nodeName || '').toLowerCase();
                if (tag.indexOf('app-') === 0) names.push(tag);
                walk(child);
              }
            }
            walk(document.body);
            log('[dom +1.5s] ' + total + ' elements; app-*: ' + (names.join(', ') || 'none'));
          }, 1500);
        });
        // Keyboard navigation debugging: what the console's mapped buttons send (the app reads key,
        // then code, then keyCode) and what has focus when they arrive.
        document.addEventListener('keydown', function (event) {
          log('[key] key=' + event.key + ' code=' + event.code + ' keyCode=' + event.keyCode +
            '
  focus: ' + describeNode(document.activeElement));
        }, true);
        window.addEventListener('hashchange', function () {
          log('[hashchange] ' + window.location.hash);
        });
        window.addEventListener('popstate', function () {
          log('[popstate] ' + window.location.hash);
        });
      }
      window.setTimeout(function () {
        var root = document.getElementsByTagName('app-root')[0];
        var count = root && root.children ? root.children.length : 'no app-root';
        var el = document.getElementById('bw-diag-app');
        if (el) el.textContent = 'Angular: app-root has ' + count + ' children after 8 s (0 = did not render) | style polyfill: ' + (window.__bwStylePolyfill || 'unknown');
        // Spatial navigation needs element boxes; without them it falls back to document order.
        var rect = document.body.getBoundingClientRect ? document.body.getBoundingClientRect() : null;
        log('[rects] body: ' + (rect ? rect.left + ',' + rect.top + ' ' + (rect.right - rect.left) + 'x' + (rect.bottom - rect.top) : 'getBoundingClientRect missing'));
      }, 8000);
    })();
  </script>
`;
}

// ---------------------------------------------------------------- Zip

// Minimal zip writer: always uses forward slashes in entry names, which PowerShell 5.1's
// Compress-Archive does not do for nested folders (breaking extraction on other platforms).
function writeZip(sourceDir, target) {
  const files = listFiles(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1; // 1980-01-01, keeps the zip reproducible

  for (const relative of files) {
    const data = fs.readFileSync(path.join(sourceDir, relative));
    const compressed = zlib.deflateRawSync(data);
    const name = Buffer.from(relative.split(path.sep).join('/'), 'utf8');
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  fs.writeFileSync(target, Buffer.concat([...localParts, ...centralParts, end]));
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

// Invoked last so every module-level constant above is initialized.
main().catch((error) => {
  console.error(`\nBrewser build failed: ${error.message}`);
  process.exit(1);
});
