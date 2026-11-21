// A minimal DOM for the native .nro. nx.js has no document, so this gives Angular just enough to run:
// a node tree it can build and change (the root component, the stage host, the router outlet and
// the scenes' empty hosts), attributes, classes, inline styles, events, a selector lookup, and an
// in-memory location and history for the router. Nothing here is drawn: the UI is the WebGL canvas.
//
// The one visible element is the stage host's <canvas>: its WebGL context is the engine's screen.
// Other canvases (the text caches) are 2D drawing surfaces backed by OffscreenCanvas.
//
// Imported before the app, so it must not depend on anything the app defines.

import { patchUploads } from './gl-uploads';
import { nativeStats, timed } from './native-stats';

type Listener = (event: Event) => void;
type ListenerEntry = { listener: EventListenerOrEventListenerObject; capture: boolean };

const SCREEN_W = 1280;
const SCREEN_H = 720;

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

class ListenerMap {
  private readonly byType = new Map<string, ListenerEntry[]>();

  add(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (!listener) return;
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const list = this.byType.get(type) ?? [];
    if (list.some((entry) => entry.listener === listener && entry.capture === capture)) return;
    list.push({ listener, capture });
    this.byType.set(type, list);
  }

  remove(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const list = this.byType.get(type);
    if (!list) return;
    const index = list.findIndex((entry) => entry.listener === listener && entry.capture === capture);
    if (index >= 0) list.splice(index, 1);
  }

  dispatch(target: unknown, event: Event): void {
    for (const { listener } of [...(this.byType.get(event.type) ?? [])]) {
      try {
        if (typeof listener === 'function') (listener as Listener).call(target, event);
        else listener.handleEvent(event);
      } catch (error) {
        reportError(error);
      }
    }
  }
}

function reportError(error: unknown): void {
  // Same as a browser: a throwing listener doesn't stop the others; the error is logged.
  console.error(error);
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;

class ShimNode {
  static readonly ELEMENT_NODE = ELEMENT_NODE;
  static readonly TEXT_NODE = TEXT_NODE;
  static readonly COMMENT_NODE = COMMENT_NODE;
  static readonly DOCUMENT_NODE = DOCUMENT_NODE;
  static readonly DOCUMENT_FRAGMENT_NODE = DOCUMENT_FRAGMENT_NODE;

  parentNode: ShimNode | null = null;
  readonly childNodes: ShimNode[] = [];
  private readonly listeners = new ListenerMap();

  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
  ) {}

  get ownerDocument(): ShimDocument | null {
    return shimDocument;
  }

  get parentElement(): ShimElement | null {
    return this.parentNode instanceof ShimElement ? this.parentNode : null;
  }

  get firstChild(): ShimNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): ShimNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling(): ShimNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
  }

  get previousSibling(): ShimNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) - 1] ?? null) : null;
  }

  get isConnected(): boolean {
    let node: ShimNode | null = this;
    while (node && node !== shimDocument) node = node.parentNode;
    return node === shimDocument;
  }

  get nodeValue(): string | null {
    return null;
  }

  set nodeValue(_value: string | null) {
    // Only text and comment nodes have a value.
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value: string | null) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    if (value) this.appendChild(new ShimText(String(value)));
  }

  hasChildNodes(): boolean {
    return this.childNodes.length > 0;
  }

  appendChild<T extends ShimNode>(child: T): T {
    return this.insertBefore(child, null);
  }

  insertBefore<T extends ShimNode>(child: T, reference: ShimNode | null): T {
    if (child.nodeType === DOCUMENT_FRAGMENT_NODE) {
      for (const inner of [...child.childNodes]) this.insertBefore(inner, reference);
      return child;
    }
    child.parentNode?.removeChild(child);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, child);
    else this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild<T extends ShimNode>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  replaceChild<T extends ShimNode>(child: ShimNode, old: T): T {
    this.insertBefore(child, old);
    return this.removeChild(old);
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  contains(other: ShimNode | null): boolean {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  getRootNode(): ShimNode {
    let node: ShimNode = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }

  cloneNode(): ShimNode {
    throw new Error('cloneNode is not supported by the native DOM shim');
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    this.listeners.add(type, listener, options);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    this.listeners.remove(type, listener, options);
  }

  dispatchEvent(event: Event): boolean {
    this.listeners.dispatch(this, event);
    return !event.defaultPrevented;
  }
}

class ShimCharacterData extends ShimNode {
  constructor(
    nodeType: number,
    nodeName: string,
    public data: string,
  ) {
    super(nodeType, nodeName);
  }

  override get nodeValue(): string {
    return this.data;
  }

  override set nodeValue(value: string | null) {
    this.data = value ?? '';
  }

  override get textContent(): string {
    return this.data;
  }

  override set textContent(value: string | null) {
    this.data = value ?? '';
  }
}

class ShimText extends ShimCharacterData {
  constructor(data: string) {
    super(TEXT_NODE, '#text', data);
  }
}

class ShimComment extends ShimCharacterData {
  constructor(data: string) {
    super(COMMENT_NODE, '#comment', data);
  }
}

class ShimFragment extends ShimNode {
  constructor() {
    super(DOCUMENT_FRAGMENT_NODE, '#document-fragment');
  }
}

// ---------------------------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------------------------

/** Inline styles: kept (nothing reads them back to draw), with the CSSStyleDeclaration methods. */
function createStyle(): CSSStyleDeclaration {
  const values = new Map<string, string>();
  const camel = (name: string) => (name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()));
  const methods: Record<string, unknown> = {
    setProperty: (name: string, value: string | null) => void values.set(camel(name), value ?? ''),
    removeProperty: (name: string) => {
      const old = values.get(camel(name)) ?? '';
      values.delete(camel(name));
      return old;
    },
    getPropertyValue: (name: string) => values.get(camel(name)) ?? '',
  };
  return new Proxy(methods, {
    get: (target, key) => (typeof key === 'string' && key in target ? target[key] : typeof key === 'string' ? (values.get(key) ?? '') : undefined),
    set: (_target, key, value) => {
      if (typeof key === 'string') values.set(key, value == null ? '' : String(value));
      return true;
    },
  }) as unknown as CSSStyleDeclaration;
}

