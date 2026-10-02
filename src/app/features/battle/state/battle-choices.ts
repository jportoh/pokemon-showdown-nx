import { Service, computed, inject, linkedSignal } from '@angular/core';
import { BattlePokemon, RequestMove, RequestPokemon, SlotChoice } from '@features/battle/models/battle';
import { ChampionsDex } from '@core/dex/champions-dex';
import { moveType } from '@core/dex/moves';
import { BattleStore, parseCondition } from './battle-store';

/** How the moves that hit fixed Pokémon read in the turn summary. */
const TARGET_LABELS: Record<string, string> = {
  allAdjacentFoes: 'both foes',
  allAdjacent: 'everyone around it',
  self: 'itself',
  allySide: 'its side',
  foeSide: "the foes' side",
  all: 'the whole field',
  allies: 'its side',
  allyTeam: 'its team',
};

/** Move targets the player picks in doubles; every other kind hits fixed Pokémon (itself, all foes…). */
const CHOSEN_TARGETS = ['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf'];

export interface TargetOption {
  /** Showdown's target number: 1, 2 for the foes' slots; -1, -2 for the player's. */
  target: number;
  pokemon: BattlePokemon | null;
  foe: boolean;
  allowed: boolean;
}

/** What one active Pokémon was told to do this turn, for the panel while the turn plays. */
export interface PlannedAction {
  slot: number;
  /** The Pokémon that got the order. */
  name: string;
  /** "Earthquake", "Switch to Incineroar". */
  action: string;
  /** "Ground · all adjacent", "→ the opposing Garchomp". */
  detail: string;
  /** The move's type, for its colour; '' for switches. */
  type: string;
}

export interface SwitchOption {
  /** Showdown's switch number: the Pokémon's position in the request, from 1. */
  index: number;
  name: string;
  /** "Garchomp", from the request's details: how the team tiles on the right find it. */
  species: string;
  fainted: boolean;
  allowed: boolean;
  /** Why it can't come in ("Meow has fainted and can't battle."); '' while it can. */
  blocked: string;
}

/**
 * The turn's choices, built one active slot at a time from the store's request: a move (and its
 * target, when there's one to pick) or a switch for each slot, then sent together as Showdown's
 * choice string ("move 1 2 mega, switch 3", "move 3 terastallize"). `back()` undoes one step. A root service like the
 * store, so half-made choices survive a visit to another page.
 */
@Service()
export class BattleChoices {
  private readonly store = inject(BattleStore);
  private readonly dex = inject(ChampionsDex);

  /** One entry per slot already decided, in slot order. Starts over with every request. */
  private readonly choices = linkedSignal<unknown, SlotChoice[]>({
    source: this.store.request,
    computation: () => [],
  });
  /** The move waiting for its target to be picked. */
  readonly pendingMove = linkedSignal<unknown, { move: number; mega: boolean; tera: boolean } | null>({
    source: this.choices,
    computation: () => null,
  });
  /** Whether the slot being chosen for will Mega Evolve. */
  readonly mega = linkedSignal<unknown, boolean>({ source: this.choices, computation: () => false });
  /** Whether the slot being chosen for will Terastallize. */
  readonly tera = linkedSignal<unknown, boolean>({ source: this.choices, computation: () => false });
  /** Why the Pokémon just picked on the party screen can't come in; cleared by each new step. */
  readonly notice = linkedSignal<unknown, string>({ source: () => [this.choices(), this.pendingMove()], computation: () => '' });

  private readonly request = this.store.request;

  /** The last choices sent, described; cleared by a new battle. */
  readonly submitted = linkedSignal<unknown, readonly PlannedAction[]>({
    source: this.store.battleId,
    computation: () => [],
  });

  /** This turn's orders so far, described (the second slot shows the first one's). */
  readonly planned = computed(() => this.choices().flatMap((choice, slot) => this.describe(choice, slot) ?? []));

  /** How many active slots this request covers. */
  private readonly slotCount = computed(() => {
    const request = this.request();
    return request?.forceSwitch?.length ?? request?.active?.length ?? 0;
  });

  /** The slot being chosen for, skipping slots with nothing to choose; null once every slot is done. */
  readonly slot = computed(() => {
    const request = this.request();
    if (!request || request.wait) return null;
    for (let slot = this.choices().length; slot < this.slotCount(); slot++) {
      if (this.needsChoice(slot)) return slot;
    }
    return null;
  });

  readonly forceSwitch = computed(() => !!this.request()?.forceSwitch);

