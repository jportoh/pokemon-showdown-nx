import { GlRenderer, Texture } from '@core/gl/gl-renderer';

/** A sprite from Showdown's server (allow-listed on Brewser, but sent without CORS headers). */
const REMOTE_SPRITE = 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png';
const LOAD_TIMEOUT_MS = 4000;

/** What the console's WebGL can do, as lines for the screen (the test's report). */
export function probeContext(renderer: GlRenderer): string[] {
  const gl = renderer.gl;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const name = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const extensions = gl.getSupportedExtensions() ?? [];
  return [
    `WebGL ${renderer.version} · ${String(name)}`,
    `${String(gl.getParameter(gl.VERSION))} · max texture ${String(gl.getParameter(gl.MAX_TEXTURE_SIZE))}`,
    `${extensions.length} extensions · instancing ${renderer.version === 2 || extensions.includes('ANGLE_instanced_arrays') ? 'yes' : 'no'} · dpr ${window.devicePixelRatio ?? 'n/a'} · canvas ${renderer.canvas.width}x${renderer.canvas.height}`,
  ];
}

/** Whether the 2D canvas draws text we can read back (what the menu's labels need). */
export function probeCanvasText(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return '2D canvas: none';
  try {
    context.fillStyle = '#ffffff';
    context.font = 'bold 28px sans-serif';
    context.textBaseline = 'top';
    context.fillText('W', 0, 0);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    let lit = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) lit++;
    return `2D canvas text: ${lit > 0 ? `ok (${lit} px)` : 'drew nothing'}`;
  } catch (error) {
    return `2D canvas text: ${String(error)}`;
  }
}

/**
 * Four ways to make a texture of a remote sprite: an Image, fetch + createImageBitmap, and a DOM
 * img with and without CORS mode (Brewser fired load only for DOM imgs in earlier tests). Each says
 * whether it loaded and whether WebGL accepted it; the textures that worked are handed back to draw.
 */
export async function probeRemoteSprite(renderer: GlRenderer, host: HTMLElement): Promise<{ lines: string[]; textures: Texture[] }> {
  const lines: string[] = [];
  const textures: Texture[] = [];
  const upload = (label: string, source: TexImageSource, width: number, height: number) => {
    const gl = renderer.gl;
    while (gl.getError() !== gl.NO_ERROR) {
      // Clear earlier errors.
    }
    try {
      const texture = renderer.textureFromSource(source, width, height, false);
      const error = gl.getError();
      if (error === gl.NO_ERROR) {
        textures.push(texture);
        lines.push(`${label}: ok`);
      } else {
        lines.push(`${label}: GL error ${error}`);
      }
    } catch (error) {
      lines.push(`${label}: ${String(error)}`);
    }
  };

  const image = new Image();
  image.crossOrigin = 'anonymous';
  const imageLoaded = await loaded(image, () => (image.src = REMOTE_SPRITE));
  if (imageLoaded === true) upload('Image', image, 96, 96);
  else lines.push(`Image: ${imageLoaded}`);

  if (typeof createImageBitmap === 'function') {
    try {
      const blob = await withTimeout(fetch(REMOTE_SPRITE).then((response) => response.blob()));
      const bitmap = await withTimeout(createImageBitmap(blob));
      upload('fetch+bitmap', bitmap, 96, 96);
    } catch (error) {
      lines.push(`fetch+bitmap: ${String(error)}`);
    }
  } else {
    lines.push('fetch+bitmap: no createImageBitmap');
  }

  // A DOM img with and without CORS mode: Chrome refuses the second as a texture (the server sends
  // no CORS headers), but Brewser's engine may not check.
  for (const cors of [true, false]) {
    const element = document.createElement('img');
    if (cors) element.crossOrigin = 'anonymous';
    element.width = 1;
    element.height = 1;
    element.alt = '';
    const label = cors ? 'DOM img' : 'DOM img no-CORS';
    const domLoaded = await loaded(element, () => {
      element.src = `${REMOTE_SPRITE}?${cors ? 'c' : 'n'}`;
      host.appendChild(element);
    });
    if (domLoaded === true) upload(label, element, 96, 96);
    else lines.push(`${label}: ${domLoaded}`);
    element.remove();
  }

  return { lines, textures };
}

function loaded(image: HTMLImageElement, start: () => void): Promise<true | string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('no load event'), LOAD_TIMEOUT_MS);
    image.addEventListener('load', () => {
      clearTimeout(timer);
      resolve(true);
    });
    image.addEventListener('error', () => {
      clearTimeout(timer);
      resolve('error event');
    });
    start();
  });
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), LOAD_TIMEOUT_MS))]);
}
