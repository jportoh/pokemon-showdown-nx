// Drives a headless Chrome over the DevTools protocol, to take PR screenshots of the app.
// Start Chrome first (see SKILL.md, "Screenshots"), with the dev server on localhost:4200.
//
//   node .claude/skills/work-line/screenshot.mjs <step> <step> ...
//
// Steps, run in order:
//   nav:<url>        load a page (then waits 1.5 s)
//   key:<key>[x<n>]  press a key n times: Enter, Escape, ArrowUp/Down/Left/Right, or one character
//                    (the app's keyboard mapping is in docs/input.md: q/e = L/R, z/c = ZL/ZR, + and -)
//   wait:<ms>        wait
//   shot:<file.png>  save a 1280x720 screenshot
//   eval:<js>        run JavaScript in the page and print the result (e.g. seed localStorage)
// The port is CDP_PORT, 9333 by default.
import { writeFileSync } from 'node:fs';

const targets = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? 9333}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

const KEYS = {
  Enter: [13, 'Enter'], Escape: [27, 'Escape'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
};
async function press(key) {
  const [code, codeName] = KEYS[key] ?? [key.toUpperCase().charCodeAt(0), key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key];
  const base = { key, code: codeName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key.length === 1 ? key : undefined });
  await sleep(60);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(250);
}

for (const step of process.argv.slice(2)) {
  const [kind, ...rest] = step.split(':');
  const arg = rest.join(':');
  if (kind === 'nav') {
    await send('Page.navigate', { url: arg });
    await sleep(1500);
  } else if (kind === 'key') {
    const [k, n] = arg.split('x').length > 1 && /x\d+$/.test(arg) ? [arg.replace(/x\d+$/, ''), +arg.match(/x(\d+)$/)[1]] : [arg, 1];
    for (let i = 0; i < n; i++) await press(k);
  } else if (kind === 'wait') {
    await sleep(+arg);
  } else if (kind === 'shot') {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
    console.log('shot', arg);
  } else if (kind === 'eval') {
    const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(r.result?.result?.value ?? r.result));
  }
}
ws.close();
