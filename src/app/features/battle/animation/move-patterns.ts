import { toId } from '@shared/utils/to-id';

/**
 * How a move animates when it has an animation of its own; any other move animates by its category
 * (a burst for physical moves, a flying orb for special ones, rings for status moves).
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
 */
export type MovePattern = 'beam' | 'wave' | 'rush' | 'flurry' | 'clap' | 'room' | 'guard' | 'quake' | 'erupt' | 'rocks' | 'psywave' | 'tailwind';

const PATTERNS: Readonly<Record<MovePattern, readonly string[]>> = {
  beam: [
    'Aurora Beam', 'Charge Beam', 'Dark Pulse', 'Dragon Pulse', 'Electro Shot', 'Flamethrower', 'Flash Cannon',
    'Fleur Cannon', 'Hydro Pump', 'Hyper Beam', 'Ice Beam', 'Meteor Beam', 'Moonblast', 'Origin Pulse',
    'Power Gem', 'Psybeam', 'Solar Beam', 'Steel Beam', 'Thunderbolt', 'Zap Cannon',
  ],
  wave: [
    'Bleakwind Storm', 'Blizzard', 'Boomburst', 'Clanging Scales', 'Dazzling Gleam', 'Discharge', 'Heat Wave',
    'Hyper Voice', 'Icy Wind', 'Make It Rain', 'Muddy Water', 'Overdrive', 'Petal Blizzard', 'Sandsear Storm',
    'Snarl', 'Springtide Storm', 'Surf', 'Wildbolt Storm',
  ],
  rush: [
    'Accelerock', 'Aqua Jet', 'Brave Bird', 'Bullet Punch', 'Extreme Speed', 'Flare Blitz', 'Flip Turn',
    'Grassy Glide', 'Headlong Rush', 'Ice Shard', 'Jet Punch', 'Mach Punch', 'Quick Attack', 'Shadow Sneak',
    'Sucker Punch', 'U-turn', 'Volt Tackle', 'Wave Crash',
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
};

const BY_MOVE = new Map<string, MovePattern>(
  (Object.entries(PATTERNS) as [MovePattern, readonly string[]][]).flatMap(([pattern, moves]) => moves.map((move) => [toId(move), pattern] as const)),
);

/** The move's own animation, or null when it animates by its category. */
export function movePattern(move: string): MovePattern | null {
  return BY_MOVE.get(toId(move)) ?? null;
}
