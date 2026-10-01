import { Signal, computed, inject, signal } from '@angular/core';
import { ChampionsDex, DexMega, DexSpecies } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { UiContext, button, label } from '@core/gl/ui/retro-kit';
import { STAT_IDS } from '@features/teambuilder/data/game-rules';
import { MAX_MOVES, PokemonSet, Team } from '@features/teambuilder/models/team';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { typeRank } from '@shared/data/type-order';
import { toId } from '@shared/utils/to-id';
import { CHOOSER_H, CHOOSER_W, ChooserOption, ChooserSpec, ChooserView } from './chooser-view';
import { DetailsField, DetailsView, cardId } from './details-view';
import { StatsView } from './stats-view';
import { LEFT, PANEL_X, TOP, arrow, shortcutButton } from './tb-draw';

type Tab = 'details' | 'stats';
/** Fields picked from a list, in the order the chooser walks through them. */
const CHOOSER_ORDER: readonly DetailsField[] = ['species', 'item', 'ability', 'move0', 'move1', 'move2', 'move3'];
const MOVE_FIELDS: readonly DetailsField[] = ['move0', 'move1', 'move2', 'move3'];
/** The cards' and the chooser's top, under the header. */
const BODY_Y = TOP + 72;
const CARDS_X = PANEL_X + 24;
const CHOOSER_X = PANEL_X + 476;
export const EDITOR_TEAM_ID = 'editor-team';

/**
 * One Pokémon of a team, in the panel (SetEditor on the canvas): a header (back to the team, the
 * slot, the tabs on L/R, Remove on ZR pressed twice) over the Details tab (the set's cards, with the
 * list of the card pressed beside them) or the Stats tab. Picking from a list walks on to the next
 * one, as Showdown's teambuilder does, until the last move; a new slot opens on the species.
 */
export class SetEditorView {
  private readonly store = inject(TeamStore);
  private readonly dex = inject(ChampionsDex);
  private readonly chooser: ChooserView;
  private readonly details = new DetailsView();
  private readonly stats: StatsView;

  /** The slot being edited; the team's length for a new Pokémon. */
  readonly index = signal(0);
  private readonly tab = signal<Tab>('details');
  /** The card whose list is open, or null. */
  private readonly field = signal<DetailsField | null>(null);
  private confirmingRemove = false;

  private readonly pokemon = computed(() => this.team()?.sets[this.index()]);
  private readonly species = computed((): DexSpecies | undefined => {
    const pokemon = this.pokemon();
    return pokemon ? this.dex.species(pokemon.species) : undefined;
  });
  /** What the Pokémon Mega Evolves into, when it holds its Mega Stone. */
  private readonly mega = computed((): DexMega | undefined => {
    const pokemon = this.pokemon();
    return pokemon ? this.dex.mega(pokemon.species, pokemon.item) : undefined;
  });

  private readonly title = computed(() => `Slot ${this.index() + 1} · ${this.mega()?.name ?? this.species()?.name ?? (this.pokemon()?.species || 'New Pokémon')}`);
  /** "Mega Evolves into Garchomp-Mega · Dragon / Ground · Sand Force" */
  private readonly megaSummary = computed(() => {
    const mega = this.mega();
    return mega ? `Mega Evolves into ${mega.name} · ${mega.types.join(' / ')} · ${mega.ability}` : '';
  });

  private readonly abilityOptions = computed(() => {
    const abilities = this.species()?.abilities ?? [];
    const current = this.pokemon()?.ability;
    return current && !abilities.includes(current) ? [current, ...abilities] : abilities;
  });

  // The species and item lists, built once: the data only has what the format allows. Megas are
  // listed as species too: picking one picks its base species holding the Mega Stone.
  private readonly speciesOptions: readonly ChooserOption[] = [
    ...this.dex.allSpecies.map((species) => ({ id: species.id, name: species.name, detail: speciesDetail(species) })),
    ...this.dex.allMegas.map((mega) => ({ id: mega.id, name: mega.name, detail: `${speciesDetail(mega)} · ${this.dex.item(mega.item)?.name ?? mega.item}` })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  private readonly itemOptions: readonly ChooserOption[] = this.dex.allItems.map((item) => ({ id: item.id, name: item.name, detail: item.desc, icon: item.id }));
  private readonly popularItemIds = new Set(this.dex.popularItems.map((item) => item.id));

  /** Until something is typed, the item list shows Showdown's popular items (and the one it holds). */
  private readonly suggestedItems = computed(() => {
    const held = toId(this.pokemon()?.item ?? '');
    return this.itemOptions.filter((option) => option.id === held || this.popularItemIds.has(option.id));
  });

  /** The species' moves by type, in the games' order, then by name. */
  private readonly sortedMoves = computed(() => [...(this.species()?.moves ?? [])].sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name)));

  private readonly abilityList = computed(() => this.abilityOptions().map((name) => ({ id: toId(name), name, detail: this.dex.ability(name)?.desc ?? '' })));

