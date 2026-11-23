/** The places battles are fought in (the battle screen's backdrops), in the order Settings steps through them. */
export const BATTLEFIELDS = [
  { id: 'meadow', name: 'Meadow' },
  { id: 'coast', name: 'Sunset Coast' },
  { id: 'forest', name: 'Old Forest' },
  { id: 'cave', name: 'Crystal Cave' },
  { id: 'rooftop', name: 'Night Rooftop' },
  { id: 'stadium', name: 'Stadium' },
  { id: 'ruins', name: 'Ruins at Dusk' },
] as const;

export type BattlefieldId = (typeof BATTLEFIELDS)[number]['id'];

/** Settings: a field picked for each battle, or always the same one. */
export type BattlefieldChoice = 'random' | BattlefieldId;

export const BATTLEFIELD_CHOICES: readonly { id: BattlefieldChoice; name: string }[] = [{ id: 'random', name: 'Random' }, ...BATTLEFIELDS];

/**
 * The field a battle is fought in: picked from the battle's number, so both players, whoever watches,
 * its replay and a rejoin all see the same one. `battle` is a room ("battle-gen9ou-123456"), a replay id
 * ("gen9ou-123456", "-…pw" when private) or null (the classic meadow).
 */
export function battlefieldFor(battle: string | null, choice: BattlefieldChoice): BattlefieldId {
  if (choice !== 'random') return choice;
  const key = battle ? /([a-z0-9]+-\d+)/.exec(battle.replace(/^battle-/, ''))?.[1] : null;
  if (!key) return BATTLEFIELDS[0].id;
  // FNV-1a: spreads battle numbers that differ in one digit across the fields.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return BATTLEFIELDS[(hash >>> 0) % BATTLEFIELDS.length].id;
}
