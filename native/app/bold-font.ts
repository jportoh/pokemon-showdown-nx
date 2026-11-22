// The bold face, registered once (test x5, 2026-11-21).
//
// nx.js only registers the console's system font as `sans-serif` at the normal weight. A canvas font
// like `bold 18px sans-serif` finds no face with that weight, so the engine loads the system font
// again (a ~2 MB copy) and adds it to its font set, on every such assignment, and never frees it. The
// app sets bold fonts for many of its texts and glyphs: native memory grew ~2.5 MB per new text until
// the app ran out of memory, and each lookup got slower as the set grew.
//
// Here that happens once: the copy the engine adds for the first bold font is marked as the bold
// face, so later lookups find it. It draws the same (regular) glyphs as before; only the leak goes.

import { nativeLog } from './native-log';

interface Face {
  family: string;
  weight: string;
}

type FontSet = Iterable<Face> & { size: number };

function fontSet(): FontSet | null {
  const set = (globalThis as unknown as { fonts?: FontSet }).fonts;
  return set && typeof set[Symbol.iterator] === 'function' ? set : null;
}

/** Whether assigning `font` adds a face (the engine's fallback ran). */
function addsFace(set: FontSet, context: OffscreenCanvasRenderingContext2D, font: string): boolean {
  const before = set.size;
  context.font = '10px sans-serif';
  context.font = font;
  return set.size !== before;
}

export function registerBoldFace(): void {
  const set = fontSet();
  if (!set) {
    nativeLog('[fonts] no font set: bold face not registered');
    return;
  }
  try {
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (!context) return;
    const before = new Set(set);
    if (!addsFace(set, context, 'bold 10px sans-serif')) {
      nativeLog(`[fonts] bold already resolves (${set.size} faces)`);
      return;
    }
    const added = [...set].filter((face) => !before.has(face) && face.family === 'sans-serif');
    // The weight is compared as the font parser gives it: try the keyword, then the number.
    for (const weight of ['bold', '700']) {
      for (const face of added) face.weight = weight;
      if (!addsFace(set, context, 'bold 12px sans-serif')) {
        nativeLog(`[fonts] bold face registered as weight ${weight} (${set.size} faces)`);
        return;
      }
    }
    nativeLog(`[fonts] bold face NOT registered: bold fonts still add faces (${set.size} faces)`);
  } catch (error) {
    nativeLog(`[fonts] registering the bold face failed: ${String(error)}`);
  }
}

/** How many faces the engine holds (stays small once the bold face is registered). */
export function fontFaceCount(): number {
  return fontSet()?.size ?? -1;
}
