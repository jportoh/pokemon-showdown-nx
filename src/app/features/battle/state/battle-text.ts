// The battle log's wording for Showdown's protocol messages, following Showdown's own texts
// (data/text/default.ts in the client). Pure functions: the store supplies the names, already worded
// ("Garchomp", "the opposing Garchomp", "your team").

/** Names as the log says them, capitalised or not for the start of a sentence. */
export interface BattleNames {
  pokemon(ident: string, sentenceStart?: boolean): string;
  /** A side ("p1: Name" or "p1"): "your team", "the opposing team", "Name's team". */
  team(side: string, sentenceStart?: boolean): string;
}

/** `[from] item: Leftovers`-style tags after a protocol line's arguments. */
export type LineTags = Record<string, string>;

/** "move: Light Screen" → "Light Screen". */
export function effectName(effect = ''): string {
  return effect.replace(/^(move|ability|item): /, '');
}

const STATS: Record<string, string> = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  accuracy: 'accuracy',
  evasion: 'evasiveness',
};

/** Start and end texts; the weather's id as Showdown sends it. */
const WEATHER: Record<string, [string, string]> = {
  SunnyDay: ['The sunlight turned harsh!', 'The harsh sunlight faded.'],
  DesolateLand: ['The sunlight turned extremely harsh!', 'The extremely harsh sunlight faded.'],
  RainDance: ['It started to rain!', 'The rain stopped.'],
  PrimordialSea: ['A heavy rain began to fall!', 'The heavy rain has lifted!'],
  Sandstorm: ['A sandstorm kicked up!', 'The sandstorm subsided.'],
  Snowscape: ['It started to snow!', 'The snow stopped.'],
  Snow: ['It started to snow!', 'The snow stopped.'],
  Hail: ['It started to hail!', 'The hail stopped.'],
  DeltaStream: [
    'Mysterious strong winds are protecting Flying-type Pokémon!',
    'The mysterious strong winds have dissipated!',
  ],
};

export function weatherText(weather: string, ending: boolean): string {
  const texts = WEATHER[weather];
  if (!texts) return ending ? 'The weather cleared up.' : `The weather became ${weather}.`;
  return texts[ending ? 1 : 0];
}

const FIELD: Record<string, [string, string]> = {
  'Trick Room': ['The dimensions were twisted!', 'The twisted dimensions returned to normal!'],
  'Electric Terrain': [
    'An electric current ran across the battlefield!',
    'The electricity disappeared from the battlefield.',
  ],
  'Grassy Terrain': [
    'Grass grew to cover the battlefield!',
    'The grass disappeared from the battlefield.',
  ],
  'Misty Terrain': [
    'Mist swirled around the battlefield!',
    'The mist disappeared from the battlefield.',
  ],
  'Psychic Terrain': [
    'The battlefield got weird!',
    'The weirdness disappeared from the battlefield!',
  ],
  Gravity: ['Gravity intensified!', 'Gravity returned to normal!'],
};

export function fieldText(
  effect: string,
  ending: boolean,
  names: BattleNames,
  tags: LineTags,
): string {
  const name = effectName(effect);
  if (name === 'Trick Room' && !ending && tags['of'])
    return `${names.pokemon(tags['of'])} twisted the dimensions!`;
  const texts = FIELD[name];
  return texts ? texts[ending ? 1 : 0] : `${name} ${ending ? 'ended' : 'took effect'}!`;
}

export function sideText(
  side: string,
  effect: string,
  ending: boolean,
  names: BattleNames,
): string {
  const name = effectName(effect);
  const team = names.team(side, false);
  const Team = names.team(side);
  if (ending) {
    if (name === 'Tailwind') return `${Team}'s Tailwind petered out!`;
    return `${Team}'s ${name} wore off!`;
  }
  switch (name) {
    case 'Reflect':
      return `Reflect made ${team} stronger against physical moves!`;
    case 'Light Screen':
      return `Light Screen made ${team} stronger against special moves!`;
    case 'Aurora Veil':
      return `Aurora Veil made ${team} stronger against physical and special moves!`;
    case 'Tailwind':
      return `The Tailwind blew from behind ${team}!`;
    case 'Safeguard':
      return `${Team} cloaked itself in a mystical veil!`;
    case 'Stealth Rock':
      return `Pointed stones float in the air around ${team}!`;
    case 'Toxic Spikes':
      return `Poison spikes were scattered on the ground all around ${team}!`;
    default:
      return `${name} took effect on ${team}'s side!`;
  }
}

export function boostText(
  ident: string,
  stat: string,
  amount: number,
  raised: boolean,
  names: BattleNames,
): string {
  const who = `${names.pokemon(ident)}'s ${STATS[stat] ?? stat}`;
  if (amount === 0) return `${who} won't go any ${raised ? 'higher' : 'lower'}!`;
  if (raised)
    return `${who} ${amount === 1 ? 'rose' : amount === 2 ? 'rose sharply' : 'rose drastically'}!`;
  return `${who} ${amount === 1 ? 'fell' : amount === 2 ? 'harshly fell' : 'severely fell'}!`;
}

