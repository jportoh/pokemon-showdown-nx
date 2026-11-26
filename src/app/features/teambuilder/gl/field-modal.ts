import { CanvasFocus } from '@core/gl/canvas-ui';
import { Box, UiContext, label, modal } from '@core/gl/ui/retro-kit';
import { menuFocus } from '@core/gl/ui/menu-kit';
import { CalcMode } from '@features/teambuilder/calc/calc-state';
import { CalcField, CalcOutcome, CalcSide, TerrainChoice, WeatherChoice } from '@features/teambuilder/calc/damage-calc';
import { PokemonSet } from '@features/teambuilder/models/team';
import { WrapCache, keyPillButton, keyPillWidth } from './tb-draw';

const WEATHERS: readonly WeatherChoice[] = ['auto', 'none', 'Sun', 'Rain', 'Sand', 'Snow'];
const TERRAINS: readonly TerrainChoice[] = ['auto', 'none', 'Electric', 'Grassy', 'Psychic', 'Misty'];
const HP_STEPS = [100, 90, 80, 75, 70, 60, 50, 40, 33, 30, 25, 20, 10, 5, 1];
const ROW_H = 36;
const ROW_STEP = 41;
const SECTION_H = 26;
const COLUMN_W = 452;
const FIRST_ROW = 'field-doubles';

/** What the modal shows and changes. */
export interface FieldModel {
  field: CalcField;
  mode: CalcMode;
  yours: PokemonSet;
  rival: PokemonSet | null;
  outcome: CalcOutcome | null;
  change: (change: (field: CalcField) => CalcField) => void;
}

/** One line of the modal: its name, its value now, and a step to the value before or after. */
interface FieldRow {
  id: string;
  name: string;
  value: string;
  /** The value as the field starts (Off, ±0, Auto…), drawn muted. */
  plain: boolean;
  step: (by: 1 | -1) => void;
}

/**
 * The field every calc of the tab uses, in a modal (ZL): the battle (Doubles or Singles, the weather
 * and terrain, Trick Room, a critical hit), the target's side (its screens, Friend Guard), the
 * attacker's (Helping Hand, Tailwind), both Pokémon's stat stages (Speed included, for who moves
 * first) and the target's HP. The d-pad goes from row to row; L/R (or A) change the focused one at
 * once. ZL puts it all back as it starts (see CalcsView); B closes it. Under the rows: what Auto set up, a Terrain Seed at work, and the moves
 * that always land a critical hit.
 */
export class FieldModal {
  private shown = false;
  /** The last frame's rows by ID, for L/R. */
  private rows = new Map<string, FieldRow>();
  private readonly wraps = new WrapCache();

  constructor(private readonly focus: CanvasFocus) {}

  get isOpen(): boolean {
    return this.shown;
  }

  open(): void {
    this.shown = true;
    this.focus.focus(FIRST_ROW);
  }

  close(): void {
    this.shown = false;
  }

  /** L/R: the focused row's value before or after. */
  step(by: 1 | -1): void {
    this.rows.get(this.focus.focused ?? '')?.step(by);
  }

