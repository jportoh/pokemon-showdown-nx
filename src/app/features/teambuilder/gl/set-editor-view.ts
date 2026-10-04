import { Signal, computed, inject, signal } from '@angular/core';
import { ChampionsDex, DexMega, DexMove, DexSpecies } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { HOLD_FILL, HoldAction } from '@core/gl/ui/hold-action';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { UiContext, label } from '@core/gl/ui/retro-kit';
import { MAX_MOVES, MAX_TEAM_SIZE, PokemonSet, Team } from '@features/teambuilder/models/team';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { CalcState } from '@features/teambuilder/calc/calc-state';
import { typeRank } from '@shared/data/type-order';
import { toId } from '@shared/utils/to-id';
import { ChooserFilter, ChooserOption, ChooserSpec, ChooserView } from './chooser-view';
import { Gender, HeroView, SPECIES_ID } from './hero-view';
import { InfoPanel } from './info-panel';
import { DetailsField, SetRowsView, cardId } from './set-rows-view';
import { SpriteStage } from './sprite-stage';
import { StatsView } from './stats-view';
import { CalcsView } from './calcs-view';
import { BESIDE_COMPACT_X, EDIT_BODY_BOTTOM, EDIT_BODY_Y, EDIT_RIGHT, LegendEntry, TOP, WHITE, controlsLegend, keyPill, keyPillWidth, shortcutButton, tabStrip, tag, typeRgba } from './tb-draw';

type Tab = 'details' | 'stats' | 'calcs';
/** The tabs in the order L/R go through them. */
const TABS: readonly Tab[] = ['details', 'stats', 'calcs'];
/** Fields picked from a list, in the order the chooser walks through them. */
const CHOOSER_ORDER: readonly DetailsField[] = ['species', 'item', 'ability', 'move0', 'move1', 'move2', 'move3'];
const MOVE_FIELDS: readonly DetailsField[] = ['move0', 'move1', 'move2', 'move3'];
/** The header's middle, under the bar. */
const HEADER_CY = TOP + 26;
/** The team's slots in the page bar. */
const SLOT = 40;
const SLOT_GAP = 6;
const FIELD_NAMES: Record<DetailsField, string> = { species: 'Species', item: 'Item', ability: 'Ability', move0: 'Move 1', move1: 'Move 2', move2: 'Move 3', move3: 'Move 4' };

/**
 * One Pokémon of a team, across the whole page (SetEditor on the canvas): a header (where it is in
 * the team, the tabs on L/R, Remove on ZR held down) over the Pokémon's card and, beside it, the
 * Details (its item, ability and moves, a row each, and the info box) or the Stats; the controls'
 * legend under it all. A list opened from a row (or the card, for the species) takes the rows' place
 * with its detail panel, the card stepping aside to make room. Picking from a list walks on to the
 * next one, as Showdown's teambuilder does, until the last move; a new slot opens on the species.
 */
export class SetEditorView {
  private readonly store = inject(TeamStore);
  private readonly calcState = inject(CalcState);
  private readonly dex = inject(ChampionsDex);
  private readonly chooser: ChooserView;
  private readonly hero: HeroView;
  private readonly rows = new SetRowsView();
  private readonly info = new InfoPanel();
  private readonly stats: StatsView;
  private readonly calcs: CalcsView;