export function statusText(ident: string, status: string, names: BattleNames): string {
  const who = names.pokemon(ident);
  switch (status) {
    case 'brn':
      return `${who} was burned!`;
    case 'par':
      return `${who} is paralyzed, so it may be unable to move!`;
    case 'slp':
      return `${who} fell asleep!`;
    case 'frz':
      return `${who} was frozen solid!`;
    case 'psn':
      return `${who} was poisoned!`;
    case 'tox':
      return `${who} was badly poisoned!`;
    default:
      return `${who} got ${status}!`;
  }
}

export function cureText(ident: string, status: string, names: BattleNames): string {
  const who = names.pokemon(ident);
  switch (status) {
    case 'slp':
      return `${who} woke up!`;
    case 'frz':
      return `${who} thawed out!`;
    case 'par':
      return `${who} was cured of paralysis.`;
    case 'brn':
      return `${who}'s burn was healed.`;
    default:
      return `${who} was cured of its poisoning.`;
  }
}

/** `|cant|`: why a Pokémon couldn't move. */
export function cantText(
  ident: string,
  reason: string,
  move: string | undefined,
  names: BattleNames,
): string {
  const who = names.pokemon(ident);
  switch (effectName(reason)) {
    case 'slp':
      return `${who} is fast asleep.`;
    case 'par':
      return `${who} is paralyzed! It can't move!`;
    case 'frz':
      return `${who} is frozen solid!`;
    case 'flinch':
      return `${who} flinched and couldn't move!`;
    case 'recharge':
      return `${who} must recharge!`;
    case 'Taunt':
      return `${who} can't use ${move ?? 'that move'} after the taunt!`;
    case 'Disable':
      return `${who}'s ${move ?? 'move'} is disabled!`;
    default:
      return `${who} can't move!`;
  }
}

/** Moves that shield a Pokémon (or its side) for the turn. */
const PROTECTING = [
  'Protect',
  'Detect',
  'Wide Guard',
  'Quick Guard',
  'Spiky Shield',
  "King's Shield",
  'Baneful Bunker',
  'Silk Trap',
  'Burning Bulwark',
  'Max Guard',
];

export function isProtection(effect: string): boolean {
  return PROTECTING.includes(effectName(effect));
}

/** `|-singleturn|`: a move that lasts the turn. Null for the ones the log doesn't mention. */
export function singleTurnText(
  ident: string,
  effect: string,
  names: BattleNames,
  tags: LineTags,
): string | null {
  const who = names.pokemon(ident);
  const name = effectName(effect);
  if (isProtection(name)) return `${who} protected itself!`;
  switch (name) {
    case 'Follow Me':
    case 'Rage Powder':
    case 'Spotlight':
      return `${who} became the center of attention!`;
    case 'Helping Hand':
      return tags['of']
        ? `${who} is ready to help ${names.pokemon(tags['of'], false)}!`
        : `${who} is ready to help!`;
    case 'Endure':
      return `${who} braced itself!`;
    default:
      return null;
  }
}

/** `|-activate|`: only the effects worth a line; null for the rest. */
export function activateText(ident: string, effect: string, names: BattleNames): string | null {
  const who = names.pokemon(ident);
  const name = effectName(effect);
  if (isProtection(name)) return `${who} protected itself!`;
  switch (name) {
    case 'confusion':
      return `${who} is confused!`;
    case 'Focus Sash':
      return `${who} hung on using its Focus Sash!`;
    case 'Substitute':
      return `The substitute took damage for ${names.pokemon(ident, false)}!`;
    default:
      return null;
  }
}

/** `|-start|` / `|-end|` for volatile effects (confusion, Substitute, Taunt…); null for the rest. */
export function volatileText(
  ident: string,
  effect: string,
  ending: boolean,
  names: BattleNames,
  extra?: string,
): string | null {
  const who = names.pokemon(ident);
  const name = effectName(effect);
  if (ending) {
    switch (name) {
      case 'confusion':
        return `${who} snapped out of its confusion!`;
      case 'Substitute':
        return `${who}'s substitute faded!`;
      case 'Taunt':
        return `${who} shook off the taunt!`;
      case 'Encore':
        return `${who}'s encore ended!`;
      case 'Disable':
        return `${who}'s move is no longer disabled!`;
      case 'Illusion':
        return `${who}'s illusion wore off!`;
      default:
        return null;
    }
  }
  switch (name) {
    case 'confusion':
      return `${who} became confused!`;
    case 'Substitute':
      return `${who} put in a substitute!`;
    case 'Taunt':
      return `${who} fell for the taunt!`;
    case 'Encore':
      return `${who} must do an encore!`;
    case 'Disable':
      return `${who}'s ${extra ?? 'move'} was disabled!`;
    case 'Yawn':
      return `${who} grew drowsy!`;
    case 'Salt Cure':
      return `${who} is being salt cured!`;
    case 'Leech Seed':
      return `${who} was seeded!`;
    case 'Dragon Cheer':
      return `${who} is getting pumped!`;
    case 'Imprison':
      return `${who} sealed any moves its target shares with it!`;
    default:
      return null;
  }
}