  draw(ctx: UiContext, model: FieldModel): void {
    const p = ctx.palette;
    // Under the page bar (drawn over the page), down to the legend.
    const box = { x: 130, y: 86, w: 1020, h: 572 };
    modal(ctx, box, 0.78);
    label(ctx, 'Field', box.x + 28, box.y + 36, { size: 30, bold: true }, p.ink);
    label(ctx, 'Every calc on the tab uses it', box.x + 130, box.y + 38, { size: 17 }, p.muted);

    const attacking = model.mode === 'attack';
    const attackerName = attacking ? model.yours.species : (model.rival?.species ?? 'The rival');
    const targetName = attacking ? (model.rival?.species ?? 'The rival') : model.yours.species;
    const attackerKey = attacking ? 'yours' : 'rival';
    const targetKey = attacking ? 'rival' : 'yours';
    const field = model.field;
    const set = (change: Partial<CalcField>) => model.change((f) => ({ ...f, ...change }));
    const side = (key: 'yours' | 'rival', change: Partial<CalcSide>) => model.change((f) => ({ ...f, [key]: { ...f[key], ...change } }));
    const boost = (key: 'yours' | 'rival', stat: keyof CalcSide['boosts'], by: number) =>
      model.change((f) => ({ ...f, [key]: { ...f[key], boosts: { ...f[key].boosts, [stat]: Math.max(-6, Math.min(6, f[key].boosts[stat] + by)) } } }));
    const toggle = (id: string, name: string, on: boolean, flip: () => void, words: [string, string] = ['Off', 'On']): FieldRow => ({
      id,
      name,
      value: on ? words[1] : words[0],
      plain: !on,
      step: flip,
    });
    const choice = <T>(id: string, name: string, values: readonly T[], current: T, show: (value: T) => string, pick: (value: T) => void): FieldRow => ({
      id,
      name,
      value: show(current),
      plain: current === values[0],
      step: (by) => pick(values[(values.indexOf(current) + by + values.length) % values.length]),
    });
    const stageRow = (id: string, name: string, key: 'yours' | 'rival', stat: keyof CalcSide['boosts']): FieldRow => ({
      id,
      name,
      value: stageText(field[key].boosts[stat]),
      plain: field[key].boosts[stat] === 0,
      step: (by) => boost(key, stat, by),
    });

    const target = field[targetKey];
    const attacker = field[attackerKey];
    const outcome = model.outcome;
    const left: [string, FieldRow[]][] = [
      [
        'BATTLE',
        [
          // Doubles is how the VGC team starts, but either way is a choice: never drawn muted.
          { ...toggle(FIRST_ROW, 'Format', field.doubles, () => set({ doubles: !field.doubles }), ['Singles', 'Doubles']), plain: false },
          choice('field-weather', 'Weather', WEATHERS, field.weather, (w) => autoText(w, outcome?.weather?.value), (weather) => set({ weather })),
          choice('field-terrain', 'Terrain', TERRAINS, field.terrain, (t) => autoText(t, outcome?.terrain?.value), (terrain) => set({ terrain })),
          toggle('field-trickroom', 'Trick Room', field.trickRoom, () => set({ trickRoom: !field.trickRoom })),
          toggle('field-crit', 'Critical hit', field.crit, () => set({ crit: !field.crit })),
        ],
      ],
      [
        `TARGET'S SIDE (${targetName.toUpperCase()})`,
        [
          toggle('field-reflect', 'Reflect', target.reflect, () => side(targetKey, { reflect: !target.reflect })),
          toggle('field-lightscreen', 'Light Screen', target.lightScreen, () => side(targetKey, { lightScreen: !target.lightScreen })),
          toggle('field-auroraveil', 'Aurora Veil', target.auroraVeil, () => side(targetKey, { auroraVeil: !target.auroraVeil })),
          toggle('field-friendguard', 'Friend Guard', target.friendGuard, () => side(targetKey, { friendGuard: !target.friendGuard })),
        ],
      ],
    ];
    const right: [string, FieldRow[]][] = [
      [
        `ATTACKER (${attackerName.toUpperCase()})`,
        [
          toggle('field-helpinghand', 'Helping Hand', attacker.helpingHand, () => side(attackerKey, { helpingHand: !attacker.helpingHand })),
          toggle('field-attackertailwind', 'Tailwind', attacker.tailwind, () => side(attackerKey, { tailwind: !attacker.tailwind })),
          stageRow('field-atk', 'Attack stage', attackerKey, 'atk'),
          stageRow('field-spa', 'Sp. Atk stage', attackerKey, 'spa'),
          stageRow('field-attackerspe', 'Speed stage', attackerKey, 'spe'),
        ],
      ],
      [
        `TARGET (${targetName.toUpperCase()})`,
        [
          toggle('field-targettailwind', 'Tailwind', target.tailwind, () => side(targetKey, { tailwind: !target.tailwind })),
          stageRow('field-def', 'Defense stage', targetKey, 'def'),
          stageRow('field-spd', 'Sp. Def stage', targetKey, 'spd'),
          stageRow('field-targetspe', 'Speed stage', targetKey, 'spe'),
          choice('field-hp', 'HP left', HP_STEPS, nearestHp(target.hp), (hp) => `${hp}%`, (hp) => side(targetKey, { hp })),
        ],
      ],
    ];
    this.rows = new Map([...left, ...right].flatMap(([, rows]) => rows.map((row) => [row.id, row] as const)));
    const top = box.y + 66;
    const leftX = box.x + 28;
    const leftEnd = this.drawColumn(ctx, leftX, top, left);
    this.drawColumn(ctx, box.x + box.w - 28 - COLUMN_W, top, right);

    // What else is at work: Auto's weather and terrain, a Terrain Seed, moves that always crit.
    const notes = [
      ...[outcome?.weather, outcome?.terrain].filter((effect) => effect?.source).map((effect) => `Auto: ${effect?.source} → ${effect?.value}`),
      ...(outcome?.seeds ?? []),
      ...(outcome?.moves ?? []).filter((move) => move.alwaysCrit).map((move) => `${move.move} always lands a critical hit`),
    ];
    const text = notes.length ? notes.join(' · ') : 'Auto: the weather or terrain an ability sets up (Drizzle, Grassy Surge…). None here.';
    this.wraps.draw(ctx, text, leftX + 4, leftEnd + 4, COLUMN_W - 4, 22, { size: 15 }, p.muted, Math.floor((box.y + box.h - 14 - leftEnd) / 22));
  }

