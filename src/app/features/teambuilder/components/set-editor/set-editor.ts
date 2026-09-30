import { Component, ElementRef, afterRenderEffect, computed, inject, input, linkedSignal, output, signal, untracked, viewChild } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies, StatTable } from '@core/dex/champions-dex';
import { ChooserOption, DexChooser } from '@features/teambuilder/components/dex-chooser/dex-chooser';
import { DetailsField, SetDetails } from '@features/teambuilder/components/set-details/set-details';
import { SetStats } from '@features/teambuilder/components/set-stats/set-stats';
import { STAT_IDS } from '@features/teambuilder/data/game-rules';
import { MAX_MOVES, PokemonSet, StatSpread, Team } from '@features/teambuilder/models/team';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { typeColor } from '@shared/data/type-colors';
import { typeRank } from '@shared/data/type-order';
import { BackAction } from '@shared/directives/back-action';
import { toId } from '@shared/utils/to-id';

/** Fields picked from a list, in the order the chooser walks through them. */
type ChooserField = DetailsField;
const CHOOSER_ORDER: readonly ChooserField[] = ['species', 'item', 'ability', 'move0', 'move1', 'move2', 'move3'];
/** Lists short enough to scroll through whole: no search box, so no on-screen keyboard. */
const SEARCHABLE_FIELDS: readonly ChooserField[] = ['species', 'item'];
const MOVE_FIELDS: readonly ChooserField[] = ['move0', 'move1', 'move2', 'move3'];

const MAX_DETAIL_LENGTH = 90;

@Component({
  imports: [DexChooser, SetDetails, SetStats, BackAction],
  selector: 'app-set-editor',
  host: { class: 'block' },
  templateUrl: './set-editor.html',
})
export class SetEditor {
  private readonly store = inject(TeamStore);
  private readonly dex = inject(ChampionsDex);
  private readonly chooser = viewChild.required(DexChooser);
  private readonly stats = viewChild(SetStats);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly team = input<Team | undefined>(undefined);
  /** The slot being edited; the team's length for a new Pokémon. */
  readonly index = input(0);
  readonly closed = output<void>();

  protected readonly pokemon = computed(() => this.team()?.sets[this.index()]);
  protected readonly species = computed(() => {
    const pokemon = this.pokemon();
    return pokemon ? this.dex.species(pokemon.species) : undefined;
  });
  /** What the Pokémon Mega Evolves into, when it holds its Mega Stone. */
  protected readonly mega = computed(() => {
    const pokemon = this.pokemon();
    return pokemon ? this.dex.mega(pokemon.species, pokemon.item) : undefined;
  });
  /** Stats are shown for the form it battles in: the Mega's when it holds its stone. */
  protected readonly baseStats = computed<StatTable | undefined>(() => (this.mega() ?? this.species())?.baseStats);

  // UI state that starts over whenever another slot is opened (and only then: the Pokémon itself is
  // read untracked, or creating it would reset the chooser mid-flow). A new slot opens on the species list.
  private readonly slotKey = computed(() => `${this.team()?.id}:${this.index()}`);
  protected readonly tab = linkedSignal<string, 'details' | 'stats'>({ source: this.slotKey, computation: () => 'details' });
  protected readonly activeField = linkedSignal<string, ChooserField | null>({
    source: this.slotKey,
    computation: () => (untracked(this.pokemon) ? null : 'species'),
  });
  protected readonly confirmingRemove = linkedSignal({ source: this.slotKey, computation: () => false });

  /** The controller button's pill at the start of a header button. */
  protected readonly shortcutClass = 'absolute top-[5px] left-[8px] block h-6 w-8 rounded-sm bg-gray-900 text-center text-sm leading-6 font-bold';

  protected readonly title = computed(
    () => `Slot ${this.index() + 1} · ${this.mega()?.name ?? this.species()?.name ?? this.pokemon()?.species ?? 'New Pokémon'}`,
  );

