// The few nx.js globals the probe uses that the DOM lib doesn't describe.
// See https://nxjs.n8.io/runtime for the full API.

interface NxScreen {
  readonly width: number;
  readonly height: number;
  getContext(contextId: 'webgl2'): WebGL2RenderingContext | null;
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
}

interface NxSwitch {
  readonly argv: readonly string[];
  readFileSync(path: string): ArrayBuffer | null;
  writeFileSync(path: string, data: string | ArrayBuffer): void;
  appendFileSync(path: string, data: string): void;
  mkdirSync(path: string): void;
  exit(): never;
}

declare const Switch: NxSwitch;
