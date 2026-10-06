import { inject } from '@angular/core';
import { ChampionsDex } from '@core/dex/champions-dex';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { ImagePriority } from '@core/gl/sprite-bitmaps';
import { CanvasKeyboard } from '@core/gl/ui/canvas-keyboard';
import { Box, ListView, UiContext, focusRing, label, modal, textField } from '@core/gl/ui/retro-kit';
import { RivalSet, RivalSets, spreadText } from '@features/teambuilder/calc/rival-sets';
import { toId } from '@shared/utils/to-id';
import { ChooserOption, filterChips, matching, searchKey, searchWords } from './chooser-view';
import { WHITE, typePills } from './tb-draw';

/** The modal, under the page bar down to the legend, its title strip and its two columns. */
const BOX: Box = { x: 90, y: 86, w: 1100, h: 572 };
const HEAD_H = 56;
const PAD = 16;
const BODY_Y = BOX.y + HEAD_H + 14;
const BODY_BOTTOM = BOX.y + BOX.h - PAD;
const LIST_X = BOX.x + PAD;
const LIST_W = 430;
const SETS_X = LIST_X + LIST_W + 20;
const SETS_W = BOX.x + BOX.w - PAD - SETS_X;
/** The species list under its search box, and the focused species' sets under its name. */
const SPECIES_H = 52;
const SPECIES_GAP = 6;
const SPECIES_ROWS = 7;
const SPECIES_Y = BODY_Y + 52;
const SET_H = 84;
const SET_GAP = 8;
const SET_ROWS = 4;
const SETS_Y = BODY_Y + 112;
const SEARCH_ID = 'rival-search';
const SPECIES_ID = 'rival-sp';
const SET_ID = 'rival-set';
const HINT_NAMES = 4;
const MAX_QUERY_LENGTH = 24;

interface Filter {
  name: string;
  test: (option: ChooserOption) => boolean;
}

/**
 * The rival, chosen in a modal over the Calcs tab: the species on the left (a search box over them,
 * L/R for the common ones, your teams' or all), and on the right the sets of the focused one (the
 * format's common sets, your teams', the generic spreads), each with its nature, item, ability,
 * points and moves. Right (or A) goes from a species to its sets, left back; A on a set picks it.
 */
export class RivalPicker {
  private readonly dex = inject(ChampionsDex);
  private readonly sets = inject(RivalSets);
  private readonly keyboard = inject(CanvasKeyboard);
  private readonly speciesList = new ListView(SPECIES_ID, SPECIES_H, SPECIES_ROWS, SPECIES_GAP, false);
  private readonly setList = new ListView(SET_ID, SET_H, SET_ROWS, SET_GAP);

  private shown = false;
  private query = '';
  private filter = 0;
  /** The species whose sets are on the right: the last one focused in the list. */
  private species = '';
  /** The rival now (▶ lands on its set). */
  private current: RivalSet | null = null;
  private memo: { filter: number; query: string; matches: readonly ChooserOption[] } | null = null;

  private readonly filters: readonly Filter[] = [
    { name: 'Common sets', test: (option) => this.sets.hasCommon(option.name) },
    { name: 'Your teams', test: (option) => this.sets.inTeams(option.name) },
    { name: 'All Pokémon', test: () => true },
  ];