  /** A move's list: the learnset, without the moves already in another slot. */
  private readonly moveList = computed((): readonly ChooserOption[] => {
    const field = this.field();
    const slot = field ? MOVE_FIELDS.indexOf(field) : -1;
    if (slot < 0) return [];
    const taken = new Set((this.pokemon()?.moves ?? []).filter((_, i) => i !== slot).map(toId));
    return this.sortedMoves()
      .filter((move) => !taken.has(move.id))
      .map((move) => ({ id: move.id, name: move.name, detail: [move.type, move.basePower ? `${move.basePower} BP` : ''].filter(Boolean).join(' · '), type: move.type, category: move.category }));
  });

  /** What the chooser shows for the card pressed. */
  private readonly spec = computed((): ChooserSpec | null => {
    const field = this.field();
    if (!field) return null;
    const pokemon = this.pokemon();
    const base = { suggested: null, suggestedLabel: '', unavailable: '', clearLabel: '' };
    if (field === 'species') {
      return { ...base, title: 'Choose a species', options: this.speciesOptions, selectedId: this.mega()?.id ?? this.species()?.id ?? '', rows: 'text', searchable: true };
    }
    if (field === 'item') {
      return {
        ...base,
        title: 'Choose an item',
        options: this.itemOptions,
        selectedId: toId(pokemon?.item ?? ''),
        rows: 'item',
        searchable: true,
        suggested: this.suggestedItems(),
        suggestedLabel: 'Popular items',
        clearLabel: pokemon?.item ? 'No item' : '',
      };
    }
    if (field === 'ability') {
      return { ...base, title: 'Choose an ability', options: this.abilityList(), selectedId: toId(pokemon?.ability ?? ''), rows: 'long', searchable: false };
    }
    const slot = MOVE_FIELDS.indexOf(field);
    return {
      ...base,
      title: `Choose move ${slot + 1}`,
      options: this.moveList(),
      selectedId: toId(pokemon?.moves[slot] ?? ''),
      rows: 'move',
      searchable: true,
      // Moves come from the species' learnset, so a species the format doesn't allow has none.
      unavailable: this.species() ? '' : `${pokemon?.species} isn't allowed in ${this.dex.format.name}: choose another species.`,
      clearLabel: pokemon?.moves[slot] ? 'No move' : '',
    };
  });

  constructor(
    private readonly focus: CanvasFocus,
    private readonly team: Signal<Team | undefined>,
    private readonly closed: () => void,
  ) {
    this.chooser = new ChooserView(focus);
    this.stats = new StatsView(focus);
  }

  /** Opens a slot: a new Pokémon starts on the species list, one already there on its Species card. */
  open(index: number): void {
    this.index.set(index);
    this.tab.set('details');
    this.confirmingRemove = false;
    this.stats.reset();
    this.field.set(null);
    if (!this.pokemon()) this.openChooser('species');
    else this.focus.focus(cardId('species'));
  }

  /** B: closes the list, the stat panel or the natures, else goes back to the team. */
  back(): void {
    if (this.tab() === 'stats' && this.stats.isOpen) {
      this.stats.back();
      return;
    }
    const field = this.field();
    if (field) {
      this.field.set(null);
      this.focus.focus(cardId(field));
      return;
    }
    this.closed();
  }

  /** L/R: the stat panel's min/max while it's open, else the tabs. */
  pressLR(by: 1 | -1): boolean {
    if (this.tab() === 'stats' && this.stats.adjusting) return this.stats.pressLR(by);
    return this.switchTab(by < 0 ? 'details' : 'stats');
  }

  /** ZL: the open list's "none" choice (No item, No move), when it has one. */
  pressClear(): boolean {
    if (this.tab() !== 'details' || !this.spec()?.clearLabel) return false;
    this.pick('');
    return true;
  }

  /** ZR: asks first, then removes the Pokémon and goes back to the team (nothing in a new slot). */
  pressRemove(): boolean {
    const team = this.team();
    if (!team || !this.pokemon() || this.stats.adjusting) return false;
    if (!this.confirmingRemove) {
      this.confirmingRemove = true;
      return true;
    }
    this.store.removePokemon(team.id, this.index());
    this.closed();
    return true;
  }

  /** Home/End: the open list's ends, or the stat panel's min/max. */
  jump(to: 'first' | 'last'): boolean {
    if (this.tab() === 'stats') return this.stats.jump(to);
    const spec = this.spec();
    if (!spec || !this.chooser.hasFocus()) return false;
    this.chooser.jump(spec, to);
    return true;
  }

