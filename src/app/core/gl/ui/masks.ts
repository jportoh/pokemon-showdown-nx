import { GlRenderer, Texture } from '../gl-renderer';
import { maskTexture } from '../gl-textures';

/** Each renderer's pixel shapes, made once and kept for the app's run (a few bytes each). */
const MASKS = new WeakMap<GlRenderer, Map<string, Texture>>();

/** A white pixel shape (see maskTexture) to draw tinted, made the first time it's asked for. */
export function maskOf(renderer: GlRenderer, rows: readonly string[]): Texture {
  let masks = MASKS.get(renderer);
  if (!masks) {
    masks = new Map();
    MASKS.set(renderer, masks);
  }
  const key = rows.join('/');
  let texture = masks.get(key);
  if (!texture) {
    texture = maskTexture(renderer, rows);
    masks.set(key, texture);
  }
  return texture;
}
