import { Service, inject } from '@angular/core';
import { AudioEngine } from '@core/audio/audio-engine';
import { spriteId } from '@shared/utils/sprite-id';

const CRIES_URL = 'https://play.pokemonshowdown.com/audio/cries';
/** A cry that comes later than this after its Pokémon came out is skipped (it would sound out of place). */
const LATE_MS = 800;
/** A fainting Pokémon's cry: lower and slower, as in the games. */
const FAINT_RATE = 0.8;

/** Formes with a cry of their own, besides the Megas (Showdown's client's lists). */
const FORMES_WITH_CRIES = [
  'bloodmoon', 'crowned', 'eternal', 'eternamax', 'four', 'hangry', 'hero', 'lowkey', 'noice', 'primal',
  'rapidstrike', 'roaming', 'school', 'sky', 'starter', 'super', 'therian', 'unbound',
];
const SPECIES_WITH_FORME_CRIES = [
  'calyrex', 'kyurem', 'cramorant', 'indeedee', 'lycanroc', 'necrozma', 'oinkologne', 'oricorio', 'slowpoke', 'tatsugiri', 'zygarde',
];

/**
 * The Pokémon's cries in battle, from Showdown's server (~7 KB each): when one comes out and when it
 * faints. Team preview fetches the teams' ahead (preload); each is kept for the rest of the battle.
 * A Mega or special forme without a cry file of its own falls back to its species'.
 */
@Service()
export class BattleCries {
  private readonly audio = inject(AudioEngine);
  private readonly cries = new Map<string, Promise<AudioBuffer | null>>();

  /** Fetches the species' cry (and keeps it). */
  preload(species: string): void {
    void this.cry(species);
  }

  /** Plays the species' cry (lower when it faints), as soon as it's here unless that's too late. */
  play(species: string, fainting = false): void {
    if (!species) return;
    const asked = performance.now();
    void this.cry(species).then((buffer) => {
      if (buffer && performance.now() - asked < LATE_MS) this.audio.playBuffer(buffer, fainting ? FAINT_RATE : 1);
    });
  }

  /** Forgets every cry (the battle closed). */
  clear(): void {
    this.cries.clear();
  }

  private cry(species: string): Promise<AudioBuffer | null> {
    const [base, forme] = cryIds(species);
    return this.file(forme ?? base).then((buffer) => buffer ?? (forme ? this.file(base) : null));
  }

  private file(id: string): Promise<AudioBuffer | null> {
    let cry = this.cries.get(id);
    if (!cry) {
      cry = this.audio.load(`${CRIES_URL}/${id}.mp3`);
      this.cries.set(id, cry);
    }
    return cry;
  }
}

/**
 * The species' cry file and, for a Mega or a forme with a cry of its own, that one's: "Charizard-Mega-X"
 * → ["charizard", "charizard-megax"], "Garchomp" → ["garchomp"]. As Showdown's client names them.
 */
function cryIds(species: string): [string, string?] {
  const id = spriteId(species);
  const cut = id.indexOf('-');
  if (cut < 0) return [id];
  const base = id.slice(0, cut);
  const forme = id.slice(cut + 1);
  if (forme.startsWith('mega')) return [base, base === 'meowstic' || base === 'tatsugiri' ? `${base}-mega` : id];
  if (FORMES_WITH_CRIES.includes(forme) || SPECIES_WITH_FORME_CRIES.includes(base)) return [base, id];
  return [base];
}