  /** The Pokémon being chosen for, from the request (its active Pokémon come first, in slot order). */
  readonly pokemon = computed(() => {
    const slot = this.slot();
    return slot === null ? null : (this.request()?.side.pokemon[slot] ?? null);
  });

  readonly pokemonName = computed(() => nameOf(this.pokemon()));

  /** Whether the Pokémon being chosen for has fainted (one forced out by U-turn or Parting Shot hasn't). */
  readonly pokemonFainted = computed(() => {
    const pokemon = this.pokemon();
    return !!pokemon && parseCondition(pokemon.condition, 100).fainted;
  });

  readonly moves = computed<readonly RequestMove[]>(() => {
    const slot = this.slot();
    return slot === null ? [] : (this.request()?.active?.[slot]?.moves ?? []);
  });

  /** Only one Pokémon Mega Evolves per battle: not this one if the other slot already will. */
  readonly canMega = computed(() => {
    const slot = this.slot();
    if (slot === null || !this.request()?.active?.[slot]?.canMegaEvo) return false;
    return !this.choices().some((choice) => choice.kind === 'move' && choice.mega);
  });

  /** The Tera type the slot being chosen for can Terastallize into; '' when it can't (once per battle). */
  readonly teraType = computed(() => {
    const slot = this.slot();
    const type = slot === null ? '' : (this.request()?.active?.[slot]?.canTerastallize ?? '');
    return type && !this.choices().some((choice) => choice.kind === 'move' && choice.tera) ? type : '';
  });

  /** Whether there's an earlier step to go back to. */
  readonly canGoBack = computed(() => this.pendingMove() !== null || this.choices().some((choice) => choice.kind !== 'pass'));

  readonly switchOptions = computed<readonly SwitchOption[]>(() => {
    const request = this.request();
    if (!request) return [];
    const taken = this.choices().flatMap((choice) => (choice.kind === 'switch' ? [choice.slot] : []));
    const slot = this.slot();
    const trapped = !request.forceSwitch && slot !== null && !!request.active?.[slot]?.trapped;
    const current = slot === null ? '' : nameOf(request.side.pokemon[slot] ?? null);
    return request.side.pokemon.map((pokemon, i) => {
      const { fainted } = parseCondition(pokemon.condition, 100);
      const name = nameOf(pokemon);
      const blocked = fainted
        ? `${name} has fainted and can't battle.`
        : pokemon.active
          ? `${name} is already in battle.`
          : taken.includes(i + 1)
            ? `${name} is already coming in.`
            : trapped
              ? `${current} is trapped and can't switch out.`
              : '';
      return { index: i + 1, name, species: pokemon.details.split(',')[0], fainted, allowed: !blocked, blocked };
    });
  });

  /** The four slots on the field, laid out as the target picker shows them: foes on top, facing the player. */
  readonly targetOptions = computed<readonly TargetOption[]>(() => {
    const pending = this.pendingMove();
    const slot = this.slot();
    if (!pending || slot === null) return [];
    const type = this.moves()[pending.move]?.target ?? 'normal';
    const { p1, p2 } = this.store.sides();
    const option = (pokemon: BattlePokemon | null, target: number, foe: boolean): TargetOption => {
      const self = !foe && -target - 1 === slot;
      const allowed = !!pokemon && !pokemon.fainted && targetAllowed(type, foe, self);
      return { target, pokemon, foe, allowed };
    };
    return [option(p2.active[1], 2, true), option(p2.active[0], 1, true), option(p1.active[0], -1, false), option(p1.active[1], -2, false)];
  });

  chooseMove(index: number): void {
    const move = this.moves()[index];
    if (!move || move.disabled) return;
    const mega = this.canMega() && this.mega();
    const tera = !!this.teraType() && this.tera();
    if (!CHOSEN_TARGETS.includes(move.target) || this.slotCount() < 2) {
      this.add({ kind: 'move', move: index + 1, mega, tera });
      return;
    }
    this.pendingMove.set({ move: index, mega, tera });
    // Nothing to pick when only one Pokémon can be targeted.
    const allowed = this.targetOptions().filter((option) => option.allowed);
    if (allowed.length === 1) this.chooseTarget(allowed[0].target);
  }

  chooseTarget(target: number): void {
    const pending = this.pendingMove();
    if (!pending) return;
    this.add({ kind: 'move', move: pending.move + 1, target, mega: pending.mega, tera: pending.tera });
  }

  chooseSwitch(index: number): void {
    const option = this.switchOptions()[index - 1];
    if (option?.allowed) this.add({ kind: 'switch', slot: index });
  }

  toggleMega(): void {
    this.mega.update((mega) => !mega);
  }