  /** The slot being edited; the team's length for a new Pokémon. */
  readonly index = signal(0);
  private readonly tab = signal<Tab>('details');
  /** The field whose list is open, or null. */
  private readonly field = signal<DetailsField | null>(null);
  /** Remove, filling while ZR is held. */
  private readonly remove = new HoldAction(inject(KeyboardNavigation), 'buttonZR');

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
  /** The types it battles with, for the moves' same-type bonus. */
  private readonly formTypes = computed(() => (this.mega() ?? this.species())?.types ?? []);

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
  // listed as species too: picking one picks its base species holding the Mega Stone. A search finds
  // them by their abilities and the moves they learn too ("fake out", "intimidate").
  private readonly speciesOptions: readonly ChooserOption[] = [
    ...this.dex.allSpecies.map((species) => ({ id: species.id, name: species.name, types: species.types, keywords: speciesKeywords(species.abilities, species.moves) })),
    ...this.dex.allMegas.map((mega) => ({ id: mega.id, name: mega.name, types: mega.types, keywords: speciesKeywords([mega.ability], this.dex.species(mega.base)?.moves ?? []) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  private readonly megaStoneIds = new Set(this.dex.allMegas.map((mega) => mega.item));
  private readonly itemOptions: readonly ChooserOption[] = this.dex.allItems.map((item) => ({
    id: item.id,
    name: item.name,
    icon: item.id,
    value: this.megaStoneIds.has(item.id) ? 'Mega Stone' : item.id.endsWith('berry') ? 'Berry' : '',
  }));
  private readonly popularItemIds = new Set(this.dex.popularItems.map((item) => item.id));

  /** The species by type, in the games' order. */
  private readonly speciesFilters: readonly ChooserFilter[] = [
    { name: 'All', test: () => true },
    ...[...new Set(this.dex.allSpecies.flatMap((species) => species.types))]
      .sort((a, b) => typeRank(a) - typeRank(b))
      .map((type) => ({ name: type, test: (option: ChooserOption) => !!option.types?.includes(type) })),
  ];

  /** Until something is typed, the item list shows Showdown's popular items (and the one it holds). */
  private readonly itemFilters = computed((): readonly ChooserFilter[] => {
    const held = toId(this.pokemon()?.item ?? '');
    return [
      { name: 'Popular', test: (option) => option.id === held || this.popularItemIds.has(option.id), searchesAll: true },
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
      .map((move) => ({ id: move.id, name: move.name, type: move.type, category: move.category, value: move.basePower ? String(move.basePower) : '—' }));
  });

  /** What the chooser shows for the field pressed. */
  private readonly spec = computed((): ChooserSpec | null => {
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
    private readonly focus: CanvasFocus,
    private readonly team: Signal<Team | undefined>,
    private readonly closed: () => void,
    stage: SpriteStage,
  ) {
    this.hero = new HeroView(stage);
    this.chooser = new ChooserView(focus);
    this.stats = new StatsView(focus);
    this.calcs = new CalcsView(focus);
  }

  /** Opens a slot: a new Pokémon starts on the species list, one already there on its card. */
  open(index: number): void {
    this.index.set(index);
    this.tab.set('details');
    this.remove.reset();
    this.stats.reset();
    this.field.set(null);
    if (!this.pokemon()) this.openChooser('species');
    else this.focus.focus(SPECIES_ID);
    this.hero.restart(this.field() !== null);
  }

  /** B: closes the list, the natures, the rival list or the field, else goes back to the team. */
  back(): void {
    if (this.tab() === 'stats' && this.stats.isOpen) {
      this.stats.back();
      return;
    }
    if (this.tab() === 'calcs' && this.calcs.back()) return;
    const field = this.field();
    if (field) {
      // A new slot has nothing to go back to but the team.
      if (!this.pokemon()) return this.closed();
      this.field.set(null);
      this.focus.focus(cardId(field));
      return;
    }
    this.closed();
  }

  /** L/R: the open list's filters, else the tabs (round and round: Details, Stats, Calcs). */
  pressLR(by: 1 | -1): boolean {
    const spec = this.spec();
    if (spec) {
      this.chooser.stepFilter(spec, by);
      return true;
    }
    if (this.tab() === 'calcs' && this.calcs.isOpen) {
      this.calcs.pressLR(by);
      return true;
    }
    if (!this.pokemon()) return false;
    const index = TABS.indexOf(this.tab());
    return this.switchTab(TABS[(index + by + TABS.length) % TABS.length]);
  }

  /**
   * ZL: the open list's "none" choice (No item, No move), when it has one; on Stats, undoes the
   * points; on Calcs, the field (reset while it's open).
   */
  pressClear(): boolean {
    const team = this.team();
    if (this.tab() === 'calcs' && this.pokemon() && team) return this.calcs.pressField(team.format);
    if (this.tab() === 'stats' && this.pokemon() && !this.stats.isOpen) return this.stats.undo();
    if (!this.clearLabel()) return false;
    this.pick('');
    return true;
  }

  /**
   * ZR: starts filling Remove in red; held to the end, it removes the Pokémon and goes back to the
   * team (nothing in a new slot). Holding it is the confirmation, so nothing asks again.
   */
  pressRemove(): boolean {
    if (this.tab() === 'calcs') return this.calcs.swap();
    if (!this.canRemove()) return false;
    this.remove.press();
    return true;
  }

  private canRemove(): boolean {
    return !!this.team() && !!this.pokemon() && this.tab() !== 'calcs' && !this.stats.isOpen && !this.field();
  }

  /** Steps Remove's hold; true once it filled up and the Pokémon is removed. */
  private stepRemove(now: number): boolean {
    if (!this.remove.step(now, this.canRemove())) return false;
    const team = this.team();
    if (team) this.store.removePokemon(team.id, this.index());
    this.closed();
    return true;
  }

  /** Home/End: the open list's ends, or the focused stat's none/max. */
  jump(to: 'first' | 'last'): boolean {
    if (this.tab() === 'stats') return this.stats.jump(to);
    if (this.tab() === 'calcs') return this.calcs.jump(to);
    const spec = this.spec();
    if (!spec || !this.chooser.hasFocus()) return false;
    this.chooser.jump(spec, to);
    return true;
  }

  draw(ctx: UiContext): void {
    if (this.stepRemove(ctx.now)) return;
    const pokemon = this.pokemon();
    const tab = this.tab();
    const spec = this.spec();
    const field = this.field();
    const stats = tab === 'stats' && !!pokemon;
    const calcs = tab === 'calcs' && !!pokemon;
    this.drawHeader(ctx, spec);
    this.hero.draw(ctx, {
      set: pokemon,
      species: this.species(),
      mega: this.mega(),
      compact: !!spec || stats || calcs,
      choosingSpecies: field === 'species',
      replacingMove: field ? MOVE_FIELDS.indexOf(field) : -1,
      openSpecies: () => this.openChooser('species'),
      gender: (gender: Gender) => this.update({ gender }),
      nickname: (name) => this.update({ name }),
    });

    if (stats) {
      this.stats.draw(ctx, { x: BESIDE_COMPACT_X, y: EDIT_BODY_Y, w: EDIT_RIGHT - BESIDE_COMPACT_X, h: EDIT_BODY_BOTTOM - EDIT_BODY_Y }, {
        set: pokemon,
        baseStats: (this.mega() ?? this.species())?.baseStats,
        note: this.megaSummary(),
        points: (evs) => this.update({ evs }),
        nature: (nature) => this.update({ nature }),
      });
    } else if (calcs) {
      this.calcs.draw(ctx, { set: pokemon, format: this.team()?.format ?? '' });
    } else if (spec) {
      this.chooser.draw(ctx, spec, (id) => this.pick(id));
    } else {
      this.rows.draw(ctx, { set: pokemon, species: this.species(), mega: this.mega(), open: (f) => this.openChooser(f) });
    }
    controlsLegend(ctx, calcs ? this.calcsLegend() : this.legend(spec, stats));
  }

  /** Where the editor is, for the page bar: the team, the Pokémon, the list open. */
  crumbs(): string[] {
    const pokemon = this.pokemon();
    const form = this.mega() ?? this.species();
    const crumbs = [this.team()?.name ?? '', pokemon?.name || form?.name || pokemon?.species || 'New Pokémon'];
    const spec = this.spec();
    if (spec) crumbs.push(spec.title);
    else if (this.tab() === 'calcs' && this.calcs.isPicking) crumbs.push('Rival');
    return crumbs;
  }

  /** The team's six slots for the page bar, their sprites small, the one edited lit; ends at `right`. */
  drawSlots(ctx: UiContext, right: number, cy: number): number {
    const p = ctx.palette;
    const sets = this.team()?.sets ?? [];
    const left = right - MAX_TEAM_SIZE * (SLOT + SLOT_GAP) + SLOT_GAP;
    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const box = { x: left + i * (SLOT + SLOT_GAP), y: cy - SLOT / 2, w: SLOT, h: SLOT };
      const set = sets[i];
      const edited = i === this.index();
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: edited ? p.select : set ? p.button : [0, 0, 0, 0], stroke: edited ? p.accentText : p.rim, radius: 6, border: 2 });
      const form = set ? (this.dex.mega(set.species, set.item) ?? this.dex.species(set.species)) : undefined;
      const sprite = form ? ctx.images.sprite(form.sprite, false, ImagePriority.Screen) : null;
      if (sprite) ctx.renderer.rect(box.x + 2, box.y + 2, SLOT - 4, SLOT - 4, { fill: WHITE, texture: sprite });
    }
    return left;
  }

  /**
   * The header: the tabs as folder tabs (L/R), and on the right Remove (ZR), or, while a list is
   * open, what picking from it replaces (L/R are the list's filters then).
   */
  private drawHeader(ctx: UiContext, spec: ChooserSpec | null): void {
    const p = ctx.palette;
    const pokemon = this.pokemon();
    const tab = this.tab();
    tabStrip(
      ctx,
      [
        { id: 'editor-details', text: 'Details', on: tab === 'details', accept: () => this.switchTab('details') },
        { id: 'editor-stats', text: 'Stats', on: tab === 'stats', disabled: !pokemon, accept: () => this.switchTab('stats') },
        { id: 'editor-calcs', text: 'Calcs', on: tab === 'calcs', disabled: !pokemon, accept: () => this.switchTab('calcs') },
      ],
      !spec && !!pokemon && !(tab === 'calcs' && this.calcs.isOpen),
    );
    if (tab === 'calcs' && pokemon) {
      this.drawCalcsHeader(ctx);
      return;
    }

    if (spec) {
      const current = this.currentValue();
      if (!current) return;
      const fill = this.field()?.startsWith('move') ? this.dex.move(current) : undefined;
      const style = { size: 18, bold: true };
      const width = ctx.text.measure(current, style) + 28;
      const right = EDIT_RIGHT - width;
      if (fill) tag(ctx, current, right, HEADER_CY - 15, typeRgba(fill.type) ?? p.rim);
      else label(ctx, current, EDIT_RIGHT, HEADER_CY, { size: 20, bold: true }, p.ink, { align: 'right' });
      label(ctx, 'Replacing', right - 10, HEADER_CY, { size: 18 }, p.muted, { align: 'right' });
      return;
    }
    if (pokemon) {
      const removeW = 150;
      shortcutButton(ctx, 'editor-remove', { x: EDIT_RIGHT - removeW, y: TOP + 7, w: removeW, h: 38 }, 'ZR', 'Remove', {
        size: 18,
        accept: () => this.pressRemove(),
        held: { progress: this.remove.progress, color: HOLD_FILL },
      });
    }
  }

  /** What the buttons do now, for the legend. */
  private legend(spec: ChooserSpec | null, stats: boolean): LegendEntry[] {
    const remove = { keys: ['ZR'], text: 'Hold to remove' };
    if (spec) {
      const current = this.currentValue();
      const entries: LegendEntry[] = [
        { keys: ['A'], text: 'Pick' },
        { keys: ['B'], text: !this.pokemon() ? 'Back to team' : current ? `Keep ${current}` : 'Close' },
      ];
      if (spec.filters.length > 1) entries.push({ keys: ['L', 'R'], text: 'Filter' });
      const clear = this.clearLabel();
      if (clear) entries.push({ keys: ['ZL'], text: clear });
      return entries;
    }
    if (stats) {
      if (this.stats.isOpen) {
        const focused = this.stats.focusedNature;
        return [{ keys: ['A'], text: focused ? `Pick ${focused}` : 'Pick' }, { keys: ['B'], text: `Keep ${this.stats.currentNature}` }];
      }
      const action = this.stats.rowAction;
      const entries: LegendEntry[] = action ? [{ keys: ['◀▶'], text: 'Points' }, { keys: ['A'], text: action }] : [{ keys: ['A'], text: 'Choose' }];
      if (this.stats.canUndo) entries.push({ keys: ['ZL'], text: 'Undo' });
      entries.push({ keys: ['L', 'R'], text: 'Details / Stats' }, { keys: ['B'], text: 'Back to team' }, remove);
      return entries;
    }
    const focused = this.focus.focused;
    const action = { keys: ['A'], text: focused === 'hero-nickname' ? 'Type' : 'Change' };
    const entries: LegendEntry[] = [action, { keys: ['B'], text: 'Back to team' }];
    if (this.pokemon()) entries.push({ keys: ['L', 'R'], text: 'Details / Stats' }, remove);
    return entries;
  }

  /** On Calcs, the header's right: who attacks (ZR swaps) as two segments, and the field (ZL) summed up. */
  private drawCalcsHeader(ctx: UiContext): void {
    const p = ctx.palette;
    const cy = HEADER_CY;
    const attack = this.calcState.mode() === 'attack';
    const style = { size: 16, bold: true };
    // From the right: the field's summary, "Field", ZL; then the two segments and ZR.
    const summary = this.calcs.fieldSummary(this.team()?.format ?? '');
    const summaryW = Math.min(300, ctx.text.measure(summary, { size: 16 }));
    let x = EDIT_RIGHT - summaryW;
    label(ctx, summary, x, cy, { size: 16 }, p.muted, { maxWidth: summaryW });
    x -= 8 + label(ctx, 'Field', x - 8, cy, style, p.ink, { align: 'right' });
    x -= 8 + keyPillWidth(ctx, 'ZL');
    keyPill(ctx, 'ZL', x, cy);
    x -= 24;
    const segments = ['You attack', 'They attack'];
    const widths = segments.map((text) => ctx.text.measure(text, style) + 24);
    const left = x - widths[0] - widths[1];
    ctx.renderer.rect(left - 2, cy - 16, widths[0] + widths[1] + 4, 32, { fill: p.bg, stroke: p.outline, radius: 6, border: 2 });
    let sx = left;
    segments.forEach((text, i) => {
      const on = (i === 0) === attack;
      if (on) ctx.renderer.rect(sx, cy - 14, widths[i], 28, { fill: i === 0 ? p.accent : p.danger, radius: 4 });
      label(ctx, text, sx + widths[i] / 2, cy, style, on ? (i === 0 ? WHITE : p.bar) : p.muted, { align: 'center' });
      sx += widths[i];
    });
    keyPill(ctx, 'ZR', left - 10 - keyPillWidth(ctx, 'ZR'), cy);
  }

  /** What the buttons do on Calcs. */
  private calcsLegend(): LegendEntry[] {
    if (this.calcs.fieldOpen) {
      return [{ keys: ['L', 'R'], text: 'Change' }, { keys: ['A'], text: 'Next' }, { keys: ['ZL'], text: 'Reset' }, { keys: ['B'], text: 'Done' }];
    }
    if (this.calcs.isPicking) {
      return [{ keys: ['A'], text: 'Pick' }, { keys: ['B'], text: 'Keep the rival' }, { keys: ['L', 'R'], text: 'Filter' }];
    }
    const entries: LegendEntry[] = [];
    if (this.calcs.onRival) entries.push({ keys: ['A'], text: 'Change rival' }, { keys: ['◀▶'], text: 'Its sets' });
    entries.push(
      { keys: ['ZR'], text: this.calcState.mode() === 'attack' ? 'They attack' : 'You attack' },
      { keys: ['ZL'], text: 'Field' },
      { keys: ['L', 'R'], text: 'Tabs' },
      { keys: ['B'], text: 'Back to team' },
    );
    return entries;
  }

  /** The open list's field as it is now ("Earthquake", "Choice Scarf"); '' when empty. */
  private currentValue(): string {
    const field = this.field();
    const pokemon = this.pokemon();
    if (!field || !pokemon) return '';
    if (field === 'species') return (this.mega() ?? this.species())?.name ?? pokemon.species;
    if (field === 'item') return pokemon.item;
    if (field === 'ability') return pokemon.ability;
    return pokemon.moves[MOVE_FIELDS.indexOf(field)] ?? '';
  }

  /** "No item", "No move": what ZL picks in the open list, '' when there's nothing to take away. */
  private clearLabel(): string {
    const field = this.field();
    if (this.tab() !== 'details' || !field || !this.currentValue()) return '';
    return field === 'item' ? 'No item' : field.startsWith('move') ? 'No move' : '';
  }

  private openChooser(field: DetailsField): void {
    this.tab.set('details');
    this.field.set(field);
    const spec = this.spec();
    if (spec) this.chooser.open(spec);
  }

  /** The other tab, with the focus on its first control (Stats needs a Pokémon). */
  private switchTab(tab: Tab): boolean {
    if (this.tab() === tab || (tab !== 'details' && !this.pokemon())) return false;
    this.field.set(null);
    this.tab.set(tab);
    if (tab === 'stats') this.stats.focusFirst();
    else if (tab === 'calcs') this.calcs.focusFirst();
    else this.focus.focus(SPECIES_ID);
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

/** What a species search also looks through: its abilities' and moves' IDs. */
function speciesKeywords(abilities: readonly string[], moves: readonly DexMove[]): readonly string[] {
  return [...abilities.map(toId), ...moves.map((move) => move.id)];
}