  draw(ctx: UiContext): void {
    const p = ctx.palette;
    const x = PANEL_X;
    const pokemon = this.pokemon();
    // The header: back to the team, the slot, the tabs (L/R), Remove (ZR).
    const back = { x: x + 24, y: TOP + 10, w: 132, h: 36 };
    button(ctx, EDITOR_TEAM_ID, back, '', { size: 16, accept: () => this.closed() });
    arrow(ctx, LEFT, back.x + 36, back.y + 11, 2, p.ink);
    label(ctx, 'Team', back.x + 52, back.y + 18, { size: 16 }, p.ink);
    label(ctx, this.title(), x + 168, TOP + 28, { size: 20, bold: true }, p.ink, { maxWidth: 340 });
    const tab = this.tab();
    this.tabButton(ctx, 'editor-details', { x: x + 520, y: TOP + 10, w: 112, h: 36 }, 'L', 'Details', tab === 'details', false, () => this.switchTab('details'));
    this.tabButton(ctx, 'editor-stats', { x: x + 640, y: TOP + 10, w: 112, h: 36 }, 'R', 'Stats', tab === 'stats', !pokemon, () => this.switchTab('stats'));
    if (pokemon) {
      shortcutButton(ctx, 'editor-remove', { x: x + 764, y: TOP + 10, w: 132, h: 36 }, 'ZR', this.confirmingRemove ? 'Confirm' : 'Remove', {
        primary: this.confirmingRemove,
        accept: () => this.pressRemove(),
      });
    }

    if (tab === 'stats' && pokemon) {
      label(ctx, this.megaSummary(), CHOOSER_X, BODY_Y + 14, { size: 14 }, p.muted, { maxWidth: 420 });
      this.stats.draw(ctx, CARDS_X, BODY_Y, {
        set: pokemon,
        baseStats: (this.mega() ?? this.species())?.baseStats,
        points: (evs) => this.update({ evs }),
        nature: (nature) => this.update({ nature }),
      });
      return;
    }

    this.details.draw(ctx, CARDS_X, BODY_Y, {
      set: pokemon,
      species: this.species(),
      mega: this.mega(),
      activeField: this.field(),
      open: (field) => this.openChooser(field),
      gender: (gender) => this.update({ gender }),
    });
    const box = { x: CHOOSER_X, y: BODY_Y, w: CHOOSER_W, h: CHOOSER_H };
    const spec = this.spec();
    if (spec) {
      this.chooser.draw(ctx, box, spec, (id) => this.pick(id), () => this.pressClear());
      return;
    }
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: p.rim, radius: 8, border: 2 });
    const cx = box.x + box.w / 2;
    label(ctx, 'Press A on a card to pick from a list.', cx, box.y + 212, { size: 18 }, p.muted, { align: 'center' });
    label(ctx, 'For species and items, a few letters', cx, box.y + 252, { size: 16 }, p.muted, { align: 'center' });
    label(ctx, 'in the search box narrow it down.', cx, box.y + 280, { size: 16 }, p.muted, { align: 'center' });
    label(ctx, 'Left/right on the species change its gender.', cx, box.y + 320, { size: 16 }, p.muted, { align: 'center' });
  }

  /** A tab of the header: the controller's button in a pill (clicks only; L/R are the controller's). */
  private tabButton(ctx: UiContext, id: string, box: { x: number; y: number; w: number; h: number }, key: string, text: string, on: boolean, disabled: boolean, accept: () => void): void {
    shortcutButton(ctx, id, box, key, text, { disabled, accept });
    if (on) ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: ctx.palette.accentText, radius: 6, border: 2 });
  }

  private openChooser(field: DetailsField): void {
    this.tab.set('details');
    this.field.set(field);
    const spec = this.spec();
    if (spec) this.chooser.open(spec);
  }

  /** The other tab, with the focus on its first control (Stats needs a Pokémon). */
  private switchTab(tab: Tab): boolean {
    if (this.tab() === tab || (tab === 'stats' && !this.pokemon())) return false;
    this.field.set(null);
    this.tab.set(tab);
    if (tab === 'stats') this.stats.focusFirst();
    else this.focus.focus(cardId('species'));
    return true;
  }

  private pick(id: string): void {
    const field = this.field();
    if (!field) return;
    if (field === 'species') this.pickSpecies(id);
    else if (field === 'item') this.update({ item: id ? (this.dex.item(id)?.name ?? id) : '' });
    else if (field === 'ability') this.update({ ability: this.abilityOptions().find((name) => toId(name) === id) ?? id });
    else this.pickMove(MOVE_FIELDS.indexOf(field), id);

    // Walks on to the next list until the last move. A Mega already has its item, so it skips the
    // item list, and there's nothing to choose from a single ability.
    const skipped = new Set<DetailsField>();
    if (field === 'species' && this.dex.megaById(id)) skipped.add('item');
    if (this.abilityOptions().length <= 1) skipped.add('ability');
    const next = CHOOSER_ORDER.slice(CHOOSER_ORDER.indexOf(field) + 1).find((f) => !skipped.has(f)) ?? null;
    if (next) this.openChooser(next);
    else {
      this.field.set(null);
      this.focus.focus(cardId(field));
    }
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

  private update(changes: Partial<PokemonSet>): void {
    const team = this.team();
    const pokemon = this.pokemon();
    if (team && pokemon) this.store.setPokemon(team.id, this.index(), { ...pokemon, ...changes });
  }
}

function newPokemon(): PokemonSet {
  return { name: '', species: '', item: '', ability: '', gender: '', shiny: false, evs: {}, nature: 'Serious', moves: [] };
}

/** "Dragon / Ground · BST 600" */
function speciesDetail(species: DexSpecies | DexMega): string {
  const total = STAT_IDS.reduce((sum, stat) => sum + species.baseStats[stat], 0);
  return `${species.types.join(' / ')} · BST ${total}`;
}