  /** A column's sections from `top`; returns where it ends. */
  private drawColumn(ctx: UiContext, x: number, top: number, sections: [string, FieldRow[]][]): number {
    const p = ctx.palette;
    let y = top;
    for (const [title, rows] of sections) {
      label(ctx, title, x + 4, y + 13, { size: 15, bold: true }, p.muted, { maxWidth: COLUMN_W });
      y += SECTION_H;
      for (const row of rows) {
        this.drawRow(ctx, { x, y, w: COLUMN_W, h: ROW_H }, row);
        y += ROW_STEP;
      }
      y += 8;
    }
    return y;
  }

  /** A row: its name, and its value between L and R while it has the focus. */
  private drawRow(ctx: UiContext, box: Box, row: FieldRow): void {
    const p = ctx.palette;
    const focused = ctx.focus.control({ id: row.id, ...box, accept: () => row.step(1) });
    ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.bg, stroke: focused ? p.outline : p.rim, radius: 8, border: 2 });
    const cy = box.y + box.h / 2;
    label(ctx, row.name, box.x + 16, cy, { size: 19, bold: true }, p.ink, { maxWidth: 200 });
    const valueX = box.x + 226;
    const valueW = box.w - 226 - 10;
    if (focused) {
      keyPillButton(ctx, 'field-l', 'L', valueX, cy);
      keyPillButton(ctx, 'field-r', 'R', valueX + valueW - keyPillWidth(ctx, 'R'), cy);
    }
    label(ctx, row.value, valueX + valueW / 2, cy, { size: 19, bold: !row.plain }, row.plain ? p.muted : p.accentText, { align: 'center', maxWidth: valueW - 84 });
    if (focused) menuFocus(ctx, box, 8);
  }
}

/** "Auto (Rain)", "None", "Sun" */
function autoText(choice: string, current: string | undefined): string {
  if (choice === 'auto') return current ? `Auto (${current})` : 'Auto';
  return choice === 'none' ? 'None' : choice;
}

function stageText(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '±0';
}

/** The HP step closest to `hp`. */
function nearestHp(hp: number): number {
  return HP_STEPS.reduce((best, step) => (Math.abs(step - hp) < Math.abs(best - hp) ? step : best), HP_STEPS[0]);
}
