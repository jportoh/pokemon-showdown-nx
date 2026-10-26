import { Signal, computed, inject } from '@angular/core';
import { ChampionsDex, DexMega, DexMove, DexSpecies } from '@core/dex/champions-dex';
import { MAX_MOVES, PokemonSet } from '@features/teambuilder/models/team';
import { typeRank } from '@shared/data/type-order';
import { toId } from '@shared/utils/to-id';
import { ChooserFilter, ChooserOption, ChooserSpec } from './chooser-view';
import { InfoPanel } from './info-panel';
import { DetailsField } from './set-rows-view';

export const MOVE_FIELDS: readonly DetailsField[] = ['move0', 'move1', 'move2', 'move3'];

/**
 * The lists a set's fields are picked from (its species, item, ability and moves) for the Pokémon
 * `pokemon` gives, with the field `field` says open: the set editor's, and the Calcs tab's rival when
 * it's edited. Also what it battles as (a Mega with its stone).
 */
export class SetChoosers {
  private readonly dex = inject(ChampionsDex);
  private readonly info = new InfoPanel();

  readonly species = computed((): DexSpecies | undefined => {
    const pokemon = this.pokemon();
    return pokemon ? this.dex.species(pokemon.species) : undefined;
  });
  /** What the Pokémon Mega Evolves into, when it holds its Mega Stone. */
  readonly mega = computed((): DexMega | undefined => {
    const pokemon = this.pokemon();
    return pokemon ? this.dex.mega(pokemon.species, pokemon.item) : undefined;
  });
  /** The types it battles with, for the moves' same-type bonus. */
  readonly formTypes = computed(() => (this.mega() ?? this.species())?.types ?? []);

  /** "Mega Evolves into Garchomp-Mega · Dragon / Ground · Sand Force" */
  readonly megaSummary = computed(() => {
    const mega = this.mega();
    return mega ? `Mega Evolves into ${mega.name} · ${mega.types.join(' / ')} · ${mega.ability}` : '';
  });

  readonly abilityOptions = computed(() => {
    const abilities = this.species()?.abilities ?? [];
    const current = this.pokemon()?.ability;
    return current && !abilities.includes(current) ? [current, ...abilities] : abilities;
  });

  // The species and item lists, made the first time they open: the data only has what the format
  // allows. Megas are listed as species too: picking one picks its base species holding the Mega
  // Stone. A search finds them by their abilities and the moves they learn too ("fake out",
  // "intimidate"), keywords made on the first search: made with the editor, they stalled the
  // teambuilder's first frame (test-w2).
  private speciesList: readonly ChooserOption[] | null = null;
  private get speciesOptions(): readonly ChooserOption[] {
    return (this.speciesList ??= [
      ...this.dex.allSpecies.map((species) => speciesOption(species.id, species.name, species.types, () => speciesKeywords(species.abilities, species.moves))),
      ...this.dex.allMegas.map((mega) => speciesOption(mega.id, mega.name, mega.types, () => speciesKeywords([mega.ability], this.dex.species(mega.base)?.moves ?? []))),
    ].sort((a, b) => a.name.localeCompare(b.name)));
  }
  private itemList: readonly ChooserOption[] | null = null;
  private get itemOptions(): readonly ChooserOption[] {
    if (this.itemList) return this.itemList;
    const megaStoneIds = new Set(this.dex.allMegas.map((mega) => mega.item));
    return (this.itemList = this.dex.allItems.map((item) => ({
      id: item.id,
      name: item.name,
      icon: item.id,
      value: megaStoneIds.has(item.id) ? 'Mega Stone' : item.id.endsWith('berry') ? 'Berry' : '',
    })));
  }
  private readonly popularItemIds = new Set(this.dex.popularItems.map((item) => item.id));

  /** The species by type, in the games' order. */
  private readonly speciesFilters: readonly ChooserFilter[] = [
    { name: 'All', test: () => true },
    ...[...new Set(this.dex.allSpecies.flatMap((species) => species.types))]
      .sort((a, b) => typeRank(a) - typeRank(b))
      .map((type) => ({
        name: type,
        test: (option: ChooserOption) => !!option.types?.includes(type),
      })),
  ];

  /** Until something is typed, the item list shows Showdown's popular items (and the one it holds). */
  private readonly itemFilters = computed((): readonly ChooserFilter[] => {
    const held = toId(this.pokemon()?.item ?? '');
    return [
      {
        name: 'Popular',
        test: (option) => option.id === held || this.popularItemIds.has(option.id),
        searchesAll: true,
      },
      { name: 'All', test: () => true },
      { name: 'Berries', test: (option) => option.value === 'Berry' },
      { name: 'Mega Stones', test: (option) => option.value === 'Mega Stone' },
    ];
  });

  private readonly moveFilters = computed((): readonly ChooserFilter[] => {
    const types = this.formTypes();
    return [
      { name: 'All', test: () => true },
      { name: 'Physical', test: (option) => option.category === 'Physical' },
      { name: 'Special', test: (option) => option.category === 'Special' },
      { name: 'Status', test: (option) => option.category === 'Status' },
      { name: 'Same type', test: (option) => !!option.type && types.includes(option.type) },
    ];
  });