  /** "Mega Evolves into Garchomp-Mega · Dragon / Ground · Sand Force" */
  protected readonly megaSummary = computed(() => {
    const mega = this.mega();
    return mega ? `Mega Evolves into ${mega.name} · ${mega.types.join(' / ')} · ${mega.ability}` : '';
  });

  protected readonly abilityOptions = computed(() => {
    const abilities = this.species()?.abilities ?? [];
    const current = this.pokemon()?.ability;
    return current && !abilities.includes(current) ? [current, ...abilities] : abilities;
  });

  // Chooser options for the species and item lists, built once: the data only has what the format
  // allows (typing filters inside the chooser). Megas are listed as species too: picking one picks its
  // base species holding the Mega Stone.
  private readonly speciesOptions: readonly ChooserOption[] = [
    ...this.dex.allSpecies.map((species) => ({ id: species.id, name: species.name, detail: speciesDetail(species) })),
    ...this.dex.allMegas.map((mega) => ({ id: mega.id, name: mega.name, detail: megaDetail(mega, this.dex.item(mega.item)?.name ?? mega.item) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  private readonly itemOptions: readonly ChooserOption[] = [
    ...this.dex.allItems.map((item) => ({ id: item.id, name: item.name, detail: shorten(item.desc), icon: item.id })),
  ];
  private readonly popularItemIds = new Set(this.dex.popularItems.map((item) => item.id));

  /**
   * Until something is typed, the item list only shows the item it holds when that isn't
   * a popular one (so the current choice is always there to keep) and Showdown's popular items.
   */
  protected readonly chooserSuggested = computed<readonly ChooserOption[] | null>(() => {
    if (this.activeField() !== 'item') return null;
    const held = toId(this.pokemon()?.item ?? '');
    return this.itemOptions.filter((option) => option.id === held || this.popularItemIds.has(option.id));
  });

  protected readonly chooserTitle = computed(() => {
    const field = this.activeField();
    if (field === 'species') return 'Choose a species';
    if (field === 'item') return 'Choose an item';
    if (field === 'ability') return 'Choose an ability';
    return field ? `Choose move ${MOVE_FIELDS.indexOf(field) + 1}` : '';
  });

  /** The species' moves by type, in the games' order, then by name. */
  private readonly sortedMoves = computed(() =>
    [...(this.species()?.moves ?? [])].sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name)),
  );

  protected readonly chooserOptions = computed<readonly ChooserOption[]>(() => {
    const field = this.activeField();
    if (field === 'species') return this.speciesOptions;
    if (field === 'item') return this.itemOptions;
    if (field === 'ability') {
      return this.abilityOptions().map((name) => ({ id: toId(name), name, detail: this.dex.ability(name)?.desc ?? '' }));
    }
    if (!field) return [];
    // A move already in another slot isn't offered again.
    const slot = MOVE_FIELDS.indexOf(field);
    const taken = new Set((this.pokemon()?.moves ?? []).filter((_, i) => i !== slot).map(toId));
    return [
      ...this.sortedMoves()
        .filter((move) => !taken.has(move.id))
        .map((move) => ({
          id: move.id,
          name: move.name,
          detail: moveDetail(move.type, move.basePower),
          color: typeColor(move.type),
          categoryIcon: `categories/${move.category.toLowerCase()}.png`,
          label: [move.name, move.type, move.category, move.basePower ? `${move.basePower} BP` : ''].filter(Boolean).join(', '),
        })),
    ];
  });

  protected readonly chooserSelectedId = computed(() => {
    const field = this.activeField();
    const pokemon = this.pokemon();
    if (field === 'species') return this.mega()?.id ?? this.species()?.id ?? '';
    if (field === 'item') return toId(pokemon?.item ?? '');
    if (field === 'ability') return toId(pokemon?.ability ?? '');
    if (!field) return '';
    return toId(pokemon?.moves[MOVE_FIELDS.indexOf(field)] ?? '');
  });

  /** Moves come from the species' learnset, so a species the format doesn't allow has none. */
  protected readonly chooserUnavailable = computed(() => {
    const field = this.activeField();
    const choosingMove = field !== null && MOVE_FIELDS.includes(field);
    return choosingMove && !this.species() ? `${this.pokemon()?.species} isn't allowed in ${this.dex.format.name}: choose another species.` : '';
  });

  protected readonly chooserSearchable = computed(() => {
    const field = this.activeField();
    return field !== null && SEARCHABLE_FIELDS.includes(field);
  });

  // Bumped to move focus into the chooser's list after the next render. A counter rather
  // than a flag, so the effect reruns even when the active field hasn't changed (a new slot already
  // starts on the species list).
  private readonly focusRequest = signal(0);
  /** Bumped to focus the shown tab's first field after the next render. */
  private readonly focusTabRequest = signal(0);

  constructor() {
    afterRenderEffect(() => {
      if (this.focusRequest() > 0 && this.activeField()) this.chooser().open();
    });
    afterRenderEffect(() => {
      if (this.focusTabRequest() === 0) return;
      if (untracked(this.tab) === 'stats') this.stats()?.focusFirst();
      else this.focusField('species');
    });
  }

  /**
   * Called when the editor is shown: opens the species list right away for a new Pokémon, and
   * otherwise focuses the Species field (the slot card that had focus is now hidden).
   */
  opened(): void {
    if (!this.pokemon()) this.openChooser('species');
    else this.focusField('species');
  }

  /** B in the list: closes it and returns to its field. */
  protected closeChooser(): void {
    const field = this.activeField();
    this.activeField.set(null);
    if (field) this.focusField(field);
  }

  /** Field buttons carry `data-field`, so focus can return to one when its list closes. */
  private focusField(field: ChooserField): void {
    this.host.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
  }

  protected openChooser(field: ChooserField): void {
    this.tab.set('details');
    this.activeField.set(field);
    this.focusRequest.update((count) => count + 1);
  }

  /**
   * The "none" choice of the open list, on ZL rather than among its rows: "No item" while it holds
   * one, "No move" while the slot has one; nothing to clear otherwise.
   */
  protected readonly chooserClearLabel = computed(() => {
    const field = this.activeField();
    const pokemon = this.pokemon();
    if (field === 'item') return pokemon?.item ? 'No item' : '';
    if (field === null || !MOVE_FIELDS.includes(field)) return '';
    return pokemon?.moves[MOVE_FIELDS.indexOf(field)] ? 'No move' : '';
  });

  /** ZL: picks the open list's "none" choice. Returns whether there was one. */
  pressClear(): boolean {
    if (!this.chooserClearLabel()) return false;
    this.pick('');
    return true;
  }

  /** A move's list is open: its rows show the category icons. */
  protected readonly isMoveField = computed(() => {
    const field = this.activeField();
    return field !== null && MOVE_FIELDS.includes(field);
  });

  protected pick(id: string): void {
    const field = this.activeField();
    if (!field) return;
    if (field === 'species') this.pickSpecies(id);
    else if (field === 'item') this.update({ item: id ? (this.dex.item(id)?.name ?? id) : '' });
    else if (field === 'ability') this.update({ ability: this.abilityOptions().find((name) => toId(name) === id) ?? id });
    else this.pickMove(MOVE_FIELDS.indexOf(field), id);

    // Walks on to the next list, as Showdown's teambuilder does, until the last move. A Mega already
    // has its item, so it skips the item list, and there's nothing to choose from a single ability.
    const skipped = new Set<ChooserField>();
    if (field === 'species' && this.dex.megaById(id)) skipped.add('item');
    if (this.abilityOptions().length <= 1) skipped.add('ability');
    const next = CHOOSER_ORDER.slice(CHOOSER_ORDER.indexOf(field) + 1).find((f) => !skipped.has(f)) ?? null;
    this.activeField.set(next);
    // After the last move the list closes, so focus goes back to that field instead of being lost.
    if (next) this.focusRequest.update((count) => count + 1);
    else this.focusField(field);
  }

  /** A species, or a Mega: its base species with the Mega Stone equipped. */
  private pickSpecies(id: string): void {
    const mega = this.dex.megaById(id);
    const species = this.dex.species(mega?.base ?? id);
    const team = this.team();
    if (!species || !team) return;
    const current = this.pokemon() ?? newPokemon();
    const ability = species.abilities.includes(current.ability) ? current.ability : (species.abilities[0] ?? '');
    const gender = species.gender === 'N' ? '' : species.gender || current.gender;
    // A Mega's stone comes with it; another species' Mega Stone goes.
    const heldStone = this.dex.allMegas.find((m) => m.item === toId(current.item));
    const item = mega ? (this.dex.item(mega.item)?.name ?? mega.item) : heldStone && heldStone.base !== species.id ? '' : current.item;
    // Another species' moves may not be in its learnset: they start over (a Mega of the same one keeps them).
    const moves = species.name === current.species ? current.moves : [];
    this.store.setPokemon(team.id, this.index(), { ...current, species: species.name, ability, gender, item, moves });
  }

  private pickMove(slot: number, id: string): void {
    const moves = [...(this.pokemon()?.moves ?? [])];
    const name = id ? (this.dex.move(id)?.name ?? id) : '';
    if (!name) moves.splice(slot, 1);
    else if (slot < moves.length) moves[slot] = name;
    else moves.push(name);
    this.update({ moves: moves.slice(0, MAX_MOVES) });
  }

  protected update(changes: Partial<PokemonSet>): void {
    const team = this.team();
    const pokemon = this.pokemon();
    if (team && pokemon) this.store.setPokemon(team.id, this.index(), { ...pokemon, ...changes });
  }

  protected updateStatPoints(evs: StatSpread): void {
    this.update({ evs });
  }

  /**
   * L/R: the other tab, with focus on its first field (the tab that had it is now hidden). Stats needs
   * a Pokémon. Returns whether the tab changed.
   */
  switchTab(tab: 'details' | 'stats'): boolean {
    if (this.tab() === tab || (tab === 'stats' && !this.pokemon())) return false;
    this.activeField.set(null);
    this.tab.set(tab);
    this.focusTabRequest.update((count) => count + 1);
    return true;
  }

  /**
   * ZR, or a click. Removing a Pokémon can't be undone, so the first press only asks for
   * confirmation. Returns whether it did anything (there's nothing to remove in a new slot).
   */
  pressRemove(): boolean {
    const team = this.team();
    if (!team || !this.pokemon()) return false;
    if (!this.confirmingRemove()) {
      this.confirmingRemove.set(true);
      return true;
    }
    this.store.removePokemon(team.id, this.index());
    this.closed.emit();
    return true;
  }
}

function newPokemon(): PokemonSet {
  return { name: '', species: '', item: '', ability: '', gender: '', shiny: false, evs: {}, nature: '', moves: [] };
}

/** "Dragon / Ground · BST 600" */
function speciesDetail(species: DexSpecies | DexMega): string {
  const total = STAT_IDS.reduce((sum, stat) => sum + species.baseStats[stat], 0);
  return `${species.types.join(' / ')} · BST ${total}`;
}

/** "Dragon / Ground · BST 700 · Garchompite" */
function megaDetail(mega: DexMega, stoneName: string): string {
  return `${speciesDetail(mega)} · ${stoneName}`;
}

/** "Ground · 100 BP": the category goes before it, as an icon. */
function moveDetail(type: string, basePower: number): string {
  return [type, basePower ? `${basePower} BP` : ''].filter(Boolean).join(' · ');
}

function shorten(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…` : text;
}
