/**
 * The battle effects' pixel-art pieces: confusion's stars, the types' flames, drops, bolts, leaves…
 * and the contact moves' fists, feet and fangs. Drawn as pixels (a few screen pixels each), tinted,
 * like the Gen 3 games' own move animations. In the rows, `x` is the body, `o` its dark outline.
 */
export interface EffectShape {
  /** The whole silhouette (body and outline). */
  readonly fill: readonly string[];
  /** The outline alone, drawn darker over the body; empty for shapes of one colour. */
  readonly ink: readonly string[];
  readonly width: number;
  readonly height: number;
}

function shape(rows: readonly string[]): EffectShape {
  const ink = rows.some((row) => row.includes('o')) ? rows.map((row) => row.replace(/x/g, '.').replace(/o/g, 'x')) : [];
  return { fill: rows.map((row) => row.replace(/o/g, 'x')), ink, width: rows[0].length, height: rows.length };
}

export const STAR = shape([
  '.....o.....',
  '....oxo....',
  '...oxxxo...',
  'oooxxxxxooo',
  '.oxxxxxxxo.',
  '..oxxxxxo..',
  '..oxxxxxo..',
  '.oxxxoxxxo.',
  '.oxxo.oxxo.',
  '.ooo...ooo.',
]);

/** A four-pointed glint. */
export const SPARKLE = shape([
  '...x...',
  '...x...',
  '..xxx..',
  'xxxxxxx',
  '..xxx..',
  '...x...',
  '...x...',
]);

export const FLAME = shape([
  '....o....',
  '....oo...',
  '...oxo...',
  '...oxxo..',
  '..oxxxo..',
  '..oxxxxo.',
  '.oxxxxxo.',
  '.oxxxxxxo',
  'oxxxxxxxo',
  'oxxxxxxxo',
  '.oxxxxxo.',
  '..ooooo..',
]);

export const DROP = shape([
  '...o...',
  '...o...',
  '..oxo..',
  '..oxo..',
  '.oxxxo.',
  'oxxxxxo',
  'oxxxxxo',
  '.oxxxo.',
  '..ooo..',
]);

export const BOLT = shape([
  '.....oooo',
  '....oxxo.',
  '...oxxo..',
  '..oxxo...',
  '.oxxoooo.',
  'oxxxxxxo.',
  '.oooxxo..',
  '...oxxo..',
  '..oxxo...',
  '.oxxo....',
  '.oxo.....',
  'oxo......',
  'oo.......',
]);

export const LEAF = shape([
  '.....oooo',
  '...ooxxxo',
  '..oxxxxxo',
  '.oxxxxxo.',
  '.oxxxxo..',
  'oxxxxo...',
  'oxxoo....',
  'oxo......',
  'o........',
]);

export const SNOWFLAKE = shape([
  'x..x..x',
  '.x.x.x.',
  '..xxx..',
  'xxxxxxx',
  '..xxx..',
  '.x.x.x.',
  'x..x..x',
]);

/** A splinter of ice or metal. */
export const SHARD = shape([
  '...o...',
  '..oxo..',
  '..oxo..',
  '.oxxxo.',
  '.oxxxo.',
  'oxxxxxo',
  '.oxxxo.',
  '.oxxxo.',
  '..oxo..',
  '..oxo..',
  '...o...',
]);

export const FEATHER = shape([
  '....ooo',
  '...oxxo',
  '...oxxo',
  '..oxxo.',
  '..oxxo.',
  '.oxxo..',
  '.oxxo..',
  'oxxo...',
  'oxo....',
  'oo.....',
  'o......',
]);

export const HEART = shape([
  '.oo...oo.',
  'oxxo.oxxo',
  'oxxxoxxxo',
  'oxxxxxxxo',
  '.oxxxxxo.',
  '..oxxxo..',
  '...oxo...',
  '....o....',
]);

/** A chunk of rock, outlined. */
export const ROCK = shape([
  '..oooo..',
  '.oxxxxo.',
  'oxxxxxxo',
  'oxxxxxxo',
  'oxxxxxo.',
  '.oxxxxo.',
  '..oooo..',
]);

/** A hit: the spiky "pow" of a direct blow. */
export const POW = shape([
  '........o........',
  '.......oxo.......',
  '..o....oxo....o..',
  '..oxo.oxxxo.oxo..',
  '...oxooxxxooxo...',
  '...oxxxxxxxxxo...',
  '.oooxxxxxxxxxooo.',
  'oxxxxxxxxxxxxxxxo',
  '.oooxxxxxxxxxooo.',
  '...oxxxxxxxxxo...',
  '...oxooxxxooxo...',
  '..oxo.oxxxo.oxo..',
  '..o....oxo....o..',
  '.......oxo.......',
  '........o........',
]);