  /** The species' moves by type, in the games' order, then by name. */
  private readonly sortedMoves = computed(() => [...(this.species()?.moves ?? [])].sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name)));

  private readonly abilityList = computed(() => this.abilityOptions().map((name) => ({ id: toId(name), name })));

  /** A move's list: the learnset, without the moves already in another slot. */
  private readonly moveList = computed((): readonly ChooserOption[] => {
    const field = this.field();
    const slot = field ? MOVE_FIELDS.indexOf(field) : -1;
    if (slot < 0) return [];
    const taken = new Set((this.pokemon()?.moves ?? []).filter((_, i) => i !== slot).map(toId));
    return this.sortedMoves()
      .filter((move) => !taken.has(move.id))
      .map((move) => ({
        id: move.id,
        name: move.name,
        type: move.type,
        category: move.category,
        value: move.basePower ? String(move.basePower) : '—',
      }));
  });

  /** What the chooser shows for the field open; null when none is. */
  readonly spec = computed((): ChooserSpec | null => {
    const field = this.field();
    if (!field) return null;
    const pokemon = this.pokemon();
    if (field === 'species') {
      return {
        noun: 'Pokémon',
        title: 'Species',
        options: this.speciesOptions,
        selectedId: this.mega()?.id ?? this.species()?.id ?? '',
        rows: 'species',
        searchable: true,
        filters: this.speciesFilters,
        unavailable: '',
        describe: (ctx, box, id) => {
          const form = this.dex.megaById(id) ?? this.dex.species(id);
          if (form) this.info.species(ctx, box, form, true);
        },
      };
    }
    if (field === 'item') {
      return {
        noun: 'items',
        title: 'Item',
        options: this.itemOptions,
        selectedId: toId(pokemon?.item ?? ''),
        rows: 'item',
        searchable: true,
        filters: this.itemFilters(),
        unavailable: '',
        describe: (ctx, box, id) => {
          const item = this.dex.item(id);
          if (item) this.info.item(ctx, box, item, true);
        },
      };
    }
    if (field === 'ability') {
      return {
        noun: 'abilities',
        title: 'Ability',
        options: this.abilityList(),
        selectedId: toId(pokemon?.ability ?? ''),
        rows: 'ability',
        searchable: false,
        filters: [],
        unavailable: '',
        describe: (ctx, box, id) => {
          const name = this.abilityOptions().find((ability) => toId(ability) === id) ?? id;
          this.info.text(ctx, box, name, this.dex.ability(name)?.desc ?? '', true);
        },
      };
    }
    const slot = MOVE_FIELDS.indexOf(field);
    return {
      noun: 'moves',
      title: `Move ${slot + 1}`,
      options: this.moveList(),
      selectedId: toId(pokemon?.moves[slot] ?? ''),
      rows: 'move',
      searchable: true,
      filters: this.moveFilters(),
      // Moves come from the species' learnset, so a species the format doesn't allow has none.
      unavailable: this.species() ? '' : `${pokemon?.species} isn't allowed in ${this.dex.format.name}: choose another species.`,
      describe: (ctx, box, id) => {
        const move = this.dex.move(id);
        if (move) this.info.move(ctx, box, move, this.formTypes().includes(move.type), true);
      },
    };
  });

  constructor(
    private readonly pokemon: Signal<PokemonSet | undefined>,
    private readonly field: Signal<DetailsField | null>,
  ) {}

  /** The open field as it is now ("Earthquake", "Choice Scarf"); '' when empty. */
  currentValue(): string {
    const field = this.field();
    const pokemon = this.pokemon();
    if (!field || !pokemon) return '';
    if (field === 'species') return (this.mega() ?? this.species())?.name ?? pokemon.species;
    if (field === 'item') return pokemon.item;
    if (field === 'ability') return pokemon.ability;
    return pokemon.moves[MOVE_FIELDS.indexOf(field)] ?? '';
  }

  /** "No item", "No move": what ZL picks in the open list, '' when there's nothing to take away. */
  clearLabel(): string {
    const field = this.field();
    if (!field || !this.currentValue()) return '';
    return field === 'item' ? 'No item' : field.startsWith('move') ? 'No move' : '';
  }

  /** The change picking `id` ('' for none) from the item, ability or a move's list makes. */
  picked(field: Exclude<DetailsField, 'species'>, id: string): Partial<PokemonSet> {
    if (field === 'item') return { item: id ? (this.dex.item(id)?.name ?? id) : '' };
    if (field === 'ability') return { ability: this.abilityOptions().find((name) => toId(name) === id) ?? id };
    const slot = MOVE_FIELDS.indexOf(field);
    const moves = [...(this.pokemon()?.moves ?? [])];
    const name = id ? (this.dex.move(id)?.name ?? id) : '';
    if (!name) moves.splice(slot, 1);
    else if (slot < moves.length) moves[slot] = name;
    else moves.push(name);
    return { moves: moves.slice(0, MAX_MOVES) };
  }
}

/** A species in the list, its search keywords made when first asked for. */
function speciesOption(id: string, name: string, types: readonly string[], keywords: () => readonly string[]): ChooserOption {
  let made: readonly string[] | undefined;
  return {
    id,
    name,
    types,
    get keywords() {
      return (made ??= keywords());
    },
  };
}

/** What a species search also looks through: its abilities' and moves' IDs. */
function speciesKeywords(abilities: readonly string[], moves: readonly DexMove[]): readonly string[] {
  return [...abilities.map(toId), ...moves.map((move) => move.id)];
}