  toggleTera(): void {
    this.tera.update((tera) => !tera);
  }

  /** Cancels the target picker, or the previous slot's choice. */
  back(): void {
    if (this.pendingMove()) {
      this.pendingMove.set(null);
      return;
    }
    const choices = [...this.choices()];
    while (choices.length > 0 && choices.at(-1)!.kind === 'pass') choices.pop();
    choices.pop();
    this.choices.set(choices);
  }

  private add(choice: SlotChoice): void {
    const choices = [...this.choices()];
    // Slots skipped before this one pass.
    while (choices.length < (this.slot() ?? choices.length)) choices.push({ kind: 'pass' });
    choices.push(choice);
    while (choices.length < this.slotCount() && !this.needsChoice(choices.length, choices)) choices.push({ kind: 'pass' });
    if (choices.length < this.slotCount()) {
      this.choices.set(choices);
      return;
    }
    this.submitted.set(choices.flatMap((c, slot) => this.describe(c, slot) ?? []));
    this.store.choose(choices.map(toChoiceString).join(', '));
  }

  private describe(choice: SlotChoice, slot: number): PlannedAction | undefined {
    const request = this.request();
    const pokemon = request?.side.pokemon[slot];
    if (!request || !pokemon) return undefined;
    const name = nameOf(pokemon);
    switch (choice.kind) {
      case 'switch': {
        const incoming = nameOf(request.side.pokemon[choice.slot - 1] ?? null);
        return { slot, name, action: `Switch to ${incoming}`, detail: parseCondition(pokemon.condition, 100).fainted ? 'Replacing the fainted Pokémon' : 'Switching out', type: '' };
      }
      case 'move': {
        const move = request.active?.[slot]?.moves[choice.move - 1];
        const type = this.dex.move(move?.id ?? '')?.type ?? moveType(move?.id ?? '');
        const target = choice.target === undefined ? TARGET_LABELS[move?.target ?? ''] ?? '' : `→ ${this.targetName(choice.target)}`;
        const teraType = request.active?.[slot]?.canTerastallize;
        const special = choice.mega ? 'Mega Evolving' : choice.tera ? `Terastallizing into ${teraType}` : '';
        const detail = [type, target, special].filter(Boolean).join(' · ');
        return { slot, name, action: move?.move ?? 'Move', detail, type };
      }
      case 'pass':
        return undefined;
    }
  }

  /** "the opposing Garchomp", "Sparky" for a Showdown target number. */
  private targetName(target: number): string {
    const { p1, p2 } = this.store.sides();
    const pokemon = target > 0 ? p2.active[target - 1] : p1.active[-target - 1];
    if (!pokemon) return 'its target';
    return target > 0 ? `the opposing ${pokemon.name}` : pokemon.name;
  }

  /**
   * Whether the slot has something to choose, given the choices made so far. A forced switch with no one
   * left to send in passes (doubles, the last Pokémon in reserve already chosen for the other slot).
   */
  private needsChoice(slot: number, choices: readonly SlotChoice[] = this.choices()): boolean {
    const request = this.request();
    if (!request) return false;
    if (request.forceSwitch) {
      const taken = choices.flatMap((choice) => (choice.kind === 'switch' ? [choice.slot] : []));
      const inReserve = request.side.pokemon.some(
        (pokemon, i) => !pokemon.active && !parseCondition(pokemon.condition, 100).fainted && !taken.includes(i + 1),
      );
      return !!request.forceSwitch[slot] && inReserve;
    }
    const pokemon = request.side.pokemon[slot];
    return !!pokemon && !parseCondition(pokemon.condition, 100).fainted;
  }
}

function targetAllowed(type: string, foe: boolean, self: boolean): boolean {
  switch (type) {
    case 'adjacentFoe':
      return foe;
    case 'adjacentAlly':
      return !foe && !self;
    case 'adjacentAllyOrSelf':
      return !foe;
    default:
      return !self;
  }
}

function toChoiceString(choice: SlotChoice): string {
  switch (choice.kind) {
    case 'move':
      return ['move', choice.move, choice.target, choice.mega ? 'mega' : undefined, choice.tera ? 'terastallize' : undefined]
        .filter((part) => part !== undefined)
        .join(' ');
    case 'switch':
      return `switch ${choice.slot}`;
    case 'pass':
      return 'pass';
  }
}

/** "p1: Garchomp" → "Garchomp". */
function nameOf(pokemon: RequestPokemon | null): string {
  return pokemon ? pokemon.ident.slice(pokemon.ident.indexOf(': ') + 2) : '';
}