/** Why a Pokémon lost HP outside a direct hit (`[from]`); null when a move did it. */
export function damageReason(ident: string, tags: LineTags, names: BattleNames): string | null {
  const who = names.pokemon(ident);
  const from = tags['from'];
  if (!from) return null;
  switch (effectName(from)) {
    case 'brn':
      return `${who} was hurt by its burn!`;
    case 'psn':
    case 'tox':
      return `${who} was hurt by poison!`;
    case 'Recoil':
    case 'recoil':
      return `${who} was damaged by the recoil!`;
    case 'Life Orb':
      return `${who} lost some of its HP!`;
    case 'Sandstorm':
      return `${who} is buffeted by the sandstorm!`;
    case 'Hail':
      return `${who} is buffeted by the hail!`;
    case 'confusion':
      return 'It hurt itself in its confusion!';
    case 'Stealth Rock':
      return `Pointed stones dug into ${names.pokemon(ident, false)}!`;
    case 'Salt Cure':
      return `${who} is hurt by Salt Cure!`;
    case 'Leech Seed':
      return `${who}'s health is sapped by Leech Seed!`;
    case 'Rocky Helmet':
      return tags['of']
        ? `${who} was hurt by ${names.pokemon(tags['of'], false)}'s Rocky Helmet!`
        : `${who} was hurt by the Rocky Helmet!`;
    case 'Spiky Shield':
      return `${who} was hurt!`;
    default:
      if (from.startsWith('ability: ')) return `${who} was hurt!`;
      // Binding moves (Infestation, Whirlpool…) hurt at the end of each turn.
      return from.startsWith('move: ') ? `${who} is hurt by ${effectName(from)}!` : null;
  }
}

/** Why a Pokémon got HP back (`[from]`); null when a move did it. */
export function healReason(ident: string, tags: LineTags, names: BattleNames): string | null {
  const who = names.pokemon(ident);
  const from = tags['from'];
  if (!from) return null;
  if (from === 'drain')
    return tags['of'] ? `${names.pokemon(tags['of'])} had its energy drained!` : null;
  if (from === 'item: Leftovers') return `${who} restored a little HP using its Leftovers!`;
  // A berry was already announced by |-enditem| ("ate its Sitrus Berry!").
  if (from.endsWith(' Berry')) return null;
  if (from.startsWith('item: ') || from.startsWith('ability: '))
    return `${who} restored HP using its ${effectName(from)}!`;
  if (from === 'Grassy Terrain') return `${who}'s HP was restored.`;
  return null;
}

/** `|-enditem|`: an item eaten, used up or taken. */
export function endItemText(
  ident: string,
  item: string,
  tags: LineTags,
  names: BattleNames,
): string {
  const who = names.pokemon(ident);
  if ('eat' in tags) return `${who} ate its ${item}!`;
  if ('weaken' in tags) return `The ${item} weakened the damage to ${names.pokemon(ident, false)}!`;
  if (tags['from'] === 'move: Knock Off' && tags['of'])
    return `${names.pokemon(tags['of'])} knocked off ${names.pokemon(ident, false)}'s ${item}!`;
  if (item === 'Air Balloon') return `${who}'s Air Balloon popped!`;
  if (item === 'Focus Sash') return `${who} hung on using its Focus Sash!`;
  return `${who}'s ${item} was used up.`;
}

/** `|-ability|`: Showdown's ability pop-up, "[The opposing Incineroar's Intimidate]", or Trace copying one. */
export function abilityText(
  ident: string,
  ability: string,
  tags: LineTags,
  names: BattleNames,
): string {
  if (tags['from'] === 'ability: Trace' && tags['of']) {
    return `${names.pokemon(ident)} traced ${names.pokemon(tags['of'], false)}'s ${ability}!`;
  }
  return `[${names.pokemon(ident)}'s ${ability}]`;
}

/** `|-item|`: an item revealed (Frisk) or obtained (Trick). */
export function itemText(ident: string, item: string, tags: LineTags, names: BattleNames): string {
  if (tags['from'] === 'ability: Frisk' && tags['of']) {
    return `${names.pokemon(tags['of'])} frisked ${names.pokemon(ident, false)} and found its ${item}!`;
  }
  return `${names.pokemon(ident)} obtained one ${item}.`;
}

/** The arguments after the command, split into positional ones and `[tag] value` ones. */
export function splitArgs(parts: readonly string[]): { args: string[]; tags: LineTags } {
  const args: string[] = [];
  const tags: LineTags = {};
  for (const part of parts) {
    const tag = /^\[([^\]]+)\]\s?(.*)$/.exec(part);
    if (tag) tags[tag[1]] = tag[2];
    else args.push(part);
  }
  return { args, tags };
}
