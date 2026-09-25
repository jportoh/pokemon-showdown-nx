// Turns the Angular production build into a bundle the Brewser console can run.
//
// Brewser's console runtime is a custom engine, not Chrome (verified on device):
// - Every <script> runs as a classic script, so Angular's ES module output (imports between
//   main and its chunks) can't start. We re-bundle it into a single classic IIFE `app.js`.
// - Its CSS engine drops `@layer` and `@supports` blocks, never matches escaped class selectors
//   (`.hover\:x`, `.bg-\[\#fff\]`), doesn't support `:is()`/`:where()`/nesting, and renders
//   `oklch()`/`color-mix()` with wrong colors. Tailwind v4 relies on all of these, so we lower
//   the stylesheet and rename escaped classes to safe names in both styles.css and app.js.
//
// Usage: `npm run build:brewser` (or `npm run build:brewser:diag` to show an on-screen boot report).
// Output: dist/pokemon-showdown-brewser/brewser/ and dist/pokemon-showdown-brewser/brewser.zip

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { transform as lightningTransform } from 'lightningcss';
import postcss from 'postcss';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(root, 'dist/pokemon-showdown-brewser');
const browserDir = path.join(distDir, 'browser');
const outDir = path.join(distDir, 'brewser');
const zipPath = path.join(distDir, 'brewser.zip');
const withDiagnostics = process.argv.includes('--diag');

