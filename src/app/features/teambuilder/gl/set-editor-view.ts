import { Signal, computed, inject, signal } from '@angular/core';
import { ROLE_KEYS, SLOT_KEYS } from '@core/input/console-keys';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { HOLD_FILL, HoldAction } from '@core/gl/ui/hold-action';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { UiContext, label } from '@core/gl/ui/retro-kit';
import { MAX_TEAM_SIZE, PokemonSet, Team } from '@features/teambuilder/models/team';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { CalcState } from '@features/teambuilder/calc/calc-state';
import { toId } from '@shared/utils/to-id';
import { ChooserSpec, ChooserView } from './chooser-view';
import { Gender, HeroView, SPECIES_ID } from './hero-view';
import { MOVE_FIELDS, SetChoosers } from './set-choosers';
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
  private readonly stats: StatsView;
  private readonly calcs: CalcsView;

  /** The slot being edited; the team's length for a new Pokémon. */
  readonly index = signal(0);
  private readonly tab = signal<Tab>('details');
  /** The field whose list is open, or null. */
  private readonly field = signal<DetailsField | null>(null);
  /** Remove, filling while ZR is held. */
  private readonly remove = new HoldAction(inject(KeyboardNavigation), ROLE_KEYS.removePokemon.button);

  private readonly pokemon = computed(() => this.team()?.sets[this.index()]);
  private readonly choosers = new SetChoosers(this.pokemon, this.field);
  private readonly species = this.choosers.species;
  private readonly mega = this.choosers.mega;
  /** What the chooser shows for the field pressed. */
  private readonly spec = this.choosers.spec;

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
    this.calcs.editor.close();
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

  /**
   * ZL/ZR on the native .nro (SLOT_KEYS): the team's previous or next Pokémon, round and round, on the
   * same tab. Not while a list, the natures, the field or the rival's editing is open.
   */
  pressSlot(by: 1 | -1): boolean {
    const count = this.team()?.sets.length ?? 0;
    if (!this.pokemon() || this.spec() || this.field() || this.stats.isOpen || this.calcs.isOpen) return false;
    if (count < 2) return true;
    this.index.set((this.index() + by + count) % count);
    this.remove.reset();
    this.stats.reset();
    // The focus stays where it was when the new card has it; else on the species.
    if (this.focus.focused && !this.focus.has(this.focus.focused)) this.focus.focus(SPECIES_ID);
    return true;
  }

  /**
   * X on the native .nro (ROLE_KEYS.clear): the open list's "none", Stats' undo, and on Calcs the
   * field's reset or the rival editor's own; false elsewhere on Calcs (X edits the rival there).
   */
  pressOption(): boolean {
    const team = this.team();
    if (this.tab() !== 'calcs') return this.pressClear();
    if (!team || !this.pokemon() || !(this.calcs.fieldOpen || this.calcs.isEditing)) return false;
    return this.calcs.pressField(team.format);
  }

  /** + on the native .nro (ROLE_KEYS.calcsField): Calcs' field, opened. */
  pressFieldOpen(): boolean {
    const team = this.team();
    if (this.tab() !== 'calcs' || !team || !this.pokemon() || this.calcs.isOpen) return false;
    return this.calcs.pressField(team.format);
  }

  /** R3: the open list's (or the rival list's) search, wherever the focus is in it. */
  pressSearch(): boolean {
    const spec = this.spec();
    if (spec) return this.chooser.openSearch(spec);
    return this.tab() === 'calcs' && this.calcs.pressSearch();
  }

  /** Calcs: edit the rival (ROLE_KEYS.editRival). */
  pressEditRival(): boolean {
    return this.tab() === 'calcs' && !this.spec() && this.calcs.pressEditRival();
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
    // The rival edited on Calcs takes the card's place too.
    const rival = calcs && this.calcs.isEditing ? this.calcs.editor : null;
    this.drawHeader(ctx, spec);
    if (rival) {
      this.hero.draw(ctx, {
        set: rival.set(),
        species: rival.species(),
        mega: rival.mega(),
        compact: true,
        choosingSpecies: false,
        replacingMove: rival.replacingMove,
        openSpecies: () => undefined,
        gender: () => undefined,
        nickname: () => undefined,
      });
    } else this.hero.draw(ctx, {
      set: pokemon,
      species: this.species(),
      mega: this.mega(),
      compact: !!spec || stats || calcs,
      choosingSpecies: field === 'species',
      replacingMove: field ? MOVE_FIELDS.indexOf(field) : -1,
      under: calcs && pokemon ? (ctx, box) => this.calcs.drawYours(ctx, box, { set: pokemon, format: this.team()?.format ?? '' }) : undefined,
      openSpecies: () => this.openChooser('species'),
      gender: (gender: Gender) => this.update({ gender }),
      nickname: (name) => this.update({ name }),
    });

    if (stats) {
      this.stats.draw(ctx, { x: BESIDE_COMPACT_X, y: EDIT_BODY_Y, w: EDIT_RIGHT - BESIDE_COMPACT_X, h: EDIT_BODY_BOTTOM - EDIT_BODY_Y }, {
        set: pokemon,
        baseStats: (this.mega() ?? this.species())?.baseStats,
        note: this.choosers.megaSummary(),
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
    else if (this.tab() === 'calcs' && this.calcs.isEditing) {
      crumbs.push('Edit rival');
      if (this.calcs.editor.listTitle) crumbs.push(this.calcs.editor.listTitle);
    }
    return crumbs;
  }

  /**
   * The team's six slots for the page bar, their sprites small, the one edited lit; ends at `right`.
   * A tap (or click) on a Pokémon opens it; on the native .nro, ZL and ZR's chips either side say they
   * go through them.
   */
  drawSlots(ctx: UiContext, right: number, cy: number): number {
    const p = ctx.palette;
    const sets = this.team()?.sets ?? [];
    const keys = SLOT_KEYS && sets.length > 1;
    if (keys) right -= keyPill(ctx, 'ZR', right - keyPillWidth(ctx, 'ZR'), cy) + 8;
    const left = right - MAX_TEAM_SIZE * (SLOT + SLOT_GAP) + SLOT_GAP;
    for (let i = 0; i < MAX_TEAM_SIZE; i++) {
      const box = { x: left + i * (SLOT + SLOT_GAP), y: cy - SLOT / 2, w: SLOT, h: SLOT };
      const set = sets[i];
      if (set) ctx.focus.control({ id: `editor-slot-${i}`, ...box, accept: () => this.openSlot(i), skip: true });
      const edited = i === this.index();
      ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: edited ? p.select : set ? p.button : [0, 0, 0, 0], stroke: edited ? p.accentText : p.rim, radius: 6, border: 2 });
      const form = set ? (this.dex.mega(set.species, set.item) ?? this.dex.species(set.species)) : undefined;
      const sprite = form ? ctx.images.sprite(form.sprite, false, ImagePriority.Screen) : null;
      if (sprite) ctx.renderer.rect(box.x + 2, box.y + 2, SLOT - 4, SLOT - 4, { fill: WHITE, texture: sprite });
    }
    if (!keys) return left;
    const zlW = keyPillWidth(ctx, 'ZL');
    keyPill(ctx, 'ZL', left - 8 - zlW, cy);
    return left - 8 - zlW;
  }

  /** A tap on one of the team's slots: that Pokémon, as ZL/ZR would get there. */
  private openSlot(index: number): void {
    const count = this.team()?.sets.length ?? 0;
    if (index === this.index() || index >= count) return;
    if (!this.pokemon() || this.spec() || this.field() || this.stats.isOpen || this.calcs.isOpen) return;
    this.index.set(index);
    this.remove.reset();
    this.stats.reset();
    if (this.focus.focused && !this.focus.has(this.focus.focused)) this.focus.focus(SPECIES_ID);
  }

  /**
   * The header: the tabs as folder tabs (L/R), and on the right Remove (ZR), or, while a list is
   * open, what picking from it replaces (L/R are the list's filters then).
   */
  private drawHeader(ctx: UiContext, spec: ChooserSpec | null): void {
    const p = ctx.palette;
    const pokemon = this.pokemon();
    const tab = this.tab();
    if (tab === 'calcs' && pokemon && this.calcs.isEditing) {
      this.drawRivalHeader(ctx);
      return;
    }
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
      shortcutButton(ctx, 'editor-remove', { x: EDIT_RIGHT - removeW, y: TOP + 7, w: removeW, h: 38 }, ROLE_KEYS.removePokemon.label, 'Remove', {
        size: 18,
        accept: () => this.pressRemove(),
        held: { progress: this.remove.progress, color: HOLD_FILL },
      });
    }
  }

  /** What the buttons do now, for the legend. */
  private legend(spec: ChooserSpec | null, stats: boolean): LegendEntry[] {
    const remove = { keys: [ROLE_KEYS.removePokemon.label], text: 'Hold to remove' };
    // ZL/ZR through the team's Pokémon (native), when there's more than one.
    const slots: LegendEntry[] = SLOT_KEYS && (this.team()?.sets.length ?? 0) > 1 ? [{ keys: ['ZL', 'ZR'], text: 'Pokémon' }] : [];
    if (spec) {
      const current = this.currentValue();
      const entries: LegendEntry[] = [
        { keys: ['A'], text: 'Pick' },
        { keys: ['B'], text: !this.pokemon() ? 'Back to team' : current ? `Keep ${current}` : 'Close' },
      ];
      if (spec.searchable && !spec.unavailable) entries.push({ keys: [ROLE_KEYS.search.label], text: 'Search' });
      if (spec.filters.length > 1) entries.push({ keys: ['L', 'R'], text: 'Filter' });
      const clear = this.clearLabel();
      if (clear) entries.push({ keys: [ROLE_KEYS.clear.label], text: clear });
      return entries;
    }
    if (stats) {
      if (this.stats.isOpen) {
        const focused = this.stats.focusedNature;
        return [{ keys: ['A'], text: focused ? `Pick ${focused}` : 'Pick' }, { keys: ['B'], text: `Keep ${this.stats.currentNature}` }];
      }
      const action = this.stats.rowAction;
      const entries: LegendEntry[] = action ? [{ keys: ['◀▶'], text: 'Points' }, { keys: ['A'], text: action }] : [{ keys: ['A'], text: 'Choose' }];
      if (this.stats.canUndo) entries.push({ keys: [ROLE_KEYS.clear.label], text: 'Undo' });
      entries.push(...slots, { keys: ['L', 'R'], text: 'Tabs' }, { keys: ['B'], text: 'Back to team' }, remove);
      return entries;
    }
    const focused = this.focus.focused;
    const action = { keys: ['A'], text: focused === 'hero-nickname' ? 'Type' : 'Change' };
    const entries: LegendEntry[] = [action, { keys: ['B'], text: 'Back to team' }];
    if (this.pokemon()) entries.push(...slots, { keys: ['L', 'R'], text: 'Tabs' }, remove);
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
    x -= 8 + keyPillWidth(ctx, ROLE_KEYS.calcsField.label);
    keyPill(ctx, ROLE_KEYS.calcsField.label, x, cy);
    x -= 24;
    const segments = ['You attack', 'They attack'];
    const widths = segments.map((text) => ctx.text.measure(text, style) + 24);
    const left = x - widths[0] - widths[1];
    ctx.renderer.rect(left - 2, cy - 16, widths[0] + widths[1] + 4, 32, { fill: p.bg, stroke: p.outline, radius: 6, border: 2 });
    let sx = left;
    segments.forEach((text, i) => {
      const on = (i === 0) === attack;
      if (on) ctx.renderer.rect(sx, cy - 14, widths[i], 28, { fill: i === 0 ? p.accent : p.danger, radius: 4 });
      label(ctx, text, sx + widths[i] / 2, cy, style, on ? (i === 0 ? WHITE : p.contrast) : p.muted, { align: 'center' });
      sx += widths[i];
    });
    keyPill(ctx, ROLE_KEYS.calcsSwap.label, left - 10 - keyPillWidth(ctx, ROLE_KEYS.calcsSwap.label), cy);
  }

  /**
   * Editing the rival on Calcs: its two pages as the tabs (L/R), and on the right the set edited ("a
   * copy of" it until the first change makes it Custom).
   */
  private drawRivalHeader(ctx: UiContext): void {
    const p = ctx.palette;
    const editor = this.calcs.editor;
    const page = editor.page();
    tabStrip(
      ctx,
      [
        { id: 'rival-edit-set', text: 'Rival set', on: page === 'set', accept: () => editor.switchPage('set') },
        { id: 'rival-edit-stats', text: 'Rival stats', on: page === 'stats', accept: () => editor.switchPage('stats') },
      ],
      !editor.spec(),
    );
    const rival = this.calcState.rival();
    if (!rival) return;
    const style = { size: 18, bold: true };
    const titleW = Math.min(360, ctx.text.measure(rival.title, style));
    label(ctx, rival.title, EDIT_RIGHT, HEADER_CY, style, p.ink, { align: 'right', maxWidth: titleW });
    const note = rival.source === 'custom' ? 'Editing' : 'Editing a copy of';
    label(ctx, note, EDIT_RIGHT - titleW - 10, HEADER_CY, { size: 16 }, p.muted, { align: 'right' });
  }

  /** What the buttons do on Calcs. */
  private calcsLegend(): LegendEntry[] {
    if (this.calcs.isEditing) return this.calcs.editor.legend();
    if (this.calcs.fieldOpen) {
      return [{ keys: ['L', 'R'], text: 'Change' }, { keys: ['A'], text: 'Next' }, { keys: [ROLE_KEYS.clear.label], text: 'Reset' }, { keys: ['B'], text: 'Done' }];
    }
    if (this.calcs.isPicking) {
      return [{ keys: ['A'], text: this.calcs.pickerAction }, { keys: ['B'], text: 'Keep the rival' }, { keys: [ROLE_KEYS.search.label], text: 'Search' }, { keys: ['L', 'R'], text: 'Filter' }];
    }
    const entries: LegendEntry[] = [];
    if (this.calcs.onRival) entries.push({ keys: ['A'], text: 'Change rival' }, { keys: ['◀▶'], text: 'Its sets' });
    entries.push({ keys: [ROLE_KEYS.editRival.label], text: 'Edit rival' });
    entries.push(
      { keys: [ROLE_KEYS.calcsSwap.label], text: this.calcState.mode() === 'attack' ? 'They attack' : 'You attack' },
      { keys: [ROLE_KEYS.calcsField.label], text: 'Field' },
    );
    if (SLOT_KEYS && (this.team()?.sets.length ?? 0) > 1) entries.push({ keys: ['ZL', 'ZR'], text: 'Pokémon' });
    entries.push({ keys: ['L', 'R'], text: 'Tabs' }, { keys: ['B'], text: 'Back to team' });
    return entries;
  }

  /** The open list's field as it is now ("Earthquake", "Choice Scarf"); '' when empty. */
  private currentValue(): string {
    return this.choosers.currentValue();
  }

  /** "No item", "No move": what ZL picks in the open list, '' when there's nothing to take away. */
  private clearLabel(): string {
    return this.tab() === 'details' ? this.choosers.clearLabel() : '';
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
    else this.update(this.choosers.picked(field, id));

    // Walks on to the next list until the last move. A Mega already has its item, so it skips the
    // item list, and there's nothing to choose from a single ability.
    const skipped = new Set<DetailsField>();
    if (field === 'species' && this.dex.megaById(id)) skipped.add('item');
    if (this.choosers.abilityOptions().length <= 1) skipped.add('ability');
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

  private update(changes: Partial<PokemonSet>): void {
    const team = this.team();
    const pokemon = this.pokemon();
    if (team && pokemon) this.store.setPokemon(team.id, this.index(), { ...pokemon, ...changes });
  }
}

function newPokemon(): PokemonSet {
  return { name: '', species: '', item: '', ability: '', gender: '', shiny: false, evs: {}, nature: 'Serious', moves: [] };
}
