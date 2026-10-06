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

/** A fist seen from the front, knuckles up (punches). */
export const FIST = shape([
  '.ooooooooooo.',
  'oxxoxxoxxoxxo',
  'oxxoxxoxxoxxo',
  'oxxoxxoxxoxxo',
  'ooooooooxxxxo',
  'oxxxxxxxoxxxo',
  'oxxxxxxxoxxxo',
  '.oooooooxxxo.',
  '..oxxxxxxxo..',
  '..oxxxxxxxo..',
  '..ooooooooo..',
]);

/** A foot's sole, toes up (kicks and stomps). */
export const FOOT = shape([
  '.o.o.o.o.',
  'oxoxoxoxo',
  '.ooooooo.',
  'oxxxxxxxo',
  'oxxxxxxxo',
  'oxxxxxxxo',
  '.oxxxxxo.',
  '..oxxxo..',
  '..oxxxo..',
  '.oxxxxxo.',
  '.oxxxxxo.',
  '..ooooo..',
]);

/** An upper jaw's teeth, pointing down (bites: turned over, the lower jaw). */
export const FANGS = shape([
  'oooooooooooooooooooo',
  'oxxxxxxxxxxxxxxxxxxo',
  'oxxxooxxxooxxxooxxxo',
  '.oxo..oxo..oxo..oxo.',
  '..o....o....o....o..',
]);

/** A sword, point up (Swords Dance). */
export const SWORD = shape([
  '...o...',
  '..oxo..',
  '..oxo..',
  '..oxo..',
  '..oxo..',
  '..oxo..',
  '..oxo..',
  '..oxo..',
  '..oxo..',
  '..oxo..',
  'ooooooo',
  'oxxxxxo',
  'ooooooo',
  '..oxo..',
  '..oxo..',
  '..ooo..',
]);

/** An open hand, fingers up (Helping Hand, Knock Off's slap). */
export const HAND = shape([
  '.o.o.o.o....',
  'oxoxoxoxo...',
  'oxoxoxoxo...',
  'oxoxoxoxo...',
  'oxxxxxxxo.o.',
  'oxxxxxxxooxo',
  'oxxxxxxxxxxo',
  'oxxxxxxxxxo.',
  '.oxxxxxxxo..',
  '..oxxxxxo...',
  '..oxxxxxo...',
  '..ooooooo...',
]);

/** A musical note (Encore). */
export const NOTE = shape([
  '...ooo..',
  '...oxxo.',
  '...oxoxo',
  '...oxo.o',
  '...oxo..',
  '...oxo..',
  '.oooxo..',
  'oxxxxo..',
  'oxxxxo..',
  '.oooo...',
]);

/** The cross-popping vein of anger (Taunt). */
export const ANGER = shape([
  '.ooo...ooo.',
  'oxxxo.oxxxo',
  'oxxo...oxxo',
  'oxo.....oxo',
  '.o.......o.',
  '...........',
  '.o.......o.',
  'oxo.....oxo',
  'oxxo...oxxo',
  'oxxxo.oxxxo',
  '.ooo...ooo.',
]);

/** A sleepy "Z" (Yawn). */
export const SLEEPY_Z = shape([
  'oooooooo',
  'oxxxxxxo',
  'ooooxxo.',
  '...oxo..',
  '..oxo...',
  '.oxxoooo',
  'oxxxxxxo',
  'oooooooo',
]);

/** Fire Blast's five-pointed blaze, the 大 of the games. */
export const BLAZE = shape([
  '......o......',
  '.....oxo.....',
  '.....oxo.....',
  'ooooooxoooooo',
  'oxxxxxxxxxxxo',
  'ooooooxoooooo',
  '.....oxo.....',
  '....oxxxo....',
  '...oxo.oxo...',
  '..oxo...oxo..',
  '.oxo.....oxo.',
  'oxo.......oxo',
  'oo.........oo',
]);

/** A flickering flame with two tongues (ghostly and magic fire: a plain flame in blue reads as a drop). */
export const WISP = shape([
  '...o.....',
  '...oo..o.',
  '..oxo.oxo',
  '..oxxooxo',
  '.oxxxxxxo',
  '.oxxxxxo.',
  'oxxxxxxxo',
  'oxxxxxxxo',
  'oxxxxxxxo',
  '.oxxxxxo.',
  '..ooooo..',
]);
