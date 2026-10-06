import { toId } from '@shared/utils/to-id';

/**
 * How a move animates when it has an animation of its own; any other move animates by its category
 * (a burst for physical moves, a flying orb for special ones, rings for status moves). The most used
 * moves have one made for them alone (signature-moves.ts), which comes first.
 * - beam: a stream of orbs from the user to each target.
 * - wave: rings rolling out from the user over each target (sound, spread moves).
 * - rush: a faster lunge leaving a trail of the type's colour (priority and charging moves).
 * - flurry: a lunge landing a quick run of hits.
 * - clap: two orbs slam together on the target, which flinches (Fake Out).
 * - room: the whole field pulses (Trick Room and the other rooms).
 * - guard: a hop only; the shield (or the side's barrier) shows as the protection starts.
 * - quake: the field shakes and dust rises under every Pokémon it hits (Earthquake).
 * - erupt: pillars burst out of the ground under each target (Earth Power).
 * - rocks: rocks fall on each target (Rock Slide).
 * - psywave: rings close in on each target, which wobbles (Psychic).
 * - tailwind: gusts sweep across the user's side.
 * - punch, kick, bite, claw, slash: the lunge lands a fist, a foot, a pair of jaws, three claw
 *   marks or a blade's cut on the target, over the type's hit.
 * - slam: the whole body: a longer lunge, a heavier hit and the field shaking (Body Press, Wood Hammer).
 */
export type MovePattern =
  | 'beam'
  | 'wave'
  | 'rush'
  | 'flurry'
  | 'clap'
  | 'room'
  | 'guard'
  | 'quake'
  | 'erupt'
  | 'rocks'
  | 'psywave'
  | 'tailwind'
  | ContactMark
  | 'slam';

/** What a contact move leaves on its target. */
export type ContactMark = 'punch' | 'kick' | 'bite' | 'claw' | 'slash';