class ShimClassList {
  constructor(private readonly element: ShimElement) {}

  private get names(): string[] {
    return (this.element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  }

  private write(names: string[]): void {
    this.element.setAttribute('class', names.join(' '));
  }

  get length(): number {
    return this.names.length;
  }

  contains(name: string): boolean {
    return this.names.includes(name);
  }

  add(...names: string[]): void {
    const current = this.names;
    for (const name of names) if (!current.includes(name)) current.push(name);
    this.write(current);
  }

  remove(...names: string[]): void {
    this.write(this.names.filter((name) => !names.includes(name)));
  }

  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

class ShimElement extends ShimNode {
  readonly localName: string;
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style = createStyle();
  readonly classList = new ShimClassList(this);

  constructor(
    name: string,
    readonly namespaceURI: string | null = 'http://www.w3.org/1999/xhtml',
  ) {
    const local = name.toLowerCase();
    super(ELEMENT_NODE, local.toUpperCase());
    this.localName = local;
    this.tagName = local.toUpperCase();
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }

  set id(value: string) {
    this.setAttribute('id', value);
  }

  get className(): string {
    return this.getAttribute('class') ?? '';
  }

  set className(value: string) {
    this.setAttribute('class', value);
  }

  get children(): ShimElement[] {
    return this.childNodes.filter((node): node is ShimElement => node instanceof ShimElement);
  }

  get firstElementChild(): ShimElement | null {
    return this.children[0] ?? null;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name.toLowerCase(), String(value));
  }

  setAttributeNS(_namespace: string | null, name: string, value: string): void {
    this.setAttribute(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
  }

  removeAttributeNS(_namespace: string | null, name: string): void {
    this.removeAttribute(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  matches(selector: string): boolean {
    return selectorMatches(this, selector);
  }

  closest(selector: string): ShimElement | null {
    for (let node: ShimNode | null = this; node; node = node.parentNode) {
      if (node instanceof ShimElement && node.matches(selector)) return node;
    }
    return null;
  }

  querySelector(selector: string): ShimElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): ShimElement[] {
    const found: ShimElement[] = [];
    const walk = (node: ShimNode) => {
      for (const child of node.childNodes) {
        if (child instanceof ShimElement) {
          if (child.matches(selector)) found.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return found;
  }

  getElementsByTagName(name: string): ShimElement[] {
    return this.querySelectorAll(name === '*' ? '*' : name);
  }

  getBoundingClientRect(): DOMRect {
    return rect(0, 0, 0, 0);
  }

  focus(): void {
    shimDocument.activeElement = this;
  }

  blur(): void {
    if (shimDocument.activeElement === this) shimDocument.activeElement = shimDocument.body;
  }

  scrollIntoView(): void {
    // Nothing scrolls: the UI is one fixed canvas.
  }
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

// Simple selectors, which is all Angular asks for: a tag, #id, .class, [attr] and [attr="value"],
// combined in one compound selector, and comma lists. No combinators.
const SIMPLE = /^([a-z][\w-]*|\*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:=(?:"[^"]*"|'[^']*'|[\w-]+))?\])*)$/i;
const PART = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\]/g;

function selectorMatches(element: ShimElement, selector: string): boolean {
  return selector.split(',').some((one) => {
    const match = SIMPLE.exec(one.trim());
    if (!match) throw new Error(`Unsupported selector in the native DOM shim: ${one}`);
    const [, tag, rest] = match;
    if (tag && tag !== '*' && tag.toLowerCase() !== element.localName) return false;
    for (const part of rest.matchAll(PART)) {
      const [, id, className, attribute, quoted, singleQuoted, bare] = part;
      if (id !== undefined && element.id !== id) return false;
      if (className !== undefined && !element.classList.contains(className)) return false;
      if (attribute !== undefined) {
        const value = element.getAttribute(attribute);
        const wanted = quoted ?? singleQuoted ?? bare;
        if (value === null || (wanted !== undefined && value !== wanted)) return false;
      }
    }
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------------------------

interface NxScreen {
  getContext(id: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
}

/** The screen's WebGL context can be taken once; every canvas that asks for WebGL gets that one. */
let screenContext: WebGL2RenderingContext | null = null;

/**
 * A canvas element. The stage host's one gets the screen's WebGL context; the text caches draw on
 * 2D ones. Those resize for every glyph or text they draw, so the OffscreenCanvas behind is only
 * replaced when it's too small: a resize clears it and resets the drawing state, as on a real canvas,
 * and the texture uploads read just the canvas's current size from its top left corner.
 */
class ShimCanvas extends ShimElement {
  private surface: OffscreenCanvas | null = null;
  private context2d: OffscreenCanvasRenderingContext2D | null = null;
  private proxy: CanvasRenderingContext2D | null = null;
  private size = { width: 300, height: 150 };
  private stale = false;

  constructor() {
    super('canvas');
  }

  get width(): number {
    return this.size.width;
  }

  set width(value: number) {
    this.size = { width: Math.max(1, Math.floor(value)), height: this.size.height };
    this.stale = true;
  }

  get height(): number {
    return this.size.height;
  }

  set height(value: number) {
    this.size = { width: this.size.width, height: Math.max(1, Math.floor(value)) };
    this.stale = true;
  }

  /** The 2D context behind (null while nothing has drawn on it): the texture uploads read it. */
  get backingContext(): OffscreenCanvasRenderingContext2D | null {
    return this.surface ? this.current() : null;
  }

  getContext(id: string, options?: WebGLContextAttributes): unknown {
    if (id === 'webgl2' || id === 'webgl' || id === 'experimental-webgl') {
      if (!screenContext) {
        screenContext = (globalThis.screen as unknown as NxScreen).getContext('webgl2', options);
        if (screenContext) patchUploads(screenContext, (source) => (source instanceof ShimCanvas ? source.backingContext : undefined));
      }
      return screenContext;
    }
    if (id !== '2d') return null;
    // The app keeps the context it was given across resizes, so it forwards to the current surface.
    this.proxy ??= new Proxy({} as CanvasRenderingContext2D, {
      get: (_target, key) => {
        if (key === 'canvas') return this;
        const context = this.current() as unknown as Record<string | symbol, unknown>;
        const value = context[key];
        if (typeof value !== 'function') return value;
        const method = value as (...args: unknown[]) => unknown;
        if (key === 'measureText') return (...args: unknown[]) => timed(nativeStats.measureText, () => method.apply(context, args));
        if (key === 'fillText') return (...args: unknown[]) => timed(nativeStats.fillText, () => method.apply(context, args));
        return method.bind(context);
      },
      set: (_target, key, value) => {
        (this.current() as unknown as Record<string | symbol, unknown>)[key] = value;
        return true;
      },
    });
    return this.proxy;
  }

  override getBoundingClientRect(): DOMRect {
    return rect(0, 0, SCREEN_W, SCREEN_H);
  }

  private current(): OffscreenCanvasRenderingContext2D {
    const { width, height } = this.size;
    if (!this.surface || this.surface.width < width || this.surface.height < height) {
      // Rounded up, so a canvas that grows a little at a time doesn't reallocate each time.
      const round = (value: number, at: number) => Math.max(at, Math.ceil(value / 64) * 64);
      this.surface = new OffscreenCanvas(round(width, this.surface?.width ?? 0), round(height, this.surface?.height ?? 0));
      this.context2d = this.surface.getContext('2d');
      this.stale = false;
    } else if (this.stale) {
      const context = this.context2d!;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, this.surface.width, this.surface.height);
      context.font = '10px sans-serif';
      context.textAlign = 'start';
      context.textBaseline = 'alphabetic';
      context.fillStyle = '#000000';
      context.strokeStyle = '#000000';
      context.lineWidth = 1;
      this.stale = false;
    }
    return this.context2d!;
  }
}

function createElement(name: string, namespace?: string | null): ShimElement {
  return name.toLowerCase() === 'canvas' && !namespace ? new ShimCanvas() : new ShimElement(name, namespace ?? undefined);
}

// ---------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------

class ShimDocument extends ShimNode {
  readonly documentElement = new ShimElement('html');
  readonly head = new ShimElement('head');
  readonly body = new ShimElement('body');
  activeElement: ShimElement | null = this.body;
  readonly readyState = 'complete';
  readonly visibilityState = 'visible';
  readonly hidden = false;
  readonly compatMode = 'CSS1Compat';
  readonly characterSet = 'UTF-8';
  cookie = '';
  title = '';

  constructor() {
    super(DOCUMENT_NODE, '#document');
  }

  override get ownerDocument(): null {
    return null;
  }

  get defaultView(): typeof globalThis {
    return globalThis;
  }

  get location(): Location {
    return memoryLocation;
  }

  get baseURI(): string {
    return memoryLocation.href;
  }

  get documentURI(): string {
    return memoryLocation.href;
  }

  createElement(name: string): ShimElement {
    return createElement(name);
  }

  createElementNS(namespace: string | null, name: string): ShimElement {
    return createElement(name, namespace);
  }

  createTextNode(data: string): ShimText {
    return new ShimText(data);
  }

  createComment(data: string): ShimComment {
    return new ShimComment(data);
  }

  createDocumentFragment(): ShimFragment {
    return new ShimFragment();
  }

  createEvent(): Event {
    return new Event('');
  }

  getElementById(id: string): ShimElement | null {
    return this.documentElement.querySelector(`#${id}`);
  }

  querySelector(selector: string): ShimElement | null {
    return this.documentElement.matches(selector) ? this.documentElement : this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): ShimElement[] {
    return [...(this.documentElement.matches(selector) ? [this.documentElement] : []), ...this.documentElement.querySelectorAll(selector)];
  }

  getElementsByTagName(name: string): ShimElement[] {
    return this.querySelectorAll(name);
  }

  hasFocus(): boolean {
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Location and history, in memory (the router uses hash URLs; nothing is ever loaded from them)
// ---------------------------------------------------------------------------------------------

const ORIGIN = 'http://localhost';
let currentUrl = new URL(`${ORIGIN}/`);
const entries: { url: string; state: unknown }[] = [{ url: currentUrl.href, state: null }];
let entryIndex = 0;

function fire(type: 'popstate' | 'hashchange', state: unknown): void {
  const event = new Event(type);
  if (type === 'popstate') Object.defineProperty(event, 'state', { value: state });
  globalThis.dispatchEvent(event);
}

function go(url: string, replace: boolean): void {
  const before = currentUrl;
  currentUrl = new URL(url, currentUrl);
  if (replace) entries[entryIndex] = { url: currentUrl.href, state: null };
  else {
    entries.splice(entryIndex + 1);
    entries.push({ url: currentUrl.href, state: null });
    entryIndex++;
  }
  if (before.hash !== currentUrl.hash) {
    fire('popstate', null);
    fire('hashchange', null);
  }
}

const memoryLocation = {
  get href() {
    return currentUrl.href;
  },
  set href(value: string) {
    go(value, false);
  },
  get origin() {
    return currentUrl.origin;
  },
  get protocol() {
    return currentUrl.protocol;
  },
  get host() {
    return currentUrl.host;
  },
  get hostname() {
    return currentUrl.hostname;
  },
  get port() {
    return currentUrl.port;
  },
  get pathname() {
    return currentUrl.pathname;
  },
  get search() {
    return currentUrl.search;
  },
  get hash() {
    return currentUrl.hash;
  },
  set hash(value: string) {
    go(`#${value.replace(/^#/, '')}`, false);
  },
  assign(url: string) {
    go(url, false);
  },
  replace(url: string) {
    go(url, true);
  },
  reload() {
    // Nothing to reload: the app is the whole program.
  },
  toString() {
    return currentUrl.href;
  },
} as unknown as Location;

function travel(delta: number): void {
  const index = entryIndex + delta;
  if (index < 0 || index >= entries.length) return;
  entryIndex = index;
  const before = currentUrl;
  currentUrl = new URL(entries[index].url);
  // Asynchronous, like a browser's history traversal.
  setTimeout(() => {
    fire('popstate', entries[index].state);
    if (before.hash !== currentUrl.hash) fire('hashchange', null);
  }, 0);
}

const memoryHistory = {
  get length() {
    return entries.length;
  },
  get state() {
    return entries[entryIndex].state;
  },
  scrollRestoration: 'manual',
  pushState(state: unknown, _title: string, url?: string | URL | null) {
    entries.splice(entryIndex + 1);
    if (url != null) currentUrl = new URL(String(url), currentUrl);
    entries.push({ url: currentUrl.href, state });
    entryIndex++;
  },
  replaceState(state: unknown, _title: string, url?: string | URL | null) {
    if (url != null) currentUrl = new URL(String(url), currentUrl);
    entries[entryIndex] = { url: currentUrl.href, state };
  },
  back() {
    travel(-1);
  },
  forward() {
    travel(1);
  },
  go(delta = 0) {
    travel(delta);
  },
} as unknown as History;

// ---------------------------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------------------------

const shimDocument = new ShimDocument();
shimDocument.appendChild(shimDocument.documentElement);
shimDocument.documentElement.appendChild(shimDocument.head);
shimDocument.documentElement.appendChild(shimDocument.body);
const base = shimDocument.createElement('base');
base.setAttribute('href', '/');
shimDocument.head.appendChild(base);
shimDocument.body.appendChild(shimDocument.createElement('app-root'));

function define(name: string, value: unknown): void {
  const table = globalThis as unknown as Record<string, unknown>;
  if (table[name] === undefined) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

define('document', shimDocument);
define('location', memoryLocation);
define('history', memoryHistory);
define('Node', ShimNode);
define('Element', ShimElement);
define('HTMLElement', ShimElement);
define('HTMLCanvasElement', ShimCanvas);
define('Text', ShimText);
define('Comment', ShimComment);
define('DocumentFragment', ShimFragment);
define('Document', ShimDocument);
define('innerWidth', SCREEN_W);
define('innerHeight', SCREEN_H);
define('devicePixelRatio', 1);
define('scrollX', 0);
define('scrollY', 0);
define('getComputedStyle', () => ({ fontFamily: 'sans-serif', getPropertyValue: () => '' }));
define('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
define('structuredClone', (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value))));

export { ShimCanvas };