// Selectors Brewser can't match. They're dropped so they can't invalidate anything else.
const UNSUPPORTED_SELECTOR = /:is\(|:where\(|:-webkit-any\(|:-moz-|::-moz-|::-webkit-|:host|::backdrop|::file-selector-button/;
// Color functions and gradient color-space interpolation (`to bottom in oklab`) that Brewser
// renders wrong. lightningcss emits hex fallbacks for the functions; interpolation is simply dropped.
const MODERN_COLOR = /\b(?:ok)?(?:lab|lch)\(|color-mix\(|\bcolor\(|\bin\s+(?:ok)?(?:lab|lch)\b|\bin\s+(?:srgb|hsl|hwb|display-p3|xyz)/;
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const CLASS_TOKEN = /\.((?:[\w-]|\\[0-9a-fA-F]{1,6}\s?|\\[^\n0-9a-fA-F])+)/g;

async function main() {
  if (!fs.existsSync(browserDir)) {
    throw new Error(`${path.relative(root, browserDir)} not found. Run "ng build" first.`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const classMap = new Map();
  const css = buildCss(fs.readFileSync(findOne(browserDir, /^styles-.*\.css$/), 'utf8'), classMap);
  fs.writeFileSync(path.join(outDir, 'styles.css'), css);

  const { renamed, missing } = await buildJs(findOne(browserDir, /^main-.*\.js$/), classMap);
  fs.writeFileSync(path.join(outDir, 'index.html'), buildHtml(fs.readFileSync(path.join(browserDir, 'index.html'), 'utf8')));
  copyStaticFiles();
  writeZip(outDir, zipPath);
  // Debugging aid (not shipped): which Brewser-safe name each escaped Tailwind class got.
  fs.writeFileSync(path.join(distDir, 'brewser-class-map.json'), JSON.stringify(Object.fromEntries(classMap), null, 2));

  console.log(`Brewser bundle written to ${path.relative(root, outDir)}`);
  console.log(`Zip ready to upload: ${path.relative(root, zipPath)}`);
  console.log(`Renamed ${renamed} escaped Tailwind classes to Brewser-safe names.`);
  if (missing.length > 0) {
    // Usually classes Tailwind found in a source file but that no template uses. A class built by
    // string concatenation at runtime would also land here and stay unstyled on Brewser.
    console.warn(`Not found in app.js (left unstyled on Brewser if used): ${missing.join(', ')}`);
  }
  if (withDiagnostics) console.log('On-screen boot diagnostics are included in this build.');
}

function findOne(dir, pattern) {
  const matches = fs.readdirSync(dir).filter((file) => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(`Expected one file matching ${pattern} in ${dir}, found ${matches.length}.`);
  }
  return path.join(dir, matches[0]);
}

// ---------------------------------------------------------------- CSS

function buildCss(source, classMap) {
  // Old targets make lightningcss flatten nesting and convert oklch() to hex.
  const lowered = lightningTransform({
    filename: 'styles.css',
    code: Buffer.from(source),
    minify: false,
    targets: { chrome: 60 << 16 },
  }).code.toString();

  const ast = postcss.parse(lowered);
  unwrapAtRules(ast);

  ast.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return;
    const selectors = rule.selectors
      .filter((selector) => !UNSUPPORTED_SELECTOR.test(selector))
      .map((selector) => renameEscapedClasses(selector, classMap));
    // One rule per selector: in CSS a single unsupported selector drops the whole list.
    for (const selector of selectors) rule.cloneBefore({ selector });
    rule.remove();
  });

  // Safety net for modern colors outside `@supports`: drop them where an earlier declaration of
  // the same property in the rule is the fallback, and report any without one.
  const unconverted = new Set();
  ast.walkDecls((decl) => {
    if (!MODERN_COLOR.test(decl.value)) return;
    const hasFallback = decl.parent.some((node) => node !== decl && node.type === 'decl' && node.prop === decl.prop && !MODERN_COLOR.test(node.value));
    if (hasFallback) decl.remove();
    else unconverted.add(`${decl.parent.selector ?? decl.parent.name} { ${decl.prop} }`);
  });
  if (unconverted.size > 0) {
    console.warn(`Modern color functions without a fallback (may render wrong on Brewser): ${[...unconverted].join('; ')}`);
  }

  // Brewser support for the individual `translate` property is unverified; `transform` is the
  // long-standing equivalent. (Would conflict if an element also used transform utilities.)
  ast.walkDecls('translate', (decl) => {
    const parts = splitTopLevel(decl.value);
    if (parts.length <= 2) decl.replaceWith(decl.clone({ prop: 'transform', value: `translate(${parts.join(', ')})` }));
  });

  inlineThemeVariables(ast);
  addLiteralGradients(ast);

  // Dynamic viewport units are recent; a plain vh/vw declaration first acts as the fallback.
  ast.walkDecls((decl) => {
    if (/\d(?:d|s|l)v[hw]\b/.test(decl.value)) {
      decl.cloneBefore({ value: decl.value.replace(/(\d)(?:d|s|l)(v[hw])\b/g, '$1$2') });
    }
  });

  ast.walkAtRules((atRule) => {
    if (atRule.nodes && atRule.nodes.length === 0) atRule.remove();
  });

  // Second lightningcss pass folds the calc() expressions left by inlining, e.g.
  // `calc(.25rem * 3)` -> `.75rem`. It also merges rules with identical declarations back into
  // selector lists, so the lists are split again afterwards.
  const folded = lightningTransform({
    filename: 'styles.css',
    code: Buffer.from(ast.toString()),
    minify: false,
    targets: { chrome: 60 << 16 },
  }).code.toString();
  const finalAst = splitSelectorLists(postcss.parse(folded));
  convertRemToPx(finalAst);
  warnAboutPaddingLonghands(finalAst);
  return finalAst.toString();
}

// Brewser ignored rem offsets on absolutely positioned elements (`top: .75rem`, `left: .5rem`) while
// px offsets on the same element worked (seen on device). The app is a fixed 1280x720 stage with the
// default 16px root font size, so every rem is converted to px: same layout, one less unit to support.
const ROOT_FONT_SIZE_PX = 16;

function convertRemToPx(ast) {
  const toPx = (text) =>
    text.replace(/(-?\d*\.?\d+)rem\b/g, (_, number) => `${Math.round(parseFloat(number) * ROOT_FONT_SIZE_PX * 1000) / 1000}px`);
  ast.walkDecls((decl) => {
    if (decl.value.includes('rem')) decl.value = toPx(decl.value);
  });
  ast.walkAtRules('media', (atRule) => {
    if (atRule.params.includes('rem')) atRule.params = toPx(atRule.params);
  });
}

// On Brewser a `padding` shorthand beats padding longhands whatever their specificity, so Tailwind's
// px-*/py-*/pl-*… (longhands) lose to the preflight's `padding: 0` on every element (seen on device;
// longhands alone work, test-d13). The p-* utilities, including arbitrary values, are shorthands and
// work. Longhands can't be rewritten here without knowing the other sides an element gets from other
// classes, so they're reported instead.
function warnAboutPaddingLonghands(ast) {
  const selectors = new Set();
  ast.walkDecls(/^padding-/, (decl) => {
    if (decl.parent.type === 'rule') selectors.add(decl.parent.selector);
  });
  if (selectors.size > 0) {
    console.warn(
      `Padding longhands lose to the preflight shorthand on Brewser; use the p-* shorthand utilities instead. Found in: ${[...selectors].join(', ')}`,
    );
  }
}

// One rule per selector: in CSS a single unsupported selector drops the whole list.
function splitSelectorLists(ast) {
  ast.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && rule.parent.name.endsWith('keyframes')) return;
    if (rule.selectors.length < 2) return;
    for (const selector of rule.selectors) rule.cloneBefore({ selector });
    rule.remove();
  });
  return ast;
}

// Brewser supports `var()` and literal `calc()`, but not `calc()` over a variable, which is how
// Tailwind v4 writes all spacing (`calc(var(--spacing) * 3)`). Theme variables defined once on
// `:root` are constants, so they're substituted into every declaration that uses them.
function inlineThemeVariables(ast) {
  const definitions = new Map();
  const counts = new Map();
  ast.walkDecls(/^--/, (decl) => {
    counts.set(decl.prop, (counts.get(decl.prop) ?? 0) + 1);
    if (decl.parent.type === 'rule' && decl.parent.selector === ':root') definitions.set(decl.prop, decl.value);
  });
  const constants = new Map([...definitions].filter(([prop]) => counts.get(prop) === 1));

  const resolve = (value, depth = 0) =>
    depth > 10 ? value : replaceVars(value, (name, fallback) => {
      if (constants.has(name)) return resolve(constants.get(name), depth + 1);
      return fallback === undefined ? null : `var(${name}, ${resolve(fallback, depth + 1)})`;
    });

  ast.walkDecls((decl) => {
    if (decl.value.includes('var(')) decl.value = resolve(decl.value);
  });
}

// Brewser can't read colors from var() inside a gradient (verified: `linear-gradient(var(--a),
// var(--b))` fails, a var() direction works). Tailwind's `bg-linear-to-* from-* to-*` is built
// exactly that way, so for every direction/from/to combination (and each state variant such as
// `hover:` or `disabled:`) this adds a compound rule with the colors written out, e.g.
// `.bg-linear-to-b.from-gray-500.to-gray-700 { background-image: linear-gradient(to bottom, #6a7282, #364153) }`.
// Custom stop positions and `via-*` are not supported.
function addLiteralGradients(ast) {
  const STOP_SELECTOR = /^\.([\w-]+)((?::[\w-]+(?:\([^)]*\))?)*)$/;
  const directions = [];
  const groups = new Map(); // `${media}|${state}` -> { media, state, from: Map, to: Map }
  let usesVia = false;

  ast.walkRules((rule) => {
    const media = rule.parent.type === 'atrule' && rule.parent.name === 'media' ? rule.parent.params : '';
    const match = STOP_SELECTOR.exec(rule.selector);
    if (!match) return;
    const [, className, state] = match;
    rule.walkDecls((decl) => {
      if (decl.prop === '--tw-gradient-position' && !state && !media) {
        directions.push({ className, position: decl.value });
      } else if (decl.prop === '--tw-gradient-from' || decl.prop === '--tw-gradient-to') {
        if (decl.value.includes('var(')) return;
        const key = `${media}|${state}`;
        if (!groups.has(key)) groups.set(key, { media, state, from: new Map(), to: new Map() });
        groups.get(key)[decl.prop === '--tw-gradient-from' ? 'from' : 'to'].set(className, decl.value);
      } else if (decl.prop === '--tw-gradient-via') {
        usesVia = true;
      }
    });
  });
  if (usesVia) console.warn('Gradient via-* utilities are not converted for Brewser and will render wrong there.');
  if (directions.length === 0) return;

  const base = groups.get('|') ?? { from: new Map(), to: new Map() };
  const transparent = 'rgba(0, 0, 0, 0)';
  const rules = [];
  const add = (media, selector, position, from, to) =>
    rules.push({ media, css: `${selector} { background-image: linear-gradient(${position}, ${from}, ${to}); }` });

  for (const { className: dir, position } of directions) {
    // Only one side set: Tailwind fades the other side to transparent.
    for (const [f, fc] of base.from) add('', `.${dir}.${f}`, position, fc, transparent);
    for (const [t, tc] of base.to) add('', `.${dir}.${t}`, position, transparent, tc);
    for (const [f, fc] of base.from) for (const [t, tc] of base.to) add('', `.${dir}.${f}.${t}`, position, fc, tc);

    // Variants keep the CSS order of their group so the cascade matches Tailwind's.
    for (const [key, group] of groups) {
      if (key === '|') continue;
      const { media, state } = group;
      for (const [vf, vfc] of group.from) for (const [t, tc] of base.to) add(media, `.${dir}.${t}.${vf}${state}`, position, vfc, tc);
      for (const [f, fc] of base.from) for (const [vt, vtc] of group.to) add(media, `.${dir}.${f}.${vt}${state}`, position, fc, vtc);
      for (const [vf, vfc] of group.from) for (const [vt, vtc] of group.to) add(media, `.${dir}.${vf}.${vt}${state}`, position, vfc, vtc);
    }
  }

  let css = '';
  let openMedia = null;
  for (const { media, css: ruleCss } of rules) {
    if (media !== openMedia) {
      if (openMedia) css += '}\n';
      if (media) css += `@media ${media} {\n`;
      openMedia = media || null;
    }
    css += `${ruleCss}\n`;
  }
  if (openMedia) css += '}\n';
  ast.append(postcss.parse(`/* Brewser: gradients with literal colors */\n${css}`));
}

// Calls `replacer(name, fallback)` for each top-level var() in `value`. Returning null keeps
// the original text.
function replaceVars(value, replacer) {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf('var(', index);
    if (start === -1) break;
    let depth = 0;
    let end = start + 3;
    let comma = -1;
    for (; end < value.length; end++) {
      const char = value[end];
      if (char === '(') depth++;
      else if (char === ')' && --depth === 0) break;
      else if (char === ',' && depth === 1 && comma === -1) comma = end;
    }
    const inner = value.slice(start + 4, end);
    const name = (comma === -1 ? inner : value.slice(start + 4, comma)).trim();
    const fallback = comma === -1 ? undefined : value.slice(comma + 1, end).trim();
    const replacement = replacer(name, fallback);
    result += value.slice(index, start) + (replacement ?? value.slice(start, end + 1));
    index = end + 1;
  }
  return result + value.slice(index);
}

function unwrapAtRules(ast) {
  // Repeat until stable: unwrapping a block can expose nested at-rules the walker already passed.
  let changed = true;
  while (changed) {
    changed = false;
    ast.walkAtRules((atRule) => {
      if (atRule.name === 'layer') {
        if (atRule.nodes) atRule.replaceWith(atRule.nodes);
        else atRule.remove();
        changed = true;
      } else if (atRule.name === 'property') {
        atRule.remove();
        changed = true;
      } else if (atRule.name === 'supports') {
        // Blocks that only set custom properties without testing a color feature are Tailwind's
        // fallback defaults for `@property` (unsupported on Brewser), so they're kept. Everything
        // else is a progressive enhancement (lab colors, color-mix) and is dropped.
        if (onlyCustomProperties(atRule) && !MODERN_COLOR.test(atRule.params)) atRule.replaceWith(atRule.nodes);
        else atRule.remove();
        changed = true;
      }
    });
  }
}

function onlyCustomProperties(node) {
  let declarations = 0;
  let custom = 0;
  node.walkDecls((decl) => {
    declarations++;
    if (decl.prop.startsWith('--')) custom++;
  });
  return declarations > 0 && declarations === custom;
}

function renameEscapedClasses(selector, classMap) {
  const strings = [];
  const masked = selector.replace(QUOTED, (quoted) => `\u0000${strings.push(quoted) - 1}\u0000`);
  const renamed = masked.replace(CLASS_TOKEN, (match, raw) => {
    if (!raw.includes('\\')) return match;
    const name = unescapeCss(raw);
    let safe = classMap.get(name);
    if (!safe) {
      safe = `bw-c${classMap.size.toString(36)}`;
      classMap.set(name, safe);
    }
    return `.${safe}`;
  });
  return renamed.replace(/\u0000(\d+)\u0000/g, (_, index) => strings[Number(index)]);
}

function unescapeCss(value) {
  return value.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex, char) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : char,
  );
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of value.trim()) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// ---------------------------------------------------------------- JS

async function buildJs(mainJs, classMap) {
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
  let js = patchTextUpdates(result.outputFiles[0].text);

  // Angular compiles static template classes into one string literal per class, so a class is
  // replaced only where it is a whole token inside a string.
  let renamed = 0;
  const missing = [];
  for (const [name, safe] of classMap) {
    const token = new RegExp(`(?<=["'\`\\s])${escapeRegExp(name)}(?=["'\`\\s])`, 'g');
    const next = js.replace(token, safe);
    if (next === js) missing.push(name);
    else renamed++;
    js = next;
  }
  fs.writeFileSync(path.join(outDir, 'app.js'), js);
  return { renamed, missing };
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
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