const PATTERNS: Readonly<Record<MovePattern, readonly string[]>> = {
  beam: [
    'Aurora Beam', 'Charge Beam', 'Dark Pulse', 'Dragon Pulse', 'Electro Shot', 'Flamethrower', 'Flash Cannon',
    'Fleur Cannon', 'Hydro Pump', 'Hyper Beam', 'Ice Beam', 'Meteor Beam', 'Moonblast', 'Origin Pulse',
    'Power Gem', 'Psybeam', 'Solar Beam', 'Steel Beam', 'Thunderbolt', 'Zap Cannon',
  ],
  wave: [
    'Bleakwind Storm', 'Blizzard', 'Boomburst', 'Clanging Scales', 'Dazzling Gleam', 'Discharge', 'Heat Wave',
    'Hyper Voice', 'Icy Wind', 'Make It Rain', 'Muddy Water', 'Overdrive', 'Petal Blizzard', 'Sandsear Storm',
    'Sludge Wave', 'Snarl', 'Sparkling Aria', 'Springtide Storm', 'Surf', 'Wildbolt Storm',
  ],
  rush: [
    'Accelerock', 'Aqua Jet', 'Brave Bird', 'Bullet Punch', 'Extreme Speed', 'First Impression', 'Flare Blitz',
    'Flip Turn', 'Grassy Glide', 'Headlong Rush', 'Ice Shard', 'Jet Punch', 'Mach Punch', 'Quick Attack',
    'Shadow Sneak', 'Sucker Punch', 'U-turn', 'Volt Tackle', 'Wave Crash',
  ],
  flurry: ['Close Combat', 'Double Hit', 'Dual Chop', 'Dual Wingbeat', 'Population Bomb', 'Surging Strikes', 'Triple Axel'],
  clap: ['Fake Out'],
  room: ['Gravity', 'Magic Room', 'Trick Room', 'Wonder Room'],
  guard: [
    'Baneful Bunker', 'Burning Bulwark', 'Crafty Shield', 'Detect', "King's Shield", 'Mat Block', 'Obstruct',
    'Protect', 'Quick Guard', 'Silk Trap', 'Spiky Shield', 'Wide Guard',
  ],
  quake: ['Bulldoze', 'Earthquake', 'Fissure', 'Magnitude'],
  erupt: ['Earth Power', 'Precipice Blades', 'Scorching Sands', 'Thousand Arrows', 'Thousand Waves'],
  rocks: ['Diamond Storm', 'Rock Slide', 'Rock Tomb', 'Stone Edge'],
  psywave: ['Esper Wing', 'Expanding Force', 'Extrasensory', 'Lumina Crash', 'Psychic', 'Psychic Noise', 'Psycho Boost', 'Psyshock', 'Stored Power'],
  tailwind: ['Tailwind'],
  punch: [
    'Comet Punch', 'Drain Punch', 'Dynamic Punch', 'Fire Punch', 'Focus Punch', 'Hammer Arm', 'Ice Hammer', 'Ice Punch',
    'Mega Punch', 'Meteor Mash', 'Power-Up Punch', 'Rage Fist', 'Shadow Punch', 'Sky Uppercut', 'Thunder Punch', 'Wicked Blow',
  ],
  kick: [
    'Axe Kick', 'Blaze Kick', 'Double Kick', 'High Horsepower', 'High Jump Kick', 'Jump Kick', 'Low Kick', 'Mega Kick',
    'Rolling Kick', 'Stomp', 'Stomping Tantrum', 'Thunderous Kick', 'Triple Kick', 'Trop Kick',
  ],
  bite: [
    'Bite', 'Bolt Beak', 'Crunch', 'Fire Fang', 'Fishious Rend', 'Hyper Fang', 'Ice Fang', 'Jaw Lock', 'Leech Life',
    'Poison Fang', 'Psychic Fangs', 'Super Fang', 'Thunder Fang',
  ],
  claw: ['Crush Claw', 'Dire Claw', 'Dragon Claw', 'Fury Swipes', 'Metal Claw', 'Scratch', 'Shadow Claw'],
  slash: [
    'Aerial Ace', 'Aqua Cutter', 'Behemoth Blade', 'Bitter Blade', 'Brick Break', 'Ceaseless Edge', 'Cross Chop',
    'Cross Poison', 'Fury Cutter', 'Karate Chop', 'Kowtow Cleave', 'Leaf Blade', 'Mighty Cleave', 'Night Slash',
    'Psyblade', 'Psycho Cut', 'Razor Shell', 'Sacred Sword', 'Slash', 'Solar Blade', 'Stone Axe', 'Throat Chop',
    'X-Scissor',
  ],
  slam: [
    'Body Press', 'Body Slam', 'Darkest Lariat', 'Double-Edge', 'Dragon Hammer', 'Giga Impact', 'Gigaton Hammer',
    'Glaive Rush', 'Head Charge', 'Head Smash', 'Heat Crash', 'Heavy Slam', 'Horn Leech', 'Iron Head', 'Iron Tail',
    'Liquidation', 'Megahorn', 'Skull Bash', 'Smart Strike', 'Superpower', 'Take Down', 'Wild Charge', 'Wood Hammer',
    'Zen Headbutt',
  ],
};

/** Moves that drain their damage back: lights fly back from each target to the user, which glows. */
const DRAINING = new Set(
  [
    'Absorb', 'Bitter Blade', 'Drain Punch', 'Draining Kiss', 'Dream Eater', 'Giga Drain', 'Horn Leech', 'Leech Life',
    'Matcha Gotcha', 'Mega Drain', 'Oblivion Wing', 'Parabolic Charge',
  ].map(toId),
);

const BY_MOVE = new Map<string, MovePattern>(
  (Object.entries(PATTERNS) as [MovePattern, readonly string[]][]).flatMap(([pattern, moves]) => moves.map((move) => [toId(move), pattern] as const)),
);

/** The move's own animation, or null when it animates by its category. */
export function movePattern(move: string): MovePattern | null {
  return BY_MOVE.get(toId(move)) ?? null;
}

export function isContactMark(pattern: MovePattern | null): pattern is ContactMark {
  return pattern === 'punch' || pattern === 'kick' || pattern === 'bite' || pattern === 'claw' || pattern === 'slash';
}

/** The move drains its damage back to its user. */
export function drains(move: string): boolean {
  return DRAINING.has(toId(move));
}

/** Every move with an animation pattern, by pattern. */
export function patternMoves(): Readonly<Record<MovePattern, readonly string[]>> {
  return PATTERNS;
}