  /**
   * Every species, with how many common sets it has: made the first time the picker opens (made with
   * the teambuilder, it stalled its first frame, test-w2).
   */
  private optionList: readonly ChooserOption[] | null = null;
  private get options(): readonly ChooserOption[] {
    return (this.optionList ??= this.dex.allSpecies
      .map((species) => ({ id: species.id, name: species.name, types: species.types, value: this.setCount(species.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  }

  constructor(private readonly focus: CanvasFocus) {}

  get isOpen(): boolean {
    return this.shown;
  }

  /** What A does now: type in the search box, go to a species' sets, or pick a set. */
  get action(): string {
    const id = this.focus.focused ?? '';
    return id === SEARCH_ID ? 'Search' : id.startsWith(`${SET_ID}-`) ? 'Pick this set' : 'Its sets';
  }

  /** Opens on the rival now: its species focused (under All when the first filter hides it). */
  open(rival: RivalSet | null): void {
    this.shown = true;
    this.query = '';
    this.filter = 0;
    const id = toId(rival?.species ?? '');
    if (id && !this.results().some((option) => option.id === id)) this.filter = this.filters.length - 1;
    this.showSpecies(id);
  }

  close(): void {
    this.shown = false;
  }

  /** L/R: the previous or next filter, on its first species. */
  stepFilter(by: 1 | -1): void {
    this.filter = (this.filter + by + this.filters.length) % this.filters.length;
    this.showSpecies('');
  }

  /** R3: the search box's keyboard, from anywhere in the modal. */
  openSearch(): void {
    this.search(this.focus.focused ?? SEARCH_ID);
  }

  /** Home/End: the first or last species. */
  jump(to: 'first' | 'last'): void {
    this.speciesList.jump(to, this.results().length, this.focus);
  }

  draw(ctx: UiContext, current: RivalSet | null, picked: (set: RivalSet) => void): void {
    const p = ctx.palette;
    modal(ctx, BOX, 0.72);
    // The title strip: what it's for, and the filters.
    ctx.renderer.rect(BOX.x + 3, BOX.y + 3, BOX.w - 6, HEAD_H - 3, { fill: p.select, radius: 6 });
    ctx.renderer.rect(BOX.x + 3, BOX.y + HEAD_H, BOX.w - 6, 3, { fill: p.outline });
    label(ctx, 'Choose the rival', BOX.x + 24, BOX.y + HEAD_H / 2 + 2, { size: 24, bold: true }, p.ink);
    filterChips(
      ctx,
      { x: BOX.x + BOX.w - 560, y: BOX.y + HEAD_H / 2 - 16, w: 540, h: 34 },
      this.filters.map((filter) => filter.name),
      this.filter,
    );

    this.current = current;
    const results = this.results();
    const focusedIndex = this.focusedSpecies();
    const focusedId = focusedIndex !== null ? results[focusedIndex]?.id : undefined;
    if (focusedId && focusedId !== this.species) {
      this.species = focusedId;
      this.setList.start = 0;
    }
    this.drawSpecies(ctx, results, toId(current?.species ?? ''));
    this.drawSets(ctx, current, picked);
  }

  // ---------------------------------------------------------------- the species

  private drawSpecies(ctx: UiContext, results: readonly ChooserOption[], currentId: string): void {
    const p = ctx.palette;
    const field = { x: LIST_X, y: BODY_Y, w: LIST_W, h: 44 };
    textField(ctx, SEARCH_ID, field, this.query, { placeholder: 'Search Pokémon', edit: () => this.search() });
    searchKey(ctx, field, this.speciesList.range(results.length) || 'None');

    if (results.length === 0) {
      label(ctx, 'No matches: fewer letters, or another filter.', LIST_X + 12, SPECIES_Y + 30, { size: 18 }, p.muted, { maxWidth: LIST_W - 24 });
      return;
    }
    this.speciesList.draw(
      ctx,
      LIST_X,
      SPECIES_Y,
      LIST_W,
      results.length,
      (row) => this.drawSpeciesRow(ctx, results[row.index], row.box, row.focused, results[row.index].id === currentId),
      () => this.toSets(),
      (_, direction) => direction === 'right' && this.toSets(),
    );
    const more = this.speciesList.start + SPECIES_ROWS < results.length;
    const footY = SPECIES_Y + SPECIES_ROWS * (SPECIES_H + SPECIES_GAP) + 8;
    if (more || this.speciesList.start > 0) label(ctx, more ? '▼ for more' : '▲ for the first ones', LIST_X + LIST_W / 2, footY, { size: 14 }, p.muted, { align: 'center' });
  }

  private drawSpeciesRow(ctx: UiContext, option: ChooserOption, box: Box, focused: boolean, chosen: boolean): void {
    const p = ctx.palette;
    const shown = option.id === this.species;
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused || shown ? p.select : chosen ? p.button : p.panel, radius: 6 });
    const cy = box.y + box.h / 2;
    const species = this.dex.species(option.id);
    const sprite = species ? ctx.images.sprite(species.sprite, false, ImagePriority.Screen) : null;
    if (sprite) ctx.renderer.rect(box.x + 4, box.y + 2, 48, 48, { fill: WHITE, texture: sprite });
    const valueW = option.value ? label(ctx, option.value, box.x + box.w - 16, cy, { size: 15 }, p.muted, { align: 'right' }) : 0;
    label(ctx, option.name, box.x + 62, cy, { size: 20, bold: true }, p.ink, { maxWidth: box.w - 62 - valueW - 28 });
    // The rival now: a bar at the row's end.
    if (chosen) ctx.renderer.rect(box.x + box.w - 5, box.y + 8, 4, box.h - 16, { fill: p.accentText, radius: 2 });
    if (focused) focusRing(ctx, box, 6);
  }

  /**
   * The search box: the canvas keyboard, which lists the matches as they're typed; OK focuses the
   * first, cancelling goes back to `from` (where R3 was pressed).
   */
  private search(from = SEARCH_ID): void {
    this.keyboard.open({
      label: 'Search Pokémon',
      value: this.query,
      maxLength: MAX_QUERY_LENGTH,
      hint: (text) => {
        const words = searchWords(text);
        if (words.length === 0) return 'Type part of a name';
        const found = matching(this.pool(), words);
        if (found.length === 0) return 'No matches';
        const names = found.slice(0, HINT_NAMES).map((option) => option.name).join(', ');
        return `${found.length} ${found.length === 1 ? 'match' : 'matches'}: ${names}${found.length > HINT_NAMES ? '…' : ''}`;
      },
      done: (value) => {
        if (value === null) {
          this.focus.focus(from);
          return;
        }
        this.query = value;
        this.speciesList.start = 0;
        this.focus.focus(this.results().length > 0 ? `${SPECIES_ID}-0` : SEARCH_ID);
      },
    });
  }

  /** The list from its start, on a species (the first one when it isn't there). */
  private showSpecies(id: string): void {
    const results = this.results();
    if (results.length === 0) {
      this.speciesList.start = 0;
      this.species = '';
      this.focus.focus(SEARCH_ID);
      return;
    }
    const index = Math.max(0, results.findIndex((option) => option.id === id));
    this.speciesList.start = Math.max(0, index - 1);
    this.speciesList.reveal(index, results.length);
    this.species = results[index].id;
    this.focus.focus(`${SPECIES_ID}-${index}`);
  }

  private pool(): readonly ChooserOption[] {
    return this.options.filter(this.filters[this.filter].test);
  }

  private results(): readonly ChooserOption[] {
    if (this.memo?.filter !== this.filter || this.memo.query !== this.query) {
      this.memo = { filter: this.filter, query: this.query, matches: matching(this.pool(), searchWords(this.query)) };
    }
    return this.memo.matches;
  }

  private focusedSpecies(): number | null {
    const id = this.focus.focused ?? '';
    const prefix = `${SPECIES_ID}-`;
    return id.startsWith(prefix) ? Number(id.slice(prefix.length)) : null;
  }

  // ---------------------------------------------------------------- the focused species' sets

  private drawSets(ctx: UiContext, current: RivalSet | null, picked: (set: RivalSet) => void): void {
    const p = ctx.palette;
    const species = this.dex.species(this.species);
    if (!species) return;
    const stage = { x: SETS_X, y: BODY_Y, w: 96, h: 96 };
    ctx.renderer.rect(stage.x, stage.y, stage.w, stage.h, { fill: p.bg, radius: 8 });
    const sprite = ctx.images.sprite(species.sprite, false, ImagePriority.Screen);
    if (sprite) ctx.renderer.rect(stage.x, stage.y, 96, 96, { fill: WHITE, texture: sprite });
    const x = SETS_X + 112;
    label(ctx, species.name, x, BODY_Y + 20, { size: 28, bold: true }, p.ink, { maxWidth: SETS_W - 112 });
    typePills(ctx, species.types, x, BODY_Y + 40, 96, 104, 26, 15);
    label(ctx, this.action === 'Pick this set' ? 'A picks the set · ◀ back to the list' : 'A or ▶: its sets', x, BODY_Y + 86, { size: 15 }, p.muted);

    const sets = this.sets.setsFor(species.name);
    this.setList.draw(
      ctx,
      SETS_X,
      SETS_Y,
      SETS_W,
      sets.length,
      (row) => this.drawSet(ctx, sets[row.index], row.box, row.focused, sets[row.index].id === current?.id && toId(current.species) === species.id),
      (index) => picked(sets[index]),
      (_, direction) => direction === 'left' && this.toSpecies(),
    );
  }

  private drawSet(ctx: UiContext, rival: RivalSet, box: Box, focused: boolean, chosen: boolean): void {
    const p = ctx.palette;
    const { renderer } = ctx;
    renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.panel, stroke: focused ? p.outline : p.rim, radius: 6, border: 2 });
    const x = box.x + 14;
    const right = box.x + box.w - 16;
    const where = rival.source === 'common' ? 'Common set' : rival.source === 'team' ? 'Your team' : 'Generic spread';
    const whereW = label(ctx, where, right, box.y + 20, { size: 14, bold: true }, rival.source === 'common' ? p.accentText : p.muted, { align: 'right' });
    label(ctx, rival.title, x, box.y + 20, { size: 19, bold: true }, p.ink, { maxWidth: right - whereW - 16 - x });

    // "Jolly · [icon] White Herb · Unburden · Atk 32 / Spe 32 / HP 2"
    const set = rival.set;
    const natureW = set.nature ? label(ctx, `${set.nature} · `, x, box.y + 46, { size: 15 }, p.muted) : 0;
    const item = set.item ? this.dex.item(set.item) : undefined;
    if (item) ctx.images.drawItem(item.id, x + natureW, box.y + 37, 18);
    const restX = x + natureW + (item ? 22 : 0);
    const ability = this.dex.mega(set.species, set.item)?.ability ?? set.ability;
    label(ctx, [set.item || 'No item', ability, spreadText(set)].filter(Boolean).join(' · '), restX, box.y + 46, { size: 15 }, p.muted, { maxWidth: right - restX });
    const moves = set.moves.length ? set.moves.join(' · ') : 'No moves: it only takes hits';
    label(ctx, moves, x, box.y + 68, { size: 15 }, set.moves.length ? p.ink : p.muted, { maxWidth: right - x });
    // The rival now: a bar at the card's end.
    if (chosen) renderer.rect(box.x + box.w - 6, box.y + 10, 4, box.h - 20, { fill: p.accentText, radius: 2 });
    if (focused) focusRing(ctx, box, 6);
  }

  /** From a species to its sets: on the rival's set when it's this species, else the first. */
  private toSets(): boolean {
    const species = this.dex.species(this.species);
    if (!species) return false;
    const sets = this.sets.setsFor(species.name);
    if (sets.length === 0) return false;
    // Set IDs are a species' own (every species has "preset-no-points").
    const current = this.current && toId(this.current.species) === species.id ? this.current.id : '';
    const index = Math.max(0, sets.findIndex((set) => set.id === current));
    this.setList.start = 0;
    this.setList.reveal(index, sets.length);
    this.focus.focus(`${SET_ID}-${index}`);
    return true;
  }

  /** From the sets back to their species in the list. */
  private toSpecies(): boolean {
    const results = this.results();
    const index = results.findIndex((option) => option.id === this.species);
    if (index < 0) return false;
    this.speciesList.reveal(index, results.length);
    this.focus.focus(`${SPECIES_ID}-${index}`);
    return true;
  }

  /** "3 sets", for the list's rows. */
  private setCount(species: string): string {
    const count = this.sets.setsFor(species).filter((set) => set.source === 'common').length;
    return count ? `${count} set${count === 1 ? '' : 's'}` : '';
  }
}
